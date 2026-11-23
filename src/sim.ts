import { BASE, DESTINATIONS, FLIGHT, SCORE, STAGES, type Destination, type StageDef } from './config';

export type DroneState = 'pad' | 'takeoff' | 'outbound' | 'hold' | 'returning' | 'approach' | 'landing' | 'down';
export type Fault = 'gps' | 'motor' | null;
export type Phase = 'briefing' | 'playing' | 'clear' | 'fail';
export type OrderStatus = 'waiting' | 'carried' | 'loaded' | 'flying' | 'delivered' | 'missed' | 'expired' | 'lost';
export type Grade = 'PERFECT' | 'GOOD' | 'OK' | 'MISS';

export interface V3 { x: number; y: number; z: number }

export interface Order {
  id: number;
  dest: Destination;
  spawnedAt: number;
  deadline: number;
  status: OrderStatus;
  slot: number | null;
  launchedAt: number | null;
}

export interface Drone {
  idx: number;
  state: DroneState;
  pos: V3;
  vel: V3;
  yaw: number;
  battery: number;
  fault: Fault;
  orderId: number | null;
  fixProgress: number;
  faultAt: number | null;
  hardLanding: boolean;
  downTimer: number;
  tripStart: number;
  warnedLow: boolean;
  warnedCritical: boolean;
  flights: number;
}

export interface Package { orderId: number; pos: V3; vel: V3; drone: number }

export type Carry = { kind: 'crate'; orderId: number } | { kind: 'battery' } | null;

export type Target =
  | { kind: 'shelf'; slot: number }
  | { kind: 'rack' }
  | { kind: 'pad'; idx: number }
  | { kind: 'console' };

export interface Player {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  mode: 'walk' | 'console';
  carrying: Carry;
  holdProgress: number;
}

export type SimEvent =
  | { type: 'note'; text: string; level: 'info' | 'good' | 'warn' | 'bad' }
  | { type: 'banner'; text: string; level: 'warn' | 'bad' | 'good' }
  | { type: 'popup'; text: string; grade: Grade }
  | { type: 'sfx'; name: SfxName }
  | { type: 'log'; kind: string; drone?: number; value?: number };

export type SfxName = 'order' | 'pickup' | 'attach' | 'launch' | 'drop' | 'perfect' | 'good' | 'miss' | 'alarm' | 'fixed' | 'land' | 'deny' | 'clear' | 'fail' | 'swap' | 'select' | 'ping';

export interface Input {
  move: { f: number; r: number };
  nudge: { x: number; z: number };
  interactHeld: boolean;
  fixHeld: boolean;
}

export interface Stats { delivered: number; perfect: number; good: number; missed: number; expired: number; crashes: number; faultsFixed: number; swaps: number; bestStreak: number; trips: number[] }

export interface Sim {
  stage: StageDef;
  phase: Phase;
  time: number;
  timeLeft: number;
  score: number;
  streak: number;
  stats: Stats;
  orders: Order[];
  drones: Drone[];
  packages: Package[];
  wind: { x: number; z: number };
  windSeed: number;
  selected: number;
  nextOrderAt: number;
  nextOrderId: number;
  player: Player;
  target: Target | null;
  events: SimEvent[];
  lastDest: string | null;
}

const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });

export function createSim(stageId: number): Sim {
  const stage = STAGES.find((s) => s.id === stageId) ?? STAGES[0];
  const drones: Drone[] = [];
  for (let i = 0; i < stage.drones; i++) {
    const p = BASE.pads[i];
    drones.push({
      idx: i, state: 'pad', pos: v3(p.x, 0, p.z), vel: v3(), yaw: 0, battery: 100, fault: null,
      orderId: null, fixProgress: 0, faultAt: null, hardLanding: false, downTimer: 0, tripStart: 0,
      warnedLow: false, warnedCritical: false, flights: 0,
    });
  }
  return {
    stage, phase: 'briefing', time: 0, timeLeft: stage.timeLimit, score: 0, streak: 0,
    stats: { delivered: 0, perfect: 0, good: 0, missed: 0, expired: 0, crashes: 0, faultsFixed: 0, swaps: 0, bestStreak: 0, trips: [] },
    orders: [], drones, packages: [], wind: { x: 0, z: 0 }, windSeed: Math.random() * 100, selected: 0,
    nextOrderAt: 1.5, nextOrderId: 1,
    player: { x: BASE.playerStart.x, z: BASE.playerStart.z, yaw: BASE.playerStart.yaw, pitch: -0.05, mode: 'walk', carrying: null, holdProgress: 0 },
    target: null, events: [], lastDest: null,
  };
}

const emit = (s: Sim, e: SimEvent) => s.events.push(e);
const note = (s: Sim, text: string, level: 'info' | 'good' | 'warn' | 'bad' = 'info') => emit(s, { type: 'note', text, level });
const sfx = (s: Sim, name: SfxName) => emit(s, { type: 'sfx', name });
export const droneName = (i: number) => `${i + 1}번 드론`;
export const GRADE_LABEL: Record<Grade, string> = { PERFECT: '완벽', GOOD: '우수', OK: '양호', MISS: '빗나감' };
export const orderById = (s: Sim, id: number | null) => (id == null ? undefined : s.orders.find((o) => o.id === id));
const isFlying = (d: Drone) => d.state !== 'pad' && d.state !== 'down';
export const comboMult = (streak: number) => Math.min(1 + streak * SCORE.comboStep, SCORE.comboMax);

