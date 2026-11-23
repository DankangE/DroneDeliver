import * as THREE from 'three';

export const KO_FONT = "'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', system-ui, sans-serif";
// Translucent rotor blur draws in the beauty pass and contributes no surface depth.
export const ROTOR_BLUR_LAYER = 1;
export const DRONE_COLORS = [0xff8a3d, 0x3dd6ff];

export function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
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
  return geometry;
}

export function planeGeo(w: number, h: number) {
  const geometry = new THREE.PlaneGeometry(w, h);
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
  return geometry;
}

export function solid<G extends THREE.BufferGeometry, M extends THREE.Material>(
  parent: THREE.Object3D, geometry: G, material: M, x = 0, y = 0, z = 0,
) {
  const mesh = new THREE.Mesh(geometry, material);
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
  const mesh = solid(parent, new THREE.CylinderGeometry(radius, radius, axis.length(), 12), material);
  mesh.position.copy(from).lerp(to, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
  return mesh;
}

export function surfaces(renderer: THREE.WebGLRenderer) {
  const loader = new THREE.TextureLoader();
  const anisotropy = renderer.capabilities.getMaxAnisotropy();
  function scan(name: string, metres: number, normalStrength: number, fallback: number, tint = 0xffffff) {
    const material = finish(fallback);
    material.name = name;
    material.normalScale.setScalar(normalStrength);
    material.aoMapIntensity = 0.82;
    function load(suffix: string, assign: (texture: THREE.Texture) => void) {
      loader.load('/assets/textures/' + name + '_' + suffix + '.jpg', texture => {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.setScalar(1 / metres);
        texture.anisotropy = anisotropy;
        texture.colorSpace = suffix === 'diff' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        assign(texture);
        material.needsUpdate = true;
      });
    }
    load('diff', texture => { material.map = texture; material.color.setHex(tint); });
    load('nor', texture => { material.normalMap = texture; });
    load('arm', texture => {
      // r170 routes all three packed map samplers to TEXCOORD_0 via Texture.channel.
      texture.channel = 0;
      material.aoMap = material.roughnessMap = material.metalnessMap = texture;
      material.roughness = material.metalness = 1;
    });
    return material;
  }
  return {
    grass: scan('aerial_grass_rock', 13, 0.85, 0x7b844d),
    asphalt: scan('asphalt_02', 3.8, 0.62, 0x505351),
    floor: scan('concrete_floor_02', 3.2, 0.6, 0x96958b),
    wood: scan('plywood', 1.15, 0.72, 0xc89b67),
    metal: scan('metal_plate', 1.35, 0.55, 0x818783),
    wall: scan('concrete_wall_008', 4.5, 0.75, 0xc9c4b6),
    iron: scan('corrugated_iron_02', 2.6, 0.88, 0xa1a5a2),
  };
}

export type Surfaces = ReturnType<typeof surfaces>;

export function seeded(seed: number) {
  return () => (seed = seed * 16807 % 2147483647) / 2147483647;
}
