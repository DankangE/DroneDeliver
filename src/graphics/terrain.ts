import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DESTINATIONS } from '../config';
import { boxGeo, canvasTex, finish, groundPlane, seeded, solid, type Surfaces } from './materials';

const up = new THREE.Vector3(0, 1, 0);
const unit = new THREE.BoxGeometry();
const tau = Math.PI * 2;
type Point = { x: number; z: number };
type Street = { a: Point; b: Point; length: number; dx: number; dz: number };
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

// Batch repeated details by neighbourhood so the local shadow cameras can cull distant streets.
class Instances {
  private cells = new Map<string, { matrix: THREE.Matrix4; color: THREE.Color }[]>();
  constructor(private geometry: THREE.BufferGeometry, private material: THREE.Material) {}

  add(x: number, y: number, z: number, w: number, h: number, d: number, yaw = 0, color = 0xffffff) {
    const key = Math.floor(x / 80) + '/' + Math.floor(z / 80);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = [];
      this.cells.set(key, cell);
    }
    const rotation = new THREE.Quaternion().setFromAxisAngle(up, yaw);
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), rotation, new THREE.Vector3(w, h, d));
    cell.push({ matrix, color: new THREE.Color(color) });
  }

  build(scene: THREE.Scene, casts = true) {
    for (const cell of this.cells.values()) {
      const mesh = new THREE.InstancedMesh(this.geometry, this.material, cell.length);
      cell.forEach(({ matrix, color }, i) => {
        mesh.setMatrixAt(i, matrix);
        mesh.setColorAt(i, color);
      });
      mesh.computeBoundingSphere();
      mesh.castShadow = casts;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }
}

function streets() {
  const directions = DESTINATIONS.map(d => ({ angle: Math.atan2(d.z, d.x), radius: Math.hypot(d.x, d.z) })).sort((a, b) => a.angle - b.angle);
  const point = (angle: number, r: number) => ({ x: Math.cos(angle) * r, z: Math.sin(angle) * r });
  const network: Street[] = [];
  function link(a: Point, b: Point) {
    const length = dist(a, b);
    network.push({ a, b, length, dx: (b.x - a.x) / length, dz: (b.z - a.z) / length });
  }
  for (const [i, { angle, radius }] of directions.entries()) {
    const other = directions[(i + 1) % directions.length].angle;
    for (const [a, b] of [[24, 83], [83, 145], [145, radius - 8], [radius + 25, 257], [257, 338]]) {
      link(point(angle, a), point(angle, b));
    }
    for (const r of [83, 145, 257]) link(point(angle, r), point(other, r));
  }
  return network;
}

function roadDistance(p: Point, road: Street) {
  const t = THREE.MathUtils.clamp((p.x - road.a.x) * road.dx + (p.z - road.a.z) * road.dz, 0, road.length);
  return Math.hypot(p.x - road.a.x - road.dx * t, p.z - road.a.z - road.dz * t);
}

function buildRoads(scene: THREE.Scene, s: Surfaces, roads: Street[]) {
  const paint = new Instances(unit, finish(0xe1d8b7, 0.91));
  const curb = new Instances(unit, finish(0xb5b1a5, 0.92));
  const seams = new Instances(unit, finish(0x797a70));
  const nodes = new Map<string, Point>();
  for (const road of roads) {
    const { a, b, length, dx, dz } = road;
    const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2, yaw = Math.atan2(dx, dz);
    const frame = new THREE.Group();
    frame.position.set(x, 0, z);
    frame.rotation.y = yaw;
    scene.add(frame);
    groundPlane(frame, 5.8, length, s.asphalt, 0, 0.025, 0);
    for (const side of [-1, 1]) {
      const offset = side * 3.54;
      groundPlane(frame, 1.28, length - 9, s.floor, offset, 0.14, 0);
      curb.add(x + dz * side * 2.96, 0.08, z - dx * side * 2.96, 0.18, 0.16, length - 9, yaw);
      for (let v = 6; v < length - 5; v += 2.8) {
        seams.add(a.x + dx * v + dz * offset, 0.141, a.z + dz * v - dx * offset, 1.23, 0.003, 0.019, yaw);
      }
      paint.add(x + dz * side * 2.62, 0.031, z - dx * side * 2.62, 0.08, 0.003, length - 10, yaw);
    }
    for (let v = 7; v < length - 7; v += 7.2) paint.add(a.x + dx * v, 0.031, a.z + dz * v, 0.105, 0.003, 2.8, yaw, 0xf3cb7e);
    for (const p of [a, b]) nodes.set(p.x.toFixed(2) + '/' + p.z.toFixed(2), p);
  }
  const junction = new THREE.CircleGeometry(4.3, 24);
  const uv = junction.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 8.6, uv.getY(i) * 8.6);
  for (const p of nodes.values()) {
    if (![83, 145, 257].some(r => Math.abs(Math.hypot(p.x, p.z) - r) < 0.1)) continue;
    const cap = solid(scene, junction, s.asphalt, p.x, 0.028, p.z);
    cap.rotation.x = -Math.PI / 2; cap.castShadow = false;
  }
  paint.build(scene, false); curb.build(scene); seams.build(scene, false);
}

