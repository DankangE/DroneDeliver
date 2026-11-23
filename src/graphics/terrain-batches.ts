import * as THREE from 'three';

export type Point = { x: number; z: number };
export type Lot = Point & { radius: number };
const up = new THREE.Vector3(0, 1, 0);
export const unit = new THREE.BoxGeometry();
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
export const cellAt = (x: number, z: number) => Math.floor(x / 110) + '/' + Math.floor(z / 110);
export const pick = <T,>(values: T[], random: () => number) => values[Math.floor(random() * values.length)];

// Unit boxes carry normalized UVs. Their physical face dimensions live in the
// instance transform, so a kerb joint and a twenty-metre parapet keep the same grain.
function metricBoxMaterial(source: THREE.MeshStandardMaterial) {
  const material = source.clone();
  const before = source.onBeforeCompile, key = source.customProgramCacheKey();
  material.customProgramCacheKey = () => key + '/metric-box';
  material.onBeforeCompile = function(shader, renderer) {
    before.call(this, shader, renderer);
    const uv = THREE.ShaderChunk.uv_vertex.replaceAll(/vec3\( (\w+_UV), 1 \)/g, 'vec3( $1 * faceMetres, 1 )');
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `
      vec3 extent = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
      vec2 faceMetres = abs(normal.x) > 0.5 ? extent.zy : (abs(normal.y) > 0.5 ? extent.xz : extent.xy);
      ${uv}`);
  };
  return material;
}

// Spatial batches let the sun's small shadow frustum discard entire blocks at once.
export class Instances {
  private cells = new Map<string, { matrix: THREE.Matrix4; tint: number }[]>();
  constructor(private geometry: THREE.BufferGeometry, private material: THREE.Material, private distantGeometry?: THREE.BufferGeometry) {
    if (geometry === unit && material instanceof THREE.MeshStandardMaterial && material.map?.wrapS === THREE.RepeatWrapping) {
      this.material = metricBoxMaterial(material);
    }
  }

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
      if (this.distantGeometry) {
        // Keep every shoot within 80 m. Beyond the cell the alternate canopy
        // keeps the same lobes and drops subpixel leaves. Both use the same transforms.
        const bounds = mesh.boundingSphere!;
        const lod = new THREE.LOD();
        lod.position.copy(bounds.center);
        mesh.position.copy(bounds.center).negate();
        const far = new THREE.InstancedMesh(this.distantGeometry, this.material, 0);
        far.count = mesh.count;
        far.instanceMatrix = mesh.instanceMatrix;
        far.instanceColor = mesh.instanceColor;
        far.boundingSphere = bounds;
        far.castShadow = castShadow;
        far.receiveShadow = true;
        far.position.copy(mesh.position);
        lod.addLevel(mesh, 0);
        lod.addLevel(far, bounds.radius + 80, 0.10);
        scene.add(lod);
      } else {
        scene.add(mesh);
      }
    }
    this.cells.clear();
  }
}

// A street, doorway or balcony can use the same local frontage coordinates.
export class Frame {
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

export type Street = { frame: Frame; length: number; width: number; startTrim: number; endTrim: number; axisX: boolean };
