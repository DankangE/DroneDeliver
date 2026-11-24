import { BASE, FLIGHT, PRODUCTS, SCORE, STAGES, WINCH, bayLetter, productById, stageDestinations, TAG_LABEL, type CargoTag, type ProductId, type Destination, type StageDef } from './config';

export type DroneState = 'pad' | 'takeoff' | 'outbound' | 'hold' | 'winch' | 'returning' | 'approach' | 'landing' | 'down';
export type Fault = 'gps' | 'motor' | null;
export type Phase = 'briefing' | 'playing' | 'clear' | 'fail';
export type OrderStatus = 'waiting' | 'packing' | 'carried' | 'loaded' | 'flying' | 'delivered' | 'missed' | 'expired' | 'lost';
export type Grade = 'PERFECT' | 'GOOD' | 'OK' | 'MISS';

export interface V3 { x: number; y: number; z: number }

export interface OrderLine { product: ProductId; qty: number }
export interface Box { orderId: number; contents: ProductId[]; icePack: boolean; checked: boolean; missing: OrderLine[] }

export interface Order {
  id: number;
  dest: Destination;
  spawnedAt: number;
  deadline: number;
  status: OrderStatus;
  items: OrderLine[];
  /** Handling rules for this order; empty outside fresh stages. */
  tags: CargoTag[];
  launchedAt: number | null;
  /** Seal time; the cold limit counts from here. */
  sealedAt: number | null;
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
  /** Winch rope paid out below the loaded position (m); reels back in after a release. */
  rope: number;
  /** Hanging box, horizontal world position and velocity; the box swings under the hook while `winch`. */
  bob: { x: number; z: number; vx: number; vz: number };
  /** Space was held for this drone last step; letting go at full rope releases the box. */
  winchHeld: boolean;
}

/** `dropSpeed`: the drone's horizontal speed when it let go; judges fragile cargo.
 *  `floor`: height the drop is judged at. `lost`: already judged a miss, falls to the ground and vanishes. */
export interface Package { orderId: number; pos: V3; vel: V3; drone: number; dropSpeed: number; floor: number; lost: boolean }

export type Carry = { kind: 'item'; product: ProductId } | { kind: 'crate'; orderId: number } | { kind: 'battery' } | { kind: 'icepack' } | null;

export type Target =
  | { kind: 'bay'; bay: number }
  | { kind: 'table' }
  | { kind: 'freezer' }
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
  /** Space held at the console; pays out the winch rope. */
  winchHeld: boolean;
}

export interface Stats { delivered: number; perfect: number; good: number; missed: number; expired: number; crashes: number; faultsFixed: number; swaps: number; bestStreak: number; trips: number[]; coldKept: number; coldWarm: number; fragileSafe: number; broken: number; balcony: number; balconyLost: number }

