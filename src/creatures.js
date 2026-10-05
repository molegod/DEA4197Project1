// Prey and hunters. Each creature follows a handful of local rules; nothing
// here knows about herds, paths, or the population as a whole.

import { CONFIG } from './config.js';

export const PREY = 0;
export const HUNTER = 1;

const kindConfig = (kind) => (kind === PREY ? CONFIG.prey : CONFIG.hunter);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const SLOPE = { x: 0, y: 0 };

// Hue ranges keep the two species apart: prey cool, hunters warm.
export const HUE_RANGE = { [PREY]: [165, 320], [HUNTER]: [0, 42] };

let nextId = 1;

export function randomGenes(kind, rand, spread = 0.15) {
  const genes = {};
  for (const [name, g] of Object.entries(kindConfig(kind).genes)) {
    genes[name] = clamp(g.start + rand.gauss() * spread * (g.max - g.min), g.min, g.max);
  }
  return genes;
}

export function mutate(kind, genes, rand) {
  const K = kindConfig(kind);
  const child = {};
  for (const [name, g] of Object.entries(K.genes)) {
    child[name] = clamp(genes[name] + rand.gauss() * K.mutation * (g.max - g.min), g.min, g.max);
  }
  return child;
}

function driftHue(kind, hue, rand) {
  const [lo, hi] = HUE_RANGE[kind];
  let h = hue + rand.gauss() * 3;
  if (h < lo) h = 2 * lo - h;
  if (h > hi) h = 2 * hi - h;
  return clamp(h, lo, hi);
}

export class Creature {
  constructor(kind, x, y, genes, rand, parent = null) {
    const K = kindConfig(kind);
    this.id = nextId++;
    this.kind = kind;
    this.x = x;
    this.y = y;
    const a = rand() * Math.PI * 2;
    this.vx = Math.cos(a) * genes.speed * 0.5;
    this.vy = Math.sin(a) * genes.speed * 0.5;
    this.ax = 0;
    this.ay = 0;
    this.genes = genes;
    this.energy = kind === PREY ? 0.5 : 1;
    this.age = 0;
    this.lifespan = rand.range(K.lifespan[0], K.lifespan[1]);
    this.readyAt = K.maturity; // age at which it can next give birth
    this.dirt = 0;
    this.alarm = 0;
    this.thirst = rand();
    this.cooldown = 0;
    this.digest = 0;
    this.flung = 0;
    this.held = false;
    this.dead = false;
    this.generation = parent ? parent.generation + 1 : 0;
    const [lo, hi] = HUE_RANGE[kind];
    this.hue = parent ? driftHue(kind, parent.hue, rand) : rand.range(lo, hi);
  }

  get config() {
    return kindConfig(this.kind);
  }

  // Reynolds steering: turn toward a direction, limited by how hard it can turn.
  steer(dx, dy, weight, speed = this.genes.speed) {
    const len = Math.hypot(dx, dy);
    if (len < 1e-9 || weight <= 0) return;
    let sx = (dx / len) * speed - this.vx;
    let sy = (dy / len) * speed - this.vy;
    const m = Math.hypot(sx, sy), f = this.config.maxForce;
    if (m > f) {
      sx *= f / m;
      sy *= f / m;
    }
    this.ax += sx * weight;
    this.ay += sy * weight;
  }

  // Look a short way ahead: left, straight, right. Turn toward the best-scoring spot
  // (a coin flip decides between left and right when they tie).
  sense(world, score, weight, rand) {
    const K = this.config;
    const heading = Math.atan2(this.vy, this.vx);
    let best = -Infinity, bestAngle = heading, ahead = 0;
    const flip = rand() < 0.5 ? 1 : -1;
    for (let i = -1; i <= 1; i++) {
      const s = i * flip;
      const a = heading + s * K.sensorAngle;
      const sx = this.x + Math.cos(a) * K.sensorDistance, sy = this.y + Math.sin(a) * K.sensorDistance;
      const offMap = sx < 30 || sy < 30 || sx > world.width - 30 || sy > world.height - 30;
      const v = offMap ? -1 : score(world.index(sx, sy));
      if (s === 0) ahead = v;
      if (v > best) {
        best = v;
        bestAngle = a;
      }
    }
    if (best > ahead) this.steer(Math.cos(bestAngle), Math.sin(bestAngle), weight * Math.min(1, (best - ahead) * 8));
  }

  wander(rand, amount) {
    this.ax += (rand() - 0.5) * amount * 2;
    this.ay += (rand() - 0.5) * amount * 2;
  }

