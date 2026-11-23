import { BASE, DESTINATIONS, FLIGHT, SCORE } from './config';
import { comboMult, consoleAction, droneName, gradeFor, needsAttention, objective, orderById, predictImpact, promptFor, stateLabel, type Sim, type SimEvent } from './sim';

const DRONE_CSS = ['#ff8a3d', '#3dd6ff'];
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
function cls(id: string, name: string, on: boolean) { $(id).classList.toggle(name, on); }

let slowTimer = 0;
let bannerTimer = 0;

export function resetHud() {
  cache.clear();
  $('feed').innerHTML = '';
  $('popups').innerHTML = '';
  $('banner').className = '';
  slowTimer = 0;
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
  cls('objective', 'hidden', inConsole && s.stage.id > 1);

  // per-frame: interaction prompt + hold progress
  const pr = inConsole ? null : promptFor(s, s.target);
  cls('prompt', 'none', !pr);
  cls('prompt', 'off', !!pr && !pr.enabled);
  cls('crosshair', 'on', !!pr && pr.enabled);
  text('prompt-text', pr?.text ?? '');
  cls('hold-ring', 'hidden', !pr?.hold);
  ($('hold-fill') as HTMLElement).style.width = `${Math.min(100, (s.player.holdProgress / FLIGHT.repairTime) * 100)}%`;
  if (inConsole) updateConsole(s);

  slowTimer -= realDt;
  if (slowTimer > 0) return;
  slowTimer = 1 / 12;

  text('stage-name', `Stage ${s.stage.id} · ${s.stage.name}`);
  text('score', String(s.score));
  text('target', String(s.stage.target));
  ($('score-fill') as HTMLElement).style.width = `${Math.min(100, (s.score / s.stage.target) * 100)}%`;
  text('clock', `⏱ ${fmtTime(s.timeLeft)}`);
  cls('clock', 'urgent', s.timeLeft < 60);
  const mult = comboMult(s.streak);
  text('combo', s.streak > 0 ? `COMBO ${s.streak} · x${mult.toFixed(2)}` : '');
  const ws = Math.hypot(s.wind.x, s.wind.z);
  const arrows = ['↓', '↘', '→', '↗', '↑', '↖', '←', '↙'];
  const ang = Math.atan2(s.wind.x, s.wind.z);
  text('wind', `WIND ${arrows[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8]} ${ws.toFixed(1)} m/s`);

  html('drones', s.drones.map((d) => {
    const o = orderById(s, d.orderId);
    const bat = Math.round(d.battery);
    const meter = d.battery < FLIGHT.criticalBattery ? 'crit' : d.battery < FLIGHT.lowBattery ? 'low' : '';
    const pad = BASE.pads[d.idx];
    let sub = '';
    if (d.fault === 'gps' && d.state !== 'pad') sub = 'GPS lost — hold F at console';
    else if (d.fault === 'motor') sub = `Rotor fault — hold E at Pad ${d.idx + 1}`;
    else if (d.state === 'down') sub = `Recovery in ${Math.ceil(d.downTimer)} s`;
    else if (o) sub = `→ ${o.dest.id} ${o.dest.name} · ${Math.round(Math.hypot(o.dest.x - d.pos.x, o.dest.z - d.pos.z))} m`;
    else if (d.state === 'pad') sub = d.battery < FLIGHT.lowBattery ? 'Swap battery before launch' : 'Waiting for cargo';
    else sub = `→ Pad ${d.idx + 1} · ${Math.round(Math.hypot(pad.x - d.pos.x, pad.z - d.pos.z))} m`;
    const classes = ['dcard', d.fault ? 'fault' : needsAttention(d) ? 'attn' : '', inConsole && s.selected === d.idx ? 'sel' : ''].join(' ');
    return `<div class="${classes}" style="--c:${DRONE_CSS[d.idx]}">
      <div class="dhead"><span>${droneName(d.idx)}</span><span class="st">${stateLabel(d)}</span></div>
      <div class="drow">BAT<div class="meter ${meter}"><i style="width:${bat}%"></i></div>${bat}%</div>
      <div class="drow">ALT ${d.pos.y.toFixed(0).padStart(2, ' ')} m · ${Math.hypot(d.vel.x, d.vel.z).toFixed(0)} m/s</div>
      <div class="dsub">${sub}</div></div>`;
  }).join(''));

  const active = s.orders.filter((o) => ['waiting', 'carried', 'loaded', 'flying'].includes(o.status));
  html('orders', active.length === 0 ? '<div class="empty">No open orders</div>' : active.map((o) => {
    const left = o.deadline - s.time;
    const flying = o.status === 'flying';
    const d = s.drones.find((dr) => dr.orderId === o.id);
    const st = o.status === 'waiting' ? `SHELF ${String.fromCharCode(65 + (o.slot ?? 0))}` : o.status === 'carried' ? 'IN HAND' : o.status === 'loaded' ? `ON ${droneName(d?.idx ?? 0).toUpperCase()}` : 'IN FLIGHT';
    const pct = flying ? 100 : Math.max(0, (left / s.stage.orderDeadline) * 100);
    const bonus = !flying && s.time - o.spawnedAt < s.stage.orderDeadline * 0.75 ? ' · +ON TIME' : '';
    return `<div class="order" style="--c:${hex(o.dest.color)}">
      <div class="code">${o.dest.id}</div><div class="name">${o.dest.name}</div>
      <div class="tm ${!flying && left < 25 ? 'urgent' : ''}">${flying ? '✈' : fmtTime(left)}</div>
      <div class="ost">${st}${bonus}<div class="tbar"><i style="width:${pct}%"></i></div></div></div>`;
  }).join(''));

  const carry = s.player.carrying;
  const co = carry?.kind === 'crate' ? orderById(s, carry.orderId) : undefined;
  text('carry', carry ? (carry.kind === 'battery' ? 'CARRYING · Charged battery' : `CARRYING · Crate ${co?.dest.id} → ${co?.dest.name}`) : '');
  text('objective-text', objective(s).text);
  html('keys', inConsole
    ? '<kbd>Space</kbd> action · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> steer<br><kbd>F</kbd> hold: fix GPS · <kbd>1</kbd><kbd>2</kbd>/<kbd>Tab</kbd> drone · <kbd>Q</kbd> leave'
    : '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · mouse / <kbd>←</kbd><kbd>→</kbd> look<br><kbd>E</kbd> interact · <kbd>P</kbd> pause · <kbd>M</kbd> mute');
}

