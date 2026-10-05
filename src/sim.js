// The whole ecosystem, with no drawing and no DOM, so it can also run headless.

import { CONFIG } from './config.js';
import { makeRandom } from './random.js';
import { World } from './world.js';
import { SpatialGrid } from './spatial.js';
import { Creature, PREY, HUNTER, randomGenes, mutate } from './creatures.js';

export { PREY, HUNTER };

export class Simulation {
  constructor({ width, height, seed = (Math.random() * 2 ** 32) >>> 0 }) {
    this.preyGrid = new SpatialGrid(45);
    this.hunterGrid = new SpatialGrid(90);
    this.reset(width, height, seed);
  }

  reset(width, height, seed) {
    this.seed = seed >>> 0;
    this.rand = makeRandom(this.seed ^ 0x9e3779b9);
    this.world = new World(width, height, this.seed);
    this.prey = [];
    this.hunters = [];
    this.kills = []; // recent catches, for the flash effect
    this.steps = 0;
    this.stats = { samples: [], births: 0, catches: 0, misses: 0, starved: [0, 0], oldAge: [0, 0] };
    this.genesAtStart = null;

    const P = CONFIG.population;
    const preyCount = Math.round(this.world.landArea * P.preyPerArea);
    const hunterCount = Math.max(P.minHunters, Math.round(preyCount * P.huntersPerPrey));

    // Prey start in a few herds on grassy ground; hunters anywhere dry.
    const herds = 6;
    for (let h = 0; h < herds; h++) {
      const [hx, hy] = this.findSpot((k) => this.world.fertility[k] > 0.5);
      for (let i = 0; i < preyCount / herds; i++) {
        const a = this.rand() * Math.PI * 2, r = Math.sqrt(this.rand()) * 60;
        const c = this.add(PREY, hx + Math.cos(a) * r, hy + Math.sin(a) * r);
        c.age = Math.floor(this.rand() * CONFIG.prey.maturity * 1.5);
        c.readyAt = c.age + this.rand() * CONFIG.prey.gestation;
        c.energy = this.rand.range(0.3, 0.7);
      }
    }
    for (let i = 0; i < hunterCount; i++) this.add(HUNTER, ...this.findSpot((k) => !this.world.isWater(k)));

    this.genesAtStart = this.averageGenes();
    this.record();
  }

  resize(width, height) {
    this.world.resize(width, height);
    for (const c of this.all()) {
      c.x = Math.min(width - 2, c.x);
      c.y = Math.min(height - 2, c.y);
    }
  }

  get width() {
    return this.world.width;
  }

  get height() {
    return this.world.height;
  }

  *all() {
    yield* this.prey;
    yield* this.hunters;
  }

  findSpot(ok, tries = 200) {
    const { width, height } = this.world;
    for (let t = 0; t < tries; t++) {
      const x = this.rand.range(60, width - 60), y = this.rand.range(60, height - 60);
      if (ok(this.world.index(x, y))) return [x, y];
    }
    return [width / 2, height / 2];
  }

  add(kind, x, y, genes = randomGenes(kind, this.rand), parent = null) {
    const c = new Creature(kind, x, y, genes, this.rand, parent);
    (kind === PREY ? this.prey : this.hunters).push(c);
    return c;
  }

  caps() {
    const land = this.world.landArea;
    return {
      prey: Math.round(land * CONFIG.population.preyCapPerArea),
      hunters: Math.max(4, Math.round(land * CONFIG.population.hunterCapPerArea)),
    };
  }

  attemptCatch(hunter, prey) {
    const K = CONFIG.hunter;
    hunter.cooldown = K.lungeCooldown;
    // Confusion: a lunge into a crowd often misses.
    let crowd = 0;
    const r2 = K.confusionRadius * K.confusionRadius;
    this.preyGrid.forEachNear(prey.x, prey.y, K.confusionRadius, (o) => {
      if (o === prey || o.dead) return;
      const dx = o.x - prey.x, dy = o.y - prey.y;
      if (dx * dx + dy * dy < r2) crowd++;
    });
    if (this.rand() < 1 / (1 + K.confusion * crowd)) {
      prey.dead = true;
      hunter.energy = Math.min(K.maxEnergy, hunter.energy + K.mealEnergy);
      hunter.digest = K.digestTime;
      this.kills.push({ x: prey.x, y: prey.y, step: this.steps });
      this.stats.catches++;
    } else {
      this.stats.misses++;
    }
  }

