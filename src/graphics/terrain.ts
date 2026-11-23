import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BASE, DESTINATIONS } from '../config';
import { KO_FONT, boxGeo, canvasTex, finish, groundPlane, seeded, solid, type Surfaces } from './materials';

type Point = { x: number; z: number };
type Lot = Point & { radius: number };
const tau = 2 * Math.PI;
const up = new THREE.Vector3(0, 1, 0);
const unit = new THREE.BoxGeometry();
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const cellAt = (x: number, z: number) => Math.floor(x / 110) + '/' + Math.floor(z / 110);
const pick = <T,>(values: T[], random: () => number) => values[Math.floor(random() * values.length)];

// Spatial batches let the sun's small shadow frustum discard entire blocks at once.
class Instances {
  private cells = new Map<string, { matrix: THREE.Matrix4; tint: number }[]>();
  constructor(private geometry: THREE.BufferGeometry, private material: THREE.Material) {}

  private put(position: THREE.Vector3, rotation: THREE.Quaternion, scale: THREE.Vector3, tint: number) {
    const key = cellAt(position.x, position.z);
    let cell = this.cells.get(key);
    if (!cell) this.cells.set(key, cell = []);
    cell.push({ matrix: new THREE.Matrix4().compose(position, rotation, scale), tint });
  }

  add(x: number, y: number, z: number, w: number, h: number, d: number, yaw = 0, tint = 0xffffff) {
    this.put(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(up, yaw), new THREE.Vector3(w, h, d), tint);
  }

  span(a: THREE.Vector3, b: THREE.Vector3, radius: number, tint = 0xffffff) {
    const axis = b.clone().sub(a), length = axis.length();
    this.put(a.clone().lerp(b, 0.5), new THREE.Quaternion().setFromUnitVectors(up, axis.normalize()), new THREE.Vector3(radius, length, radius), tint);
  }

