// The creatures as soft gumdrop blobs with eyes (hunters get angry brows),
// little poofs where a catch happens, and rings for the cursor and hands.

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { PREY, HUNTER } from '../creatures.js';
import { applyShading } from './shading.js';

export const COLOR_MODES = ['family', 'speed', 'vision'];

const MAX_PREY = 2500, MAX_HUNTERS = 400, POOF_BITS = 8, MAX_POOFS = 60;

// A gumdrop: wide soft bottom, rounded top. Unit height, ~0.5 radius, centred on the y axis.
function bodyGeometry() {
  const pts = [new THREE.Vector2(0, 0)];
  const steps = 18;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    let r = 0.5 * Math.pow(1 - Math.pow(t, 2.4), 0.55) * (1 + 0.14 * (1 - t));
    r *= 0.84 + 0.16 * Math.min(1, t / 0.07); // round off the bottom edge
    pts.push(new THREE.Vector2(r, t));
  }
  const g = new THREE.LatheGeometry(pts, 22);
  g.computeVertexNormals();
  return g;
}
const radiusAt = (t) => 0.5 * Math.pow(1 - Math.pow(t, 2.4), 0.55) * (1 + 0.14 * (1 - t));

const X_AXIS = new THREE.Vector3(1, 0, 0);
const EYE_T = 0.68, EYE_SIDE = 0.15, EYE_R = 0.085;
const EYE_FWD = radiusAt(EYE_T) - 0.02;

const unit = (kind, gene, v) => {
  const g = (kind === PREY ? CONFIG.prey : CONFIG.hunter).genes[gene];
  return Math.min(1, Math.max(0, (v - g.min) / (g.max - g.min)));
};

