import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DESTINATIONS, type Destination } from '../config';
import { KO_FONT, box, canvasTex, finish, groundPlane, ink, lamp, seeded, solid, strut, type Surfaces } from './materials';
import { masonryMaterial, signMaterial } from './terrain';

const halfTurn = Math.PI, tau = 2 * Math.PI;
const vec = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function siteMaterials() {
  return {
    plaster: finish(0xe1ddd1, 0.89), slate: finish(0x65726e, 0.85), chalk: finish(0xe6e1cf, 0.89),
    brick: masonryMaterial(0xb07b62, 0xab9987), clay: masonryMaterial(0xd1b59a, 0xbcb3a3),
    zinc: finish(0xafb5ae, 0.39, 0.63), frame: finish(0x495659, 0.50, 0.41),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x718d92, roughness: 0.13, metalness: 0.39, clearcoat: 1, envMapIntensity: 1.25 }),
    curtain: new THREE.MeshPhysicalMaterial({ color: 0xabae9f, metalness: 0.18, roughness: 0.29, clearcoat: 0.79 }),
    leaves: finish(0x718b52, 0.96), timber: finish(0x957758, 0.88),
    soil: finish(0x67533f, 0.98), membrane: finish(0x819e96, 0.86),
  };
}

class Site {
  readonly root = new THREE.Group();
  constructor(readonly s: Surfaces, readonly m: ReturnType<typeof siteMaterials>, readonly dest: Destination) {
    this.root.position.set(dest.x, 0, dest.z);
    // +Z faces the inbound flight. Reserve the entire circular landing court.
    this.root.rotation.y = Math.atan2(-dest.x, -dest.z);
  }

  block(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) {
    return box(this.root, w, h, d, mat, x, y, z);
  }
  floor(w: number, d: number, mat: THREE.Material, x: number, z: number, height = 0.026) {
    return groundPlane(this.root, w, d, mat, x, height, z);
  }
  cylinder(rTop: number, rBase: number, h: number, mat: THREE.Material, x: number, y: number, z: number, sides = 24) {
    return solid(this.root, new THREE.CylinderGeometry(rTop, rBase, h, sides), mat, x, y, z);
  }
  board(text: string, sub: string, color: string, w: number, h: number, x: number, y: number, z: number) {
    this.block(w + 0.09, h + 0.09, 0.13, this.m.frame, x, y, z);
    solid(this.root, new THREE.PlaneGeometry(w, h), signMaterial(text, sub, color), x, y, z + 0.07);
  }
  window(x: number, y: number, z: number, w: number, h: number, pale = false) {
    this.block(w + 0.10, h + 0.12, 0.14, this.m.frame, x, y, z);
    this.block(w, h, 0.036, pale ? this.m.curtain : this.m.glass, x, y, z + 0.084);
    this.block(0.049, h, 0.051, this.m.zinc, x + w * 0.14, y, z + 0.110);
    this.block(w + 0.19, 0.08, 0.24, this.m.chalk, x, y - h / 2 - 0.08, z + 0.05);
  }
  flatRoof(x: number, y: number, z: number, w: number, d: number) {
    this.block(w + 0.36, 0.19, d + 0.36, this.m.membrane, x, y + 0.09, z);
    for (const side of [-1, 1]) {
      this.block(w + 0.26, 0.47, 0.22, this.m.plaster, x, y + 0.33, z + side * d / 2);
      this.block(0.22, 0.47, d, this.m.plaster, x + side * w / 2, y + 0.33, z);
      this.block(w + 0.40, 0.07, 0.30, this.m.zinc, x, y + 0.60, z + side * d / 2);
      this.block(0.30, 0.07, d, this.m.zinc, x + side * w / 2, y + 0.60, z);
    }
  }
  bench(x: number, z: number, yaw = 0) {
    const group = new THREE.Group();
    this.root.add(group); group.position.set(x, 0, z); group.rotation.y = yaw;
    for (const side of [-1, 1]) box(group, 0.09, 0.46, 0.47, this.m.frame, side * 0.80, 0.23, 0);
    for (const v of [-0.18, 0, 0.18]) box(group, 2.06, 0.078, 0.145, this.m.timber, 0, 0.50, v);
    box(group, 2.06, 0.32, 0.065, this.m.timber, 0, 0.77, -0.22);
  }
  planter(x: number, z: number, w: number, d: number, rnd: () => number) {
    this.block(w, 0.44, d, this.m.clay, x, 0.22, z);
    this.block(w - 0.17, 0.055, d - 0.16, this.m.soil, x, 0.45, z);
    const leaf = new THREE.IcosahedronGeometry(0.48, 1);
    for (let u = -w / 2 + 0.53; u < w / 2 - 0.19; u += 0.57) {
      const shrub = solid(this.root, leaf, this.m.leaves, x + u, 0.63 + rnd() * 0.1, z + (rnd() - 0.5) * 0.12);
      shrub.scale.set(1.1, 0.70 + rnd() * 0.38, d * 0.69); shrub.rotation.y = rnd() * tau;
    }
  }
  // Consolidate the static envelope per material. Keep the gameplay ink separate.
  addTo(scene: THREE.Scene) {
    const cells = new Map<THREE.Material, THREE.BufferGeometry[]>();
    this.root.updateMatrixWorld(true);
    this.root.traverse(part => {
      if (!(part instanceof THREE.Mesh) || !(part.material instanceof THREE.Material)) return;
      let group = cells.get(part.material);
      if (!group) cells.set(part.material, group = []);
      // Drop groups and normalize the index layout across tubes, boxes and extrusions.
      const geo = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
      geo.applyMatrix4(part.matrixWorld); group.push(geo);
    });
    const site = new THREE.Group(); site.name = this.dest.name;
    scene.add(site);
    for (const [material, pieces] of cells) solid(site, mergeGeometries(pieces), material);
  }
}

