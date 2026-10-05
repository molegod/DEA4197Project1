// The look, shared by everything that is lit.
//
// Three things get patched into Three's standard material here, from one set of
// uniforms so they all move together:
//
//   cloud shadow — patches of weather drifting over the island, taking the sun away
//                  and leaving the sky's fill alone, which is what a cloud actually does
//   toon         — the sun's contribution in a few steps instead of a smooth ramp, with
//                  the edges between them jittered so they wobble like a painted edge
//   rim          — light coming round the edge of a thing that has the sun behind it
//
// Each material opts in to the parts it wants, so the ground can be stepped while the
// creatures stay soft.

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { NOISE_GLSL } from './glsl.js';

// One object, shared by every material: setting a value here moves all of them.
export function shadingUniforms() {
  const C = CONFIG.view.clouds, T = CONFIG.view.toon, R = CONFIG.view.rim;
  return {
    uTime: { value: 0 },
    uSunView: { value: new THREE.Vector3(0, 1, 0) }, // toward the sun, in view space
    uKey: { value: new THREE.Color(0xffffff) },
    uCloudScale: { value: C.scale },
    uCloudDrift: { value: new THREE.Vector2(...C.speed) },
    uCloudAmount: { value: C.amount },
    uCloudCoverage: { value: C.coverage },
    uCloudSoft: { value: C.softness },
    uToonSteps: { value: T.steps },
    uToonJitter: { value: T.jitter },
    uToonJitterScale: { value: T.jitterScale },
    uToonFloor: { value: T.floor },
    uRimPower: { value: R.power },
    uRimStrength: { value: R.strength },
  };
}

const HEAD = /* glsl */ `
${NOISE_GLSL}
uniform float uTime, uCloudScale, uCloudAmount, uCloudCoverage, uCloudSoft;
uniform float uToonSteps, uToonJitter, uToonJitterScale, uToonFloor;
uniform float uRimPower, uRimStrength;
uniform vec2 uCloudDrift;
uniform vec3 uSunView, uKey;
varying vec3 vWorldPos;

// How much sun reaches a point on the ground: 1 in the open, less under a cloud.
float cloudLight(vec2 p) {
  float n = fbm2(p * uCloudScale + uCloudDrift * uTime * uCloudScale);
  float shade = smoothstep(uCloudCoverage - uCloudSoft, uCloudCoverage + uCloudSoft, n);
  return 1.0 - uCloudAmount * shade;
}
`;

// Added to the vertex shader of every patched material: the world position, worked out
// after any displacement the material does of its own (grass bending, for instance).
const WORLDPOS = /* glsl */ `
#ifdef USE_INSTANCING
  vWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif
`;

/**
 * Patch a MeshStandardMaterial. `onCompile` runs last, for anything the material wants
 * to add for itself.
 */
export function applyShading(material, uniforms, { toon = false, rim = false, clouds = true, onCompile = null } = {}) {
  const existing = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    Object.assign(shader.uniforms, uniforms); // the same uniform objects, not copies
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
      .replace('#include <project_vertex>', `${WORLDPOS}\n#include <project_vertex>`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${HEAD}`);

    let body = '';
    if (clouds) body += `
      float cloud = cloudLight(vWorldPos.xz);
      reflectedLight.directDiffuse *= cloud;
      reflectedLight.directSpecular *= cloud;`;
    else body += '\n      float cloud = 1.0;';

    if (toon) body += `
      // The sun in steps. The jitter is what keeps the edge from reading as a contour.
      float ndl = dot(normal, uSunView);
      ndl += (fbm2(vWorldPos.xz * uToonJitterScale) - 0.5) * uToonJitter;
      float lit = clamp(ndl, 0.0, 1.0);
      float stepped = floor(lit * uToonSteps + 0.5) / uToonSteps;
      float soft = fwidth(lit) * 1.5;
      stepped = mix(stepped, lit, smoothstep(0.02, 0.12, soft)); // let distance smooth it
      reflectedLight.directDiffuse = diffuseColor.rgb * RECIPROCAL_PI * uKey * max(stepped, uToonFloor) * cloud;`;

    if (rim) body += `
      // Backlight: strongest round the edge of something standing against the sun.
      vec3 V = normalize(vViewPosition);
      float edge = pow(1.0 - clamp(dot(normal, V), 0.0, 1.0), uRimPower);
      float behind = smoothstep(0.0, 0.7, -dot(V, uSunView));
      reflectedLight.indirectDiffuse += uKey * RECIPROCAL_PI * diffuseColor.rgb * edge * behind * uRimStrength;`;

    if (body) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${body}`);
    }
    if (existing) existing(shader, renderer);
    if (onCompile) onCompile(shader);
  };
  // Materials with different injected code must not share a compiled program.
  material.customProgramCacheKey = () => `cg:${toon}:${rim}:${clouds}:${material.uuid}`;
  return material;
}