export class Blobs {
  constructor(scene, shade) {
    const body = bodyGeometry();
    const eye = new THREE.SphereGeometry(1, 12, 8);
    const brow = new THREE.BoxGeometry(1, 1, 1);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.2, metalness: 0 });
    const mk = (geo, mat, n, shadow) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.count = 0;
      m.castShadow = shadow;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
      return m;
    };
    const skin = (roughness) => applyShading(new THREE.MeshStandardMaterial({ roughness, metalness: 0 }), shade, { rim: true, clouds: true });
    this.prey = mk(body, skin(0.55), MAX_PREY, true);
    this.preyEyes = mk(eye, eyeMat, MAX_PREY * 2, false);
    this.hunters = mk(body, skin(0.5), MAX_HUNTERS, true);
    this.hunterEyes = mk(eye, eyeMat, MAX_HUNTERS * 2, false);

    // A drawn line round each creature: the same body, a shade bigger, inside out, so
    // all that shows of it is a rim where the real one ends.
    const O = CONFIG.view.outline;
    const inkMat = () => {
      const m = new THREE.MeshBasicMaterial({ color: CONFIG.palette.ink, side: THREE.BackSide, transparent: O.opacity < 1, opacity: O.opacity });
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uThickness = { value: O.thickness };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uThickness;')
          // The instance matrix scales the blob, so take that out: the line should be
          // the same weight on a newborn as on a grown hunter.
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat sc = max(length(instanceMatrix[0].xyz), 0.001);\ntransformed += normalize(normal) * (uThickness / sc);');
      };
      return m;
    };
    // Same instances as the bodies, so there is nothing extra to keep in step.
    this.preyInk = mk(body, inkMat(), MAX_PREY, false);
    this.preyInk.instanceMatrix = this.prey.instanceMatrix;
    this.hunterInk = mk(body, inkMat(), MAX_HUNTERS, false);
    this.hunterInk.instanceMatrix = this.hunters.instanceMatrix;
    this.brows = mk(brow, eyeMat, MAX_HUNTERS * 2, false);
    this.poofs = mk(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), POOF_BITS * MAX_POOFS, false);
    // Allocate per-instance colors.
    const white = new THREE.Color(1, 1, 1);
    this.prey.setColorAt(0, white);
    this.hunters.setColorAt(0, white);

    // Cursor rings (mouse hover + up to two hands).
    this.rings = [0, 1, 2].map(() => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.75, 1, 40).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xfffaf0, transparent: true, opacity: 0.85, depthTest: false }),
      );
      ring.renderOrder = 5;
      ring.visible = false;
      scene.add(ring);
      return ring;
    });

    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.q2 = new THREE.Quaternion();
    this.e = new THREE.Euler(0, 0, 0, 'YXZ');
    this.p = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.v = new THREE.Vector3();
    this.color = new THREE.Color();
    this.lastStep = 0;
  }

  colorOf(c, mode, out) {
    const panic = c.kind === PREY ? Math.min(1, c.alarm || 0) : 0;
    if (mode === 'family') {
      if (c.kind === PREY) return out.setHSL(c.hue / 360, 0.58, 0.62 + panic * 0.16);
      // Hunter family hues span 0–42°; squeeze them into reds.
      return out.setHSL(((350 + c.hue * 0.5) % 360) / 360, 0.82, c.digest > 0 ? 0.33 : 0.42);
    }
    const t = unit(c.kind, mode, c.genes[mode]);
    if (c.kind === PREY) return out.setHSL(0.56, 0.35 + t * 0.4, 0.32 + t * 0.48 + panic * 0.1);
    return out.setHSL((6 + t * 18) / 360, 0.75 + t * 0.2, 0.3 + t * 0.3);
  }

  // Where a creature's body sits in 3D (also used for picking).
  placement(c, world, out) {
    const V = CONFIG.view, VS = V.heightScale;
    const [, tall] = c.kind === PREY ? V.preySize : V.hunterSize;
    const ground = world.heightAt(c.x, c.y) * VS;
    const water = CONFIG.world.waterLevel * VS;
    let y = Math.max(ground, water - tall * 0.55); // swimmers float half-submerged
    if (c.held) y += 16;
    return out.set(c.x - world.width / 2, y, c.y - world.height / 2);
  }

  update(sim, { colorMode = 'family', cursors = [] } = {}) {
    const { world } = sim;
    const stepsPassed = Math.max(0, Math.min(16, sim.steps - this.lastStep));
    this.lastStep = sim.steps;
    this.fill(sim.prey, world, this.prey, this.preyEyes, null, colorMode, stepsPassed);
    this.fill(sim.hunters, world, this.hunters, this.hunterEyes, this.brows, colorMode, stepsPassed);
    this.preyInk.count = this.prey.count;
    this.hunterInk.count = this.hunters.count;
    this.updatePoofs(sim);
    this.updateRings(cursors);
  }

  fill(list, world, bodies, eyes, brows, mode, stepsPassed) {
    const { m, q, q2, e, p, s, v, color } = this;
    const n = Math.min(list.length, bodies.instanceMatrix.count);
    for (let i = 0; i < n; i++) {
      const c = list[i];
      const K = c.kind === PREY ? CONFIG.prey : CONFIG.hunter;
      const [wide, tall] = c.kind === PREY ? CONFIG.view.preySize : CONFIG.view.hunterSize;
      const speed = Math.hypot(c.vx, c.vy);
      const moving = Math.min(1, speed / 1.6);

      // Turn smoothly toward the direction of travel.
      if (speed > 0.05) {
        const target = -Math.atan2(c.vy, c.vx);
        if (c._yaw === undefined) c._yaw = target;
        let d = target - c._yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        c._yaw += d * Math.min(1, 0.2 * Math.max(1, stepsPassed));
      }
      c._yaw ??= 0;
      c._phase = (c._phase ?? Math.random() * 6) + speed * 0.16 * stepsPassed + (c.held ? 0.5 : 0);

      // Babies are small; everyone hops and squashes a little as they go.
      const grown = 0.6 + 0.4 * Math.min(1, c.age / K.maturity);
      const hop = Math.abs(Math.sin(c._phase)) * tall * 0.1 * moving;
      const squash = 1 + 0.07 * Math.cos(c._phase * 2) * moving;
      const W = wide * grown / Math.sqrt(squash), T = tall * grown * squash;

      this.placement(c, world, p);
      p.y += hop;
      e.set(0, c._yaw, -0.18 * moving);
      q.setFromEuler(e);
      s.set(W, T, W);
      bodies.setMatrixAt(i, m.compose(p, q, s));
      bodies.setColorAt(i, this.colorOf(c, mode, color));

      // Eyes: wide open when panicking.
      const eyeR = EYE_R * W * (1 + 0.45 * Math.min(1, c.alarm || 0));
      for (let side = 0; side < 2; side++) {
        v.set(EYE_FWD * W, EYE_T * T, (side ? 1 : -1) * EYE_SIDE * W).applyQuaternion(q).add(p);
        s.set(eyeR, eyeR, eyeR);
        eyes.setMatrixAt(i * 2 + side, m.compose(v, q, s));
        if (brows) {
          // Angry brows: tilted down toward the middle.
          q2.setFromAxisAngle(X_AXIS, (side ? -1 : 1) * 0.45);
          q2.premultiply(q);
          s.set(0.05 * W, 0.045 * W, 0.24 * W);
          v.set((EYE_FWD - 0.01) * W, (EYE_T + 0.11) * T, (side ? 1 : -1) * EYE_SIDE * W).applyQuaternion(q).add(p);
          brows.setMatrixAt(i * 2 + side, m.compose(v, q2, s));
        }
      }
    }
    bodies.count = n;
    eyes.count = n * 2;
    bodies.instanceMatrix.needsUpdate = true;
    bodies.instanceColor.needsUpdate = true;
    eyes.instanceMatrix.needsUpdate = true;
    if (brows) {
      brows.count = n * 2;
      brows.instanceMatrix.needsUpdate = true;
    }
  }

  // A catch: a small burst of white puffs that rise and fade.
  updatePoofs(sim) {
    const { m, p, s, q } = this;
    const VS = CONFIG.view.heightScale;
    q.identity();
    let n = 0;
    for (const k of sim.kills.slice(-MAX_POOFS)) {
      const age = sim.steps - k.step, life = age / 45;
      const y0 = Math.max(sim.world.heightAt(k.x, k.y), CONFIG.world.waterLevel) * VS + 4;
      for (let b = 0; b < POOF_BITS; b++) {
        const a = (b / POOF_BITS) * Math.PI * 2 + k.step;
        const r = 3 + age * 0.35;
        p.set(k.x - sim.world.width / 2 + Math.cos(a) * r, y0 + age * 0.25 + (b % 3), k.y - sim.world.height / 2 + Math.sin(a) * r);
        const size = 2.6 * (1 - life) * (0.7 + 0.3 * (b % 2));
        s.set(size, size, size);
        this.poofs.setMatrixAt(n++, m.compose(p, q, s));
      }
    }
    this.poofs.count = n;
    this.poofs.instanceMatrix.needsUpdate = true;
  }

  updateRings(cursors) {
    this.rings.forEach((ring, i) => {
      const c = cursors[i];
      ring.visible = !!c;
      if (!c) return;
      ring.position.set(c.x, c.y + 0.6, c.z);
      const r = c.pinching ? 7 : 13;
      ring.scale.set(r, 1, r);
      ring.material.opacity = c.pinching ? 1 : 0.75;
    });
  }
}
