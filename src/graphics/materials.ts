import * as THREE from 'three';
import { filterTexture, setTextureQuality, withAoUv } from './materials/textures';
import { TiledMaterial } from './materials/tiled';

export { mergeCompatible, withAoUv } from './materials/textures';
export {
  brushedAluminium, carbonFibre, cardboard, emissiveLedPanel, glossPlastic, mattePlastic,
  paintedSteel, rubber, tintedWindowGlass, weatheredPaintOverConcrete,
} from './materials/presets';

export const KO_FONT = "'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', system-ui, sans-serif";
// Translucent rotor blur draws in the beauty pass and contributes no surface depth.
export const ROTOR_BLUR_LAYER = 1;
export const DRONE_COLORS = [0xff8a3d, 0x3dd6ff];

export function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  return filterTexture(new THREE.CanvasTexture(canvas), THREE.SRGBColorSpace);
}

export function ink(options: THREE.MeshBasicMaterialParameters) {
  return new THREE.MeshBasicMaterial({ toneMapped: false, fog: false, ...options });
}

export function finish(color: number, roughness = 0.65, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

export function lamp(color: number, intensity: number) {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.28 });
}

// Project in metres so a sheet of steel has the same grain on a shelf edge and a hangar door.
export function boxGeo(w: number, h: number, d: number) {
  const geometry = new THREE.BoxGeometry(w, h, d);
  const uv = geometry.getAttribute('uv');
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < uv.count; i++) {
    const side = Math.abs(normal.getX(i)) > 0.5;
    const cap = Math.abs(normal.getY(i)) > 0.5;
    uv.setXY(i, uv.getX(i) * (side ? d : w), uv.getY(i) * (cap ? d : h));
  }
  return withAoUv(geometry);
}

export function planeGeo(w: number, h: number) {
  const geometry = new THREE.PlaneGeometry(w, h);
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
  return withAoUv(geometry);
}

// Retain the true face borders for chipped paint even when the UVs span several metres.
function preparePaintFaces(geometry: THREE.BufferGeometry) {
  if (geometry.hasAttribute('finishFaceUv') ||
      !(geometry instanceof THREE.BoxGeometry || geometry instanceof THREE.PlaneGeometry)) return;
  const uv = geometry.getAttribute('uv');
  const faceUv = new THREE.Float32BufferAttribute(new Float32Array(uv.count * 2), 2);
  const index = geometry.index;
  for (const group of geometry.groups.length ? geometry.groups : [{ start: 0, count: index?.count ?? uv.count }]) {
    const bounds = new THREE.Box2(), point = new THREE.Vector2();
    const end = group.start + group.count;
    for (let i = group.start; i < end; i++) {
      const j = index ? index.getX(i) : i;
      bounds.expandByPoint(point.set(uv.getX(j), uv.getY(j)));
    }
    const size = bounds.getSize(point);
    for (let i = group.start; i < end; i++) {
      const j = index ? index.getX(i) : i;
      faceUv.setXY(j, (uv.getX(j) - bounds.min.x) / (size.x || 1), (uv.getY(j) - bounds.min.y) / (size.y || 1));
    }
  }
  geometry.setAttribute('finishFaceUv', faceUv);
}

export function solid<G extends THREE.BufferGeometry, M extends THREE.Material>(
  parent: THREE.Object3D, geometry: G, material: M, x = 0, y = 0, z = 0,
) {
  if (material instanceof TiledMaterial && material.profile === 'paintedSteel') preparePaintFaces(geometry);
  const mesh = new THREE.Mesh(withAoUv(geometry), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function box(parent: THREE.Object3D, w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number) {
  return solid(parent, boxGeo(w, h, d), material, x, y, z);
}

export function groundPlane(parent: THREE.Object3D, w: number, d: number, material: THREE.Material, x: number, y: number, z: number) {
  const mesh = solid(parent, planeGeo(w, d), material, x, y, z);
  mesh.rotation.x = -Math.PI / 2;
  mesh.castShadow = false;
  return mesh;
}

export function strut(parent: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, radius: number, material: THREE.Material) {
  const axis = to.clone().sub(from);
  const length = axis.length();
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 12);
  if (material instanceof TiledMaterial) {
    const uv = geometry.getAttribute('uv'), normals = geometry.getAttribute('normal');
    for (let i = 0; i < uv.count; i++) {
      const cap = Math.abs(normals.getY(i)) > 0.5;
      uv.setXY(i, uv.getX(i) * radius * (cap ? 2 : 2 * Math.PI), uv.getY(i) * (cap ? 2 * radius : length));
    }
  }
  const mesh = solid(parent, geometry, material);
  mesh.position.copy(from).lerp(to, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
  return mesh;
}

export function surfaces(renderer: THREE.WebGLRenderer) {
  setTextureQuality(renderer);
  const loader = new THREE.ImageLoader();

  function scan(profile: TiledMaterial['profile'], name: string, metres: number, normalStrength: number, fallback: number): THREE.MeshStandardMaterial {
    function maps(suffix: string, pixel: number, channels: number[]) {
      const swatch = document.createElement('canvas');
      swatch.width = swatch.height = 1;
      const g = swatch.getContext('2d')!;
      g.fillStyle = '#' + pixel.toString(16).padStart(6, '0');
      g.fillRect(0, 0, 1, 1);
      const space = suffix === 'diff' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      const primary = filterTexture(new THREE.CanvasTexture(swatch), space, metres);
      const views = channels.map((channel, i) => {
        const view = i === 0 ? primary : primary.clone();
        view.name = name + '_' + suffix;
        view.channel = channel;
        return view;
      });
      loader.load('/assets/textures/' + name + '_' + suffix + '.jpg', image => {
        // Release the 1px allocation before uploading a differently sized image.
        // The AO and ORM views share a Source and GPU texture. Early material clones
        // also hold these same views and see the scan arrive.
        for (const view of views) view.dispose();
        primary.image = image;
        for (const view of views) view.needsUpdate = true;
      });
      return views;
    }

    const [map] = maps('diff', fallback, [0]);
    const [normalMap] = maps('nor', 0x8080ff, [0]);
    const [arm, aoMap] = maps('arm', 0xffc800, [0, 1]);
    const material = new TiledMaterial(profile, {
      name, map, normalMap, roughnessMap: arm, metalnessMap: arm, aoMap,
      roughness: 1, metalness: 1, aoMapIntensity: 0.76,
    });
    material.normalScale.setScalar(normalStrength);
    return material;
  }
  return {
    grass: scan('grass', 'aerial_grass_rock', 9.6, 0.80, 0x7b844d),
    asphalt: scan('asphalt', 'asphalt_02', 3.2, 0.70, 0x555652),
    floor: scan('floor', 'concrete_floor_02', 3.8, 0.51, 0x96958b),
    wood: scan('wood', 'plywood', 0.92, 0.52, 0xb38b62),
    metal: scan('plate', 'metal_plate', 0.72, 0.57, 0x818783),
    wall: scan('wall', 'concrete_wall_008', 4.8, 0.74, 0xc9c4b6),
    iron: scan('iron', 'corrugated_iron_02', 2.2, 0.77, 0xa1a5a2),
  };
}

export type Surfaces = ReturnType<typeof surfaces>;

export function seeded(seed: number) {
  return () => (seed = seed * 16807 % 2147483647) / 2147483647;
}