// ---------------------------------------------------------------- orders

function spawnOrder(s: Sim) {
  const used = new Set(s.orders.filter((o) => o.status === 'waiting').map((o) => o.slot));
  const slot = BASE.shelfSlots.findIndex((_, i) => !used.has(i));
  if (slot < 0) return;
  const choices = DESTINATIONS.filter((d) => d.id !== s.lastDest);
  const dest = choices[Math.floor(Math.random() * choices.length)];
  s.lastDest = dest.id;
  const order: Order = { id: s.nextOrderId++, dest, spawnedAt: s.time, deadline: s.time + s.stage.orderDeadline, status: 'waiting', slot, launchedAt: null };
  s.orders.push(order);
  note(s, `새 주문 #${order.id}: ${dest.id} ${dest.name}`, 'info');
  sfx(s, 'order');
}

const pendingCount = (s: Sim) => s.orders.filter((o) => o.status === 'waiting' || o.status === 'carried' || o.status === 'loaded').length;

function updateOrders(s: Sim) {
  if (s.time >= s.nextOrderAt) {
    if (pendingCount(s) < s.stage.maxPending) spawnOrder(s);
    s.nextOrderAt = s.time + s.stage.orderInterval * (0.8 + Math.random() * 0.4);
  }
  for (const o of s.orders) {
    if ((o.status === 'waiting' || o.status === 'carried' || o.status === 'loaded') && s.time > o.deadline) {
      if (o.status === 'carried') s.player.carrying = null;
      if (o.status === 'loaded') {
        const d = s.drones.find((dr) => dr.orderId === o.id);
        if (d) d.orderId = null;
      }
      o.status = 'expired';
      o.slot = null;
      s.score = Math.max(0, s.score - SCORE.expiredPenalty);
      s.streak = 0;
      s.stats.expired++;
      note(s, `주문 #${o.id} (${o.dest.name}) 기한 초과 (-${SCORE.expiredPenalty})`, 'bad');
      sfx(s, 'miss');
    }
  }
}

// ---------------------------------------------------------------- world queries

interface Spot { target: Target; x: number; z: number }

export function interactables(s: Sim): Spot[] {
  const spots: Spot[] = [];
  for (const o of s.orders) if (o.status === 'waiting' && o.slot != null) {
    const p = BASE.shelfSlots[o.slot];
    spots.push({ target: { kind: 'shelf', slot: o.slot }, x: p.x, z: p.z });
  }
  if (s.player.carrying?.kind === 'crate') {
    BASE.shelfSlots.forEach((p, slot) => {
      if (!s.orders.some((o) => o.status === 'waiting' && o.slot === slot)) spots.push({ target: { kind: 'shelf', slot }, x: p.x, z: p.z });
    });
  }
  spots.push({ target: { kind: 'rack' }, x: BASE.batteryRack.x, z: BASE.batteryRack.z });
  BASE.pads.forEach((p, idx) => spots.push({ target: { kind: 'pad', idx }, x: p.x, z: p.z }));
  spots.push({ target: { kind: 'console' }, x: BASE.console.x, z: BASE.console.z });
  return spots;
}

function findTarget(s: Sim): Target | null {
  const p = s.player;
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  let best: Target | null = null;
  let bestScore = Infinity;
  for (const spot of interactables(s)) {
    const dx = spot.x - p.x;
    const dz = spot.z - p.z;
    const dist = Math.hypot(dx, dz);
    const range = spot.target.kind === 'pad' ? BASE.interactRange + 0.8 : BASE.interactRange;
    if (dist > range) continue;
    const dot = dist < 0.01 ? 1 : (dx * fx + dz * fz) / dist;
    if (dot < 0.55) continue;
    const score = dist * (2 - dot);
    if (score < bestScore) { bestScore = score; best = spot.target; }
  }
  return best;
}

export interface Prompt { text: string; hold: boolean; enabled: boolean }