function clinic(site: Site) {
  const { m, s } = site, teal = finish(0x568b86, 0.61, 0.14);
  site.floor(24.5, 12.2, s.floor, 0, -17.2);
  site.block(18.4, 6.85, 8.8, m.plaster, -1.3, 3.425, -19.6);
  site.flatRoof(-1.3, 6.85, -19.6, 18.4, 8.8);
  for (const x of [-8.1, -5.3, -2.5, 0.3, 3.1, 5.9]) site.window(x, 4.92, -15.16, 2.1, 1.64);
  site.block(4.4, 7.67, 1.68, teal, -7.99, 3.835, -14.56);
  site.block(0.63, 1.96, 0.12, m.chalk, -7.99, 5.79, -13.66);
  site.block(1.95, 0.63, 0.12, m.chalk, -7.99, 5.79, -13.65);
  for (const x of [-4.4, -1.7, 1, 3.7, 6.2]) site.window(x, 1.65, -15.16, 2.24, 2.45, x === 3.7);
  site.board(site.dest.name, '외래 진료 · 접수', '#476e67', 6.36, 1.16, 0.4, 3.50, -14.97);
  site.block(12.65, 0.25, 3.68, teal, 0.2, 2.92, -13.65);
  for (const x of [-5.62, 5.98]) site.cylinder(0.089, 0.1, 2.82, m.zinc, x, 1.41, -11.98);
  site.block(3.7, 1.95, 2.55, s.wall, 2.7, 7.96, -20.5);
  for (const x of [-3, -0.6]) {
    site.block(1.6, 0.91, 1.1, m.chalk, x, 7.50, -21);
    for (let i = 0; i < 5; i++) site.block(1.18, 0.055, 0.045, m.frame, x, 7.17 + i * 0.126, -20.44);
  }
  site.bench(-7.9, -11.2);
  site.floor(5.8, 15.5, s.asphalt, 13.83, -3.9);
  for (const z of [-9.8, -5.7, -1.6, 2.5]) site.floor(3.2, 0.105, m.chalk, 14.2, z, 0.036);
  for (const z of [-7.75, -3.65, 0.45]) site.block(0.31, 0.15, 1.32, m.slate, 15.4, 0.095, z);
}