function buildCity(scene: THREE.Scene, s: Surfaces, roads: Street[]) {
  const rnd = seeded(1852);
  const lots: (Point & { radius: number })[] = [];
  const walls: THREE.BufferGeometry[] = [], roofs: THREE.BufferGeometry[] = [];
  const detail = new Instances(unit, finish(0xffffff, 0.75, 0.12));
  const panes = new Instances(unit, new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.15, metalness: 0.47, clearcoat: 1, clearcoatRoughness: 0.08,
    envMapIntensity: 1.25,
  }));
  const glassTints = [0x4b6068, 0x354650, 0x627479, 0x7c7971, 0x303c42];
  const paints = [0xa59e8e, 0xaab1ad, 0x9b9389, 0xb7ac95, 0x8d999d];
  function occupy(point: Point, w: number, d: number) {
    const radius = Math.hypot(w, d) / 2 + 0.9;
    if (Math.hypot(point.x, point.z) < 41 || DESTINATIONS.some(dest => dist(dest, point) < radius + 20)) return false;
    if (lots.some(lot => dist(lot, point) < radius + lot.radius) || roads.some(road => roadDistance(point, road) < radius + 3.4)) return false;
    lots.push({ ...point, radius });
    return true;
  }
  function building(x: number, z: number, w: number, d: number, floors: number, yaw: number) {
    const h = floors * 3.05 + 0.32;
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    const paint = paints[Math.floor(rnd() * paints.length)];
    function local(batch: Instances, u: number, y: number, v: number, width: number, height: number, depth: number, tint: number, angle = 0) {
      batch.add(x + cos * u + sin * v, y, z - sin * u + cos * v, width, height, depth, yaw + angle, tint);
    }
    function shell(target: THREE.BufferGeometry[], width: number, height: number, depth: number, y: number) {
      target.push(boxGeo(width, height, depth).rotateY(yaw).translate(x, y, z));
    }
    shell(walls, w, h, d, h / 2);
    shell(roofs, w + 0.6, 0.22, d + 0.6, h + 0.11);
    shell(roofs, w + 2.2, 0.12, d + 2, 0.06);
    for (const side of [-1, 1]) {
      local(detail, 0, h + 0.37, side * d / 2, w + 0.28, 0.44, 0.19, paint);
      local(detail, side * w / 2, h + 0.37, 0, 0.19, 0.44, d, paint);
    }
    local(detail, -w * 0.24, h + 0.86, -d * 0.2, 2.2, 1.3, 2.65, paint);
    local(detail, -w * 0.24, h + 1.56, -d * 0.2, 2.4, 0.14, 2.85, 0x636866);
    local(detail, w * 0.22, h + 0.55, -d * 0.27, 1.1, 0.63, 1.8, 0xafb3ab);
    for (let fin = 0; fin < 5; fin++) local(detail, w * 0.22, h + 0.88, -d * 0.27 - 0.55 + fin * 0.25, 0.85, 0.05, 0.085, 0x59615e);

    for (let face = 0; face < 4; face++) {
      const angle = face * Math.PI / 2, along = face % 2 ? d : w, across = face % 2 ? w : d;
      const bays = Math.max(2, Math.floor(along / 3.1)), spacing = along / bays;
      function onFace(batch: Instances, u: number, y: number, offset: number, width: number, height: number, depth: number, tint: number) {
        const v = across / 2 + offset;
        local(batch, Math.cos(angle) * u + Math.sin(angle) * v, y, -Math.sin(angle) * u + Math.cos(angle) * v, width, height, depth, tint, angle);
      }
      for (let row = 0; row < floors; row++) {
        const y = 1.65 + 3.05 * row;
        for (let col = 0; col < bays; col++) {
          const u = -along / 2 + (col + 0.5) * spacing, width = spacing * 0.64;
          const door = face === 0 && col === 0 && row === 0;
          const center = door ? 1.2 : y, height = door ? 2.22 : 1.43;
          onFace(detail, u, center, 0.025, width + 0.16, height + 0.16, 0.09, 0x484e4d);
          onFace(panes, u, center, 0.083, width, height, 0.045, glassTints[Math.floor(rnd() * glassTints.length)]);
          onFace(detail, u + width * 0.12, center, 0.115, 0.046, height, 0.035, 0x949a93);
          if (!door) onFace(detail, u, y - 0.81, 0.095, width + 0.26, 0.11, 0.27, paint);
        }
        if (row === 0 && face === 0) onFace(detail, 0, 2.82, 0.38, along * 0.88, 0.16, 0.95, paint);
      }
    }
  }
  for (const road of roads) for (const side of [-1, 1]) {
    for (let t = 9; t < road.length - 6; t += 14 + rnd() * 7) {
      const w = 6.8 + rnd() * 7, d = 6.2 + rnd() * 5.3, offset = side * (5.8 + Math.hypot(w, d) / 2);
      const p = { x: road.a.x + road.dx * t + road.dz * offset, z: road.a.z + road.dz * t - road.dx * offset };
      if (!occupy(p, w, d)) continue;
      const close = DESTINATIONS.some(dest => dist(p, dest) < 65);
      const floors = 1 + Math.floor(rnd() * (close ? 3 : 6));
      building(p.x, p.z, w, d, floors, Math.atan2(-side * road.dz, side * road.dx));
    }
  }
  for (const [geos, mat] of [[walls, s.wall], [roofs, s.floor]] as const) {
    if (geos.length) solid(scene, mergeGeometries(geos), mat);
  }
  detail.build(scene); panes.build(scene);
  return lots;
}

