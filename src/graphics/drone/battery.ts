import * as THREE from 'three';
import { lamp, solid } from '../materials';
import { batteryPlate, finishes } from './finishes';
import { batchRigidParts, rounded, screw } from './parts';

const housings = new WeakMap<THREE.Material, THREE.Group>();
let plate: THREE.Material | undefined;

function housing(metal: THREE.Material) {
  const m = finishes(), shell = new THREE.Group();
  rounded(shell, 0.304, 0.48, 0.188, 0.025, m.nylon);
  for (const side of [-1, 1]) {
    rounded(shell, 0.32, 0.065, 0.204, 0.016, m.rubber, 0, side * 0.214, 0);
    rounded(shell, 0.018, 0.375, 0.164, 0.008, m.gasket, side * 0.152, 0, 0);
    rounded(shell, 0.013, 0.34, 0.021, 0.005, metal, side * 0.158, 0, -0.048);
    for (const y of [-0.153, 0.12]) {
      screw(shell, side * 0.123, y, 0.095, 0.009, m.sockets).rotation.x = Math.PI / 2;
    }
  }
  for (let i = 0; i < 4; i++) {
    rounded(shell, 0.22, 0.009, 0.009, 0.004, m.gasket, 0, -0.139 - i * 0.015, 0.094);
  }
  solid(shell, new THREE.PlaneGeometry(0.203, 0.178), plate ??= batteryPlate(), 0, -0.011, 0.0947);
  rounded(shell, 0.160, 0.03, 0.009, 0.004, m.gasket, 0, 0.137, 0.094);
  rounded(shell, 0.19, 0.036, 0.08, 0.009, m.gasket, 0, 0.233, -0.016);
  for (const x of [-0.062, 0, 0.062]) {
    rounded(shell, 0.026, 0.009, 0.052, 0.003, m.brass, x, 0.249, -0.016);
  }
  rounded(shell, 0.09, 0.032, 0.014, 0.005, m.latch, 0, -0.213, 0.103);
  batchRigidParts(shell);
  return shell;
}

export function makePack(metal: THREE.Material) {
  let template = housings.get(metal);
  if (!template) {
    template = housing(metal);
    housings.set(metal, template);
  }
  const pack = template.clone();
  const gauge = lamp(0x55ed92, 2.4);
  // The emitter's origin is its left terminal. World scales its X axis as the pack drains.
  const bar = new THREE.BoxGeometry(0.136, 0.012, 0.002).translate(0.068, 0, 0);
  const battery = solid(pack, bar, gauge, -0.068, 0.137, 0.100);
  for (const x of [-0.034, 0, 0.034]) {
    rounded(pack, 0.004, 0.014, 0.003, 0.001, finishes().gasket, x, 0.137, 0.101);
  }
  return { pack, gauge, battery };
}
