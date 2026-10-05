// Wires the simulation to the 3D view, the mouse, the keyboard and the webcam.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Simulation, PREY, HUNTER } from './sim.js';
import { Stage } from './view/stage.js';
import { Land } from './view/land.js';
import { Ocean } from './view/water.js';
import { Blobs, COLOR_MODES } from './view/blobs.js';
import { Hud } from './hud.js';
import { HandTracker } from './hands.js';
import { Recorder } from './recorder.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.has('capture'); // stepped from outside, for rendering teasers
const $ = (sel) => document.querySelector(sel);
if (params.has('clean')) document.body.classList.add('clean');

const seed = params.has('seed') ? Number(params.get('seed')) >>> 0 : (Math.random() * 2 ** 32) >>> 0;
const sim = new Simulation({ width: CONFIG.world.width, height: CONFIG.world.height, seed });
const state = { paused: false, speed: 1, colorMode: 'family', showScent: true, follow: null };

const canvas = $('#stage');
let stage;
try {
  stage = new Stage(canvas, sim.world);
} catch (err) {
  $('#fatal').hidden = false;
  $('#fatal').textContent = `Sorry — this needs WebGL. (${err.message})`;
  throw err;
}
const land = new Land(stage.scene, sim.world);
const ocean = new Ocean(stage.scene, sim.world, stage.sky.uniforms);
const blobs = new Blobs(stage.scene);
stage.setWater(ocean);
const hud = new Hud($('#hud'));
window.addEventListener('resize', () => stage.resize());

// ---- Picking creatures up: mouse/touch and pinching hands share this ----

const tmp = new THREE.Vector3();

// The creature drawn closest to a screen point, within `radius` px.
function pickAt(sx, sy, radius) {
  let best = null, bestD = radius * radius;
  for (const c of sim.all()) {
    if (c.held || c.dead) continue;
    const tall = (c.kind === PREY ? CONFIG.view.preySize : CONFIG.view.hunterSize)[1];
    blobs.placement(c, sim.world, tmp);
    tmp.y += tall * 0.5;
    const p = stage.project(tmp);
    if (p.behind) continue;
    const d2 = (p.x - sx) ** 2 + (p.y - sy) ** 2;
    if (d2 < bestD) {
      bestD = d2;
      best = c;
    }
  }
  return best;
}

const grabs = new Map(); // id -> { held, history }

function grabStart(id, sx, sy, radius) {
  const held = pickAt(sx, sy, radius);
  if (!held) return false;
  held.held = true;
  held.vx = held.vy = 0;
  grabs.set(id, { held, history: [] });
  grabMove(id, sx, sy);
  return true;
}

function grabMove(id, sx, sy) {
  const g = grabs.get(id);
  if (!g) return;
  const hit = stage.groundAt(sx, sy, sim.world);
  if (!hit) return;
  const now = performance.now();
  g.history.push({ x: hit.x, y: hit.y, t: now });
  while (g.history.length > 2 && now - g.history[0].t > 120) g.history.shift();
  g.held.x = Math.min(sim.world.width - 2, Math.max(2, hit.x));
  g.held.y = Math.min(sim.world.height - 2, Math.max(2, hit.y));
}

// Let go with the hand's momentum, so creatures can be thrown.
function grabEnd(id) {
  const g = grabs.get(id);
  if (!g) return;
  grabs.delete(id);
  const h = g.history;
  let vx = 0, vy = 0;
  if (h.length > 1) {
    const a = h[0], b = h[h.length - 1];
    const dt = Math.max(16, b.t - a.t) / (1000 * CONFIG.step); // in simulation steps
    vx = (b.x - a.x) / dt;
    vy = (b.y - a.y) / dt;
    const sp = Math.hypot(vx, vy);
    if (sp > 12) {
      vx *= 12 / sp;
      vy *= 12 / sp;
    }
  }
  Object.assign(g.held, { held: false, vx, vy, flung: 40 });
}

