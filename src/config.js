// Every tunable number in the simulation lives here.
// Rates are per simulation step; one step is 1/60 of a second.

export const CONFIG = {
  step: 1 / 60,

  world: {
    width: 1300,          // size of the board, in simulation units (multiples of cellSize)
    height: 860,          // the island sits in the middle of it, the rest is open sea
    cellSize: 6,          // units per cell of the ground grid (grass, dirt, scent)
    noiseScale: 1 / 460,  // size of the hills; smaller = broader hills
    drift: 0.01,          // how fast the hills reshape themselves (noise units / second)
    waterLevel: 0.36,     // ground lower than this is water
    seabed: 0.02,         // height the land falls away to out at sea
    refreshSeconds: 1.5,  // the CPU copy of the hills is recomputed over this long
  },

  // How the moving creatures reshape the ground (the erosion rule).
  dirt: {
    depth: 0.05,          // how far one unit of dug dirt lowers the ground
    maxDig: 1.2,          // deepest a groove can get
    maxBuild: 1.2,        // tallest a mound can get
    pickup: 0.12,         // fraction of spare carrying room filled per step when speeding up
    drop: 0.08,           // fraction of excess load dropped per step when slowing down
    kick: 0.015,          // fraction of the load flung aside each step, so steady walkers keep digging
    kickDistance: [6, 16],// how far to the side it lands (px)
    slopeRef: 0.004,      // a downhill grade this steep doubles carrying capacity
    heal: 0.00007,        // weathering: grooves and mounds slowly relax back to flat
    slump: 0.002,         // loose dirt slides into neighbouring cells, softening paths
  },

  // Movement costs imposed by the land.
  land: {
    pull: 1.5,            // lower ground pulls walkers toward it
    climbPenalty: 110,    // how much uphill cuts top speed
    grassDrag: 0.3,       // thick grass cuts top speed by this fraction
    waterWall: 2.5,       // water counts as uphill: this much "height" per unit of depth
    swimPull: 8,          // in water, the pull back to shore is this many times stronger
    swimSpeed: 0.5,       // top speed multiplier while swimming
  },

  grass: {
    growth: 0.0015,       // regrowth rate on the most fertile ground
    sprout: 0.15,         // lets bare ground re-seed itself
    trample: 0.05,        // dirt moved less than this doesn't bother the grass
    disturbance: 1.5,     // beyond that, dug or piled dirt slows regrowth
  },

  scent: {
    preyFade: 0.9975,     // prey tracks fade in a few seconds
    hunterFade: 0.9993,   // hunter scent lingers much longer
    spread: 0.05,         // how quickly scent diffuses into neighbouring cells
  },

  prey: {
    genes: {
      speed:     { min: 0.9, max: 3.6, start: 1.7 },
      vision:    { min: 16,  max: 90,  start: 36 },
      cohesion:  { min: 0,   max: 1.5, start: 0.45 },
      alignment: { min: 0,   max: 1.5, start: 0.55 },
      fear:      { min: 0,   max: 3,   start: 1.3 },
      wariness:  { min: 0,   max: 2,   start: 0.5 },
    },
    size: 6,
    maxForce: 0.07,
    flockRadius: 40,      // flockmates within this distance count (vision is for spotting hunters)
    separation: 9,        // personal space in px
    separationWeight: 1.8,
    threatRange: 1.3,     // hunters are noticed at vision × this
    sensorDistance: 16,
    sensorAngle: 0.6,
    grassSeek: 1.2,
    pathing: 3,           // when fed, prefer worn ground (it's easier walking)
    trailGain: 4,         // even a shallow groove reads as a path (saturates at 1/trailGain)
    followTracks: 0,      // when fed, also follow other prey's fresh tracks
    thirstRate: 1 / 1800, // thirst builds from 0 to 1 over this many steps
    thirsty: 0.6,         // above this, head downhill for water
    drinkSeek: 30,        // how strongly thirst pulls toward lower ground
    alarmRelay: 0.88,     // panic passed on by a panicking neighbour (it fades with each hop)
    wander: 0.02,
    carry: 0.25,          // dirt that can be carried per px/step of speed

    baseBurn: 0.00045,
    moveCost: 0.00016,    // × speed²
    visionCost: 0.0000035,// × vision radius
    climbCost: 0.03,
    bite: 0.012,          // grass eaten per step, at most
    full: 1,              // no eating above this energy
    grassEnergy: 0.4,
    birthEnergy: 0.85,
    maturity: 900,
    gestation: 3600,      // steps between births
    lifespan: [5400, 9000],
    mutation: 0.06,       // std-dev of a mutation, as a fraction of the gene's range
    scent: 0.004,
  },

  hunter: {
    genes: {
      speed:    { min: 1.3, max: 4.2, start: 2.1 },
      vision:   { min: 50,  max: 220, start: 120 },
      tracking: { min: 0,   max: 2,   start: 0.8 },
    },
    size: 10,
    maxForce: 0.09,
    personalSpace: 90,    // hunters keep this far from each other
    spaceWeight: 0.9,
    sensorDistance: 40,
    sensorAngle: 0.5,
    pathing: 0.3,
    wander: 0.03,
    carry: 0.3,

    grassCover: 0.7,      // prey in full grass can only be seen from (1 − this) × vision
    catchRadius: 7,
    lungeCooldown: 30,
    confusionRadius: 24,
    confusion: 1.0,       // each extra prey near the target lowers catch odds
    mealEnergy: 0.6,
    digestTime: 150,
    baseBurn: 0.0008,
    moveCost: 0.00007,
    visionCost: 0.0000035,
    climbCost: 0.03,
    birthEnergy: 1.25,
    maxEnergy: 1.6,
    maturity: 1200,
    gestation: 1200,
    lifespan: [7200, 11000],
    mutation: 0.06,
    scent: 0.006,
  },

  // Densities are per px² of dry land, so a small island simply holds fewer creatures.
  population: {
    preyPerArea: 1 / 2250,     // starting prey per px² of land
    preyCapPerArea: 1 / 1200,  // births stop above this density
    huntersPerPrey: 1 / 45,    // starting hunters per prey
    hunterCapPerArea: 1 / 12000,
    minPrey: 50,               // below this, wanderers arrive from off-map
    minHunters: 3,
    immigrationEvery: 90,
  },

  // How the 3D board is drawn.
  view: {
    heightScale: 145,     // ground height 0–1 becomes this many units tall
    baseDepth: 34,        // how far below height 0 a click can march before giving up
    preySize: [7.2, 9],   // blob width, height
    hunterSize: [10.5, 14],

    // The sea around the island.
    ocean: {
      size: 24000,        // how far the water reaches (the sky dome is further still)
      rings: 120,         // the grid is a disc centred on the camera: rings × sectors
      sectors: 180,
      waveScale: 0.8,     // height of the swell (wave 1 is 2.6 × this, in view units)
      steepness: 0.6,     // how much crests gather, Gerstner's Q
      refraction: 0.03,   // how far the surface bends what is behind it, in screens
      extinction: [0.085, 0.034, 0.022], // light lost per unit of depth: red goes first
      scatter: 0x0f4a66,  // the colour the water itself adds back, deep down
      foam: 0xf2fbff,
      floor: 0x6b6450,    // the sea bed outside the board
    },

    // Post-processing.
    bloom: { strength: 0.3, radius: 0.45, threshold: 0.95 },
    exposure: 0.95,
  },

  statsEvery: 30,        // record a population sample every this many steps
  statsLength: 600,      // samples kept (600 × 30 steps = 5 minutes)
};