  build(scene: THREE.Scene, castShadow = true) {
    const color = new THREE.Color();
    for (const cell of this.cells.values()) {
      const mesh = new THREE.InstancedMesh(this.geometry, this.material, cell.length);
      cell.forEach(({ matrix, tint }, i) => {
        mesh.setMatrixAt(i, matrix);
        mesh.setColorAt(i, color.setHex(tint));
      });
      mesh.computeBoundingSphere();
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
    this.cells.clear();
  }
}

// A street, doorway or balcony can use the same local frontage coordinates.
class Frame {
  private sin: number;
  private cos: number;
  constructor(readonly x: number, readonly z: number, readonly yaw: number) {
    this.sin = Math.sin(yaw); this.cos = Math.cos(yaw);
  }
  at(u: number, v: number) {
    return { x: this.x + this.cos * u + this.sin * v, z: this.z - this.sin * u + this.cos * v };
  }
  add(batch: Instances, u: number, y: number, v: number, w: number, h: number, d: number, tint = 0xffffff, turn = 0) {
    const p = this.at(u, v);
    batch.add(p.x, y, p.z, w, h, d, this.yaw + turn, tint);
  }
  shifted(u: number, v: number, turn = 0) {
    const p = this.at(u, v);
    return new Frame(p.x, p.z, this.yaw + turn);
  }
}

function repeat(texture: THREE.Texture, x: number, y: number) {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(x, y);
  return texture;
}

// Hand-laid running bond. UVs on architectural solids are expressed in metres.
export function masonryMaterial(base: number, joint: number, w = 0.34, h = 0.12) {
  const random = seeded(base % 65521 + 1);
  const map = canvasTex(512, 512, g => {
    g.fillStyle = new THREE.Color(joint).getStyle();
    g.fillRect(0, 0, 512, 512);
    for (let row = 0; row < 16; row++) for (let col = -1; col < 8; col++) {
      const x = (col + (row % 2) * 0.5) * 64, y = row * 32;
      g.fillStyle = new THREE.Color(base).multiplyScalar(0.8 + 0.35 * random()).getStyle();
      g.fillRect(x + 1, y + 1.6, 62.4, 29.5);
      for (let fleck = 0; fleck < 6; fleck++) {
        g.fillStyle = fleck % 2 ? 'rgba(251,235,210,.07)' : 'rgba(40,25,16,.06)';
        g.fillRect(x + random() * 52, y + 3 + random() * 24, 4 + random() * 8, 1.5);
      }
    }
  });
  repeat(map, 1 / (8 * w), 1 / (16 * h));
  return new THREE.MeshStandardMaterial({ map, bumpMap: map, bumpScale: 0.015, roughness: 0.92 });
}

export function signMaterial(title: string, line: string, background: string, lettering = '#f8f3df') {
  const map = canvasTex(768, 192, g => {
    g.fillStyle = background; g.fillRect(0, 0, 768, 192);
    g.strokeStyle = lettering; g.globalAlpha = 0.52; g.lineWidth = 2; g.strokeRect(10, 9, 748, 174); g.globalAlpha = 1;
    g.fillStyle = lettering; g.textAlign = 'center';
    g.font = 'bold 75px ' + KO_FONT; g.fillText(title, 384, 105, 681);
    g.font = '26px ' + KO_FONT; g.fillText(line, 384, 154, 676);
  });
  return new THREE.MeshStandardMaterial({ map, roughness: 0.61 });
}

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
  const geo = new THREE.PlaneGeometry(2200, 2200, 280, 280);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position'), uv = geo.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, hillHeight(x, z));
    uv.setXY(i, x + 2.1 * Math.sin(z * 0.07), -z + 1.8 * Math.sin(x * 0.084));
  }
  geo.computeVertexNormals();
  const parkMasks = parks.map(p =>
    'mown += parkStripe(p, vec2(' + p.x.toFixed(2) + ',' + p.z.toFixed(2) + '), vec2(' +
    (p.w / 2).toFixed(2) + ',' + (p.d / 2).toFixed(2) + '), ' + p.angle.toFixed(2) + ');').join('\n');
  // Keep the scan's micro-relief, and derive the vegetation pigment independently
  // of its baked yellow grass. Two offset sample scales suppress the aerial grid.
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = function(shader, renderer) {
    previous.call(this, shader, renderer);
    shader.vertexShader = 'varying vec2 vLand;\n' + shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n vLand = position.xz;');
    shader.fragmentShader = `
      varying vec2 vLand;
      float landHash(vec2 p) {
        vec3 q = fract(p.xyx * vec3(.1031,.11369,.13787));
        q += dot(q, q.yzx + 19.19);
        return fract((q.x + q.y) * q.z);
      }
      float landNoise(vec2 p) {
        vec2 c = floor(p), f = fract(p); f = f*f*(3.-2.*f);
        return mix(mix(landHash(c),landHash(c+vec2(1,0)),f.x),
                   mix(landHash(c+vec2(0,1)),landHash(c+1.),f.x),f.y);
      }
      float parkStripe(vec2 p, vec2 center, vec2 extent, float angle) {
        vec2 q = p - center, edge = extent - abs(q);
        float mask = smoothstep(0., 2., min(edge.x,edge.y));
        return mask * (.12 + .13 * sin(dot(q,vec2(cos(angle),sin(angle))) * 1.12));
      }
    ` + shader.fragmentShader.replace('#include <map_fragment>', `
      vec2 p = vLand;
      float macro = landNoise(p*.026)*.63 + landNoise(p*.091)*.25 + landNoise(p*.28)*.12;
      float grit = .58;
      #ifdef USE_MAP
        vec2 t = vMapUv;
        vec3 a = texture2D(map, t).rgb;
        vec3 b = texture2D(map, mat2(.70,.72,-.72,.70)*t*.64 + vec2(.37,.24)).rgb;
        grit = dot(mix(a,b,.30+.39*landNoise(p*.085)),vec3(.24,.62,.14));
      #endif
      float mown = 0.;
      ${parkMasks}
      vec3 grassColor = mix(vec3(.074,.129,.035),vec3(.206,.282,.089),macro);
      float earth = smoothstep(.63,.82,macro + .055*(landNoise(p*.62)-.5));
      vec3 soil = vec3(.201,.146,.082);
      vec3 pigment = mix(grassColor*(1.+mown),soil,earth*.88);
      diffuseColor.rgb = pigment * (.60 + 1.10*sqrt(max(grit,.001)));
    `);
  };
  // The scan is asynchronously populated by the shared materials loader.
  material.normalScale.setScalar(0.38);
  solid(scene, geo, material).castShadow = false;
}

