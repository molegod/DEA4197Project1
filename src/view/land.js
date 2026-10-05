// The island: a terrain mesh shaped by the simulation's height grid, and a tuft of
// grass on every other grid cell that shrinks as it's eaten. The ground runs out past
// the coast and down to the sea bed, where the ocean in view/water.js takes over.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { fbm } from '../noise.js';
import { applyShading } from './shading.js';

// Palette (sRGB hex, converted to linear by THREE.Color).
const rgb = (hex) => new THREE.Color(hex).toArray();
const P = CONFIG.palette;
const PAL = {
  bed: rgb(P.bed),
  bedDeep: rgb(P.bedDeep),
  sand: rgb(P.sand),
  soilLow: rgb(P.soilLow),
  soilHigh: rgb(P.soil),
  rock: rgb(P.rock),
  snow: rgb(P.snow),
  meadow: rgb(P.meadow),
  lush: rgb(P.lush),
  path: rgb(P.path),
  pile: rgb(P.pile),
};

const MEADOW = new THREE.Color(P.meadow);
const LUSH = new THREE.Color(P.lush);

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mixInto = (out, c, t) => {
  out[0] += (c[0] - out[0]) * t;
  out[1] += (c[1] - out[1]) * t;
  out[2] += (c[2] - out[2]) * t;
};

export class Land {
  constructor(scene, world, shade) {
    this.scene = scene;
    this.shade = shade;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.build(world, shade);
  }

