import * as THREE from 'three';
import { BASE, PRODUCTS, bayLetter, productById, type ProductId } from '../config';
import { batchRigidParts } from './drone/parts';
import { KO_FONT, box, canvasTex, cardboard, finish, ink, mergeCompatible, solid, type Surfaces } from './materials';

const goods = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.54 });
const bottle = new THREE.MeshStandardMaterial({ color: 0xacdddf, transparent: true, opacity: 0.56, roughness: 0.19, depthWrite: false });
const prototypes = new Map<ProductId, THREE.Group>();
const block = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const round = (top: number, base: number, h: number) => new THREE.CylinderGeometry(top, base, h, 16);
const oval = (x: number, y: number, z: number) => new THREE.SphereGeometry(1, 12, 8).scale(x, y, z);

function productTemplate(id: ProductId) {
  const cached = prototypes.get(id);
  if (cached) return cached;
  const model = new THREE.Group();
  const parts: THREE.BufferGeometry[] = [];
  const tint = productById(id).color;
  const part = (geometry: THREE.BufferGeometry, hex: number, x: number, y: number, z: number) => {
    const color = new THREE.Color(hex);
    const count = geometry.getAttribute('position').count;
    const colors = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    for (let i = 0; i < count; i++) colors.setXYZ(i, color.r, color.g, color.b);
    geometry.setAttribute('color', colors);
    parts.push(geometry.translate(x, y, z));
  };

  switch (id) {
    case 'ramen':
      part(round(0.115, 0.082, 0.146), tint, 0, 0.073, 0);
      part(round(0.093, 0.09, 0.018), 0xf8b45b, 0, 0.042, 0);
      part(round(0.119, 0.119, 0.009), 0xffdb94, 0, 0.15, 0);
      part(round(0.105, 0.105, 0.002), 0xc7512e, 0, 0.156, 0);
      break;
    case 'water': {
      const profile = [[0, 0], [0.052, 0.006], [0.06, 0.018], [0.062, 0.08], [0.057, 0.09],
        [0.059, 0.18], [0.062, 0.19], [0.058, 0.237], [0.028, 0.27], [0.023, 0.295], [0, 0.295]];
      const shell = new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), 16);
      model.add(new THREE.Mesh(shell, bottle));
      part(round(0.06, 0.06, 0.052), tint, 0, 0.142, 0);
      part(round(0.061, 0.061, 0.009), 0xd8f2f9, 0, 0.163, 0);
      part(round(0.028, 0.028, 0.029), 0x3678ac, 0, 0.295, 0);
      break;
    }
    case 'lettuce':
      part(oval(0.101, 0.099, 0.105), 0xb7ce67, 0, 0.1, 0);
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4;
        const leaf = oval(0.072, 0.088, 0.033).rotateX(0.28 + 0.07 * (i % 3)).rotateY(a);
        part(leaf, i % 2 ? tint : 0x57924a, Math.sin(a) * 0.073, 0.091 + (i % 3) * 0.008, Math.cos(a) * 0.073);
      }
      break;
    case 'eggs':
      part(block(0.254, 0.026, 0.174), 0xa48b66, 0, 0.038, 0);
      for (const x of [-0.083, 0, 0.083]) for (const z of [-0.042, 0.042]) {
        part(round(0.044, 0.03, 0.045), 0xbca580, x, 0.024, z);
        part(oval(0.035, 0.049, 0.035), x === 0 ? 0xf1dac0 : 0xdcb78e, x, 0.065, z);
      }
      break;
    case 'milk':
      part(block(0.139, 0.211, 0.122), 0xf7f3e5, 0, 0.106, 0);
      part(block(0.098, 0.098, 0.122).rotateZ(Math.PI / 4), 0xe6e5db, 0, 0.211, 0);
      part(block(0.012, 0.023, 0.126), tint, 0, 0.281, 0);
      part(block(0.141, 0.053, 0.124), tint, 0, 0.094, 0);
      break;
    case 'apple':
      part(oval(0.095, 0.086, 0.093), tint, 0, 0.082, 0);
      part(round(0.006, 0.009, 0.055).rotateZ(-0.19), 0x765130, 0.004, 0.173, 0);
      part(oval(0.034, 0.006, 0.017).rotateZ(0.39), 0x63884b, 0.034, 0.19, 0);
      break;
  }
  const mesh = new THREE.Mesh(mergeCompatible(parts), goods);
  mesh.receiveShadow = true;
  model.add(mesh);
  prototypes.set(id, model);
  return model;
}