export function promptFor(s: Sim, t: Target | null): Prompt | null {
  if (!t) return null;
  const carry = s.player.carrying;
  switch (t.kind) {
    case 'shelf': {
      const o = s.orders.find((or) => or.status === 'waiting' && or.slot === t.slot);
      if (o) return carry ? { text: '손이 꽉 찼습니다', hold: false, enabled: false } : { text: `[E] ${o.dest.id} 상자 들기 — ${o.dest.name}`, hold: false, enabled: true };
      if (carry?.kind === 'crate') return { text: '[E] 선반에 상자 내려놓기', hold: false, enabled: true };
      return null;
    }
    case 'rack':
      if (carry?.kind === 'battery') return { text: '[E] 배터리 거치대에 반납', hold: false, enabled: true };
      if (carry) return { text: '손이 꽉 찼습니다', hold: false, enabled: false };
      return { text: '[E] 충전된 배터리 꺼내기', hold: false, enabled: true };
    case 'console':
      if (carry) return { text: '들고 있는 물건부터 내려놓으세요', hold: false, enabled: false };
      return { text: '[E] 관제 콘솔 앉기', hold: false, enabled: true };
    case 'pad': {
      const d = s.drones[t.idx];
      if (!d) return { text: `${t.idx + 1}번 패드는 이번 근무에 쓰지 않습니다`, hold: false, enabled: false };
      if (d.state !== 'pad') return { text: `${droneName(d.idx)}: ${stateLabel(d)}`, hold: false, enabled: false };
      if (carry?.kind === 'battery') return { text: `[E] 배터리 교체 (${Math.round(d.battery)}%)`, hold: false, enabled: true };
      if (d.fault === 'motor') return { text: `[E 길게] ${droneName(d.idx)} 로터 수리`, hold: true, enabled: true };
      if (carry?.kind === 'crate') {
        if (d.orderId != null) return { text: `${droneName(d.idx)}에 이미 화물이 있습니다`, hold: false, enabled: false };
        const o = orderById(s, carry.orderId)!;
        return { text: `[E] ${droneName(d.idx)}에 ${o.dest.id} 상자 연결`, hold: false, enabled: true };
      }
      if (d.orderId != null) return { text: `[E] ${droneName(d.idx)}에서 상자 내리기`, hold: false, enabled: true };
      return { text: `${droneName(d.idx)} · 배터리 ${Math.round(d.battery)}%`, hold: false, enabled: false };
    }
  }
}

export function stateLabel(d: Drone): string {
  if (d.fault === 'gps' && isFlying(d)) return 'GPS 장애';
  switch (d.state) {
    case 'pad': return d.fault === 'motor' ? '로터 고장' : d.orderId != null ? '적재 완료' : '패드 대기';
    case 'takeoff': return '이륙';
    case 'outbound': return '배송 중';
    case 'hold': return '투하 대기';
    case 'returning': return '복귀 중';
    case 'approach': return '착륙 대기';
    case 'landing': return '착륙 중';
    case 'down': return '추락';
  }
}

export function needsAttention(d: Drone): boolean {
  return d.state === 'hold' || d.state === 'approach' || (d.fault === 'gps' && isFlying(d));
}

// ---------------------------------------------------------------- player actions

export function interact(s: Sim) {
  if (s.phase !== 'playing' || s.player.mode !== 'walk') return;
  const t = s.target;
  const pr = promptFor(s, t);
  if (!t || !pr) return;
  if (!pr.enabled || pr.hold) { if (!pr.enabled) sfx(s, 'deny'); return; }
  const p = s.player;
  switch (t.kind) {
    case 'shelf': {
      const o = s.orders.find((or) => or.status === 'waiting' && or.slot === t.slot);
      if (o) { o.status = 'carried'; o.slot = null; p.carrying = { kind: 'crate', orderId: o.id }; sfx(s, 'pickup'); emit(s, { type: 'log', kind: 'pickup', value: o.id }); }
      else if (p.carrying?.kind === 'crate') {
        const co = orderById(s, p.carrying.orderId)!;
        co.status = 'waiting'; co.slot = t.slot; p.carrying = null; sfx(s, 'pickup');
      }
      return;
    }
    case 'rack':
      p.carrying = p.carrying?.kind === 'battery' ? null : { kind: 'battery' };
      sfx(s, 'pickup');
      return;
    case 'console':
      p.mode = 'console';
      s.selected = mostUrgentDrone(s);
      sfx(s, 'select');
      emit(s, { type: 'log', kind: 'console' });
      return;
    case 'pad': {
      const d = s.drones[t.idx];
      if (p.carrying?.kind === 'battery') {
        d.battery = 100; d.warnedLow = false; d.warnedCritical = false; p.carrying = null; s.stats.swaps++;
        note(s, `${droneName(d.idx)} 배터리 교체 — 100%`, 'good'); sfx(s, 'swap');
        emit(s, { type: 'log', kind: 'swap', drone: d.idx });
      } else if (p.carrying?.kind === 'crate') {
        const o = orderById(s, p.carrying.orderId)!;
        o.status = 'loaded'; d.orderId = o.id; p.carrying = null;
        note(s, `${o.dest.id} 상자를 ${droneName(d.idx)}에 연결했습니다. 콘솔에서 출발시키세요.`, 'info'); sfx(s, 'attach');
        emit(s, { type: 'log', kind: 'attach', drone: d.idx, value: o.id });
      } else if (d.orderId != null) {
        const o = orderById(s, d.orderId)!;
        o.status = 'carried'; d.orderId = null; p.carrying = { kind: 'crate', orderId: o.id }; sfx(s, 'pickup');
      }
      return;
    }
  }
}

export function leaveConsole(s: Sim) {
  if (s.player.mode !== 'console') return;
  s.player.mode = 'walk';
  s.player.yaw = 0;
  s.player.pitch = -0.1;
  s.player.x = BASE.console.x;
  s.player.z = BASE.console.z + 1.6;
}

export function selectDrone(s: Sim, idx: number) {
  if (idx < 0 || idx >= s.drones.length || s.selected === idx) return;
  s.selected = idx;
  sfx(s, 'select');
}