function harbour(site: Site) {
  const { m, s } = site, blue = finish(0x718f99, 0.76), orange = finish(0xb28b6e, 0.78);
  site.floor(27, 15.0, s.floor, 0, -18);
  site.block(19.4, 15.95, 8.0, m.plaster, -1.1, 7.975, -19.8);
  site.flatRoof(-1.1, 15.95, -19.8, 19.4, 8.0);
  site.block(2.86, 17.3, 9.06, blue, 3.04, 8.65, -19.7);
  site.block(0.25, 13.3, 0.24, orange, 4.30, 8.29, -15.08);
  for (let row = 0; row < 5; row++) {
    const y = 1.7 + row * 3.03;
    for (const x of [-8.4, -5.1, -1.8, 6.72]) {
      site.window(x, y, -15.77, 2.48, 1.87, (row + Math.round(x)) % 4 === 0);
      if (row === 0) continue;
      site.block(2.94, 0.18, 1.26, m.chalk, x, y - 1.15, -15.26);
      site.block(0.13, 1.1, 1.16, m.chalk, x - 1.40, y - 0.62, -15.23);
      for (const height of [0.24, 0.97]) site.block(2.91, 0.052, 0.055, m.frame, x, y - 1.11 + height, -14.66);
      for (let bar = 0; bar <= 6; bar++) site.block(0.033, 0.84, 0.043, m.frame, x - 1.42 + bar * 0.47, y - 0.58, -14.66);
    }
    if (row < 3) site.window(3.0, y, -15.14, 1.26, 1.20);
  }
  site.board('101', site.dest.name, '#536f7b', 2.43, 2.86, 3.03, 13.13, -15.10);
  site.board(site.dest.name, '중앙 현관', '#4e656b', 4.65, 0.95, 2.0, 3.0, -14.9);
  site.block(6.6, 0.18, 2.44, blue, 1.6, 2.55, -14.15);
  for (const x of [-1.34, 4.54]) site.cylinder(0.10, 0.12, 2.52, m.zinc, x, 1.26, -13.06);
  site.bench(-7.4, -11.65);
  for (const x of [11.6, 12.5, 13.4, 14.3]) {
    const rail = solid(site.root, new THREE.TorusGeometry(0.58, 0.055, 8, 28, halfTurn), m.zinc, x, 0.34, -5.0);
    rail.rotation.y = halfTurn / 2;
    for (const z of [-5.58, -4.42]) site.cylinder(0.052, 0.052, 0.34, m.zinc, x, 0.17, z, 10);
  }
  const random = seeded(84);
  site.planter(-12.0, -5.8, 4.8, 1.12, random);
  site.planter(-12.0, 4.8, 4.8, 1.12, random);
}

function greenhouse(site: Site, x: number, z: number) {
  const { m } = site, width = 5.5, depth = 11.6, radius = width / 2, spring = 0.84;
  const polythene = new THREE.MeshPhysicalMaterial({ color: 0xc1cec0, roughness: 0.46,
    metalness: 0.06, clearcoat: 0.7, clearcoatRoughness: 0.31, side: THREE.DoubleSide });
  const profile = new THREE.Shape();
  profile.moveTo(-radius, 0); profile.lineTo(radius, 0); profile.lineTo(radius, spring);
  profile.absellipse(0, spring, radius, radius * 0.86, 0, halfTurn, false, 0); profile.closePath();
  const sheet = new THREE.ExtrudeGeometry(profile, { depth, bevelEnabled: false, curveSegments: 18 });
  solid(site.root, sheet, polythene, x, 0, z - depth / 2);
  for (let i = 0; i <= 7; i++) {
    const at = z - depth / 2 + depth * i / 7;
    const rib = solid(site.root, new THREE.TorusGeometry(radius + 0.025, 0.043, 7, 30, halfTurn), m.zinc, x, spring, at);
    rib.scale.y = 0.86;
    for (const edge of [-1, 1]) site.cylinder(0.043, 0.043, spring, m.zinc, x + edge * radius, spring / 2, at, 8);
  }
  site.block(1.72, 2.40, 0.12, m.frame, x, 1.20, z + depth / 2 + 0.05);
  site.block(1.55, 2.21, 0.08, m.glass, x, 1.14, z + depth / 2 + 0.12);
  site.block(0.055, 2.19, 0.07, m.zinc, x + 0.08, 1.14, z + depth / 2 + 0.17);
}

function farm(site: Site) {
  const { m, s } = site;
  const soil = finish(0x796247, 0.96), sprout = finish(0x849956, 0.97), darkLeaf = finish(0x5e814d, 0.95);
  greenhouse(site, -4.1, -19.0); greenhouse(site, 2.5, -20.7);
  site.block(5.1, 2.56, 4.6, s.wood, -12.5, 1.28, -12.3);
  const tin = site.block(5.7, 0.16, 5.2, s.iron, -12.5, 2.68, -12.3); tin.rotation.x = -0.095;
  site.board(site.dest.name, '직거래 작업장', '#526749', 3.80, 0.90, -12.5, 2.03, -9.87);
  site.floor(7.0, 17.6, soil, 14.1, -1.2);
  const mound = new THREE.SphereGeometry(1, 12, 8);
  const leaf = new THREE.IcosahedronGeometry(1, 1), random = seeded(41);
  for (let row = 0; row < 6; row++) {
    const x = 11.55 + row * 1.02;
    const ridge = solid(site.root, mound, m.soil, x, 0.05, -1.2);
    ridge.scale.set(0.39, 0.22, 8.53);
    for (let n = 0; n < 20; n++) {
      const z = -9.00 + n * 0.81;
      for (const side of [-1, 1]) {
        const head = solid(site.root, leaf, (row + n) % 3 ? darkLeaf : sprout, x + side * 0.10, 0.27 + random() * 0.09, z);
        head.scale.set(0.18, 0.24, 0.26); head.rotation.z = side * 0.58; head.rotation.y = random();
      }
    }
  }
  for (const x of [-14.6, -13.8, -13.0]) {
    site.cylinder(0.36, 0.31, 0.77, m.slate, x, 0.39, -7.75);
    site.cylinder(0.37, 0.37, 0.055, m.zinc, x, 0.78, -7.75);
  }
  site.floor(3.1, 12.1, soil, -11.45, 0);
}