  // Near the edge of the map, turn back toward the middle (turning to run along
  // the edge instead would wear a lane around the border).
  avoidEdges(world) {
    const m = 45;
    const depth = Math.max(m - this.x, m - this.y, this.x - (world.width - m), this.y - (world.height - m));
    if (depth > 0) this.steer(world.width / 2 - this.x, world.height / 2 - this.y, 1 + (2 * depth) / m);
  }

  // ---- Prey: stay with the flock, don't crowd, match heading, flee hunters, find grass ----
  thinkPrey(sim) {
    const g = this.genes, K = CONFIG.prey, world = sim.world;
    const r = Math.min(g.vision, K.flockRadius), r2 = r * r, sep2 = K.separation * K.separation;
    let n = 0, cx = 0, cy = 0, avx = 0, avy = 0, sx = 0, sy = 0, nearAlarm = 0;
    sim.preyGrid.forEachNear(this.x, this.y, r, (o) => {
      if (o === this) return;
      const dx = o.x - this.x, dy = o.y - this.y, d2 = dx * dx + dy * dy;
      if (d2 > r2 || d2 === 0) return;
      if (d2 < sep2) {
        sx -= dx / d2;
        sy -= dy / d2;
      }
      if (o.alarm > nearAlarm) nearAlarm = o.alarm;
      n++;
      cx += dx;
      cy += dy;
      avx += o.vx;
      avy += o.vy;
    });
    if (n > 0) {
      this.steer(avx, avy, g.alignment);
      this.steer(cx, cy, g.cohesion);
    }
    if (sx !== 0 || sy !== 0) this.steer(sx, sy, K.separationWeight);

    // Hunters in view: run the other way, harder the closer they are.
    const range = g.vision * K.threatRange;
    let fx = 0, fy = 0, threat = 0;
    const flee = (h) => {
      const dx = h.x - this.x, dy = h.y - this.y, d = Math.hypot(dx, dy);
      if (d > range || d === 0) return;
      const w = 1 - d / range;
      fx -= (dx / d) * w;
      fy -= (dy / d) * w;
      threat = Math.max(threat, w);
    };
    sim.hunterGrid.forEachNear(this.x, this.y, range, flee);
    if (threat > 0) this.steer(fx, fy, g.fear * (0.4 + threat));

    // Panic is contagious: a panicking neighbour makes you bolt with the herd,
    // even if you can't see the hunter yourself.
    this.alarm = Math.max(threat, nearAlarm * K.alarmRelay);
    if (threat === 0 && this.alarm > 0.05 && n > 0) this.steer(avx, avy, g.fear * this.alarm);

    // Look ahead: toward grass when hungry, along worn paths when fed, downhill when
    // thirsty, and always away from hunter scent and from wading into water.
    const hunger = 1 - clamp(this.energy / K.birthEnergy, 0, 1);
    const thirsty = this.thirst > K.thirsty;
    const grassW = hunger * K.grassSeek * (thirsty ? 0.3 : 1), pathW = (1 - hunger) * K.pathing;
    const drinkW = thirsty ? K.drinkSeek : 0;
    this.sense(
      world,
      (k) =>
        world.grass[k] * grassW +
        (Math.min(1, Math.max(0, world.ground[k]) * K.trailGain) + Math.min(1, world.preyScent[k]) * K.followTracks) * pathW -
        world.feltHeightAt(k) * drinkW -
        world.hunterScent[k] * g.wariness -
        (world.isWater(k) ? 1 : 0),
      1,
      sim.rand,
    );

    // Drink at the shore.
    this.thirst += K.thirstRate;
    if (thirsty && world.atShore(this.x, this.y)) this.thirst = 0;

    // Graze: slow down on good grass when hungry.
    const here = world.index(this.x, this.y);
    if (hunger > 0.25 && world.grass[here] > 0.3 && this.alarm < 0.05) {
      this.ax -= this.vx * 0.06;
      this.ay -= this.vy * 0.06;
    }

    this.wander(sim.rand, K.wander);
  }

