import * as THREE from 'three';
import { BASE, DESTINATIONS } from '../config';
import { batteryPack } from './drone';
import { DRONE_COLORS, KO_FONT, box, canvasTex, finish, groundPlane, ink, lamp, seeded, solid, type Surfaces } from './materials';

function labelTex(text: string, sub: string, color: number) {
  return canvasTex(512, 160, g => {
    g.fillStyle = '#172328';
    g.fillRect(0, 0, 512, 160);
    g.strokeStyle = '#788482'; g.lineWidth = 3; g.strokeRect(3, 3, 506, 154);
    g.fillStyle = new THREE.Color(color).getStyle(); g.fillRect(8, 8, 13, 144);
    g.fillStyle = '#fff'; g.font = `bold 64px ${KO_FONT}`; g.fillText(text, 42, 77, 450);
    g.fillStyle = '#d0dedf'; g.font = `40px ${KO_FONT}`; g.fillText(sub, 42, 133, 450);
  });
}

function sign(scene: THREE.Scene, w: number, h: number, text: string, sub: string, color: number, x: number, y: number, z: number, yaw = 0) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), ink({ map: labelTex(text, sub, color) }));
  mesh.position.set(x, y, z);
  mesh.rotation.y = yaw;
  scene.add(mesh);
  return mesh;
}

