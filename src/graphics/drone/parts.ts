import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { solid } from '../materials';

export const point = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const tau = 2 * Math.PI;

export function rounded(parent: THREE.Object3D, w: number, h: number, d: number, r: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
  return solid(parent, new RoundedBoxGeometry(w, h, d, 3, r), mat, x, y, z);
}

export function turned(parent: THREE.Object3D, profile: [number, number][], mat: THREE.Material, x = 0, y = 0, z = 0) {
  const geometry = new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), 48);
  return solid(parent, geometry, mat, x, y, z);
}

export function rod(parent: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, r1: number, r2: number, mat: THREE.Material) {
  const axis = to.clone().sub(from);
  const geometry = new THREE.CylinderGeometry(r2, r1, axis.length(), 24);
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * tau * (r1 + r2) / 2, uv.getY(i) * axis.length());
  const mesh = solid(parent, geometry, mat);
  mesh.position.copy(from).lerp(to, 0.5);
  mesh.quaternion.setFromUnitVectors(point(0, 1, 0), axis.normalize());
  return mesh;
}

export function hose(parent: THREE.Object3D, points: THREE.Vector3[], radius: number, mat: THREE.Material) {
  const curve = new THREE.CatmullRomCurve3(points);
  return solid(parent, new THREE.TubeGeometry(curve, points.length * 5, radius, 10, false), mat);
}

// A flanged head with a recessed six-lobe drive, including the walls of the socket.
const screwGeometry = (() => {
  const xyz: number[] = [], index: number[] = [];
  const sides = 48;
  for (const [radius, height, socket] of [[1, -0.15, 0], [1, 0.04, 0], [0.84, 0.22, 0], [0.42, 0.22, 1], [0.37, -0.08, 1], [0, -0.08, 0]]) {
    for (let i = 0; i < sides; i++) {
      const a = tau * i / sides;
      const r = radius * (1 + socket * 0.17 * Math.cos(6 * a));
      xyz.push(r * Math.sin(a), height, r * Math.cos(a));
    }
  }
  for (let ring = 0; ring < 5; ring++) for (let i = 0; i < sides; i++) {
    const a = ring * sides + i, b = ring * sides + (i + 1) % sides;
    index.push(a, b, a + sides, b, b + sides, a + sides);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(xyz, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
})();

export function screw(parent: THREE.Object3D, x: number, y: number, z: number, r: number, mat: THREE.Material) {
  const head = solid(parent, screwGeometry, mat, x, y, z);
  head.scale.setScalar(r);
  return head;
}

// Parts in these groups are rigid. Bake them in group-local space, leaving the motor,
// switchable blades, blur layer and battery bar independently addressable by World.
export function batchRigidParts(group: THREE.Group) {
  group.updateWorldMatrix(true, true);
  const toLocal = group.matrixWorld.clone().invert();
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  group.traverse(part => {
    if (!(part instanceof THREE.Mesh)) return;
    const geometry = part.geometry.clone();
    // Preserve the shared vertices on the windings and other turned parts when
    // mixing them with the unindexed geometry of a rounded injection molding.
    if (!geometry.index) {
      geometry.setIndex(Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i));
    }
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toLocal, part.matrixWorld));
    const parts = batches.get(part.material);
    if (parts) parts.push(geometry);
    else batches.set(part.material, [geometry]);
  });
  group.clear();
  for (const [material, parts] of batches) {
    // Socket heads have no texture coordinates. The rest of their metal batch may have UVs.
    for (const geometry of parts) {
      if (!geometry.hasAttribute('uv')) {
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(2 * geometry.getAttribute('position').count), 2));
      }
    }
    solid(group, mergeGeometries(parts), material);
  }
}