// Pointer: pressing on a creature grabs it; anywhere else, the camera orbits.
let pointer = { x: innerWidth / 2, y: innerHeight / 2 };
let hover = null;
canvas.addEventListener(
  'pointerdown',
  (e) => {
    const radius = e.pointerType === 'touch' ? 34 : 20;
    if (grabStart(`p${e.pointerId}`, e.clientX, e.clientY, radius)) {
      stage.controls.enabled = false;
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add('grabbing');
    }
  },
  { capture: true },
);
canvas.addEventListener('pointermove', (e) => {
  pointer = { x: e.clientX, y: e.clientY };
  if (grabs.has(`p${e.pointerId}`)) grabMove(`p${e.pointerId}`, e.clientX, e.clientY);
  else if (e.buttons === 0) {
    hover = pickAt(e.clientX, e.clientY, 20);
    canvas.classList.toggle('can-grab', !!hover);
  }
});
const release = (e) => {
  if (!grabs.has(`p${e.pointerId}`)) return;
  grabEnd(`p${e.pointerId}`);
  stage.controls.enabled = true;
  canvas.classList.remove('grabbing');
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('pointerleave', () => (hover = null));

// ---- Hands ----

const hands = new HandTracker({
  video: $('#camera video'),
  overlay: $('#camera canvas'),
  onStatus: (msg) => ($('#camera .status').textContent = msg),
});
let handCursors = [];

async function toggleHands() {
  const btn = $('#btn-hands');
  if (hands.running) {
    hands.stop();
    for (const id of [...grabs.keys()]) if (id.startsWith('hand:')) grabEnd(id);
    handCursors = [];
    $('#camera').hidden = true;
    btn.setAttribute('aria-pressed', 'false');
    return;
  }
  $('#camera').hidden = false;
  btn.setAttribute('aria-pressed', 'true');
  try {
    await hands.start();
  } catch (err) {
    console.error(err);
    $('#camera .status').textContent = `Hand tracking unavailable: ${err.message}`;
    btn.setAttribute('aria-pressed', 'false');
  }
}

function updateHands(now) {
  if (!hands.running) return;
  const seen = new Set();
  handCursors = [];
  for (const h of hands.update(now)) {
    const id = `hand:${h.id}`, sx = h.x * innerWidth, sy = h.y * innerHeight;
    seen.add(id);
    if (h.pinching && !grabs.has(id)) grabStart(id, sx, sy, 45);
    else if (h.pinching) grabMove(id, sx, sy);
    else if (grabs.has(id)) grabEnd(id);
    const hit = stage.groundAt(sx, sy, sim.world);
    if (hit) handCursors.push({ x: hit.point.x, y: hit.point.y, z: hit.point.z, pinching: h.pinching });
  }
  for (const id of [...grabs.keys()]) if (id.startsWith('hand:') && !seen.has(id)) grabEnd(id);
}

// Rings under whatever the mouse is over or carrying, and under each hand.
function cursorRings() {
  const rings = [...handCursors];
  const target = [...grabs.entries()].find(([id]) => id.startsWith('p'))?.[1]?.held ?? hover;
  if (target && !target.dead) {
    blobs.placement(target, sim.world, tmp);
    const ground = Math.max(sim.world.heightAt(target.x, target.y), CONFIG.world.waterLevel) * CONFIG.view.heightScale;
    rings.unshift({ x: tmp.x, y: ground, z: tmp.z, pinching: target.held });
  }
  return rings;
}

// ---- Camera: follow a creature, or drift around the board ----

const follow = { offset: new THREE.Vector3() };
function setFollow(c, label) {
  state.follow = c;
  if (c) toast(label);
}
function cycleFollow() {
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  if (!state.follow) setFollow(pick(sim.hunters), 'following a hunter');
  else if (state.follow.kind === HUNTER && sim.prey.length) setFollow(pick(sim.prey), 'following a prey');
  else {
    setFollow(null);
    toast('free camera');
  }
}
function updateFollow() {
  let c = state.follow;
  if (!c) return;
  if (c.dead || !(c.kind === PREY ? sim.prey : sim.hunters).includes(c)) {
    // Our subject was eaten or died: follow the nearest of its kind instead.
    const list = c.kind === PREY ? sim.prey : sim.hunters;
    let best = null, bd = Infinity;
    for (const o of list) {
      const d = (o.x - c.x) ** 2 + (o.y - c.y) ** 2;
      if (d < bd) (bd = d), (best = o);
    }
    state.follow = c = best;
    if (!c) return;
  }
  // Glide the focus onto it and swoop in close, keeping the current viewing angle.
  blobs.placement(c, sim.world, tmp);
  const t = stage.controls.target, cam = stage.camera.position;
  follow.offset.subVectors(cam, t);
  const dist = follow.offset.length();
  follow.offset.multiplyScalar((dist + (FOLLOW_DISTANCE - dist) * 0.04) / dist);
  t.lerp(tmp, 0.08);
  cam.copy(t).add(follow.offset);
}
const FOLLOW_DISTANCE = 230;

// ---- Keyboard ----

const recorder = new Recorder(canvas, (on) => ($('#rec').hidden = !on));
const SPEEDS = [1, 2, 4, 8];

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 1400);
}