export const productModel = (id: ProductId) => productTemplate(id).clone();

let icePackTemplate: THREE.Group | undefined;
/** Translucent blue gel pack with a printed label, about 22 x 15 cm. */
export function icePackModel() {
  if (!icePackTemplate) {
    icePackTemplate = new THREE.Group();
    const gel = new THREE.MeshStandardMaterial({ color: 0x5fb6f0, transparent: true, opacity: 0.82, roughness: 0.22 });
    solid(icePackTemplate, new THREE.BoxGeometry(0.22, 0.035, 0.15), gel, 0, 0.0175, 0);
    const label = ink({ map: canvasTex(256, 160, g => {
      g.fillStyle = '#eaf6ff'; g.fillRect(0, 0, 256, 160);
      g.fillStyle = '#1e5f9a'; g.font = `bold 46px ${KO_FONT}`; g.textAlign = 'center'; g.fillText('아이스팩', 128, 78);
      g.font = `bold 26px ${KO_FONT}`; g.fillText('냉장 화물용', 128, 124);
    }) });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.094), label);
    face.rotation.x = -Math.PI / 2;
    face.position.y = 0.0355;
    icePackTemplate.add(face);
  }
  return icePackTemplate.clone();
}

function placard(title: string, accent: number, letter?: string) {
  return ink({ map: canvasTex(512, 128, g => {
    g.fillStyle = '#f5edd9'; g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#213638';
    if (letter) {
      g.fillRect(0, 0, 112, 128);
      g.fillStyle = '#f9f3e4'; g.font = `bold 80px ${KO_FONT}`;
      g.textAlign = 'center'; g.fillText(letter, 56, 92);
    }
    g.fillStyle = '#203133'; g.font = `bold 83px ${KO_FONT}`;
    g.textAlign = 'center'; g.fillText(title, letter ? 310 : 256, 92);
    g.fillStyle = new THREE.Color(accent).getStyle(); g.fillRect(0, 115, 512, 13);
  }) });
}

export function stockShelves(scene: THREE.Scene) {
  const pose = new THREE.Object3D();
  const signGeometry = new THREE.PlaneGeometry(1.36, 0.34);
  PRODUCTS.forEach((product, bay) => {
    const p = BASE.itemBays[bay];
    const sign = new THREE.Mesh(signGeometry, placard(product.name, product.color, bayLetter(bay)));
    sign.position.set(p.x + 0.772, 2.17, p.z);
    sign.rotation.y = Math.PI / 2;
    scene.add(sign);

    for (const part of productTemplate(product.id).children) {
      if (!(part instanceof THREE.Mesh)) continue;
      const stock = new THREE.InstancedMesh(part.geometry, part.material, BASE.shelfLevels.length * 6);
      let i = 0;
      for (const y of BASE.shelfLevels) for (const dx of [-0.21, 0.32]) for (const dz of [-0.44, 0, 0.44]) {
        pose.position.set(p.x + dx, y + 0.008, p.z + dz);
        pose.rotation.y = Math.PI / 2 + 0.085 * Math.sin(i * 5 + bay);
        pose.scale.setScalar(1.35);
        pose.updateMatrix();
        stock.setMatrixAt(i++, pose.matrix);
      }
      stock.receiveShadow = true;
      scene.add(stock);
    }
  });
}

function batchStation(group: THREE.Group) {
  batchRigidParts(group);
  for (const mesh of group.children) mesh.castShadow = false;
}

const tableHeight = 0.94;

