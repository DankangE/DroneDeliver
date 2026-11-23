// Automated playtest: builds the game and serves it with Vite preview in-process, drives the game in
// Chrome with real keyboard input plus the ?debug=1 hook, plays Stage 1 and
// Stage 2 to the end, triggers and resolves battery / GPS / rotor events, and
// saves screenshots to docs/screenshots/.
//
//   npm run playtest                 # uses the installed Google Chrome
//   CHROME_PATH=/path/to/chrome npm run playtest
//   PLAYTEST_SPEED=3 npm run playtest   # game time-scale after the first trip
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'docs/screenshots');
mkdirSync(shots, { recursive: true });
const speed = Number(process.env.PLAYTEST_SPEED ?? 3);
const only = process.env.PLAYTEST_ONLY;

const configFile = join(root, 'vite.config.ts');
await build({ root, configFile, logLevel: 'warn' });
const server = await preview({ root, configFile, preview: { port: 5199, strictPort: false } });
const url = `${server.resolvedUrls.local[0]}?debug=1&nolock=1`;
const browser = await chromium.launch({
  headless: process.env.HEADED !== '1',
  executablePath: process.env.CHROME_PATH,
  channel: process.env.CHROME_PATH ? undefined : 'chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const wait = (ms) => page.waitForTimeout(ms);
const snap = () => page.evaluate(() => window.__game.snapshot());
const g = (fn, arg) => page.evaluate(fn, arg);
const results = { trips: [], events: [], stages: [] };

async function shot(name) {
  const file = join(shots, `${name}.png`);
  await page.screenshot({ path: file });
  // Shrink desktop shots to 800 px wide (macOS sips); never upscale narrow ones.
  if ((page.viewportSize()?.width ?? 0) > 800) {
    try { execFileSync('sips', ['--resampleWidth', '800', file], { stdio: 'ignore' }); } catch { /* keep full size */ }
  }
  console.log('  screenshot', file);
}

async function press(key) { await page.keyboard.press(key); await wait(40); }
async function holdKey(key, ms) { await page.keyboard.down(key); await wait(ms); await page.keyboard.up(key); }

const held = new Set();
async function setKey(key, on) {
  if (on && !held.has(key)) { await page.keyboard.down(key); held.add(key); }
  if (!on && held.has(key)) { await page.keyboard.up(key); held.delete(key); }
}
async function releaseAll() { for (const k of [...held]) await setKey(k, false); }

async function ensureWalk() {
  const s = await snap();
  if (s.mode === 'console') { await releaseAll(); await press('q'); }
}
async function ensureConsole() {
  let s = await snap();
  if (s.mode === 'console') return true;
  if (s.carrying) return false;
  await g(() => window.__game.goto('console'));
  await wait(60);
  await press('e');
  s = await snap();
  return s.mode === 'console';
}
async function select(idx) {
  const s = await snap();
  if (s.drones.length > 1) await press(String(idx + 1));
}

async function steerAndCommit(droneIdx, wantState, tolerance) {
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    const s = await snap();
    if (s.phase !== 'playing') break;
    const d = s.drones[droneIdx];
    if (d.state !== wantState || d.fault) break;
    const aim = await g(() => window.__game.aim());
    const err = Math.hypot(aim.x, aim.z);
    if (err < tolerance) {
      await releaseAll();
      await wait(120);
      const aim2 = await g(() => window.__game.aim());
      if (Math.hypot(aim2.x, aim2.z) < tolerance * 1.4) { await press('Space'); return err; }
      continue;
    }
    await setKey('d', aim.x > 0.35);
    await setKey('a', aim.x < -0.35);
    await setKey('s', aim.z > 0.35);
    await setKey('w', aim.z < -0.35);
    await wait(30);
  }
  await releaseAll();
  return null;
}

async function handleAttention(s) {
  const d = s.drones.find((dr) => dr.state === 'hold' || dr.state === 'approach' || (dr.fault === 'gps' && dr.state !== 'pad'));
  if (!d) return false;
  if (!(await ensureConsole())) return false;
  await select(d.idx);
  if (d.fault === 'gps') {
    results.events.push({ kind: 'gps-fault', drone: d.idx, t: s.time });
    if (!results.gpsShot) { results.gpsShot = true; await wait(300); await shot('06-event-gps-fault'); }
    await holdKey('f', 2400 / speedNow);
    const after = await snap();
    console.log(`  GPS fault on drone ${d.idx + 1} -> fault now ${after.drones[d.idx].fault}`);
    results.events.push({ kind: 'gps-fixed', ok: after.drones[d.idx].fault === null });
    return true;
  }
  if (d.state === 'hold') {
    if (!results.holdShot) { results.holdShot = true; await wait(400); await shot('05-console-drop-view'); }
    const err = await steerAndCommit(d.idx, 'hold', 0.9);
    if (err != null) console.log(`  drone ${d.idx + 1} dropped (aim error ${err.toFixed(2)} m)`);
    return true;
  }
  const err = await steerAndCommit(d.idx, 'approach', 0.8);
  if (err != null) console.log(`  drone ${d.idx + 1} landing (pad offset ${err.toFixed(2)} m)`);
  return true;
}

async function loadDrone(s) {
  const free = s.drones.find((d) => d.state === 'pad' && d.orderId == null && !d.fault && d.battery >= 35);
  const order = s.orders.filter((o) => o.status === 'waiting').sort((a, b) => a.id - b.id)[0];
  if (!free || !order) return false;
  await ensureWalk();
  await g((slot) => window.__game.goto(`shelf:${slot}`), order.slot);
  await wait(80);
  if (!results.baseShot) { results.baseShot = true; await shot('02-base-first-person'); }
  await press('e');
  await g((i) => window.__game.goto(`pad:${i}`), free.idx);
  await wait(80);
  if (!results.carryShot) { results.carryShot = true; await shot('03-carrying-cargo'); }
  await press('e');
  return true;
}

async function launchReady(s) {
  const ready = s.drones.find((d) => d.state === 'pad' && d.orderId != null && !d.fault && d.battery >= 35);
  if (!ready) return false;
  if (!(await ensureConsole())) return false;
  await select(ready.idx);
  await press('Space');
  if (!results.flightShot) {
    results.flightShot = true;
    await wait(4500 / speedNow);
    await shot('04-console-flight');
  }
  return true;
}

async function serviceDrone(s) {
  const broken = s.drones.find((d) => d.state === 'pad' && d.fault === 'motor');
  if (broken) {
    await ensureWalk();
    await g((i) => window.__game.goto(`pad:${i}`), broken.idx);
    await wait(60);
    if (!results.motorShot) { results.motorShot = true; await page.keyboard.down('e'); await wait(800 / speedNow); await shot('07-event-rotor-repair'); await wait(1600 / speedNow); await page.keyboard.up('e'); }
    else await holdKey('e', 2300 / speedNow);
    const after = await snap();
    results.events.push({ kind: 'motor-repair', drone: broken.idx, ok: after.drones[broken.idx].fault === null });
    console.log(`  rotor repair on drone ${broken.idx + 1} -> fault now ${after.drones[broken.idx].fault}`);
    return true;
  }
  const low = s.drones.find((d) => d.state === 'pad' && d.battery < 35);
  if (low) {
    await ensureWalk();
    let cur = await snap();
    if (cur.carrying?.kind === 'crate') {
      // Hands full: put the crate back on a free shelf slot first.
      const used = new Set(cur.orders.filter((o) => o.status === 'waiting').map((o) => o.slot));
      const slot = [0, 1, 2, 3].find((i) => !used.has(i));
      if (slot == null) return false;
      await g((n) => window.__game.goto(`shelf:${n}`), slot);
      await wait(60);
      await press('e');
    }
    cur = await snap();
    if (cur.carrying?.kind !== 'battery') {
      await g(() => window.__game.goto('rack'));
      await wait(60);
      await press('e');
    }
    await g((i) => window.__game.goto(`pad:${i}`), low.idx);
    await wait(60);
    if (!results.swapShot) { results.swapShot = true; await shot('08-event-battery-swap'); }
    await press('e');
    const after = await snap();
    results.events.push({ kind: 'battery-swap', drone: low.idx, before: low.battery, after: after.drones[low.idx].battery });
    console.log(`  battery swap on drone ${low.idx + 1}: ${low.battery}% -> ${after.drones[low.idx].battery}%`);
    if (after.drones[low.idx].battery < 35) console.log(`    swap failed: mode=${after.mode} carrying=${JSON.stringify(after.carrying)} target=${JSON.stringify(after.target)} drone=${JSON.stringify(after.drones[low.idx])}`);
    return true;
  }
  return false;
}

let speedNow = 1;
async function playStage(stageId, { forcedEvents }) {
  console.log(`\n=== Stage ${stageId} ===`);
  await g((id) => { window.__game.showBriefing(id); }, stageId);
  await wait(200);
  await shot(stageId === 1 ? '01b-briefing-stage1' : '09-briefing-stage2');
  await page.click('#b-go');
  speedNow = 1;
  await g(() => window.__game.setTimeScale(1));
  const start = Date.now();
  let triggered = false;
  let twoAirShot = false;
  while (Date.now() - start < 12 * 60 * 1000) {
    const s = await snap();
    if (s.phase !== 'playing') break;
    if (s.stats.trips.length >= 1 && speedNow === 1) { speedNow = speed; await g((n) => window.__game.setTimeScale(n), speed); }
    if (stageId === 1 && forcedEvents && !triggered && s.stats.trips.length >= 1 && s.drones[0].state === 'pad') {
      triggered = true;
      await g(() => { window.__game.trigger('battery', 0); });
      results.events.push({ kind: 'battery-low-triggered', drone: 0, t: s.time });
      console.log('  triggered battery-low on drone 1 (on pad)');
      continue;
    }
    if (stageId === 2 && forcedEvents && s.stats.trips.length === 2 && !results.motorForced && s.drones[1].state === 'pad') {
      results.motorForced = true;
      await g(() => window.__game.trigger('motor', 1));
      console.log('  triggered rotor fault on drone 2');
      continue;
    }
    if (stageId === 2 && !twoAirShot && s.drones.every((d) => d.state !== 'pad')) {
      const sel = await ensureConsole();
      if (sel) { twoAirShot = true; await wait(300); await shot('10-stage2-two-drones'); }
    }
    if (await handleAttention(s)) continue;
    if (await launchReady(s)) continue;
    if (await serviceDrone(s)) continue;
    if (await loadDrone(s)) continue;
    await wait(60);
  }
  await releaseAll();
  const end = await snap();
  const log = await g(() => window.__game.log.filter((e) => e.stage === window.__game.sim.stage.id));
  const trips = log.filter((e) => e.kind === 'touchdown').map((e) => e.value);
  console.log(`  phase=${end.phase} score=${end.score}/${stageId === 1 ? 450 : 1000} gameTime=${end.time}s trips=${trips.map((t) => t.toFixed(1)).join(', ')}`);
  results.trips.push(...trips.map((t) => ({ stage: stageId, t })));
  results.stages.push({ stage: stageId, phase: end.phase, score: end.score, time: end.time, stats: end.stats });
  await wait(300);
  await shot(stageId === 1 ? '11-stage1-clear' : '12-stage2-clear');
}

try {
  await page.goto(url);
  await page.waitForFunction(() => !!window.__game);
  await wait(800);
  await shot('01-title');
  if (only !== '2') await playStage(1, { forcedEvents: true });
  if (only !== '1') await playStage(2, { forcedEvents: true });

  // Lose condition: start Stage 1 and run the clock out.
  await g(() => { window.__game.showBriefing(1); });
  await page.click('#b-go');
  await g(() => { const s = window.__game.sim; s.time = s.stage.timeLimit - 0.5; });
  await wait(600);
  const fail = await snap();
  console.log(`\nfail check: phase=${fail.phase}`);
  results.failCheck = fail.phase;
  await shot('13-stage-failed');

  // Phone width: desktop-required notice.
  await page.setViewportSize({ width: 390, height: 844 });
  await wait(300);
  results.smallNotice = await page.isVisible('#small-screen');
  await shot('14-phone-notice');
} finally {
  await releaseAll().catch(() => {});
  console.log('\nRESULTS', JSON.stringify({ ...results, errors }, null, 1));
  await browser.close();
  await server.close();
  process.exit(0);
}
