import * as THREE from 'three';
import { canvasTex, finish, KO_FONT, seeded } from '../materials';
import { tau } from './parts';

function tile(data: Uint8Array<ArrayBuffer>, size: number, srgb = false) {
  const texture = new THREE.DataTexture(data, size, size);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.setScalar(27);
  texture.anisotropy = 8;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function carbonLaminate() {
  const size = 256, albedo = new Uint8Array(size * size * 4);
  const normal = albedo.slice(), roughness = albedo.slice(), height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // In a 2/2 twill each tow passes over two and under two. Shift the crossing
    // by one on the next row so that highlights follow the diagonal wale.
    const u = 8 * (x + y) / size + 8, v = 8 * (y - x) / size + 8;
    const warp = ((Math.floor(u) - Math.floor(v) + 32) % 4) < 2;
    const across = warp ? u : v, along = warp ? v : u;
    const crown = Math.pow(Math.max(0, Math.sin(Math.PI * (across % 1))), 0.55);
    const fibre = Math.cos(tau * 5 * across + 0.3 * Math.sin(tau * along / 2));
    const p = y * size + x;
    height[p] = crown * (0.74 + 0.16 * Math.cos(Math.PI * (along - Math.floor(across)))) + 0.055 * fibre;
    const value = 37 + crown * (warp ? 17 : 8) + fibre * 2;
    albedo.set([value, value + 3, value + 5, 255], 4 * p);
    roughness.set([0, 143 + (warp ? -11 : 9) - fibre * 7, 0, 255], 4 * p);
  }
  const sample = (x: number, y: number) => height[((y + size) % size) * size + (x + size) % size];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (sample(x - 1, y) - sample(x + 1, y)) * 1.7;
    const dy = (sample(x, y - 1) - sample(x, y + 1)) * 1.7;
    const length = Math.hypot(dx, dy, 1);
    normal.set([127.5 + dx * 127.5 / length, 127.5 + dy * 127.5 / length, 127.5 + 127.5 / length, 255], 4 * (y * size + x));
  }
  return new THREE.MeshPhysicalMaterial({
    map: tile(albedo, size, true), normalMap: tile(normal, size), roughnessMap: tile(roughness, size),
    roughness: 0.9, clearcoat: 0.43, clearcoatRoughness: 0.27,
  });
}

function makeFinishes() {
  const rnd = seeded(256), size = 128, grain = new Uint8Array(size * size * 4);
  for (let i = 0; i < grain.length; i += 4) {
    const value = 65 + rnd() * 126;
    grain.set([value, value, value, 255], i);
  }
  const texture = tile(grain, size);
  texture.repeat.setScalar(3);
  const nylon = new THREE.MeshStandardMaterial({ color: 0x333c3e, roughness: 0.55, bumpMap: texture, bumpScale: 0.00023 });
  const shell = new THREE.MeshPhysicalMaterial({
    color: 0xc7c8be, roughness: 0.45, clearcoat: 0.18, clearcoatRoughness: 0.38,
    bumpMap: texture, bumpScale: 0.00014,
  });
  return {
    carbon: carbonLaminate(), nylon, shell,
    gasket: finish(0x191e20, 0.85), rubber: finish(0x262a2a, 0.91),
    anodized: finish(0x424b4d, 0.31, 0.78), titanium: finish(0x9a9e9a, 0.32, 0.86),
    sockets: finish(0x686d6c, 0.36, 0.83), copper: finish(0xb86534, 0.31, 0.72),
    brass: finish(0xc9a567, 0.28, 0.77), latch: finish(0xb35737, 0.55),
  };
}

let shared: ReturnType<typeof makeFinishes> | undefined;
export function finishes() {
  return shared ??= makeFinishes();
}

