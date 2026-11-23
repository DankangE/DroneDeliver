import * as THREE from 'three';
import { BASE, DESTINATIONS } from '../config';
import {
  boxGeo, brushedAluminium, canvasTex, finish, groundPlane, mergeCompatible, paintedSteel, planeGeo,
  rubber, seeded, solid, tintedWindowGlass, weatheredPaintOverConcrete, type Surfaces,
} from './materials';
import { cellAt, distance, Frame, Instances, TerrainBatches, pick, unit, type Lot, type Point, type Street } from './terrain-batches';
import { buildCity } from './city';
import { masonryMaterial } from './architecture-materials';

const tau = 2 * Math.PI;
const parks = [
  { x: -54.5, z: 58.5, w: 37, d: 42, angle: 0.22 },
  { x: 54, z: -79, w: 29, d: 79, angle: -0.14 },
  { x: 110, z: 222, w: 48, d: 35, angle: 0.38 },
];
const nearSite = (p: Point, r: number) => DESTINATIONS.some(site => distance(site, p) < r);
const inPark = (p: Point, r: number) => parks.some(park => Math.abs(p.x - park.x) < park.w / 2 + r && Math.abs(p.z - park.z) < park.d / 2 + r);

function hillHeight(x: number, z: number) {
  const r = Math.hypot(x * 0.91, z);
  // The in-town ground, including all routes and delivery positions, is level.
  const rise = THREE.MathUtils.smoothstep(r, 443, 575);
  const ridge = Math.sin(x * 0.011 + Math.sin(z * 0.009)) * 13 + Math.sin(z * 0.017 + x * 0.008) * 8;
  return rise * (32 + ridge + 19 * Math.sin(r * 0.032) + (r - 443) * 0.075);
}

