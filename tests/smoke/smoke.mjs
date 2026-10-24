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

// Set BASE_URL to test a deployed build instead of a local preview.
const BASE = process.env.BASE_URL?.replace(/\/$/, '');
const server = BASE ? null : spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
if (server) await new Promise((res, rej) => {
  server.stdout.on('data', (d) => /Local/.test(d) && res());
  server.on('exit', (c) => rej(new Error(`preview exited ${c}`)));
  setTimeout(() => rej(new Error('preview did not start')), 15000);
});


const state = (page) => page.evaluate(() => window.__WILDLANDS__.state());
const until = (page, fn, timeout = 60000, arg) => page.waitForFunction(fn, arg, { timeout, polling: 250 }).then(() => true, () => false);
const waitPrompt = (page, re) => page.waitForFunction((src) => new RegExp(src).test(window.__WILDLANDS__.state().prompt || ''), re.source, { timeout: 20000, polling: 200 }).catch(() => {});
const unit = (sg) => {
  const dx = sg.b.x - sg.a.x;
  const dz = sg.b.z - sg.a.z;
  const len = Math.hypot(dx, dz);
  return { x: dx / len, z: dz / len, len, h: Math.atan2(dx, dz), yaw: Math.atan2(-dx, -dz) };
};
/** Hold W along a crossing until we're past its far end (or give up). */
async function walkAcross(page, sg, d, expectIce = false) {
  await page.evaluate(([x, z, h, yaw]) => { window.__WILDLANDS__.teleport(x, z, h); window.__WILDLANDS__.setCamera(yaw, 0.4, 8); }, [sg.a.x - d.x * 1.2, sg.a.z - d.z * 1.2, d.h, d.yaw]);
  await page.keyboard.down('KeyW');
  const t0 = Date.now();
  let dist = 0;
  let onIce = false;
  let onDeck = false;
  while (Date.now() - t0 < 60000) {
    const q = await state(page);
    dist = (q.player.x - sg.a.x) * d.x + (q.player.z - sg.a.z) * d.z;
    onIce ||= q.player.onIce;
    onDeck ||= q.player.onDeck;
    if (dist > d.len + 0.6) break;
    await page.waitForTimeout(250);
  }
  await page.keyboard.up('KeyW');
  return { done: dist > d.len + 0.6, d: dist, onIce: expectIce ? onIce : true, onDeck };
}

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
  await page.goto(`${BASE || `http://localhost:${PORT}`}/?quality=medium`);
  await page.waitForFunction(() => window.__WILDLANDS__?.mode === 'title', null, { timeout: 90000 });
  check('title screen loads', true, `${Date.now() - t0} ms to title`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/01-title.png` });
  check('no console errors on load', errors.length === 0, errors.slice(0, 3).join(' | '));

  const audioBefore = await page.evaluate(() => window.__WILDLANDS__.state().audioStarted);
  check('audio not started before the Start gesture', audioBefore === false);

  await page.click('#start-btn');
  await page.waitForFunction(() => window.__WILDLANDS__.mode === 'play');
  check('start enters gameplay', true);
  check('audio starts after the Start gesture', await page.evaluate(() => window.__WILDLANDS__.state().audioStarted));
  const s0 = await page.evaluate(() => window.__WILDLANDS__.state());
  check('player spawns grounded in the cove', s0.player.grounded && s0.region === 'cove', `${s0.region} y=${s0.player.y.toFixed(2)}`);

  // Walk forward through the cove for ~2.5 s.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyW');
  const s1 = await page.evaluate(() => window.__WILDLANDS__.state());
  const moved = Math.hypot(s1.player.x - s0.player.x, s1.player.z - s0.player.z);
  check('W moves the player', moved > 1.5, `${moved.toFixed(1)} m`);

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
  await page.waitForFunction(() => /Sea Glass/.test(window.__WILDLANDS__.state().prompt || ''), null, { timeout: 10000 }).catch(() => {});
  const sp = await page.evaluate(() => window.__WILDLANDS__.state());
  check('collectible prompt appears', /Sea Glass/.test(sp.prompt || ''), sp.prompt);
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__WILDLANDS__.state().collected.length > 0, null, { timeout: 10000 }).catch(() => {});
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
  // Back and forth until there's a trail (software rendering is slow, so
  // this waits on the simulation rather than a fixed time).
  for (let i = 0; i < 6; i++) {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1800);
    await page.keyboard.up('KeyW');
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(1800);
    await page.keyboard.up('KeyS');
    if (i >= 1 && (await state(page)).trailActive > 60) break;
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

  // ---- Seasonkeeper: island 1 (spring) ------------------------------------
  const P1 = await page.evaluate(() => window.__WILDLANDS__.plan());
  await page.evaluate(([x, z]) => window.__WILDLANDS__.teleport(x, z - 1.3, 0), [P1.lantern.x, P1.lantern.z]);
  await waitPrompt(page, /lantern/);
  await page.keyboard.press('KeyE');
  check('lantern can be picked up', await until(page, () => window.__WILDLANDS__.state().progression.lantern));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/09-lantern.png` });

  await page.evaluate(([x, z]) => window.__WILDLANDS__.teleport(x, z - 1.4, 0), [P1.ember.x, P1.ember.z]);
  await waitPrompt(page, /ember/);
  await page.keyboard.press('KeyE');
  check('spring ember lights the lantern', await until(page, () => { const f = window.__WILDLANDS__.state().field; return f.season === 'spring' && f.intensity > 0.9; }));
  check('only earned seasons are offered', (await state(page)).seasons.join() === 'spring');

  const seg = P1.segments[0];
  const dir = unit(seg);
  await page.evaluate(([x, z, h, yaw]) => { window.__WILDLANDS__.teleport(x, z, h); window.__WILDLANDS__.setCamera(yaw + 0.7, 0.35, 10); }, [seg.a.x - dir.x * 2.5, seg.a.z - dir.z * 2.5, dir.h, dir.yaw]);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/10-spring-field.png` });
  check('spring field grows the vine bridge', await until(page, () => window.__WILDLANDS__.state().puzzles[0].solved, 150000));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/11-vine-bridge.png` });
  const crossed = await walkAcross(page, seg, dir);
  check('vine bridge can be walked across', crossed.done, `${crossed.d.toFixed(1)} of ${dir.len.toFixed(1)} m, deck=${crossed.onDeck}`);

  await page.evaluate(([x, z]) => window.__WILDLANDS__.teleport(x, z - 2.6, 0), [P1.shrine.x, P1.shrine.z]);
  await waitPrompt(page, /shrine/);
  await page.keyboard.press('KeyE');
  check('shrine awakens and unlocks the next island', await until(page, () => { const s = window.__WILDLANDS__.state(); return s.shrineAwake && s.progression.unlocked.includes(1); }));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/12-shrine-awake.png` });

  await page.keyboard.press('KeyM');
  const mapOpen = await page.waitForSelector('#map:not(.hidden)', { timeout: 8000 }).then(() => true, () => false);
  check('archipelago map opens', mapOpen && (await page.isEnabled('[data-act="sail:1"]')) && !(await page.isEnabled('[data-act="sail:2"]')));
  await page.screenshot({ path: `${OUT}/13-map.png` });
  await page.click('[data-act="sail:1"]');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/14-sailing.png` });
  check('boat carries you to Frostmere', await until(page, () => { const s = window.__WILDLANDS__.state(); return s.level === 1 && s.mode === 'play'; }, 180000));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/15-frostmere-arrival.png` });

  // ---- Island 2 (winter) ---------------------------------------------------
  const P2 = await page.evaluate(() => window.__WILDLANDS__.plan());
  await page.evaluate(([x, z]) => window.__WILDLANDS__.teleport(x, z - 1.4, 0), [P2.ember.x, P2.ember.z]);
  await waitPrompt(page, /ember/);
  await page.keyboard.press('KeyE');
  check('seasons carry over between islands', await until(page, () => window.__WILDLANDS__.state().seasons.join() === 'spring,winter'));
  const ice = P2.segments[0];
  const idir = unit(ice);
  await page.evaluate(([x, z, h, yaw]) => { window.__WILDLANDS__.teleport(x, z, h); window.__WILDLANDS__.setCamera(yaw, 0.4, 8); window.__WILDLANDS__.setSeason('winter'); }, [ice.a.x - idir.x * 1.5, ice.a.z - idir.z * 1.5, idir.h, idir.yaw]);
  await until(page, () => window.__WILDLANDS__.state().field.intensity > 0.9);
  await page.waitForTimeout(3000);
  const iceWalk = await walkAcross(page, ice, idir, true);
  check('winter freezes the lagoon into walkable ice', iceWalk.done && iceWalk.onIce, `${iceWalk.d.toFixed(1)} of ${idir.len.toFixed(1)} m`);
  await page.evaluate(([yaw]) => window.__WILDLANDS__.setCamera(yaw + 2.4, 0.5, 9), [idir.yaw]);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/16-winter-ice.png` });

  // Save survives a reload, on the right island.
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__WILDLANDS__.openMap());
  await page.keyboard.press('Escape');
  await page.reload();
  await page.waitForFunction(() => window.__WILDLANDS__?.mode === 'title', null, { timeout: 120000 });
  const reloaded = await page.evaluate(() => ({ s: window.__WILDLANDS__.state(), raw: JSON.parse(localStorage.getItem('wildlands.save')) }));
  check('save survives reload', reloaded.s.level === 1 && reloaded.s.progression.completed.includes(0) && reloaded.raw.levels[0].collected.includes('sea-glass'), `level ${reloaded.s.level}`);

  // Corrupt save must not break startup. (Written before any page script
  // runs, because the game saves on pagehide.)
  await page.addInitScript(() => localStorage.setItem('wildlands.save', '{not json'));
  await page.reload();
  await page.waitForFunction(() => window.__WILDLANDS__?.mode === 'title', null, { timeout: 120000 });
  check('corrupt save is ignored', (await state(page)).level === 0);

  // Narrow viewport.
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(800);
  check('title usable at narrow width', await page.isVisible('#start-btn'));
  await page.screenshot({ path: `${OUT}/08-narrow-title.png` });

  // ---- Islands 3-5 on the low preset, with every season granted ----------
  for (const [n, shot] of [[3, '17-emberwood-hedge'], [4, '18-galehaven-windmill'], [5, '19-stormpeak']]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const p = await ctx.newPage();
    p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE || `http://localhost:${PORT}`}/?quality=low&level=${n}`);
    await p.waitForFunction(() => window.__WILDLANDS__?.mode === 'title', null, { timeout: 120000 });
    await p.click('#start-btn');
    await p.waitForFunction(() => window.__WILDLANDS__.mode === 'play');
    await p.evaluate(() => window.__WILDLANDS__.grantAll());
    const P = await p.evaluate(() => window.__WILDLANDS__.plan());
    let ok = true;
    let note = '';
    for (const sg of P.segments) {
      const d = unit(sg);
      const season = { vine: 'spring', hedge: 'autumn', drawbridge: 'storm', ice: 'winter' }[sg.type];
      await p.evaluate(([x, z, h, yaw, se]) => { const W = window.__WILDLANDS__; W.teleport(x, z, h); W.setCamera(yaw + 0.7, 0.35, 10); W.setSeason(se); }, [sg.a.x - d.x * 1.6, sg.a.z - d.z * 1.6, d.h, d.yaw, season]);
      if (sg.type !== 'ice') {
        const solved = await until(p, (id) => window.__WILDLANDS__.state().puzzles.find((q) => q.id === id).solved, 150000, sg.id);
        if (sg === P.segments[0]) {
          await p.evaluate(([yaw]) => window.__WILDLANDS__.setCamera(yaw + 0.9, 0.42, 16), [d.yaw]);
          await p.waitForTimeout(3000);
          await p.screenshot({ path: `${OUT}/${shot}.png` });
        }
        if (!solved) { ok = false; note += `${sg.type} unsolved; `; }
        await p.waitForTimeout(2500);
      } else {
        await until(p, () => window.__WILDLANDS__.state().field.intensity > 0.9);
        await p.waitForTimeout(3000);
      }
      await p.evaluate(([yaw]) => window.__WILDLANDS__.setCamera(yaw, 0.4, 8), [d.yaw]);
      const w = await walkAcross(p, sg, d, sg.type === 'ice');
      if (!w.done) { ok = false; note += `${sg.type} not crossed (${w.d.toFixed(1)}/${d.len.toFixed(1)}); `; }
    }
    await p.evaluate(([x, z]) => window.__WILDLANDS__.teleport(x, z - 2.6, 0), [P.shrine.x, P.shrine.z]);
    await waitPrompt(p, /shrine/);
    await p.keyboard.press('KeyE');
    const awake = await until(p, () => window.__WILDLANDS__.state().shrineAwake);
    if (n === 5) {
      await p.waitForTimeout(3000);
      await p.screenshot({ path: `${OUT}/20-stormpeak-finale.png` });
      check('finale completes the archipelago', awake && (await state(p)).progression.completed.includes(4));
    }
    check(`island ${n}: every crossing solvable and shrine wakes`, ok && awake, note);
    await ctx.close();
  }

  const realErrors = errors.filter((e) => !/pointer ?lock/i.test(e));
  check('no runtime errors during session', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
} catch (err) {
  console.error(err);
  failed = true;
} finally {
  await browser.close();
  server?.kill();
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
process.exit(failed || bad.length ? 1 : 0);
