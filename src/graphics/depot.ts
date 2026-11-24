import * as THREE from 'three';
import { hangarCladding } from './cladding';
import { BASE, DESTINATIONS } from '../config';
import { batteryPack } from './drone';
import { batchRigidParts } from './drone/parts';
import {
  DRONE_COLORS, KO_FONT, box, brushedAluminium, canvasTex, cardboard, emissiveLedPanel, glossPlastic,
  groundPlane, ink, mattePlastic, mergeCompatible, paintedSteel, rubber, seeded, solid, tintedWindowGlass, type Surfaces,
} from './materials';

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
      g.fillText(dest.id + '  ' + dest.name, 352, 98 + Math.min(31, 200 / DESTINATIONS.length) * i, 152);
    });
  });
  return new THREE.MeshStandardMaterial({ map, color: 0x52656b, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 1.55, roughness: 0.28 });
}

type XYZ = [number, number, number];
type Random = () => number;
const tau = Math.PI * 2;

// Physical decals use normalized UVs. Textures on structural sections use metre-scale UVs.
function plate(parent: THREE.Object3D, w: number, h: number, material: THREE.Material, x: number, y: number, z: number, yaw = 0) {
  const mesh = solid(parent, new THREE.PlaneGeometry(w, h), material, x, y, z);
  mesh.rotation.y = yaw;
  mesh.castShadow = false;
  return mesh;
}

function rail(parent: THREE.Object3D, a: XYZ, b: XYZ, w: number, d: number, material: THREE.Material) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const axis = end.clone().sub(start);
  const mesh = box(parent, w, axis.length(), d, material, 0, 0, 0);
  mesh.position.copy(start).lerp(end, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
  return mesh;
}

function hose(parent: THREE.Object3D, points: XYZ[], radius: number, material: THREE.Material) {
  const path = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
  return solid(parent, new THREE.TubeGeometry(path, points.length * 5, radius, 8, false), material);
}

// Chips reveal the surface under the ink, with more wear where a wheel or boot has passed.
let wearTile: HTMLCanvasElement | undefined;
function chipInk(g: CanvasRenderingContext2D, rnd: Random, w: number, h: number) {
  // The apron and pad stencils have the same texel density of missing ink.
  // Rasterize one repeatable stamp instead of erasing individual chips on every slab.
  if (!wearTile) {
    wearTile = document.createElement('canvas');
    wearTile.width = wearTile.height = 512;
    const stamp = wearTile.getContext('2d')!, noise = seeded(2471);
    for (let i = 0; i < 1200; i++) {
      const x = noise() * 512, y = noise() * 512;
      stamp.globalAlpha = 0.18 + noise() * 0.74;
      for (let chip = 0; chip < 4; chip++) {
        stamp.fillRect(x + noise() * 5, y + noise() * 4, 0.7 + noise() * noise() * 5, 1 + noise() * 2);
      }
    }
  }
  g.save();
  g.globalCompositeOperation = 'destination-out';
  const x = Math.floor(rnd() * 512), y = Math.floor(rnd() * 512);
  g.translate(-x, -y);
  g.fillStyle = g.createPattern(wearTile, 'repeat')!;
  g.fillRect(x, y, w, h);
  g.restore();
}

function depotFinishes() {
  return {
    steel: paintedSteel(0x475b5b), orange: paintedSteel(0xdc6d26),
    blue: paintedSteel(0x225479), ivory: paintedSteel(0xd1d2c6),
    zinc: brushedAluminium(0xaeb6b5), dark: mattePlastic(0x30393c),
    cone: mattePlastic(0xe3732d), reflector: glossPlastic(0xede9d9),
    rubber: rubber(0x2f302e), red: paintedSteel(0xb23b2f),
    greenLed: emissiveLedPanel(0x8deac3, 1.8), lens: emissiveLedPanel(0xfff4de, 3.2),
  };
}
type Finishes = ReturnType<typeof depotFinishes>;

// Combine the fixed steelwork within each station. Keep signs and lights in their own scenes.
function installSection(scene: THREE.Scene, section: THREE.Group) {
  section.updateMatrixWorld(true);
  const batches = new Map<THREE.Material, Map<boolean, THREE.BufferGeometry[]>>();
  section.traverse(obj => {
    if (!(obj instanceof THREE.Mesh)) return;
    const material: THREE.Material = obj.material;
    let byShadow = batches.get(material);
    if (!byShadow) batches.set(material, byShadow = new Map());
    const geo = new THREE.BufferGeometry().copy(obj.geometry).applyMatrix4(obj.matrixWorld);
    geo.computeBoundingSphere();
    const casts = obj.castShadow && geo.boundingSphere!.radius >= 0.24;
    let parts = byShadow.get(casts);
    if (!parts) byShadow.set(casts, parts = []);
    parts.push(geo);
  });
  const result = new THREE.Group(); result.name = section.name;
  for (const [material, byShadow] of batches) for (const [casts, parts] of byShadow) {
    const mesh = solid(result, mergeCompatible(parts), material);
    mesh.castShadow = casts;
    for (const part of parts) part.dispose();
  }
  scene.add(result);
}

