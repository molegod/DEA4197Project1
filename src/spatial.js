// Buckets creatures by position so each one only checks the few nearby,
// instead of every creature on the map.
export class SpatialGrid {
  constructor(cellSize) {
    this.size = cellSize;
    this.cols = 1;
    this.rows = 1;
    this.heads = new Int32Array(1);
    this.next = new Int32Array(64);
    this.items = [];
  }

  rebuild(items, width, height) {
    const s = this.size;
    this.cols = Math.max(1, Math.ceil(width / s));
    this.rows = Math.max(1, Math.ceil(height / s));
    const buckets = this.cols * this.rows;
    if (this.heads.length < buckets) this.heads = new Int32Array(buckets);
    if (this.next.length < items.length) this.next = new Int32Array(items.length * 2);
    const { heads, next, cols, rows } = this;
    heads.fill(-1, 0, buckets);
    for (let i = 0; i < items.length; i++) {
      const c = Math.min(cols - 1, Math.max(0, Math.floor(items[i].x / s)));
      const r = Math.min(rows - 1, Math.max(0, Math.floor(items[i].y / s)));
      const b = r * cols + c;
      next[i] = heads[b];
      heads[b] = i;
    }
    this.items = items;
  }

  // Calls fn(item) for every item in the buckets overlapping the circle (x, y, r).
  // Callers still check the exact distance.
  forEachNear(x, y, r, fn) {
    const s = this.size, { cols, rows, heads, next, items } = this;
    const c0 = Math.max(0, Math.floor((x - r) / s)), c1 = Math.min(cols - 1, Math.floor((x + r) / s));
    const r0 = Math.max(0, Math.floor((y - r) / s)), r1 = Math.min(rows - 1, Math.floor((y + r) / s));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        for (let i = heads[row * cols + col]; i !== -1; i = next[i]) fn(items[i]);
      }
    }
  }
}
