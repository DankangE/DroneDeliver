// Automated playtest: builds the game and serves it with Vite preview in-process, drives the game in
// Chrome with real keyboard input plus the ?debug=1 hook, plays Stages 1-4 to the end, triggers and
// resolves battery / GPS / rotor events, packs ice packs and steadies fragile drops on Stage 3, drops on
// the roof pad and winches boxes onto balcony cradles on Stage 4, and saves screenshots to docs/screenshots/.
//
//   npm run playtest                 # uses the installed Google Chrome
//   CHROME_PATH=/path/to/chrome npm run playtest
//   PLAYTEST_SPEED=3 npm run playtest   # game time-scale after the first trip
//   PLAYTEST_ONLY=4 npm run playtest    # one stage
//   PLAYTEST_FULL=1 npm run playtest    # ignore the target and play the whole shift (measures the bot score)
import assert from 'node:assert/strict';
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
const full = process.env.PLAYTEST_FULL === '1';
const FRAGILE_MAX = 1.2;

const configFile = join(root, 'vite.config.ts');
await build({ root, configFile, logLevel: 'warn' });
const server = await preview({ root, configFile, preview: { port: 5199, strictPort: false } });
const url = `${server.resolvedUrls.local[0]}?debug=1&nolock=1`;
const gpuArgs = ['--ignore-gpu-blocklist'];
if (process.platform === 'darwin') gpuArgs.push('--use-angle=metal');
const browser = await chromium.launch({
  headless: process.env.HEADED !== '1',
  executablePath: process.env.CHROME_PATH,
  channel: process.env.CHROME_PATH ? undefined : 'chrome',
  // Real GPU by default (Metal on macOS); PLAYTEST_GL=swiftshader forces the software renderer.
  args: [...(process.env.PLAYTEST_GL === 'swiftshader'
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : gpuArgs), '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const wait = (ms) => page.waitForTimeout(ms);
const snap = () => page.evaluate(() => window.__game.snapshot());
const g = (fn, arg) => page.evaluate(fn, arg);
const results = { trips: [], events: [], stages: [], packTimes: [], packErrors: [], fragileDrops: [], winches: [] };

async function shot(name) {
  const file = join(shots, `${name}.png`);
  await page.screenshot({ path: file });
  // Shrink desktop shots to 800 px wide (macOS sips); never upscale narrow ones.
  if ((page.viewportSize()?.width ?? 0) > 800) {
    try { execFileSync('sips', ['--resampleWidth', '800', file], { stdio: 'ignore' }); } catch { /* keep full size */ }
  }
  console.log('  screenshot', file);
}

// Frames per second over `ms` of real time (information only).
const fps = (ms = 3000) => page.evaluate((ms) => new Promise((done) => {
  let n = 0; const t0 = performance.now();
  const tick = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(tick); else done(Math.round((n * 1000) / (performance.now() - t0))); };
  requestAnimationFrame(tick);
}), ms);

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
async function goto(name) {
  await g(name => window.__game.goto(name), name);
  await page.waitForFunction(name => {
    const { phase, target } = window.__game.snapshot();
    if (phase !== 'playing') return true;
    const [kind, idx] = name.split(':');
    return target?.kind === kind && (idx === undefined || (target.bay ?? target.idx) === Number(idx));
  }, name, { timeout: 5000 });
}

async function use(name) {
  await goto(name);
  await press('e');
}

let productIds;
const bayOf = id => `bay:${productIds.indexOf(id)}`;

async function freeHands(s) {
  if (!s.carrying) return true;
  if (s.carrying.kind === 'item') await use(bayOf(s.carrying.product));
  else if (s.carrying.kind === 'icepack') await use('freezer');
  else if (s.carrying.kind === 'battery') await use('rack');
  else if (!s.box) await use('table');
  else {
    const pad = s.drones.find(d => d.state === 'pad' && d.orderId == null && !d.fault);
    if (!pad) return false;
    await use(`pad:${pad.idx}`);
  }
  return !(await snap()).carrying;
}

async function ensureConsole() {
  const s = await snap();
  if (s.mode === 'console') return true;
  if (!(await freeHands(s))) return false;
  await use('console');
  return (await snap()).mode === 'console';
}
async function select(idx) {
  const s = await snap();
  if (s.drones.length > 1) await press(String(idx + 1));
}

// `steady`: also wait until the drone has slowed below the fragile drop limit (with a margin).
async function steerAndCommit(droneIdx, wantState, tolerance, steady = false) {
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
      const speed = (await snap()).drones[droneIdx].hspeed;
      if (steady && speed > FRAGILE_MAX - 0.25) continue;
      if (Math.hypot(aim2.x, aim2.z) < tolerance * 1.4) { await press('Space'); return { err, speed }; }
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

async function steerToward(aim, dead) {
  await setKey('d', aim.x > dead);
  await setKey('a', aim.x < -dead);
  await setKey('s', aim.z > dead);
  await setKey('w', aim.z < -dead);
}

// Balcony: line the drone up over the cradle, hold Space to pay the rope out while steering the box
// (aim() = cradle - box), then let go once the box is at cradle height, close and steady.
async function winchDeliver(droneIdx) {
  const t0 = Date.now();
  let spaceDown = false, bottomAt = null, result = null;
  const off = { x: 0, z: 0 };
  const space = async (on) => {
    if (on === spaceDown) return;
    if (on) await page.keyboard.down('Space'); else await page.keyboard.up('Space');
    spaceDown = on;
  };
  try {
    while (Date.now() - t0 < 30000) {
      const s = await snap();
      if (s.phase !== 'playing') break;
      const d = s.drones[droneIdx];
      if ((d.state !== 'hold' && d.state !== 'winch') || d.fault) break;
      const aim = await g(() => window.__game.aim());
      const err = Math.hypot(aim.x, aim.z);
      if (d.state === 'hold') {
        if (err < 0.6 && d.hspeed < 0.8) { await releaseAll(); await space(true); await wait(60); continue; }
      } else {
        await space(true);
        // Hold the hook upwind of the cradle by the box's average wind offset (box - hook).
        const ox = aim.hook.x - aim.x, oz = aim.hook.z - aim.z;
        off.x += (ox - off.x) * 0.08; off.z += (oz - off.z) * 0.08;
        await steerToward({ x: aim.hook.x - off.x, z: aim.hook.z - off.z }, 0.3);
        if (aim.rope >= aim.ropeMax - 0.05) {
          bottomAt ??= Date.now();
          const waited = (Date.now() - bottomAt) * speedNow / 1000;
          if (!results.winchShot && waited > 0.5) { results.winchShot = true; await shot('19c-stage4-winch'); }
          if ((err < 0.7 && aim.sway < 0.6) || (waited > 3 && err < 1 && aim.sway < 0.9) || (waited > 8 && err < 1.8) || waited > 14) {
            await releaseAll();
            await space(false);
            result = { err: +err.toFixed(2), sway: aim.sway, waited: +waited.toFixed(1) };
            await wait(80);
            break;
          }
        }
      }
      if (d.state === 'hold') await steerToward(aim, 0.3);
      await wait(30);
    }
  } finally {
    await releaseAll();
    await space(false);
  }
  return result;
}

async function handleAttention(s) {
  const d = s.drones.find((dr) => dr.state === 'hold' || dr.state === 'winch' || dr.state === 'approach' || (dr.fault === 'gps' && dr.state !== 'pad'));
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
  const order = s.orders.find(o => o.id === d.orderId);
  if ((d.state === 'hold' || d.state === 'winch') && order?.kind === 'balcony') {
    const res = await winchDeliver(d.idx);
    if (res) {
      const graded = (await g(() => window.__game.log.filter(e => e.kind === 'winch-release').at(-1)?.value)) ?? res.err;
      console.log(`  drone ${d.idx + 1} winch release at ${order.dest} (box error ${graded.toFixed(2)} m, sway ${res.sway} m/s, waited ${res.waited}s)`);
      results.winches.push({ dest: order.dest, err: +graded.toFixed(2), sway: res.sway });
    }
    return true;
  }
  if (d.state === 'hold') {
    if (order?.kind === 'roof' && !results.roofShot) { results.roofShot = true; await wait(400); await shot('19b-stage4-roof-drop'); }
    const fragile = !!order?.tags.includes('fragile');
    if (!results.holdShot) { results.holdShot = true; await wait(400); await shot('05-console-drop-view'); }
    if (fragile && !results.gaugeShot) {
      results.gaugeShot = true;
      await setKey('d', true); await wait(250); await setKey('d', false);
      await shot('17-stage3-stability-gauge');
    }
    const drop = await steerAndCommit(d.idx, 'hold', 0.9, fragile);
    if (drop) {
      console.log(`  drone ${d.idx + 1} dropped (aim error ${drop.err.toFixed(2)} m, speed ${drop.speed.toFixed(2)} m/s${fragile ? ', fragile' : ''})`);
      if (fragile) results.fragileDrops.push(drop.speed);
    }
    return true;
  }
  const landing = await steerAndCommit(d.idx, 'approach', 0.8);
  if (landing) {
    console.log(`  drone ${d.idx + 1} landing (pad offset ${landing.err.toFixed(2)} m)`);
    if (s.stage === 1 && !s.stats.trips.length) {
      await page.waitForFunction(() => window.__game.sim.stats.trips.length > 0);
      await wait(600);
      assert.equal((await snap()).mode, 'console');
      await shot('05b-q-prompt');
    }
  }
  return true;
}

async function loadDrone(s) {
  const free = s.drones.find(d => d.state === 'pad' && d.orderId == null && !d.fault && d.battery >= 35);
  if (s.carrying?.kind === 'crate') {
    if (!free) return false;
    await goto(`pad:${free.idx}`);
    if (!results.carryShot) {
      results.carryShot = true;
      await shot('03-carrying-cargo');
    }
    await press('e');
    return true;
  }
  if (!s.box) {
    if (!s.orders.some(o => o.status === 'waiting')) return false;
    await ensureWalk();
    await use('table');
    const after = await snap();
    if (after.phase === 'playing') assert.ok(after.box, 'Table did not start the waiting order');
    return true;
  }
  if (s.box.checked && !free) return false;
  await ensureWalk();
  const order = s.orders.find(o => o.id === s.box.orderId);
  const missing = order.items.flatMap(line => {
    const have = s.box.contents.filter(id => id === line.product).length;
    return Array(Math.max(0, line.qty - have)).fill(line.product);
  });
  const needsIce = order.tags.includes('cold') && !s.box.icePack;
  if (!s.box.checked && !missing.length && needsIce) {
    await use('freezer');
    const picked = await snap();
    if (picked.phase !== 'playing') return true;
    assert.equal(picked.carrying?.kind, 'icepack', 'Freezer did not hand out an ice pack');
    if (!results.iceShot) { results.iceShot = true; await shot('16-stage3-ice-pack'); }
    await use('table');
    const after = await snap();
    if (after.phase === 'playing') assert.equal(after.box?.icePack, true, 'Ice pack did not go into the box');
    return true;
  }
  if (s.box.checked || !missing.length) {
    await use('table');
    const after = await snap();
    if (after.phase !== 'playing') return true;
    if (s.box.checked) assert.equal(after.carrying?.orderId, order.id, 'Seal did not produce a crate');
    else assert.equal(after.box?.checked, true, 'Correct shipment failed the packing check');
    return true;
  }

  const makeError = s.stage === 1 && order.id === 1 && !results.packErrors.length && missing.length === 1;
  const product = makeError ? productIds.find(id => !order.items.some(line => line.product === id)) : missing[0];
  await use(bayOf(product));
  const picked = await snap();
  if (picked.phase !== 'playing') return true;
  assert.equal(picked.carrying?.product, product, 'Bay did not dispense the requested item');
  await use('table');
  if (makeError) {
    await press('e');
    await page.waitForFunction(() => window.__game.log.some(e => e.stage === 1 && e.kind === 'pack-error'));
    const error = await g(() => window.__game.log.find(e => e.stage === 1 && e.kind === 'pack-error'));
    const after = await snap();
    assert.equal(after.box?.checked, false);
    assert.deepEqual(after.box.contents, s.box.contents, 'Failed check should return only the extra item');
    assert.deepEqual(after.box.missing, [{ product: missing[0], qty: 1 }]);
    assert.equal(error.value, 20, 'One extra and one missing unit');
    results.packErrors.push({ stage: s.stage, order: order.id, t: error.t, penalty: error.value });
    await page.waitForFunction(() => document.querySelector('#feed')?.textContent.includes('포장 오류'));
    await wait(100);
    await shot('02d-pack-check-error');
  } else if (!results.tableShot && s.box.contents.length + 1 >= Math.floor((s.box.contents.length + missing.length) / 2)) {
    results.tableShot = true;
    await wait(120);
    await shot('02c-packing-table');
  }
  return true;
}

async function launchReady(s) {
  const ready = s.drones.find((d) => d.state === 'pad' && d.orderId != null && !d.fault && d.battery >= 35);
  if (!ready) return false;
  if (s.stage === 2 && ready.orderId === 1 && s.orders.length === 1) {
    // Time the first departure so the next scheduled order can fly alongside it.
    await page.waitForFunction(() => {
      const sim = window.__game.sim;
      return sim.orders.length > 1 || sim.nextOrderAt - sim.time <= 12;
    }, null, { timeout: 90000 });
  }
  if (!(await ensureConsole())) return false;
  await select(ready.idx);
  await press('Space');
  if (!results.flightShot) {
    results.flightShot = true;
    await wait(4500 / speedNow);
    await shot('04-console-flight');
    results.fpsFlight = await fps(2000);
  }
  return true;
}

async function serviceDrone(s) {
  const broken = s.drones.find((d) => d.state === 'pad' && d.fault === 'motor');
  if (broken) {
    await ensureWalk();
    await goto(`pad:${broken.idx}`);
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
    const cur = await snap();
    if (cur.carrying?.kind !== 'battery') {
      if (!(await freeHands(cur))) return false;
      await use('rack');
    }
    await goto(`pad:${low.idx}`);
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
  await shot({ 1: '01b-briefing-stage1', 2: '09-briefing-stage2', 3: '16a-briefing-stage3', 4: '19a-briefing-stage4' }[stageId]);
  await page.click('#b-go');
  if (full) await g(() => { const s = window.__game.sim; s.stage = { ...s.stage, target: Infinity }; });
  speedNow = 1;
  await g(() => window.__game.setTimeScale(1));
  if (!results.baseShot) {
    results.baseShot = true;
    await wait(250);
    await shot('02-base-first-person');
    results.fpsBase = await fps();
    await goto('bay:5');
    await page.keyboard.down('s');
    try { await page.waitForFunction(() => window.__game.sim.player.x > -5.7); }
    finally { await page.keyboard.up('s'); }
    await page.keyboard.down('ArrowRight');
    try { await page.waitForFunction(() => window.__game.sim.player.yaw < 0.92); }
    finally { await page.keyboard.up('ArrowRight'); }
    await shot('02b-shelf-bays');
  }
  const start = Date.now();
  let triggered = false;
  let twoAirShot = false;
  const scoreline = [];
  while (Date.now() - start < 12 * 60 * 1000) {
    const s = await snap();
    if (s.score !== (scoreline.at(-1)?.score ?? 0)) scoreline.push({ t: Math.round(s.time), score: s.score });
    if (s.phase !== 'playing') break;
    if (s.stats.trips.length >= 1 && speedNow === 1) { speedNow = speed; await g((n) => window.__game.setTimeScale(n), speed); }
    if (stageId === 1 && forcedEvents && !triggered && s.stats.trips.length >= 1 && s.drones[0].state === 'pad') {
      triggered = true;
      await g(() => { window.__game.trigger('battery', 0); });
      results.events.push({ kind: 'battery-low-triggered', drone: 0, t: s.time });
      console.log('  triggered battery-low on drone 1 (on pad)');
      continue;
    }
    if (stageId === 2 && forcedEvents && s.stats.trips.length >= 2 && !results.motorForced && s.drones[1].state === 'pad') {
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
  // Pair each touchdown with the drone's last launch to get the round trip per destination.
  const destOf = new Map(end.orders.map((o) => [o.id, o.dest]));
  const lastLaunch = new Map();
  const byDest = {};
  for (const e of log) {
    if (e.kind === 'launch') lastLaunch.set(e.drone, destOf.get(e.value));
    if (e.kind === 'touchdown' && lastLaunch.has(e.drone)) (byDest[lastLaunch.get(e.drone)] ??= []).push(+e.value.toFixed(1));
  }
  console.log(`  round trips by destination: ${JSON.stringify(byDest)}`);
  const starts = new Map();
  for (const event of log) {
    if (event.kind === 'packing') starts.set(event.value, event.t);
    if (event.kind === 'seal' && starts.has(event.value)) {
      results.packTimes.push({ stage: stageId, order: event.value, seconds: +(event.t - starts.get(event.value)).toFixed(2) });
      starts.delete(event.value);
    }
  }
  console.log(`  phase=${end.phase} score=${end.score}/${end.targetScore} gameTime=${end.time}s trips=${trips.map((t) => t.toFixed(1)).join(', ')}`);
  results.trips.push(...trips.map((t) => ({ stage: stageId, t })));
  results.stages.push({ stage: stageId, phase: end.phase, score: end.score, time: end.time, stats: end.stats, scoreline, byDest });
  console.log(`  score after each delivery: ${scoreline.map((p) => `${p.score}@${p.t}s`).join(', ')}`);
  await wait(300);
  if (!full) await shot({ 1: '11-stage1-clear', 2: '12-stage2-clear', 3: '18-stage3-clear', 4: '20-stage4-clear' }[stageId]);
}

let exitCode = 0;
try {
  await page.goto(url);
  await page.waitForFunction(() => !!window.__game);
  productIds = await g(() => window.__game.products.map(p => p.id));
  await wait(800);
  await shot('01-title');
  for (const stageId of only ? [Number(only)] : [1, 2, 3, 4]) await playStage(stageId, { forcedEvents: true });
  if (!full) await finalChecks();
} catch (e) {
  console.error('\nPLAYTEST ABORTED:', e);
  exitCode = 1;
} finally {
  await releaseAll().catch(() => {});
  console.log('\nRESULTS', JSON.stringify({ ...results, errors }, null, 1));
  if (full) exitCode = errors.length ? 1 : exitCode;
  else if (errors.length || results.stages.some((st) => st.phase !== 'clear') || (results.failCheck && results.failCheck !== 'fail')) exitCode = 1;
  await browser.close();
  await server.close();
  process.exit(exitCode);
}

async function finalChecks() {
  // Lose condition: start Stage 1 and run the clock out.
  await g(() => { window.__game.showBriefing(1); });
  await page.click('#b-go');
  await g(() => { const s = window.__game.sim; s.time = s.stage.timeLimit - 0.5; });
  await page.waitForFunction(() => window.__game.sim.phase === 'fail');
  const fail = await snap();
  console.log(`\nfail check: phase=${fail.phase}`);
  results.failCheck = fail.phase;
  await shot('13-stage-failed');

  // Phone width: desktop-required notice.
  await page.setViewportSize({ width: 390, height: 844 });
  await wait(300);
  results.smallNotice = await page.isVisible('#small-screen');
  await shot('14-phone-notice');

  await page.setViewportSize({ width: 1280, height: 720 });
  await g(() => { window.__game.setTimeScale(1); window.__game.showBriefing(1); });
  await page.click('#b-go');
  await press('Escape');
  await page.waitForSelector('#b-resume');
  await shot('15-quality-menu');
}
