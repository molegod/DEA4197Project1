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

  // One palette. Everything that is drawn takes its colour from here, so the island,
  // the sea, the creatures and the light all belong to the same picture.
  palette: {
    sand: 0xe8d6a8,
    soil: 0xb2956a,
    soilLow: 0x8a7050,
    rock: 0x9a9287,
    snow: 0xf2efe6,
    meadow: 0x79a84e,
    lush: 0x4d8a3a,
    bed: 0xcbb98c,       // the sea bed, in the shallows…
    bedDeep: 0x7d7560,   // …and further down
    seaShallow: 0x5fd0cc,
    seaMid: 0x2a8fb0,
    seaDeep: 0x15577f,
    foam: 0xdff0f3,
    ink: 0x25262b,       // outlines, and the strokes along a worn path
    fear: 0xd4503f,      // the wash a hunter leaves behind
    path: 0xdcc9a0,
    pile: 0x6b4f36,
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
      clear: 7,           // depth over which the bottom stops showing through
      band1: 14,          // depth where the shallows give way to the middle water…
      band2: 34,          // …and where that gives way to the deep
      foamWidth: 11,      // how wide the line of foam is, in pixels on screen
      foamScale: 0.035,   // size of the scallops in the foam's edge
      foamSpeed: 1.1,     // how fast they drift
      sky: 0.25,          // how much sky the surface picks up at grazing angles
      shallow: 0x5fd0cc,  // the colour over the shallows
      mid: 0x2a8fb0,      // …further out…
      deep: 0x12577e,     // …and over deep water
      foam: 0xd9eef3,
      floor: 0x6b6450,    // the sea bed outside the board
    },

    // The sun goes round. Everything else — sky, water, shadows, exposure — follows it.
    daylight: {
      dayLength: 420,    // seconds of simulation time for one full cycle
      start: 0.36,       // where the clock starts; 0.5 is noon
      sunrise: 0.15,
      sunset: 0.85,
      maxElevation: 1.08,
      minElevation: 0.12, // never quite touch the horizon, or shadows stretch off the map
      rebakeEvery: 45,    // frames between re-bakes of the sky's light
      // at: where in the day. sun/moon: how strong the key light is. amb: the sky's fill.
      stops: [
        { at: 0.0,  sun: 0,    moon: 0.5,  amb: 0.5,  exposure: 1.3,  key: 0x9fc4ff, zenith: 0x0b1733, horizon: 0x1d2f4e, haze: 0x16233a },
        { at: 0.15, sun: 0.9,  moon: 0.12, amb: 0.62, exposure: 1.15, key: 0xff9a60, zenith: 0x2d4f8c, horizon: 0xf2a877, haze: 0xd59274 },
        { at: 0.3,  sun: 2.5,  moon: 0,    amb: 0.84, exposure: 1.0,  key: 0xffe3bd, zenith: 0x2f72c8, horizon: 0xcfe2ee, haze: 0xb6cfe0 },
        { at: 0.5,  sun: 3.1,  moon: 0,    amb: 0.95, exposure: 0.95, key: 0xfff2da, zenith: 0x2a6ec8, horizon: 0xc6dcea, haze: 0x9fbdd2 },
        { at: 0.7,  sun: 2.5,  moon: 0,    amb: 0.84, exposure: 1.0,  key: 0xffdcae, zenith: 0x2f6cbe, horizon: 0xd8dfe6, haze: 0xbcc9d6 },
        { at: 0.85, sun: 0.9,  moon: 0.12, amb: 0.62, exposure: 1.15, key: 0xff8a4e, zenith: 0x27508f, horizon: 0xf39a63, haze: 0xcf8b73 },
        { at: 1.0,  sun: 0,    moon: 0.5,  amb: 0.5,  exposure: 1.3,  key: 0x9fc4ff, zenith: 0x0b1733, horizon: 0x1d2f4e, haze: 0x16233a },
      ],
    },

    // Cloud shadows drifting over the island. There are no clouds in the sky; this is
    // the shadow of weather passing, which is the part you actually notice.
    clouds: {
      scale: 0.0016,     // size of the patches
      speed: [5.5, 2.2], // how fast they drift, in units per second
      amount: 0.38,      // how much of the sun a patch takes away
      coverage: 0.56,    // more means more sky is clouded
      softness: 0.3,     // how soft the edge of a patch is
    },

    // Light on the ground in steps rather than a smooth ramp, the way it would be
    // painted. The band edges are jittered by noise so they wobble instead of
    // following a perfect contour.
    toon: { steps: 3, jitter: 0.1, jitterScale: 0.02, floor: 0.32 },

    // Light coming round the edge of a creature that has the sun behind it.
    rim: { power: 2.2, strength: 0.75 },

    // A drawn line round the creatures.
    outline: { thickness: 0.22, opacity: 0.8 },


    // A drawn line wherever one colour meets another: on the ground, and in the sea.
    lines: { width: 1.7, strength: 0.8 },

    // What the ground remembers, drawn rather than tinted.
    ink: {
      stroke: 0.55,    // how dark the line along the edge of a worn path is
      wash: 0.5,       // how strong the hunters' wash is
      bleed: 9,        // how far its edge wanders, in units
    },

    // Post-processing.
    bloom: { strength: 0.12, radius: 0.2, threshold: 1 },
    exposure: 0.95,
  },

  statsEvery: 30,        // record a population sample every this many steps
  statsLength: 600,      // samples kept (600 × 30 steps = 5 minutes)
};