function apron(section: THREE.Group, s: Surfaces) {
  groundPlane(section, 40, 32, s.floor, 0, 0.01, 6.5);
  groundPlane(section, 24, 16, s.floor, 0, 0.02, -1);
  const map = canvasTex(2560, 2048, g => {
    const rnd = seeded(62981);
    // 64 texels per metre, with the hangar at the northern edge of the apron.
    g.save(); g.scale(64, 64); g.translate(20, 9.5);
    g.fillStyle = 'rgba(52,48,40,.62)';
    for (let x = -15; x < 20; x += 5) g.fillRect(x, -9.5, 0.025, 32);
    for (let z = -5; z < 22.5; z += 5) g.fillRect(-20, z, 40, 0.029);
    g.fillStyle = 'rgba(224,179,74,.88)';
    for (const x of [-9.85, 9.85]) g.fillRect(x, -7.65, 0.088, 12.7);
    g.fillRect(-6.29, 6.57, 12.58, 0.125);
    for (const x of [-4.45, 4.45]) g.fillRect(x, 6.6, 0.083, 4.65);
    for (let i = 0; i < 8; i++) {
      g.save(); g.translate(9.88 + 0.84, -2.2 + i * 0.34);
      g.rotate(-0.67); g.fillRect(-0.6, -0.032, 1.2, 0.064); g.restore();
    }
    g.restore();
    chipInk(g, rnd, 2560, 2048);
    g.scale(64, 64); g.translate(20, 9.5);
    for (let i = 0; i < 95; i++) {
      const x = (rnd() - 0.5) * 27, z = -7.8 + rnd() * 27;
      g.save(); g.translate(x, z); g.rotate((rnd() - 0.5) * 1.6);
      g.strokeStyle = 'rgba(44,41,37,' + (0.045 + rnd() * 0.09) + ')';
      g.lineWidth = 0.026 + rnd() * 0.05; g.beginPath();
      g.moveTo(0, 0); g.quadraticCurveTo(0.02, 0.38, rnd() * 0.17, 0.5 + rnd()); g.stroke(); g.restore();
    }
    for (const [x, z, scale] of [[-10.2, -3.8, 0.65], [10.3, -1.4, 0.8], [-5.5, 13.3, 0.63], [6.5, 14.5, 0.5], [1.8, -8, 0.4]]) {
      for (let j = 0; j < 15; j++) {
        const cx = x + (rnd() - 0.5) * scale, cz = z + (rnd() - 0.5) * scale;
        const r = (rnd() * 0.65 + 0.10) * scale;
        const fade = g.createRadialGradient(cx, cz, 0, cx, cz, r);
        fade.addColorStop(0, 'rgba(57,45,31,.17)'); fade.addColorStop(0.77, 'rgba(63,51,32,.11)');
        fade.addColorStop(1, 'rgba(63,51,32,0)'); g.fillStyle = fade;
        g.fillRect(cx - r, cz - r, r * 2, r * 2);
      }
    }
  });
  const paint = new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, roughness: 0.9 });
  plate(section, 40, 32, paint, 0, 0.025, 6.5).rotation.x = -Math.PI / 2;
}

