import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTex, finish, ROTOR_BLUR_LAYER, solid } from '../materials';
import { finishes } from './finishes';
import { batchRigidParts, hose, point, rod, rounded, screw, tau, turned } from './parts';

// Span stations carry radius, full chord, sweep, height and local pitch in degrees.
const stations = [
  [0.022, 0.049, 0, 0, 15], [0.065, 0.062, 0.001, 0, 24],
  [0.115, 0.089, 0.006, 0.002, 26], [0.19, 0.107, 0.011, 0.006, 21],
  [0.28, 0.106, 0.02, 0.010, 16], [0.37, 0.087, 0.033, 0.014, 12],
  [0.425, 0.071, 0.044, 0.017, 10], [0.45, 0.065, 0.052, 0.019, 9],
  [0.46, 0.058, 0.057, 0.020, 9], [0.476, 0.048, 0.064, 0.021, 8],
  [0.492, 0.032, 0.069, 0.022, 8], [0.50, 0.006, 0.075, 0.023, 7],
];

function bladeGeometry() {
  const positions: number[] = [], colors: number[] = [], index: number[] = [];
  const perimeter = 32;
  const graphite = new THREE.Color(0x343b3c), marking = new THREE.Color(0xb9b7a7);
  stations.forEach(([r, chord, sweep, height, degrees], row) => {
    const pitch = THREE.MathUtils.degToRad(degrees);
    for (let j = 0; j < perimeter; j++) {
      // Cosine spacing resolves the rounded leading edge and the thin trailing edge.
      const t = (1 - Math.cos(tau * j / perimeter)) / 2;
      const thickness = 0.66 * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t*t + 0.2843 * t**3 - 0.1036 * t**4);
      const lift = chord * (0.11 * t * (1 - t) + (j < perimeter / 2 ? 1 : -1) * thickness);
      const offset = (t - 0.30) * chord;
      positions.push(r, height + lift * Math.cos(pitch) - offset * Math.sin(pitch), sweep + offset * Math.cos(pitch) + lift * Math.sin(pitch));
      const color = r >= 0.45 && r <= 0.46 ? marking : graphite;
      colors.push(color.r, color.g, color.b);
      if (row + 1 < stations.length) {
        const a = row * perimeter + j, b = row * perimeter + (j + 1) % perimeter;
        index.push(a, b, a + perimeter, b, b + perimeter, a + perimeter);
      }
    }
  });
  for (let j = 1; j < perimeter - 1; j++) {
    const tip = (stations.length - 1) * perimeter;
    index.push(0, j + 1, j, tip, tip + j, tip + j + 1);
  }
  const blade = new THREE.BufferGeometry();
  blade.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  blade.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  blade.setIndex(index);
  blade.computeVertexNormals();
  return mergeGeometries([blade, blade.clone().rotateY(Math.PI)]);
}

const discRadius = 0.516;
function exposureDisc() {
  // The mean alpha of each annulus is the fraction of it swept by solid blade.
  // A finite shutter time leaves two faint fans. The empty corners and tip stay clear.
  const size = 384;
  const map = canvasTex(size, size, g => {
    const image = g.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = (2 * (x + 0.5) / size - 1) * discRadius;
      const v = (2 * (y + 0.5) / size - 1) * discRadius;
      const r = Math.hypot(u, v);
      if (r < 0.03 || r > 0.509) continue;
      const radial = Math.min(0.5, r * (1 - 0.012 * r / discRadius));
      const k = stations.findIndex(station => station[0] >= radial);
      if (k < 1) continue;
      const a = stations[k - 1], b = stations[k], t = (radial - a[0]) / (b[0] - a[0]);
      const chord = THREE.MathUtils.lerp(a[1], b[1], t), sweep = THREE.MathUtils.lerp(a[2], b[2], t);
      const angle = Math.atan2(v, u) - Math.atan2(sweep, radial);
      const fans = 0.46 + 1.45 * Math.pow(0.5 + 0.5 * Math.cos(2 * angle), 3);
      const duty = Math.min(0.9, chord / (Math.PI * r) * fans);
      const paint = Math.exp(-((radial - 0.455) ** 2) / 0.000055);
      const offset = (y * size + x) * 4;
      image.data.set([55 + 125 * paint, 61 + 119 * paint, 60 + 109 * paint, 255 * duty * (1 - THREE.MathUtils.smoothstep(r, 0.497, 0.509))], offset);
    }
    g.putImageData(image, 0, 0);
  });
  return new THREE.MeshStandardMaterial({ map, roughness: 0.6, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
}

function motorWindings() {
  // Each enamelled winding loops around a radial tooth, visible through the
  // air gap between the stationary end plate and the rotating bell.
  const points: THREE.Vector3[] = [];
  for (let step = 0; step <= 80; step++) {
    const t = step / 80, a = 5 * tau * t;
    points.push(point(0.017 * Math.cos(a), 0.024 * Math.sin(a), 0.055 + 0.041 * t));
  }
  const wire = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 100, 0.0036, 7, false);
  return mergeGeometries(Array.from({ length: 12 }, (_, i) => wire.clone().rotateY(tau * i / 12)));
}