function millCafe(site: Site) {
  const { m, s } = site, oxblood = finish(0x83584d, 0.82);
  const z = -18.7, x = -1.3, w = 14.2, d = 8.3, eave = 4.15, rise = 2.42;
  site.block(w, eave, d, m.brick, x, eave / 2, z);
  const end = new THREE.Shape();
  end.moveTo(-d / 2, 0); end.lineTo(d / 2, 0); end.lineTo(0, rise); end.closePath();
  const gable = new THREE.ExtrudeGeometry(end, { depth: w, bevelEnabled: false });
  gable.rotateY(halfTurn / 2);
  solid(site.root, gable, m.brick, x - w / 2, eave, z);
  const slope = Math.atan2(rise, d / 2);
  for (const side of [-1, 1]) {
    const roof = site.block(w + 0.85, 0.19, Math.hypot(d / 2, rise) + 0.48, s.iron, x, eave + rise / 2, z + side * d / 4);
    roof.rotation.x = side * slope;
  }
  site.block(w + 0.94, 0.20, 0.28, oxblood, x, eave + rise + 0.085, z);
  site.block(1.25, 8.55, 1.32, m.brick, 4.42, 4.275, -20.28);
  site.block(1.49, 0.24, 1.55, oxblood, 4.42, 8.55, -20.28);
  for (const u of [-5.32, -2.20, 0.92, 4.04]) site.window(x + u, 1.89, z + d / 2 + 0.03, 2.27, 1.90);
  site.board(site.dest.name, '커피 · 곡물 빵', '#694f43', 5.10, 1.02, x, 3.58, z + d / 2 + 0.09);
  site.block(13.3, 0.32, 3.45, s.wood, x, 0.16, -12.50);
  for (const u of [-5.3, 2.55]) {
    site.cylinder(0.69, 0.69, 0.085, m.timber, u, 1.05, -12.60);
    site.cylinder(0.077, 0.15, 0.70, m.frame, u, 0.68, -12.60);
    for (const side of [-1, 1]) {
      site.cylinder(0.32, 0.27, 0.10, m.timber, u + side * 0.94, 0.75, -12.60);
      site.cylinder(0.087, 0.17, 0.41, m.frame, u + side * 0.94, 0.52, -12.60);
    }
  }
  const wheel = new THREE.Group();
  wheel.position.set(-10.53, 2.12, -12.38); wheel.rotation.y = -0.39; site.root.add(wheel);
  for (const face of [-0.36, 0.36]) {
    solid(wheel, new THREE.TorusGeometry(1.91, 0.089, 8, 48), m.timber, 0, 0, face);
    for (let i = 0; i < 6; i++) box(wheel, 3.80, 0.13, 0.12, m.timber, 0, 0, face).rotation.z = i * halfTurn / 6;
  }
  for (let i = 0; i < 18; i++) {
    const a = i * tau / 18;
    box(wheel, 0.35, 0.084, 0.87, m.timber, 1.85 * Math.cos(a), 1.85 * Math.sin(a), 0).rotation.z = a;
  }
  site.block(0.47, 2.19, 1.05, m.brick, -10.53, 1.095, -13.06);
}