export function paintedDeck(team: number, serial: string) {
  // The molded cover uses plan-projected UVs spanning 1 x 1.32 local units.
  const map = canvasTex(1024, 1280, g => {
    g.fillStyle = '#cecec4';
    g.fillRect(0, 0, 1024, 1280);
    const rnd = seeded(75);
    for (let i = 0; i < 3400; i++) {
      g.fillStyle = i % 2 ? 'rgba(82,78,65,.046)' : 'rgba(252,248,225,.12)';
      g.fillRect(rnd() * 1024, rnd() * 1280, 1 + rnd() * 1.7, 1);
    }
    // A swept field and hairline are screen printed onto the cover under the clear coat.
    const ribbon = (offset: number, width: number, paint: string) => {
      g.save(); g.translate(offset, 0);
      g.beginPath(); g.moveTo(370, 0); g.lineTo(370 + width, 0);
      g.bezierCurveTo(251 + width, 395, 174 + width, 679, 177 + width, 1280);
      g.lineTo(177, 1280); g.bezierCurveTo(174, 679, 251, 395, 370, 0);
      g.closePath(); g.fillStyle = paint; g.fill(); g.restore();
    };
    ribbon(-105, 106, new THREE.Color(team).getStyle());
    ribbon(18, 9, '#344344');
    g.fillStyle = '#273638';
    g.textAlign = 'center';
    g.font = `800 173px ${KO_FONT}`; g.fillText(serial, 556, 525);
    g.font = `bold 32px ${KO_FONT}`; g.fillText('하늘길 택배', 556, 578);
    // Localized rub marks around the leading shoulder and the removable pack.
    for (const [cx, cy] of [[270, 224], [740, 230], [181, 712], [655, 903], [324, 1047]]) {
      const grime = g.createRadialGradient(cx, cy, 4, cx, cy, 68);
      grime.addColorStop(0, 'rgba(94,83,61,.073)'); grime.addColorStop(1, 'rgba(94,83,61,0)');
      g.fillStyle = grime; g.fillRect(cx - 68, cy - 68, 136, 136);
      for (let i = 0; i < 14; i++) {
        const x = cx + (rnd() - 0.5) * 68, y = cy + (rnd() - 0.5) * 95;
        g.strokeStyle = i % 3 ? 'rgba(90,88,77,.15)' : 'rgba(246,242,227,.52)';
        g.lineWidth = 0.8 + rnd(); g.beginPath(); g.moveTo(x, y);
        g.lineTo(x + rnd() * 10 + 1, y - rnd() * 7); g.stroke();
      }
    }
  });
  const paint = finishes().shell.clone();
  paint.map = map;
  paint.color.setHex(0xffffff);
  return paint;
}

export function batteryPlate() {
  const map = canvasTex(512, 448, g => {
    g.fillStyle = '#bfc2b9'; g.fillRect(0, 0, 512, 448);
    g.fillStyle = '#293333'; g.fillRect(0, 0, 512, 100);
    g.fillStyle = '#ecebda'; g.font = `bold 46px ${KO_FONT}`; g.fillText('비행 전지', 24, 66);
    g.textAlign = 'right'; g.font = `bold 36px ${KO_FONT}`; g.fillText('B–06', 484, 65); g.textAlign = 'left';
    g.fillStyle = '#252e2e'; g.font = `bold 63px ${KO_FONT}`; g.fillText('48 V', 23, 179);
    g.font = `bold 32px ${KO_FONT}`; g.fillText('교환형 배터리', 24, 227);
    g.fillRect(24, 249, 464, 3);
    g.font = `27px ${KO_FONT}`; g.fillText('단자 접촉 주의', 24, 301);
    let x = 24;
    const rnd = seeded(810);
    while (x < 322) {
      const width = 2 + Math.floor(rnd() * 6);
      g.fillRect(x, 337, width, 72); x += width + 2 + Math.floor(rnd() * 4);
    }
    g.strokeStyle = '#384342'; g.lineWidth = 7; g.beginPath();
    g.moveTo(420, 323); g.lineTo(468, 406); g.lineTo(372, 406); g.closePath(); g.stroke();
    g.fillRect(416, 349, 8, 31); g.fillRect(416, 389, 8, 8);
  });
  return new THREE.MeshStandardMaterial({ map, roughness: 0.61, metalness: 0.12 });
}