function hangar(group: THREE.Group, scene: THREE.Scene, marks: THREE.Scene, s: Surfaces, m: Finishes) {
  const h = BASE.hangar, H = 5.5, depth = h.maxZ - h.minZ, midZ = (h.minZ + h.maxZ) / 2;
  const block = (w: number, ht: number, d: number, mat: THREE.Material, x: number, y: number, z: number) =>
    box(group, w, ht, d, mat, x, y, z);
  function wall(w: number, ht: number, d: number, x: number, y: number, z: number, outerFace: number) {
    const backing = block(w, ht, d, s.iron, x, y, z).geometry;
    const index = backing.index!;
    const faces = Array.from(index.array).filter((_, i) => Math.floor(i / 6) !== outerFace);
    backing.clearGroups();
    backing.setIndex(faces);
  }
  const glass = tintedWindowGlass(0x556a70, 0);
  const daylight = tintedWindowGlass(0xdce3dd, 0);
  daylight.emissive.setHex(0xafc7d1);
  daylight.emissiveIntensity = 0.28;
  daylight.roughness = 0.34;
  daylight.transparent = true;
  daylight.opacity = 0.57;
  daylight.depthWrite = false;
  daylight.side = THREE.DoubleSide;
  const hazard = new THREE.MeshStandardMaterial({ roughness: 0.72, map: canvasTex(128, 512, g => {
    g.fillStyle = '#cfaf52'; g.fillRect(0, 0, 128, 512);
    g.strokeStyle = '#383c3a'; g.lineWidth = 40;
    for (let y = -128; y < 640; y += 103) {
      g.beginPath(); g.moveTo(-4, y); g.lineTo(132, y + 84); g.stroke();
    }
    const rnd = seeded(81);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = i % 2 ? '#9c967e' : '#706e62'; g.fillRect(rnd() * 128, rnd() * 512, rnd() * 4, 0.8);
    }
  }) });
  hangarCladding(group, s.iron, h.maxZ, h.minZ, H);
  wall(24, H, 0.4, 0, H / 2, h.minZ, 5);
  for (const side of [-1, 1]) {
    wall(0.4, H, depth, side * 12, H / 2, midZ, side > 0 ? 0 : 1);
    for (let j = 0; j < 10; j++) {
      const z = h.minZ + 0.8 + j * 1.6;
      block(0.048, 2.44, 1.58, m.ivory, side * 11.779, 1.50, z);
    }
    block(0.11, 0.35, depth, m.steel, side * 11.75, 0.175, midZ);
    block(0.065, 0.045, depth, m.zinc, side * 11.74, 2.725, midZ);
    // A band of actual windows in the steel-clad front wall.
    const wx = side * 9.25;
    wall(5.5, 2.42, 0.4, wx, 1.21, h.maxZ, 4);
    wall(5.5, H - 3.54, 0.4, wx, (H + 3.54) / 2, h.maxZ, 4);
    block(5.5, 0.16, 0.10, m.steel, wx, 0.10, h.maxZ + 0.215);
    block(5.38, 1.12, 0.065, glass, wx, 2.98, h.maxZ);
    for (let j = 0; j <= 4; j++) block(0.072, 1.16, 0.14, m.zinc, wx - 2.72 + j * 1.36, 2.98, h.maxZ);
    for (const y of [2.43, 3.54]) block(5.55, 0.075, 0.47, m.steel, wx, y, h.maxZ);
    block(0.5, H, 0.6, m.steel, side * 6.5, H / 2, h.maxZ);
    for (const face of [-1, 1]) plate(group, 0.44, 1.32, hazard, side * 6.5, 0.78, h.maxZ + face * 0.302, face < 0 ? Math.PI : 0);
    // Eave trough with a folded outer lip, hopper and a collared rainwater leader.
    const gx = side * 12.46, outlet = side * 11.85, face = h.maxZ + 0.36;
    block(0.32, 0.045, depth + 1.08, m.zinc, gx, H + 0.015, midZ);
    for (const lip of [-1, 1]) block(0.035, 0.16, depth + 1.08, m.zinc, gx + lip * 0.15, H + 0.09, midZ);
    block(0.28, 0.23, 0.29, m.zinc, gx, H - 0.09, face);
    hose(group, [[gx, H - 0.15, face], [gx, H - 0.31, face], [outlet, H - 0.63, face],
      [outlet, H - 0.84, face], [outlet, 0.64, face], [outlet, 0.32, face], [outlet, 0.18, face + 0.19]], 0.088, m.zinc);
    for (const y of [0.86, 2.65, 4.32]) {
      block(0.24, 0.050, 0.21, m.steel, outlet, y, face - 0.06);
      solid(group, new THREE.CylinderGeometry(0.098, 0.098, 0.060, 16), m.zinc, outlet, y, face);
    }
    const lx = side * 4.42;
    block(0.16, 0.25, 0.36, m.steel, lx, 4.92, h.maxZ + 0.38);
    const light = block(0.79, 0.16, 0.43, m.dark, lx, 4.90, h.maxZ + 0.57);
    light.rotation.x = -0.33;
    block(0.67, 0.055, 0.34, m.lens, lx, 4.82, h.maxZ + 0.61).rotation.x = -0.33;
  }
  wall(13, 1.5, 0.4, 0, H - 0.75, h.maxZ, 4);
  block(12.52, 0.21, 0.55, m.steel, 0, H - 1.34, h.maxZ - 0.06);
  block(6.05, 1.24, 0.12, m.dark, 0, H - 0.75, h.maxZ + 0.25);
  sign(marks, 6, 1.2, '하늘길 택배', '드론 배송 · 1번 기지', 0xffd23f, 0, H - 0.75, h.maxZ + 0.32);

  const rise = 0.09, eave = H + 0.13;
  const roofY = (x: number) => eave + (12.5 - Math.abs(x)) * rise;
  for (const z of [h.minZ, h.maxZ]) {
    const triangle = new THREE.Shape();
    triangle.moveTo(-12, 0); triangle.lineTo(12, 0); triangle.lineTo(0, roofY(0) - H); triangle.closePath();
    solid(group, new THREE.ExtrudeGeometry(triangle, { depth: 0.19, bevelEnabled: false }), s.iron, 0, H, z - 0.09);
  }
  for (const side of [-1, 1]) {
    const sheet = (x0: number, x1: number, z0: number, z1: number, material: THREE.Material) => {
      const x = side * (x0 + x1) / 2, clear = material === daylight;
      const mesh = block(Math.hypot(x1 - x0, (x1 - x0) * rise), clear ? 0.033 : 0.15, z1 - z0,
        material, x, roofY(x), (z0 + z1) / 2);
      mesh.rotation.z = -side * Math.atan(rise);
      if (clear) mesh.castShadow = false;
    };
    sheet(0, 3.7, -9.5, 7.5, s.iron); sheet(5.45, 12.5, -9.5, 7.5, s.iron);
    for (const [z0, z1, clear] of [[-9.5, -7.8, 0], [-7.8, -4.9, 1], [-4.9, -2.2, 0], [-2.2, 0.9, 1],
      [0.9, 2.8, 0], [2.8, 6.1, 1], [6.1, 7.5, 0]]) {
      sheet(3.7, 5.45, z0, z1, clear ? daylight : s.iron);
      if (clear) {
        for (const x of [3.7, 5.45]) block(0.056, 0.17, z1 - z0, m.zinc, side * x, roofY(x), (z1 + z0) / 2);
        for (const z of [z0, (z0 + z1) / 2, z1]) sheet(3.7, 5.45, z - 0.027, z + 0.027, m.zinc);
      }
    }
    for (const x of [2, 7.1, 10.2]) block(0.068, 0.13, depth + 0.12, m.steel, side * x, roofY(x) - 0.12, midZ);
  }
  block(0.25, 0.085, depth + 1.05, m.zinc, 0, roofY(0) + 0.08, midZ);

  for (const z of [-8.52, -4.75, 1.45, 6.65]) {
    block(23.46, 0.105, 0.13, m.steel, 0, 4.91, z);
    for (const side of [-1, 1]) {
      const x = side * 11.65;
      block(0.22, 5.51, 0.073, m.steel, x, 2.755, z);
      for (const offset of [-0.105, 0.105]) block(0.037, 5.51, 0.27, m.steel, x + offset, 2.755, z);
      block(0.37, 0.06, 0.46, m.zinc, x, 0.07, z);
      rail(group, [x, 5.44, z], [0, roofY(0) - 0.17, z], 0.14, 0.16, m.steel);
      for (let j = 0; j < 5; j++) {
        const a = side * j * 2.33, b = a + side * 2.33;
        rail(group, [a, 4.94, z], [b, roofY(b) - 0.17, z], 0.067, 0.073, m.steel);
        rail(group, [b, 4.94, z], [b, roofY(b) - 0.17, z], 0.046, 0.06, m.zinc);
      }
    }
  }
  for (const x of [8.3, 8.7]) block(0.046, 0.125, 15.2, m.zinc, x, 4.55, -1);
  for (let z = -8.5; z < 6.6; z += 0.45) block(0.43, 0.032, 0.048, m.zinc, 8.5, 4.51, z);
  for (const x of [8.37, 8.47, 8.57]) block(0.045, 0.05, 15.2, m.dark, x, 4.56, -1);
  for (const z of [-8.52, -4.75, 1.45, 6.55]) block(0.03, 0.41, 0.04, m.zinc, 8.5, 4.73, z);
  for (const x of [-7.45, 6.8]) for (const z of [-5.8, -0.6, 4.7]) {
    const mountY = roofY(x) - 0.08;
    block(0.023, mountY - 4.75, 0.023, m.dark, x, (mountY + 4.75) / 2, z);
    solid(group, new THREE.CylinderGeometry(0.155, 0.16, 0.13, 32), m.dark, x, 4.76, z);
    for (const y of [4.72, 4.76, 4.8]) solid(group, new THREE.CylinderGeometry(0.205, 0.205, 0.014, 32), m.zinc, x, y, z);
    solid(group, new THREE.CylinderGeometry(0.18, 0.36, 0.12, 48), m.dark, x, 4.635, z);
    solid(group, new THREE.CylinderGeometry(0.323, 0.305, 0.029, 48), m.lens, x, 4.564, z);
    if ((x < 0 && z < 1) || (x > 0 && z === -0.6)) {
      const light = new THREE.SpotLight(0xfff0dc, 105, 17, 1.09, 0.63, 2);
      light.position.set(x, 4.52, z); light.target.position.set(x < 0 ? -9.7 : 9.1, 0, z);
      light.castShadow = true; light.shadow.mapSize.setScalar(512); light.shadow.bias = -0.0005;
      scene.add(light, light.target);
    }
  }
  safetyEquipment(group, m);
}

