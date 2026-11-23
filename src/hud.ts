import { BASE, DESTINATIONS, FLIGHT, SCORE } from './config';
import { comboMult, consoleAction, droneName, GRADE_LABEL, gradeFor, needsAttention, objective, orderById, predictImpact, promptFor, stateLabel, type Drone, type LoopStep, type Sim, type SimEvent } from './sim';

const DRONE_CSS = ['#ff8a3d', '#3dd6ff'];
const DELIVERY_STEPS = [
  ['order', '주문'], ['pick', '물건 담기'], ['check', '포장 확인'], ['seal', '봉인'], ['attach', '드론 연결'],
  ['launch', '출발'], ['fly', '비행'], ['drop', '투하'], ['land', '착륙'],
] as const satisfies ReadonlyArray<readonly [LoopStep, string]>;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const $ = (id: string) => document.getElementById(id)!;
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

const cache = new Map<string, string>();
function html(id: string, s: string) {
  if (cache.get(id) === s) return;
  cache.set(id, s);
  $(id).innerHTML = s;
}
function text(id: string, s: string) {
  if (cache.get(id) === s) return;
  cache.set(id, s);
  $(id).textContent = s;
}
function keyedText(id: string, label: string) {
  if (cache.get(id) === label) return;
  const prefix = /^\[(E|Space|F)( 길게)?\]\s*/.exec(label);
  if (!prefix) {
    text(id, label);
    return;
  }
  const key = document.createElement('kbd');
  key.textContent = prefix[1];
  $(id).replaceChildren(key, (prefix[2] ?? '') + ' ' + label.slice(prefix[0].length));
  cache.set(id, label);
}
function cls(id: string, name: string, on: boolean) { $(id).classList.toggle(name, on); }

let slowTimer = 0;
let bannerTimer = 0;
let lastStep: LoopStep | undefined;
let lastExitHint: 'exit' | 'autopilot' | null = null;

export function resetHud() {
  cache.clear();
  $('feed').innerHTML = '';
  $('popups').innerHTML = '';
  $('banner').className = '';
  slowTimer = 0;
  lastStep = undefined;
}

function hasConsoleWork(d: Drone) {
  if (d.state === 'pad') return d.orderId != null && !d.fault && d.battery >= FLIGHT.lowBattery;
  return d.state !== 'down';
}

function updateExitHint(s: Sim) {
  let hint: typeof lastExitHint = null;
  if (s.player.mode === 'console' && !hasConsoleWork(s.drones[s.selected]) && !s.drones.some(needsAttention)) {
    hint = s.drones.some(hasConsoleWork) ? 'autopilot' : 'exit';
  }
  if (hint === lastExitHint) return;
  lastExitHint = hint;
  cls('exit-prompt', 'hidden', hint !== 'exit');
  cls('exit-hint', 'hidden', hint !== 'autopilot');
  slowTimer = 0;
}

function updateObjective(s: Sim) {
  const next = objective(s);
  text('objective-text', next.text);
  if (lastExitHint === 'exit') text('exit-next', next.text);
  if (next.step === lastStep) return;
  const active = DELIVERY_STEPS.findIndex(([step]) => step === next.step);
  const steps = DELIVERY_STEPS.map(([, label], i) => {
    const state = i === active ? ' aria-current="step"' : i < active ? ' class="done"' : '';
    return `<li${state}><span>${label}</span></li>`;
  });
  if (next.step === 'service') steps.push('<li class="service" aria-current="step"><span>정비</span></li>');
  html('steps', steps.join(''));
  if (lastStep && !reducedMotion.matches) {
    $('objective').animate([{ boxShadow: '0 0 16px #ffd23f88' }, { boxShadow: '0 0 0 transparent' }], 550);
  }
  lastStep = next.step;
}

