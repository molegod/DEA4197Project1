// Renders the teaser: it opens on the whole island, flies down to a hunter running a
// prey down, close enough to see everyone's eyes, and slows for the catch. No captions.
//
//   npm i playwright-core                   (once, anywhere; point NODE_PATH at it if it's elsewhere)
//   python3 -m http.server 8000             (from the project folder)
//   node tools/render-hunt.cjs scan 90      lists the most watchable catches in world 90
//   node tools/render-hunt.cjs render 90 5312 14 -1.2 frames
//                                           replays world 90 and films the catch at step 5312
//                                           (scan prints this line, filled in, for each catch it likes)
//   ffmpeg -framerate 20 -i frames/f%04d.jpg \
//     -vf "scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a" \
//     -loop 0 teaser/common-ground-teaser.gif
//   gifsicle -O3 --lossy=40 -b teaser/common-ground-teaser.gif
//
// A world is deterministic for its seed, so `scan` runs ahead, notes every catch and scores it
// (how many prey were around, whether another hunter was close, dry land, away from the edge),
// and `render` replays the same world and starts filming a few seconds before the catch you
// picked. Set BASE to use another server address. Uses your installed Google Chrome.

const fs = require('fs');
const { chromium } = require('playwright-core');

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const FPS = 20;

// Simulation steps per frame: real time (3) while the camera flies in, slow motion (1)
// for the lunge, real time again for the aftermath. The catch lands on frame CATCH_FRAME.
const SCHEDULE = [
  ...Array(62).fill(3), 2, 2, 2, 2, 2, 2, // 3.4 s: the whole island, then the dive in
  ...Array(28).fill(1), //                   1.4 s slow motion around the catch
  2, 2, 2, 2, ...Array(28).fill(3), //       1.6 s aftermath
];
const CATCH_FRAME = 82;

const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
// 0 = the whole island from above, 1 = right down among the creatures. Hold the wide
// shot for a beat, fly in over about two seconds, then stay down there.
const closeAt = (f) => ease((f - 16) / 46);
// Far enough out to hold the island in frame, in until the eyes fill it, then a last creep.
const distanceAt = (f) => {
  const c = closeAt(f);
  return 1250 + (95 - 1250) * c + (c >= 1 ? (86 - 95) * ease((f - 96) / 30) : 0);
};

async function open(seed) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`${BASE}/index.html?capture&clean&seed=${seed}`, { waitUntil: 'networkidle' });
  return { browser, page };
}

