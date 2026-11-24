export type ProductId = 'ramen' | 'water' | 'lettuce' | 'eggs' | 'milk' | 'apple';
/** Cargo handling rules; they only apply on stages with `fresh` set. */
export type CargoTag = 'cold' | 'fragile';
export const TAG_LABEL: Record<CargoTag, string> = { cold: '냉장', fragile: '파손주의' };
export interface Product { id: ProductId; name: string; unit: string; color: number; tags: CargoTag[] }

export const PRODUCTS: Product[] = [
  { id: 'ramen', name: '라면', unit: '개', color: 0xe56037, tags: [] },
  { id: 'water', name: '생수', unit: '병', color: 0x73c9ea, tags: [] },
  { id: 'lettuce', name: '상추', unit: '통', color: 0x76ac50, tags: ['cold'] },
  { id: 'eggs', name: '계란', unit: '판', color: 0xd3aa7f, tags: ['fragile'] },
  { id: 'milk', name: '우유', unit: '팩', color: 0x4b80c8, tags: ['cold'] },
  { id: 'apple', name: '사과', unit: '개', color: 0xcd4137, tags: [] },
];

export const productById = (id: ProductId) => PRODUCTS.find((product) => product.id === id)!;
export const bayLetter = (bay: number) => String.fromCharCode(65 + bay);

export interface StageDef {
  id: number;
  name: string;
  drones: number;
  target: number;
  timeLimit: number;
  orderInterval: number;
  maxPending: number;
  orderDeadline: number;
  orderLines: [number, number];
  orderUnits: [number, number];
  windBase: number;
  faultChance: number;
  /** Fresh delivery: share of orders that carry at least one cold or fragile product. Unset = no cargo rules. */
  fresh?: { share: number };
  briefing: string[];
}

export const STAGES: StageDef[] = [
  {
    id: 1,
    name: '주간 근무 — 드론 1대',
    drones: 1,
    target: 620,
    timeLimit: 360,
    orderInterval: 52,
    maxPending: 2,
    orderDeadline: 165,
    orderLines: [2, 3],
    orderUnits: [3, 4],
    windBase: 1.2,
    faultChance: 0.15,
    briefing: [
      '하늘길 택배 기지의 1번 패드를 맡았습니다. 드론 1대, 운영자는 당신 한 명.',
      '주문 목록을 확인하고 포장대에서 상자를 여세요. 선반에서 물건을 하나씩 꺼내 포장대 상자에 담으세요.',
      '빈손으로 포장 확인을 한 뒤 상자를 봉인하세요. 패드에서 드론에 연결하고 관제 콘솔에서 출발시키세요.',
      '바람을 보며 목표 링에 택배를 투하하고, 돌아온 드론을 패드에 착륙시키세요.',
      '배터리가 부족하면 충전 거치대에서 교체하고, 고장은 그때그때 처리하세요.',
    ],
  },
  {
    id: 2,
    name: '러시아워 — 드론 2대',
    drones: 2,
    target: 1460,
    timeLimit: 360,
    orderInterval: 30,
    maxPending: 3,
    orderDeadline: 150,
    orderLines: [2, 3],
    orderUnits: [3, 5],
    windBase: 2.2,
    faultChance: 0.25,
    briefing: [
      '2번 패드가 열렸습니다. 이제 드론 2대를 동시에 운영합니다.',
      '한 대가 비행하는 동안 다음 주문을 확인하세요. 선반에서 물건을 하나씩 꺼내 포장대 상자에 담으세요.',
      '포장 확인 후 봉인한 상자를 빈 드론에 연결하세요. 콘솔에서 출발시키고 1 / 2 또는 Tab으로 드론을 전환하세요.',
      '바람이 더 세고 고장이 잦습니다. 주문 마감도 더 빠릅니다.',
      '제자리 비행 중에도 배터리는 닳습니다. 두 드론의 상태 카드를 계속 확인하세요.',
    ],
  },
  {
    id: 3,
    name: '신선 배송 — 냉장 · 파손주의',
    drones: 2,
    target: 1600,
    timeLimit: 360,
    orderInterval: 34,
    maxPending: 3,
    orderDeadline: 160,
    orderLines: [2, 3],
    orderUnits: [3, 5],
    windBase: 2.0,
    faultChance: 0.2,
    fresh: { share: 0.6 },
    briefing: [
      '신선식품 배송이 시작됐습니다. 우유 · 상추가 든 주문에는 냉장, 계란이 든 주문에는 파손주의 표시가 붙습니다.',
      '냉장 주문은 포장대 옆 냉동고에서 아이스팩 1개를 꺼내 상자에 넣어야 포장 확인을 통과합니다.',
      '봉인한 순간부터 보냉 90초가 흐릅니다. 빈 드론이 있을 때 봉인하고, 90초 안에 도착시키면 보냉 보너스를 받습니다.',
      '파손주의 화물은 드론이 거의 멈췄을 때(수평 속도 1.2 m/s 이하) 투하하세요. 콘솔 아래 안정도 게이지가 초록일 때입니다.',
      '드론은 2대입니다. 바람과 고장은 러시아워보다 조금 약합니다.',
    ],
  },
];

