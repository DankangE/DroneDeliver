import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { DRONE_COLORS, ROTOR_BLUR_LAYER, box, canvasTex, finish, lamp, solid, strut, type Surfaces } from './materials';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function rounded(parent: THREE.Object3D, w: number, h: number, d: number, radius: number, mat: THREE.Material, x: number, y: number, z: number) {
  return solid(parent, new RoundedBoxGeometry(w, h, d, 3, radius), mat, x, y, z);
}

export function batteryPack(metal: THREE.Material) {
  const pack = new THREE.Group();
  const rubber = finish(0x222b2e, 0.86);
  rounded(pack, 0.32, 0.50, 0.20, 0.027, rubber, 0, 0, 0);
  rounded(pack, 0.326, 0.34, 0.205, 0.016, metal, 0, 0.012, 0);
  const grip = finish(0x38424a);
  for (const y of [-0.14, -0.105, -0.07]) box(pack, 0.28, 0.014, 0.215, grip, 0, y, 0);
  const green = lamp(0x6cf18b, 1.8);
  for (const x of [-0.084, -0.028, 0.028, 0.084]) box(pack, 0.038, 0.029, 0.013, green, x, 0.115, 0.103);
  const brass = finish(0xba9859, 0.32, 0.8);
  for (const x of [-0.085, 0.085]) box(pack, 0.052, 0.015, 0.065, brass, x, 0.25, 0);
  return pack;
}