const streetsX = [-329, -270, -214, -111, -79, -30, 32, 76, 151, 221, 278, 333];
const streetsZ = [-320, -263, -226, -153, -126, -32, 31, 86, 111, 189, 247, 310];
const roadWidth = (i: number) => i % 4 === 1 ? 9.8 : 7.6;
type Street = { frame: Frame; length: number; width: number; startTrim: number; endTrim: number; axisX: boolean };
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
  const curb = new Instances(unit, finish(0xffffff, 0.9));
  const paint = new Instances(unit, finish(0xffffff, 0.92));
  const pole = new Instances(new THREE.CylinderGeometry(0.76, 1, 1, 12), finish(0xffffff, 0.55, 0.38));
  const hardware = new Instances(unit, finish(0xffffff, 0.50, 0.38));
  const covers = new Instances(new THREE.CylinderGeometry(0.5, 0.5, 1, 24), finish(0x514e46, 0.86, 0.39));
  const cablePoints: number[] = [];
  const streetTrees: Point[] = [], parking: Frame[] = [];
  const pavingPieces: THREE.BufferGeometry[] = [];
  for (const node of plan.nodes.values()) groundPlane(scene, node.w, node.d, s.asphalt, node.x, 0.021, node.z);
  for (const { frame, length, width, startTrim, endTrim, axisX } of plan.roads) {
    const first = startTrim, last = length - endTrim, drive = last - first, mid = (last + first) / 2;
    const center = frame.at(0, mid);
    groundPlane(scene, width, drive, s.asphalt, center.x, 0.021, center.z).rotation.z = -frame.yaw;
    const half = width / 2, sidewalk = 2.35;
    // Leave the corners open so crossings join the pavements on both sides.
    for (const side of [-1, 1]) {
      const c = frame.at(side * (half + sidewalk / 2), mid);
      pavingPieces.push(boxGeo(sidewalk, 0.116, drive - sidewalk * 2).rotateY(frame.yaw).translate(c.x, 0.058, c.z));
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
    pavingPieces.push(boxGeo(2.35, 0.114, 2.35).translate(x + sx * (w / 2 + 1.175), 0.057, z + sz * (d / 2 + 1.175)));
  }
  solid(scene, mergeGeometries(pavingPieces), stone).castShadow = false;
  const wires = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(cablePoints, 3));
  scene.add(new THREE.LineSegments(wires, new THREE.LineBasicMaterial({ color: 0x494640 })));
  paint.build(scene, false); covers.build(scene, false); curb.build(scene); pole.build(scene); hardware.build(scene);
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
  geo.setIndex(faces); geo.computeVertexNormals();
  return geo;
}