  build(world, shade = this.shade) {
    this.group.clear();
    const { width: W, height: H } = world;
    const cell = world.cell;
    const nx = Math.round(W / cell) + 1, ny = Math.round(H / cell) + 1;
    Object.assign(this, { W, H, cell, nx, ny });
    const VS = CONFIG.view.heightScale;
    this.waterY = CONFIG.world.waterLevel * VS;

    // ---- terrain surface ----
    const n = nx * ny;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const v = j * nx + i;
        pos[v * 3] = i * cell - W / 2;
        pos[v * 3 + 2] = j * cell - H / 2;
      }
    }
    const index = [];
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        index.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setIndex(index);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // What the ground remembers: red is how worn a place is, green is how much hunter
    // scent is lying on it. The shader draws from this, so the island ends up marked
    // with the creatures' own history rather than merely tinted by it.
    this.history = new Uint8Array(world.gw * world.gh * 2);
    this.historyMap = new THREE.DataTexture(this.history, world.gw, world.gh, THREE.RGFormat, THREE.UnsignedByteType);
    this.historyMap.minFilter = this.historyMap.magFilter = THREE.LinearFilter;
    this.historyMap.wrapS = this.historyMap.wrapT = THREE.ClampToEdgeWrapping;
    this.historyMap.needsUpdate = true;

    const I = CONFIG.view.ink;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.75 });
    this.terrainUniforms = {
      uContour: { value: 0.025 * VS },
      uHistory: { value: this.historyMap },
      uHalfBoard: { value: new THREE.Vector2(W / 2, H / 2) },
      uGrid: { value: new THREE.Vector2(world.gw, world.gh) },
      uCell: { value: cell },
      uStroke: { value: I.stroke },
      uWash: { value: I.wash },
      uBleed: { value: I.bleed },
      uInk: { value: new THREE.Color(P.ink) },
      uFear: { value: new THREE.Color(P.fear) },
      uShowScent: { value: 1 },
    };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.terrainUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vHeight;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeight = position.y;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying float vHeight;
          uniform sampler2D uHistory;
          uniform vec2 uHalfBoard, uGrid;
          uniform float uContour, uCell, uStroke, uWash, uBleed, uShowScent;
          uniform vec3 uInk, uFear;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          // Faint contour lines, like a map drawn of the place.
          float cl = vHeight / uContour;
          float fw = max(fwidth(cl), 1e-4);
          float d = abs(fract(cl + 0.5) - 0.5);
          float line = (1.0 - smoothstep(0.5 * fw, 1.5 * fw, d)) * (1.0 - smoothstep(0.25, 0.7, fw));
          diffuseColor.rgb *= 1.0 - 0.07 * line;

          vec2 hc = (vWorldPos.xz + uHalfBoard) / uCell + 0.5;
          vec2 huv = hc / uGrid;

          // A worn path is inked along its edges, where the ground falls away into it.
          float worn = texture2D(uHistory, huv).r;
          float stroke = clamp(length(vec2(dFdx(worn), dFdy(worn))) * 26.0, 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, uInk, stroke * uStroke);

          // Hunter scent is a wash: its edge is pulled about by noise so it bleeds like
          // paint into wet paper, and it dries darker where it stops.
          vec2 warp = (vec2(fbm2(vWorldPos.xz * 0.02), fbm2(vWorldPos.xz * 0.02 + 11.3)) - 0.5) * uBleed / uCell;
          float scent = texture2D(uHistory, (hc + warp) / uGrid).g;
          float wash = smoothstep(0.03, 0.45, scent) * uShowScent;
          float edge = clamp(length(vec2(dFdx(wash), dFdy(wash))) * 9.0, 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, uFear, wash * uWash * 0.75);
          diffuseColor.rgb = mix(diffuseColor.rgb, uFear * 0.55, edge * uWash);`,
        );
    };
    applyShading(mat, shade, { toon: true, rim: false, clouds: true });
    this.surface = new THREE.Mesh(geo, mat);
    this.surface.receiveShadow = true;
    this.surface.frustumCulled = false;
    this.group.add(this.surface);

    // ---- grass: a tuft of blades on every other grid node ----
    // A blade is a tapered strip that curves over as it rises, dark at the root and
    // bright at the tip. Nine of them, splayed, make a tuft dense enough to read as a
    // carpet rather than as scattered spikes.
    let seed = 12345;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const blade = (lean, curl, width, tall, x, z) => {
      const steps = 4, pos = [], up = [], idx = [];
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const w = width * Math.pow(1 - t, 0.7) * Math.min(1, t / 0.14 + 0.35);
        const out = curl * t * t;
        pos.push(-w, t * tall, out, w, t * tall, out);
        up.push(t, t); // how far along the blade, for the colour gradient and the wind
      }
      for (let k = 0; k < steps; k++) {
        const a = k * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      const g = new THREE.BufferGeometry();
      g.setIndex(idx);
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aBlade', new THREE.Float32BufferAttribute(up, 1));
      g.computeVertexNormals();
      // Lean the normals toward the sky: edge-on strips otherwise go black.
      const nrm = g.attributes.normal.array;
      for (let v = 0; v < nrm.length; v += 3) {
        const y = nrm[v + 1] * 0.3 + 0.85;
        const len = Math.hypot(nrm[v] * 0.3, y, nrm[v + 2] * 0.3) || 1;
        nrm[v] = (nrm[v] * 0.3) / len;
        nrm[v + 1] = y / len;
        nrm[v + 2] = (nrm[v + 2] * 0.3) / len;
      }
      return g.rotateY(lean).translate(x, 0, z);
    };
    const tuftGeo = mergeGeometries(
      Array.from({ length: 4 }, (_, i) => {
        const a = (i / 4) * Math.PI * 2 + rand() * 0.8;
        const r = 0.1 + rand() * 0.55;
        return blade(a + rand() - 0.5, 0.2 + rand() * 0.34, 0.055 + rand() * 0.03, 0.55 + rand() * 0.45, Math.cos(a) * r, Math.sin(a) * r);
      }),
    );
    const tuftMat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, envMapIntensity: 0.5, side: THREE.DoubleSide });
    // aTuft = (how grown 0–1, ground height, full blade height, tuft width). Applied
    // before the instance transform (which only turns and widens), so shadows line up.
    tuftMat.onBeforeCompile = (shader) => {
      shader.uniforms.uRoot = { value: new THREE.Vector3(...CONFIG.view.grass.root) };
      shader.uniforms.uTip = { value: new THREE.Vector3(...CONFIG.view.grass.tip) };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aTuft;\nattribute float aBlade;\nuniform float uTime;\nvarying float vBlade;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vBlade = aBlade;
          float high = aTuft.x * aTuft.z;
          transformed.xz *= min(1.0, aTuft.x * 2.5);
          transformed.y = transformed.y * high + aTuft.y;
          // Wind in gusts: two long waves travelling across the island, so whole
          // patches lean together instead of every tuft waving on its own clock.
          // Sines rather than noise — this runs on every vertex of every blade.
          vec2 at = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
          float gust = sin(dot(at, vec2(0.0045, 0.0032)) - uTime * 0.55)
                     + 0.6 * sin(dot(at, vec2(-0.0027, 0.0051)) - uTime * 0.37);
          float sway = (sin(uTime * 1.5 + at.x * 0.035) * 0.06 + gust * 0.13) * aBlade * aBlade * high / aTuft.w;
          transformed.x += sway;
          transformed.z += sway * 0.55;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uRoot, uTip;\nvarying float vBlade;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(uRoot, uTip, vBlade);');
    };
    applyShading(tuftMat, shade, { toon: false, rim: true, clouds: true });
    this.tuftMat = tuftMat;
    // One tuft per grid cell, wide enough to overlap its neighbours: a carpet, not spikes.
    const tx = nx, ty = ny;
    const count = tx * ty;
    this.tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, count);
    this.tuftAttr = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    this.tuftAttr.setUsage(THREE.DynamicDrawUsage);
    tuftGeo.setAttribute('aTuft', this.tuftAttr);
    this.tuftPos = new Float32Array(count * 2); // jittered sim-space position of each tuft
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    const G = CONFIG.view.grass;
    for (let v = 0; v < count; v++) {
      const i = v % tx, j = Math.floor(v / tx);
      const sx = Math.min(W - 1, Math.max(1, i * cell + (rand() - 0.5) * cell * 1.3));
      const sy = Math.min(H - 1, Math.max(1, j * cell + (rand() - 0.5) * cell * 1.3));
      this.tuftPos[v * 2] = sx;
      this.tuftPos[v * 2 + 1] = sy;
      const w = 3 + rand() * 1.8;
      t.set(sx - W / 2, 0, sy - H / 2);
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      s.set(w, 1, w);
      this.tufts.setMatrixAt(v, m.compose(t, q, s));
      this.tuftAttr.array[v * 4 + 2] = G.height[0] + rand() * (G.height[1] - G.height[0]);
      this.tuftAttr.array[v * 4 + 3] = w;
      // Big, soft patches of lighter and darker grass, the way a field actually looks.
      const patch = fbm(sx * 0.009, sy * 0.009, 3, 0x9e3779b9);
      color.copy(MEADOW).lerp(LUSH, Math.min(1, Math.max(0, 0.5 - patch * 1.3)));
      color.multiplyScalar(0.78 + patch * 0.5 + rand() * 0.12);
      this.tufts.setColorAt(v, color);
    }
    this.tufts.receiveShadow = true;
    this.tufts.frustumCulled = false;
    this.group.add(this.tufts);
  }

  // Reshape and recolour everything from the simulation's fields.
  update(world, { showScent = true } = {}) {
    this.terrainUniforms.uShowScent.value = showScent ? 1 : 0;
    const { nx, ny, W, H } = this;
    const VS = CONFIG.view.heightScale, D = CONFIG.dirt.depth, w = CONFIG.world.waterLevel;
    const { base, ground, grass, hunterScent, gw } = world;
    const pos = this.surface.geometry.attributes.position.array;
    const col = this.surface.geometry.attributes.color.array;
    const c = [0, 0, 0];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const v = j * nx + i, k = j * gw + i;
        const h = base[k] - ground[k] * D;
        pos[v * 3 + 1] = h * VS;
        if (h < w) {
          c[0] = PAL.bed[0], c[1] = PAL.bed[1], c[2] = PAL.bed[2];
          mixInto(c, PAL.bedDeep, smooth(0, 0.12, w - h));
        } else {
          const e = (h - w) / (1 - w);
          c[0] = PAL.soilLow[0], c[1] = PAL.soilLow[1], c[2] = PAL.soilLow[2];
          mixInto(c, PAL.soilHigh, smooth(0.05, 0.45, e));
          mixInto(c, PAL.rock, smooth(0.45, 0.7, e));
          mixInto(c, PAL.snow, smooth(0.8, 0.92, e));
          mixInto(c, PAL.sand, 1 - smooth(0, 0.035, e));
          const g = grass[k];
          mixInto(c, g > 0.6 ? PAL.lush : PAL.meadow, smooth(0.05, 0.55, g) * 0.9);
          const dirt = ground[k];
          if (dirt > 0) mixInto(c, PAL.path, smooth(0.04, 0.5, dirt) * 0.85);
          else mixInto(c, PAL.pile, smooth(0.04, 0.5, -dirt) * 0.7);
        }
        col[v * 3] = c[0];
        col[v * 3 + 1] = c[1];
        col[v * 3 + 2] = c[2];
      }
    }
    const g = this.surface.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.computeVertexNormals();

    // Hand the shader what the ground remembers: how worn, and how much scent.
    const hist = this.history;
    for (let k = 0, n = ground.length; k < n; k++) {
      hist[k * 2] = Math.min(255, Math.max(0, ground[k] * 420));
      hist[k * 2 + 1] = Math.min(255, Math.max(0, hunterScent[k] * 1400));
    }
    this.historyMap.needsUpdate = true;

    // Tufts: height follows the grass, and they sit on the current ground.
    const a = this.tuftAttr.array, tp = this.tuftPos;
    for (let v = 0, m = this.tufts.count; v < m; v++) {
      const sx = tp[v * 2], sy = tp[v * 2 + 1];
      const k = world.index(sx, sy);
      const h = world.heightAt(sx, sy);
      a[v * 4] = h < w ? 0 : smooth(0.06, 1, grass[k]);
      a[v * 4 + 1] = h * VS - 0.4;
    }
    this.tuftAttr.needsUpdate = true;
  }
}