function printed(map: THREE.Texture) {
  return new THREE.MeshStandardMaterial({ map, roughness: 0.78 });
}

function safetyEquipment(group: THREE.Group, m: Finishes) {
  // Equipment mounts to the inside of the front wall, clear of the doorway.
  const mount = new THREE.Group(); mount.position.set(8.35, 0, 6.79); mount.rotation.y = Math.PI;
  group.add(mount);
  const signboard = printed(canvasTex(640, 272, g => {
    g.fillStyle = '#efeee0'; g.fillRect(0, 0, 640, 272);
    g.fillStyle = '#aa372e'; g.fillRect(0, 0, 640, 86);
    g.fillStyle = '#fff'; g.font = `bold 54px ${KO_FONT}`; g.fillText('이착륙장 안전수칙', 24, 63);
    g.fillStyle = '#273535'; g.font = `bold 35px ${KO_FONT}`;
    g.fillText('회전 날개 접근 금지', 25, 148); g.fillText('정비 전 전원 차단', 25, 218);
    g.strokeStyle = '#bec0b5'; g.beginPath(); g.moveTo(24, 173); g.lineTo(610, 173); g.stroke();
  }));
  plate(mount, 1.39, 0.59, signboard, 0, 1.98, 0.024);
  const extinguisherX = -0.41;
  box(mount, 0.23, 0.33, 0.12, m.dark, extinguisherX, 0.99, 0.07);
  const bottle = new THREE.LatheGeometry([[0, 0], [0.096, 0.009], [0.12, 0.05], [0.123, 0.39],
    [0.117, 0.445], [0.088, 0.49], [0.044, 0.51]].map(([x, y]) => new THREE.Vector2(x, y)), 32);
  solid(mount, bottle, m.red, extinguisherX, 0.59, 0.17);
  solid(mount, new THREE.CylinderGeometry(0.032, 0.045, 0.076, 16), m.zinc, extinguisherX, 1.137, 0.17);
  box(mount, 0.168, 0.023, 0.035, m.red, extinguisherX + 0.036, 1.19, 0.17).rotation.z = 0.13;
  hose(mount, [[-0.49, 1.14, 0.16], [-0.58, 1.17, 0.16], [-0.59, 0.99, 0.21], [-0.56, 0.76, 0.23]], 0.014, m.rubber);
  plate(mount, 0.143, 0.16, printed(canvasTex(160, 192, g => {
    g.fillStyle = '#e8e1c8'; g.fillRect(0, 0, 160, 192);
    g.fillStyle = '#393d3a'; g.font = `bold 38px ${KO_FONT}`; g.fillText('소화기', 10, 48);
    for (let i = 0; i < 7; i++) g.fillRect(13, 76 + 13 * i, i % 3 ? 130 : 86, 4);
  })), extinguisherX, 0.85, 0.295);
  box(mount, 0.47, 0.37, 0.145, m.ivory, 0.45, 1.32, 0.083);
  plate(mount, 0.43, 0.33, printed(canvasTex(256, 192, g => {
    g.fillStyle = '#e3e7dc'; g.fillRect(0, 0, 256, 192);
    g.fillStyle = '#28755c'; g.fillRect(114, 19, 28, 86); g.fillRect(85, 48, 86, 28);
    g.textAlign = 'center'; g.font = `bold 37px ${KO_FONT}`; g.fillText('구급함', 128, 157);
  })), 0.45, 1.32, 0.158);

  const clock = printed(canvasTex(256, 256, g => {
    g.fillStyle = '#eeeede'; g.fillRect(0, 0, 256, 256); g.translate(128, 128);
    for (let i = 0; i < 60; i++) {
      g.save(); g.rotate(i * tau / 60); g.fillStyle = '#354244';
      g.fillRect(-1.4, -117, i % 5 ? 2 : 5, i % 5 ? 6 : 16); g.restore();
    }
    const now = new Date();
    for (const [angle, length, width] of [[(now.getHours() + now.getMinutes() / 60) * tau / 12, 66, 9],
      [now.getMinutes() * tau / 60, 90, 5]]) {
      g.save(); g.rotate(angle); g.fillStyle = '#2a3333'; g.fillRect(-width / 2, -length, width, length + 12); g.restore();
    }
  }));
  const rim = solid(group, new THREE.CylinderGeometry(0.31, 0.31, 0.075, 48), m.zinc, 3.56, 3.12, -8.73);
  rim.rotation.x = Math.PI / 2;
  solid(group, new THREE.CircleGeometry(0.287, 48), clock, 3.56, 3.12, -8.687).castShadow = false;
}