function meadow(scene: THREE.Scene, material: Surfaces['grass']) {
  const parkMasks = parks.map(p =>
    'mown += parkStripe(p, vec2(' + p.x.toFixed(2) + ',' + p.z.toFixed(2) + '), vec2(' +
    (p.w / 2).toFixed(2) + ',' + (p.d / 2).toFixed(2) + '), ' + p.angle.toFixed(2) + ');').join('\n');
  // Apply mowing after the scanned albedo has been sampled by TiledMaterial.
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = function(shader, renderer) {
    previous.call(this, shader, renderer);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        float parkStripe(vec2 p, vec2 center, vec2 extent, float angle) {
          vec2 q = p - center, edge = extent - abs(q);
          float mask = smoothstep(0., 2., min(edge.x,edge.y));
          return mask * (.07 + .09 * sin(dot(q,vec2(cos(angle),sin(angle))) * 1.12));
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 p = vFinishPoint.xz;
        float mown = 0.;
        ${parkMasks}
        diffuseColor.rgb *= 1.0 + mown * vegetation;`);
  };
  // The scan is asynchronously populated by the shared materials loader.
  material.normalScale.setScalar(0.38);
  const normal = new THREE.Vector3();
  for (let cx = -880; cx <= 880; cx += 440) for (let cz = -880; cz <= 880; cz += 440) {
    const segments = cx === 0 && cz === 0 ? 32 : 48;
    const geo = new THREE.PlaneGeometry(440, 440, segments, segments).rotateX(-Math.PI / 2).translate(cx, 0, cz);
    const pos = geo.getAttribute('position'), uv = geo.getAttribute('uv'), normals = geo.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, hillHeight(x, z));
      uv.setXY(i, x + 2.1 * Math.sin(z * 0.07), -z + 1.8 * Math.sin(x * 0.084));
      normal.set(hillHeight(x - 1, z) - hillHeight(x + 1, z), 2, hillHeight(x, z - 1) - hillHeight(x, z + 1)).normalize();
      normals.setXYZ(i, normal.x, normal.y, normal.z);
    }
    solid(scene, geo, material).castShadow = false;
  }
}

const streetsX = [-329, -270, -214, -111, -79, -30, 32, 76, 151, 221, 278, 333];
const streetsZ = [-320, -263, -226, -153, -126, -32, 31, 86, 111, 189, 247, 310];
const roadWidth = (i: number) => i % 4 === 1 ? 9.8 : 7.6;
function streetPlan() {
  const roads: Street[] = [], nodes = new Map<string, { x: number; z: number; w: number; d: number }>();
  function segment(i: number, j: number, axisX: boolean) {
    const x = streetsX[i], z = streetsZ[j];
    const endX = axisX ? streetsX[i + 1] : x, endZ = axisX ? z : streetsZ[j + 1];
    const length = endX - x + endZ - z, width = roadWidth(axisX ? j : i);
    // Several streets terminate at a school yard, farm or courtyard. Keep the
    // whole property free and form a T-junction at the preceding cross street.
    if (DESTINATIONS.some(d => Math.hypot(d.x - THREE.MathUtils.clamp(d.x, x, endX),
      d.z - THREE.MathUtils.clamp(d.z, z, endZ)) < 32 + width / 2)) return;
    const frame = new Frame(x, z, axisX ? Math.PI / 2 : 0);
    for (const [ii, jj] of [[i, j], [axisX ? i + 1 : i, axisX ? j : j + 1]]) {
      nodes.set(ii + '/' + jj, { x: streetsX[ii], z: streetsZ[jj], w: roadWidth(ii), d: roadWidth(jj) });
    }
    roads.push({ frame, length, width, startTrim: roadWidth(axisX ? i : j) / 2, endTrim: roadWidth((axisX ? i : j) + 1) / 2, axisX });
  }
  for (let i = 0; i < streetsX.length; i++) for (let j = 0; j < streetsZ.length; j++) {
    if (i + 1 < streetsX.length) segment(i, j, true);
    if (j + 1 < streetsZ.length) segment(i, j, false);
  }
  return { roads, nodes };
}

function paving() {
  const stone = masonryMaterial(0xa9a499, 0x736f68, 0.25, 0.19);
  stone.bumpScale = 0.008;
  return stone;
}

function approachPaths(scene: THREE.Scene, s: Surfaces, roads: Street[]) {
  const paths: Point[][] = [];
  for (const dest of DESTINATIONS) {
    const court = new Frame(dest.x, dest.z, Math.atan2(-dest.x, -dest.z));
    const gate = court.at(0, 9.13), firstBend = court.at(0, 18);
    const forward = court.at(0, 1);
    let best = Infinity, entrance: Point | undefined;
    for (const { frame, axisX, width, length, startTrim, endTrim } of roads) {
      const along = axisX ? firstBend.x - frame.x : firstBend.z - frame.z;
      const across = axisX ? frame.z - firstBend.z : firstBend.x - frame.x;
      const t = THREE.MathUtils.clamp(along, startTrim + 4, length - endTrim - 4);
      const sidewalk = frame.at(Math.sign(across || 1) * (width / 2 + 2.33), t);
      const ahead = (sidewalk.x - dest.x) * (forward.x - dest.x) + (sidewalk.z - dest.z) * (forward.z - dest.z);
      const travel = distance(firstBend, sidewalk);
      if (ahead >= 22 && travel < best) { best = travel; entrance = sidewalk; }
    }
    if (!entrance) continue;
    const curve = new THREE.CatmullRomCurve3([gate, firstBend, entrance].map(p => new THREE.Vector3(p.x, 0, p.z)));
    const halfWidth = dest.id === 'C3' ? 1.57 : 1.20, points = curve.getPoints(18);
    const pos: number[] = [], uv: number[] = [], indices: number[] = [];
    let walked = 0;
    points.forEach((p, i) => {
      if (i) walked += p.distanceTo(points[i - 1]);
      const tangent = curve.getTangent(i / 18), height = 0.036 + 0.08 * THREE.MathUtils.smoothstep(i / 18, 0.85, 1);
      for (const side of [-halfWidth, halfWidth]) {
        pos.push(p.x + side * tangent.z, height, p.z - side * tangent.x);
        uv.push(side + halfWidth, walked);
      }
      const a = i * 2;
      if (i > 0) indices.push(a - 2, a, a - 1, a - 1, a, a + 1);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(indices); geo.computeVertexNormals();
    solid(scene, geo, dest.id === 'C3' ? s.asphalt : s.floor).castShadow = false;
    paths.push(points);
  }
  return paths;
}

function roadsAndFurniture(scene: THREE.Scene, s: Surfaces, plan: ReturnType<typeof streetPlan>) {
  const random = seeded(4061), stone = paving();
  const curb = new Instances(unit, weatheredPaintOverConcrete(0xffffff));
  const paint = new Instances(unit, finish(0xffffff, 0.92));
  const pole = new Instances(new THREE.CylinderGeometry(0.76, 1, 1, 8), brushedAluminium(0xffffff));
  const hardware = new Instances(unit, paintedSteel(0xffffff));
  const covers = new Instances(new THREE.CylinderGeometry(0.5, 0.5, 1, 24), paintedSteel(0x514e46));
  const cablePoints: number[] = [];
  const streetTrees: Point[] = [], parking: Frame[] = [];
  const pavingCells = new Map<string, THREE.BufferGeometry[]>();
  const asphaltCells = new Map<string, THREE.BufferGeometry[]>();
  function cellPieces(cells: Map<string, THREE.BufferGeometry[]>, x: number, z: number) {
    const key = cellAt(x, z);
    let pieces = cells.get(key);
    if (!pieces) cells.set(key, pieces = []);
    return pieces;
  }
  function roadSurface(w: number, d: number, x: number, z: number, yaw = 0) {
    cellPieces(asphaltCells, x, z).push(planeGeo(w, d).rotateX(-Math.PI / 2).rotateY(yaw).translate(x, 0.021, z));
  }
  for (const node of plan.nodes.values()) roadSurface(node.w, node.d, node.x, node.z);
  for (const { frame, length, width, startTrim, endTrim, axisX } of plan.roads) {
    const first = startTrim, last = length - endTrim, drive = last - first, mid = (last + first) / 2;
    const center = frame.at(0, mid);
    roadSurface(width, drive, center.x, center.z, -frame.yaw);
    const half = width / 2, sidewalk = 2.35;
    // Leave the corners open so crossings join the pavements on both sides.
    for (const side of [-1, 1]) {
      const c = frame.at(side * (half + sidewalk / 2), mid);
      cellPieces(pavingCells, c.x, c.z).push(boxGeo(sidewalk, 0.116, drive - sidewalk * 2).rotateY(frame.yaw).translate(c.x, 0.058, c.z));
      const curbLength = (drive - 0.08) / Math.ceil(drive / 1.9);
      for (let i = 0; i < Math.ceil(drive / 1.9); i++) {
        const t = first + 0.04 + (i + 0.5) * curbLength;
        const ramp = Math.min(t - first, last - t) < 4.5;
        frame.add(curb, side * (half + 0.10), ramp ? 0.047 : 0.09, t, 0.21, ramp ? 0.09 : 0.18, curbLength - 0.02,
          pick([0xc5c3b8, 0xbcbbae, 0xc9c7bd, 0xb6b6ac], random));
      }
      if (drive > 26) {
        const t = mid + side * 0.19 * drive;
        const lampX = side * (half + 0.63);
        frame.add(pole, lampX, 3.48, t, 0.118, 6.96, 0.118, 0xa7aba4);
        frame.add(pole, lampX, 0.49, t, 0.168, 0.98, 0.168, 0x66716f);
        const post = frame.at(lampX, t), tip = frame.at(lampX - side * 1.42, t);
        pole.span(new THREE.Vector3(post.x, 6.70, post.z), new THREE.Vector3(tip.x, 7.25, tip.z), 0.058, 0xb3b6af);
        frame.add(hardware, lampX - side * 1.53, 7.2, t, 0.77, 0.13, 0.34, 0x626b6a);
        frame.add(hardware, lampX - side * 1.55, 7.13, t, 0.59, 0.05, 0.25, 0xe6e7d9);
      }
      for (let t = first + 9; t < last - 5; t += 15 + random() * 7) {
        if (Math.abs(t - (mid + side * 0.19 * drive)) < 2.6) continue;
        const p = frame.at(side * (half + 1.23), t);
        if (nearSite(p, 34) || distance(p, { x: 0, z: 6 }) < 28 || random() > 0.70) continue;
        streetTrees.push(p);
        frame.add(curb, side * (half + 1.23), 0.12, t, 1.10, 0.028, 1.46, 0x6c6555);
      }
      if (width > 9 && drive > 28 && random() < 0.64) {
        const t = mid + side * (random() - 0.5) * (drive - 18);
        parking.push(frame.shifted(side * (half - 1.14), t, side > 0 ? 0 : Math.PI));
        for (const end of [-1, 1]) frame.add(paint, side * (half - 1.2), 0.031, t + end * 2.96, 1.88, 0.009, 0.07, 0xe4e0ca);
      }
    }
    const wide = width > 9;
    for (const t of [first + 2.15, last - 2.15]) {
      for (let u = -half + 0.52; u < half - 0.3; u += 0.85) frame.add(paint, u, 0.030, t, 0.43, 0.01, 2.45, 0xe9e4d1);
      const sign = t < mid ? -1 : 1;
      frame.add(paint, sign * half / 2, 0.030, t - sign * 2.33, half - 0.50, 0.01, 0.24, 0xe4e1ce);
    }
    if (wide) for (const offset of [-0.10, 0.10]) frame.add(paint, offset, 0.030, mid, 0.10, 0.01, drive - 9, 0xdcb357);
    else for (let t = first + 6.4; t < last - 5.5; t += 7) frame.add(paint, 0, 0.03, t, 0.11, 0.01, 2.45, 0xd4b368);
    frame.add(covers, -1.04, 0.030, mid - 4, 0.66, 0.013, 0.66);
    for (let slot = -2; slot < 3; slot++) frame.add(hardware, -1.04, 0.039, mid - 4 + slot * 0.074, 0.36, 0.008, 0.019, 0x343935);

    // Slack conductors span between real insulators, above the service side of a street.
    if (axisX && drive > 28 && Math.abs(Math.round(frame.z)) % 3 !== 0) {
      const u = -(half + 2.03), ts = [first + 2.1, mid, last - 2.1];
      for (const t of ts) {
        frame.add(pole, u, 4.4, t, 0.167, 8.8, 0.167, 0xa39e90);
        frame.add(hardware, u, 8.22, t, 1.76, 0.12, 0.15, 0x776654);
        for (const du of [-0.70, 0, 0.70]) frame.add(pole, u + du, 8.39, t, 0.071, 0.26, 0.071, 0xc8c9ae);
      }
      for (const du of [-0.70, 0, 0.70]) for (let span = 0; span < 2; span++) {
        for (let k = 0; k < 10; k++) for (const f of [k / 10, (k + 1) / 10]) {
          const p = frame.at(u + du, THREE.MathUtils.lerp(ts[span], ts[span + 1], f));
          cablePoints.push(p.x, 8.53 - 2.95 * f * (1 - f), p.z);
        }
      }
    }
  }
  // Pavement corners carry through at the same height, leaving the asphalt junction clear.
  for (const { x, z, w, d } of plan.nodes.values()) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    cellPieces(pavingCells, x, z).push(boxGeo(2.35, 0.114, 2.35).translate(x + sx * (w / 2 + 1.175), 0.057, z + sz * (d / 2 + 1.175)));
  }
  for (const cell of asphaltCells.values()) solid(scene, mergeCompatible(cell), s.asphalt).castShadow = false;
  for (const cell of pavingCells.values()) solid(scene, mergeCompatible(cell), stone).castShadow = false;
  const wires = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(cablePoints, 3));
  scene.add(new THREE.LineSegments(wires, new THREE.LineBasicMaterial({ color: 0x494640 })));
  paint.build(scene, false);
  pole.build(scene, true, true);
  for (const fittings of [covers, curb, hardware]) fittings.build(scene, false, true);
  buildCars(scene, parking, random);
  return streetTrees;
}

// Cross-sections along the car, from rear bumper to nose. Chamfered shoulders,
// sloping glass and wheel silhouettes remain visible from the chase camera.
function coachwork(stations: number[][]) {
  const vertices: THREE.Vector3[] = [], faces: number[] = [];
  for (const [z, base, top, waist, crown] of stations) {
    for (const [x, y] of [[-waist * 0.9, base], [-waist, base + 0.09], [-crown, top - 0.055], [-crown * 0.86, top],
      [crown * 0.86, top], [crown, top - 0.055], [waist, base + 0.09], [waist * 0.9, base]]) vertices.push(new THREE.Vector3(x, y, z));
  }
  for (let i = 0; i < stations.length - 1; i++) for (let j = 0; j < 8; j++) {
    const a = i * 8 + j, b = i * 8 + (j + 1) % 8;
    faces.push(a, a + 8, b, b, a + 8, b + 8);
  }
  const end = (stations.length - 1) * 8;
  for (let j = 1; j < 7; j++) faces.push(0, j, j + 1, end, end + j + 1, end + j);
  const geo = new THREE.BufferGeometry().setFromPoints(vertices);
  const uv = vertices.flatMap(v => [v.z, v.x + v.y]);
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(faces); geo.computeVertexNormals();
  return geo;
}

function buildCars(scene: THREE.Scene, spaces: Frame[], random: () => number) {
  const enamel = paintedSteel(0xffffff);
  const body = new Instances(coachwork([[-2.16, 0.37, 0.77, 0.78, 0.78], [-1.72, 0.31, 0.95, 0.88, 0.85],
    [0.86, 0.31, 0.93, 0.90, 0.84], [1.77, 0.33, 0.77, 0.85, 0.82], [2.12, 0.38, 0.67, 0.76, 0.74]]), enamel);
  const glass = new Instances(coachwork([[-1.58, 0.86, 0.97, 0.78, 0.76], [-0.94, 0.88, 1.48, 0.82, 0.65],
    [0.30, 0.88, 1.51, 0.82, 0.66], [1.10, 0.84, 0.97, 0.79, 0.75]]), tintedWindowGlass(0x424f55, 0));
  const trim = new Instances(unit, enamel);
  const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 18).rotateZ(Math.PI / 2);
  const wheels = new Instances(wheelGeo, rubber(0x292b2b));
  const hubs = new Instances(wheelGeo, brushedAluminium(0xb4b7b4));
  for (const f of spaces) {
    const color = pick([0xd9d8c8, 0xc2c5c1, 0x5a656b, 0x3a4e60, 0xe3dfd4, 0x98655e, 0x393e42], random);
    f.add(body, 0, 0.025, 0, 1, 1, 1, color);
    f.add(glass, 0, 0.025, 0, 1, 1, 1);
    f.add(trim, 0, 1.519, -0.30, 1.22, 0.055, 1.23, color);
    for (const side of [-1, 1]) {
      for (const t of [-1.34, 1.33]) {
        f.add(wheels, side * 0.82, 0.35, t, 0.19, 0.66, 0.66);
        f.add(hubs, side * 0.921, 0.35, t, 0.014, 0.40, 0.40);
      }
      f.add(trim, side * 0.887, 0.76, -0.22, 0.034, 0.047, 0.17, 0xa2a5a4);
      f.add(trim, side * 0.97, 1.00, 0.57, 0.23, 0.15, 0.24, color);
      f.add(trim, side * 0.62, 0.68, 2.08, 0.30, 0.115, 0.11, 0xe9e8d9);
      f.add(trim, side * 0.63, 0.75, -2.125, 0.31, 0.14, 0.11, 0x9c4240);
    }
    f.add(trim, 0, 0.53, 2.12, 0.72, 0.16, 0.035, 0x353c3f);
    f.add(trim, 0, 0.55, -2.17, 0.46, 0.12, 0.026, 0xe8e9d9);
  }
  body.build(scene);
  glass.build(scene, false);
  for (const fittings of [wheels, hubs, trim]) fittings.build(scene, false, true);
}

function leafCluster(seed: number, detail: 'full' | 'reduced' | 'silhouette') {
  const random = seeded(seed);
  const core = new THREE.IcosahedronGeometry(0.78, detail === 'full' ? 2 : detail === 'reduced' ? 1 : 0);
  const position = core.getAttribute('position');
  const vertices: number[] = [], colors: number[] = [];
  function vertex(x: number, y: number, z: number, light: number) {
    vertices.push(x, y, z); colors.push(light * 0.98, light, light * 0.88);
  }
  function surface(x: number, y: number, z: number) {
    return 1 + 0.14 * Math.sin(6 * x + z * 4) * Math.cos(7 * z - 5 * y) + 0.10 * Math.sin(9 * y + x * 3);
  }
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const r = surface(x, y, z);
    vertex(x * r, y * r, z * r, 0.45 + 0.20 * y + 0.21 * (r - 0.85));
  }
  // Sculpt the outer shoots as small, folded leaf sprays. Their gaps survive
  // the depth and shadow passes without an alpha-tested billboard.
  const sprays = detail === 'full' ? 108 : detail === 'reduced' ? 4 : 0;
  for (let i = 0; i < sprays; i++) {
    const y = random() * 2 - 1, theta = random() * tau, band = Math.sqrt(1 - y * y);
    const x = band * Math.cos(theta), z = band * Math.sin(theta);
    const r = 0.80 * surface(0.78 * x, 0.78 * y, 0.78 * z);
    for (let j = 0; j < 3; j++) {
      const a = theta + (j - 1) * 0.98, dx = Math.cos(a), dz = Math.sin(a);
      const cx = r * x + 0.075 * dx, cz = r * z + 0.075 * dz, cy = r * y + 0.065 * j;
      const w = 0.068 + random() * 0.073, len = 0.095 + random() * 0.13, light = 0.62 + 0.20 * y + 0.30 * random();
      vertex(cx - dx * len, cy - 0.036, cz - dz * len, light * 0.74);
      vertex(cx - dz * w, cy + 0.075, cz + dx * w, light);
      vertex(cx + dx * len, cy + 0.018, cz + dz * len, light);
      vertex(cx - dx * len, cy - 0.036, cz - dz * len, light * 0.74);
      vertex(cx + dx * len, cy + 0.018, cz + dz * len, light);
      vertex(cx + dz * w, cy + 0.026, cz - dx * w, light * 0.87);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  // The canopy core is one leafy volume. Smooth across its duplicated triangle
  // edges, leaving the small folded shoots with their individual face normals.
  const normals = geo.getAttribute('normal'), n = new THREE.Vector3(), outward = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    outward.fromBufferAttribute(position, i).normalize();
    n.fromBufferAttribute(normals, i).lerp(outward, 0.78).normalize();
    normals.setXYZ(i, n.x, n.y, n.z);
  }
  core.dispose();
  return geo;
}

function trees(scene: THREE.Scene, lots: Lot[], roads: Street[], streetTrees: Point[], paths: Point[][]) {
  const random = seeded(5231);
  const bark = canvasTex(128, 256, g => {
    g.fillStyle = '#a6a096'; g.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 560; i++) {
      const x = random() * 128, y = random() * 256;
      g.strokeStyle = pick(['#787973', '#b7b3a6', '#929086', '#aeaaa0'], random);
      g.lineWidth = 0.5 + random() * 2; g.beginPath(); g.moveTo(x, y);
      g.lineTo(x + random() * 3, y + 3 + random() * 25); g.stroke();
    }
  });
  const timber = new Instances(new THREE.CylinderGeometry(0.72, 1, 1, 7, 1, true),
    new THREE.MeshStandardMaterial({ map: bark, bumpMap: bark, bumpScale: 0.047, roughness: 0.99 }));
  const leaf = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, side: THREE.DoubleSide });
  const crowns = [7201, 151].map(seed => new Instances(
    leafCluster(seed, 'full'), leaf, leafCluster(seed, 'reduced'), leafCluster(seed, 'silhouette'),
  ));
  const greens = [0x789051, 0x749258, 0x8a9b56, 0x67825c, 0x94a466, 0x687f48];
  function plant(p: Point, size: number, street: boolean) {
    const angle = random() * tau, species = random();
    const pine = species < (street ? 0.13 : 0.39), poplar = !pine && species < 0.58;
    const forkHeight = (pine ? 2.95 : poplar ? 1.95 : 2.45) * size;
    const barkTint = pine ? 0xa18369 : pick([0x827869, 0x77796e, 0x998b77], random);
    const color = pine ? pick([0x506c53, 0x647952, 0x566f5c], random)
      : poplar ? pick([0xa1ad65, 0x869e59, 0x97a96f], random) : pick(greens, random);
    const stem = new THREE.Vector3(p.x, hillHeight(p.x, p.z), p.z);
    const fork = stem.clone().add(new THREE.Vector3((pine ? 0.41 : 0.11) * size, forkHeight, 0.05 * size));
    timber.span(stem, fork, (pine ? 0.22 : 0.16) * size, barkTint);
    const branches = pine ? 4 : poplar ? 5 : 6;
    for (let i = 0; i < branches; i++) {
      const layer = i / branches;
      const bearing = angle + tau * layer + 0.4 * random();
      const rise = (pine ? 0.5 + 2.6 * layer : poplar ? 0.5 + 2.9 * layer : 0.65 + random() * 0.95) * size;
      const reach = (pine ? 1.8 - layer : poplar ? 0.57 : 1.42) * (0.76 + random() * 0.5) * size;
      const tip = new THREE.Vector3(fork.x + Math.cos(bearing) * reach, fork.y + rise, fork.z + Math.sin(bearing) * reach);
      const crotch = fork.clone(); crotch.y += rise * 0.36 - 0.30 * size;
      timber.span(crotch, tip, 0.092 * size, barkTint);
      const mass = size * (1.03 + 0.46 * random());
      const spread = pine ? 1.36 : poplar ? 0.83 : 1.12;
      crowns[i % 2].add(tip.x, tip.y + mass * 0.41, tip.z, mass * spread, mass * (pine ? 0.65 : poplar ? 1.60 : 1.02),
        mass * spread * 0.91, bearing, color);
    }
    const top = fork.clone(); top.y += (pine ? 3.5 : poplar ? 4.1 : 1.98) * size;
    timber.span(fork, top, 0.105 * size, barkTint);
    crowns[0].add(top.x, top.y, top.z, size * (poplar ? 0.81 : 1.45), size * (pine ? 0.69 : 1.44),
      size * (poplar ? 0.86 : 1.28), angle, color);
  }
  for (const p of streetTrees) plant(p, 0.69 + random() * 0.65, true);
  const scattered: Point[] = [];
  for (let i = 0; i < 2200 && scattered.length < 370; i++) {
    const p = { x: (random() - 0.5) * 738, z: (random() - 0.5) * 738 };
    if (nearSite(p, 35) || distance(p, { x: 0, z: 6 }) < 32 || inPark(p, 0) ||
        paths.some(path => path.some(node => distance(p, node) < 3.5)) || lots.some(l => distance(p, l) < l.radius + 2.4) || scattered.some(tree => distance(p, tree) < 4.4)) continue;
    if (roads.some(({ frame, axisX, length, width }) => {
      const along = axisX ? p.x - frame.x : p.z - frame.z, across = axisX ? p.z - frame.z : p.x - frame.x;
      return along > -4 && along < length + 4 && Math.abs(across) < width / 2 + 4.6;
    })) continue;
    scattered.push(p); plant(p, 0.86 + random() * 0.83, false);
  }
  for (const park of parks) for (const side of [-1, 1]) {
    for (let v = -park.d / 2 + 4; v < park.d / 2; v += 9 + random() * 4) {
      if (Math.abs(v + park.d * 0.27) < 2) continue;
      plant({ x: park.x + side * (park.w / 2 - 3.9), z: park.z + v }, 1.05 + random() * 0.40, false);
    }
  }
  timber.build(scene); for (const crown of crowns) crown.build(scene);

  // On the far slopes the individual crowns merge into forested ridgelines.
  const ridge = new Instances(new THREE.IcosahedronGeometry(1, 1), finish(0xffffff, 0.99));
  for (let i = 0; i < 3400; i++) {
    const a = random() * tau, r = 435 + random() * 470, x = Math.cos(a) * r / 0.91, z = Math.sin(a) * r;
    const size = 3.9 + random() * 5.4;
    ridge.add(x, hillHeight(x, z) + size * 0.64, z, size, size * (0.80 + random() * 1.12), size * (0.84 + random() * 0.37), a, pick(greens, random));
  }
  ridge.build(scene, false);
}

function parkPaths(scene: THREE.Scene, s: Surfaces) {
  const legs = new Instances(unit, paintedSteel(0xffffff));
  const benches = new Instances(unit, s.wood);
  for (const park of parks) {
    const pathX = park.x - park.w / 2 + 7.8;
    groundPlane(scene, 1.95, park.d + 2, s.floor, pathX, 0.026, park.z);
    groundPlane(scene, park.w - 9.0, 1.60, s.floor, pathX + (park.w - 9.0) / 2 + 0.98, 0.027, park.z - park.d * 0.27);
    for (const side of [-1, 1]) {
      const z = park.z + park.d * 0.21 * side, x = pathX + 1.32;
      for (const offset of [-0.62, 0.62]) legs.add(x, 0.22, z + offset, 0.31, 0.44, 0.09, 0, 0x515c57);
      for (const offset of [-0.16, 0, 0.16]) benches.add(x + offset, 0.48, z, 0.14, 0.065, 1.72, 0, 0xd5bfa7);
      benches.add(x + 0.20, 0.73, z, 0.065, 0.24, 1.72, 0, 0xdecab2);
    }
  }
  benches.build(scene, false, true); legs.build(scene, false, true);
}

export function buildTerrain(scene: THREE.Scene, s: Surfaces) {
  const firstBatch = scene.children.length;
  meadow(scene, s.grass);
  const plan = streetPlan();
  const streetTrees = roadsAndFurniture(scene, s, plan);
  // Apron access joins the side street outside the playable base boundary.
  const apronEdge = BASE.bounds.maxX + 1;
  const roadEdge = 32 - roadWidth(streetsX.indexOf(32)) / 2;
  groundPlane(scene, roadEdge - apronEdge, 4.1, s.floor, (apronEdge + roadEdge) / 2, 0.027, -5.7);
  const paths = approachPaths(scene, s, plan.roads);
  const lots = buildCity(scene, s, plan.roads, paths, inPark);
  parkPaths(scene, s);
  trees(scene, lots, plan.roads, streetTrees, paths);
  return new TerrainBatches(scene.children.slice(firstBatch));
}
