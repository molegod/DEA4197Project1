// The ground: a grid of cells holding hill height, dug/piled dirt, grass,
// and two kinds of scent. Creatures read it and write to it; the board is drawn from it.

import { CONFIG } from './config.js';
import { terrainHeight, terrainOffset, islandMask } from './noise.js';

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Lush just above the water line, bare on the high ground.
function fertilityOf(h) {
  const w = CONFIG.world.waterLevel;
  if (h < w) return 0;
  const e = (h - w) / (1 - w);
  return smoothstep(0, 0.03, e) * (1 - smoothstep(0.2, 0.6, e));
}

export class World {
  constructor(width, height, seed) {
    this.seed = seed >>> 0;
    this.offset = terrainOffset(this.seed);
    this.time = 0;
    this.steps = 0;
    this.resize(width, height);
  }

  get terrainTime() {
    return this.time * CONFIG.world.drift;
  }

  resize(width, height) {
    const cell = CONFIG.world.cellSize;
    const gw = Math.ceil(width / cell) + 2;
    const gh = Math.ceil(height / cell) + 2;
    const old = this.gw ? this : null;
    const n = gw * gh;
    const next = {
      base: new Float32Array(n),
      fertility: new Float32Array(n),
      ground: new Float32Array(n),   // + dug out, − piled up
      grass: new Float32Array(n),
      preyScent: new Float32Array(n),
      hunterScent: new Float32Array(n),
    };
    // Keep whatever overlaps the old grid, so resizing the window doesn't wipe the paths.
    if (old) {
      const cw = Math.min(gw, old.gw), ch = Math.min(gh, old.gh);
      for (const key of ['ground', 'grass', 'preyScent', 'hunterScent']) {
        for (let j = 0; j < ch; j++) {
          next[key].set(old[key].subarray(j * old.gw, j * old.gw + cw), j * gw);
        }
      }
    }
    Object.assign(this, next);
    this.scratch = new Float32Array(n);
    // The island's outline never changes, so work it out once.
    this.island = new Float32Array(n);
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        this.island[j * gw + i] = islandMask((i * cell) / width * 2 - 1, (j * cell) / height * 2 - 1, this.seed);
      }
    }
    this.width = width;
    this.height = height;
    this.gw = gw;
    this.gh = gh;
    this.cell = cell;
    this.nextRow = 0;
    this.refreshRows(0, gh);
    if (!old) for (let k = 0; k < n; k++) this.grass[k] = this.fertility[k] * 0.7;

    // How much of the board is dry land. Populations are sized from this, so a
    // small island holds fewer creatures than a big one.
    let land = 0;
    for (let k = 0; k < n; k++) if (this.base[k] >= CONFIG.world.waterLevel) land++;
    this.landFraction = land / n;
    this.landArea = width * height * this.landFraction;
  }

  // Recompute the hill heights for a band of rows at the current time.
  refreshRows(from, to) {
    const { cell, gw, seed, base, fertility, island } = this;
    const s = CONFIG.world.noiseScale;
    const t = this.terrainTime;
    const SEA = CONFIG.world.seabed;
    const [ox, oy] = this.offset;
    for (let j = from; j < to; j++) {
      for (let i = 0; i < gw; i++) {
        const k = j * gw + i;
        // The hills, faded out into the sea bed toward the coast.
        const h = terrainHeight(ox + i * cell * s, oy + j * cell * s, t, seed);
        base[k] = SEA + (h - SEA) * island[k];
        fertility[k] = fertilityOf(base[k]);
      }
    }
  }

  step() {
    const C = CONFIG;
    this.time += C.step;
    this.steps++;

    // The hills drift: refresh a few rows each step so the whole map updates every refreshSeconds.
    const rows = Math.ceil(this.gh / (C.world.refreshSeconds / C.step));
    const from = this.nextRow;
    const to = Math.min(this.gh, from + rows);
    this.refreshRows(from, to);
    this.nextRow = to >= this.gh ? 0 : to;

    const { ground, grass, fertility, preyScent, hunterScent } = this;
    const G = C.grass, D = C.dirt;
    const heal = 1 - D.heal;
    const pf = C.scent.preyFade, hf = C.scent.hunterFade;
    for (let k = 0, n = ground.length; k < n; k++) {
      const f = fertility[k];
      let g = grass[k];
      if (f > 0) {
        const disturbed = Math.min(1, Math.max(0, Math.abs(ground[k]) - G.trample) * G.disturbance);
        g += G.growth * f * (G.sprout + g) * (1 - g) * (1 - disturbed);
      } else {
        g *= 0.995;
      }
      grass[k] = g;
      ground[k] *= heal;
      preyScent[k] *= pf;
      hunterScent[k] *= hf;
    }

    // Loose dirt slumps and scent spreads, every few steps to save time.
    if (this.steps % 3 === 0) {
      this.diffuse(ground, D.slump * 3);
      this.diffuse(preyScent, C.scent.spread * 3);
      this.diffuse(hunterScent, C.scent.spread * 3);
    }
  }

  diffuse(field, rate) {
    const { gw, gh, scratch } = this;
    for (let j = 0; j < gh; j++) {
      const up = j > 0 ? -gw : 0, down = j < gh - 1 ? gw : 0;
      for (let i = 0; i < gw; i++) {
        const k = j * gw + i;
        const left = i > 0 ? -1 : 0, right = i < gw - 1 ? 1 : 0;
        const v = field[k];
        scratch[k] = v + rate * 0.25 * (field[k + left] + field[k + right] + field[k + up] + field[k + down] - 4 * v);
      }
    }
    field.set(scratch);
  }

  // ---- sampling helpers used by the creatures ----

  index(x, y) {
    const i = Math.min(this.gw - 1, Math.max(0, Math.round(x / this.cell)));
    const j = Math.min(this.gh - 1, Math.max(0, Math.round(y / this.cell)));
    return j * this.gw + i;
  }

  // Ground height where water counts as a steep rise, so it feels like "uphill".
  feltHeightAt(k) {
    const w = CONFIG.world.waterLevel;
    const h = this.base[k] - this.ground[k] * CONFIG.dirt.depth;
    return h < w ? w + (w - h) * CONFIG.land.waterWall : h;
  }

  // Standing within a few px of the water line?
  atShore(x, y) {
    const k = this.index(x, y);
    return this.base[k] - this.ground[k] * CONFIG.dirt.depth < CONFIG.world.waterLevel + 0.012;
  }

  isWater(k) {
    return this.base[k] - this.ground[k] * CONFIG.dirt.depth < CONFIG.world.waterLevel;
  }

  // Bilinear sample of the actual ground height (hills minus dug dirt), for drawing.
  heightAt(x, y) {
    const { gw, gh, cell, base, ground } = this;
    const D = CONFIG.dirt.depth;
    const fx = Math.min(gw - 1.001, Math.max(0, x / cell));
    const fy = Math.min(gh - 1.001, Math.max(0, y / cell));
    const i = Math.floor(fx), j = Math.floor(fy);
    const tx = fx - i, ty = fy - j;
    const k = j * gw + i;
    const a = base[k] - ground[k] * D, b = base[k + 1] - ground[k + 1] * D;
    const c = base[k + gw] - ground[k + gw] * D, d = base[k + gw + 1] - ground[k + gw + 1] * D;
    const ab = a + (b - a) * tx, cd = c + (d - c) * tx;
    return ab + (cd - ab) * ty;
  }

  // Bilinear sample of felt height at a point.
  feltHeight(x, y) {
    const { gw, gh, cell } = this;
    const fx = Math.min(gw - 1.001, Math.max(0, x / cell));
    const fy = Math.min(gh - 1.001, Math.max(0, y / cell));
    const i = Math.floor(fx), j = Math.floor(fy);
    const tx = fx - i, ty = fy - j;
    const k = j * gw + i;
    const a = this.feltHeightAt(k), b = this.feltHeightAt(k + 1);
    const c = this.feltHeightAt(k + gw), d = this.feltHeightAt(k + gw + 1);
    const ab = a + (b - a) * tx, cd = c + (d - c) * tx;
    return ab + (cd - ab) * ty;
  }

  // Gradient of felt height (height gained per px), written into `out`.
  slope(x, y, out) {
    const e = this.cell;
    out.x = (this.feltHeight(x + e, y) - this.feltHeight(x - e, y)) / (2 * e);
    out.y = (this.feltHeight(x, y + e) - this.feltHeight(x, y - e)) / (2 * e);
    return out;
  }

  // Spread `amount` over the four cells around (x, y).
  splat(field, x, y, amount) {
    const { gw, gh, cell } = this;
    const fx = Math.min(gw - 1.001, Math.max(0, x / cell));
    const fy = Math.min(gh - 1.001, Math.max(0, y / cell));
    const i = Math.floor(fx), j = Math.floor(fy);
    const tx = fx - i, ty = fy - j;
    const k = j * gw + i;
    field[k] += amount * (1 - tx) * (1 - ty);
    field[k + 1] += amount * tx * (1 - ty);
    field[k + gw] += amount * (1 - tx) * ty;
    field[k + gw + 1] += amount * tx * ty;
  }

  // Dig (positive) or pile (negative) dirt, within limits.
  dig(x, y, amount) {
    const k = this.index(x, y);
    const g = this.ground[k];
    const D = CONFIG.dirt;
    if (amount > 0 && g > D.maxDig) return 0;
    if (amount < 0 && g < -D.maxBuild) return 0;
    this.splat(this.ground, x, y, amount);
    return amount;
  }
}