async function scan(seed, from = 1200, to = 9000) {
  const { browser, page } = await open(seed);
  const events = await page.evaluate(
    ({ from, to }) => {
      const { sim } = window.commonGround;
      const history = new Map(); // hunter id -> where it's been lately
      const events = [];
      const original = sim.attemptCatch.bind(sim);
      sim.attemptCatch = (hunter, prey) => {
        const before = sim.stats.catches;
        original(hunter, prey);
        if (sim.stats.catches === before || sim.steps < from) return;
        const h = history.get(hunter.id) ?? [];
        const back = (n) => h[Math.max(0, h.length - 1 - n)] ?? { x: hunter.x, y: hunter.y, digest: 0 };
        let ran = 0;
        for (let i = Math.max(1, h.length - 240); i < h.length; i++) ran += Math.hypot(h[i].x - h[i - 1].x, h[i].y - h[i - 1].y);
        const near = (list, r) => list.filter((o) => !o.dead && o !== prey && o !== hunter && (o.x - prey.x) ** 2 + (o.y - prey.y) ** 2 < r * r).length;
        const { width, height } = sim.world;
        const k = sim.world.index(prey.x, prey.y);
        const b = back(90);
        events.push({
          step: sim.steps,
          hunter: hunter.id,
          x: +prey.x.toFixed(1),
          y: +prey.y.toFixed(1),
          heading: Math.atan2(hunter.y - b.y, hunter.x - b.x),
          crowd: near(sim.prey, 40),
          herd: near(sim.prey, 90),
          hunters: near(sim.hunters, 160),
          ran: Math.round(ran),
          edge: Math.round(Math.min(prey.x, prey.y, width - prey.x, height - prey.y)),
          water: sim.world.isWater(k),
          digesting: back(250).digest > 0,
          young: h.length < 260,
        });
      };
      while (sim.steps < to) {
        sim.step();
        for (const hu of sim.hunters) {
          let h = history.get(hu.id);
          if (!h) history.set(hu.id, (h = []));
          h.push({ x: hu.x, y: hu.y, digest: hu.digest });
          if (h.length > 300) h.shift();
        }
      }
      return events;
    },
    { from, to },
  );
  await browser.close();

  const scored = events
    .map((e) => {
      // Other catches close by in the same few seconds: more hunters in the shot.
      const more = events.filter((o) => o !== e && Math.abs(o.step - e.step) < 120 && Math.hypot(o.x - e.x, o.y - e.y) < 120).length;
      const score =
        e.crowd * 2 + e.herd * 0.4 + e.hunters * 4 + more * 6 + Math.min(e.ran, 400) / 40 -
        (e.water ? 40 : 0) - (e.edge < 100 ? 40 : 0) - (e.digesting ? 40 : 0) - (e.young ? 100 : 0);
      return { ...e, more, score: Math.round(score * 10) / 10 };
    })
    .sort((a, b) => b.score - a.score);
  console.log(`${events.length} catches between steps ${from} and ${to} in world ${seed}. The best:`);
  for (const e of scored.slice(0, 12)) {
    const flags = [e.water && 'WATER', e.edge < 100 && 'EDGE', e.digesting && 'DIGESTING', e.young && 'YOUNG'].filter(Boolean).join(' ');
    console.log(
      `  score ${e.score}  step ${e.step}  hunter ${e.hunter}  at (${e.x}, ${e.y})  prey within 40/90: ${e.crowd}/${e.herd}  ` +
        `hunters near: ${e.hunters}  other catches: ${e.more}  ran ${e.ran}px  ${flags}`,
    );
    console.log(`    node tools/render-hunt.cjs render ${seed} ${e.step} ${e.hunter} ${e.heading.toFixed(3)} frames`);
  }
}

