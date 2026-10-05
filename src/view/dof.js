// Depth of field, for the diorama.
//
// Whatever the camera is looking at stays sharp and everything in front of and behind
// it goes soft, which is how something small photographed close up behaves — and so
// reading a blurred foreground as "small" is a reflex nobody can help.
//
// The depth comes from the half-size buffer the water already refracts, which costs
// nothing extra. That buffer has no water surface in it, so the sea is focused on its
// own bed; a few units out on something that is about to be blurred anyway.

import * as THREE from 'three';

export const DepthOfFieldShader = {
  name: 'DepthOfFieldShader',
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uNear: { value: 1 },
    uFar: { value: 1000 },
    uFocus: { value: 500 },
    uRange: { value: 500 },
    uStrength: { value: 1 },
    uMaxBlur: { value: 5 },
    uTexel: { value: new THREE.Vector2() },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tDiffuse, tDepth;
    uniform float uNear, uFar, uFocus, uRange, uStrength, uMaxBlur;
    uniform vec2 uTexel;
    varying vec2 vUv;

    // How far out of focus this pixel is, 0…1.
    float circleOfConfusion(vec2 uv) {
      float z = -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar);
      return clamp(abs(z - uFocus) / uRange * uStrength, 0.0, 1.0);
    }

    void main() {
      float coc = circleOfConfusion(vUv);
      float r = coc * uMaxBlur;
      if (r < 0.6) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }
      // A spiral of taps. Each one only counts if it is at least as out of focus as we
      // are, so a sharp subject doesn't smear out over the blurred ground behind it.
      vec4 sum = texture2D(tDiffuse, vUv);
      float weight = 1.0;
      for (int i = 0; i < 16; i++) {
        float f = (float(i) + 0.5) / 16.0;
        float a = f * 21.99115 + coc * 3.0;          // several turns, nudged per pixel
        vec2 off = vec2(cos(a), sin(a)) * sqrt(f) * r * uTexel;
        float w = step(coc * 0.65, circleOfConfusion(vUv + off));
        sum += texture2D(tDiffuse, vUv + off) * w;
        weight += w;
      }
      gl_FragColor = sum / weight;
    }
  `,
};
