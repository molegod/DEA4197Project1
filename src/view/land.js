// The island: a terrain mesh shaped by the simulation's height grid, and a tuft of
// grass on every other grid cell that shrinks as it's eaten. The ground runs out past
// the coast and down to the sea bed, where the ocean in view/water.js takes over.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';

// Palette (sRGB hex, converted to linear by THREE.Color).
const rgb = (hex) => new THREE.Color(hex).toArray();
const PAL = {
  bed: rgb(0xc2b184),
  bedDeep: rgb(0x6d6a57),
  sand: rgb(0xe0cf9f),
  soilLow: rgb(0x8f7c5b),
  soilHigh: rgb(0xa39277),
  rock: rgb(0xaaa59c),
  snow: rgb(0xf4f3ee),
  meadow: rgb(0x79ad55),
  lush: rgb(0x4e8d39),
  path: rgb(0xdcc59a),
  pile: rgb(0x6b4f36),
  fear: rgb(0xe0563f),
  sideTop: rgb(0x8c7052),
  sideBottom: rgb(0x564334),
};

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
  constructor(scene, world) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.build(world);
  }

  build(world) {
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
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.75 });
    // Faint contour lines, like a topographic map.
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uContour = { value: 0.025 * VS };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vHeight;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeight = position.y;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vHeight;\nuniform float uContour;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float cl = vHeight / uContour;
          float fw = max(fwidth(cl), 1e-4);
          float d = abs(fract(cl + 0.5) - 0.5);
          float line = (1.0 - smoothstep(0.5 * fw, 1.5 * fw, d)) * (1.0 - smoothstep(0.25, 0.7, fw));
          diffuseColor.rgb *= 1.0 - 0.07 * line;`,
        );
    };
    this.surface = new THREE.Mesh(geo, mat);
    this.surface.receiveShadow = true;
    this.surface.frustumCulled = false;
    this.group.add(this.surface);

    // ---- grass: a tuft of blades on every other grid node ----
    // A blade is a tapered strip that curves over as it rises, so from any angle it
    // reads as a leaf rather than a spike. Five of them, splayed, make a tuft.
    let seed = 12345;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const blade = (lean, curl, width, tall, x, z) => {
      const steps = 4, pos = [], idx = [];
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const w = width * Math.pow(1 - t, 0.7) * Math.min(1, t / 0.14 + 0.35);
        const out = curl * t * t;
        pos.push(-w, t * tall, out, w, t * tall, out);
      }
      for (let k = 0; k < steps; k++) {
        const a = k * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      const g = new THREE.BufferGeometry();
      g.setIndex(idx);
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      // Lean the normals toward the sky: edge-on strips otherwise go black.
      const nrm = g.attributes.normal.array;
      for (let v = 0; v < nrm.length; v += 3) {
        const y = nrm[v + 1] * 0.35 + 0.8;
        const len = Math.hypot(nrm[v] * 0.35, y, nrm[v + 2] * 0.35) || 1;
        nrm[v] = (nrm[v] * 0.35) / len;
        nrm[v + 1] = y / len;
        nrm[v + 2] = (nrm[v + 2] * 0.35) / len;
      }
      return g.rotateY(lean).translate(x, 0, z);
    };
    const tuftGeo = mergeGeometries(
      Array.from({ length: 5 }, (_, i) => {
        const a = (i / 5) * Math.PI * 2 + rand() * 0.9;
        const r = 0.08 + rand() * 0.3;
        return blade(a, 0.22 + rand() * 0.3, 0.075 + rand() * 0.03, 0.62 + rand() * 0.38, Math.cos(a) * r, Math.sin(a) * r);
      }),
    );
    const tuftMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, envMapIntensity: 0.6, side: THREE.DoubleSide });
    // aTuft = (how grown 0–1, ground height, full blade height, tuft width). Applied
    // before the instance transform (which only turns and widens), so shadows line up.
    tuftMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      tuftMat.userData.uniforms = shader.uniforms;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aTuft;\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float blade = position.y;
          float high = aTuft.x * aTuft.z;
          transformed.xz *= min(1.0, aTuft.x * 2.5);
          transformed.y = transformed.y * high + aTuft.y;
          // Wind: the tips move, the roots don't. Tufts take their turn by position.
          float ph = uTime * 1.6 + aTuft.y * 0.07 + float(gl_InstanceID) * 0.7;
          float sway = (sin(ph) * 0.11 + sin(ph * 2.3) * 0.04) * blade * blade * high / aTuft.w;
          transformed.x += sway;
          transformed.z += sway * 0.55;`,
        );
    };
    this.tuftMat = tuftMat;
    const tx = Math.ceil(nx / 2), ty = Math.ceil(ny / 2);
    const count = tx * ty;
    this.tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, count);
    this.tuftAttr = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    this.tuftAttr.setUsage(THREE.DynamicDrawUsage);
    tuftGeo.setAttribute('aTuft', this.tuftAttr);
    this.tuftPos = new Float32Array(count * 2); // jittered sim-space position of each tuft
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    for (let v = 0; v < count; v++) {
      const i = (v % tx) * 2, j = Math.floor(v / tx) * 2;
      const sx = Math.min(W - 1, Math.max(1, i * cell + (rand() - 0.5) * cell * 1.8));
      const sy = Math.min(H - 1, Math.max(1, j * cell + (rand() - 0.5) * cell * 1.8));
      this.tuftPos[v * 2] = sx;
      this.tuftPos[v * 2 + 1] = sy;
      const w = 2.6 + rand() * 1.6;
      t.set(sx - W / 2, 0, sy - H / 2);
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      s.set(w, 1, w);
      this.tufts.setMatrixAt(v, m.compose(t, q, s));
      this.tuftAttr.array[v * 4 + 2] = 5 + rand() * 3;
      this.tuftAttr.array[v * 4 + 3] = w;
      this.tufts.setColorAt(v, color.setHSL(0.235 + rand() * 0.055, 0.46 + rand() * 0.18, 0.24 + rand() * 0.1));
    }
    this.tufts.receiveShadow = true;
    this.tufts.frustumCulled = false;
    this.group.add(this.tufts);
  }

  // Reshape and recolour everything from the simulation's fields.
  update(world, { showScent = true, time = 0 } = {}) {
    if (this.tuftMat.userData.uniforms) this.tuftMat.userData.uniforms.uTime.value = time;
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
          if (showScent) mixInto(c, PAL.fear, Math.min(1, hunterScent[k] * 7) * 0.4);
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