export function mostUrgentDrone(s: Sim): number {
  const rank = (d: Drone) => (needsAttention(d) ? 0 : d.state === 'pad' && d.orderId != null && !d.fault ? 1 : 2);
  let best = s.selected < s.drones.length ? s.selected : 0;
  for (const d of s.drones) if (rank(d) < rank(s.drones[best])) best = d.idx;
  return best;
}

export interface ConsoleAction { label: string; enabled: boolean; reason?: string }

export function consoleAction(s: Sim): ConsoleAction {
  const d = s.drones[s.selected];
  if (d.fault === 'gps' && isFlying(d)) return { label: '[F 길게] GPS 재보정', enabled: false, reason: '자동 비행 일시 정지' };
  switch (d.state) {
    case 'pad':
      if (d.fault === 'motor') return { label: '출발', enabled: false, reason: '로터 고장 — 패드에서 수리' };
      if (d.orderId == null) return { label: '출발', enabled: false, reason: '연결된 화물 없음' };
      if (d.battery < FLIGHT.lowBattery) return { label: '출발', enabled: false, reason: `배터리 ${Math.round(d.battery)}% — 패드에서 교체` };
      return { label: '[Space] 출발', enabled: true };
    case 'hold': return { label: '[Space] 택배 투하', enabled: true };
    case 'approach': return { label: '[Space] 착륙 시작', enabled: true };
    case 'down': return { label: '회수반 출동 중', enabled: false };
    default: return { label: stateLabel(d), enabled: false };
  }
}

export function consolePrimary(s: Sim) {
  if (s.phase !== 'playing' || s.player.mode !== 'console') return;
  const d = s.drones[s.selected];
  const a = consoleAction(s);
  if (!a.enabled) { sfx(s, 'deny'); return; }
  if (d.state === 'pad') launch(s, d);
  else if (d.state === 'hold') drop(s, d);
  else if (d.state === 'approach') beginLanding(s, d);
}

function launch(s: Sim, d: Drone) {
  const o = orderById(s, d.orderId)!;
  o.status = 'flying';
  o.launchedAt = s.time;
  d.state = 'takeoff';
  d.tripStart = s.time;
  d.flights++;
  d.hardLanding = false;
  const scripted = s.stage.id === 1 && d.flights === 2;
  const roll = s.stage.id === 1 && d.flights === 1 ? 1 : Math.random();
  d.faultAt = scripted || roll < s.stage.faultChance ? s.time + 6 + Math.random() * 10 : null;
  note(s, `${droneName(d.idx)} 출발 → ${o.dest.name}`, 'info');
  sfx(s, 'launch');
  emit(s, { type: 'log', kind: 'launch', drone: d.idx, value: o.id });
}

function drop(s: Sim, d: Drone) {
  s.packages.push({ orderId: d.orderId!, pos: { ...d.pos, y: d.pos.y - 0.6 }, vel: { x: d.vel.x, y: 0, z: d.vel.z }, drone: d.idx });
  d.orderId = null;
  d.state = 'returning';
  sfx(s, 'drop');
  emit(s, { type: 'log', kind: 'drop', drone: d.idx });
}

function beginLanding(s: Sim, d: Drone) {
  const pad = BASE.pads[d.idx];
  d.hardLanding = Math.hypot(d.pos.x - pad.x, d.pos.z - pad.z) > FLIGHT.hardLandingOffset;
  d.state = 'landing';
  emit(s, { type: 'log', kind: 'landing', drone: d.idx });
}

// ---------------------------------------------------------------- simulation

function moveToward(d: Drone, tx: number, ty: number, tz: number, dt: number, speed = FLIGHT.cruiseSpeed) {
  const dx = tx - d.pos.x;
  const dz = tz - d.pos.z;
  const dist = Math.hypot(dx, dz);
  const want = Math.min(speed, Math.sqrt(2 * FLIGHT.accel * dist) * 0.95);
  const wx = dist > 0.01 ? (dx / dist) * want : 0;
  const wz = dist > 0.01 ? (dz / dist) * want : 0;
  const k = Math.min(1, (FLIGHT.accel * dt) / Math.max(0.001, Math.hypot(wx - d.vel.x, wz - d.vel.z)));
  d.vel.x += (wx - d.vel.x) * k;
  d.vel.z += (wz - d.vel.z) * k;
  d.vel.y = Math.max(-FLIGHT.climbSpeed, Math.min(FLIGHT.climbSpeed, (ty - d.pos.y) * 1.6));
  d.pos.x += d.vel.x * dt;
  d.pos.z += d.vel.z * dt;
  d.pos.y += d.vel.y * dt;
  return dist;
}

function hover(s: Sim, d: Drone, input: Input, dt: number, ty: number) {
  const steer = s.player.mode === 'console' && s.selected === d.idx ? input.nudge : { x: 0, z: 0 };
  const wx = s.wind.x * 0.45 + steer.x * FLIGHT.nudgeSpeed;
  const wz = s.wind.z * 0.45 + steer.z * FLIGHT.nudgeSpeed;
  const k = Math.min(1, dt * 3);
  d.vel.x += (wx - d.vel.x) * k;
  d.vel.z += (wz - d.vel.z) * k;
  d.vel.y = (ty - d.pos.y) * 1.6;
  d.pos.x += d.vel.x * dt;
  d.pos.z += d.vel.z * dt;
  d.pos.y += d.vel.y * dt;
}

