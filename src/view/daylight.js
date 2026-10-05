// The sun goes round, and everything else follows it.
//
// One clock drives the whole picture: where the key light comes from and what colour it
// is, the three colours the sky is built from, how much the sky fills the shadows, and
// the exposure. The sea reflects the same sky, so dusk turns the water orange without
// the water knowing anything about the time of day.
//
// After sunset the key light becomes the moon — the same direction mirrored up through
// the horizon — because a simulation nobody can see is not worth watching.

import * as THREE from 'three';
import { CONFIG } from '../config.js';

const lerp = (a, b, t) => a + (b - a) * t;
const WHITE = new THREE.Color(1, 1, 1);

export class Daylight {
  constructor({ sky, sun, hemi, scene, renderer }) {
    this.sky = sky;
    this.sun = sun;
    this.hemi = hemi;
    this.scene = scene;
    this.renderer = renderer;
    this.dir = new THREE.Vector3();
    this.viewDir = new THREE.Vector3();
    this.frames = 0;
    this.stops = CONFIG.view.daylight.stops.map((s) => ({
      ...s,
      key: new THREE.Color(s.key),
      zenith: new THREE.Color(s.zenith),
      horizon: new THREE.Color(s.horizon),
      haze: new THREE.Color(s.haze),
    }));
  }

  // Where the sun is at time t (0…1 through the day), written into `out`.
  // It stops a little short of the horizon: a key light exactly level with the ground
  // throws shadows that run off the edge of the world.
  sunAt(t, out) {
    const D = CONFIG.view.daylight;
    const day = (t - D.sunrise) / (D.sunset - D.sunrise);
    const up = Math.sin(Math.PI * Math.min(1, Math.max(0, day)));
    const night = day < 0 || day > 1;
    const elev = Math.max(D.minElevation, up * D.maxElevation);
    const azim = -0.9 + Math.min(1.25, Math.max(-0.25, day)) * 2.2;
    out.set(Math.cos(elev) * Math.sin(azim), Math.sin(elev), Math.cos(elev) * Math.cos(azim));
    if (night) out.set(-out.x, out.y, -out.z); // the moon rises where the sun set
    return out;
  }

  // The palette at time t, as a blend of the two stops either side of it.
  stopAt(t) {
    const s = this.stops;
    let i = 0;
    while (i < s.length - 2 && s[i + 1].at <= t) i++;
    const a = s[i], b = s[i + 1];
    const k = b.at === a.at ? 0 : (t - a.at) / (b.at - a.at);
    return { a, b, k };
  }

  update(seconds, camera) {
    const D = CONFIG.view.daylight;
    const t = ((seconds / D.dayLength + D.start) % 1 + 1) % 1;
    const { a, b, k } = this.stopAt(t);
    const u = this.sky.uniforms;

    u.uZenith.value.lerpColors(a.zenith, b.zenith, k);
    u.uHorizon.value.lerpColors(a.horizon, b.horizon, k);
    u.uHaze.value.lerpColors(a.haze, b.haze, k);
    u.uSunColor.value.lerpColors(a.key, b.key, k);

    this.sunAt(t, this.dir);
    u.uSun.value.copy(this.dir);
    this.sun.position.copy(this.dir).multiplyScalar(900);
    this.sun.color.copy(u.uSunColor.value);
    this.sun.intensity = Math.max(lerp(a.sun, b.sun, k), lerp(a.moon, b.moon, k));

    const amb = lerp(a.amb, b.amb, k);
    this.scene.environmentIntensity = amb;
    this.hemi.intensity = 0.3 * amb;
    this.renderer.toneMappingExposure = CONFIG.view.exposure * lerp(a.exposure, b.exposure, k);

    // One number and one colour for the time of day, for anything that is painted in
    // flat colours and so cannot work it out from the lighting — the sea, mostly.
    this.level = Math.min(1, 0.3 + 0.7 * (this.sun.intensity / 3.1));
    // Only half the sun's colour: a flat blue multiplied by a warm noon sun stops being
    // blue, and the sea has to stay the sea.
    this.light = (this.light ?? new THREE.Color()).copy(this.sun.color).lerp(WHITE, 0.55).multiplyScalar(this.level);

    // Shaders compare the sun against view-space normals, so hand them that direction.
    if (camera) this.viewDir.copy(this.dir).transformDirection(camera.matrixWorldInverse);

    // The sky's own light is baked into a cube map. Re-bake it now and then; every
    // frame would be waste, since the sky barely moves between two of them.
    if (this.frames++ % D.rebakeEvery === 0) this.sky.rebake();
    this.t = t;
  }
}
