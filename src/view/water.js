// The sea the island sits in, painted rather than photographed.
//
// Four Gerstner waves displace a radial grid that is re-centred on the camera every
// frame, so the triangles are small where you can see them and enormous out at the
// horizon. The colour is decided by how deep the water is: the scene is drawn once into
// a half-size buffer before the water goes down, the shader reads that buffer back bent
// by the wave slope, and then lays flat bands of colour over it — the bottom shows
// through at the very edge, then one tone for the shallows and one for the deep.
//
// Where the water runs out it breaks into foam, and the edge of the foam is cut by
// drifting noise rather than a wave, so the shore scallops instead of repeating. There
// is no mirror-bright sun glitter: a regular highlight on a regular swell is exactly
// what makes a sea look tiled.
//
// One extra half-size pass, no planar reflection, and no texture to download.

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { SKY_GLSL } from './sky.js';
import { NOISE_GLSL } from './glsl.js';

const DEPTH_SCALE = 90; // deepest water the coarse height texture can express, in view units

// A disc of triangles that get bigger the further out they are. Centred on the camera,
// it keeps detail underfoot without tessellating the whole ocean.
function radialGrid(rings, sectors, inner, outer) {
  const pos = [0, 0, 0];
  for (let i = 0; i < rings; i++) {
    const r = inner * Math.pow(outer / inner, i / (rings - 1));
    for (let s = 0; s < sectors; s++) {
      const a = (s / sectors) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }
  const idx = [];
  for (let s = 0; s < sectors; s++) idx.push(0, 1 + s, 1 + ((s + 1) % sectors));
  for (let i = 0; i < rings - 1; i++) {
    const a0 = 1 + i * sectors, a1 = a0 + sectors;
    for (let s = 0; s < sectors; s++) {
      const n = (s + 1) % sectors;
      idx.push(a0 + s, a1 + s, a0 + n, a0 + n, a1 + s, a1 + n);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), outer);
  return g;
}

// Shared by both stages: one Gerstner wave, and the bundle of four that make the swell.
const WAVES_GLSL = /* glsl */ `
uniform float uTime, uSteep, uWaveScale;

// Gerstner: crests gather and troughs stretch, so the surface has shape rather than
// just a wobbly normal. Returns the offset and accumulates the surface derivatives.
vec3 gerstner(vec2 dir, float amp, float freq, float speed, vec2 p, float q, inout vec3 nrm) {
  vec2 d = normalize(dir);
  float ph = dot(d, p) * freq + uTime * speed;
  float c = cos(ph), s = sin(ph);
  nrm.x -= d.x * freq * amp * c;
  nrm.z -= d.y * freq * amp * c;
  nrm.y -= q * freq * amp * s;
  return vec3(q * amp * d.x * c, amp * s, q * amp * d.y * c);
}

// The fade argument thins the swell where the grid is coarse or the water is shallow.
vec3 swell(vec2 p, float fade, out vec3 nrm) {
  nrm = vec3(0.0, 1.0, 0.0);
  float a = uWaveScale * fade;
  vec3 o = vec3(0.0);
  o += gerstner(vec2( 1.00,  0.28), 2.60 * a, 0.0150, 1.00, p, uSteep, nrm);
  o += gerstner(vec2( 0.42,  1.00), 1.50 * a, 0.0270, 1.35, p, uSteep, nrm);
  o += gerstner(vec2(-0.85,  0.50), 0.70 * a, 0.0520, 1.85, p, uSteep * 0.8, nrm);
  o += gerstner(vec2( 0.80, -0.70), 0.30 * a, 0.1050, 2.50, p, uSteep * 0.6, nrm);
  return o;
}
`;

const VERT = /* glsl */ `
${WAVES_GLSL}
uniform sampler2D uDepthMap;
uniform vec2 uHalf;
varying vec3 vWorld;
varying vec3 vSwellNormal;
varying float vViewZ;
varying float vShallow;
varying float vCrest;

void main() {
  vec3 flat_ = (modelMatrix * vec4(position, 1.0)).xyz;

  // Waves lie down well before they reach the beach. A surface that still had height
  // where it meets a gentle slope would cut a waterline shaped like its own triangles.
  vec2 uv = flat_.xz / (2.0 * uHalf) + 0.5;
  float outside = smoothstep(0.0, 260.0, max(abs(flat_.x) - uHalf.x, abs(flat_.z) - uHalf.y));
  float deep = mix(texture2D(uDepthMap, uv).r * ${DEPTH_SCALE.toFixed(1)}, ${DEPTH_SCALE.toFixed(1)}, outside);
  vShallow = smoothstep(1.0, 40.0, deep);

  // …and the triangles grow with distance, so stop asking them to carry small waves.
  float dist = length(cameraPosition - flat_);
  float fade = vShallow / (1.0 + dist * 0.0012);

  vec3 nrm;
  vec3 rise = swell(flat_.xz, fade, nrm);
  vec3 world = flat_ + rise;
  vCrest = rise.y / max(0.001, 2.6 * uWaveScale * fade);
  vSwellNormal = nrm;
  vWorld = world;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  vViewZ = mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
#include <packing>
${SKY_GLSL}
${WAVES_GLSL}
${NOISE_GLSL}
uniform sampler2D uScene, uSceneDepth;
uniform vec2 uResolution;
uniform float uNear, uFar, uRefract;
uniform float uClear, uBand, uBandSoft, uFoamWidth, uFoamScale, uFoamSpeed, uSky;
uniform vec3 uShallow, uDeep, uFoam;
varying vec3 vWorld;
varying vec3 vSwellNormal;
varying float vViewZ;
varying float vShallow;
varying float vCrest;

// Small, fast ripples on top of the swell, as a normal only.
vec2 ripples(vec2 p, float lod) {
  vec2 g = vec2(0.0), d;
  float ph;
  #define RIP(DX, DY, AMP, FRQ, SPD) d = normalize(vec2(DX, DY)); ph = dot(d, p) * (FRQ) + uTime * (SPD); g += d * cos(ph) * (AMP) * (FRQ);
  RIP(-0.35, -1.00, 0.10 * lod,                0.31, 3.3)
  RIP( 0.62,  0.78, 0.055 * pow(lod, 3.0),     0.62, 4.2)
  RIP(-0.95,  0.30, 0.030 * pow(lod, 4.0),     1.15, 5.6)
  #undef RIP
  return g;
}

float sceneViewZ(vec2 uv) {
  return perspectiveDepthToViewZ(texture2D(uSceneDepth, uv).x, uNear, uFar);
}

void main() {
  float dist = length(cameraPosition - vWorld);
  float lod = 1.0 / (1.0 + dist * 0.0016);
  vec3 view = normalize(cameraPosition - vWorld);

  vec2 g = ripples(vWorld.xz, lod) * vShallow;
  vec3 n = normalize(vec3(vSwellNormal.x - g.x * 3.0, vSwellNormal.y, vSwellNormal.z - g.y * 3.0));

  // What is behind the water, nudged sideways by the slope of the surface. If the nudge
  // lands on something in front of the water, it isn't behind it: use the straight line.
  vec2 uv = gl_FragCoord.xy / uResolution;
  float bend = uRefract * (1.0 - lod * 0.55);
  vec2 uvR = clamp(uv + n.xz * bend, vec2(0.001), vec2(0.999));
  if (sceneViewZ(uvR) > vViewZ) uvR = uv;

  float depth = max(0.0, vViewZ - sceneViewZ(uvR));
  vec3 behind = texture2D(uScene, uvR).rgb;

  // Flat bands of colour laid over the bottom: clear at the very edge, then one tone
  // for the shallows and one for the deep.
  vec3 band = mix(uShallow, uDeep, smoothstep(uBand - uBandSoft, uBand + uBandSoft, depth));
  vec3 body = mix(behind, band, smoothstep(0.0, uClear, depth));

  // A little sky at grazing angles, so the sea still sits under this sky. No sun
  // glitter: a regular highlight on a regular swell is what makes a sea look tiled.
  float f = clamp(pow(1.0 - max(dot(view, n), 0.0), 5.0), 0.0, 1.0) * uSky;
  vec3 refl = skyColor(reflect(-view, n));

  // Foam, cut against drifting noise: where the noise is low it reaches further out, so
  // the edge scallops and never repeats. Its width is measured in pixels rather than in
  // depth, otherwise a gently shelving beach turns the line into a blanket.
  vec2 drift = vec2(uTime * uFoamSpeed, uTime * uFoamSpeed * -0.7);
  float grain = fbm2(vWorld.xz * uFoamScale + drift);
  float w = max(0.2, fwidth(depth) * uFoamWidth);
  float edge = 1.0 - smoothstep(0.0, w, depth);
  float foam = smoothstep(grain - 0.07, grain + 0.07, edge);

  vec3 color = mix(mix(body, refl, f), uFoam, foam);

  // Far out, give way to the haze on the horizon so the sea has no edge.
  float haze = smoothstep(1200.0, 9000.0, dist);
  gl_FragColor = vec4(mix(color, skyColor(normalize(vec3(-view.x, 0.015, -view.z))), haze), 1.0);
}
`;

export class Ocean {
  constructor(scene, world, skyUniforms) {
    const VS = CONFIG.view.heightScale;
    const O = CONFIG.view.ocean;
    this.waterY = CONFIG.world.waterLevel * VS;
    this.floorY = CONFIG.world.seabed * VS;

    // A coarse picture of the sea bed, for flattening the waves in the shallows.
    this.data = new Uint8Array(world.gw * world.gh);
    this.map = new THREE.DataTexture(this.data, world.gw, world.gh, THREE.RedFormat, THREE.UnsignedByteType);
    this.map.minFilter = this.map.magFilter = THREE.LinearFilter;
    this.map.wrapS = this.map.wrapT = THREE.ClampToEdgeWrapping;
    this.map.needsUpdate = true;

    this.uniforms = {
      ...skyUniforms,
      uDepthMap: { value: this.map },
      uHalf: { value: new THREE.Vector2(((world.gw - 1) * world.cell) / 2, ((world.gh - 1) * world.cell) / 2) },
      uTime: { value: 0 },
      uSteep: { value: O.steepness },
      uWaveScale: { value: O.waveScale },
      uScene: { value: null },
      uSceneDepth: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 1 },
      uFar: { value: 1 },
      uRefract: { value: O.refraction },
      uClear: { value: O.clear },
      uBand: { value: O.band },
      uBandSoft: { value: O.bandSoft },
      uFoamWidth: { value: O.foamWidth },
      uFoamScale: { value: O.foamScale },
      uFoamSpeed: { value: O.foamSpeed },
      uSky: { value: O.sky },
      uShallow: { value: new THREE.Color(O.shallow) },
      uDeep: { value: new THREE.Color(O.deep) },
      uFoam: { value: new THREE.Color(O.foam) },
    };

    this.surface = new THREE.Mesh(
      radialGrid(O.rings, O.sectors, 1.5, O.size / 2),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide }),
    );
    this.surface.position.y = this.waterY;
    this.surface.frustumCulled = false;
    scene.add(this.surface);

    // The sea bed carries on past the island at the height of the board's rim, so the
    // two meet without a seam.
    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(O.size, O.size).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: O.floor, roughness: 1, metalness: 0 }),
    );
    this.floor.position.y = this.floorY - 0.5;
    this.floor.frustumCulled = false;
    scene.add(this.floor);
  }

  // Copy the depth of water over the board into the texture the vertex shader reads.
  syncDepth(world) {
    const VS = CONFIG.view.heightScale, D = CONFIG.dirt.depth;
    const { base, ground } = world;
    const top = this.waterY;
    for (let k = 0, n = this.data.length; k < n; k++) {
      const h = (base[k] - ground[k] * D) * VS;
      this.data[k] = Math.max(0, Math.min(255, ((top - h) / DEPTH_SCALE) * 255)) | 0;
    }
    this.map.needsUpdate = true;
  }

  // Keep the detailed middle of the grid under the camera.
  update(time, camera) {
    this.uniforms.uTime.value = time;
    if (camera) {
      this.surface.position.x = camera.position.x;
      this.surface.position.z = camera.position.z;
    }
  }
}
