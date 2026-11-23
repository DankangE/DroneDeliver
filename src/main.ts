import './style.css';
import { BASE, STAGES } from './config';
import { initAudio, play, setHum, toggleMute } from './audio';
import { handleEvent, resetHud, updateHud } from './hud';
import { consolePrimary, createSim, interact, leaveConsole, needsAttention, orderById, predictImpact, selectDrone, startPlaying, step, type Input, type Sim, type SimEvent, type Target } from './sim';
import { World } from './world';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const hudEl = document.getElementById('hud')!;
const screen = document.getElementById('screen')!;
const card = document.getElementById('screen-card')!;
const world = new World(canvas);
const debug = new URLSearchParams(location.search).get('debug') === '1';

let sim: Sim = createSim(1);
let timeScale = 1;
let paused = false;
let onTitle = true;
const keys = new Set<string>();
const log: Array<SimEvent & { t: number; stage: number }> = [];

function resize() { world.resize(window.innerWidth, window.innerHeight); }
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------ screens

function showCard(htmlStr: string, extraClass = '') {
  card.className = `card ${extraClass}`;
  card.innerHTML = htmlStr;
  screen.classList.remove('hidden');
}
function hideCard() { screen.classList.add('hidden'); }
function bind(id: string, fn: () => void) { document.getElementById(id)?.addEventListener('click', () => { initAudio(); fn(); }); }

const CONTROLS = `<div class="ctrl">
  <kbd>W A S D</kbd><span>Walk (in the base) · steer the drone (at the console)</span>
  <kbd>Mouse</kbd><span>Look around (click the view to capture the mouse; ← → also turn)</span>
  <kbd>E</kbd><span>Pick up / attach / swap battery · hold to repair · sit at console</span>
  <kbd>Space</kbd><span>Console: launch · drop package · begin landing</span>
  <kbd>F</kbd><span>Console: hold to recalibrate a drone's GPS</span>
  <kbd>1 2 Tab</kbd><span>Console: switch drone feed</span>
  <kbd>Q</kbd><span>Leave the console</span>
  <kbd>P / M</kbd><span>Pause · mute</span>
</div>`;

function showTitle() {
  onTitle = true;
  hudEl.classList.add('hidden');
  showCard(`<div class="logo">SKYHOOK DEPOT</div>
    <h1>Drone delivery operator</h1>
    <p>You run a drone delivery depot. Orders come in, you carry the crates to the pads, hook them under a drone and fly each run from the control console: launch, drop on the target ring, bring it home and land it.</p>
    ${CONTROLS}
    <div class="btns"><button class="primary" id="b-start">Start shift</button><button id="b-s2">Jump to Stage 2</button></div>`);
  bind('b-start', () => showBriefing(1));
  bind('b-s2', () => showBriefing(2));
}

function showBriefing(stageId: number) {
  onTitle = false;
  sim = createSim(stageId);
  log.push({ type: 'log', kind: 'stage-start', value: stageId, t: 0, stage: stageId });
  resetHud();
  world.resetCamera();
  hudEl.classList.remove('hidden');
  const st = sim.stage;
  showCard(`<h2>Stage ${st.id} briefing</h2><h1>${st.name}</h1>
    <ul>${st.briefing.map((b) => `<li>${b}</li>`).join('')}</ul>
    <div class="goal"><div><b>${st.target}</b><span>TARGET PTS</span></div><div><b>${Math.floor(st.timeLimit / 60)}:00</b><span>SHIFT TIME</span></div><div><b>${st.drones}</b><span>DRONE${st.drones > 1 ? 'S' : ''}</span></div></div>
    <p>Each delivery: 100 pts, +60 for a perfect drop, +25 good, +30 on time. Consecutive deliveries build a combo up to x2. Missed drops and expired orders cost points.</p>
    <div class="btns"><button class="primary" id="b-go">Begin shift</button><button id="b-title">Title</button></div>`);
  bind('b-go', begin);
  bind('b-title', showTitle);
}

function begin() {
  hideCard();
  startPlaying(sim);
  paused = false;
  lockPointer();
}

function rank(s: Sim) {
  const frac = s.timeLeft / s.stage.timeLimit;
  if (frac > 0.3 && s.stats.missed === 0 && s.stats.crashes === 0) return 'S';
  if (frac > 0.15) return 'A';
  return 'B';
}