function foliageGeometry() {
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const pos = geo.getAttribute('position'), colors = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const noise = Math.sin(x * 18 + y * 7) * Math.sin(z * 16 - y * 10);
    const radius = 1 + 0.13 * noise;
    pos.setXYZ(i, x * radius, y * radius, z * radius);
    const light = 0.75 + 0.13 * y + 0.12 * noise;
    colors.push(light * 0.94, light, light * 0.85);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

export function buildTerrain(scene: THREE.Scene, s: Surfaces) {
  const groundGeo = new THREE.PlaneGeometry(1400, 1400, 180, 180);
  groundGeo.rotateX(-Math.PI / 2);
  const pos = groundGeo.getAttribute('position'), uv = groundGeo.getAttribute('uv'), shades = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const patch = Math.sin(x * 0.051 + Math.sin(z * 0.034)) * Math.cos(z * 0.068 - x * 0.017);
    uv.setXY(i, x + 1.3 * Math.sin(z * 0.071), -z + 1.6 * Math.sin(x * 0.061));
    shades.push(0.85 + 0.15 * patch, 0.88 + 0.12 * patch, 0.74 + 0.12 * patch);
  }
  groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(shades, 3));
  s.grass.vertexColors = true;
  solid(scene, groundGeo, s.grass).castShadow = false;
  const roads = streets();
  buildRoads(scene, s, roads);
  const lots = buildCity(scene, s, roads);
  const rnd = seeded(913);
  const wood = finish(0x736453, 0.94);
  const trunks = new Instances(new THREE.CylinderGeometry(0.15, 0.26, 1, 9), wood);
  const leafMat = finish(0xffffff, 0.95);
  // Small overlapping leaves give each crown dappled detail in the low flight camera.
  const leafNoise = seeded(325);
  const leafMap = canvasTex(256, 256, g => {
    g.fillStyle = '#919582'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2300; i++) {
      const x = leafNoise() * 256, y = leafNoise() * 256, angle = leafNoise() * tau;
      const length = 2 + leafNoise() * 3.5;
      g.fillStyle = ['#abb0a0', '#959b89', '#c9cbbd', '#e4e6d6', '#7a8175'][i % 5];
      for (const dx of x < 6 ? [0, 256] : x > 250 ? [0, -256] : [0]) {
        for (const dy of y < 6 ? [0, 256] : y > 250 ? [0, -256] : [0]) {
          g.beginPath(); g.ellipse(x + dx, y + dy, length, length * 0.42, angle, 0, tau); g.fill();
        }
      }
    }
  });
  leafMap.wrapS = leafMap.wrapT = THREE.RepeatWrapping;
  leafMap.repeat.set(2, 1);
  leafMat.map = leafMap;
  leafMat.vertexColors = true;
  const leaves = new Instances(foliageGeometry(), leafMat);
  const palette = [0x586842, 0x647748, 0x78894d, 0x485d3d, 0x69783e];
  let count = 0;
  for (let tries = 0; count < 720 && tries < 3500; tries++) {
    const x = (rnd() - 0.5) * 690, z = (rnd() - 0.5) * 690, p = { x, z };
    if (Math.hypot(x, z) < 28 || DESTINATIONS.some(dest => dist(p, dest) < 23) ||
        lots.some(lot => dist(p, lot) < lot.radius + 2) || roads.some(road => roadDistance(p, road) < 6.5)) continue;
    const size = 0.7 + rnd() * 1.1, crown = 2.55 + rnd(), yaw = rnd() * tau;
    const tint = palette[Math.floor(rnd() * palette.length)];
    trunks.add(x, 1.6 * size, z, size, 3.2 * size, size, yaw);
    for (let lobe = 0; lobe < 7; lobe++) {
      const angle = yaw + lobe * tau / 6, top = lobe === 6;
      const r = top ? 0 : size * (0.7 + rnd() * 0.45), width = size * (1 + rnd() * 0.45);
      leaves.add(x + Math.cos(angle) * r, size * (crown + (top ? 1.32 : rnd() * 0.85)), z + Math.sin(angle) * r,
        width, width * (1.05 + rnd() * 0.6), width * 0.92, angle, tint);
    }
    count++;
  }
  trunks.build(scene); leaves.build(scene);
}