function radarScreen() {
  const map = canvasTex(512, 320, g => {
    g.fillStyle = '#0b1e27'; g.fillRect(0, 0, 512, 320);
    g.strokeStyle = '#26434b'; g.lineWidth = 1;
    for (let i = 0; i < 512; i += 24) g.strokeRect(i, 40, 24, 257);
    for (let j = 40; j < 300; j += 24) g.strokeRect(0, j, 512, 24);
    g.fillStyle = '#89ebce'; g.font = `bold 21px ${KO_FONT}`; g.fillText('비행 관제', 16, 28);
    g.font = `16px ${KO_FONT}`; g.fillText('배송 구역', 355, 63);
    g.strokeStyle = '#3e9d90'; g.lineWidth = 2;
    for (let r = 24; r <= 122; r += 24) { g.beginPath(); g.arc(169, 169, r, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = '#f1c56d';
    DESTINATIONS.forEach((dest, i) => {
      const x = 169 + dest.x * 0.48, y = 169 + dest.z * 0.48;
      g.fillRect(x - 3, y - 3, 6, 6); g.fillText(dest.id, x + 7, y + 4);
      g.fillText(dest.id + '  ' + dest.name, 352, 98 + 31 * i);
    });
  });
  return new THREE.MeshStandardMaterial({ map, color: 0x52656b, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 1.55, roughness: 0.28 });
}

export function buildDepot(scene: THREE.Scene, marks: THREE.Scene, s: Surfaces) {
  const h = BASE.hangar, width = h.maxX - h.minX, depth = h.maxZ - h.minZ;
  const H = 5.5, midZ = (h.minZ + h.maxZ) / 2;
  const trim = finish(0x454e50, 0.42, 0.63), blue = finish(0x3c5966, 0.5, 0.48);
  const dark = finish(0x252e32, 0.66, 0.25), zinc = finish(0xa7aeac, 0.36, 0.78);
  const yellow = finish(0xc6a041, 0.8), seam = finish(0x5f6461, 0.98);
  const block = (w: number, ht: number, d: number, mat: THREE.Material, x: number, y: number, z: number) =>
    box(scene, w, ht, d, mat, x, y, z);

  groundPlane(scene, 40, 32, s.floor, 0, 0.01, 6.5);
  groundPlane(scene, width, depth, s.floor, 0, 0.02, midZ);
  for (let x = -15; x <= 15; x += 5) groundPlane(scene, 0.021, 32, seam, x, 0.024, 6.5);
  for (let z = -5; z < 23; z += 5) groundPlane(scene, 40, 0.021, seam, 0, 0.025, z);
  for (const x of [-9.8, 9.8]) groundPlane(scene, 0.085, 11.8, yellow, x, 0.029, -1.4);
  groundPlane(scene, 12.6, 0.12, yellow, 0, 0.029, h.maxZ - 0.36);
  for (const x of [-4.45, 4.45]) groundPlane(scene, 0.085, 4.7, yellow, x, 0.029, h.maxZ + 2);

  block(0.4, H, depth, s.iron, h.minX, H / 2, midZ);
  block(0.4, H, depth, s.iron, h.maxX, H / 2, midZ);
  block(width, H, 0.4, s.iron, 0, H / 2, h.minZ);
  const jambPaint = new THREE.MeshStandardMaterial({ roughness: 0.76, map: canvasTex(128, 512, g => {
    g.fillStyle = '#bca252'; g.fillRect(0, 0, 128, 512);
    g.strokeStyle = '#343936'; g.lineWidth = 37;
    for (let y = -128; y < 640; y += 106) {
      g.beginPath(); g.moveTo(-5, y); g.lineTo(133, y + 87); g.stroke();
    }
    const rnd = seeded(23);
    g.fillStyle = '#858782';
    for (let i = 0; i < 500; i++) g.fillRect(rnd() * 128, rnd() * 512, rnd() * 3, 1);
  }) });
  for (const side of [-1, 1]) {
    block(5.5, H, 0.4, s.iron, side * 9.25, H / 2, h.maxZ);
    block(0.5, H, 0.6, trim, side * 6.5, H / 2, h.maxZ);
    for (const face of [-1, 1]) {
      const strip = solid(scene, new THREE.PlaneGeometry(0.44, 1.32), jambPaint, side * 6.5, 0.78, h.maxZ + face * 0.302);
      strip.rotation.y = face < 0 ? Math.PI : 0;
      strip.castShadow = false;
    }
    block(0.13, 0.31, depth, trim, side * 11.72, 0.155, midZ);
    block(0.25, 0.23, depth + 0.6, zinc, side * 12.25, H + 0.18, midZ);
    for (const z of [-7.4, -2.6, 2.4, 6.6]) block(0.19, H, 0.22, blue, side * 11.69, H / 2, z);
  }
  block(13, 1.5, 0.4, s.iron, 0, H - 0.75, h.maxZ);
  block(width + 1, 0.3, depth + 1, s.iron, 0, H + 0.15, midZ).name = 'roof';
  block(12.5, 0.21, 0.55, trim, 0, H - 1.34, h.maxZ - 0.06);
  for (const z of [-7.4, -2.6, 2.4, 6.6]) {
    block(width - 0.45, 0.25, 0.095, blue, 0, H - 0.18, z);
    block(width - 0.45, 0.06, 0.30, trim, 0, H - 0.32, z);
  }

  // Suspended perforated cable tray, power runs and hangers along the ceiling.
  for (const x of [8.28, 8.72]) block(0.05, 0.12, 15, zinc, x, 4.56, -1);
  for (let z = -8; z < 6.5; z += 0.58) block(0.48, 0.036, 0.065, zinc, 8.5, 4.51, z);
  for (let i = 0; i < 3; i++) block(0.066, 0.07, 15, i === 2 ? yellow : dark, 8.36 + i * 0.13, 4.58, -1);
  for (const z of [-7.4, -2.6, 2.4, 6.3]) block(0.05, 0.78, 0.07, zinc, 8.5, 4.95, z);

  const diffuser = lamp(0xfff0d3, 3.8);
  for (const z of [-6, -1, 4]) {
    for (const x of [-5.6, 5.6]) {
      block(3.85, 0.14, 0.40, trim, x, 4.96, z);
      block(3.66, 0.046, 0.30, diffuser, x, 4.875, z);
      for (const dx of [-1.49, 1.49]) block(0.024, 0.46, 0.024, zinc, x + dx, 5.24, z);
    }
  }
  for (const [x, z] of [[-5.6, -6], [5.6, -1], [-5.6, 4]]) {
    const light = new THREE.SpotLight(0xffecd3, 95, 19, 1.12, 0.68, 2);
    light.position.set(x, 4.8, z);
    light.target.position.set(x, 0, z);
    light.castShadow = true;
    light.shadow.mapSize.setScalar(512);
    light.shadow.bias = -0.0006;
    scene.add(light, light.target);
  }
  sign(marks, 6, 1.2, '하늘길 택배', '드론 배송 · 1번 기지', 0xffd23f, 0, H - 0.75, h.maxZ + 0.22);

  // Retain both shelf decks, bay dividers and the rack footprint around the Sim slots.
  const shelfX = BASE.shelfSlots[0].x - 0.1, rack = BASE.batteryRack;
  for (const y of [0.62, 1.9]) {
    block(1.6, 0.08, 10, s.metal, shelfX, y, -1.2);
    block(0.065, 0.12, 10, blue, shelfX + 0.77, y - 0.04, -1.2);
  }
  for (const z of [-6.2, -3.75, -1.25, 1.25, 3.75]) {
    block(1.6, 2.6, 0.12, s.metal, shelfX, 1.3, z);
    for (const x of [shelfX - 0.75, shelfX + 0.75]) {
      block(0.10, 2.58, 0.018, blue, x, 1.29, z + 0.066);
    }
    block(1.6, 0.10, 0.018, blue, shelfX, 2.55, z - 0.066);
  }
  sign(marks, 3, 0.75, '화물', '출고 대기 주문', 0x4fc3f7, -11.75, 3.3, -1.2, Math.PI / 2);
  for (const p of BASE.shelfSlots) block(0.018, 0.12, 0.44, yellow, p.x + 0.70, 0.59, p.z);
  block(1.5, 1.6, 2.6, s.metal, rack.x + 0.15, 0.8, rack.z);
  for (let i = 0; i < 4; i++) {
    const z = rack.z - 0.9 + i * 0.6;
    block(0.42, 0.06, 0.48, dark, 10.54, 1.62, z);
    const pack = batteryPack(s.metal);
    pack.position.set(10.45, 1.85, z); pack.rotation.y = -Math.PI / 2;
    scene.add(pack);
    block(0.026, 0.74, 0.36, trim, 10.389, 1.03, z);
    for (let j = 0; j < 4; j++) block(0.030, 0.027, 0.22, dark, 10.368, 0.82 + j * 0.08, z);
  }
  sign(marks, 3, 0.75, '충전', '충전된 배터리', 0x48ff8b, 11.75, 3.2, rack.z, -Math.PI / 2);

  const deskZ = BASE.console.z - 0.95;
  block(5.6, 0.9, 0.9, s.metal, 0, 0.45, deskZ);
  block(5.6, 0.07, 0.9, trim, 0, 0.88, deskZ);
  const screen = radarScreen();
  for (const [x, yaw] of [[-1.8, 0.25], [0, 0], [1.8, -0.25]]) {
    const mount = new THREE.Group();
    mount.position.set(x, 1.6, -8.75); mount.rotation.y = yaw; scene.add(mount);
    box(mount, 1.7, 1.1, 0.075, dark, 0, 0, -0.048);
    solid(mount, new THREE.PlaneGeometry(1.6, 1), screen);
    block(0.13, 0.30, 0.12, zinc, x, 1.04, -8.7);
    block(0.47, 0.045, 0.25, trim, x, 0.94, -8.69);
    block(0.73, 0.03, 0.24, dark, x, 0.94, -8.28);
    for (let row = 0; row < 3; row++) block(0.62, 0.012, 0.028, trim, x, 0.96, -8.34 + row * 0.055);
  }
  sign(marks, 3, 0.75, '관제', '출발 · 투하 · 착륙', 0xff8a3d, 0, 3.1, -8.75);

  const padMark = ink({ transparent: true, depthWrite: false, map: canvasTex(512, 512, g => {
    g.strokeStyle = '#ffd23f'; g.lineWidth = 13;
    g.beginPath(); g.arc(256, 256, 223, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#fff'; g.font = `bold 284px ${KO_FONT}`; g.textAlign = 'center'; g.fillText('H', 256, 359);
  }) });
  BASE.pads.forEach((p, i) => {
    const geometry = new THREE.CylinderGeometry(2.4, 2.5, 0.1, 80);
    const uv = geometry.getAttribute('uv');
    for (let j = 0; j < uv.count; j++) uv.setXY(j, uv.getX(j) * 4.8, uv.getY(j) * 4.8);
    solid(scene, geometry, s.floor, p.x, 0.05, p.z);
    const marking = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 4.8), padMark);
    marking.rotation.x = -Math.PI / 2; marking.position.set(p.x, 0.104, p.z);
    marks.add(marking);
    const caption = sign(marks, 2.2, 0.6, `${i + 1}번 패드`, `${i + 1}번 드론`, DRONE_COLORS[i], p.x, 1.6, p.z + 3.2);
    const reverse = caption.clone(); reverse.rotation.y = Math.PI; marks.add(reverse);
    block(0.1, 1.3, 0.1, trim, p.x, 0.65, p.z + 3.2);
  });

  const B = BASE.bounds;
  for (let x = B.minX; x <= B.maxX; x += 2.5) block(0.1, 1.2, 0.1, zinc, x, 0.6, B.maxZ + 0.5);
  for (const x of [B.minX - 0.5, B.maxX + 0.5]) {
    for (let z = h.maxZ; z <= B.maxZ; z += 2.5) block(0.1, 1.2, 0.1, zinc, x, 0.6, z);
    for (const y of [0.54, 1.1]) block(0.06, 0.06, B.maxZ - h.maxZ, zinc, x, y, (B.maxZ + h.maxZ) / 2);
  }
  for (const y of [0.54, 1.1]) block(B.maxX - B.minX + 1, 0.06, 0.06, zinc, 0, y, B.maxZ + 0.5);
}

export function buildDestinations(scene: THREE.Scene, marks: THREE.Scene, s: Surfaces) {
  const labels: THREE.Sprite[] = [];
  const zinc = finish(0xb5b6aa, 0.4, 0.68), trim = finish(0x575f60, 0.52, 0.4);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x425963, metalness: 0.4, roughness: 0.12, clearcoat: 1 });
  for (const d of DESTINATIONS) {
    const slab = new THREE.CircleGeometry(9.12, 96);
    const uv = slab.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 18.24, uv.getY(i) * 18.24);
    solid(scene, slab, s.floor, d.x, 0.048, d.z).rotation.x = -Math.PI / 2;
    for (const [r0, r1, color, opacity] of [[7.6, 9, 0xffffff, 0.55], [3.8, 5, d.color, 0.9], [0, 2, 0xffffff, 0.45]]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 96), ink({ color, transparent: true, opacity, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(d.x, 0.06, d.z); marks.add(ring);
    }
    const ang = Math.atan2(d.z, d.x), house = new THREE.Group();
    house.position.set(d.x + Math.cos(ang) * 15, 0, d.z + Math.sin(ang) * 15);
    house.rotation.y = -ang;
    scene.add(house);
    box(house, 9, 5, 8, s.wall, 0, 2.5, 0);
    const roofGeo = new THREE.ConeGeometry(7, 3, 4);
    const roofUv = roofGeo.getAttribute('uv');
    for (let i = 0; i < roofUv.count; i++) roofUv.setXY(i, roofUv.getX(i) * 39.6, roofUv.getY(i) * 6);
    const roof = solid(house, roofGeo, s.iron, 0, 6.5, 0);
    box(house, 9.82, 0.16, 9.82, finish(d.color, 0.62, 0.22), 0, 5.02, 0);
    box(house, 0.12, 4.8, 0.12, zinc, 4.49, 2.45, 3.91);
    box(house, 0.13, 2.36, 1.21, trim, -4.49, 1.18, 0);
    box(house, 0.10, 1.32, 0.96, glass, -4.57, 1.54, 0);
    roof.rotation.y = Math.PI / 4;
    for (const side of [-1, 1]) for (const x of [-2.8, 0, 2.8]) {
      box(house, 1.82, 1.9, 0.13, trim, x, 2.65, side * 4.01);
      box(house, 1.61, 1.68, 0.08, glass, x, 2.65, side * 4.09);
      box(house, 0.058, 1.7, 0.04, zinc, x + 0.24, 2.65, side * 4.14);
    }
    box(scene, 0.3, 14, 0.3, zinc, d.x + 10.5, 7, d.z);
    solid(scene, new THREE.SphereGeometry(0.7, 24, 16), lamp(d.color, 2), d.x + 10.5, 14.5, d.z);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: labelTex(d.id, d.name, d.color), depthTest: false, depthWrite: false, fog: false, toneMapped: false, sizeAttenuation: false,
    }));
    sprite.scale.set(0.16, 0.05, 1); sprite.position.set(d.x, 22, d.z); sprite.renderOrder = 5;
    marks.add(sprite); labels.push(sprite);
  }
  return labels;
}
