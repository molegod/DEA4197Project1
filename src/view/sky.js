// A procedural sky. The same few lines of shader are used three ways: as the backdrop
// dome, as the light filling the shadows (baked into an environment map), and as what
// the water reflects — so the reflections always match the sky overhead.

import * as THREE from 'three';

// Direction toward the sun. The key light in stage.js is placed along this.
export const SUN_DIR = new THREE.Vector3(-0.52, 0.66, -0.3).normalize();

// Colors are written as sRGB hex and held in linear space, like every other THREE.Color.
export function skyUniforms() {
  return {
    uSun: { value: SUN_DIR.clone() },
    uZenith: { value: new THREE.Color(0x2a6ec8) },
    uHorizon: { value: new THREE.Color(0xc6dcea) },
    uHaze: { value: new THREE.Color(0x9fbdd2) },
    uSunColor: { value: new THREE.Color(0xfff2da) },
  };
}

// Shared by the dome and the water.
export const SKY_GLSL = /* glsl */ `
uniform vec3 uSun, uZenith, uHorizon, uHaze, uSunColor;
vec3 skyColor(vec3 dir) {
  float up = clamp(dir.y, -1.0, 1.0);
  // Rising off the horizon, not pow(): a curve that is this steep at zero would swing
  // wildly across the sea's reflection and band it.
  vec3 c = mix(uHorizon, uZenith, 1.0 - exp(-max(up, 0.0) * 2.6));
  c = mix(c, uHaze, smoothstep(0.02, -0.3, up));            // below the horizon: sea haze
  float s = max(dot(dir, uSun), 0.0);
  c += uSunColor * (0.20 * pow(s, 8.0) + 0.42 * pow(s, 140.0));
  return c;
}
`;

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// `disc` adds the sun itself, far brighter than 1, so bloom gives it a halo.
const frag = (disc) => /* glsl */ `
${SKY_GLSL}
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 c = skyColor(d);
  c += uSunColor * ${disc.toFixed(1)} * smoothstep(0.9994, 0.9997, max(dot(d, uSun), 0.0));
  gl_FragColor = vec4(c, 1.0);
}
`;

export class Sky {
  constructor(scene, renderer, radius = 13000) {
    this.uniforms = skyUniforms();
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 48, 24),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: frag(9), side: THREE.BackSide, depthWrite: false, fog: false }),
    );
    this.dome.renderOrder = -1;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    // Bake the same sky into a cube map: this is what lights the shaded sides of
    // everything, instead of a flat ambient term.
    const bakeScene = new THREE.Scene();
    bakeScene.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(10, 32, 16),
        new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: frag(2), side: THREE.BackSide, depthWrite: false, fog: false }),
      ),
    );
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envTarget = pmrem.fromScene(bakeScene, 0, 0.1, 100);
    pmrem.dispose();
    bakeScene.children[0].geometry.dispose();
    scene.environment = this.envTarget.texture;
  }
}