function showResult() {
  document.exitPointerLock?.();
  const s = sim;
  const won = s.phase === 'clear';
  const last = s.stage.id === STAGES[STAGES.length - 1].id;
  const avgTrip = s.stats.trips.length ? (s.stats.trips.reduce((a, b) => a + b, 0) / s.stats.trips.length).toFixed(1) + ' s' : '—';
  const stats = `<div class="stats">
    <span>Score</span><span>${s.score} / ${s.stage.target}</span>
    <span>Time used</span><span>${Math.floor(s.time / 60)}:${String(Math.floor(s.time % 60)).padStart(2, '0')}</span>
    <span>Deliveries</span><span>${s.stats.delivered}</span>
    <span>Perfect / good drops</span><span>${s.stats.perfect} / ${s.stats.good}</span>
    <span>Missed · expired · crashes</span><span>${s.stats.missed} · ${s.stats.expired} · ${s.stats.crashes}</span>
    <span>Faults fixed · battery swaps</span><span>${s.stats.faultsFixed} · ${s.stats.swaps}</span>
    <span>Best combo</span><span>${s.stats.bestStreak}</span>
    <span>Average round trip</span><span>${avgTrip}</span>
    ${won ? `<span>Rank</span><span>${rank(s)}</span>` : ''}
  </div>`;
  if (won) {
    showCard(`<h2>Stage ${s.stage.id} clear</h2><h1>${last ? 'Shift complete' : 'Target reached'}</h1>${stats}
      <div class="btns">${last ? '' : '<button class="primary" id="b-next">Next stage</button>'}<button id="b-retry">Replay stage</button><button id="b-title">Title</button></div>`, 'result-good');
    bind('b-next', () => showBriefing(s.stage.id + 1));
  } else {
    showCard(`<h2>Stage ${s.stage.id} failed</h2><h1>Shift over</h1><p>The shift ended before the depot reached its target.</p>${stats}
      <div class="btns"><button class="primary" id="b-retry">Retry stage</button><button id="b-title">Title</button></div>`, 'result-bad');
  }
  bind('b-retry', () => showBriefing(s.stage.id));
  bind('b-title', showTitle);
}

function setPaused(p: boolean) {
  if (sim.phase !== 'playing' || paused === p) return;
  paused = p;
  if (p) {
    showCard(`<h2>Paused</h2><h1>Shift on hold</h1>${CONTROLS}<div class="btns"><button class="primary" id="b-resume">Resume</button><button id="b-retry">Restart stage</button><button id="b-title">Title</button></div>`);
    bind('b-resume', () => { setPaused(false); lockPointer(); });
    bind('b-retry', () => { paused = false; showBriefing(sim.stage.id); });
    bind('b-title', () => { paused = false; showTitle(); });
  } else hideCard();
}

// ------------------------------------------------------------ input

let wasLocked = false;
function lockPointer() {
  if (debug && new URLSearchParams(location.search).get('nolock') === '1') return;
  try { void canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* not available */ }
}
canvas.addEventListener('click', () => { initAudio(); if (sim.phase === 'playing' && !paused) lockPointer(); });
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (wasLocked && !locked && sim.phase === 'playing') setPaused(true);
  wasLocked = locked;
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas || sim.player.mode !== 'walk' || paused) return;
  sim.player.yaw -= e.movementX * 0.0022;
  sim.player.pitch = Math.max(-1.3, Math.min(1.3, sim.player.pitch - e.movementY * 0.0022));
});

