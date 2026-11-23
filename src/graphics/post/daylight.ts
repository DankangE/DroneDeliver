import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { skyBackground } from './photography';

const yaw = -1.35;
const up = new THREE.Vector3(0, 1, 0);
// Measured solar disc centre in the unrotated Kloofendal panorama.
export const sunDirection = new THREE.Vector3(0.55456, 0.74198, 0.37673).normalize().applyAxisAngle(up, yaw);
const horizonColor = new THREE.Color().setRGB(0.412, 0.446, 0.539);
const horizonSectors = 64;
const { fromHalfFloat, toHalfFloat } = THREE.DataUtils;

export function daylight(
  camera: THREE.PerspectiveCamera, scene: THREE.Scene, sun: THREE.DirectionalLight, hdrSupported: boolean,
) {
  scene.background = horizonColor;
  const fill = new THREE.HemisphereLight(0xdbeaff, 0xa59a7b, 1.1);
  scene.add(fill);
  if (!hdrSupported) return null;

  const strip = new Uint16Array(horizonSectors * 4);
  for (let i = 0; i < strip.length; i += 4) {
    strip.set([toHalfFloat(horizonColor.r), toHalfFloat(horizonColor.g), toHalfFloat(horizonColor.b), toHalfFloat(1)], i);
  }
  const horizon = new THREE.DataTexture(strip, horizonSectors, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  horizon.wrapS = THREE.RepeatWrapping;
  horizon.minFilter = horizon.magFilter = THREE.LinearFilter;
  horizon.needsUpdate = true;
  // r170 keys CubeUV programs by atlas height. A constant one-texel-wide
  // column gives a valid black lookup at every UV, with the final 2K atlas
  // height, so the HDR upload only changes a uniform on the first lit frame.
  const atlasHeight = 2048;
  const initialEnvironment = new THREE.DataTexture(new Uint8Array(atlasHeight * 4), 1, atlasHeight);
  initialEnvironment.mapping = THREE.CubeUVReflectionMapping;
  initialEnvironment.needsUpdate = true;
  scene.environment = initialEnvironment;
  scene.environmentRotation.y = yaw;

  async function loadEnvironment() {
    const response = await fetch('/assets/hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr');
    if (!response.ok) throw new Error(`HDR request failed (${response.status})`);
    const buffer = await response.arrayBuffer();
    const { width, height, data } = new RGBELoader().setDataType(THREE.HalfFloatType).parse(buffer);
    // The r170 type declaration omits the Uint16Array returned for HalfFloatType.
    const pixels = data as unknown as Uint16Array<ArrayBuffer>;
    if (!width || !height || pixels.length !== width * height * 4) {
      throw new Error('Invalid HDR pixel data');
    }
    // Integrate a low, broad band of the photographed sky in each azimuth sector.
    // Rotate the lookup into world space here so the airlight needs no per-frame transform.
    for (let sector = 0; sector < horizonSectors; sector++) {
      const sum = new THREE.Vector3();
      let weight = 0;
      const u = (sector + 0.5) / horizonSectors + yaw / (2 * Math.PI);
      for (let dx = -10; dx <= 10; dx++) {
        const x = THREE.MathUtils.euclideanModulo(Math.floor(u * width) + dx * 6, width);
        const w = 11 - Math.abs(dx);
        for (let elevation = 1; elevation <= 6; elevation++) {
          const y = Math.floor((0.5 - elevation / 180) * height);
          const i = (y * width + x) * 4;
          sum.x += w * fromHalfFloat(pixels[i]);
          sum.y += w * fromHalfFloat(pixels[i + 1]);
          sum.z += w * fromHalfFloat(pixels[i + 2]);
          weight += w;
        }
      }
      strip.set([toHalfFloat(sum.x / weight), toHalfFloat(sum.y / weight), toHalfFloat(sum.z / weight)], sector * 4);
    }
    horizon.needsUpdate = true;

    // Transfer the narrow solar peak to the shadow-casting light. Integrating
    // removed RGB radiance over solid angle retains the capture's sun/sky ratio.
    const direct = new THREE.Color(0, 0, 0);
    const cap = 14, halfCap = toHalfFloat(cap);
    const solidAngle = 2 * Math.PI * Math.PI / (width * height);
    for (let y = 0; y < height / 2; y++) {
      const omega = solidAngle * Math.sin(Math.PI * (y + 0.5) / height);
      for (let x = 0; x < width; x++) {
        const i = 4 * (y * width + x);
        const peak = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
        if (peak <= halfCap) continue;
        const scale = cap / fromHalfFloat(peak);
        const r = fromHalfFloat(pixels[i]), g = fromHalfFloat(pixels[i + 1]), b = fromHalfFloat(pixels[i + 2]);
        direct.r += r * (1 - scale) * omega;
        direct.g += g * (1 - scale) * omega;
        direct.b += b * (1 - scale) * omega;
        pixels[i] = toHalfFloat(r * scale);
        pixels[i + 1] = toHalfFloat(g * scale);
        pixels[i + 2] = toHalfFloat(b * scale);
      }
    }
    const energy = Math.max(direct.r, direct.g, direct.b);
    if (energy > 0) {
      sun.intensity = energy;
      sun.color.copy(direct).multiplyScalar(1 / energy);
    }

    // This pure-sky capture has mirrored clouds underfoot. For IBL, give the
    // downward hemisphere diffuse ground radiance with a gradual horizon transition.
    const ground = new THREE.Color().setRGB(0.17, 0.145, 0.10);
    const groundStart = Math.ceil(height * (0.5 + 18 / 180));
    for (let y = Math.floor(height / 2); y < groundStart; y++) {
      const t = THREE.MathUtils.smoothstep((y / height - 0.5) * 180, 0, 18);
      for (let x = 0; x < width; x++) {
        const i = 4 * (y * width + x);
        pixels[i] = toHalfFloat(THREE.MathUtils.lerp(fromHalfFloat(pixels[i]), ground.r, t));
        pixels[i + 1] = toHalfFloat(THREE.MathUtils.lerp(fromHalfFloat(pixels[i + 1]), ground.g, t));
        pixels[i + 2] = toHalfFloat(THREE.MathUtils.lerp(fromHalfFloat(pixels[i + 2]), ground.b, t));
      }
    }
    // Below the blend band all rows have identical ground radiance.
    const stride = width * 4, start = groundStart * stride;
    const groundPixel = [toHalfFloat(ground.r), toHalfFloat(ground.g), toHalfFloat(ground.b), toHalfFloat(1)];
    for (let i = start; i < start + stride; i += 4) pixels.set(groundPixel, i);
    for (let i = start + stride; i < pixels.length; i += stride) pixels.copyWithin(i, start, start + stride);
    const sky = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
    sky.colorSpace = THREE.LinearSRGBColorSpace;
    sky.minFilter = sky.magFilter = THREE.LinearFilter;
    sky.flipY = true;
    sky.wrapS = THREE.RepeatWrapping;
    sky.mapping = THREE.EquirectangularReflectionMapping;
    sky.needsUpdate = true;
    // Three rebuilds its PMREM cache from this CPU-backed source after context restoration.
    scene.environment = sky;
    initialEnvironment.dispose();
    scene.add(skyBackground(camera, sky, horizon, yaw));
    fill.intensity = 0;
  }
  loadEnvironment().catch(error => console.warn('Could not load daylight HDR', error));
  return horizon;
}