function buildCars(scene: THREE.Scene, spaces: Frame[], random: () => number) {
  const enamel = new THREE.MeshPhysicalMaterial({ roughness: 0.34, metalness: 0.42, clearcoat: 0.87 });
  const body = new Instances(coachwork([[-2.16, 0.37, 0.77, 0.78, 0.78], [-1.72, 0.31, 0.95, 0.88, 0.85],
    [0.86, 0.31, 0.93, 0.90, 0.84], [1.77, 0.33, 0.77, 0.85, 0.82], [2.12, 0.38, 0.67, 0.76, 0.74]]), enamel);
  const glass = new Instances(coachwork([[-1.58, 0.86, 0.97, 0.78, 0.76], [-0.94, 0.88, 1.48, 0.82, 0.65],
    [0.30, 0.88, 1.51, 0.82, 0.66], [1.10, 0.84, 0.97, 0.79, 0.75]]), new THREE.MeshPhysicalMaterial({ color: 0x424f55, roughness: 0.12, metalness: 0.32, clearcoat: 1 }));
  const trim = new Instances(unit, enamel);
  const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 18).rotateZ(Math.PI / 2);
  const wheels = new Instances(wheelGeo, finish(0x292b2b, 0.93));
  const hubs = new Instances(wheelGeo, finish(0xb4b7b4, 0.40, 0.63));
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
  for (const b of [body, glass, wheels, hubs, trim]) b.build(scene);
}

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
  return new THREE.MeshPhysicalMaterial({ map, roughness: lit ? 0.24 : 0.16, metalness: 0.27, clearcoat: 0.87,
    clearcoatRoughness: 0.10, envMapIntensity: 1.25, emissive: lit ? 0xffdbab : 0, emissiveMap: lit ? map : null,
    emissiveIntensity: lit ? 0.38 : 0 });
}

const shops = [
  ['모퉁이 제과', '천연 발효빵 · 과자', '#475d54'], ['소담 분식', '김밥 · 떡볶이', '#854941'],
  ['물결 세탁소', '수선 · 세탁', '#536c79'], ['다온 철물', '공구 · 생활 자재', '#585b52'],
  ['여울 책방', '책과 문구', '#e1ce9d', '#414f55'], ['새잎 꽃집', '생화 · 화분', '#716879'],
  ['고샅 상회', '채소 · 과일', '#6d734e'], ['온기 밥집', '오늘 지은 집밥', '#885f46'],
];

