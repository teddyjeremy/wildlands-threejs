// Collects renderer counters per quality preset from a fixed viewpoint.
//   npm run build && node tests/smoke/measure.mjs
// Note: in a headless/software-rendered browser the frame times say more
// about the CPU rasteriser than about a real GPU; the draw call and
// triangle counts are what transfer.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const PORT = 4181;
const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => server.stdout.on('data', (d) => /Local/.test(d) && res()));
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const info = await (await browser.newPage()).evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
});
console.log(info);
for (const q of ['low', 'medium', 'high']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const t0 = Date.now();
  await page.goto(`http://localhost:${PORT}/?quality=${q}`);
  await page.waitForFunction(() => window.__WILDLANDS__?.mode === 'title', null, { timeout: 120000 });
  const load = Date.now() - t0;
  await page.click('#start-btn');
  await page.evaluate(() => {
    const W = window.__WILDLANDS__;
    W.setWeather('clear');
    W.teleport(0, 40, Math.PI);
    W.setCamera(Math.PI, 0.3, 8);
  });
  await page.waitForTimeout(8000);
  const s = await page.evaluate(() => window.__WILDLANDS__.state().stats);
  console.log(JSON.stringify({ quality: q, loadToTitleMs: load, fps: +s.fps.toFixed(1), avgMs: +s.avgMs.toFixed(1), calls: s.calls, triangles: s.triangles, geometries: s.geometries, programs: s.programs }));
  await page.close();
}
await browser.close();
server.kill();
