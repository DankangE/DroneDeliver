import * as THREE from 'three';
import type { TierSettings } from './quality';

export type Point = { x: number; z: number };
export type Lot = Point & { radius: number };
const up = new THREE.Vector3(0, 1, 0);
export const unit = new THREE.BoxGeometry();
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
export const cellAt = (x: number, z: number, size = 110) => Math.floor(x / size) + '/' + Math.floor(z / size);
export const pick = <T,>(values: T[], random: () => number) => values[Math.floor(random() * values.length)];

// Unit boxes carry normalized UVs. Their physical face dimensions live in the
// instance transform, so a kerb joint and a twenty-metre parapet keep the same grain.
function metricBoxMaterial(source: THREE.MeshStandardMaterial) {
  const material = source.clone();
  const before = source.onBeforeCompile, key = source.customProgramCacheKey.bind(source);
  material.customProgramCacheKey = () => key() + '/metric-box';
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

interface FoliageLevels {
  near: THREE.InstancedMesh;
  far: THREE.InstancedMesh;
  full: THREE.BufferGeometry;
  reduced: THREE.BufferGeometry;
  silhouette: THREE.BufferGeometry;
}

class BatchLOD extends THREE.LOD {
  constructor(private boundsRadius: number, private foliage?: FoliageLevels) {
    super();
  }

  setQuality(settings: TierSettings) {
    if (this.foliage) {
      const { near, far, full, reduced, silhouette } = this.foliage;
      near.geometry = settings.fullFoliage ? full : reduced;
      far.geometry = settings.fullFoliage ? reduced : silhouette;
    }
    const distance = this.foliage ? settings.foliageDetail : settings.streetDetail;
    this.levels[1].distance = distance === 0 ? 0 : this.boundsRadius + distance;
  }
}

export class TerrainBatches {
  private readonly batches: { root: THREE.Object3D; bounds: THREE.Sphere; caster?: THREE.Mesh }[] = [];
  private readonly lods: BatchLOD[] = [];
  private readonly lastEye = new THREE.Vector3(Infinity, Infinity, Infinity);

  constructor(roots: THREE.Object3D[]) {
    for (const root of roots) {
      root.updateMatrixWorld(true);
      root.traverse(part => {
        part.matrixAutoUpdate = false;
        part.matrixWorldAutoUpdate = false;
      });
      if (root instanceof BatchLOD) this.lods.push(root);
      const mesh = root instanceof BatchLOD ? root.levels[0].object : root;
      if (!(mesh instanceof THREE.Mesh || mesh instanceof THREE.LineSegments)) continue;
      const source = mesh instanceof THREE.InstancedMesh ? mesh : mesh.geometry;
      if (!source.boundingSphere) source.computeBoundingSphere();
      const bounds = source.boundingSphere!.clone().applyMatrix4(mesh.matrixWorld);
      this.batches.push({ root, bounds, caster: mesh instanceof THREE.Mesh && mesh.castShadow ? mesh : undefined });
    }
  }

  setQuality(settings: TierSettings) {
    for (const lod of this.lods) lod.setQuality(settings);
    this.lastEye.set(Infinity, Infinity, Infinity);
  }

  update(eye: THREE.Vector3, settings: TierSettings) {
    if (eye.distanceToSquared(this.lastEye) < 4) return;
    this.lastEye.copy(eye);
    for (const { root, bounds, caster } of this.batches) {
      const distanceSq = eye.distanceToSquared(bounds.center);
      root.visible = distanceSq <= (settings.far + bounds.radius + 2) ** 2;
      if (caster) caster.castShadow = distanceSq <= (settings.terrainShadowDistance + bounds.radius) ** 2;
    }
  }
}

// Spatial batches let the sun's small shadow frustum discard entire blocks at once.
export class Instances {
  private cells = new Map<string, { matrix: THREE.Matrix4; tint: number }[]>();
  constructor(private geometry: THREE.BufferGeometry, private material: THREE.Material, private distantGeometry?: THREE.BufferGeometry,
    private silhouette?: THREE.BufferGeometry) {
    if (geometry === unit && material instanceof THREE.MeshStandardMaterial && material.map?.wrapS === THREE.RepeatWrapping) {
      this.material = metricBoxMaterial(material);
    }
  }

  private put(position: THREE.Vector3, rotation: THREE.Quaternion, scale: THREE.Vector3, tint: number) {
    const key = cellAt(position.x, position.z, this.geometry instanceof THREE.PlaneGeometry ? 165 : 110);
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

  build(scene: THREE.Scene, castShadow = true, cullDetail = false) {
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
      if (this.distantGeometry || cullDetail) {
        const bounds = mesh.boundingSphere!;
        let foliage: FoliageLevels | undefined;
        mesh.position.copy(bounds.center).negate();
        if (this.distantGeometry) {
          const far = new THREE.InstancedMesh(this.distantGeometry, this.material, 0);
          far.count = mesh.count;
          far.instanceMatrix = mesh.instanceMatrix;
          far.instanceColor = mesh.instanceColor;
          far.boundingSphere = bounds;
          far.receiveShadow = true;
          far.position.copy(mesh.position);
          foliage = { near: mesh, far, full: this.geometry, reduced: this.distantGeometry,
            silhouette: this.silhouette ?? this.distantGeometry };
        }
        const lod = new BatchLOD(bounds.radius, foliage);
        lod.position.copy(bounds.center);
        lod.addLevel(mesh, 0);
        lod.addLevel(foliage?.far ?? new THREE.Object3D(), Infinity, 0.08);
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