export function handleEvent(e: SimEvent) {
  if (e.type === 'note') {
    const el = document.createElement('div');
    el.className = `note ${e.level}`;
    el.textContent = e.text;
    const feed = $('feed');
    feed.prepend(el);
    while (feed.children.length > 5) feed.lastElementChild!.remove();
    setTimeout(() => { el.style.opacity = '0'; }, 6000);
    setTimeout(() => el.remove(), 6700);
  } else if (e.type === 'banner') {
    const b = $('banner');
    b.textContent = e.text;
    b.className = `show ${e.level}`;
    bannerTimer = 3;
  } else if (e.type === 'popup') {
    const el = document.createElement('div');
    el.className = `popup ${e.grade}`;
    el.textContent = e.text;
    $('popups').appendChild(el);
    setTimeout(() => el.remove(), 2300);
  }
}

export function updateHud(s: Sim, dt: number, realDt: number) {
  void dt;
  bannerTimer -= realDt;
  if (bannerTimer <= 0) $('banner').classList.remove('show');
  const inConsole = s.player.mode === 'console';
  document.body.classList.toggle('console', inConsole);
  cls('console-ui', 'hidden', !inConsole);
  cls('crosshair', 'hidden', inConsole);
  updateExitHint(s);

  // per-frame: interaction prompt + hold progress
  const pr = inConsole ? null : promptFor(s, s.target);
  cls('prompt', 'none', !pr);
  cls('prompt', 'off', !!pr && !pr.enabled);
  cls('crosshair', 'on', !!pr && pr.enabled);
  keyedText('prompt-text', pr?.text ?? '');
  cls('hold-ring', 'hidden', !pr?.hold);
  ($('hold-fill') as HTMLElement).style.width = `${Math.min(100, (s.player.holdProgress / FLIGHT.repairTime) * 100)}%`;
  if (inConsole) updateConsole(s);

  slowTimer -= realDt;
  if (slowTimer > 0) return;
  slowTimer = 1 / 12;

  text('stage-name', `스테이지 ${s.stage.id} · ${s.stage.name}`);
  text('score', String(s.score));
  text('target', String(s.stage.target));
  ($('score-fill') as HTMLElement).style.width = `${Math.min(100, (s.score / s.stage.target) * 100)}%`;
  text('clock', `⏱ ${fmtTime(s.timeLeft)}`);
  cls('clock', 'urgent', s.timeLeft < 60);
  const mult = comboMult(s.streak);
  text('combo', s.streak > 0 ? `콤보 ${s.streak} · x${mult.toFixed(2)}` : '');
  const ws = Math.hypot(s.wind.x, s.wind.z);
  const arrows = ['↓', '↘', '→', '↗', '↑', '↖', '←', '↙'];
  const ang = Math.atan2(s.wind.x, s.wind.z);
  text('wind', `바람 ${arrows[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8]} ${ws.toFixed(1)} m/s`);

  html('drones', s.drones.map((d) => {
    const o = orderById(s, d.orderId);
    const bat = Math.round(d.battery);
    const meter = d.battery < FLIGHT.criticalBattery ? 'crit' : d.battery < FLIGHT.lowBattery ? 'low' : '';
    const pad = BASE.pads[d.idx];
    let sub = '';
    if (d.fault === 'gps' && d.state !== 'pad') sub = 'GPS 끊김 — 콘솔에서 F 길게';
    else if (d.fault === 'motor') sub = `로터 고장 — ${d.idx + 1}번 패드에서 E 길게`;
    else if (d.state === 'down') sub = `회수까지 ${Math.ceil(d.downTimer)}초`;
    else if (o) sub = `→ ${o.dest.id} ${o.dest.name} · ${Math.round(Math.hypot(o.dest.x - d.pos.x, o.dest.z - d.pos.z))} m`;
    else if (d.state === 'pad') sub = d.battery < FLIGHT.lowBattery ? '출발 전 배터리 교체' : '화물 대기 중';
    else sub = `→ ${d.idx + 1}번 패드 · ${Math.round(Math.hypot(pad.x - d.pos.x, pad.z - d.pos.z))} m`;
    const classes = ['dcard', d.fault ? 'fault' : needsAttention(d) ? 'attn' : '', inConsole && s.selected === d.idx ? 'sel' : ''].join(' ');
    return `<div class="${classes}" style="--c:${DRONE_CSS[d.idx]}">
      <div class="dhead"><span>${droneName(d.idx)}</span><span class="st">${stateLabel(d)}</span></div>
      <div class="drow">배터리<div class="meter ${meter}"><i style="width:${bat}%"></i></div>${bat}%</div>
      <div class="drow">고도 ${d.pos.y.toFixed(0).padStart(2, ' ')} m · ${Math.hypot(d.vel.x, d.vel.z).toFixed(0)} m/s</div>
      <div class="dsub">${sub}</div></div>`;
  }).join(''));

  const active = s.orders.filter((o) => ['waiting', 'carried', 'loaded', 'flying'].includes(o.status));
  html('orders', active.length === 0 ? '<div class="empty">진행 중인 주문 없음</div>' : active.map((o) => {
    const left = o.deadline - s.time;
    const flying = o.status === 'flying';
    const d = s.drones.find((dr) => dr.orderId === o.id);
    const st = o.status === 'waiting' ? `선반 ${String.fromCharCode(65 + (o.slot ?? 0))}` : o.status === 'carried' ? '운반 중' : o.status === 'loaded' ? `${droneName(d?.idx ?? 0)} 적재` : '비행 중';
    const pct = flying ? 100 : Math.max(0, (left / s.stage.orderDeadline) * 100);
    const bonus = !flying && s.time - o.spawnedAt < s.stage.orderDeadline * 0.75 ? ' · 정시 보너스' : '';
    return `<div class="order" style="--c:${hex(o.dest.color)}">
      <div class="code">${o.dest.id}</div><div class="name">${o.dest.name}</div>
      <div class="tm ${!flying && left < 25 ? 'urgent' : ''}">${flying ? '✈' : fmtTime(left)}</div>
      <div class="ost">${st}${bonus}<div class="tbar"><i style="width:${pct}%"></i></div></div></div>`;
  }).join(''));

  const carry = s.player.carrying;
  const co = carry?.kind === 'crate' ? orderById(s, carry.orderId) : undefined;
  text('carry', carry ? (carry.kind === 'battery' ? '운반 중 · 충전된 배터리' : `운반 중 · ${co?.dest.id} 상자 → ${co?.dest.name}`) : '');
  updateObjective(s);
  html('keys', inConsole
    ? '<kbd>Space</kbd> 실행 · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 조종<br><kbd>F</kbd> 길게: GPS 수리 · <kbd>1</kbd><kbd>2</kbd>/<kbd>Tab</kbd> 드론 · <kbd>Q</kbd> 나가기'
    : '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 이동 · 마우스 / <kbd>←</kbd><kbd>→</kbd> 시점<br><kbd>E</kbd> 상호작용 · <kbd>P</kbd> 일시 정지 · <kbd>M</kbd> 음소거');
}

