import * as THREE from 'three';
import { DRONE_COLORS, lamp, type Surfaces } from './materials';
import { addShell, addUndercarriage, addWinch } from './drone/airframe';
import { makePack } from './drone/battery';
import { addCamera } from './drone/camera';
import { finishes } from './drone/finishes';
import { batchRigidParts, rounded } from './drone/parts';
import { addRotor } from './drone/rotors';

export function batteryPack(metal: THREE.Material) {
  return makePack(metal).pack;
}

export function droneModel(i: number, surfaces: Surfaces) {
  const group = new THREE.Group(), tilt = new THREE.Group(), body = new THREE.Group();
  group.add(tilt); tilt.add(body);
  // Preserve both the metre-scale pad footprint and the package attachment datum.
  group.scale.setScalar(1.4);
  const team = DRONE_COLORS[i % DRONE_COLORS.length], serial = String(i + 1).padStart(2, '0');
  const stripe = new THREE.MeshPhysicalMaterial({ color: team, roughness: 0.38, clearcoat: 0.4, clearcoatRoughness: 0.28 });
  const led = lamp(0x48ff8b, 3.4), strobe = lamp(0xf7faff, 6);
  const port = lamp(0xff3227, 9), starboard = lamp(0x24f977, 5.3);
  addShell(body, serial, team, led, strobe);
  addUndercarriage(body);
  addWinch(body);
  addCamera(body);

  const m = finishes();
  rounded(body, 0.286, 0.033, 0.40, 0.015, m.gasket, 0, 0.773, 0.258);
  for (const sx of [-1, 1]) {
    rounded(body, 0.021, 0.044, 0.369, 0.009, m.anodized, sx * 0.126, 0.788, 0.255);
  }
  // The installed pack slides contacts-first into a sealed connector boot.
  rounded(body, 0.17, 0.085, 0.050, 0.012, m.nylon, 0, 0.823, 0.073);
  const { pack, battery, gauge } = makePack(surfaces.metal);
  // The hand-held/racked cartridge is authored in metres. Use that same physical
  // cartridge in the scaled airframe, laid flat with its labelled face uppermost.
  pack.scale.setScalar(1 / group.scale.x);
  pack.position.set(0, 0.831, 0.25);
  pack.rotation.x = -Math.PI / 2;
  tilt.add(pack);

  const rotors = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    rotors.push(addRotor(tilt, body, sx, sz, stripe, sx < 0 ? port : starboard));
  }
  batchRigidParts(body);
  return { group, tilt, rotors, led, battery, gauge, strobe, speed: 0 };
}

export type DroneMesh = ReturnType<typeof droneModel>;
