import * as THREE from 'three';
import { canvasTex, KO_FONT, solid } from '../materials';
import { finishes, paintedDeck } from './finishes';
import { hose, point, rod, rounded, screw, turned } from './parts';

const outline = new THREE.CatmullRomCurve3([
  [0, 0.548], [0.19, 0.54], [0.30, 0.465], [0.386, 0.316],
  [0.402, 0.22], [0.369, 0.035], [0.38, -0.12], [0.407, -0.255],
  [0.385, -0.367], [0.277, -0.491], [0.164, -0.556], [0, -0.571],
  [-0.164, -0.556], [-0.277, -0.491], [-0.385, -0.367], [-0.407, -0.255],
  [-0.38, -0.12], [-0.369, 0.035], [-0.402, 0.22], [-0.386, 0.316],
  [-0.30, 0.465], [-0.19, 0.54],
].map(([x, z]) => point(x, 0, z)), true);

function moldedShell(rings: [number, number, number][], deckUV = false) {
  const path = outline.getSpacedPoints(96), stride = path.length;
  const xyz: number[] = [], index: number[] = [], uv: number[] = [];
  for (const [row, [y, width, length]] of rings.entries()) {
    for (const [i, p] of path.entries()) {
      const x = p.x * width, z = p.z * length, u = i / (stride - 1);
      xyz.push(x, y, z);
      if (deckUV) uv.push(0.5 + x, 0.5 - z / 1.32);
      else uv.push(outline.getLength() * u, y);
      if (row > 0 && i < stride - 1) {
        const a = (row - 1) * stride + i;
        index.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
      }
    }
  }
  for (const row of [0, rings.length - 1]) {
    const center = xyz.length / 3, [y] = rings[row];
    xyz.push(0, y, 0); uv.push(0.5, 0.5);
    for (let i = 0; i < stride - 1; i++) {
      const a = row * stride + i;
      if (row === 0) index.push(center, a + 1, a);
      else index.push(center, a, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(xyz, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index); geometry.computeVertexNormals();
  // The duplicated UV seam is the same physical vertex.
  const normals = geometry.getAttribute('normal'), normal = new THREE.Vector3();
  for (let row = 0; row < rings.length; row++) {
    const a = row * stride, b = a + stride - 1;
    normal.fromBufferAttribute(normals, a).add(new THREE.Vector3().fromBufferAttribute(normals, b)).normalize();
    normals.setXYZ(a, normal.x, normal.y, normal.z); normals.setXYZ(b, normal.x, normal.y, normal.z);
  }
  return geometry;
}

function noseBadge(serial: string, team: number) {
  const map = canvasTex(768, 128, g => {
    g.fillStyle = '#2b3537'; g.fillRect(0, 0, 768, 128);
    g.fillStyle = new THREE.Color(team).getStyle(); g.fillRect(10, 12, 13, 104);
    g.fillStyle = '#e3e4d9'; g.font = `bold 70px ${KO_FONT}`; g.fillText('하늘길 택배', 48, 87);
    g.fillStyle = '#9ba49e'; g.fillRect(542, 23, 3, 82);
    g.font = `bold 88px ${KO_FONT}`; g.fillStyle = '#f1f1e6'; g.textAlign = 'center'; g.fillText(serial, 651, 96);
  });
  return new THREE.MeshStandardMaterial({ map, roughness: 0.52 });
}

export function addShell(body: THREE.Group, serial: string, team: number, status: THREE.Material, strobe: THREE.Material) {
  const m = finishes();
  solid(body, moldedShell([[0.563, 0.72, 0.84], [0.566, 0.79, 0.89], [0.593, 0.94, 0.96],
    [0.627, 1.01, 1], [0.667, 1.018, 1], [0.675, 1.005, 0.993]]), m.carbon);
  solid(body, moldedShell([[0.674, 0.997, 0.985], [0.683, 0.997, 0.985]]), m.gasket);
  solid(body, moldedShell([[0.682, 1.007, 0.998], [0.690, 1.017, 1.007], [0.712, 0.999, 0.996],
    [0.742, 0.947, 0.969], [0.765, 0.855, 0.912], [0.773, 0.803, 0.862], [0.773, 0.76, 0.83]], true), paintedDeck(team, serial));
  for (const sx of [-1, 1]) {
    for (const z of [-0.29, 0.001, 0.301]) {
      screw(body, sx * (z < 0 ? 0.271 : 0.257), 0.773, z, 0.011, m.sockets);
    }
    // Louvres set down into a black intake well with an overhanging perimeter lip.
    const intake = new THREE.Group();
    body.add(intake); intake.position.set(sx * 0.236, 0.77, 0.152);
    intake.rotation.z = -sx * 0.046;
    rounded(intake, 0.090, 0.014, 0.184, 0.007, m.nylon);
    rounded(intake, 0.074, 0.010, 0.167, 0.004, m.gasket, 0, 0.007, 0);
    for (let j = 0; j < 8; j++) {
      const slat = rounded(intake, 0.068, 0.008, 0.011, 0.003, m.anodized, 0, 0.013, (j - 3.5) * 0.019);
      slat.rotation.x = -0.34;
    }
    // Rear diversity aerials rake away from the battery's slide path.
    const base = point(sx * 0.215, 0.756, 0.38), collar = point(sx * 0.222, 0.792, 0.389);
    const tip = point(sx * 0.254, 0.931, 0.444);
    rod(body, base, collar, 0.021, 0.015, m.anodized);
    rod(body, collar, tip, 0.011, 0.006, m.rubber);
  }
  rounded(body, 0.31, 0.079, 0.058, 0.02, m.nylon, 0, 0.655, -0.546);
  solid(body, new THREE.PlaneGeometry(0.272, 0.0453), noseBadge(serial, team), 0, 0.661, -0.5755).rotation.y = Math.PI;
  rounded(body, 0.103, 0.014, 0.014, 0.005, status, 0, 0.625, -0.569);
  // Elastomer isolation ring, turned signal receiver base, and a radio-transparent radome.
  turned(body, [[0, 0], [0.081, 0], [0.084, 0.004], [0.084, 0.014], [0.078, 0.017], [0, 0.017]], m.gasket, 0, 0.769, -0.363);
  turned(body, [[0.073, 0], [0.079, 0.004], [0.078, 0.018], [0.071, 0.025], [0.052, 0.031], [0, 0.033]], m.shell, 0, 0.785, -0.363);
  const collar = rounded(body, 0.092, 0.038, 0.05, 0.012, m.nylon, 0, 0.72, 0.536);
  collar.rotation.x = 0.23;
  solid(body, new THREE.SphereGeometry(1, 16, 12), strobe, 0, 0.724, 0.554).scale.set(0.037, 0.014, 0.013);
}

export function addUndercarriage(body: THREE.Group) {
  const m = finishes();
  for (const sx of [-1, 1]) {
    const x = sx * 0.397;
    // Bent continuous runner, with separate replaceable rubber ground pads.
    hose(body, [point(x, 0.159, -0.515), point(x, 0.116, -0.46), point(x, 0.102, -0.364),
      point(x, 0.102, 0.364), point(x, 0.116, 0.46), point(x, 0.145, 0.51)], 0.019, m.anodized);
    for (const sz of [-1, 1]) {
      const root = point(sx * 0.277, 0.592, sz * 0.314);
      const ankle = point(x, 0.107, sz * 0.361);
      rod(body, root, ankle, 0.027, 0.018, m.carbon);
      rod(body, root, root.clone().lerp(ankle, 0.17), 0.040, 0.031, m.nylon);
      rod(body, ankle, ankle.clone().lerp(root, 0.13), 0.031, 0.025, m.nylon);
      rounded(body, 0.063, 0.046, 0.178, 0.014, m.rubber, x, 0.0945, sz * 0.367);
      for (const dz of [-0.049, 0, 0.049]) {
        rounded(body, 0.066, 0.014, 0.014, 0.004, m.gasket, x, 0.085, sz * 0.367 + dz);
      }
    }
  }
}

export function addWinch(body: THREE.Group) {
  const m = finishes();
  // The loaded crate top is at y = 0.695 world metres. The hook meets it at rest.
  const hub = new THREE.Group(); body.add(hub);
  hub.position.set(0, 0.564, 0.021);
  for (const sx of [-1, 1]) {
    rounded(hub, 0.025, 0.095, 0.138, 0.012, m.nylon, sx * 0.098, 0.001, 0);
    rod(hub, point(sx * 0.07, 0, 0), point(sx * 0.088, 0, 0), 0.053, 0.053, m.titanium);
  }
  rod(hub, point(-0.071, 0, 0), point(0.071, 0, 0), 0.043, 0.043, m.rubber);
  const coil: THREE.Vector3[] = [];
  for (let j = 0; j <= 120; j++) {
    const a = j * Math.PI / 5;
    coil.push(point(-0.065 + 0.13 * j / 120, 0.044 * Math.cos(a), 0.044 * Math.sin(a)));
  }
  solid(hub, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coil), 192, 0.0045, 7), m.sockets);
  hose(hub, [point(0.064, 0, -0.044), point(0.064, -0.025, -0.047), point(0.046, -0.041, -0.045)], 0.005, m.sockets);
  hose(hub, [point(0.048, -0.035, -0.045), point(0.046, -0.046, -0.045), point(0.037, -0.062, -0.045),
    point(0.019, -0.063, -0.045), point(0.011, -0.048, -0.045)], 0.006, m.titanium);
  rod(hub, point(0.012, -0.049, -0.045), point(0.044, -0.041, -0.045), 0.003, 0.003, m.latch);
}
