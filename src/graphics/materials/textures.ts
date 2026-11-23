import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

let anisotropy = 16;

export function setTextureQuality(renderer: THREE.WebGLRenderer) {
  anisotropy = Math.max(1, renderer.capabilities.getMaxAnisotropy());
}

export function filterTexture<T extends THREE.Texture>(texture: T, space: THREE.ColorSpace, metres?: number) {
  texture.colorSpace = space;
  texture.anisotropy = anisotropy;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  if (metres !== undefined) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.setScalar(1 / metres);
  }
  return texture;
}

/** Share the primary UV buffer for tiled AO, respecting meshes with an authored second unwrap. */
export function withAoUv<G extends THREE.BufferGeometry>(geometry: G): G {
  const uv = geometry.getAttribute('uv');
  if (uv && !geometry.hasAttribute('uv1')) geometry.setAttribute('uv1', uv);
  return geometry;
}

export type Grain = 'grass' | 'enamel' | 'rubber' | 'carbon' | 'plastic' | 'brushed' | 'diffuser' | 'plaster' | 'kraft';
const tileMetres: Record<Grain, number> = {
  grass: 0.24, enamel: 0.078, rubber: 0.045, carbon: 0.032,
  plastic: 0.038, brushed: 0.046, diffuser: 0.048, plaster: 0.31, kraft: 0.076,
};

// Periodic value noise. Integer cell counts make every octave wrap at the tile boundary.
function hash(x: number, y: number) {
  let n = Math.imul(x + 37, 0x85ebca6b) ^ Math.imul(y + 91, 0xc2b2ae35);
  n = Math.imul(n ^ (n >>> 16), 0x27d4eb2d);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
}

function noise(u: number, v: number, nx: number, ny = nx) {
  const x = (u - Math.floor(u)) * nx, y = (v - Math.floor(v)) * ny;
  const i = Math.floor(x), j = Math.floor(y), k = (i + 1) % nx, l = (j + 1) % ny;
  const a = x - i, b = y - j;
  const sx = a * a * (3 - 2 * a), sy = b * b * (3 - 2 * b);
  const lower = THREE.MathUtils.lerp(hash(i, j), hash(k, j), sx);
  const upper = THREE.MathUtils.lerp(hash(i, l), hash(k, l), sx);
  return THREE.MathUtils.lerp(lower, upper, sy);
}

const tau = 2 * Math.PI;
function relief(kind: Grain, u: number, v: number) {
  const grit = noise(u, v, 96), grain = noise(u, v, 38);
  switch (kind) {
    case 'grass': {
      // Short curved blades in tufts. Rotate the local lay over a few centimetres.
      const bend = 0.075 * noise(u, v, 5);
      return 0.75 * noise(u + bend + v, v, 99, 15) + 0.25 * grain;
    }
    case 'carbon': {
      const x = u * 8, y = v * 8;
      const warp = ((Math.floor(x) - Math.floor(y) + 8) % 4) < 2;
      const across = warp ? x : y, along = warp ? y : x;
      const crown = Math.sin(Math.PI * (across % 1));
      const filament = Math.cos(tau * (across * 6 + 0.08 * Math.sin(along * Math.PI)));
      return 0.13 + crown * (0.52 + 0.09 * filament) + (warp ? 0.09 : 0) + 0.05 * grit;
    }
    case 'brushed':
      return 0.65 * noise(u, v, 3, 115) + 0.25 * noise(u, v, 6, 59) + 0.1 * grit;
    case 'diffuser':
      return 0.42 + 0.43 * Math.cos(tau * u * 8) * Math.cos(tau * v * 8) + 0.15 * grit;
    case 'kraft':
      return 0.43 * noise(u + v, v, 19, 93) + 0.18 * noise(u - v, v, 71, 32)
        + 0.27 * grain + 0.12 * Math.sin(tau * u * 12);
    case 'plaster':
      return 0.52 * grain + 0.28 * grit + 0.2 * noise(u, v, 13);
    case 'enamel':
      return 0.72 * noise(u, v, 16) + 0.28 * grain;
    case 'rubber':
      return 0.74 * grain + 0.26 * grit;
    case 'plastic':
      return 0.4 * grain + 0.6 * grit;
  }
}

function makeGrain(kind: Grain) {
  const size = 256, heights = new Float32Array(size * size);
  const rgb = new Uint8Array(size * size * 4), normals = new Uint8Array(rgb.length);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    heights[y * size + x] = relief(kind, x / size, y / size);
  }
  const mask = size - 1;
  const height = (x: number, y: number) => heights[(y & mask) * size + (x & mask)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (x + y * size) * 4;
    const dx = (height(x - 1, y) - height(x + 1, y)) * 1.6;
    const dy = (height(x, y - 1) - height(x, y + 1)) * 1.6;
    const length = Math.hypot(dx, dy, 1);
    normals[i] = Math.round(127.5 * (1 + dx / length));
    normals[i + 1] = Math.round(127.5 * (1 + dy / length));
    normals[i + 2] = Math.round(127.5 * (1 + 1 / length));
    normals[i + 3] = 255;
    // A neutral linear mask modulates the base pigment and its local roughness.
    const h = height(x, y);
    const contrast = kind === 'carbon' ? 0.53 : kind === 'diffuser' ? 0.38 : 0.19;
    rgb[i] = rgb[i + 1] = rgb[i + 2] = Math.round(255 * (1 - contrast + contrast * h));
    rgb[i + 3] = 255;
  }
  function data(bytes: Uint8Array<ArrayBuffer>, suffix: string) {
    const texture = filterTexture(new THREE.DataTexture(bytes, size, size), THREE.NoColorSpace, tileMetres[kind]);
    texture.name = kind + ' ' + suffix;
    texture.needsUpdate = true;
    return texture;
  }
  return { map: data(rgb, 'grain'), normalMap: data(normals, 'relief') };
}

const grains = new Map<Grain, ReturnType<typeof makeGrain>>();

/** Shared, mipmapped linear masks and tangent normals. UV units are metres. */
export function grainMaps(kind: Grain) {
  let maps = grains.get(kind);
  if (!maps) {
    maps = makeGrain(kind);
    grains.set(kind, maps);
  }
  return maps;
}

/** Keep metric/normalized UVs compatible when baking mixed primitives. */
export function mergeCompatible(pieces: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const allUv = pieces.every(g => g.hasAttribute('uv'));
  const faceUvs = pieces.some(g => g.hasAttribute('finishFaceUv'));
  const indexed = pieces.some(g => g.index !== null);
  for (const g of pieces) {
    if (indexed && !g.index) {
      const count = g.getAttribute('position').count;
      const indices = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
      for (let i = 0; i < count; i++) indices[i] = i;
      g.setIndex(new THREE.BufferAttribute(indices, 1));
    }
    if (allUv) withAoUv(g);
    else {
      g.deleteAttribute('uv');
      g.deleteAttribute('uv1');
    }
    if (faceUvs && !g.hasAttribute('finishFaceUv')) {
      // The paint shader falls back to ordinary primitive UVs at this sentinel.
      const count = g.getAttribute('position').count;
      g.setAttribute('finishFaceUv', new THREE.BufferAttribute(new Float32Array(count * 2).fill(-1), 2));
    }
  }
  const merged = mergeGeometries(pieces);
  if (!merged) throw new Error('mergeCompatible: incompatible geometry attributes');
  return merged;
}