function propellerBlade() {
  // The center rib gives the swept blade camber and a pitched trailing edge.
  const outline = [[0.07, 0, 0.025], [0.15, -0.015, 0.06], [0.33, -0.048, 0.066], [0.46, -0.085, 0.04], [0.5, -0.094, 0.008]];
  const points: number[] = [], indexes: number[] = [];
  for (const [x, z, chord] of outline) {
    points.push(x, 0.008, z - chord, x, 0.022, z - chord * 0.2, x, -0.013, z + chord);
  }
  for (let i = 0; i < outline.length - 1; i++) {
    const a = i * 3;
    indexes.push(a, a + 1, a + 3, a + 1, a + 4, a + 3, a + 1, a + 2, a + 4, a + 2, a + 5, a + 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geo.setIndex(indexes);
  geo.computeVertexNormals();
  return geo;
}

function rotorBlur() {
  const map = canvasTex(256, 256, g => {
    g.translate(128, 128);
    for (let r = 18; r < 125; r += 1) {
      const alpha = (0.08 + 0.14 * Math.sin(Math.PI * (r - 18) / 107)) * Math.min(1, (125 - r) / 7);
      g.strokeStyle = 'rgba(38,43,46,' + alpha + ')';
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(0, 0, r, 0, 2 * Math.PI); g.stroke();
      for (let blade = 0; blade < 2; blade++) {
        const a = blade * Math.PI - r / 350;
        g.beginPath(); g.arc(0, 0, r, a, a + 0.85); g.stroke();
      }
    }
  });
  return new THREE.MeshStandardMaterial({ map, roughness: 0.5, transparent: true, depthWrite: false, side: THREE.DoubleSide });
}

export function droneModel(i: number, surfaces: Surfaces) {
  const group = new THREE.Group(), tilt = new THREE.Group();
  group.add(tilt);
  group.scale.setScalar(1.4);
  const polymer = finish(0x353e44, 0.43, 0.16);
  const rubber = finish(0x192025, 0.76);
  const alloy = finish(0xb2b8b6, 0.27, 0.86);
  const stripe = new THREE.MeshPhysicalMaterial({ color: DRONE_COLORS[i], roughness: 0.34, clearcoat: 0.65 });
  const weave = canvasTex(32, 32, g => {
    g.fillStyle = '#22292c'; g.fillRect(0, 0, 32, 32);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      g.fillStyle = (x + y) % 2 ? '#384046' : '#2b3439';
      g.fillRect(x * 8, y * 8, 7, 7);
    }
  });
  weave.wrapS = weave.wrapT = THREE.RepeatWrapping;
  weave.repeat.set(12, 9);
  const carbon = new THREE.MeshPhysicalMaterial({ map: weave, roughness: 0.49, clearcoat: 0.38, clearcoatRoughness: 0.32 });
  rounded(tilt, 0.88, 0.27, 1.12, 0.105, polymer, 0, 0.55, 0);
  rounded(tilt, 0.80, 0.14, 1.05, 0.064, carbon, 0, 0.695, -0.015);
  for (const side of [-1, 1]) {
    rounded(tilt, 0.10, 0.036, 0.82, 0.017, stripe, side * 0.31, 0.754, -0.04);
    for (let vent = 0; vent < 5; vent++) {
      box(tilt, 0.014, 0.065, 0.044, rubber, side * 0.438, 0.555, -0.12 + vent * 0.08);
    }
  }
  rounded(tilt, 0.39, 0.15, 0.43, 0.035, surfaces.metal, 0, 0.78, 0.18);
  rounded(tilt, 0.09, 0.16, 0.44, 0.012, rubber, 0, 0.782, 0.18);
  const gauge = lamp(0x48ff8b, 2);
  const battery = box(tilt, 0.29, 0.018, 0.056, gauge, 0, 0.865, 0.32);

  const blades = propellerBlade(), bladeMat = finish(0x23282c, 0.47, 0.14);
  bladeMat.side = THREE.DoubleSide;
  const blurMat = rotorBlur();
  const bells = new THREE.CylinderGeometry(0.113, 0.099, 0.125, 24);
  const rotors = [];
  const red = lamp(0xff291c, 4.5), green = lamp(0x14ff68, 4.5), strobe = lamp(0xf8fbff, 5);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * 0.82, z = sz * 0.82;
    const root = V(sx * 0.315, 0.55, sz * 0.32), end = V(x, 0.659, z);
    strut(tilt, root, end, 0.062, carbon);
    strut(tilt, V(sx * 0.34, 0.52, sz * 0.22), end, 0.028, surfaces.metal);
    rounded(tilt, 0.17, 0.14, 0.16, 0.035, stripe, root.x, root.y, root.z);
    solid(tilt, bells, polymer, x, 0.718, z);
    for (const y of [0.675, 0.765]) solid(tilt, new THREE.CylinderGeometry(0.115, 0.115, 0.014, 24), alloy, x, y, z);
    const motor = new THREE.Group();
    motor.position.set(x, 0.80, z);
    tilt.add(motor);
    const prop = new THREE.Group();
    for (const a of [0, Math.PI]) solid(prop, blades, bladeMat).rotation.y = a;
    prop.rotation.y = sx * sz * 0.6;
    motor.add(prop);
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(1.02, 1.02), blurMat);
    disc.rotation.x = -Math.PI / 2;
    disc.layers.set(ROTOR_BLUR_LAYER);
    disc.visible = false;
    motor.add(disc);
    solid(tilt, new THREE.CylinderGeometry(0.045, 0.057, 0.045, 6), alloy, x, 0.82, z);
    solid(tilt, new THREE.SphereGeometry(0.047, 12, 8), sz < 0 ? (sx < 0 ? red : green) : strobe, x, 0.635, z);
    rotors.push({ motor, prop, disc, direction: sx * sz });
  }
  for (const sx of [-1, 1]) {
    const x = sx * 0.39;
    for (const sz of [-1, 1]) {
      strut(tilt, V(sx * 0.28, 0.46, sz * 0.30), V(x, 0.11, sz * 0.41), 0.027, alloy);
      strut(tilt, V(x, 0.11, sz * 0.48), V(x, 0.153, sz * 0.55), 0.036, rubber);
    }
    strut(tilt, V(x, 0.11, -0.49), V(x, 0.11, 0.49), 0.038, rubber);
  }
  // Isolated yaw bearing, fork, camera housing and coated front element.
  solid(tilt, new THREE.CylinderGeometry(0.095, 0.09, 0.10, 20), surfaces.metal, 0, 0.405, -0.43);
  for (const sx of [-1, 1]) rounded(tilt, 0.035, 0.16, 0.10, 0.012, alloy, sx * 0.126, 0.34, -0.43);
  rounded(tilt, 0.22, 0.18, 0.22, 0.045, polymer, 0, 0.29, -0.46);
  solid(tilt, new THREE.CylinderGeometry(0.075, 0.082, 0.062, 24), rubber, 0, 0.29, -0.575).rotation.x = -Math.PI / 2;
  const lens = new THREE.MeshPhysicalMaterial({ color: 0x163140, metalness: 0.45, roughness: 0.09, clearcoat: 1 });
  solid(tilt, new THREE.SphereGeometry(0.064, 24, 12), lens, 0, 0.29, -0.607).scale.z = 0.22;
  const led = lamp(0x48ff8b, 2.6);
  rounded(tilt, 0.13, 0.055, 0.026, 0.012, led, 0, 0.55, -0.558);
  return { group, tilt, rotors, led, battery, gauge, strobe, speed: 0 };
}

export type DroneMesh = ReturnType<typeof droneModel>;