function legAltitude(dist: number) {
  return dist < 50 ? FLIGHT.holdAlt + (FLIGHT.cruiseAlt - FLIGHT.holdAlt) * Math.max(0, (dist - 8) / 42) : FLIGHT.cruiseAlt;
}

function updateDrone(s: Sim, d: Drone, input: Input, dt: number) {
  const pad = BASE.pads[d.idx];
  const order = orderById(s, d.orderId);

  if (isFlying(d)) {
    const drain = d.state === 'hold' || d.state === 'approach' || d.fault === 'gps' ? FLIGHT.drainHover : FLIGHT.drainFlying;
    d.battery = Math.max(0, d.battery - drain * dt);
    if (!d.warnedLow && d.battery < FLIGHT.lowBattery) { d.warnedLow = true; note(s, `${droneName(d.idx)} 배터리 부족 (${Math.round(d.battery)}%) — 착륙 후 교체`, 'warn'); }
    if (!d.warnedCritical && d.battery < FLIGHT.criticalBattery) {
      d.warnedCritical = true;
      emit(s, { type: 'banner', text: `${droneName(d.idx)} 배터리 위험`, level: 'bad' }); sfx(s, 'alarm');
    }
    if (d.battery <= 0) { crash(s, d); return; }
    if (d.faultAt != null && s.time >= d.faultAt && (d.state === 'outbound' || d.state === 'returning')) {
      d.faultAt = null; d.fault = 'gps'; d.fixProgress = 0;
      emit(s, { type: 'banner', text: `${droneName(d.idx)} GPS 장애 — 콘솔에서 F 길게`, level: 'bad' }); sfx(s, 'alarm');
      note(s, `${droneName(d.idx)} GPS 신호 끊김. 자동 비행 일시 정지.`, 'bad');
      emit(s, { type: 'log', kind: 'fault-gps', drone: d.idx });
    }
  }

  if (d.fault === 'gps' && isFlying(d)) {
    hover(s, d, { ...input, nudge: { x: 0, z: 0 } }, dt, d.pos.y);
    if (s.player.mode === 'console' && s.selected === d.idx && input.fixHeld) {
      d.fixProgress += dt;
      if (d.fixProgress >= FLIGHT.gpsFixTime) {
        d.fault = null; d.fixProgress = 0; s.stats.faultsFixed++;
        note(s, `${droneName(d.idx)} GPS 재보정 완료. 자동 비행 재개.`, 'good'); sfx(s, 'fixed');
        emit(s, { type: 'log', kind: 'fixed-gps', drone: d.idx });
      }
    } else d.fixProgress = Math.max(0, d.fixProgress - dt * 0.5);
    return;
  }

  switch (d.state) {
    case 'pad':
      d.pos.x = pad.x; d.pos.y = 0; d.pos.z = pad.z; d.vel = v3();
      break;
    case 'takeoff':
      moveToward(d, pad.x, FLIGHT.cruiseAlt, pad.z, dt);
      if (d.pos.y > FLIGHT.cruiseAlt * 0.7 && order) d.state = 'outbound';
      break;
    case 'outbound': {
      if (!order) { d.state = 'returning'; break; }
      const dist = Math.hypot(order.dest.x - d.pos.x, order.dest.z - d.pos.z);
      moveToward(d, order.dest.x, legAltitude(dist), order.dest.z, dt);
      if (dist < 1.5 && Math.abs(d.pos.y - FLIGHT.holdAlt) < 1) {
        d.state = 'hold';
        emit(s, { type: 'banner', text: `${droneName(d.idx)} ${order.dest.name} 상공 — 콘솔에서 투하`, level: 'warn' });
        sfx(s, 'alarm');
        emit(s, { type: 'log', kind: 'arrive', drone: d.idx });
      }
      break;
    }
    case 'hold':
      hover(s, d, input, dt, FLIGHT.holdAlt);
      break;
    case 'returning': {
      const dist = Math.hypot(pad.x - d.pos.x, pad.z - d.pos.z);
      moveToward(d, pad.x, legAltitude(dist), pad.z, dt);
      if (dist < 1.5 && Math.abs(d.pos.y - FLIGHT.holdAlt) < 1) {
        d.state = 'approach';
        emit(s, { type: 'banner', text: `${droneName(d.idx)} ${d.idx + 1}번 패드 상공 복귀 — 콘솔에서 착륙`, level: 'warn' });
        sfx(s, 'alarm');
        emit(s, { type: 'log', kind: 'home', drone: d.idx });
      }
      break;
    }
    case 'approach':
      hover(s, d, input, dt, FLIGHT.holdAlt);
      break;
    case 'landing': {
      const dx = pad.x - d.pos.x;
      const dz = pad.z - d.pos.z;
      const centering = d.hardLanding ? 0.6 : 2.5;
      d.pos.x += Math.sign(dx) * Math.min(Math.abs(dx), centering * dt) + s.wind.x * 0.1 * dt;
      d.pos.z += Math.sign(dz) * Math.min(Math.abs(dz), centering * dt) + s.wind.z * 0.1 * dt;
      d.vel = v3(0, -FLIGHT.landSpeed, 0);
      d.pos.y -= FLIGHT.landSpeed * dt;
      if (d.pos.y <= 0) touchDown(s, d);
      break;
    }
    case 'down':
      d.downTimer -= dt;
      if (d.pos.y > 0) { d.vel.y -= 9.8 * dt; d.pos.x += d.vel.x * dt; d.pos.z += d.vel.z * dt; d.pos.y = Math.max(0, d.pos.y + d.vel.y * dt); }
      if (d.downTimer <= 0) {
        d.state = 'pad'; d.fault = 'motor'; d.battery = 5; d.warnedLow = true; d.warnedCritical = true;
        note(s, `${droneName(d.idx)} ${d.idx + 1}번 패드로 회수됨. 배터리 교체와 로터 수리가 필요합니다.`, 'warn');
      }
      break;
  }
  if (Math.hypot(d.vel.x, d.vel.z) > 1) d.yaw = Math.atan2(-d.vel.x, -d.vel.z);
}