window.addEventListener('keydown', (e) => {
  if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (onTitle || screen.classList.contains('hidden') === false && !paused) {
    if (e.code === 'Enter') (card.querySelector('button.primary') as HTMLButtonElement | null)?.click();
    return;
  }
  if (e.code === 'Escape') { setPaused(true); return; }
  if (e.code === 'KeyP') { setPaused(!paused); if (!paused) lockPointer(); return; }
  if (e.code === 'KeyM') { toggleMute(); return; }
  if (paused || sim.phase !== 'playing') return;
  if (sim.player.mode === 'walk') {
    if (e.code === 'KeyE') interact(sim);
  } else {
    if (e.code === 'Space') consolePrimary(sim);
    else if (e.code === 'Digit1') selectDrone(sim, 0);
    else if (e.code === 'Digit2') selectDrone(sim, 1);
    else if (e.code === 'Tab') selectDrone(sim, (sim.selected + 1) % sim.drones.length);
    else if (e.code === 'KeyQ') leaveConsole(sim);
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

function readInput(dt: number): Input {
  const k = (c: string) => (keys.has(c) ? 1 : 0);
  if (sim.player.mode === 'walk') sim.player.yaw += (k('ArrowLeft') - k('ArrowRight')) * 2.2 * dt;
  const ax = k('KeyD') - k('KeyA');
  const az = k('KeyS') - k('KeyW');
  return {
    move: { f: k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown'), r: ax },
    nudge: { x: ax, z: az },
    interactHeld: keys.has('KeyE'),
    fixHeld: keys.has('KeyF'),
  };
}

// ------------------------------------------------------------ loop

let last = performance.now();
let pingTimer = 0;
const STEP = 1 / 60;
function frame(now: number) {
  const realDt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!paused && sim.phase === 'playing') {
    const input = readInput(realDt);
    let remaining = realDt * timeScale;
    while (remaining > 1e-6) {
      const h = Math.min(STEP, remaining);
      step(sim, input, h);
      remaining -= h;
      if (sim.phase !== 'playing') break;
    }
    for (const e of sim.events) {
      if (e.type === 'sfx') play(e.name);
      else handleEvent(e);
      if (e.type === 'log' || e.type === 'banner') log.push({ ...e, t: +sim.time.toFixed(2), stage: sim.stage.id });
    }
    sim.events.length = 0;
    pingTimer -= realDt;
    if (pingTimer <= 0 && sim.drones.some(needsAttention)) { play('ping'); pingTimer = 3.5; }
    if (sim.phase !== 'playing') showResult();
  }
  const flying = sim.drones.filter((d) => d.state !== 'pad' && d.state !== 'down');
  const near = sim.player.mode === 'console' ? (flying.includes(sim.drones[sim.selected]) ? 1 : 0.2) : flying.reduce((a, d) => a + Math.max(0, 1 - Math.hypot(d.pos.x - sim.player.x, d.pos.y - 1.6, d.pos.z - sim.player.z) / 40), 0);
  setHum(!paused && sim.phase === 'playing' && !onTitle ? near : 0, sim.drones[sim.selected]?.state === 'takeoff' ? 1 : 0.4);
  world.update(sim, realDt);
  if (!onTitle) updateHud(sim, realDt * timeScale, realDt);
  world.render();
  requestAnimationFrame(frame);
}

showTitle();
requestAnimationFrame(frame);

// ------------------------------------------------------------ debug hook (?debug=1)

if (debug) {
  const spots: Record<string, Target> = { rack: { kind: 'rack' }, console: { kind: 'console' } };
  const at = (t: Target) => {
    if (t.kind === 'rack') return { x: BASE.batteryRack.x - 1.6, z: BASE.batteryRack.z, yaw: -Math.PI / 2 };
    if (t.kind === 'console') return { x: BASE.console.x, z: BASE.console.z + 1.6, yaw: 0 };
    if (t.kind === 'shelf') { const p = BASE.shelfSlots[t.slot]; return { x: p.x + 1.6, z: p.z, yaw: Math.PI / 2 }; }
    const p = BASE.pads[t.idx]; return { x: p.x, z: p.z - 2.4, yaw: Math.PI };
  };
  (window as unknown as { __game: unknown }).__game = {
    get sim() { return sim; },
    log,
    setTimeScale(n: number) { timeScale = n; },
    showBriefing,
    begin,
    goto(name: string) {
      const [kind, idx] = name.split(':');
      const t: Target = kind === 'shelf' ? { kind: 'shelf', slot: Number(idx) } : kind === 'pad' ? { kind: 'pad', idx: Number(idx) } : spots[kind];
      const p = at(t);
      sim.player.x = p.x; sim.player.z = p.z; sim.player.yaw = p.yaw; sim.player.pitch = -0.35;
    },
    trigger(kind: 'battery' | 'gps' | 'motor' | 'order', droneIdx = 0) {
      const d = sim.drones[droneIdx];
      if (kind === 'battery') d.battery = Math.min(d.battery, 20);
      if (kind === 'gps') d.faultAt = sim.time;
      if (kind === 'motor') d.fault = 'motor';
      if (kind === 'order') sim.nextOrderAt = sim.time;
    },
    aim() {
      const d = sim.drones[sim.selected];
      const pad = BASE.pads[d.idx];
      if (d.state === 'hold') {
        const o = orderById(sim, d.orderId)!;
        const p = predictImpact(sim, d.pos, d.vel);
        return { x: o.dest.x - p.x, z: o.dest.z - p.z };
      }
      return { x: pad.x - d.pos.x, z: pad.z - d.pos.z };
    },
    snapshot() {
      return {
        phase: sim.phase, stage: sim.stage.id, time: +sim.time.toFixed(2), score: sim.score, mode: sim.player.mode, carrying: sim.player.carrying, target: sim.target,
        drones: sim.drones.map((d) => ({ idx: d.idx, state: d.state, fault: d.fault, battery: +d.battery.toFixed(1), orderId: d.orderId, pos: { x: +d.pos.x.toFixed(1), y: +d.pos.y.toFixed(1), z: +d.pos.z.toFixed(1) } })),
        orders: sim.orders.map((o) => ({ id: o.id, dest: o.dest.id, status: o.status, slot: o.slot })),
        stats: sim.stats,
      };
    },
  };
}