function pallet(group: THREE.Group, x: number, y: number, z: number, wood: THREE.Material) {
  for (const side of [-0.44, 0, 0.44]) {
    box(group, 0.126, 0.026, 1.13, wood, x + side, y + 0.013, z);
    for (const end of [-0.47, 0, 0.47]) box(group, 0.12, 0.086, 0.173, wood, x + side, y + 0.069, z + end);
  }
  for (let j = 0; j < 6; j++) box(group, 1.04, 0.026, 0.14, wood, x, y + 0.125, z - 0.49 + j * 0.196);
}

function cargoShelves(group: THREE.Group, marks: THREE.Scene, s: Surfaces, m: Finishes) {
  const bays = BASE.itemBays;
  const x = bays[0].x, front = x + 0.72, rear = x - 0.65;
  const width = bays[1].z - bays[0].z;
  const length = width * bays.length;
  const mid = (bays[0].z + bays[bays.length - 1].z) / 2;
  for (let i = 0; i <= bays.length; i++) {
    const z = bays[0].z + (i - 0.5) * width;
    for (const px of [front, rear]) {
      box(group, 0.09, 2.38, 0.09, m.blue, px, 1.21, z);
      box(group, 0.17, 0.045, 0.17, m.zinc, px, 0.05, z);
    }
    rail(group, [rear, 0.18, z], [front, 1.36, z], 0.04, 0.04, m.zinc);
    box(group, 1.46, 0.07, 0.07, m.blue, x + 0.035, 2.33, z);
  }
  const liner = cardboard(0xba9869);
  for (const y of BASE.shelfLevels) {
    for (const px of [front, rear]) box(group, 0.09, 0.115, length, m.orange, px, y - 0.08, mid);
    box(group, 1.36, 0.045, length, s.wood, x, y - 0.0225, mid);
    for (const bay of bays) {
      box(group, 1.22, 0.007, width - 0.15, liner, x, y + 0.003, bay.z).castShadow = false;
    }
  }
  box(group, 0.09, 0.33, length, m.blue, front, 2.17, mid);
  const storage = new THREE.Group();
  for (const bay of [bays[1], bays[4]]) pallet(storage, x, 0.035, bay.z, s.wood);
  storage.traverse(child => { child.castShadow = false; });
  group.add(storage);
  sign(marks, 3.15, 0.76, '상품 선반', '주문 상품 낱개 출고', 0xe8ac5e, -11.75, 3.27, mid, Math.PI / 2);
}

function chargingStation(group: THREE.Group, scene: THREE.Scene, marks: THREE.Scene, s: Surfaces, m: Finishes) {
  const rack = BASE.batteryRack, x = rack.x + 0.15, front = x - 0.75;
  // Four removable cassettes dock above a powder-coated charger cabinet.
  box(group, 1.46, 1.49, 2.55, m.ivory, x, 0.83, rack.z);
  box(group, 1.38, 0.11, 2.46, m.dark, x, 0.09, rack.z);
  box(group, 1.5, 0.075, 2.6, m.steel, x, 1.5625, rack.z);
  const vent = printed(canvasTex(256, 384, g => {
    g.fillStyle = '#d2d3c9'; g.fillRect(0, 0, 256, 384);
    g.fillStyle = '#485557';
    for (let j = 0; j < 16; j++) {
      g.fillRect(24, 58 + j * 16, 208, 5); g.fillStyle = '#e2e3d7';
      g.fillRect(24, 63 + j * 16, 208, 2); g.fillStyle = '#485557';
    }
    for (const px of [12, 244]) for (const py of [15, 369]) { g.beginPath(); g.arc(px, py, 4, 0, tau); g.fill(); }
  }));
  const pack = batteryPack(s.metal);
  batchRigidParts(pack);
  const pose = new THREE.Object3D();
  pose.rotation.y = -Math.PI / 2;
  for (const part of pack.children) {
    if (!(part instanceof THREE.Mesh)) continue;
    const cassettes = new THREE.InstancedMesh(part.geometry, part.material, 4);
    for (let i = 0; i < 4; i++) {
      pose.position.set(10.45, 1.85, rack.z - 0.9 + i * 0.6);
      pose.updateMatrix();
      cassettes.setMatrixAt(i, pose.matrix);
    }
    cassettes.receiveShadow = true;
    cassettes.computeBoundingSphere();
    scene.add(cassettes);
  }
  for (let i = 0; i < 4; i++) {
    const z = rack.z - 0.9 + i * 0.6;
    box(group, 0.42, 0.058, 0.45, m.rubber, 10.54, 1.617, z);
    plate(group, 0.45, 0.67, vent, front + 0.017, 0.78, z, -Math.PI / 2);
    box(group, 0.048, 0.135, 0.43, m.dark, front + 0.015, 1.37, z);
    for (let j = 0; j < 5; j++) {
      box(group, 0.014, 0.026, 0.025, m.greenLed, front - 0.013, 1.37, z - 0.13 + 0.047 * j);
    }
    solid(group, new THREE.CylinderGeometry(0.04, 0.04, 0.075, 16), m.rubber, 11.05, 1.64, z);
    hose(group, [[11.05, 1.67, z], [11.07, 1.81, z + 0.02], [10.95, 1.87, z + 0.08],
      [10.74, 1.71, z + 0.12], [10.55, 1.7, z + 0.03]], 0.016, m.dark);
  }
  for (const side of [-1, 1]) {
    const z = rack.z + side * 1.69;
    hose(group, [[8.50, 4.57, z], [10.95, 4.57, z], [11.65, 4.48, z],
      [11.67, 3.89, z], [11.67, 2.17, z], [11.61, 1.59, rack.z + side * 1.21]], 0.031, m.zinc);
    for (const y of [2.0, 2.7, 3.85]) box(group, 0.088, 0.024, 0.12, m.steel, 11.70, y, z);
  }
  sign(marks, 3, 0.75, '충전', '충전된 배터리', 0x48ff8b, 11.75, 3.2, rack.z, -Math.PI / 2);
}