function touchDown(s: Sim, d: Drone) {
  d.pos.y = 0;
  d.state = 'pad';
  const trip = s.time - d.tripStart;
  s.stats.trips.push(trip);
  emit(s, { type: 'log', kind: 'touchdown', drone: d.idx, value: trip });
  sfx(s, 'land');
  if (d.hardLanding) {
    d.fault = 'motor';
    emit(s, { type: 'banner', text: `경착륙 — ${droneName(d.idx)} 로터 손상`, level: 'bad' });
    note(s, `경착륙. ${d.idx + 1}번 패드에서 ${droneName(d.idx)}을 수리하세요 (E 길게).`, 'bad'); sfx(s, 'alarm');
    emit(s, { type: 'log', kind: 'fault-motor', drone: d.idx });
  } else if (Math.random() < s.stage.faultChance * 0.6 && d.flights > 1) {
    d.fault = 'motor';
    emit(s, { type: 'banner', text: `${droneName(d.idx)} 로터 진동 — 패드에서 수리`, level: 'bad' });
    note(s, `${droneName(d.idx)} 로터 진동. ${d.idx + 1}번 패드에서 E를 길게 눌러 수리하세요.`, 'bad'); sfx(s, 'alarm');
    emit(s, { type: 'log', kind: 'fault-motor', drone: d.idx });
  } else {
    note(s, `${droneName(d.idx)} ${d.idx + 1}번 패드 착륙 (왕복 ${trip.toFixed(1)}초)`, 'good');
  }
}

function crash(s: Sim, d: Drone) {
  const o = orderById(s, d.orderId);
  if (o) { o.status = 'lost'; d.orderId = null; }
  d.state = 'down';
  d.fault = null;
  d.downTimer = 12;
  s.score = Math.max(0, s.score - SCORE.crashPenalty);
  s.streak = 0;
  s.stats.crashes++;
  emit(s, { type: 'banner', text: `${droneName(d.idx)} 전원 상실 (-${SCORE.crashPenalty})`, level: 'bad' });
  sfx(s, 'fail');
  emit(s, { type: 'log', kind: 'crash', drone: d.idx });
}

function updatePackages(s: Sim, dt: number) {
  for (const p of s.packages) {
    p.vel.y -= 9.8 * dt;
    p.vel.x += (s.wind.x - p.vel.x) * 0.9 * dt;
    p.vel.z += (s.wind.z - p.vel.z) * 0.9 * dt;
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
    p.pos.z += p.vel.z * dt;
    if (p.pos.y <= 0.3) landPackage(s, p);
  }
  s.packages = s.packages.filter((p) => p.pos.y > 0.3);
}

export function predictImpact(s: Sim, pos: V3, vel: V3): { x: number; z: number } {
  const p = { ...pos, y: pos.y - 0.6 };
  const v = { x: vel.x, y: 0, z: vel.z };
  const dt = 1 / 60;
  for (let i = 0; i < 600 && p.y > 0.3; i++) {
    v.y -= 9.8 * dt;
    v.x += (s.wind.x - v.x) * 0.9 * dt;
    v.z += (s.wind.z - v.z) * 0.9 * dt;
    p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
  }
  return { x: p.x, z: p.z };
}

export function gradeFor(dist: number): Grade {
  if (dist <= SCORE.perfectRadius) return 'PERFECT';
  if (dist <= SCORE.goodRadius) return 'GOOD';
  if (dist <= SCORE.okRadius) return 'OK';
  return 'MISS';
}