function buildCity(scene: THREE.Scene, s: Surfaces, roads: Street[], paths: Point[][]) {
  const random = seeded(1852), lots: Lot[] = [];
  const shells = new Map<THREE.Material, Map<string, THREE.BufferGeometry[]>>();
  const detail = new Instances(unit, finish(0xffffff, 0.74, 0.09));
  const zinc = new Instances(unit, finish(0xffffff, 0.43, 0.54));
  const glazed = new Instances(new THREE.PlaneGeometry(), windowGlass(false));
  const occupied = new Instances(new THREE.PlaneGeometry(), windowGlass(true));
  const tank = new Instances(new THREE.CylinderGeometry(0.5, 0.5, 1, 28), finish(0xffffff, 0.38, 0.58));
  const shopsigns = shops.map(([title, sub, bg, fg]) => new Instances(new THREE.PlaneGeometry(), signMaterial(title, sub, bg, fg)));
  const gableProfile = new THREE.Shape();
  gableProfile.moveTo(-0.5, 0); gableProfile.lineTo(0.5, 0); gableProfile.lineTo(0, 1); gableProfile.closePath();
  const gables = new Instances(new THREE.ExtrudeGeometry(gableProfile, { depth: 1, bevelEnabled: false })
    .translate(0, 0, -0.5).rotateY(Math.PI / 2), finish(0xffffff, 0.91));
  const numbers = Array.from({ length: 9 }, (_, i) => new Instances(new THREE.PlaneGeometry(), signMaterial(String(101 + i), '여울마을', '#d8d6c7', '#505f62')));
  const brick = masonryMaterial(0xab8069, 0xaaa096), paleBrick = masonryMaterial(0xccb9a0, 0xb6aea0);
  const render = finish(0xf0ead9, 0.95);
  const membrane = finish(0x789991, 0.85), roofGray = finish(0xa6a39b, 0.9);
  function shell(f: Frame, material: THREE.Material, w: number, h: number, d: number, y: number, pitch = 0) {
    let cells = shells.get(material);
    if (!cells) shells.set(material, cells = new Map());
    const key = cellAt(f.x, f.z);
    let cell = cells.get(key);
    if (!cell) cells.set(key, cell = []);
    cell.push(boxGeo(w, h, d).rotateX(pitch).rotateY(f.yaw).translate(f.x, y, f.z));
  }

  function flatTop(f: Frame, w: number, d: number, h: number, paint: number, apartment: boolean) {
    const v = d / 2;
    shell(f, random() < 0.70 ? membrane : roofGray, w + 0.34, 0.18, d + 0.34, h + 0.09);
    for (const side of [-1, 1]) {
      f.add(detail, 0, h + 0.38, side * v, w + 0.25, 0.55, 0.19, paint);
      f.add(detail, side * w / 2, h + 0.38, 0, 0.19, 0.55, d, paint);
      f.add(zinc, 0, h + 0.68, side * v, w + 0.37, 0.065, 0.27, 0xacada3);
      f.add(zinc, side * w / 2, h + 0.68, 0, 0.27, 0.065, d, 0xacada3);
    }
    f.add(detail, -w * 0.28, h + 1.20, -d * 0.20, 2.55, 2.22, 3.15, paint);
    f.add(zinc, -w * 0.28, h + 2.37, -d * 0.20, 2.85, 0.15, 3.43, 0x838980);
    f.add(detail, -w * 0.28, h + 1.12, -d * 0.20 + 1.59, 0.98, 1.94, 0.05, 0x66746e);
    if (apartment || random() < 0.38) {
      const u = w * 0.22, tv = -d * 0.25;
      f.add(tank, u, h + 1.41, tv, 1.82, 1.84, 1.82, 0xb7bfbb);
      for (const y of [0.51, 1.05, 1.69, 2.31]) f.add(tank, u, h + y, tv, 1.90, 0.085, 1.90, 0xc3c8bf);
      f.add(tank, u, h + 2.42, tv, 0.55, 0.17, 0.55, 0x86918e);
      for (const leg of [-0.56, 0.56]) f.add(zinc, u + leg, h + 0.34, tv, 0.08, 0.42, 1.15, 0x88958d);
    }
    for (let hvac = 0; hvac < (apartment ? 2 : 1); hvac++) {
      const u = hvac * 1.67, tv = d * 0.21;
      f.add(detail, u, h + 0.60, tv, 1.22, 0.82, 0.90, 0xcfcec1);
      for (let fin = 0; fin < 5; fin++) f.add(zinc, u, h + 0.34 + fin * 0.118, tv + 0.46, 0.95, 0.044, 0.045, 0x747c77);
    }
  }

  function building(f: Frame, w: number, d: number, floors: number, apartment: boolean, setback: number) {
    const h = floors * 2.91 + 0.34, v = d / 2, paint = pick([0xc6bfae, 0xc6c9bd, 0xd5c9b8, 0xaaa99d], random);
    const stripe = pick([0x849d9f, 0xa89b7b, 0xad8070, 0x839383], random);
    shell(f, apartment ? pick([render, paleBrick, s.wall], random) : pick([brick, paleBrick, s.wall], random), w, h, d, h / 2);
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
        side.add(pick(numbers, random), along * 0.03, h * 0.72, 0.076, along * 0.48, 1.57, 1);
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
          side.add(random() < 0.065 ? occupied : glazed, u, cy, 0.102, width, height, 1, pick([0xd6ded7, 0xe2ddd2, 0xb1c2c3, 0xc2c2ad], random));
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
      f.add(pick(shopsigns, random), 0, 2.89, v + 0.307, Math.min(w - 0.55, 5.55), 0.81, 1);
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
  for (const [mat, cells] of shells) for (const cell of cells.values()) solid(scene, mergeGeometries(cell), mat);
  for (const b of [detail, zinc, glazed, occupied, tank, gables, ...shopsigns, ...numbers]) b.build(scene);
  return lots;
}

function leafCluster(seed: number) {
  const random = seeded(seed);
  const core = new THREE.IcosahedronGeometry(0.78, 2);
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
  for (let i = 0; i < 115; i++) {
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
  geo.computeVertexNormals(); core.dispose();
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
  const timber = new Instances(new THREE.CylinderGeometry(0.72, 1, 1, 9),
    new THREE.MeshStandardMaterial({ map: bark, bumpMap: bark, bumpScale: 0.047, roughness: 0.99 }));
  const leaf = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, side: THREE.DoubleSide });
  const crowns = [new Instances(leafCluster(7201), leaf), new Instances(leafCluster(151), leaf)];
  const greens = [0x789051, 0x749258, 0x8a9b56, 0x67825c, 0x94a466, 0x687f48];
  function plant(p: Point, size: number, street: boolean) {
    const angle = random() * tau, tall = random() < 0.35, trunkY = (street ? 2.65 : 2.20) * size;
    const color = pick(greens, random), barkTint = pick([0x827869, 0x747669, 0x958573], random);
    const stem = new THREE.Vector3(p.x, hillHeight(p.x, p.z), p.z);
    const fork = stem.clone().add(new THREE.Vector3(0.11 * size, trunkY, 0.05 * size));
    timber.span(stem, fork, 0.20 * size, barkTint);
    const n = tall ? 5 : 6;
    for (let i = 0; i < n; i++) {
      const bearing = angle + tau * i / n + 0.4 * random(), rise = (tall ? 1.05 : 0.74) * (0.85 + random()) * size;
      const reach = (0.84 + random() * 0.75) * (tall ? 0.78 : 1) * size;
      const tip = new THREE.Vector3(p.x + Math.cos(bearing) * reach, fork.y + rise, p.z + Math.sin(bearing) * reach);
      const crotch = fork.clone(); crotch.y -= random() * 0.44 * size;
      timber.span(crotch, tip, 0.092 * size, barkTint);
      const mass = size * (1.00 + 0.48 * random());
      crowns[i % 2].add(tip.x, tip.y + mass * 0.53, tip.z, mass, mass * (tall ? 1.54 : 1.06), mass * 1.03, bearing, color);
    }
    crowns[0].add(fork.x + size * 0.18, fork.y + size * (tall ? 2.84 : 1.93), fork.z - size * 0.12,
      size * 1.39, size * (tall ? 1.99 : 1.36), size * 1.3, angle, color);
  }
  for (const p of streetTrees) plant(p, 0.76 + random() * 0.31, true);
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
    ridge.add(x, hillHeight(x, z) + size * 0.64, z, size, size * 1.19, size * 1.11, a, pick(greens, random));
  }
  ridge.build(scene, false);
}