function spawn(kind) {
  const hit = stage.groundAt(pointer.x, pointer.y, sim.world) ?? { x: sim.world.width / 2, y: sim.world.height / 2 };
  if (kind === PREY) {
    for (let i = 0; i < 12; i++) sim.add(PREY, hit.x + (Math.random() - 0.5) * 30, hit.y + (Math.random() - 0.5) * 30);
    toast('12 prey wander in');
  } else {
    sim.add(HUNTER, hit.x, hit.y);
    toast('a hunter arrives');
  }
}

function toggleRules(show = $('#rules').hidden) {
  $('#rules').hidden = !show;
}

let landDirty = true;
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === ' ') {
    state.paused = !state.paused;
    toast(state.paused ? 'paused' : 'playing');
    e.preventDefault();
  } else if (k === 'f') {
    state.speed = SPEEDS[(SPEEDS.indexOf(state.speed) + 1) % SPEEDS.length];
    toast(`speed ${state.speed}×`);
  } else if (k === 'c') {
    state.colorMode = COLOR_MODES[(COLOR_MODES.indexOf(state.colorMode) + 1) % COLOR_MODES.length];
    toast(`color: ${state.colorMode}`);
  } else if (k === 't') {
    state.showScent = !state.showScent;
    landDirty = true;
    toast(state.showScent ? 'scent shown' : 'scent hidden');
  } else if (k === 'g') cycleFollow();
  else if (k === 'o') {
    stage.controls.autoRotate = !stage.controls.autoRotate;
    toast(stage.controls.autoRotate ? 'orbiting' : 'orbit off');
  } else if (k === '0') {
    setFollow(null);
    stage.home();
  } else if (k === '1') spawn(PREY);
  else if (k === '2') spawn(HUNTER);
  else if (k === 'h') toggleHands();
  else if (k === 'i') document.body.classList.toggle('hud-hidden');
  else if (k === '?' || k === '/') toggleRules();
  else if (k === 'escape') toggleRules(false);
  else if (k === 'r') {
    sim.reset(CONFIG.world.width, CONFIG.world.height, (Math.random() * 2 ** 32) >>> 0);
    state.follow = null;
    landDirty = true;
    toast('a new world');
  } else if (k === 'v') recorder.start(12, `common-ground-${sim.seed}`);
});

$('#btn-hands').addEventListener('click', toggleHands);
$('#btn-rules').addEventListener('click', () => toggleRules());
$('#rules-close').addEventListener('click', () => toggleRules(false));
$('#rules').addEventListener('click', (e) => e.target === $('#rules') && toggleRules(false));

// ---- Loop ----

let frameNo = 0, landStep = -1;
function render(forceLand = false) {
  // The ground changes slowly: reshape it every few frames.
  if (forceLand || landDirty || (frameNo % 3 === 0 && sim.steps !== landStep)) {
    land.update(sim.world, { showScent: state.showScent, time: sim.steps * CONFIG.step });
    ocean.syncDepth(sim.world);
    landStep = sim.steps;
    landDirty = false;
  }
  frameNo++;
  // The swell runs on simulation time, so a recording plays back the same every time.
  ocean.update(sim.steps * CONFIG.step, stage.camera);
  updateFollow();
  blobs.update(sim, { colorMode: state.colorMode, cursors: cursorRings() });
  stage.render();
}

let last = performance.now(), acc = 0, hudAt = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!state.paused) {
    acc += dt * state.speed;
    let n = 0;
    const max = state.speed * 2;
    while (acc >= CONFIG.step && n < max) {
      sim.step();
      acc -= CONFIG.step;
      n++;
    }
    if (n === max) acc = 0; // too slow to keep up: drop time rather than spiral
  }
  updateHands(now);
  render();
  if (now - hudAt > 250) {
    hud.update(sim, state);
    hudAt = now;
  }
  requestAnimationFrame(frame);
}

if (CAPTURE) {
  // Driven by a script: step the world, place the camera, draw, screenshot, repeat.
  stage.controls.enableDamping = false;
  window.commonGround = {
    sim,
    state,
    stage,
    config: CONFIG,
    step(n = 1) {
      for (let i = 0; i < n; i++) sim.step();
    },
    camera(position, target) {
      stage.camera.position.set(...position);
      stage.controls.target.set(...target);
    },
    follow(kind) {
      const list = kind === 'prey' ? sim.prey : sim.hunters;
      state.follow = list[Math.floor(list.length / 2)] ?? null;
    },
    render() {
      render(true);
      hud.update(sim, state);
    },
  };
  render(true);
  hud.update(sim, state);
} else {
  requestAnimationFrame(frame);
}
