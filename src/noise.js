// Terrain noise. An integer hash makes it identical on every machine.
//
// Height = fractal Brownian motion (stacked noise, each layer half as tall and
// twice as detailed), with its coordinates bent by two more fBm fields that
// slowly drift over time (domain warping, The Book of Shaders ch. 13).

const OFFSET = 1 << 20; // keeps grid coordinates positive before hashing
const WARP = 0.9;       // how strongly the drifting fields bend the hills
const DIRS = 16;
const GX = new Float64Array(DIRS);
const GY = new Float64Array(DIRS);
for (let k = 0; k < DIRS; k++) {
  GX[k] = Math.cos((k * 2 * Math.PI) / DIRS);
  GY[k] = Math.sin((k * 2 * Math.PI) / DIRS);
}

export function hashU32(x) {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function corner(ix, iy, seed, dx, dy) {
  const h = hashU32((((ix + OFFSET) >>> 0) + hashU32(((iy + OFFSET) + seed) >>> 0)) >>> 0);
  const k = h & (DIRS - 1);
  return GX[k] * dx + GY[k] * dy;
}

// Gradient noise, roughly in [-0.7, 0.7].
export function noise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = corner(ix, iy, seed, fx, fy);
  const b = corner(ix + 1, iy, seed, fx - 1, fy);
  const c = corner(ix, iy + 1, seed, fx, fy - 1);
  const d = corner(ix + 1, iy + 1, seed, fx - 1, fy - 1);
  const ab = a + (b - a) * ux;
  const cd = c + (d - c) * ux;
  return ab + (cd - ab) * uy;
}

export function fbm(x, y, octaves, seed) {
  let sum = 0, amp = 0.5;
  for (let k = 0; k < octaves; k++) {
    sum += amp * noise(x, y, seed);
    const nx = 0.8 * x - 0.6 * y;
    const ny = 0.6 * x + 0.8 * y;
    x = nx * 2.03 + 3.1;
    y = ny * 2.03 + 1.7;
    amp *= 0.5;
  }
  return sum;
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// The island's outline: 1 well inland, 0 out at sea, with a soft shelf in between.
// u and v run -1…1 across the board. Two noise fields bend the coastline — one read
// around the compass, which gives headlands and coves, and one read across the board,
// which stops the island from being a disc — so every seed gets a different shape.
// It always reaches 0 before the board's edge, so the island never touches the rim.
export function islandMask(u, v, seed) {
  const r = Math.hypot(u, v);
  if (r >= 1) return 0;
  const a = Math.atan2(v, u);
  const around = fbm(Math.cos(a) * 1.7 + 9.4, Math.sin(a) * 1.7 - 3.6, 3, (seed ^ 0x5bd1e995) >>> 0);
  const broad = fbm(u * 1.15 + 2.9, v * 1.15 - 6.1, 4, (seed ^ 0x27d4eb2f) >>> 0);
  const coast = Math.min(0.99, Math.max(0.62, 0.86 + 0.3 * around + 0.34 * broad));
  return smoothstep(coast, coast - 0.28, r);
}

// Each seed looks at its own far-off patch of the noise, so worlds don't share a layout.
export function terrainOffset(seed) {
  return [(hashU32(seed ^ 0x51ed27) % 40960) / 16, (hashU32(seed ^ 0x2c1b3a) % 40960) / 16];
}

// x, y in noise units; t = drift time. Returns height in [0, 1].
export function terrainHeight(x, y, t, seed) {
  const qx = fbm(x + 0.7 * t, y - 0.3 * t, 3, (seed + 1) >>> 0);
  const qy = fbm(x + 5.2 - 0.4 * t, y + 1.3 + 0.6 * t, 3, (seed + 2) >>> 0);
  const h = fbm(x + WARP * qx, y + WARP * qy, 5, seed);
  return Math.min(1, Math.max(0, 0.5 + 1.25 * h));
}
