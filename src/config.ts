export interface StageDef {
  id: number;
  name: string;
  drones: number;
  target: number;
  timeLimit: number;
  orderInterval: number;
  maxPending: number;
  orderDeadline: number;
  windBase: number;
  faultChance: number;
  briefing: string[];
}

export const STAGES: StageDef[] = [
  {
    id: 1,
    name: '주간 근무 — 드론 1대',
    drones: 1,
    target: 450,
    timeLimit: 420,
    orderInterval: 22,
    maxPending: 3,
    orderDeadline: 120,
    windBase: 1.2,
    faultChance: 0.15,
    briefing: [
      '하늘길 택배 기지의 1번 패드를 맡았습니다. 드론 1대, 운영자는 당신 한 명.',
      '주문이 들어오면 화물 선반에서 해당 상자를 들고 드론에 실은 뒤, 관제 콘솔에서 비행시키세요.',
      '바람을 보며 목표 링에 택배를 투하하고, 돌아온 드론을 패드에 착륙시키세요.',
      '배터리가 부족하면 충전 거치대에서 교체하고, 고장은 그때그때 처리하세요.',
    ],
  },
  {
    id: 2,
    name: '러시아워 — 드론 2대',
    drones: 2,
    target: 1000,
    timeLimit: 480,
    orderInterval: 13,
    maxPending: 4,
    orderDeadline: 105,
    windBase: 2.2,
    faultChance: 0.25,
    briefing: [
      '2번 패드가 열렸습니다. 이제 드론 2대를 동시에 운영합니다.',
      '한 대가 비행하는 동안 다른 한 대에 짐을 실으세요. 콘솔에서 1 / 2 또는 Tab으로 화면을 전환합니다.',
      '바람이 더 세고 고장이 잦습니다. 주문 마감도 더 빠릅니다.',
      '제자리 비행 중에도 배터리는 닳습니다. 두 드론의 상태 카드를 계속 확인하세요.',
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
  shelfSlots: [
    { x: -11, z: -5 },
    { x: -11, z: -2.5 },
    { x: -11, z: 0 },
    { x: -11, z: 2.5 },
  ],
  batteryRack: { x: 11, z: -1 },
  playerStart: { x: 0, z: 1, yaw: Math.PI },
  walkSpeed: 5.2,
  interactRange: 2.8,
};
