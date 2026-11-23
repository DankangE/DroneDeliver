import './style.css';
import * as THREE from 'three';
import { BASE, PRODUCTS, SCORE, STAGES } from './config';
import { initAudio, play, setHum, toggleMute } from './audio';
import { handleEvent, resetHud, updateHud } from './hud';
import { QUALITY_LABEL, QUALITY_SETTINGS } from './graphics/quality';
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
  <kbd>W A S D</kbd><span>기지 안 이동 · 콘솔에서는 드론 조종</span>
  <kbd>마우스</kbd><span>둘러보기 (화면을 클릭하면 마우스 고정, ← →로도 회전)</span>
  <kbd>E</kbd><span>꺼내기 · 담기 · 포장 확인 · 봉인 · 드론 연결 · 콘솔 앉기<br>배터리 교체 · 길게 눌러 로터 수리</span>
  <kbd>Space</kbd><span>콘솔에서 출발 · 택배 투하 · 착륙 시작</span>
  <kbd>F</kbd><span>콘솔에서 길게 눌러 GPS 재보정</span>
  <kbd>1 2 Tab</kbd><span>드론 화면 전환</span>
  <kbd>Q</kbd><span>착륙 후 콘솔에서 나가기</span>
  <kbd>Esc / P</kbd><span>일시 정지</span>
  <kbd>M</kbd><span>음소거</span>