function updateConsole(s: Sim) {
  const d = s.drones[s.selected];
  const o = orderById(s, d.orderId);
  const pad = BASE.pads[d.idx];
  const dest = o ? o.dest : null;
  const tx = dest ? dest.x : pad.x;
  const tz = dest ? dest.z : pad.z;
  const dist = Math.hypot(tx - d.pos.x, tz - d.pos.z);
  text('feed-title', `${droneName(d.idx).toUpperCase()} · ${stateLabel(d)} · ${dest ? `${dest.id} ${dest.name}` : `PAD ${d.idx + 1}`} ${Math.round(dist)} m · ALT ${d.pos.y.toFixed(0)} m · BAT ${Math.round(d.battery)}%`);
  html('drone-tabs', s.drones.map((dr) => `<span class="tab ${dr.idx === s.selected ? 'sel' : ''} ${needsAttention(dr) ? 'attn' : ''}" style="--c:${DRONE_CSS[dr.idx]}">${dr.idx + 1} · ${stateLabel(dr)}</span>`).join(''));
  const a = consoleAction(s);
  text('action-label', a.label);
  cls('action-label', 'off', !a.enabled && !(d.fault === 'gps'));
  text('action-reason', a.reason ?? '');
  const gps = d.fault === 'gps' && d.state !== 'pad';
  cls('fix-bar', 'hidden', !gps);
  ($('fix-fill') as HTMLElement).style.width = `${Math.min(100, (d.fixProgress / FLIGHT.gpsFixTime) * 100)}%`;
  let guide = '';
  if (d.state === 'hold' && dest) {
    const p = predictImpact(s, d.pos, d.vel);
    const off = Math.hypot(p.x - dest.x, p.z - dest.z);
    guide = `Magenta ring = predicted impact. Steer it onto the target, then drop.<br>Impact offset ${off.toFixed(1)} m → ${gradeFor(off)}  (perfect ≤ ${SCORE.perfectRadius} m)`;
  } else if (d.state === 'approach') {
    const off = Math.hypot(pad.x - d.pos.x, pad.z - d.pos.z);
    guide = `Pad offset ${off.toFixed(1)} m — keep under ${FLIGHT.hardLandingOffset} m to avoid a hard landing.<br>Steer with WASD, then Space.`;
  } else if (gps) guide = 'Hold F to recalibrate. The drone drifts with the wind meanwhile.';
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
    g.font = 'bold 10px monospace';
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
  g.font = '10px monospace';
  g.fillText(`WIND ${ws.toFixed(1)}`, 8, W - 10);
  const ax = 66, ay = W - 14, len = 6 + ws * 4;
  g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax + (s.wind.x / (ws || 1)) * len, ay + (s.wind.z / (ws || 1)) * len); g.stroke();
  g.fillText('N', W / 2 - 3, 12);
}