function landPackage(s: Sim, p: Package) {
  const o = orderById(s, p.orderId)!;
  const dist = Math.hypot(p.pos.x - o.dest.x, p.pos.z - o.dest.z);
  const grade = gradeFor(dist);
  emit(s, { type: 'log', kind: 'impact', drone: p.drone, value: dist });
  if (grade === 'MISS') {
    o.status = 'missed';
    s.score = Math.max(0, s.score - SCORE.missPenalty);
    s.streak = 0;
    s.stats.missed++;
    emit(s, { type: 'popup', text: `${GRADE_LABEL.MISS} ${dist.toFixed(1)} m  -${SCORE.missPenalty}`, grade });
    note(s, `${o.dest.name} 택배가 목표를 벗어났습니다`, 'bad');
    sfx(s, 'miss');
    return;
  }
  const precision = grade === 'PERFECT' ? SCORE.perfect : grade === 'GOOD' ? SCORE.good : 0;
  const elapsed = s.time - o.spawnedAt;
  const onTime = elapsed < s.stage.orderDeadline * 0.75 ? SCORE.onTime : 0;
  const mult = comboMult(s.streak);
  const pts = Math.round((SCORE.base + precision + onTime) * mult);
  s.score += pts;
  s.streak++;
  s.stats.bestStreak = Math.max(s.stats.bestStreak, s.streak);
  s.stats.delivered++;
  if (grade === 'PERFECT') s.stats.perfect++;
  if (grade === 'GOOD') s.stats.good++;
  o.status = 'delivered';
  const parts = [`${GRADE_LABEL[grade]} +${pts}`];
  if (onTime) parts.push('정시');
  if (mult > 1) parts.push(`x${mult.toFixed(2)}`);
  emit(s, { type: 'popup', text: parts.join('  '), grade });
  note(s, `${o.dest.name} 배송 완료: +${pts}`, 'good');
  sfx(s, grade === 'PERFECT' ? 'perfect' : 'good');
  emit(s, { type: 'log', kind: 'delivered', drone: p.drone, value: pts });
}

function updateWind(s: Sim) {
  const t = s.time * 0.05 + s.windSeed;
  const base = s.stage.windBase;
  const strength = base * (0.7 + 0.3 * Math.sin(t * 2.3)) + base * 0.5 * Math.max(0, Math.sin(t * 7.1) * Math.sin(t * 3.3));
  const dir = t * 0.6 + Math.sin(t * 1.7);
  s.wind.x = Math.cos(dir) * strength;
  s.wind.z = Math.sin(dir) * strength;
}

// ---------------------------------------------------------------- player movement

interface Box { minX: number; maxX: number; minZ: number; maxZ: number }

export function colliders(s: Sim): Box[] {
  const h = BASE.hangar;
  const t = 0.3;
  const boxes: Box[] = [
    { minX: h.minX - t, maxX: h.minX + t, minZ: h.minZ, maxZ: h.maxZ },
    { minX: h.maxX - t, maxX: h.maxX + t, minZ: h.minZ, maxZ: h.maxZ },
    { minX: h.minX, maxX: h.maxX, minZ: h.minZ - t, maxZ: h.minZ + t },
    { minX: h.minX, maxX: -6.5, minZ: h.maxZ - t, maxZ: h.maxZ + t },
    { minX: 6.5, maxX: h.maxX, minZ: h.maxZ - t, maxZ: h.maxZ + t },
    { minX: -12, maxX: -10.2, minZ: -6.4, maxZ: 3.9 },
    { minX: 10.3, maxX: 12, minZ: -2.4, maxZ: 0.4 },
    { minX: -2.8, maxX: 2.8, minZ: -9, maxZ: -8.1 },
  ];
  for (const d of s.drones) if (d.pos.y < 1.5) boxes.push({ minX: d.pos.x - 1.1, maxX: d.pos.x + 1.1, minZ: d.pos.z - 1.1, maxZ: d.pos.z + 1.1 });
  return boxes;
}

function movePlayer(s: Sim, input: Input, dt: number) {
  const p = s.player;
  const len = Math.hypot(input.move.f, input.move.r);
  if (len < 0.01) return;
  const f = input.move.f / Math.max(1, len);
  const r = input.move.r / Math.max(1, len);
  const sp = BASE.walkSpeed * (p.carrying ? 0.85 : 1) * dt;
  const dx = (-Math.sin(p.yaw) * f + Math.cos(p.yaw) * r) * sp;
  const dz = (-Math.cos(p.yaw) * f - Math.sin(p.yaw) * r) * sp;
  const boxes = colliders(s);
  const rad = 0.35;
  const blocked = (x: number, z: number) => boxes.some((b) => x > b.minX - rad && x < b.maxX + rad && z > b.minZ - rad && z < b.maxZ + rad);
  const B = BASE.bounds;
  // Already inside a collider (e.g. a drone recovered onto the pad the player stands on):
  // let the player walk out instead of locking every step.
  const stuck = blocked(p.x, p.z);
  const nx = Math.max(B.minX, Math.min(B.maxX, p.x + dx));
  if (stuck || !blocked(nx, p.z)) p.x = nx;
  const nz = Math.max(B.minZ, Math.min(B.maxZ, p.z + dz));
  if (stuck || !blocked(p.x, nz)) p.z = nz;
}

// ---------------------------------------------------------------- main step