function deskScreen(telemetry: boolean) {
  const map = canvasTex(672, 408, g => {
    g.fillStyle = '#12242d'; g.fillRect(0, 0, 672, 408);
    g.fillStyle = '#29434b'; g.fillRect(0, 0, 672, 62);
    g.fillStyle = '#dbede7'; g.font = `bold 30px ${KO_FONT}`; g.fillText(telemetry ? '기체 진단' : '운송 계획', 24, 42);
    g.fillStyle = '#89c9ba'; g.font = `19px ${KO_FONT}`; g.fillText(telemetry ? '기지 점검 기록' : '배송 구역 목록', 503, 39);
    const rnd = seeded(3751);
    if (telemetry) {
      for (const [i, name] of ['전압', '전류', '온도'].entries()) {
        const y = 100 + i * 101;
        g.fillStyle = '#c3d5d5'; g.font = `24px ${KO_FONT}`; g.fillText(name, 24, y + 28);
        g.fillStyle = '#19323b'; g.fillRect(108, y - 12, 526, 63);
        g.strokeStyle = '#314a50'; g.lineWidth = 1;
        for (let x = 110; x < 630; x += 29) { g.beginPath(); g.moveTo(x, y - 12); g.lineTo(x, y + 51); g.stroke(); }
        g.beginPath(); g.strokeStyle = i === 1 ? '#d4ac6f' : '#74c9bc'; g.lineWidth = 2.5;
        for (let x = 110; x < 630; x += 4) {
          const v = y + 24 + Math.sin(x / 35 + i) * (3 + i * 2) + rnd() * 6 - Math.exp(-(((x - 239 - i * 42) / 23) ** 2)) * 18;
          if (x === 110) g.moveTo(x, v); else g.lineTo(x, v);
        }
        g.stroke();
      }
    } else {
      // Rows shrink to fit every stop above the 408 px canvas edge.
      const row = Math.min(52, 318 / DESTINATIONS.length), k = row / 52;
      for (const [i, d] of DESTINATIONS.entries()) {
        const y = 80 + i * row, base = y + 31 * k;
        g.fillStyle = i % 2 ? '#172d36' : '#203740'; g.fillRect(15, y, 642, row - 7 * k);
        g.fillStyle = new THREE.Color(d.color).getStyle(); g.fillRect(16, y, 5, row - 7 * k);
        g.fillStyle = '#d3e0dd'; g.font = `bold ${Math.round(25 * k)}px ${KO_FONT}`; g.fillText(d.id, 38, base);
        g.font = `${Math.round(23 * k)}px ${KO_FONT}`; g.fillText(d.name, 131, base);
        g.fillStyle = '#91b0b4'; g.fillText(Math.round(Math.hypot(d.x, d.z)) + ' m', 497, base);
      }
    }
  });
  return new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 1.15, roughness: 0.28 });
}

function controlRoom(group: THREE.Group, marks: THREE.Scene, m: Finishes) {
  const deskZ = BASE.console.z - 0.95;
  box(group, 5.6, 0.067, 0.9, m.ivory, 0, 0.87, deskZ);
  box(group, 5.57, 0.031, 0.906, m.dark, 0, 0.82, deskZ);
  for (const x of [-2.67, -0.81, 1.1, 2.67]) {
    box(group, 0.065, 0.76, 0.064, m.steel, x, 0.43, deskZ - 0.29);
    box(group, 0.105, 0.071, 0.76, m.steel, x, 0.082, deskZ);
  }
  box(group, 5.31, 0.24, 0.07, m.steel, 0, 0.63, deskZ - 0.34);
  const screens = [deskScreen(false), radarScreen(), deskScreen(true)];
  const keycap = mattePlastic(0x525c5d);
  for (const [i, x] of [-1.8, 0, 1.8].entries()) {
    const mount = new THREE.Group(); mount.position.set(x, 1.6, -8.75); mount.rotation.y = (1 - i) * 0.22; group.add(mount);
    box(mount, 1.7, 1.1, 0.075, m.dark, 0, 0, -0.048);
    plate(mount, 1.63, 1.008, screens[i], 0, 0.012, -0.008);
    box(mount, 0.021, 0.009, 0.007, m.greenLed, 0.75, -0.521, -0.007);
    box(group, 0.105, 0.38, 0.082, m.zinc, x, 1.09, deskZ - 0.18);
    box(group, 0.45, 0.024, 0.23, m.dark, x, 0.919, deskZ - 0.12);
    const kx = x - 0.06, kz = deskZ + 0.27;
    box(group, 0.475, 0.023, 0.147, m.dark, kx, 0.918, kz);
    for (let row = 0; row < 5; row++) for (let col = 0; col < 16; col++) {
      if (row === 4 && col > 3 && col < 10) continue;
      const space = row === 4 && col === 3;
      box(group, space ? 0.172 : 0.022, 0.009, 0.019, keycap,
        kx - 0.214 + col * 0.028 + (space ? 0.084 : 0), 0.934, kz - 0.052 + row * 0.026);
    }
    const mouse = solid(group, new THREE.SphereGeometry(1, 16, 10), m.dark, x + 0.29, 0.921, kz + 0.01);
    mouse.scale.set(0.035, 0.022, 0.059);
    hose(group, [[x + 0.30, 0.917, kz - 0.04], [x + 0.31, 0.914, deskZ], [x + 0.22, 0.914, deskZ - 0.16],
      [x + 0.12, 0.913, deskZ - 0.36]], 0.003, m.dark);
  }
  for (const x of [-1.54, 1.53]) {
    const chair = new THREE.Group(); chair.position.set(x, 0, -8.17); chair.rotation.y = x < 0 ? 0.20 : -0.27;
    group.add(chair);
    for (let i = 0; i < 5; i++) {
      const a = i * tau / 5, dx = Math.cos(a) * 0.235, dz = Math.sin(a) * 0.235;
      rail(chair, [0, 0.146, 0], [dx, 0.10, dz], 0.033, 0.034, m.dark);
      const caster = solid(chair, new THREE.CylinderGeometry(0.037, 0.037, 0.052, 12), m.rubber, dx, 0.065, dz);
      caster.rotation.z = Math.PI / 2;
    }
    solid(chair, new THREE.CylinderGeometry(0.033, 0.044, 0.31, 16), m.zinc, 0, 0.298, 0);
    const seat = solid(chair, new THREE.SphereGeometry(1, 24, 12), m.rubber, 0, 0.48, 0);
    seat.scale.set(0.23, 0.052, 0.206);
    box(chair, 0.075, 0.32, 0.035, m.zinc, 0, 0.615, 0.18).rotation.x = 0.11;
    const back = solid(chair, new THREE.SphereGeometry(1, 24, 12), m.rubber, 0, 0.75, 0.203);
    back.scale.set(0.218, 0.155, 0.036);
  }
  // A wheeled tool chest fits underneath the end of the console bench.
  for (const x of [1.98, 2.48]) for (const dz of [-0.2, 0.2]) {
    const wheel = solid(group, new THREE.CylinderGeometry(0.064, 0.064, 0.047, 16), m.rubber, x, 0.091, deskZ + dz);
    wheel.rotation.z = Math.PI / 2;
  }
  box(group, 0.68, 0.54, 0.54, m.red, 2.23, 0.41, deskZ);
  box(group, 0.70, 0.032, 0.55, m.rubber, 2.23, 0.697, deskZ);
  for (const y of [0.28, 0.425, 0.544, 0.637]) box(group, 0.53, 0.019, 0.027, m.zinc, 2.23, y, deskZ + 0.281);
  sign(marks, 3, 0.75, '관제', '출발 · 투하 · 착륙', 0xff8a3d, 0, 3.1, -8.75);
}