function terrace(site: Site) {
  const { m, s } = site, sandstone = masonryMaterial(0xc0ad92, 0xb7aa93, 0.62, 0.32);
  const bronze = finish(0x796854, 0.46, 0.50), random = seeded(254);
  function crescent(inner: number, outer: number, top: number, start: number, sweep: number, material: THREE.Material) {
    const profile = new THREE.Shape();
    profile.absarc(0, 0, outer, start, start + sweep, false);
    profile.absarc(0, 0, inner, start + sweep, start, true); profile.closePath();
    const geo = new THREE.ExtrudeGeometry(profile, { depth: top, bevelEnabled: false, curveSegments: 42 });
    geo.rotateX(-halfTurn / 2); solid(site.root, geo, material);
  }
  crescent(9.53, 14.05, 0.14, -0.35, halfTurn + 0.70, sandstone);
  crescent(11.23, 14.05, 0.29, -0.23, halfTurn + 0.46, sandstone);
  crescent(12.85, 14.05, 0.47, 0.04, halfTurn - 0.08, m.clay);
  for (let i = 0; i <= 22; i++) {
    const a = -0.21 + i * (halfTurn + 0.42) / 22, r = 13.86;
    const x = r * Math.cos(a), z = -r * Math.sin(a);
    site.cylinder(0.048, 0.057, 1.29, bronze, x, 0.94, z, 12);
    if (i === 22) continue;
    const b = a + (halfTurn + 0.42) / 22;
    for (const y of [0.85, 1.53]) strut(site.root, vec(x, y, z), vec(r * Math.cos(b), y, -r * Math.sin(b)), y > 1 ? 0.061 : 0.025, bronze);
  }
  // The pergola slats and their shadow make a legible arc of outdoor seating
  // in the steep drop camera, even after the destination sprite fades.
  site.block(13.8, 0.41, 4.9, s.wood, 0, 0.205, -17.1);
  for (const u of [-6.12, 0, 6.12]) for (const v of [-18.94, -15.26]) site.block(0.17, 3.20, 0.17, bronze, u, 1.99, v);
  for (const v of [-18.94, -15.26]) site.block(13.17, 0.25, 0.16, m.timber, 0, 3.58, v);
  for (let u = -6.57; u <= 6.61; u += 0.48) site.block(0.13, 0.24, 5.1, m.timber, u, 3.77, -17.1);
  for (const u of [-4.2, 0, 4.2]) {
    site.block(2.6, 0.11, 0.65, m.timber, u, 0.93, -17.9);
    for (const dx of [-0.99, 0.99]) site.block(0.15, 0.51, 0.47, bronze, u + dx, 0.65, -17.9);
  }
  site.board(site.dest.name, '전망 정원', '#746255', 3.78, 0.85, 0, 2.98, -15.23);
  site.planter(-11.85, -9.6, 4.1, 1.24, random); site.planter(11.85, -9.6, 4.1, 1.24, random);
  site.planter(-12.11, 2.1, 4.27, 1.49, random); site.planter(12.11, 2.1, 4.27, 1.49, random);
  for (const side of [-1, 1]) {
    const a = side * 0.95, r = 10.41;
    site.bench(Math.sin(a) * r, -Math.cos(a) * r, -a);
  }
}