async function render(seed, catchStep, hunterId, heading, outDir = 'frames') {
  fs.mkdirSync(outDir, { recursive: true });
  const { browser, page } = await open(seed);
  const stepsBefore = SCHEDULE.slice(0, CATCH_FRAME + 1).reduce((a, b) => a + b, 0);
  const start = catchStep - stepsBefore;
  await page.evaluate((n) => {
    for (let i = 0; i < n; i += 600) window.commonGround.step(Math.min(600, n - i));
  }, start);


  const alive = await page.evaluate(
    ({ hunterId, heading }) => {
      const cg = window.commonGround;
      const { sim, config } = cg;
      const VS = config.view.heightScale;
      const W = sim.world.width, H = sim.world.height;
      const groundY = (x, y) => Math.max(sim.world.heightAt(x, y), config.world.waterLevel) * VS;
      const first = sim.hunters.find((h) => h.id === hunterId);
      if (!first) return false;

      // The camera sits ahead of the chase and off to one side, so we see faces rather than
      // backs. Of the two sides, take the one that keeps the camera over the board.
      const base = Math.atan2(Math.cos(heading), Math.sin(heading)); // simulation y is world z
      const room = (s) => {
        const a = base + s * 0.85;
        const cx = first.x + Math.sin(a) * 100, cz = first.y + Math.cos(a) * 100;
        return Math.min(cx, cz, W - cx, H - cz);
      };
      const azim0 = base + (room(1) >= room(-1) ? 1 : -1) * 0.85;
      // Looking down on the island to start with, levelling off as the camera comes in.
      const WIDE = { x: 0, y: 40, z: 0 }, WIDE_ELEV = 0.62, CLOSE_ELEV = 0.48;
      const focus = { x: first.x - W / 2, y: groundY(first.x, first.y) + 7, z: first.y - H / 2 };
      let lift = 0;

      window.huntFrame = (f, dist, close, steps) => {
        const hunter = sim.hunters.find((h) => h.id === hunterId);
        if (hunter) {
          let tx = hunter.x, ty = hunter.y;
          if (hunter.digest <= 0) {
            // Look between the hunter and the prey it's running at.
            let best = null, bd = 80 * 80;
            for (const p of sim.prey) {
              const ex = p.x - hunter.x, ey = p.y - hunter.y, d2 = ex * ex + ey * ey;
              if (d2 < bd && ex * hunter.vx + ey * hunter.vy > 0) (bd = d2), (best = p);
            }
            if (best) (tx += (best.x - hunter.x) * 0.4), (ty += (best.y - hunter.y) * 0.4);
          }
          // Lead the target by the smoothing lag, so the camera doesn't trail the sprint.
          const a = 0.2, lead = (steps * (1 - a)) / a;
          tx = Math.min(W - 1, Math.max(1, tx + hunter.vx * lead));
          ty = Math.min(H - 1, Math.max(1, ty + hunter.vy * lead));
          focus.x += (tx - W / 2 - focus.x) * a;
          focus.z += (ty - H / 2 - focus.z) * a;
          focus.y += (groundY(tx, ty) + 7 - focus.y) * a;
        }
        // Aim at the middle of the island to begin with and travel onto the hunter.
        const ax = WIDE.x + (focus.x - WIDE.x) * close;
        const ay = WIDE.y + (focus.y - WIDE.y) * close;
        const az = WIDE.z + (focus.z - WIDE.z) * close;
        const elev = WIDE_ELEV + (CLOSE_ELEV - WIDE_ELEV) * close;
        const azim = azim0 + f * 0.0012;
        const cx = ax + dist * Math.cos(elev) * Math.sin(azim);
        const cy = ay + dist * Math.sin(elev);
        const cz = az + dist * Math.cos(elev) * Math.cos(azim);
        // Don't let a hill get between the camera and the action: lift the camera over it.
        let need = 0;
        for (let t = 0.15; t <= 1.0001; t += 0.05) {
          const sx = ax + (cx - ax) * t + W / 2, sz = az + (cz - az) * t + H / 2;
          if (sx < 0 || sz < 0 || sx > W || sz > H) continue;
          const g = groundY(sx, sz) + 6, line = ay + (cy - ay) * t;
          if (g > line) need = Math.max(need, (g - ay) / t + ay - cy);
        }
        lift += (need - lift) * (need > lift ? 0.5 : 0.05);
        cg.camera([cx, cy + lift, cz], [ax, ay, az]);
      };
      return document.fonts.ready.then(() => true);
    },
    { hunterId, heading },
  );
  if (!alive) throw new Error(`hunter ${hunterId} isn't alive at step ${start}; run scan again`);

  for (let f = 0; f < SCHEDULE.length; f++) {
    const steps = SCHEDULE[f];
    const caught = await page.evaluate(
      ({ steps, f, dist, close }) => {
        const cg = window.commonGround;
        cg.step(steps);
        window.huntFrame(f, dist, close, steps);
        cg.render();
        return cg.sim.kills.some((k) => k.step === cg.sim.steps);
      },
      { steps, f, dist: distanceAt(f), close: closeAt(f) },
    );
    if (f === CATCH_FRAME && !caught) console.warn(`no catch happened at step ${catchStep}; is this the same world?`);
    await page.screenshot({ path: `${outDir}/f${String(f).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 92 });
  }
  await browser.close();
  console.log(`${SCHEDULE.length} frames (${SCHEDULE.length / FPS} s at ${FPS} fps) in ${outDir}/`);
}

const [mode, seed = '90', ...rest] = process.argv.slice(2);
if (mode === 'scan') scan(+seed, ...rest.map(Number));
else if (mode === 'render') render(+seed, +rest[0], +rest[1], +rest[2], rest[3]);
else console.log('usage: node tools/render-hunt.cjs scan <seed> [from] [to] | render <seed> <catchStep> <hunterId> <heading> [outDir]');
