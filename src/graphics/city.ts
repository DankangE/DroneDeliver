import * as THREE from 'three';
import { DESTINATIONS } from '../config';
import { boxGeo, brushedAluminium, canvasTex, mergeCompatible, seeded, solid, tintedWindowGlass, weatheredPaintOverConcrete, type Surfaces } from './materials';
import { citySignAtlas, condenserFan, masonryMaterial, photovoltaicPanel, roofMembrane } from './architecture-materials';
import { cellAt, distance, Frame, Instances, pick, unit, type Lot, type Point, type Street } from './terrain-batches';

function windowGlass(lit: boolean) {
  // The jamb recess, shaded ceiling and uneven curtains sit behind the same IBL
  // highlight. At grazing angles the sky reflection travels over the fabric.
  const map = canvasTex(192, 160, g => {
    const back = g.createLinearGradient(0, 0, 0, 160);
    back.addColorStop(0, lit ? '#d2bb95' : '#607578');
    back.addColorStop(0.22, lit ? '#af9270' : '#354a50');
    back.addColorStop(1, lit ? '#79674e' : '#596469');
    g.fillStyle = back; g.fillRect(0, 0, 192, 160);
    g.fillStyle = 'rgba(22,28,29,.27)'; g.fillRect(0, 0, 192, 9); g.fillRect(0, 0, 7, 160);
    for (const x of [11, 151]) {
      const curtain = g.createLinearGradient(x, 0, x + 35, 0);
      curtain.addColorStop(0, 'rgba(172,168,150,.53)'); curtain.addColorStop(0.45, 'rgba(224,219,194,.60)');
      curtain.addColorStop(1, 'rgba(134,141,132,.32)');
      g.fillStyle = curtain; g.fillRect(x, 12, 32, 138);
      g.fillStyle = 'rgba(64,62,55,.12)';
      for (let dx = 0; dx < 32; dx += 8) g.fillRect(x + dx, 12, 2, 138);
    }
    g.fillStyle = 'rgba(213,210,187,.34)'; g.fillRect(0, 137, 192, 3);
  });
  const glass = tintedWindowGlass(0xffffff, 0);
  glass.map = map;
  glass.roughness = lit ? 0.21 : 0.08;
  if (lit) {
    glass.emissive.setHex(0xffdfb8);
    glass.emissiveIntensity = 0.32;
    glass.emissiveMap = map;
  }
  return glass;
}

const shops = [
  ['모퉁이 제과', '천연 발효빵 · 과자', '#475d54'], ['소담 분식', '김밥 · 떡볶이', '#854941'],
  ['물결 세탁소', '수선 · 세탁', '#536c79'], ['다온 철물', '공구 · 생활 자재', '#585b52'],
  ['여울 책방', '책과 문구', '#e1ce9d', '#414f55'], ['새잎 꽃집', '생화 · 화분', '#716879'],
  ['고샅 상회', '채소 · 과일', '#6d734e'], ['온기 밥집', '오늘 지은 집밥', '#885f46'],
] as const;