function school(site: Site) {
  const { m, s } = site, ochre = finish(0xd7ad77, 0.75), teal = finish(0x75918c, 0.70);
  site.block(24.0, 8.94, 6.5, m.clay, -1.20, 4.47, -19.55);
  site.flatRoof(-1.2, 8.94, -19.55, 24.0, 6.5);
  const front = -16.26;
  for (let storey = 0; storey < 3; storey++) {
    const y = storey * 2.91 + 1.77;
    for (let bay = 0; bay < 8; bay++) {
      const x = -11.69 + bay * 2.98;
      if (storey === 0 && bay > 2 && bay < 5) continue;
      site.window(x, y, front, 2.42, 1.73, (bay + storey) % 5 === 0);
      site.block(2.55, 0.12, 0.42, ochre, x, y + 1.0, front + 0.1);
    }
  }
  site.floor(18.6, 5.1, s.floor, -0.35, -13.24);
  site.window(-0.64, 1.30, front, 3.55, 2.39);
  site.block(9.83, 0.23, 2.42, teal, -1.40, 3.13, -15.29);
  for (const x of [-5.95, 3.15]) site.cylinder(0.11, 0.13, 3.01, m.chalk, x, 1.505, -14.16);
  site.board(site.dest.name, '배움이 자라는 곳', '#486c68', 6.4, 0.98, -1.40, 3.64, -15.90);
  const court = canvasTex(512, 768, g => {
    g.fillStyle = '#79968a'; g.fillRect(0, 0, 512, 768);
    g.fillStyle = '#b4856f'; g.fillRect(32, 28, 448, 710);
    g.fillStyle = '#76918b'; g.fillRect(177, 28, 158, 190); g.fillRect(177, 548, 158, 190);
    g.strokeStyle = '#ece9ce'; g.lineWidth = 4; g.strokeRect(32, 28, 448, 710);
    g.strokeRect(177, 28, 158, 190); g.strokeRect(177, 548, 158, 190);
    g.beginPath(); g.moveTo(32, 383); g.lineTo(480, 383); g.stroke();
    for (const [y, r] of [[218, 78], [383, 61], [548, 78]]) {
      g.beginPath(); g.arc(256, y, r, 0, tau); g.stroke();
    }
  });
  const surface = new THREE.MeshStandardMaterial({ map: court, roughness: 0.95 });
  const play = solid(site.root, new THREE.PlaneGeometry(11.45, 17.2), surface, -15.75, 0.044, -0.54);
  play.rotation.x = -halfTurn / 2;
  for (const side of [-1, 1]) {
    const x = -15.75, z = -0.54 + side * 8.76;
    site.cylinder(0.079, 0.094, 3.26, m.zinc, x, 1.63, z);
    site.block(0.085, 0.091, 1.11, m.frame, x, 3.22, z - side * 0.50);
    site.block(1.64, 0.95, 0.075, m.chalk, x, 3.22, z - side * 1.03);
    const hoop = solid(site.root, new THREE.TorusGeometry(0.238, 0.026, 8, 24), ochre, x, 3.00, z - side * 1.31);
    hoop.rotation.x = halfTurn / 2;
  }
  for (const x of [11.6, 13.2, 14.8]) {
    const z = -5.20;
    site.block(0.10, 1.57, 0.10, teal, x, 0.785, z - 0.68);
    site.block(0.10, 1.57, 0.10, teal, x, 0.785, z + 0.68);
    site.block(0.085, 0.085, 1.46, ochre, x, 1.56, z);
  }
  site.bench(-10.9, -10.55); site.bench(8.9, -10.55);
}

// Keep the original dimensions, display-space colours, and depth behavior of the
// landing target, beacon and floating label. The scenic facade signs use PBR.
function deliveryMark(scene: THREE.Scene, marks: THREE.Scene, s: Surfaces, d: Destination, zinc: THREE.Material) {
  const slab = new THREE.CircleGeometry(9.12, 96);
  const uv = slab.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 18.24, uv.getY(i) * 18.24);
  solid(scene, slab, s.floor, d.x, 0.048, d.z).rotation.x = -halfTurn / 2;
  for (const [r0, r1, color, opacity] of [[7.6, 9, 0xffffff, 0.55], [3.8, 5, d.color, 0.9], [0, 2, 0xffffff, 0.45]]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 96), ink({ color, transparent: true, opacity, depthWrite: false }));
    ring.rotation.x = -halfTurn / 2; ring.position.set(d.x, 0.06, d.z); marks.add(ring);
  }
  box(scene, 0.3, 14, 0.3, zinc, d.x + 10.5, 7, d.z);
  solid(scene, new THREE.SphereGeometry(0.7, 24, 16), lamp(d.color, 2), d.x + 10.5, 14.5, d.z);
  const map = canvasTex(512, 160, g => {
    g.fillStyle = '#172328'; g.fillRect(0, 0, 512, 160);
    g.strokeStyle = '#788482'; g.lineWidth = 3; g.strokeRect(3, 3, 506, 154);
    g.fillStyle = new THREE.Color(d.color).getStyle(); g.fillRect(8, 8, 13, 144);
    g.fillStyle = '#fff'; g.font = 'bold 64px ' + KO_FONT; g.fillText(d.id, 42, 77, 450);
    g.fillStyle = '#d0dedf'; g.font = '40px ' + KO_FONT; g.fillText(d.name, 42, 133, 450);
  });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map, depthTest: false, depthWrite: false, fog: false, toneMapped: false, sizeAttenuation: false,
  }));
  sprite.scale.set(0.16, 0.05, 1); sprite.position.set(d.x, 22, d.z); sprite.renderOrder = 5;
  marks.add(sprite);
  return sprite;
}

const sites: Record<string, (site: Site) => void> = { A1: clinic, B2: harbour, C3: farm, D4: millCafe, E5: terrace, F6: school };

export function buildDestinations(scene: THREE.Scene, marks: THREE.Scene, s: Surfaces) {
  const materials = siteMaterials();
  return DESTINATIONS.map(d => {
    const site = new Site(s, materials, d);
    sites[d.id]?.(site);
    site.addTo(scene);
    return deliveryMark(scene, marks, s, d, materials.zinc);
  });
}
