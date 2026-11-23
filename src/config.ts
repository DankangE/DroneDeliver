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
    name: 'Day Shift — Single Drone',
    drones: 1,
    target: 450,
    timeLimit: 420,
    orderInterval: 22,
    maxPending: 3,
    orderDeadline: 120,
    windBase: 1.2,
    faultChance: 0.15,
    briefing: [
      'You run Pad 1 at Skyhook Depot. One drone, one operator: you.',
      'Orders arrive on the board. Grab the matching crate from the cargo shelf, load it onto the drone, then fly it from the control console.',
      'Drop the package on the target ring (watch the wind), let it fly home and land it on the pad.',
      'Swap batteries at the charging rack when they run low and clear any faults.',
    ],
  },
  {
    id: 2,
    name: 'Rush Hour — Twin Drones',
    drones: 2,
    target: 1000,
    timeLimit: 480,
    orderInterval: 13,
    maxPending: 4,
    orderDeadline: 105,
    windBase: 2.2,
    faultChance: 0.25,
    briefing: [
      'Pad 2 is online. You now run two drones at the same time.',
      'Keep both in the air: load one while the other cruises, and switch feeds at the console with 1 / 2 or Tab.',
      'Wind is stronger and faults are more common. Orders expire faster.',
      'A drone left hovering still burns battery, so keep an eye on both status cards.',
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
  { id: 'A1', name: 'Northgate Clinic', x: 40, z: -190, color: 0x4fc3f7 },
  { id: 'B2', name: 'Harbor Lofts', x: 185, z: -60, color: 0xffb74d },
  { id: 'C3', name: 'Pine Ridge Farm', x: -175, z: -95, color: 0x81c784 },
  { id: 'D4', name: 'Old Mill Cafe', x: -150, z: 140, color: 0xe57373 },
  { id: 'E5', name: 'Sunset Terrace', x: 120, z: 160, color: 0xba68c8 },
  { id: 'F6', name: 'Riverside School', x: -40, z: 205, color: 0xfff176 },
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