function trafficCone(group: THREE.Group, x: number, z: number, m: Finishes) {
  const orange = m.cone;
  box(group, 0.326, 0.037, 0.326, m.rubber, x, 0.045, z);
  solid(group, new THREE.CylinderGeometry(0.129, 0.144, 0.035, 32), orange, x, 0.079, z);
  const r = (y: number) => 0.13 - 0.102 * ((y - 0.095) / 0.422);
  for (const [start, end, white] of [[0.095, 0.251, 0], [0.251, 0.327, 1], [0.327, 0.402, 0],
    [0.402, 0.452, 1], [0.452, 0.517, 0]]) {
    solid(group, new THREE.CylinderGeometry(r(end), r(start), end - start, 32), white ? m.reflector : orange, x, (start + end) / 2, z);
  }
  solid(group, new THREE.CylinderGeometry(0.018, 0.018, 0.002, 20), m.dark, x, 0.518, z);
}

function launchPads(group: THREE.Group, marks: THREE.Scene, s: Surfaces, m: Finishes) {
  BASE.pads.forEach((p, i) => {
    const rnd = seeded(12591 + 8923 * i);
    // The rubber skirt and concrete cap meet at the same edge on the original tapered profile.
    const slab = new THREE.CylinderGeometry(2.4, 2.43, 0.03, 96);
    const uv = slab.getAttribute('uv');
    for (let j = 0; j < uv.count; j++) uv.setXY(j, uv.getX(j) * 4.8 + i * 1.93, uv.getY(j) * 4.8);
    solid(group, slab, s.floor, p.x, 0.085, p.z);
    const edge = solid(group, new THREE.CylinderGeometry(2.43, 2.5, 0.07, 96, 1, true), m.rubber, p.x, 0.035, p.z);
    edge.castShadow = false;
    const rim = solid(group, new THREE.RingGeometry(2.286, 2.4, 96), m.rubber, p.x, 0.101, p.z);
    rim.rotation.x = -Math.PI / 2; rim.castShadow = false;
    // Resurfaced concrete shows its exposed aggregate through the chipped paint.
    const patina = canvasTex(1024, 1024, g => {
      g.fillStyle = 'rgba(105,113,106,.23)'; g.fillRect(0, 0, 1024, 1024);
      for (let n = 0; n < 72; n++) {
        const x = rnd() * 1024, y = rnd() * 1024, r = 13 + rnd() * 119;
        const stain = g.createRadialGradient(x, y, 0, x, y, r);
        stain.addColorStop(0, n % 4 ? 'rgba(69,62,46,.13)' : 'rgba(226,220,201,.19)');
        stain.addColorStop(1, 'rgba(118,110,94,0)'); g.fillStyle = stain; g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      g.strokeStyle = 'rgba(67,65,55,.44)'; g.lineWidth = 1.35;
      for (let n = 0; n < 3; n++) {
        g.save(); g.translate(512, 512); g.rotate(rnd() * tau);
        let y = 18; g.beginPath(); g.moveTo(512, y);
        for (let x = 500; x > 213; x -= 12 + rnd() * 17) { y += (rnd() - 0.54) * 18; g.lineTo(x, y); }
        g.stroke(); g.restore();
      }
      g.strokeStyle = 'rgba(60,53,41,.19)';
      for (let n = 0; n < 34; n++) {
        g.lineWidth = 0.7 + rnd() * 4;
        const x = 300 + rnd() * 430, y = 240 + rnd() * 520;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + rnd() * 77, y + rnd() * 11); g.stroke();
      }
    });
    const landingArea = solid(group, new THREE.CircleGeometry(2.286, 96),
      new THREE.MeshStandardMaterial({ map: patina, transparent: true, depthWrite: false, roughness: 0.89 }), p.x, 0.101, p.z);
    landingArea.rotation.x = -Math.PI / 2; landingArea.castShadow = false;
    const map = canvasTex(1024, 1024, g => {
      g.lineWidth = 20; g.strokeStyle = '#f6c444'; g.beginPath(); g.arc(512, 512, 444, 0, tau); g.stroke();
      g.fillStyle = '#f2f0e5';
      g.fillRect(361, 302, 68, 421); g.fillRect(595, 302, 68, 421); g.fillRect(426, 476, 172, 68);
      g.clearRect(489, 474, 5, 72);
      g.save(); g.translate(512, 512);
      for (let j = 0; j < 8; j++) { g.fillRect(-3, -418, 6, 22); g.rotate(tau / 8); }
      g.restore();
      chipInk(g, rnd, 1024, 1024);
      g.globalCompositeOperation = 'destination-out';
      for (let j = 0; j < 95; j++) {
        const x = rnd() * 1024, y = rnd() * 1024;
        g.strokeStyle = 'rgba(0,0,0,' + (0.2 + rnd() * 0.45) + ')'; g.lineWidth = 0.8 + rnd() * 2.6;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + 6 + rnd() * 37, y + (rnd() - 0.5) * 16); g.stroke();
      }
    });
    const marking = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 4.8),
      ink({ map, transparent: true, opacity: 0.89, depthWrite: false }));
    marking.rotation.x = -Math.PI / 2; marking.position.set(p.x, 0.104, p.z); marks.add(marking);
    for (let j = 0; j < 16; j++) {
      const a = (j + 0.5) * tau / 16, x = p.x + Math.sin(a) * 2.345, z = p.z + Math.cos(a) * 2.345;
      const joint = box(group, 0.009, 0.004, 0.107, m.dark, x, 0.102, z);
      joint.rotation.y = a;
      if (j % 2) {
        solid(group, new THREE.CylinderGeometry(0.062, 0.066, 0.015, 24), m.zinc, x, 0.108, z);
        solid(group, new THREE.CylinderGeometry(0.041, 0.045, 0.009, 24), m.lens, x, 0.12, z);
      } else {
        solid(group, new THREE.CylinderGeometry(0.015, 0.015, 0.005, 6), m.zinc, x, 0.106, z);
      }
    }
    const postZ = p.z + 3.2;
    box(group, 2.22, 0.62, 0.055, m.steel, p.x, 1.6, postZ);
    for (const side of [-1, 1]) {
      sign(marks, 2.2, 0.6, `${i + 1}번 패드`, `${i + 1}번 드론`, DRONE_COLORS[i], p.x, 1.6, postZ + side * 0.031, side < 0 ? Math.PI : 0);
    }
    box(group, 0.1, 1.31, 0.1, m.steel, p.x, 0.66, postZ);
    box(group, 0.23, 0.036, 0.22, m.zinc, p.x, 0.042, postZ);
  });
  trafficCone(group, -7.1, 6.77, m); trafficCone(group, 7.15, 6.76, m);
}