export interface Destination {
  id: string;
  name: string;
  x: number;
  z: number;
  color: number;
}

export const DESTINATIONS: Destination[] = [
  { id: 'A1', name: '북문 의원', x: 40, z: -190, color: 0x4fc3f7 },
  { id: 'B2', name: '항구 아파트', x: 185, z: -60, color: 0xffb74d },
  { id: 'C3', name: '솔마루 농장', x: -175, z: -95, color: 0x81c784 },
  { id: 'D4', name: '옛방앗간 카페', x: -150, z: 140, color: 0xe57373 },
  { id: 'E5', name: '노을 테라스', x: 120, z: 160, color: 0xba68c8 },
  { id: 'F6', name: '강변 초등학교', x: -40, z: 205, color: 0xfff176 },
];

export const FLIGHT = {
  cruiseAlt: 30,
  holdAlt: 12,
  cruiseSpeed: 18,
  climbSpeed: 8,
  landSpeed: 4.5,
  accel: 7,
  nudgeSpeed: 6,
  drainFlying: 1.1,
  drainHover: 0.8,
  lowBattery: 35,
  criticalBattery: 12,
  hardLandingOffset: 2.6,
  gpsFixTime: 2,
  repairTime: 2,
};

export const SCORE = {
  base: 100,
  perfect: 60,
  good: 25,
  onTime: 30,
  expiredPenalty: 40,
  missPenalty: 20,
  crashPenalty: 60,
  packErrorPenalty: 10,
  coldBonus: 40,
  coldLimit: 90,
  fragileBonus: 30,
  fragileMaxSpeed: 1.2,
  breakPenalty: 30,
  comboStep: 0.25,
  comboMax: 2,
  perfectRadius: 2,
  goodRadius: 5,
  okRadius: 9,
};

export const BASE = {
  hangar: { minX: -12, maxX: 12, minZ: -9, maxZ: 7 },
  bounds: { minX: -19, maxX: 19, minZ: -8.5, maxZ: 22 },
  pads: [
    { x: -6, z: 14 },
    { x: 6, z: 14 },
  ],
  console: { x: 0, z: -7.6 },
  itemBays: [
    { x: -11, z: -5.6 },
    { x: -11, z: -4.0 },
    { x: -11, z: -2.4 },
    { x: -11, z: -0.8 },
    { x: -11, z: 0.8 },
    { x: -11, z: 2.4 },
  ],
  shelfLevels: [0.72, 1.42],
  packTable: { x: -6.4, z: -1.6 },
  /** Chest freezer for ice packs, south of the packing table; w along x, d along z. */
  freezer: { x: -6.4, z: 1.3, w: 1.0, d: 0.8 },
  batteryRack: { x: 11, z: -1 },
  playerStart: { x: 0, z: 1, yaw: Math.PI },
  walkSpeed: 5.2,
  interactRange: 2.8,
};