  step() {
    const { world, rand } = this;
    this.steps++;
    const width = world.width, height = world.height;
    this.preyGrid.rebuild(this.prey, width, height);
    this.hunterGrid.rebuild(this.hunters, width, height);

    for (const c of this.prey) if (!c.held && !c.dead) c.thinkPrey(this);
    for (const c of this.hunters) if (!c.held) c.thinkHunter(this);
    for (const c of this.prey) {
      if (c.held || c.dead) continue;
      c.move(this);
      c.eat(world);
    }
    for (const c of this.hunters) if (!c.held) c.move(this);

    const caps = this.caps();
    this.prey = this.lifeAndDeath(this.prey, PREY, caps.prey);
    this.hunters = this.lifeAndDeath(this.hunters, HUNTER, caps.hunters);
    this.immigrate();

    world.step();
    this.kills = this.kills.filter((k) => this.steps - k.step < 45);
    if (this.steps % CONFIG.statsEvery === 0) this.record();
  }

  // Starve, grow old, or split in two with slightly mutated genes.
  lifeAndDeath(list, kind, cap) {
    const K = kind === PREY ? CONFIG.prey : CONFIG.hunter;
    const survivors = [];
    let count = list.length;
    for (const c of list) {
      if (!c.held && (c.dead || c.energy <= 0 || c.age > c.lifespan)) {
        this.world.dig(c.x, c.y, -c.dirt); // whatever it carried falls where it dies
        if (!c.dead) this.stats[c.energy <= 0 ? 'starved' : 'oldAge'][kind]++;
        count--;
        continue;
      }
      survivors.push(c);
      if (!c.held && c.energy >= K.birthEnergy && c.age > c.readyAt && count < cap) {
        c.energy *= 0.5;
        c.readyAt = c.age + K.gestation;
        const child = new Creature(kind, c.x + this.rand.range(-3, 3), c.y + this.rand.range(-3, 3), mutate(kind, c.genes, this.rand), this.rand, c);
        child.energy = c.energy * 0.9;
        child.vx = c.vx;
        child.vy = c.vy;
        survivors.push(child);
        this.stats.births++;
        count++;
      }
    }
    return survivors;
  }

  // The map isn't closed: when a species is nearly gone, a few wanderers arrive from the edge.
  immigrate() {
    const P = CONFIG.population;
    if (this.steps % P.immigrationEvery !== 0) return;
    // Wanderers come ashore: pick a point out at sea and walk inland to the first dry ground.
    const edge = () => {
      const { width, height } = this.world;
      const side = Math.floor(this.rand() * 4);
      const t = this.rand();
      let [x, y] = side === 0 ? [30, t * height] : side === 1 ? [width - 30, t * height] : side === 2 ? [t * width, 30] : [t * width, height - 30];
      const dx = (width / 2 - x) / 60, dy = (height / 2 - y) / 60;
      for (let i = 0; i < 60 && this.world.isWater(this.world.index(x, y)); i++) {
        x += dx;
        y += dy;
      }
      return [x, y];
    };
    if (this.prey.length < P.minPrey) {
      const [x, y] = edge();
      for (let i = 0; i < 6; i++) this.add(PREY, x + this.rand.range(-10, 10), y + this.rand.range(-10, 10));
    }
    if (this.hunters.length < P.minHunters) this.add(HUNTER, ...edge());
  }

  averageGenes() {
    const avg = (list) => {
      if (!list.length) return null;
      const out = {};
      for (const key of Object.keys(list[0].genes)) out[key] = list.reduce((s, c) => s + c.genes[key], 0) / list.length;
      return out;
    };
    return { prey: avg(this.prey), hunters: avg(this.hunters) };
  }

  record() {
    const s = this.stats.samples;
    const genes = this.averageGenes();
    const maxGen = (list) => list.reduce((m, c) => Math.max(m, c.generation), 0);
    s.push({
      step: this.steps,
      prey: this.prey.length,
      hunters: this.hunters.length,
      genes,
      preyGen: maxGen(this.prey),
      hunterGen: maxGen(this.hunters),
    });
    if (s.length > CONFIG.statsLength) s.shift();
  }

  // Nearest creature to a point, for grabbing. Hunters win ties within a few px.
  nearest(x, y, radius) {
    let best = null, bestD = radius * radius;
    for (const c of this.all()) {
      if (c.held || c.dead) continue;
      const dx = c.x - x, dy = c.y - y;
      const d2 = dx * dx + dy * dy - (c.kind === HUNTER ? 64 : 0);
      if (d2 < bestD) {
        bestD = d2;
        best = c;
      }
    }
    return best;
  }
}