function updateConsole(s: Sim) {
  const d = s.drones[s.selected];
  const o = orderById(s, d.orderId);
  const pad = BASE.pads[d.idx];
  const dest = o ? o.dest : null;
  const tx = dest ? dest.x : pad.x;
  const tz = dest ? dest.z : pad.z;
  const dist = Math.hypot(tx - d.pos.x, tz - d.pos.z);
  text('feed-title', `${droneName(d.idx)} · ${stateLabel(d)} · ${dest ? `${dest.id} ${dest.name}` : `${d.idx + 1}번 패드`} ${Math.round(dist)} m · 고도 ${d.pos.y.toFixed(0)} m · 배터리 ${Math.round(d.battery)}%`);
  html('drone-tabs', s.drones.map((dr) => `<span class="tab ${dr.idx === s.selected ? 'sel' : ''} ${needsAttention(dr) ? 'attn' : ''}" style="--c:${DRONE_CSS[dr.idx]}">${dr.idx + 1} · ${stateLabel(dr)}</span>`).join(''));
  const a = consoleAction(s);
  keyedText('action-label', a.label);
  cls('action-label', 'off', !a.enabled && !(d.fault === 'gps'));
  text('action-reason', a.reason ?? '');
  const gps = d.fault === 'gps' && d.state !== 'pad';
  cls('fix-bar', 'hidden', !gps);
  ($('fix-fill') as HTMLElement).style.width = `${Math.min(100, (d.fixProgress / FLIGHT.gpsFixTime) * 100)}%`;
  let guide = '';
  if (d.state === 'hold' && dest) {
    const p = predictImpact(s, d.pos, d.vel);
    const off = Math.hypot(p.x - dest.x, p.z - dest.z);
    guide = `분홍 링 = 예상 낙하 지점. 목표 위로 맞춘 뒤 투하하세요.<br>오차 ${off.toFixed(1)} m → ${GRADE_LABEL[gradeFor(off)]}  (완벽 ≤ ${SCORE.perfectRadius} m)`;
  } else if (d.state === 'approach') {
    const off = Math.hypot(pad.x - d.pos.x, pad.z - d.pos.z);
    guide = `패드 오차 ${off.toFixed(1)} m — 경착륙을 피하려면 ${FLIGHT.hardLandingOffset} m 이내로 맞추세요.<br>WASD로 조종한 뒤 Space.`;
  } else if (gps) guide = 'F를 길게 눌러 재보정하세요. 그동안 드론은 바람에 밀립니다.';
  html('guide', guide);
  drawMinimap(s);
}