function parkPaths(scene: THREE.Scene, s: Surfaces) {
  const benches = new Instances(unit, finish(0xffffff, 0.82));
  for (const park of parks) {
    const pathX = park.x - park.w / 2 + 7.8;
    groundPlane(scene, 1.95, park.d + 2, s.floor, pathX, 0.026, park.z);
    groundPlane(scene, park.w - 9.0, 1.60, s.floor, pathX + (park.w - 9.0) / 2 + 0.98, 0.027, park.z - park.d * 0.27);
    for (const side of [-1, 1]) {
      const z = park.z + park.d * 0.21 * side, x = pathX + 1.32;
      for (const offset of [-0.62, 0.62]) benches.add(x, 0.22, z + offset, 0.31, 0.44, 0.09, 0, 0x515c57);
      for (const offset of [-0.16, 0, 0.16]) benches.add(x + offset, 0.48, z, 0.14, 0.065, 1.72, 0, 0xa28768);
      benches.add(x + 0.20, 0.73, z, 0.065, 0.24, 1.72, 0, 0xaa9176);
    }
  }
  benches.build(scene);
}

export function buildTerrain(scene: THREE.Scene, s: Surfaces) {
  meadow(scene, s.grass);
  const plan = streetPlan();
  const streetTrees = roadsAndFurniture(scene, s, plan);
  // Apron access joins the side street outside the playable base boundary.
  const apronEdge = BASE.bounds.maxX + 1;
  const roadEdge = 32 - roadWidth(streetsX.indexOf(32)) / 2;
  groundPlane(scene, roadEdge - apronEdge, 4.1, s.floor, (apronEdge + roadEdge) / 2, 0.027, -5.7);
  const paths = approachPaths(scene, s, plan.roads);
  const lots = buildCity(scene, s, plan.roads, paths);
  parkPaths(scene, s);
  trees(scene, lots, plan.roads, streetTrees, paths);
}