export interface Sim {
  stage: StageDef;
  phase: Phase;
  time: number;
  timeLeft: number;
  score: number;
  streak: number;
  stats: Stats;
  orders: Order[];
  box: Box | null;
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
      warnedLow: false, warnedCritical: false, flights: 0, rope: 0, bob: { x: p.x, z: p.z, vx: 0, vz: 0 }, winchHeld: false,
    });
  }
  return {
    stage, phase: 'briefing', time: 0, timeLeft: stage.timeLimit, score: 0, streak: 0,
    stats: { delivered: 0, perfect: 0, good: 0, missed: 0, expired: 0, crashes: 0, faultsFixed: 0, swaps: 0, bestStreak: 0, trips: [], coldKept: 0, coldWarm: 0, fragileSafe: 0, broken: 0, balcony: 0, balconyLost: 0 },
    orders: [], box: null, drones, packages: [], wind: { x: 0, z: 0 }, windSeed: Math.random() * 100, selected: 0,
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
/** Hover height over a destination: 12 m over the ground, a clearance above roofs and cradles. */
export const holdAltitude = (dest: Destination) =>
  dest.kind === 'roof' ? dest.y + FLIGHT.roofClearance : dest.kind === 'balcony' ? dest.y + FLIGHT.balconyClearance : FLIGHT.holdAlt;
/** Crate centre while it hangs on the winch, and the rope length that sets it on the cradle. */
export const hangingY = (d: Drone) => d.pos.y + 0.36 - d.rope;
export const ropeMax = (d: Drone, dest: Destination) => Math.max(0, d.pos.y + 0.36 - (dest.y + 0.35));
export const swaySpeed = (d: Drone) => Math.hypot(d.bob.vx - d.vel.x, d.bob.vz - d.vel.z);
export const comboMult = (streak: number) => Math.min(1 + streak * SCORE.comboStep, SCORE.comboMax);

// ---------------------------------------------------------------- orders

const between = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

function orderItems(stage: StageDef): OrderLine[] {
  const lines = between(...stage.orderLines);
  const units = between(Math.max(lines, stage.orderUnits[0]), Math.min(lines * 3, stage.orderUnits[1]));
  const special = stage.fresh ? Math.random() < stage.fresh.share : null;
  // Plain fresh-stage orders draw only untagged products; special ones lead with a tagged one.
  const choices = PRODUCTS.filter(product => special !== false || !product.tags.length);
  const items: OrderLine[] = [];
  while (items.length < lines) {
    const pool = special && !items.length ? choices.filter(product => product.tags.length) : choices;
    const product = pool[between(0, pool.length - 1)];
    choices.splice(choices.indexOf(product), 1);
    items.push({ product: product.id, qty: 1 });
  }
  for (let i = lines; i < units; i++) {
    const available = items.filter(line => line.qty < 3);
    available[between(0, available.length - 1)].qty++;
  }
  return items;
}

export function orderText(o: Order): string {
  return o.items.map(line => `${productById(line.product).name} ×${line.qty}`).join(' · ');
}

export const packedQty = (box: Box, id: ProductId) => box.contents.filter(item => item === id).length;
export const hasTag = (o: Order, tag: CargoTag) => o.tags.includes(tag);
/** Seconds of cold left once sealed; null for orders without the cold rule or not sealed yet. */
export const coldLeft = (s: Sim, o: Order) => (hasTag(o, 'cold') && o.sealedAt != null ? SCORE.coldLimit - (s.time - o.sealedAt) : null);

function orderTags(stage: StageDef, items: OrderLine[]): CargoTag[] {
  if (!stage.fresh) return [];
  const tags = new Set(items.flatMap(line => productById(line.product).tags));
  return (['cold', 'fragile'] as const).filter(tag => tags.has(tag));
}
const pending = (o: Order) => o.status === 'waiting' || o.status === 'packing' || o.status === 'carried' || o.status === 'loaded';
const nextWaiting = (s: Sim) => s.orders.reduce<Order | undefined>((next, o) =>
  o.status === 'waiting' && (!next || o.deadline < next.deadline) ? o : next, undefined);

function spawnOrder(s: Sim) {
  const choices = stageDestinations(s.stage).filter((d) => d.id !== s.lastDest);
  const dest = choices[Math.floor(Math.random() * choices.length)];
  s.lastDest = dest.id;
  const items = orderItems(s.stage);
  const order: Order = { id: s.nextOrderId++, dest, spawnedAt: s.time, deadline: s.time + s.stage.orderDeadline, status: 'waiting', items, tags: orderTags(s.stage, items), launchedAt: null, sealedAt: null };
  s.orders.push(order);
  const tagText = order.tags.map(tag => ` [${TAG_LABEL[tag]}]`).join('');
  note(s, `새 주문 #${order.id}: ${dest.id} ${dest.name}${tagText} — ${orderText(order)}`, 'info');
  sfx(s, 'order');
}

function updateOrders(s: Sim) {
  if (s.time >= s.nextOrderAt) {
    if (s.orders.filter(pending).length < s.stage.maxPending) spawnOrder(s);
    s.nextOrderAt = s.time + s.stage.orderInterval * (0.8 + Math.random() * 0.4);
  }
  for (const o of s.orders) {
    if (pending(o) && s.time > o.deadline) {
      if (s.box?.orderId === o.id) s.box = null;
      if (o.status === 'carried') s.player.carrying = null;
      if (o.status === 'loaded') {
        const d = s.drones.find((dr) => dr.orderId === o.id);
        if (d) d.orderId = null;
      }
      o.status = 'expired';
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
  const carry = s.player.carrying;
  BASE.itemBays.forEach((p, bay) => {
    if (!carry || (carry.kind === 'item' && carry.product === PRODUCTS[bay].id)) spots.push({ target: { kind: 'bay', bay }, ...p });
  });
  spots.push({ target: { kind: 'table' }, ...BASE.packTable });
  spots.push({ target: { kind: 'freezer' }, x: BASE.freezer.x, z: BASE.freezer.z });
  spots.push({ target: { kind: 'rack' }, x: BASE.batteryRack.x, z: BASE.batteryRack.z });
  BASE.pads.forEach((p, idx) => spots.push({ target: { kind: 'pad', idx }, x: p.x, z: p.z }));
  spots.push({ target: { kind: 'console' }, x: BASE.console.x, z: BASE.console.z });
  return spots;
}

function facingBay(s: Sim) {
  const p = s.player;
  const first = BASE.itemBays[0];
  const west = Math.sin(p.yaw);
  if (west <= 0) return -1;
  const distance = (p.x - (first.x + 0.77)) / west;
  if (distance < 0 || distance > BASE.interactRange) return -1;
  const hitZ = p.z - distance * Math.cos(p.yaw);
  const bay = Math.round((hitZ - first.z) / (BASE.itemBays[1].z - first.z));
  return BASE.itemBays[bay] && Math.hypot(first.x - p.x, BASE.itemBays[bay].z - p.z) <= BASE.interactRange ? bay : -1;
}

function findTarget(s: Sim): Target | null {
  const p = s.player;
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  const bay = facingBay(s);
  let best: Target | null = null;
  let bestScore = Infinity;
  for (const spot of interactables(s)) {
    if (spot.target.kind === 'bay' && spot.target.bay !== bay) continue;
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

const action = (text: string): Prompt => ({ text, hold: false, enabled: true });
const disabled = (text: string): Prompt => ({ text, hold: false, enabled: false });

export function promptFor(s: Sim, t: Target | null): Prompt | null {
  const carry = s.player.carrying;
  if (!t) {
    if (!carry) return null;
    const bay = facingBay(s);
    if (bay < 0 || (carry.kind === 'item' && PRODUCTS[bay].id === carry.product)) return null;
    t = { kind: 'bay', bay };
  }
  switch (t.kind) {
    case 'bay': {
      const product = PRODUCTS[t.bay];
      if (!carry) return action(`[E] ${product.name} 1${product.unit} 꺼내기 (선반 ${bayLetter(t.bay)})`);
      if (carry.kind !== 'item') return disabled('손이 꽉 찼습니다');
      if (carry.product === product.id) return action(`[E] ${product.name} 선반에 돌려놓기`);
      const name = productById(carry.product).name;
      const particle = (name.charCodeAt(name.length - 1) - 0xac00) % 28 ? '을' : '를';
      return disabled(`손에 ${name}${particle} 들고 있습니다`);
    }
    case 'table': {
      if (carry?.kind === 'battery') return disabled('배터리를 먼저 내려놓으세요');
      if (carry?.kind === 'crate') return s.box ? disabled('포장대를 사용 중입니다') : action('[E] 상자를 포장대에 내려놓기');
      const order = s.box ? orderById(s, s.box.orderId)! : nextWaiting(s);
      if (!order) return disabled('포장할 주문을 기다리는 중');
      if (carry?.kind === 'icepack') {
        if (!hasTag(order, 'cold')) return disabled(`주문 #${order.id}은 냉장 주문이 아닙니다 — 냉동고에 돌려놓으세요`);
        if (s.box?.icePack) return disabled('아이스팩이 이미 들어 있습니다');
      }
      const what = carry?.kind === 'icepack' ? '아이스팩' : carry ? productById(carry.product).name : '';
      if (!s.box) return action(`[E] 주문 #${order.id} 포장 시작 — ${orderText(order)}${what ? ` · ${what} 넣기` : ''}`);
      if (carry) return action(`[E] 상자에 ${what} 넣기`);
      if (s.box.checked) return action('[E] 상자 봉인');
      return s.box.contents.length ? action('[E] 포장 확인') : disabled('선반에서 물건을 가져와 담으세요');
    }
    case 'freezer':
      if (!s.stage.fresh) return disabled('이번 근무에는 냉장 주문이 없습니다');
      if (carry?.kind === 'icepack') return action('[E] 아이스팩 냉동고에 돌려놓기');
      if (carry) return disabled('손이 꽉 찼습니다');
      return action('[E] 아이스팩 꺼내기');
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
      if (carry?.kind === 'item' || carry?.kind === 'icepack') return disabled('물건을 포장대 상자에 담으세요');
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
    case 'winch': return '윈치 하강';
    case 'returning': return '복귀 중';
    case 'approach': return '착륙 대기';
    case 'landing': return '착륙 중';
    case 'down': return '추락';
  }
}

export function needsAttention(d: Drone): boolean {
  return d.state === 'hold' || d.state === 'winch' || d.state === 'approach' || (d.fault === 'gps' && isFlying(d));
}

// ---------------------------------------------------------------- player actions

function checkBox(s: Sim, box: Box, order: Order) {
  const errors: string[] = [];
  let errorUnits = 0;
  box.missing = [];
  for (const product of PRODUCTS) {
    const need = order.items.find(line => line.product === product.id)?.qty ?? 0;
    const diff = packedQty(box, product.id) - need;
    if (!diff) continue;
    errors.push(`${product.name} ${Math.abs(diff)}${product.unit} ${diff > 0 ? '잘못 담음' : '부족'}`);
    errorUnits += Math.abs(diff);
    if (diff < 0) box.missing.push({ product: product.id, qty: -diff });
    else {
      let keep = need;
      box.contents = box.contents.filter(id => id !== product.id || keep-- > 0);
    }
  }
  if (hasTag(order, 'cold') && !box.icePack) {
    errors.push('아이스팩 부족');
    errorUnits++;
  }
  box.checked = errorUnits === 0;
  if (box.checked) {
    note(s, '포장 확인 완료 — 봉인하세요', 'good');
    sfx(s, 'fixed');
  } else {
    const penalty = errorUnits * SCORE.packErrorPenalty;
    s.score = Math.max(0, s.score - penalty);
    note(s, `포장 오류 -${penalty}: ${errors.join(' · ')}`, 'bad');
    sfx(s, 'deny');
    emit(s, { type: 'log', kind: 'pack-error', value: penalty });
  }
}

function useTable(s: Sim) {
  const carry = s.player.carrying;
  if (carry?.kind === 'crate') {
    const order = orderById(s, carry.orderId)!;
    const contents = order.items.flatMap(line => Array<ProductId>(line.qty).fill(line.product));
    s.box = { orderId: order.id, contents, icePack: hasTag(order, 'cold'), checked: true, missing: [] };
    order.status = 'packing';
    s.player.carrying = null;
    sfx(s, 'pickup');
    return;
  }

  const order = s.box ? orderById(s, s.box.orderId)! : nextWaiting(s)!;
  if (!s.box) {
    order.status = 'packing';
    s.box = { orderId: order.id, contents: [], icePack: false, checked: false, missing: [] };
    emit(s, { type: 'log', kind: 'packing', value: order.id });
  }
  if (carry?.kind === 'item' || carry?.kind === 'icepack') {
    if (carry.kind === 'item') s.box.contents.push(carry.product);
    else s.box.icePack = true;
    s.box.checked = false;
    s.player.carrying = null;
    sfx(s, 'pickup');
  } else if (s.box.checked) {
    s.player.carrying = { kind: 'crate', orderId: order.id };
    order.status = 'carried';
    s.box = null;
    sfx(s, 'attach');
    if (hasTag(order, 'cold') && order.sealedAt == null) {
      order.sealedAt = s.time;
      note(s, `주문 #${order.id} 봉인 — 보냉 ${SCORE.coldLimit}초 시작`, 'warn');
    }
    emit(s, { type: 'log', kind: 'seal', value: order.id });
  } else if (s.box.contents.length) {
    checkBox(s, s.box, order);
  } else {
    sfx(s, 'pickup');
  }
}

export function interact(s: Sim) {
  if (s.phase !== 'playing' || s.player.mode !== 'walk') return;
  const t = s.target;
  const pr = promptFor(s, t);
  if (!t || !pr) return;
  if (!pr.enabled || pr.hold) { if (!pr.enabled) sfx(s, 'deny'); return; }
  const p = s.player;
  switch (t.kind) {
    case 'bay':
      p.carrying = p.carrying ? null : { kind: 'item', product: PRODUCTS[t.bay].id };
      sfx(s, 'pickup');
      return;
    case 'table':
      useTable(s);
      return;
    case 'freezer':
      p.carrying = p.carrying?.kind === 'icepack' ? null : { kind: 'icepack' };
      sfx(s, 'pickup');
      return;
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
    case 'hold':
      return orderById(s, d.orderId)?.dest.kind === 'balcony'
        ? { label: '[Space 길게] 윈치로 내리기', enabled: true, reason: '베란다는 투하 금지 — 줄로 내려 거치대에 놓습니다' }
        : { label: '[Space] 택배 투하', enabled: true };
    case 'winch': {
      const o = orderById(s, d.orderId)!;
      if (d.rope < ropeMax(d, o.dest) - 0.05) return { label: '[Space 길게] 줄 내리기', enabled: true, reason: `줄 ${d.rope.toFixed(1)} / ${ropeMax(d, o.dest).toFixed(1)} m` };
      return { label: '[Space 떼기] 거치대에 내려놓기', enabled: true, reason: '흔들림이 잦아들고 상자가 거치대 위일 때 떼세요' };
    }
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
  else if (d.state === 'hold' && orderById(s, d.orderId)?.dest.kind === 'balcony') startWinch(s, d);
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
  const dropSpeed = Math.hypot(d.vel.x, d.vel.z);
  const floor = orderById(s, d.orderId)!.dest.y;
  s.packages.push({ orderId: d.orderId!, pos: { ...d.pos, y: d.pos.y - 0.6 }, vel: { x: d.vel.x, y: 0, z: d.vel.z }, drone: d.idx, dropSpeed, floor, lost: false });
  d.orderId = null;
  d.state = 'returning';
  sfx(s, 'drop');
  emit(s, { type: 'log', kind: 'drop', drone: d.idx, value: dropSpeed });
}

function startWinch(s: Sim, d: Drone) {
  d.state = 'winch';
  d.rope = 0;
  d.bob = { x: d.pos.x, z: d.pos.z, vx: d.vel.x, vz: d.vel.z };
  d.winchHeld = false;
  sfx(s, 'attach');
  emit(s, { type: 'log', kind: 'winch-start', drone: d.idx });
}

/** Input was interrupted (pause, lost focus): forget that Space was down so the next key-up is not read as
 *  a release. The player presses Space again to re-arm the winch. */
export function disarmWinch(s: Sim) {
  for (const d of s.drones) d.winchHeld = false;
}

/** Pays the rope out while Space is held and swings the box like a pendulum under the hook; letting go
 *  at full rope sets the box down, graded by its distance from the cradle centre. */
function updateWinch(s: Sim, d: Drone, input: Input, dt: number, o: Order) {
  const active = s.player.mode === 'console' && s.selected === d.idx;
  const held = active && input.winchHeld;
  const max = ropeMax(d, o.dest);
  const bottom = d.rope >= max - 0.05;
  if (d.winchHeld && !held && active && bottom) { releaseWinch(s, d, o); return; }
  d.winchHeld = held;
  if (held) d.rope = Math.min(max, d.rope + WINCH.lowerSpeed * dt);
  d.rope = Math.min(d.rope, max);
  // Small-angle pendulum: rope tension pulls the box back under the hook, the gusting wind pushes it.
  const b = d.bob;
  const k = 9.8 / (d.rope + 0.6);
  const gust = 1 + 0.5 * Math.sin(s.time * 1.9 + d.idx * 2.1);
  const cross = 0.35 * s.stage.windBase * Math.sin(s.time * 1.3 + d.idx);
  const ax = -k * (b.x - d.pos.x) + WINCH.windPush * (s.wind.x * gust - s.wind.z / (Math.hypot(s.wind.x, s.wind.z) || 1) * cross) - WINCH.damping * (b.vx - d.vel.x);
  const az = -k * (b.z - d.pos.z) + WINCH.windPush * (s.wind.z * gust + s.wind.x / (Math.hypot(s.wind.x, s.wind.z) || 1) * cross) - WINCH.damping * (b.vz - d.vel.z);
  b.vx += ax * dt; b.vz += az * dt;
  b.x += b.vx * dt; b.z += b.vz * dt;
  const reach = 0.6 * d.rope + 0.05;
  const off = Math.hypot(b.x - d.pos.x, b.z - d.pos.z);
  if (off > reach) {
    b.x = d.pos.x + (b.x - d.pos.x) * reach / off;
    b.z = d.pos.z + (b.z - d.pos.z) * reach / off;
  }
}

export function balconyGrade(dist: number): Grade {
  if (dist <= SCORE.balconyPerfect) return 'PERFECT';
  if (dist <= SCORE.balconyGood) return 'GOOD';
  if (dist <= SCORE.balconyOk) return 'OK';
  return 'MISS';
}

function releaseWinch(s: Sim, d: Drone, o: Order) {
  const dist = Math.hypot(d.bob.x - o.dest.x, d.bob.z - o.dest.z);
  const grade = balconyGrade(dist);
  d.orderId = null;
  d.winchHeld = false;
  d.state = 'returning';
  emit(s, { type: 'log', kind: 'winch-release', drone: d.idx, value: dist });
  if (grade === 'MISS') {
    // The box slips past the cradle and falls to the street.
    s.packages.push({ orderId: o.id, pos: { x: d.bob.x, y: hangingY(d), z: d.bob.z }, vel: { x: d.bob.vx, y: 0, z: d.bob.vz }, drone: d.idx, dropSpeed: 0, floor: 0, lost: true });
    s.stats.balconyLost++;
    missOrder(s, o, dist, `${o.dest.name} 상자가 거치대를 벗어나 떨어졌습니다 — 분실`);
    return;
  }
  s.stats.balcony++;
  deliverOrder(s, o, grade, d.idx, { bonus: SCORE.balconyBonus, label: '베란다', dropSpeed: 0 });
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

function hover(s: Sim, d: Drone, input: Input, dt: number, ty: number, nudgeSpeed = FLIGHT.nudgeSpeed) {
  const steer = s.player.mode === 'console' && s.selected === d.idx ? input.nudge : { x: 0, z: 0 };
  const wx = s.wind.x * 0.45 + steer.x * nudgeSpeed;
  const wz = s.wind.z * 0.45 + steer.z * nudgeSpeed;
  const k = Math.min(1, dt * 3);
  d.vel.x += (wx - d.vel.x) * k;
  d.vel.z += (wz - d.vel.z) * k;
  d.vel.y = (ty - d.pos.y) * 1.6;
  d.pos.x += d.vel.x * dt;
  d.pos.z += d.vel.z * dt;
  d.pos.y += d.vel.y * dt;
}

function legAltitude(dist: number, hold: number = FLIGHT.holdAlt) {
  return dist < 50 ? hold + (FLIGHT.cruiseAlt - hold) * Math.max(0, (dist - 8) / 42) : FLIGHT.cruiseAlt;
}

function updateDrone(s: Sim, d: Drone, input: Input, dt: number) {
  const pad = BASE.pads[d.idx];
  const order = orderById(s, d.orderId);

  if (d.state !== 'winch' && d.rope > 0) d.rope = Math.max(0, d.rope - WINCH.reelSpeed * dt);
  if (isFlying(d)) {
    const drain = d.state === 'hold' || d.state === 'winch' || d.state === 'approach' || d.fault === 'gps' ? FLIGHT.drainHover : FLIGHT.drainFlying;
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
      const hold = holdAltitude(order.dest);
      moveToward(d, order.dest.x, legAltitude(dist, hold), order.dest.z, dt);
      if (dist < 1.5 && Math.abs(d.pos.y - hold) < 1) {
        d.state = 'hold';
        const how = order.dest.kind === 'balcony' ? '윈치로 내려주기' : '투하';
        emit(s, { type: 'banner', text: `${droneName(d.idx)} ${order.dest.name} 상공 — 콘솔에서 ${how}`, level: 'warn' });
        sfx(s, 'alarm');
        emit(s, { type: 'log', kind: 'arrive', drone: d.idx });
      }
      break;
    }
    case 'hold':
      if (!order) { d.state = 'returning'; break; }
      hover(s, d, input, dt, holdAltitude(order.dest));
      break;
    case 'winch':
      if (!order) { d.state = 'returning'; break; }
      // Fine steering while the box hangs, so the player can walk it over the cradle without pumping the swing.
      hover(s, d, input, dt, holdAltitude(order.dest), WINCH.nudgeSpeed);
      updateWinch(s, d, input, dt, order);
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
  d.winchHeld = false;
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
    if (!p.lost && p.pos.y <= p.floor + 0.3) landPackage(s, p);
  }
  // Landed packages vanish; a missed roof drop keeps falling past the roof to the street.
  s.packages = s.packages.filter((p) => p.lost ? p.pos.y > 0.3 : p.pos.y > p.floor + 0.3);
}

/** Where a drop from `pos` meets the plane at height `floor` (the destination surface). */
export function predictImpact(s: Sim, pos: V3, vel: V3, floor = 0): { x: number; z: number } {
  const p = { ...pos, y: pos.y - 0.6 };
  const v = { x: vel.x, y: 0, z: vel.z };
  const dt = 1 / 60;
  for (let i = 0; i < 600 && p.y > floor + 0.3; i++) {
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
    if (p.floor > 0) p.lost = true;
    missOrder(s, o, dist, `${o.dest.name} 택배가 목표를 벗어났습니다`);
    return;
  }
  deliverOrder(s, o, grade, p.drone, { bonus: 0, label: '', dropSpeed: p.dropSpeed });
}

function missOrder(s: Sim, o: Order, dist: number, text: string) {
  o.status = 'missed';
  s.score = Math.max(0, s.score - SCORE.missPenalty);
  s.streak = 0;
  s.stats.missed++;
  emit(s, { type: 'popup', text: `${GRADE_LABEL.MISS} ${dist.toFixed(1)} m  -${SCORE.missPenalty}`, grade: 'MISS' });
  note(s, text, 'bad');
  sfx(s, 'miss');
}

/** Scores a delivered order. `extra.bonus`: kind bonus (balcony), named `extra.label` in the popup. */
function deliverOrder(s: Sim, o: Order, landed: Exclude<Grade, 'MISS'>, drone: number, extra: { bonus: number; label: string; dropSpeed: number }) {
  let grade: Grade = landed;
  const p = { dropSpeed: extra.dropSpeed };
  const cold = coldLeft(s, o);
  const warm = cold != null && cold < 0;
  const fragile = hasTag(o, 'fragile');
  const broken = fragile && p.dropSpeed > SCORE.fragileMaxSpeed;
  // Broken cargo caps at OK; warm cargo earns the base points only. Either breaks the combo.
  if (broken && grade !== 'OK') grade = 'OK';
  const precision = warm || grade === 'OK' ? 0 : grade === 'PERFECT' ? SCORE.perfect : SCORE.good;
  const elapsed = s.time - o.spawnedAt;
  const onTime = !warm && elapsed < s.stage.orderDeadline * 0.75 ? SCORE.onTime : 0;
  const coldBonus = cold != null && !warm ? SCORE.coldBonus : 0;
  const fragileBonus = fragile && !broken && !warm ? SCORE.fragileBonus : 0;
  const mult = broken || warm ? 1 : comboMult(s.streak);
  const pts = Math.round((SCORE.base + precision + onTime + coldBonus + fragileBonus + extra.bonus) * mult) - (broken ? SCORE.breakPenalty : 0);
  s.score += pts;
  s.streak = broken || warm ? 0 : s.streak + 1;
  s.stats.bestStreak = Math.max(s.stats.bestStreak, s.streak);
  s.stats.delivered++;
  if (grade === 'PERFECT') s.stats.perfect++;
  if (grade === 'GOOD') s.stats.good++;
  if (cold != null) s.stats[warm ? 'coldWarm' : 'coldKept']++;
  if (fragile) s.stats[broken ? 'broken' : 'fragileSafe']++;
  o.status = 'delivered';
  const parts = [`${GRADE_LABEL[grade]} +${pts}`];
  if (broken) parts.unshift('파손');
  if (warm) parts.unshift('온도 이탈');
  if (onTime) parts.push('정시');
  if (coldBonus) parts.push('보냉');
  if (fragileBonus) parts.push('무사 도착');
  if (extra.bonus) parts.push(extra.label);
  if (mult > 1) parts.push(`x${mult.toFixed(2)}`);
  emit(s, { type: 'popup', text: parts.join('  '), grade });
  if (broken) note(s, `${o.dest.name} 파손주의 화물 파손 — 투하 속도 ${p.dropSpeed.toFixed(1)} m/s (기준 ${SCORE.fragileMaxSpeed} m/s 이하, -${SCORE.breakPenalty})`, 'bad');
  if (warm) note(s, `${o.dest.name} 냉장 화물 온도 이탈 — 봉인 후 ${SCORE.coldLimit}초 초과`, 'bad');
  note(s, `${o.dest.name} 배송 완료: +${pts}`, broken || warm ? 'warn' : 'good');
  sfx(s, broken || warm ? 'miss' : grade === 'PERFECT' ? 'perfect' : 'good');
  emit(s, { type: 'log', kind: 'delivered', drone, value: pts });
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

interface Collider { minX: number; maxX: number; minZ: number; maxZ: number }

export function colliders(s: Sim): Collider[] {
  const h = BASE.hangar;
  const t = 0.3;
  const boxes: Collider[] = [
    { minX: h.minX - t, maxX: h.minX + t, minZ: h.minZ, maxZ: h.maxZ },
    { minX: h.maxX - t, maxX: h.maxX + t, minZ: h.minZ, maxZ: h.maxZ },
    { minX: h.minX, maxX: h.maxX, minZ: h.minZ - t, maxZ: h.minZ + t },
    { minX: h.minX, maxX: -6.5, minZ: h.maxZ - t, maxZ: h.maxZ + t },
    { minX: 6.5, maxX: h.maxX, minZ: h.maxZ - t, maxZ: h.maxZ + t },
    { minX: -12, maxX: -10.2, minZ: -6.45, maxZ: 3.25 },
    { minX: BASE.packTable.x - 0.62, maxX: BASE.packTable.x + 0.62, minZ: BASE.packTable.z - 1.25, maxZ: BASE.packTable.z + 1.25 },
    { minX: BASE.freezer.x - BASE.freezer.w / 2, maxX: BASE.freezer.x + BASE.freezer.w / 2, minZ: BASE.freezer.z - BASE.freezer.d / 2, maxZ: BASE.freezer.z + BASE.freezer.d / 2 },
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
  const { mode, carrying } = s.player;
  const consoleAt = { ...BASE.console, y: 2.2 };
  const tableAt = { ...BASE.packTable, y: 2.0 };
  const freezerAt = { x: BASE.freezer.x, z: BASE.freezer.z, y: 1.9 };
  const rackAt = { ...BASE.batteryRack, y: 2.4 };
  const padAt = (i: number) => ({ ...BASE.pads[i], y: 2.6 });
  const bayFor = (id: ProductId) => PRODUCTS.findIndex(product => product.id === id);
  const floor = (text: string, step: LoopStep, at: NonNullable<Objective['at']>): Objective => ({
    text: mode === 'console' ? `[Q] 나가서 ${text}` : text, step, at,
  });
  const free = s.drones.find(d => d.state === 'pad' && d.orderId == null);
  const waiting = nextWaiting(s);
  const putAway = (step: LoopStep): Objective => {
    if (carrying?.kind === 'item') {
      const bay = bayFor(carrying.product);
      const order = s.box ? orderById(s, s.box.orderId) : waiting;
      const need = order?.items.find(line => line.product === carrying.product)?.qty ?? 0;
      const packed = s.box ? packedQty(s.box, carrying.product) : 0;
      if (packed < need) return floor(`포장대 상자에 ${PRODUCTS[bay].name} 넣기`, step, tableAt);
      return floor(`선반 ${bayLetter(bay)}에 ${PRODUCTS[bay].name} 돌려놓기`, step, { ...BASE.itemBays[bay], y: 2.6 });
    }
    if (carrying?.kind === 'crate') {
      if (free && !free.fault) return floor(`${free.idx + 1}번 패드의 ${droneName(free.idx)}에 상자 연결`, step, padAt(free.idx));
      return floor('상자를 포장대에 내려놓기', step, tableAt);
    }
    if (carrying?.kind === 'icepack') {
      const order = s.box ? orderById(s, s.box.orderId) : waiting;
      if (order && hasTag(order, 'cold') && !s.box?.icePack) return floor('포장대 상자에 아이스팩 넣기', step, tableAt);
      return floor('냉동고에 아이스팩 돌려놓기', step, freezerAt);
    }
    return floor('충전 거치대에 배터리 반납', step, rackAt);
  };
  const att = s.drones.find(needsAttention);
  if (att) {
    const step = att.fault === 'gps' ? 'fly' : att.state === 'hold' || att.state === 'winch' ? 'drop' : 'land';
    const balcony = orderById(s, att.orderId)?.dest.kind === 'balcony';
    const what = att.fault === 'gps' ? '[F 길게] GPS 재보정'
      : att.state === 'winch' ? '[Space] 윈치로 거치대에 내려놓기'
      : att.state === 'hold' ? (balcony ? '[Space 길게] 윈치로 거치대에 내려놓기' : '[Space] 목표 링에 투하') : '[Space] 패드에 착륙';
    if (carrying) {
      const next = putAway(step);
      return { ...next, text: `${next.text} → 콘솔에서 ${droneName(att.idx)} ${what}` };
    }
    return { text: `콘솔에서 ${droneName(att.idx)} ${what}`, step, at: mode === 'walk' ? consoleAt : null };
  }
  const broken = s.drones.find(d => d.state === 'pad' && d.fault === 'motor');
  if (broken && carrying?.kind !== 'battery') return floor(`${broken.idx + 1}번 패드에서 [E 길게] 로터 수리`, 'service', padAt(broken.idx));
  const low = s.drones.find(d => d.state === 'pad' && d.battery < FLIGHT.lowBattery);
  if (carrying?.kind === 'battery') {
    const pad = low ?? broken ?? s.drones.filter(d => d.state === 'pad').sort((a, b) => a.battery - b.battery)[0];
    return pad ? floor(`${pad.idx + 1}번 패드에서 배터리 교체`, 'service', padAt(pad.idx)) : putAway('service');
  }
  if (low) {
    if (carrying) {
      const next = putAway('service');
      return { ...next, text: `${next.text} → 충전 거치대에서 배터리 가져오기` };
    }
    return floor(`${droneName(low.idx)} 배터리 ${Math.round(low.battery)}% — 충전 거치대에서 배터리 가져오기`, 'service', rackAt);
  }
  if (carrying) return putAway(carrying.kind === 'crate' ? 'attach' : 'pick');

  const ready = s.drones.find(d => d.state === 'pad' && d.orderId != null);
  if (s.box) {
    const box = s.box;
    const order = orderById(s, box.orderId)!;
    if (box.checked && free) return floor(`포장대에서 [E] 상자 봉인${hasTag(order, 'cold') ? ` · 보냉 ${SCORE.coldLimit}초 시작` : ''}`, 'seal', tableAt);
    if (!box.checked) {
      const missing = order.items.find(line => packedQty(box, line.product) < line.qty);
      if (!missing && hasTag(order, 'cold') && !box.icePack) return floor('냉장 주문 — 냉동고에서 아이스팩 1개 꺼내기', 'pick', freezerAt);
      if (!missing) return floor('포장대에서 [E] 포장 확인', 'check', tableAt);
      const bay = bayFor(missing.product);
      const product = PRODUCTS[bay];
      const progress = order.items.map(line => `${productById(line.product).name} ${packedQty(box, line.product)}/${line.qty}`).join(' · ');
      return floor(`선반 ${bayLetter(bay)}에서 ${product.name} 1${product.unit} 꺼내기 · 상자 ${progress}`, 'pick', { ...BASE.itemBays[bay], y: 2.6 });
    }
  } else if (waiting && (free || !ready)) {
    return floor(`포장대에서 주문 #${waiting.id} 포장 시작`, 'order', tableAt);
  }
  if (ready) return { text: `콘솔에서 ${droneName(ready.idx)} 선택 후 [Space] 출발`, step: 'launch', at: mode === 'walk' ? consoleAt : null };
  if (s.drones.some(isFlying)) return { text: '콘솔에서 비행 상태 확인 · 투하와 착륙 대기', step: 'fly', at: mode === 'walk' ? consoleAt : null };
  const down = s.drones.find(d => d.state === 'down');
  if (down) return { text: `${droneName(down.idx)} 회수 중 · ${Math.ceil(down.downTimer)}초 후 패드에서 정비`, step: 'service', at: padAt(down.idx) };
  return { text: '다음 주문을 기다리는 중…', step: 'order', at: tableAt };
}

export function stageById(id: number) { return STAGES.find((st) => st.id === id); }
export function startPlaying(s: Sim) { if (s.phase === 'briefing') s.phase = 'playing'; }