export function step(s: Sim, input: Input, dt: number) {
  if (s.phase !== 'playing') return;
  s.time += dt;
  s.timeLeft = Math.max(0, s.stage.timeLimit - s.time);
  updateWind(s);
  updateOrders(s);
  if (s.player.mode === 'walk') {
    movePlayer(s, input, dt);
    s.target = findTarget(s);
    const pr = promptFor(s, s.target);
    if (pr?.hold && pr.enabled && input.interactHeld && s.target?.kind === 'pad') {
      s.player.holdProgress += dt;
      if (s.player.holdProgress >= FLIGHT.repairTime) {
        const d = s.drones[s.target.idx];
        d.fault = null; s.player.holdProgress = 0; s.stats.faultsFixed++;
        note(s, `${droneName(d.idx)} 로터 수리 완료`, 'good'); sfx(s, 'fixed');
        emit(s, { type: 'log', kind: 'fixed-motor', drone: d.idx });
      }
    } else s.player.holdProgress = 0;
  } else s.target = null;
  for (const d of s.drones) updateDrone(s, d, input, dt);
  updatePackages(s, dt);

  if (s.score >= s.stage.target) {
    s.phase = 'clear';
    sfx(s, 'clear');
    emit(s, { type: 'log', kind: 'stage-clear', value: s.stage.id });
  } else if (s.timeLeft <= 0) {
    s.phase = 'fail';
    sfx(s, 'fail');
    emit(s, { type: 'log', kind: 'stage-fail', value: s.stage.id });
  }
}

// ---------------------------------------------------------------- guidance

/** Where the player is in the delivery loop; the HUD highlights it in the step strip. */
export type LoopStep = 'order' | 'pick' | 'check' | 'seal' | 'attach' | 'launch' | 'fly' | 'drop' | 'land' | 'service';

export interface Objective { text: string; step: LoopStep; at: { x: number; z: number; y: number } | null }

export function objective(s: Sim): Objective {
  const p = s.player;
  const consoleAt = { x: BASE.console.x, z: BASE.console.z, y: 2.2 };
  const padAt = (i: number) => ({ x: BASE.pads[i].x, z: BASE.pads[i].z, y: 2.6 });
  const att = s.drones.find(needsAttention);
  if (att) {
    const what = att.fault === 'gps' ? 'GPS 재보정 (F 길게)' : att.state === 'hold' ? '목표 링에 택배 투하' : '패드에 착륙';
    return { text: `${droneName(att.idx)}: 콘솔에서 ${what}`, step: att.fault === 'gps' ? 'fly' : att.state === 'hold' ? 'drop' : 'land', at: p.mode === 'walk' ? consoleAt : null };
  }
  if (p.carrying?.kind === 'crate') {
    const free = s.drones.find((d) => d.state === 'pad' && d.orderId == null);
    return free ? { text: `${free.idx + 1}번 패드의 ${droneName(free.idx)}에 상자 연결`, step: 'attach', at: padAt(free.idx) } : { text: '빈 드론 없음 — 기다리거나 상자를 선반에 두세요', step: 'attach', at: null };
  }
  if (p.carrying?.kind === 'battery') {
    const low = s.drones.filter((d) => d.state === 'pad').sort((a, b) => a.battery - b.battery)[0];
    return low ? { text: `${droneName(low.idx)} 배터리 교체 (${low.idx + 1}번 패드)`, step: 'service', at: padAt(low.idx) } : { text: '드론이 착륙하면 배터리를 교체하세요', step: 'service', at: null };
  }
  const broken = s.drones.find((d) => d.state === 'pad' && d.fault === 'motor');
  if (broken) return { text: `${droneName(broken.idx)} 로터 수리: ${broken.idx + 1}번 패드에서 E 길게`, step: 'service', at: padAt(broken.idx) };
  const low = s.drones.find((d) => d.state === 'pad' && d.battery < FLIGHT.lowBattery);
  if (low) return { text: `${droneName(low.idx)} 배터리 ${Math.round(low.battery)}% — 충전 거치대에서 배터리 가져오기`, step: 'service', at: { x: BASE.batteryRack.x, z: BASE.batteryRack.z, y: 2.4 } };
  const ready = s.drones.find((d) => d.state === 'pad' && d.orderId != null);
  if (ready) return { text: `콘솔에서 ${droneName(ready.idx)} 출발`, step: 'launch', at: p.mode === 'walk' ? consoleAt : null };
  const freeDrone = s.drones.find((d) => d.state === 'pad' && d.orderId == null);
  const waiting = s.orders.filter((o) => o.status === 'waiting').sort((a, b) => a.deadline - b.deadline)[0];
  if (freeDrone && waiting && waiting.slot != null) {
    const sl = BASE.shelfSlots[waiting.slot];
    return { text: `화물 선반에서 ${waiting.dest.id} 상자 (${waiting.dest.name}) 들기`, step: 'pick', at: { x: sl.x, z: sl.z, y: 2.3 } };
  }
  if (!waiting) return { text: '다음 주문을 기다리는 중…', step: 'order', at: null };
  return { text: '드론 비행 중 — 상태 카드를 확인하세요', step: 'fly', at: null };
}

export function stageById(id: number) { return STAGES.find((st) => st.id === id); }
export function startPlaying(s: Sim) { if (s.phase === 'briefing') s.phase = 'playing'; }
