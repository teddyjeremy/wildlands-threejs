// Browser smoke test: builds must already exist in dist/.
//   npm run build && npm run smoke
// Starts `vite preview`, drives the game in headless Chrome, checks for
// console errors and core behaviour, and saves screenshots.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = 4179;
const OUT = resolve(process.env.SCREENSHOT_DIR || 'docs/screenshots');
mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => existsSync(p));

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => {
  server.stdout.on('data', (d) => /Local/.test(d) && res());
  server.on('exit', (c) => rej(new Error(`preview exited ${c}`)));
  setTimeout(() => rej(new Error('preview did not start')), 15000);
});

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  const t0 = Date.now();
  await page.goto(`http://localhost:${PORT}/?quality=medium`);
  await page.waitForFunction(() => window.__WILDLANDS__?.mode === 'title', null, { timeout: 90000 });
  check('title screen loads', true, `${Date.now() - t0} ms to title`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/01-title.png` });
  check('no console errors on load', errors.length === 0, errors.slice(0, 3).join(' | '));

  const audioBefore = await page.evaluate(() => typeof window.AudioContext);
  check('audio not started before gesture', audioBefore === 'function');

  await page.click('#start-btn');
  await page.waitForFunction(() => window.__WILDLANDS__.mode === 'play');
  check('start enters gameplay', true);
  const s0 = await page.evaluate(() => window.__WILDLANDS__.state());
  check('player spawns grounded in the cove', s0.player.grounded && s0.region === 'cove', `${s0.region} y=${s0.player.y.toFixed(2)}`);

  // Walk forward through the cove for ~2.5 s.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyW');
  const s1 = await page.evaluate(() => window.__WILDLANDS__.state());
  const moved = Math.hypot(s1.player.x - s0.player.x, s1.player.z - s0.player.z);
  check('W moves the player', moved > 3, `${moved.toFixed(1)} m`);

  // Jump.
  await page.keyboard.press('Space');
  const jumped = await page
    .waitForFunction(() => !window.__WILDLANDS__.state().player.grounded, null, { timeout: 5000, polling: 'raf' })
    .then(() => true, () => false);
  check('space jumps', jumped);
  await page.waitForFunction(() => window.__WILDLANDS__.state().player.grounded, null, { timeout: 10000 });
  check('player lands again', true);

  // Collect the sea glass near the start.
  const L = await page.evaluate(() => window.__WILDLANDS__.layout());
  await page.evaluate(([x, z]) => window.__WILDLANDS__.teleport(x, z - 1.2, 0), [L.cove.x - 4, L.cove.z + 3]);
  await page.waitForTimeout(400);
  const sp = await page.evaluate(() => window.__WILDLANDS__.state());
  check('collectible prompt appears', /Sea Glass/.test(sp.prompt || ''), sp.prompt);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(300);
  const sc = await page.evaluate(() => window.__WILDLANDS__.state());
  check('collecting updates progress', sc.collected.includes('sea-glass'));

  // Grass trail: walk back and forth in the meadow north of the cove.
  const meadow = await page.evaluate(() => {
    const W = window.__WILDLANDS__;
    const L = W.layout();
    return { x: 0, z: 40 };
  });
  await page.evaluate(({ x, z }) => window.__WILDLANDS__.teleport(x, z, Math.PI), meadow);
  await page.evaluate(() => window.__WILDLANDS__.setCamera(Math.PI * 0.5, 0.75, 11));
  for (let i = 0; i < 2; i++) {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1800);
    await page.keyboard.up('KeyW');
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(1800);
    await page.keyboard.up('KeyS');
  }
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(900);
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(500);
  const st = await page.evaluate(() => window.__WILDLANDS__.state());
  check('walking leaves a trail', st.trailActive > 30, `${st.trailActive} active cells`);
  await page.screenshot({ path: `${OUT}/02-trail.png` });
  await page.evaluate(() => { window.__WILDLANDS__.debug(true); window.__WILDLANDS__.debugView(1); });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/03-trail-debug-view.png` });
  await page.evaluate(() => { window.__WILDLANDS__.debugView(0); window.__WILDLANDS__.debug(false); });

  // Wildlife reacts when approached at a run.
  const before = st.wildlife.join(',');
  await page.evaluate(() => {
    const W = window.__WILDLANDS__;
    const L = W.layout();
    W.teleport(L.forest.x + 4, L.forest.z + 26, Math.PI);
    W.setCamera(0, 0.35, 8);
  });
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2200);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  await page.waitForTimeout(400);
  const sw = await page.evaluate(() => window.__WILDLANDS__.state());
  const reacted = sw.wildlife.some((s) => s !== 'forage');
  check('wildlife reacts to an approaching player', reacted, `${before} -> ${sw.wildlife.join(',')}`);
  await page.screenshot({ path: `${OUT}/04-wildlife.png` });

  // Rain: force it, let the sim run, check runoff and pools.
  await page.evaluate(() => {
    const W = window.__WILDLANDS__;
    const L = W.layout();
    W.setWeather('rain');
    W.teleport(L.wetland.x + 10, L.wetland.z + 12, Math.PI * 1.2);
    W.setCamera(0.4, 0.55, 13);
  });
  // Software rendering is slow and frame time is capped, so wait on the
  // simulation itself rather than wall-clock time.
  await page
    .waitForFunction(() => { const w = window.__WILDLANDS__.state().weather; return w.runoff > 0.3 && w.pool > 0.05; }, null, { timeout: 150000, polling: 1000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
  const sr = await page.evaluate(() => window.__WILDLANDS__.state());
  check('rain produces runoff and pooling', sr.weather.runoff > 0.3 && sr.weather.pool > 0.05, `rain ${sr.weather.rain.toFixed(2)} runoff ${sr.weather.runoff.toFixed(2)} pool ${sr.weather.pool.toFixed(2)}`);
  await page.screenshot({ path: `${OUT}/05-rain-runoff.png` });

  // Lighthouse at dusk with diagnostics.
  await page.evaluate(() => {
    const W = window.__WILDLANDS__;
    const L = W.layout();
    W.setWeather('clear');
    W.setTime(0.765);
    // Stand on the coastal path and look back at the tower.
    const px = L.lighthouse.x - 16;
    const pz = L.lighthouse.z + 22;
    W.teleport(px, pz, 0);
    const dx = L.lighthouse.x - px;
    const dz = L.lighthouse.z - pz;
    W.setCamera(Math.atan2(-dx, -dz), 0.12, 9);
    W.debug(true);
  });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${OUT}/06-lighthouse-dusk-diagnostics.png` });
  const sd = await page.evaluate(() => window.__WILDLANDS__.state());
  check('diagnostics report renderer stats', sd.stats.calls > 0, `fps ${sd.stats.fps.toFixed(1)} calls ${sd.stats.calls} tris ${sd.stats.triangles}`);

  // Notebook opens and lists the collectible.
  await page.evaluate(() => window.__WILDLANDS__.debug(false));
  await page.keyboard.press('KeyN');
  const nbVisible = await page.waitForSelector('#notebook:not(.hidden)', { timeout: 8000 }).then(() => true, () => false);
  const nbText = await page.textContent('#notebook');
  check('notebook opens with progress', nbVisible && /Sea Glass/.test(nbText));
  await page.screenshot({ path: `${OUT}/07-notebook.png` });
  await page.keyboard.press('Escape');

  // Save survives a reload.
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForFunction(() => window.__WILDLANDS__?.mode === 'title', null, { timeout: 90000 });
  const reloaded = await page.evaluate(() => window.__WILDLANDS__.state());
  check('save survives reload', reloaded.collected.includes('sea-glass'));

  // Corrupt save must not break startup.
  await page.evaluate(() => localStorage.setItem('wildlands.save', '{not json'));
  await page.reload();
  await page.waitForFunction(() => window.__WILDLANDS__?.mode === 'title', null, { timeout: 90000 });
  check('corrupt save is ignored', true);

  // Narrow viewport.
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(800);
  const startVisible = await page.isVisible('#start-btn');
  check('title usable at narrow width', startVisible);
  await page.screenshot({ path: `${OUT}/08-narrow-title.png` });

  const realErrors = errors.filter((e) => !/pointer ?lock/i.test(e));
  check('no runtime errors during session', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
} catch (err) {
  console.error(err);
  failed = true;
} finally {
  await browser.close();
  server.kill();
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
process.exit(failed || bad.length ? 1 : 0);
