// Frame-rate benchmark per graphics quality preset, in a real (headed by default) Chrome window.
// Builds the game, serves it with Vite preview in-process, and for each preset measures
// the depot view (standing at the start, looking out to the pads) and the console view
// (a drone in flight, chase camera).
//
//   npm run fps                                  # 1280x720 CSS px at 2x = 2560x1440 pixels
//   FPS_W=1512 FPS_H=900 FPS_DPR=2 npm run fps    # other window sizes
//   FPS_PRESETS=medium,auto HEADLESS=1 npm run fps
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const width = Number(process.env.FPS_W ?? 1280);
const height = Number(process.env.FPS_H ?? 720);
const dpr = Number(process.env.FPS_DPR ?? 2);
const presets = (process.env.FPS_PRESETS ?? 'low,medium,high').split(',');
const configFile = join(root, 'vite.config.ts');

await build({ root, configFile, logLevel: 'warn' });
const server = await preview({ root, configFile, preview: { port: 5198, strictPort: false } });
const url = `${server.resolvedUrls.local[0]}?debug=1&nolock=1`;
const args = ['--ignore-gpu-blocklist'];
if (process.platform === 'darwin') args.push('--use-angle=metal');
const browser = await chromium.launch({
  headless: process.env.HEADLESS === '1',
  executablePath: process.env.CHROME_PATH,
  channel: process.env.CHROME_PATH ? undefined : 'chrome',
  args,
});

const fps = (page, ms) => page.evaluate((ms) => new Promise((done) => {
  const times = []; const t0 = performance.now();
  const tick = (t) => { times.push(t); if (t - t0 < ms) requestAnimationFrame(tick); else done(times); };
  requestAnimationFrame(tick);
}), ms).then((times) => {
  const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
  const mean = (times.at(-1) - times[0]) / gaps.length;
  return { fps: Math.round(1000 / mean), p95ms: +gaps[Math.floor(gaps.length * 0.95)].toFixed(1) };
});

const rows = [];
let exitCode = 0;
try {
  for (const preset of presets) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(url);
    await page.waitForFunction(() => !!window.__game);
    await page.evaluate((q) => { window.__game.world.setQuality(q); window.__game.showBriefing(1); window.__game.begin(); }, preset);
    await page.waitForTimeout(2500);
    const depot = await fps(page, 4000);
    const depotInfo = await page.evaluate(() => window.__game.renderInfo());
    await page.waitForFunction(() => window.__game.sim.orders.some((o) => o.status === 'waiting'), null, { timeout: 15000 });
    await page.evaluate(() => { window.__game.debugLoad(0); window.__game.goto('console'); });
    await page.waitForTimeout(100);
    await page.keyboard.press('e');
    await page.waitForTimeout(100);
    await page.keyboard.press('Space');
    await page.waitForTimeout(4500);
    const flight = await fps(page, 4000);
    const flightInfo = await page.evaluate(() => window.__game.renderInfo());
    rows.push({ preset, tier: flightInfo.quality.tier, buffer: flightInfo.buffer.join('x'), depot: depot.fps, depotP95ms: depot.p95ms, console: flight.fps, consoleP95ms: flight.p95ms, depotCalls: depotInfo.calls, consoleCalls: flightInfo.calls, errors: errors.length });
    if (errors.length) { console.error(errors); exitCode = 1; }
    await page.close();
  }
} catch (e) {
  console.error('FPS RUN ABORTED:', e);
  exitCode = 1;
} finally {
  console.log(`window ${width}x${height} CSS px @${dpr}x, ${process.env.HEADLESS === '1' ? 'headless' : 'headed'}`);
  console.table(rows);
  console.log('FPS_JSON', JSON.stringify(rows));
  await browser.close();
  await server.close();
  process.exit(exitCode);
}