export function packingStation(s: Surfaces) {
  const station = new THREE.Group();
  station.position.set(BASE.packTable.x, 0, BASE.packTable.z);
  const steel = finish(0x43585a, 0.55, 0.55), board = cardboard(0xbd9666);
  const bench = new THREE.Group();
  box(bench, 1.24, 0.09, 2.5, s.wood, 0, tableHeight - 0.045, 0);
  for (const x of [-0.51, 0.51]) {
    box(bench, 0.055, 0.13, 2.36, steel, x, 0.8, 0);
    box(bench, 0.045, 0.055, 2.36, steel, x, 0.23, 0);
    for (const z of [-1.13, 1.13]) box(bench, 0.068, 0.87, 0.068, steel, x, 0.44, z);
  }
  for (const z of [-1.13, 1.13]) box(bench, 1.05, 0.074, 0.06, steel, 0, 0.23, z);
  for (let i = 0; i < 5; i++) {
    box(bench, 0.95, 0.017, 0.51, board, 0, tableHeight + 0.01 + i * 0.02, -0.87).rotation.y = 0.015 * Math.sin(i * 3);
  }

  const dispenser = finish(0x365964), tape = finish(0xc79a59, 0.28);
  box(bench, 0.18, 0.052, 0.34, dispenser, 0.12, tableHeight + 0.028, 0.88);
  for (const x of [0.048, 0.192]) {
    box(bench, 0.021, 0.12, 0.15, dispenser, x, tableHeight + 0.105, 0.81);
  }
  solid(bench, new THREE.TorusGeometry(0.066, 0.029, 8, 24), tape, 0.12, tableHeight + 0.139, 0.81).rotation.y = Math.PI / 2;
  box(bench, 0.145, 0.07, 0.028, steel, 0.12, tableHeight + 0.081, 1.025);
  box(bench, 0.045, 0.004, 0.215, tape, 0.12, tableHeight + 0.164, 0.928).rotation.x = 0.43;

  const label = placard('포장대', 0xe6a547);
  for (const side of [-1, 1]) {
    const sign = solid(bench, new THREE.PlaneGeometry(0.81, 0.204), label, side * 0.623, 0.8, 0);
    sign.rotation.y = side * Math.PI / 2;
  }
  batchStation(bench);
  station.add(bench);

  const carton = new THREE.Group();
  carton.position.y = tableHeight;
  const walls = new THREE.Group();
  const w = 0.56, d = 0.8, h = 0.205, flap = 0.135, tilt = 0.25;
  box(walls, w, 0.018, d, board, 0, 0.009, 0);
  for (const side of [-1, 1]) {
    box(walls, 0.012, h, d, board, side * w / 2, h / 2, 0);
    box(walls, w, h, 0.012, board, 0, h / 2, side * d / 2);
    const rise = Math.sin(tilt) * flap / 2, reach = Math.cos(tilt) * flap / 2;
    box(walls, flap, 0.009, d - 0.014, board, side * (w / 2 + reach), h - rise, 0).rotation.z = -side * tilt;
    box(walls, w - 0.015, 0.009, flap, board, 0, h - rise, side * (d / 2 + reach)).rotation.x = side * tilt;
  }
  batchStation(walls);
  carton.add(walls);
  const contents = new THREE.Group();
  carton.add(contents);
  const icePack = icePackModel();
  icePack.position.set(0.13, 0.205 - 0.035, 0.24);
  icePack.rotation.set(0, 0.2, 0.18);
  carton.add(icePack);
  station.add(carton);
  return { station, carton, contents, icePack };
}

export function displayContents(group: THREE.Group, contents: ProductId[]) {
  group.clear();
  const rows = Math.max(3, Math.ceil(Math.sqrt(contents.length * 1.5)));
  const cols = Math.max(2, Math.ceil(contents.length / rows));
  const scale = Math.min(0.87, 0.71 / rows / 0.26, 0.51 / cols / 0.26);
  contents.forEach((id, i) => {
    const item = productModel(id);
    item.scale.setScalar(scale);
    item.rotation.y = 0.13 * Math.sin(i * 2);
    item.position.set(0.51 * ((Math.floor(i / rows) + 0.5) / cols - 0.5), 0.019, 0.71 * ((i % rows + 0.5) / rows - 0.5));
    group.add(item);
  });
}