function drawMinimap(s: Sim) {
  const c = $('minimap') as HTMLCanvasElement;
  const g = c.getContext('2d')!;
  const W = c.width;
  const scale = W / 520;
  const X = (x: number) => W / 2 + x * scale;
  const Z = (z: number) => W / 2 + z * scale;
  g.clearRect(0, 0, W, W);
  g.strokeStyle = 'rgba(160,200,230,0.12)';
  for (let r = 50; r < 260; r += 50) { g.beginPath(); g.arc(W / 2, W / 2, r * scale, 0, Math.PI * 2); g.stroke(); }
  const busy = new Set(s.orders.filter((o) => ['waiting', 'carried', 'loaded', 'flying'].includes(o.status)).map((o) => o.dest.id));
  for (const d of DESTINATIONS) {
    g.fillStyle = hex(d.color);
    g.globalAlpha = busy.has(d.id) ? 1 : 0.35;
    g.beginPath(); g.arc(X(d.x), Z(d.z), 5, 0, Math.PI * 2); g.fill();
    g.font = 'bold 10px ui-monospace, Menlo, "Apple SD Gothic Neo", "Malgun Gothic", monospace';
    g.fillText(d.id, X(d.x) + 7, Z(d.z) + 4);
  }
  g.globalAlpha = 1;
  g.fillStyle = '#ffd23f';
  g.fillRect(X(-12), Z(-9), 24 * scale, 31 * scale);
  for (const d of s.drones) {
    const o = orderById(s, d.orderId);
    if (o && d.state !== 'pad') {
      g.strokeStyle = DRONE_CSS[d.idx]; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(X(d.pos.x), Z(d.pos.z)); g.lineTo(X(o.dest.x), Z(o.dest.z)); g.stroke(); g.setLineDash([]);
    }
    g.fillStyle = DRONE_CSS[d.idx];
    g.save();
    g.translate(X(d.pos.x), Z(d.pos.z));
    g.rotate(-d.yaw);
    g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(-5, 5); g.closePath(); g.fill();
    if (d.idx === s.selected) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke(); g.lineWidth = 1; }
    g.restore();
  }
  const ws = Math.hypot(s.wind.x, s.wind.z);
  g.strokeStyle = '#cfe3f0';
  g.fillStyle = '#cfe3f0';
  g.font = '10px "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
  g.fillText(`바람 ${ws.toFixed(1)}`, 8, W - 10);
  const ax = 66, ay = W - 14, len = 6 + ws * 4;
  g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax + (s.wind.x / (ws || 1)) * len, ay + (s.wind.z / (ws || 1)) * len); g.stroke();
  g.fillText('N', W / 2 - 3, 12);
}
