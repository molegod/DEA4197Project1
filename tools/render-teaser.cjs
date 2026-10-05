// Renders the teaser frame by frame: the page runs in capture mode, so the
// simulation and camera are stepped from here and every frame is smooth.
//
//   npm i playwright-core                    (once, anywhere)
//   python3 -m http.server 8000              (from the project folder)
//   node tools/render-teaser.cjs 90 5400 frames
//   ffmpeg -framerate 30 -i frames/f%04d.jpg -vf "scale=1920:1080,format=yuv420p" \
//          -c:v libx264 -crf 24 -movflags +faststart teaser/common-ground-teaser.mp4
//
// Arguments: seed, warm-up steps before recording, output folder.
// Set BASE to use another server address. Uses your installed Google Chrome.

const fs = require('fs');
const { chromium } = require('playwright-core');

const BASE = process.env.BASE || 'http://127.0.0.1:8000';

(async () => {
  const [seed = '90', warm = '5400', outDir = 'frames'] = process.argv.slice(2);
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`${BASE}/index.html?capture&clean&seed=${seed}`, { waitUntil: 'networkidle' });
  await page.evaluate((n) => {
    for (let i = 0; i < n; i += 600) window.commonGround.step(Math.min(600, n - i));
  }, +warm);

  await page.addStyleTag({
    content: `
      #cap { position: fixed; left: 30px; bottom: 26px; font-family: 'IBM Plex Sans', sans-serif; color: #f4efe2; text-shadow: 0 1px 14px rgba(0,0,0,.6); }
      #cap h1 { font-size: 32px; font-weight: 600; margin: 0; }
      #cap p { margin: 2px 0 0; font-size: 15px; color: #ddd6c4; }
      #speed { position: fixed; right: 28px; top: 22px; font: 500 14px 'IBM Plex Mono', monospace; color: #f4efe2; text-shadow: 0 1px 8px rgba(0,0,0,.6); }`,
  });

  // Camera choreography, run inside the page each frame.
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div id="cap"><h1>Common Ground</h1><p>Prey flock, hunters hunt, and the ground remembers where they went.</p></div><div id="speed">real time</div>`,
    );
    const cg = window.commonGround;
    const { sim, config } = cg;
    const VS = config.view.heightScale;
    const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
    const to3d = (c) => ({
      x: c.x - sim.world.width / 2,
      y: Math.max(sim.world.heightAt(c.x, c.y), config.world.waterLevel) * VS + 6,
      z: c.y - sim.world.height / 2,
    });
    // The hunter with the most prey around it makes the best subject.
    const pickSubject = () => {
      let best = null, most = -1;
      for (const h of sim.hunters) {
        const n = sim.prey.filter((p) => (p.x - h.x) ** 2 + (p.y - h.y) ** 2 < 140 ** 2).length;
        if (n > most) (most = n), (best = h);
      }
      return best;
    };
    const wide = { x: 0, y: 30, z: 30 };
    let subject = null, focus = { ...wide };
    window.teaserFrame = (f) => {
      if (f === 140 || (subject && !sim.hunters.includes(subject))) subject = pickSubject() ?? subject;
      if (subject) {
        const p = to3d(subject);
        focus.x += (p.x - focus.x) * 0.12;
        focus.y += (p.y - focus.y) * 0.12;
        focus.z += (p.z - focus.z) * 0.12;
      }
      // 0 = wide shot of the board, 1 = close on the subject.
      const close = f < 150 ? 0 : f < 300 ? ease((f - 150) / 75) : 1 - ease((f - 300) / 90);
      const tx = wide.x + (focus.x - wide.x) * close;
      const ty = wide.y + (focus.y - wide.y) * close;
      const tz = wide.z + (focus.z - wide.z) * close;
      const dist = 1700 + (230 - 1700) * close;
      const elev = 0.68 + (0.5 - 0.68) * close;
      const azim = -0.38 + f * 0.0016;
      cg.camera(
        [tx + dist * Math.cos(elev) * Math.sin(azim), ty + dist * Math.sin(elev), tz + dist * Math.cos(elev) * Math.cos(azim)],
        [tx, ty, tz],
      );
    };
    return document.fonts.ready;
  });

  // 10 s in real time, then ease into an 8× time-lapse while the camera pulls back.
  const FPS = 30, TOTAL = 14 * FPS, REAL = 10 * FPS;
  for (let f = 0; f < TOTAL; f++) {
    let steps = 2;
    if (f >= REAL) {
      const t = Math.min(1, (f - REAL) / (2.5 * FPS));
      steps = Math.round(2 + 14 * t * t * (3 - 2 * t));
    }
    await page.evaluate(({ steps, f }) => {
      window.commonGround.step(steps);
      window.teaserFrame(f);
      window.commonGround.render();
      document.getElementById('speed').textContent = steps <= 2 ? 'real time' : `time-lapse ×${Math.round(steps / 2)}`;
    }, { steps, f });
    await page.screenshot({ path: `${outDir}/f${String(f).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 92 });
  }
  await browser.close();
})();