function rotorParts() {
  const m = finishes(), bell = new THREE.Group();
  turned(bell, [[0.096, -0.079], [0.107, -0.079], [0.112, -0.076], [0.112, -0.069], [0.108, -0.067], [0.097, -0.067]], m.anodized);
  turned(bell, [[0.098, -0.041], [0.109, -0.041], [0.113, -0.038], [0.113, -0.028], [0.107, -0.021], [0.092, -0.019], [0.089, -0.026]], m.anodized);
  for (let i = 0; i < 8; i++) {
    const a = tau * i / 8;
    const frame = new THREE.Group(); frame.rotation.y = a; bell.add(frame);
    const rib = rounded(frame, 0.022, 0.039, 0.012, 0.003, m.anodized, 0, -0.054, 0.105);
    rib.rotation.z = -0.25;
    const spoke = rounded(frame, 0.022, 0.011, 0.086, 0.004, m.anodized, 0, -0.022, 0.063);
    spoke.rotation.set(0.08, 0.17, 0);
  }
  turned(bell, [[0.033, -0.031], [0.041, -0.023], [0.037, -0.011], [0.032, -0.006], [0.032, 0.013], [0.019, 0.017], [0, 0.017]], m.titanium);
  screw(bell, 0, 0.018, 0, 0.016, m.sockets);
  batchRigidParts(bell);
  const blades = finish(0xffffff, 0.42, 0.12);
  blades.vertexColors = true;
  return { bell, winding: motorWindings(), prop: bladeGeometry(), blades, disc: exposureDisc(), discGeometry: new THREE.CircleGeometry(discRadius, 96) };
}

let shared: ReturnType<typeof rotorParts> | undefined;
export function addRotor(tilt: THREE.Group, fixed: THREE.Group, sx: number, sz: number, team: THREE.Material, light: THREE.Material) {
  const m = finishes(), parts = shared ??= rotorParts();
  const x = sx * 0.82, z = sz * 0.82, motorHeight = 0.81;
  const root = point(sx * 0.323, 0.611, sz * 0.278);
  const hinge = point(sx * 0.443, 0.616, sz * 0.373);
  const end = point(x, 0.687, z);
  const along = (t: number) => hinge.clone().lerp(end, t);
  const yaw = Math.atan2(x - hinge.x, z - hinge.z);
  // Clevis plates sandwich the folding knuckle. The wire has slack over the joint.
  rod(fixed, root, hinge, 0.079, 0.064, m.nylon);
  turned(fixed, [[0.056, -0.054], [0.065, -0.049], [0.065, -0.034], [0.056, -0.032],
    [0.055, 0.029], [0.066, 0.032], [0.066, 0.048], [0.06, 0.052], [0, 0.052]], m.anodized, hinge.x, hinge.y, hinge.z);
  screw(fixed, hinge.x, hinge.y + 0.053, hinge.z, 0.027, m.titanium);
  rod(fixed, along(0.045), along(0.945), 0.049, 0.034, m.carbon);
  rod(fixed, along(0.05), along(0.16), 0.06, 0.053, m.nylon);
  rod(fixed, along(0.159), along(0.182), 0.053, 0.052, team);
  rod(fixed, along(0.78), along(0.96), 0.042, 0.052, m.nylon);
  hose(fixed, [root.clone().add(point(0, -0.025, 0)), hinge.clone().add(point(0, -0.063, 0)),
    along(0.26).add(point(0, -0.050, 0)), along(0.76).add(point(0, -0.036, 0)), end], 0.008, m.gasket);
  for (const t of [0.32, 0.72]) {
    rod(fixed, along(t), along(t + 0.018), 0.052 - 0.016 * t, 0.052 - 0.016 * t, m.rubber);
  }
  const shoe = rounded(fixed, 0.15, 0.074, 0.245, 0.036, m.nylon, x, 0.673, z);
  shoe.rotation.y = yaw;
  turned(fixed, [[0, -0.016], [0.073, -0.016], [0.106, -0.007], [0.108, 0.003], [0.092, 0.011], [0.052, 0.012], [0.045, 0.054], [0, 0.056]], m.anodized, x, 0.704, z);
  solid(fixed, parts.winding, m.copper, x, 0.751, z);
  // Wrap the signal lens around the outboard end so it reads from above and
  // below the arm. Its inner edge disappears into the molded end cap.
  const nav = solid(fixed, new THREE.SphereGeometry(1, 32, 12), light,
    x + Math.sin(yaw) * 0.121, 0.677, z + Math.cos(yaw) * 0.121);
  nav.rotation.y = yaw;
  nav.scale.set(0.044, 0.016, 0.024);

  const motor = parts.bell.clone();
  motor.position.set(x, motorHeight, z);
  tilt.add(motor);
  const direction = sx * sz;
  const prop = new THREE.Group();
  motor.add(prop);
  solid(prop, parts.prop, parts.blades);
  prop.scale.z = direction;
  // Park each pair at a different azimuth, with the disc taking over at speed.
  motor.rotation.y = sx * 0.39 + sz * 0.77;
  const disc = new THREE.Mesh(parts.discGeometry, parts.disc);
  disc.rotation.x = -Math.PI / 2;
  disc.scale.y = direction;
  disc.layers.set(ROTOR_BLUR_LAYER);
  disc.visible = false;
  motor.add(disc);
  return { motor, prop, disc, direction };
}