</div>`;

const qualityMenu = document.createElement('fieldset');
qualityMenu.className = 'quality-menu';
qualityMenu.innerHTML = `<legend>그래픽 품질</legend>
  <div class="quality-row"><div class="quality-options">${QUALITY_SETTINGS.map(setting =>
    `<label><input type="radio" name="quality" value="${setting}"><span>${QUALITY_LABEL[setting]}</span></label>`
  ).join('')}</div><span class="quality-applied" role="status"></span></div>
  <p>끊기면 낮음을 고르세요. 자동은 측정한 FPS로 고릅니다.</p>`;
for (const setting of QUALITY_SETTINGS) {
  const radio = qualityMenu.querySelector<HTMLInputElement>(`input[value="${setting}"]`)!;
  radio.addEventListener('change', () => {
    world.setQuality(setting);
    syncQualityMenu();
  });
}
let displayedQuality: World['quality'] | undefined;
function syncQualityMenu() {
  const { setting, tier } = world.quality;
  if (displayedQuality?.setting === setting && displayedQuality.tier === tier) return;
  displayedQuality = { setting, tier };
  qualityMenu.querySelector<HTMLInputElement>(`input[value="${setting}"]`)!.checked = true;
  qualityMenu.querySelector('.quality-applied')!.textContent = `현재 적용: ${QUALITY_LABEL[tier]}${setting === 'auto' ? ' (자동)' : ''}`;
}
function mountQualityMenu() {
  card.append(qualityMenu);
  syncQualityMenu();
}

function showTitle() {
  onTitle = true;
  hudEl.classList.add('hidden');
  showCard(`<div class="logo">하늘길 택배</div>
    <h1>드론 배송 관제사</h1>
    <p>라면 두 개와 생수 한 병을 주문한 이웃이 기다립니다. 선반에서 주문 상품을 꺼내 포장대에 담고, 수량을 확인해 상자를 봉인하세요. 드론에 연결한 뒤 콘솔에서 출발과 투하, 귀환 착륙을 맡으세요.</p>
    ${CONTROLS}
    <div class="btns"><button class="primary" id="b-start">근무 시작</button><button id="b-s2">스테이지 2 바로 가기</button></div>`);
  mountQualityMenu();
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
  showCard(`<h2>스테이지 ${st.id} 브리핑</h2><h1>${st.name}</h1>
    <ul>${st.briefing.map((b) => `<li>${b}</li>`).join('')}</ul>
    <div class="goal"><div><b>${st.target}</b><span>목표 점수</span></div><div><b>${Math.floor(st.timeLimit / 60)}:00</b><span>근무 시간</span></div><div><b>${st.drones}</b><span>드론 대수</span></div></div>
    <p>배송 1건 100점, 완벽 투하 +60, 우수 +25, 정시 +30. 연속 배송은 최대 x2까지 콤보가 쌓입니다. 포장 확인 때 잘못 담거나 부족한 수량 하나당 ${SCORE.packErrorPenalty}점이 깎입니다. 투하 실패와 기한 초과도 감점입니다.</p>
    <div class="btns"><button class="primary" id="b-go">근무 시작</button><button id="b-title">타이틀</button></div>`);
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
  const avgTrip = s.stats.trips.length ? (s.stats.trips.reduce((a, b) => a + b, 0) / s.stats.trips.length).toFixed(1) + '초' : '—';
  const stats = `<div class="stats">
    <span>점수</span><span>${s.score} / ${s.stage.target}</span>
    <span>걸린 시간</span><span>${Math.floor(s.time / 60)}:${String(Math.floor(s.time % 60)).padStart(2, '0')}</span>
    <span>배송</span><span>${s.stats.delivered}</span>
    <span>완벽 / 우수 투하</span><span>${s.stats.perfect} / ${s.stats.good}</span>
    <span>빗나감 · 기한 초과 · 추락</span><span>${s.stats.missed} · ${s.stats.expired} · ${s.stats.crashes}</span>
    <span>고장 수리 · 배터리 교체</span><span>${s.stats.faultsFixed} · ${s.stats.swaps}</span>
    <span>최고 콤보</span><span>${s.stats.bestStreak}</span>
    <span>평균 왕복 시간</span><span>${avgTrip}</span>
    ${won ? `<span>등급</span><span>${rank(s)}</span>` : ''}
  </div>`;
  if (won) {
    showCard(`<h2>스테이지 ${s.stage.id} 클리어</h2><h1>${last ? '모든 근무 완료' : '목표 달성'}</h1>${stats}
      <div class="btns">${last ? '' : '<button class="primary" id="b-next">다음 스테이지</button>'}<button id="b-retry">다시 하기</button><button id="b-title">타이틀</button></div>`, 'result-good');
    bind('b-next', () => showBriefing(s.stage.id + 1));
  } else {
    showCard(`<h2>스테이지 ${s.stage.id} 실패</h2><h1>근무 종료</h1><p>목표 점수에 닿기 전에 근무 시간이 끝났습니다.</p>${stats}
      <div class="btns"><button class="primary" id="b-retry">다시 도전</button><button id="b-title">타이틀</button></div>`, 'result-bad');
  }
  bind('b-retry', () => showBriefing(s.stage.id));
  bind('b-title', showTitle);
}

function setPaused(p: boolean) {
  if (sim.phase !== 'playing' || paused === p) return;
  paused = p;
  if (p) {
    if (document.pointerLockElement) document.exitPointerLock();
    showCard(`<h2>일시 정지</h2><h1>잠시 휴식</h1>${CONTROLS}<div class="btns"><button class="primary" id="b-resume">계속하기</button><button id="b-retry">스테이지 재시작</button><button id="b-title">타이틀</button></div>`);
    mountQualityMenu();
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
  const menuOpen = !screen.classList.contains('hidden');
  if (menuOpen && e.code === 'Enter') {
    const primary = card.querySelector<HTMLButtonElement>('button.primary');
    if (primary) {
      e.preventDefault();
      if (!e.repeat) primary.click();
    }
    return;
  }
  if (!menuOpen && ['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (menuOpen && !paused) return;
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
  if (!paused && !onTitle && sim.phase === 'playing') {
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
  if (onTitle || paused) syncQualityMenu();
  if (!onTitle) updateHud(sim, realDt * timeScale, realDt);
  world.render(now);
  requestAnimationFrame(frame);
}

showTitle();
requestAnimationFrame(frame);

// ------------------------------------------------------------ debug hook (?debug=1)

if (debug) {
  const spots: Record<string, Target> = { table: { kind: 'table' }, rack: { kind: 'rack' }, console: { kind: 'console' } };
  const at = (t: Target) => {
    if (t.kind === 'rack') return { x: BASE.batteryRack.x - 1.6, z: BASE.batteryRack.z, yaw: -Math.PI / 2 };
    if (t.kind === 'console') return { x: BASE.console.x, z: BASE.console.z + 1.6, yaw: 0 };
    if (t.kind === 'table') return { x: BASE.packTable.x + 1.6, z: BASE.packTable.z, yaw: Math.PI / 2 };
    if (t.kind === 'bay') { const p = BASE.itemBays[t.bay]; return { x: p.x + 1.6, z: p.z, yaw: Math.PI / 2 }; }
    const p = BASE.pads[t.idx]; return { x: p.x, z: p.z - 1.6, yaw: Math.PI };
  };
  (window as unknown as { __game: unknown }).__game = {
    get sim() { return sim; },
    log,
    products: PRODUCTS,
    setTimeScale(n: number) { timeScale = n; },
    world,
    /** Test shortcut: attach the oldest waiting order straight onto drone `idx` (skips the depot work). */
    debugLoad(idx = 0) {
      const d = sim.drones[idx];
      const o = sim.orders.filter((or) => or.status === 'waiting').sort((a, b) => a.id - b.id)[0];
      if (!d || !o || d.state !== 'pad' || d.orderId != null) return false;
      o.status = 'loaded'; d.orderId = o.id;
      return true;
    },
    renderInfo() {
      const r = world.renderer;
      const size = r.getDrawingBufferSize(new THREE.Vector2());
      return { calls: r.info.render.calls, triangles: r.info.render.triangles, buffer: [size.x, size.y], quality: world.quality };
    },
    showBriefing,
    begin,
    goto(name: string) {
      const [kind, idx] = name.split(':');
      const t: Target = kind === 'bay' ? { kind: 'bay', bay: Number(idx) } : kind === 'pad' ? { kind: 'pad', idx: Number(idx) } : spots[kind];
      const p = at(t);
      sim.player.x = p.x; sim.player.z = p.z; sim.player.yaw = p.yaw; sim.player.pitch = t.kind === 'bay' ? -0.06 : t.kind === 'table' ? -0.5 : -0.35;
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
        phase: sim.phase, stage: sim.stage.id, time: +sim.time.toFixed(2), score: sim.score, mode: sim.player.mode, carrying: sim.player.carrying, box: sim.box, target: sim.target, targetScore: sim.stage.target,
        drones: sim.drones.map((d) => ({ idx: d.idx, state: d.state, fault: d.fault, battery: +d.battery.toFixed(1), orderId: d.orderId, pos: { x: +d.pos.x.toFixed(1), y: +d.pos.y.toFixed(1), z: +d.pos.z.toFixed(1) } })),
        orders: sim.orders.map((o) => ({ id: o.id, dest: o.dest.id, status: o.status, items: o.items, deadline: o.deadline })),
        stats: sim.stats,
      };
    },
  };
}
