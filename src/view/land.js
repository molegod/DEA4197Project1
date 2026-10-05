// The island: a terrain mesh shaped by the simulation's height grid. The ground runs
// out past the coast and down to the sea bed, where the ocean in view/water.js takes
// over. Grass is in the colour of the ground, not in blades: where the creatures have
// grazed it down the green goes out of it.

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { applyShading } from './shading.js';

// Palette (sRGB hex, converted to linear by THREE.Color).
const P = CONFIG.palette;

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
    const pos = new Float32Array(n * 3);
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
    // What the ground remembers, and what it is made of: red is how worn or piled a
    // place is, green is hunter scent, blue is how much grass is growing. The shader
    // decides the colour of every pixel from these three numbers and the height, so the
    // island is drawn in flat regions instead of blended ramps.
    this.history = new Uint8Array(world.gw * world.gh * 4);
    this.historyMap = new THREE.DataTexture(this.history, world.gw, world.gh, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.historyMap.minFilter = this.historyMap.magFilter = THREE.LinearFilter;
    this.historyMap.wrapS = this.historyMap.wrapT = THREE.ClampToEdgeWrapping;
    this.historyMap.needsUpdate = true;

    const I = CONFIG.view.ink, L = CONFIG.view.lines;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, envMapIntensity: 0.75 });
    this.terrainUniforms = {
      uHistory: { value: this.historyMap },
      uHalfBoard: { value: new THREE.Vector2(W / 2, H / 2) },
      uGrid: { value: new THREE.Vector2(world.gw, world.gh) },
      uCell: { value: cell },
      uHeightScale: { value: VS },
      uWaterLevel: { value: CONFIG.world.waterLevel },
      uWash: { value: I.wash },
      uBleed: { value: I.bleed },
      uLineWidth: { value: L.width },
      uLineStrength: { value: L.strength },
      uShowScent: { value: 1 },
      uInk: { value: new THREE.Color(P.ink) },
      uFear: { value: new THREE.Color(P.fear) },
      uBed: { value: new THREE.Color(P.bed) },
      uBedDeep: { value: new THREE.Color(P.bedDeep) },
      uSand: { value: new THREE.Color(P.sand) },
      uSoil: { value: new THREE.Color(P.soil) },
      uRock: { value: new THREE.Color(P.rock) },
      uSnow: { value: new THREE.Color(P.snow) },
      uMeadow: { value: new THREE.Color(P.meadow) },
      uLush: { value: new THREE.Color(P.lush) },
      uPath: { value: new THREE.Color(P.path) },
      uPile: { value: new THREE.Color(P.pile) },
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
          uniform float uCell, uHeightScale, uWaterLevel, uWash, uBleed, uLineWidth, uLineStrength, uShowScent;
          uniform vec3 uInk, uFear, uBed, uBedDeep, uSand, uSoil, uRock, uSnow, uMeadow, uLush, uPath, uPile;

          // What colour this ground is, decided outright rather than blended. Every
          // test here is a hard one, so two colours always meet along a clean edge.
          vec3 groundColor(float h, float grass, float dirt, float scent) {
            // One colour under the water: the sea draws its own bands over the top.
            if (h < uWaterLevel) return uBed;
            float e = (h - uWaterLevel) / (1.0 - uWaterLevel);
            vec3 c = e < 0.04 ? uSand : (e < 0.45 ? uSoil : (e < 0.7 ? uRock : uSnow));
            if (e >= 0.04) {
              if (grass > 0.62) c = uLush;
              else if (grass > 0.26) c = uMeadow;
            }
            if (dirt > 0.1) c = uPath;
            else if (dirt < -0.1) c = uPile;
            if (scent > 0.32) c = mix(c, uFear, 0.45);
            return c;
          }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float gh = vHeight / uHeightScale;
          vec2 huv = ((vWorldPos.xz + uHalfBoard) / uCell + 0.5) / uGrid;
          // The scent is read through a noise warp, so its edge wanders like a wash of
          // paint rather than following the grid it is stored on.
          vec2 warp = (vec2(fbm2(vWorldPos.xz * 0.02), fbm2(vWorldPos.xz * 0.02 + 11.3)) - 0.5) * uBleed / uCell / uGrid;
          vec2 suv = huv + warp;

          vec3 hs = texture2D(uHistory, huv).rgb;
          float scent0 = texture2D(uHistory, suv).g * uShowScent * uWash * 2.0;
          vec3 col = groundColor(gh, hs.b, (hs.r - 0.5) * 2.4, scent0);

          // The line between one colour and the next: ask what colour the ground is a
          // pixel or two away in each direction, and draw a line where the answer differs.
          vec2 dUVx = dFdx(huv) * uLineWidth, dUVy = dFdy(huv) * uLineWidth;
          float dHx = dFdx(gh) * uLineWidth, dHy = dFdy(gh) * uLineWidth;
          float line = 0.0;
          for (int i = 0; i < 4; i++) {
            vec2 o = i == 0 ? vec2(1.0, 0.0) : i == 1 ? vec2(-1.0, 0.0) : i == 2 ? vec2(0.0, 1.0) : vec2(0.0, -1.0);
            vec3 n = texture2D(uHistory, huv + dUVx * o.x + dUVy * o.y).rgb;
            float sc = texture2D(uHistory, suv + dUVx * o.x + dUVy * o.y).g * uShowScent * uWash * 2.0;
            vec3 other = groundColor(gh + dHx * o.x + dHy * o.y, n.b, (n.r - 0.5) * 2.4, sc);
            line = max(line, step(0.004, dot(abs(other - col), vec3(1.0))));
          }
          diffuseColor.rgb = mix(col, uInk, line * uLineStrength);`,
        );
    };
    applyShading(mat, shade, { toon: true, rim: false, clouds: true });
    this.surface = new THREE.Mesh(geo, mat);
    this.surface.receiveShadow = true;
    this.surface.frustumCulled = false;
    this.group.add(this.surface);

  }

  // Reshape the ground, and hand the shader what it is made of.
  update(world, { showScent = true } = {}) {
    const { nx, ny } = this;
    const VS = CONFIG.view.heightScale, D = CONFIG.dirt.depth;
    const { base, ground, grass, hunterScent, gw } = world;
    this.terrainUniforms.uShowScent.value = showScent ? 1 : 0;

    const pos = this.surface.geometry.attributes.position.array;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        pos[(j * nx + i) * 3 + 1] = (base[j * gw + i] - ground[j * gw + i] * D) * VS;
      }
    }
    const g = this.surface.geometry;
    g.attributes.position.needsUpdate = true;
    g.computeVertexNormals();

    // r: dug out or piled up, with 0.5 meaning untouched. g: hunter scent. b: grass.
    const hist = this.history;
    for (let k = 0, n = ground.length; k < n; k++) {
      hist[k * 4] = Math.min(255, Math.max(0, (ground[k] / 2.4 + 0.5) * 255));
      hist[k * 4 + 1] = Math.min(255, Math.max(0, hunterScent[k] * 1400));
      hist[k * 4 + 2] = Math.min(255, Math.max(0, grass[k] * 255));
      hist[k * 4 + 3] = 255;
    }
    this.historyMap.needsUpdate = true;
  }
}
