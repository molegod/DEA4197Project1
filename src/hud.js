// The info panel: population stat tiles with sparklines, and how the average
// genes have drifted since the start (the tick marks where they began).

import { CONFIG } from './config.js';

const TRAITS = [
  { kind: 'prey', gene: 'speed', label: 'Speed', fmt: (v) => v.toFixed(2) },
  { kind: 'prey', gene: 'vision', label: 'Eyesight', fmt: (v) => v.toFixed(0) },
  { kind: 'prey', gene: 'cohesion', label: 'Cohesion', fmt: (v) => v.toFixed(2) },
  { kind: 'prey', gene: 'alignment', label: 'Alignment', fmt: (v) => v.toFixed(2) },
  { kind: 'prey', gene: 'fear', label: 'Fear', fmt: (v) => v.toFixed(2) },
  { kind: 'prey', gene: 'wariness', label: 'Wariness', fmt: (v) => v.toFixed(2) },
  { kind: 'hunters', gene: 'speed', label: 'Speed', fmt: (v) => v.toFixed(2) },
  { kind: 'hunters', gene: 'vision', label: 'Eyesight', fmt: (v) => v.toFixed(0) },
  { kind: 'hunters', gene: 'tracking', label: 'Tracking', fmt: (v) => v.toFixed(2) },
];

const LEGENDS = {
  family: 'Color: family line. Children inherit a slightly shifted hue.',
  speed: 'Color: speed gene. Dim = slow, bright = fast.',
  vision: 'Color: eyesight gene. Dim = short-sighted, bright = far-sighted.',
};

const clock = (seconds) => {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class Hud {
  constructor(root) {
    this.root = root;
    this.preyValue = root.querySelector('#prey-count');
    this.hunterValue = root.querySelector('#hunter-count');
    this.sparks = [
      { canvas: root.querySelector('#prey-spark'), key: 'prey', color: '--prey', tip: root.querySelector('#prey-tip') },
      { canvas: root.querySelector('#hunter-spark'), key: 'hunters', color: '--hunter', tip: root.querySelector('#hunter-tip') },
    ];
    this.legend = root.querySelector('#legend');
    this.foot = root.querySelector('#hud-foot');
    this.buildTraits(root.querySelector('#traits'));
    for (const s of this.sparks) this.bindHover(s);
    this.samples = [];
  }

  buildTraits(container) {
    this.traitRows = [];
    let group = null;
    for (const t of TRAITS) {
      if (t.kind !== group) {
        group = t.kind;
        const h = document.createElement('div');
        h.className = 'trait-group';
        h.innerHTML = `<span class="key ${t.kind}"></span>${t.kind === 'prey' ? 'Prey genes' : 'Hunter genes'}`;
        container.append(h);
      }
      const row = document.createElement('div');
      row.className = 'trait';
      row.innerHTML = `<span class="trait-label">${t.label}</span>
        <span class="meter ${t.kind}"><span class="fill"></span><span class="start" title="average at the start"></span></span>
        <span class="trait-value">–</span>`;
      container.append(row);
      this.traitRows.push({
        ...t,
        fill: row.querySelector('.fill'),
        start: row.querySelector('.start'),
        value: row.querySelector('.trait-value'),
      });
    }
  }

  update(sim, state) {
    this.samples = sim.stats.samples;
    const last = this.samples[this.samples.length - 1];
    this.preyValue.textContent = sim.prey.length.toLocaleString();
    this.hunterValue.textContent = sim.hunters.length.toLocaleString();
    for (const s of this.sparks) this.drawSpark(s);

    for (const row of this.traitRows) {
      const spec = (row.kind === 'prey' ? CONFIG.prey : CONFIG.hunter).genes[row.gene];
      const now = last?.genes[row.kind]?.[row.gene];
      const start = sim.genesAtStart?.[row.kind]?.[row.gene];
      const pct = (v) => `${(((v - spec.min) / (spec.max - spec.min)) * 100).toFixed(1)}%`;
      row.fill.style.width = now == null ? '0%' : pct(now);
      row.start.style.left = start == null ? '-10px' : pct(start);
      row.value.textContent = now == null ? '–' : row.fmt(now);
    }

    this.legend.textContent = LEGENDS[state.colorMode];
    const gen = last ? `gen ${last.preyGen} / ${last.hunterGen}` : '';
    const speed = state.paused ? 'paused' : `${state.speed}×`;
    this.foot.textContent = `${clock(sim.world.time)} · ${gen} · ${speed} · seed ${sim.seed}`;
  }

  drawSpark(s) {
    const { canvas } = s;
    const dpr = devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const data = this.samples;
    if (data.length < 2) return;
    const max = Math.max(1, ...data.map((d) => d[s.key])) * 1.1;
    const n = CONFIG.statsLength;
    const xAt = (i) => w - ((data.length - 1 - i) / (n - 1)) * w;
    const yAt = (v) => h - 2 - (v / max) * (h - 4);
    const color = getComputedStyle(this.root).getPropertyValue(s.color).trim();

    ctx.strokeStyle = 'rgba(236, 230, 214, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h - 1.5);
    ctx.lineTo(w, h - 1.5);
    ctx.stroke();

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    data.forEach((d, i) => (i ? ctx.lineTo(xAt(i), yAt(d[s.key])) : ctx.moveTo(xAt(i), yAt(d[s.key]))));
    ctx.stroke();

    // Hover crosshair.
    if (s.hoverX != null) {
      const i = Math.round(data.length - 1 - ((w - s.hoverX) / w) * (n - 1));
      if (i >= 0 && i < data.length) {
        const x = xAt(i), y = yAt(data[i][s.key]);
        ctx.strokeStyle = 'rgba(236, 230, 214, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        const ago = ((data[data.length - 1].step - data[i].step) * CONFIG.step);
        s.tip.textContent = `${data[i][s.key].toLocaleString()} · ${ago < 1 ? 'now' : clock(ago) + ' ago'}`;
        s.tip.hidden = false;
        return;
      }
    }
    s.tip.hidden = true;
  }

  bindHover(s) {
    const zone = s.canvas.parentElement;
    zone.addEventListener('pointermove', (e) => {
      const r = s.canvas.getBoundingClientRect();
      s.hoverX = e.clientX >= r.left && e.clientX <= r.right ? e.clientX - r.left : null;
      this.drawSpark(s);
    });
    zone.addEventListener('pointerleave', () => {
      s.hoverX = null;
      this.drawSpark(s);
    });
  }
}