  // ---- Hunters: keep apart, chase the nearest visible prey, else follow fresh tracks ----
  thinkHunter(sim) {
    const g = this.genes, K = CONFIG.hunter, world = sim.world;
    let sx = 0, sy = 0;
    const space2 = K.personalSpace * K.personalSpace;
    sim.hunterGrid.forEachNear(this.x, this.y, K.personalSpace, (o) => {
      if (o === this) return;
      const dx = o.x - this.x, dy = o.y - this.y, d2 = dx * dx + dy * dy;
      if (d2 > space2 || d2 === 0) return;
      sx -= dx / d2;
      sy -= dy / d2;
    });
    if (sx !== 0 || sy !== 0) this.steer(sx, sy, K.spaceWeight);

    // Tall grass hides prey: they can only be spotted from closer up.
    let target = null, best = Infinity;
    if (this.digest <= 0) {
      sim.preyGrid.forEachNear(this.x, this.y, g.vision, (o) => {
        if (o.held || o.dead) return;
        const dx = o.x - this.x, dy = o.y - this.y, d2 = dx * dx + dy * dy;
        const seen = g.vision * (1 - K.grassCover * world.grass[world.index(o.x, o.y)]);
        if (d2 < seen * seen && d2 < best) {
          best = d2;
          target = o;
        }
      });
    }

    if (target) {
      const d = Math.sqrt(best);
      const lead = Math.min(20, d / Math.max(1, g.speed)) * 0.5;
      this.steer(target.x + target.vx * lead - this.x, target.y + target.vy * lead - this.y, 1.5);
      if (d < K.catchRadius && this.cooldown <= 0) sim.attemptCatch(this, target);
    } else {
      this.sense(
        world,
        (k) => world.preyScent[k] * g.tracking + Math.max(0, world.ground[k]) * K.pathing - (world.isWater(k) ? 1 : 0),
        1,
        sim.rand,
      );
      this.wander(sim.rand, K.wander);
    }
  }

  // ---- Shared: the land decides how fast you can go; moving costs energy and moves dirt ----
  move(sim) {
    const K = this.config, world = sim.world, L = CONFIG.land;
    this.avoidEdges(world);

    // Lower ground pulls you in. Water counts as high ground, so swimmers get pushed ashore.
    const k = world.index(this.x, this.y);
    const swimming = world.isWater(k);
    const pull = L.pull * (swimming ? L.swimPull : 1);
    world.slope(this.x, this.y, SLOPE);
    this.ax -= SLOPE.x * pull;
    this.ay -= SLOPE.y * pull;

    this.vx += this.ax;
    this.vy += this.ay;
    this.ax = 0;
    this.ay = 0;

    let speed = Math.hypot(this.vx, this.vy);
    const climb = speed > 1e-6 ? (this.vx * SLOPE.x + this.vy * SLOPE.y) / speed : 0;
    let limit = this.genes.speed * clamp(1 - climb * L.climbPenalty, 0.3, 1.3) * (1 - L.grassDrag * world.grass[k]);
    if (swimming) limit *= L.swimSpeed;
    if (this.digest > 0) limit *= 0.55;
    if (this.flung > 0) {
      limit = Math.max(limit, speed * 0.97);
      this.flung--;
    }
    if (speed > limit) {
      this.vx *= limit / speed;
      this.vy *= limit / speed;
      speed = limit;
    }

    this.x = clamp(this.x + this.vx, 1, world.width - 1);
    this.y = clamp(this.y + this.vy, 1, world.height - 1);

    this.energy -=
      K.baseBurn +
      K.moveCost * speed * speed +
      K.visionCost * this.genes.vision +
      Math.max(0, climb) * speed * K.climbCost;
    this.age++;
    if (this.cooldown > 0) this.cooldown--;
    if (this.digest > 0) this.digest--;

    this.moveDirt(world, speed, climb, sim.rand);
    world.splat(this.kind === PREY ? world.preyScent : world.hunterScent, this.x, this.y, K.scent);
  }

  // The erosion rule, borrowed from water: moving fast (especially downhill) picks up dirt;
  // a little of the load is kicked off to the side as you go; slowing down drops the rest.
  // Busy routes become grooves with banks; places where creatures stop get mounds.
  moveDirt(world, speed, climb, rand) {
    const D = CONFIG.dirt;
    if (this.dirt > 0 && speed > 0.1) {
      const kicked = this.dirt * D.kick;
      const side = (rand() < 0.5 ? -1 : 1) * rand.range(D.kickDistance[0], D.kickDistance[1]);
      this.dirt += world.dig(this.x - (this.vy / speed) * side, this.y + (this.vx / speed) * side, -kicked);
    }
    const downhill = clamp(-climb / D.slopeRef, 0, 3);
    const capacity = this.config.carry * speed * (1 + downhill);
    if (this.dirt < capacity) {
      this.dirt += world.dig(this.x, this.y, (capacity - this.dirt) * D.pickup);
    } else {
      this.dirt += world.dig(this.x, this.y, -(this.dirt - capacity) * D.drop);
    }
  }

  eat(world) {
    const K = CONFIG.prey;
    if (this.energy >= K.full) return;
    const k = world.index(this.x, this.y);
    const bite = Math.min(world.grass[k], K.bite);
    world.grass[k] -= bite;
    this.energy += bite * K.grassEnergy;
  }
}