export function buildCity(scene: THREE.Scene, s: Surfaces, roads: Street[], paths: Point[][], inPark: (p: Point, r: number) => boolean) {
  const nearSite = (p: Point, radius: number) => DESTINATIONS.some(site => distance(p, site) < radius);
  const random = seeded(1852), lots: Lot[] = [];
  const shells = new Map<THREE.Material, Map<string, THREE.BufferGeometry[]>>();
  const detail = new Instances(unit, weatheredPaintOverConcrete(0xffffff));
  const zinc = new Instances(unit, brushedAluminium(0xffffff));
  const glazed = new Instances(new THREE.PlaneGeometry(), windowGlass(false));
  const occupied = new Instances(new THREE.PlaneGeometry(), windowGlass(true));
  const profile = [
    [0.01, 0], [0.44, 0], [0.49, 0.07], [0.50, 0.15], [0.48, 0.17], [0.48, 0.46],
    [0.50, 0.47], [0.50, 0.49], [0.48, 0.50], [0.48, 0.76], [0.51, 0.78],
    [0.49, 0.81], [0.40, 0.89], [0.14, 0.96], [0.14, 1], [0, 1],
  ];
  const tank = new Instances(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 20), brushedAluminium(0xffffff));
  const panel = new Instances(new THREE.BoxGeometry(1.03, 0.06, 1.76).rotateX(-0.24), photovoltaicPanel());
  const fan = new Instances(new THREE.PlaneGeometry().rotateX(-Math.PI / 2), condenserFan());
  const numbers = Array.from({ length: 9 }, (_, i) => [String(101 + i), '여울마을', '#d8d6c7', '#505f62'] as const);
  const atlas = citySignAtlas([...shops, ...numbers]);
  const signs = new Map<string, THREE.BufferGeometry[]>();
  function sign(f: Frame, id: number, u: number, y: number, v: number, w: number, h: number) {
    const p = f.at(u, v), key = cellAt(p.x, p.z);
    let cell = signs.get(key);
    if (!cell) signs.set(key, cell = []);
    cell.push(atlas.face(id, w, h).rotateY(f.yaw).translate(p.x, y, p.z));
  }
  const gableProfile = new THREE.Shape();
  gableProfile.moveTo(-0.5, 0); gableProfile.lineTo(0.5, 0); gableProfile.lineTo(0, 1); gableProfile.closePath();
  const gables = new Instances(new THREE.ExtrudeGeometry(gableProfile, { depth: 1, bevelEnabled: false })
    .translate(0, 0, -0.5).rotateY(Math.PI / 2), weatheredPaintOverConcrete(0xffffff));
  const brick = masonryMaterial(0xab8069, 0xaaa096), paleBrick = masonryMaterial(0xccb9a0, 0xb6aea0);
  const render = weatheredPaintOverConcrete(0xf2eee2);
  const membrane = roofMembrane();
  function shell(f: Frame, material: THREE.Material, w: number, h: number, d: number, y: number, pitch = 0, tint = 0xffffff) {
    let cells = shells.get(material);
    if (!cells) shells.set(material, cells = new Map());
    const key = cellAt(f.x, f.z);
    let cell = cells.get(key);
    if (!cell) cells.set(key, cell = []);
    const g = boxGeo(w, h, d).rotateX(pitch).rotateY(f.yaw).translate(f.x, y, f.z);
    const pigment = new THREE.Color(tint);
    const colors = new THREE.Uint8BufferAttribute(g.getAttribute('position').count * 3, 3, true);
    for (let i = 0; i < colors.count; i++) colors.setXYZ(i, pigment.r, pigment.g, pigment.b);
    g.setAttribute('color', colors);
    cell.push(g);
  }

  function flatTop(f: Frame, w: number, d: number, h: number, paint: number, apartment: boolean) {
    const v = d / 2;
    const roof = seeded(1 + Math.abs(Math.round(f.x * 17931 + f.z * 617)));
    const rolled = roof() < 0.73;
    const roofTint = rolled ? pick([0x889b90, 0x75867b, 0x8d9697, 0x8b817a, 0x707578], roof) : 0xd7d0bf;
    shell(f, rolled ? membrane : s.floor, w + 0.34, 0.18, d + 0.34, h + 0.09, 0, roofTint);
    for (const side of [-1, 1]) {
      f.add(detail, 0, h + 0.38, side * v, w + 0.25, 0.55, 0.19, paint);
      f.add(detail, side * w / 2, h + 0.38, 0, 0.19, 0.55, d, paint);
      f.add(zinc, 0, h + 0.68, side * v, w + 0.37, 0.065, 0.27, 0xacada3);
      f.add(zinc, side * w / 2, h + 0.68, 0, 0.27, 0.065, d, 0xacada3);
    }
    const layout = roof() < 0.5 ? f : f.shifted(0, 0, Math.PI);
    const stairX = -w * 0.25, stairZ = -d * 0.21;
    const stairW = apartment ? 3.3 + roof() * 1.1 : 2.2 + roof() * 0.7;
    const stairH = apartment ? 2.55 : 2.20;
    layout.add(detail, stairX, h + 0.18 + stairH / 2, stairZ, stairW, stairH, 2.7, paint);
    layout.add(zinc, stairX, h + 0.25 + stairH, stairZ, stairW + 0.27, 0.14, 2.96, 0x959b95);
    layout.add(zinc, stairX + 0.12, h + 1.15, stairZ + 1.37, 0.96, 1.92, 0.06, 0x7c827e);
    if (apartment || roof() < 0.48) {
      const u = w * 0.25, z = -d * 0.24;
      const diameter = (apartment ? 2.20 : 1.58) + roof() * 0.44;
      layout.add(tank, u, h + 0.58, z, diameter, diameter * (0.82 + roof() * 0.34), diameter, pick([0xc1c6be, 0x9aa6a3, 0xb7bdb8], roof));
      for (const dx of [-0.29, 0.29]) layout.add(zinc, u + dx * diameter, h + 0.38, z, 0.11, 0.40, diameter * 0.72, 0x67736d);
    }
    const unitX = w * 0.26, unitZ = d * 0.22, length = apartment ? 3.05 : 1.55;
    layout.add(zinc, unitX, h + 0.32, unitZ, length - 0.16, 0.28, 1.27, 0x777d75);
    layout.add(zinc, unitX, h + 0.88, unitZ, length, 0.84, 1.37, pick([0xb2b6ae, 0xc1beaf, 0xa5ada9], roof));
    for (let i = 0; i < (apartment ? 2 : 1); i++) {
      layout.add(fan, unitX + (apartment ? (i - 0.5) * 1.44 : 0), h + 1.31, unitZ, 1.22, 1, 1.22);
    }
    for (let fin = 0; fin < 4; fin++) layout.add(zinc, unitX, h + 0.61 + fin * 0.15, unitZ + 0.69, length - 0.23, 0.062, 0.04, 0x646d68);

    if (roof() < (apartment ? 0.72 : 0.46)) {
      const modules = Math.min(6, Math.floor(w * 0.46)), middle = -w * 0.24, z = d * 0.23;
      for (const dz of [-0.63, 0.63]) {
        const support = dz > 0 ? 0.44 : 0.14;
        layout.add(zinc, middle, h + 0.18 + support / 2, z + dz, modules * 1.09, support, 0.13, 0x969e98);
      }
      for (let i = 0; i < modules; i++) {
        layout.add(panel, middle + (i - (modules - 1) / 2) * 1.09, h + 0.51, z, 1, 1, 1);
      }
    }
  }

  function building(f: Frame, w: number, d: number, floors: number, apartment: boolean, setback: number) {
    const h = floors * 2.91 + 0.34, v = d / 2, paint = pick([0xc6bfae, 0xc6c9bd, 0xd5c9b8, 0xaaa99d], random);
    const stripe = pick([0x849d9f, 0xa89b7b, 0xad8070, 0x839383], random);
    const facade = apartment ? pick([render, paleBrick, s.wall], random) : pick([brick, paleBrick, render, s.wall], random);
    const palette = facade === render ? [0xe7d3b8, 0xa9bbb8, 0xc1c1ad, 0xe1dfd2, 0xcfae9a]
      : [0xf1eeea, 0xdccfc1, 0xdfbfb0, 0xd6dad4];
    shell(f, facade, w, h, d, h / 2, 0, pick(palette, random));
    shell(f, s.floor, w + 2.4, 0.145, d + 3.2, 0.0725);
    const frontage = f.shifted(0, v + setback / 2);
    shell(frontage, s.floor, w + 2.40, 0.125, setback + 0.06, 0.0625);
    if (!apartment && floors <= 3 && random() < 0.35) {
      const rise = d * (0.18 + random() * 0.085), slope = Math.atan2(rise, v), length = Math.hypot(rise, v);
      f.add(gables, 0, h, 0, w, rise, d, paint);
      for (const side of [-1, 1]) shell(f.shifted(0, side * v / 2), s.iron, w + 0.66, 0.16, length + 0.37, h + rise / 2, side * slope);
      f.add(zinc, 0, h + rise + 0.10, 0, w + 0.74, 0.18, 0.23, 0x8d9189);
    } else {
      flatTop(f, w, d, h, paint, apartment);
    }
    for (let face = 0; face < 4; face++) {
      const a = face * Math.PI / 2, along = face % 2 ? d : w, across = face % 2 ? w : d;
      const side = f.shifted(Math.sin(a) * across / 2, Math.cos(a) * across / 2, a);
      const bays = Math.max(2, Math.floor(along / (apartment ? 3.5 : 3.05))), spacing = along / bays;
      if (apartment && face % 2) {
        // Blank stairwell gables with an estate number break up the window grid.
        side.add(detail, -along * 0.26, h / 2, 0.052, 0.65, h, 0.12, stripe);
        sign(side, shops.length + Math.floor(random() * numbers.length), along * 0.03, h * 0.72, 0.076, along * 0.48, 1.57);
      }
      for (let row = 0; row < floors; row++) {
        const y = 1.64 + row * 2.91;
        if (!apartment && face === 0 && row === 0) continue;
        for (let col = 0; col < bays; col++) {
          if (apartment && face % 2 && col !== bays - 1) continue;
          const u = -along / 2 + (col + 0.5) * spacing;
          const balcony = apartment && face === 0 && row > 0 && (col % 3 !== 1);
          const width = (apartment && face % 2 ? 0.37 : 0.71) * spacing;
          const height = balcony ? 1.95 : 1.49, cy = balcony ? y - 0.18 : y;
          side.add(detail, u, cy, 0.035, width + 0.16, height + 0.16, 0.12, 0x545e5b);
          const warm = random() < (apartment ? 0.17 : 0.10);
          side.add(warm ? occupied : glazed, u, cy, 0.102, width, height, 1, pick([0xf5efd9, 0xe3e6df, 0x90a9b1, 0xb2b6a7, 0xa4b3ba], random));
          side.add(zinc, u + width * 0.08, cy, 0.111, 0.050, height, 0.042, 0xb2b6ac);
          side.add(detail, u, cy - height / 2 - 0.08, 0.10, width + 0.28, 0.10, 0.27, paint);
          if (balcony) {
            const bw = width + 0.56, by = y - 1.29;
            side.add(detail, u, by, 0.56, bw, 0.16, 1.14, paint);
            side.add(detail, u - bw / 2 + 0.07, by + 0.58, 0.53, 0.14, 1.03, 1.06, paint);
            for (const railY of [0.31, 0.96]) side.add(zinc, u, by + railY, 1.068, bw, 0.046, 0.048, 0x686e68);
            for (let bar = 0; bar <= 6; bar++) side.add(zinc, u - bw / 2 + bw * bar / 6, by + 0.56, 1.068, 0.032, 0.82, 0.039, 0x777f77);
            side.add(zinc, u + bw / 2, by + 0.96, 0.55, 0.048, 0.046, 1.04, 0x686e68);
          }
        }
      }
    }
    if (apartment) {
      f.add(detail, 0, 1.43, v + 0.28, 2.42, 2.57, 0.51, stripe);
      f.add(glazed, 0, 1.36, v + 0.55, 1.88, 2.37, 1);
      f.add(detail, 0, 2.83, v + 0.75, 3.25, 0.18, 1.65, paint);
    } else {
      const bays = Math.max(2, Math.round(w / 3.2)), bay = (w - 0.65) / bays;
      for (let i = 0; i < bays; i++) {
        const u = (-w + 0.65 + bay) / 2 + i * bay, door = i === bays - 1;
        f.add(detail, u, 1.30, v + 0.04, bay - 0.07, 2.40, 0.12, 0x505c56);
        f.add(door ? glazed : occupied, u, door ? 1.29 : 1.39, v + 0.112, bay - 0.24, door ? 2.23 : 1.96, 1);
        f.add(zinc, u + 0.22, 1.35, v + 0.128, 0.05, 2.20, 0.045, 0xbfc2b8);
      }
      f.add(detail, 0, 2.89, v + 0.155, w - 0.42, 0.89, 0.29, 0x565b53);
      sign(f, Math.floor(random() * shops.length), 0, 2.89, v + 0.307, Math.min(w - 0.55, 5.55), 0.81);
      const awning = pick([0x728679, 0xbea078, 0x9c766c, 0x778f99], random);
      f.add(detail, -w * 0.13, 2.43, v + 0.52, w * 0.63, 0.09, 1.06, awning);
      f.add(detail, -w * 0.13, 2.34, v + 1.01, w * 0.63, 0.19, 0.075, awning);
    }
  }

  function distanceToStreet(p: Point, road: Street) {
    const end = road.frame.at(0, road.length);
    return Math.hypot(p.x - THREE.MathUtils.clamp(p.x, road.frame.x, Math.max(road.frame.x, end.x)),
      p.z - THREE.MathUtils.clamp(p.z, Math.min(road.frame.z, end.z), Math.max(road.frame.z, end.z)));
  }
  for (const road of roads) for (const side of [-1, 1]) {
    for (let t = road.startTrim + 11; t < road.length - road.endTrim - 6; t += 16 + random() * 10) {
      const apartment = random() < 0.37;
      const w = apartment ? 15 + random() * 8 : 8 + random() * 6.5, d = apartment ? 8.8 + random() * 2 : 7.4 + random() * 3.3;
      const radius = Math.hypot(w, d) / 2 + 1.1;
      const offset = side * (road.width / 2 + 4.7 + d / 2 + random() * 1.35);
      const f = road.frame.shifted(offset, t, -side * Math.PI / 2);
      if (distance(f, { x: 0, z: 4 }) < 31 + radius || nearSite(f, radius + 32) || inPark(f, radius) ||
          paths.some(path => path.some(p => distance(f, p) < radius + 2))) continue;
      if (lots.some(l => distance(f, l) < radius + l.radius) ||
          roads.some(other => other !== road && distanceToStreet(f, other) < radius + other.width / 2 + 2.35)) continue;
      lots.push({ x: f.x, z: f.z, radius });
      // Keep the 30 m cruise and its 12 m approaches above the surrounding roofs.
      const nearApproach = nearSite(f, 63) || distance(f, { x: 0, z: 5 }) < 76;
      const floors = apartment ? 3 + Math.floor(random() * (nearApproach ? 2 : 5)) : 1 + Math.floor(random() * 4);
      building(f, w, d, floors, apartment, Math.abs(offset) - road.width / 2 - 2.35 - d / 2);
    }
  }
  for (const [material, cells] of shells) {
    const tinted = material.clone();
    tinted.vertexColors = true;
    for (const cell of cells.values()) solid(scene, mergeCompatible(cell), tinted);
  }
  for (const cell of signs.values()) solid(scene, mergeCompatible(cell), atlas.material).castShadow = false;
  for (const b of [detail, zinc, glazed, occupied, tank, panel, gables]) b.build(scene);
  fan.build(scene, false);
  return lots;
}