function iceFreezer(group: THREE.Group, m: Finishes) {
  // Chest freezer for ice packs; the label and handle face the aisle (+x).
  const f = BASE.freezer, top = 0.86, face = f.x + f.w / 2;
  box(group, f.w - 0.04, 0.07, f.d - 0.04, m.dark, f.x, 0.035, f.z);
  box(group, f.w, top - 0.13, f.d, m.ivory, f.x, 0.07 + (top - 0.13) / 2, f.z);
  box(group, f.w + 0.02, 0.06, f.d + 0.02, m.blue, f.x, top - 0.03, f.z);
  box(group, 0.035, 0.035, 0.46, m.dark, face + 0.03, top - 0.09, f.z);
  for (const dz of [-0.2, 0.2]) box(group, 0.03, 0.05, 0.03, m.zinc, face + 0.012, top - 0.09, f.z + dz);
  plate(group, 0.62, 0.26, printed(canvasTex(384, 160, g => {
    g.fillStyle = '#e6f2f8'; g.fillRect(0, 0, 384, 160);
    g.fillStyle = '#1e5f9a'; g.fillRect(0, 0, 384, 42);
    g.fillStyle = '#fff'; g.font = `bold 30px ${KO_FONT}`; g.fillText('냉동고', 16, 31);
    g.fillStyle = '#1e5f9a'; g.font = `bold 48px ${KO_FONT}`; g.fillText('아이스팩', 16, 104);
    g.fillStyle = '#4a6170'; g.font = `24px ${KO_FONT}`; g.fillText('냉장 주문 상자에 1개', 16, 144);
  })), face + 0.004, 0.5, f.z, Math.PI / 2);
  box(group, 0.012, 0.07, 0.07, m.greenLed, face + 0.004, 0.24, f.z + 0.28);
}

export function buildDepot(scene: THREE.Scene, marks: THREE.Scene, s: Surfaces) {
  const m = depotFinishes();
  const structure = new THREE.Group(); structure.name = '배송 기지';
  apron(structure, s);
  hangar(structure, scene, marks, s, m);
  const B = BASE.bounds, front = BASE.hangar.maxZ;
  for (let x = B.minX; x <= B.maxX; x += 2.5) box(structure, 0.1, 1.2, 0.1, m.zinc, x, 0.6, B.maxZ + 0.5);
  for (const x of [B.minX - 0.5, B.maxX + 0.5]) {
    for (let z = front; z <= B.maxZ; z += 2.5) box(structure, 0.1, 1.2, 0.1, m.zinc, x, 0.6, z);
    for (const y of [0.54, 1.1]) box(structure, 0.06, 0.06, B.maxZ - front, m.zinc, x, y, (B.maxZ + front) / 2);
  }
  for (const y of [0.54, 1.1]) box(structure, B.maxX - B.minX + 1, 0.06, 0.06, m.zinc, 0, y, B.maxZ + 0.5);
  installSection(scene, structure);
  const shelving = new THREE.Group(); shelving.name = '출고 선반';
  cargoShelves(shelving, marks, s, m);
  installSection(scene, shelving);
  const freezer = new THREE.Group(); freezer.name = '냉동고';
  iceFreezer(freezer, m);
  installSection(scene, freezer);
  const charger = new THREE.Group(); charger.name = '충전';
  chargingStation(charger, scene, marks, s, m);
  installSection(scene, charger);
  const consoleDesk = new THREE.Group(); consoleDesk.name = '관제';
  controlRoom(consoleDesk, marks, m);
  installSection(scene, consoleDesk);
  const pads = new THREE.Group(); pads.name = '이착륙장';
  launchPads(pads, marks, s, m);
  installSection(scene, pads);
}
