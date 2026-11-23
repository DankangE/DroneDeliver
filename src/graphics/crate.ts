import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { DESTINATIONS } from '../config';
import { KO_FONT, box, canvasTex, finish, seeded, solid, type Surfaces } from './materials';

const boardStock = new Map<boolean, THREE.MeshStandardMaterial>();
let packingTape: THREE.MeshPhysicalMaterial | undefined;

function kraftBoard(pale: boolean) {
  const stock = boardStock.get(pale);
  if (stock) return stock;
  const random = seeded(pale ? 5723 : 8531);
  const map = canvasTex(512, 512, g => {
    const pixels = g.createImageData(512, 512);
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      const i = (512 * y + x) * 4;
      const grain = random() * 11 + 1.8 * Math.sin(x * 0.69) + 1.5 * Math.sin(y / 37 + x / 58);
      const edge = Math.min(x, y, 511 - x, 511 - y);
      const crease = Math.max(0, 1 - edge / 9) * 13;
      pixels.data[i] = (pale ? 188 : 164) + grain - crease;
      pixels.data[i + 1] = (pale ? 145 : 119) + grain - crease;
      pixels.data[i + 2] = (pale ? 94 : 73) + grain - crease;
      pixels.data[i + 3] = 255;
    }
    g.putImageData(pixels, 0, 0);
    for (let n = 0; n < 3600; n++) {
      g.fillStyle = n % 3 ? 'rgba(85,62,36,.14)' : 'rgba(253,239,205,.35)';
      g.fillRect(random() * 512, random() * 512, 0.5 + random() * 2.8, 0.65);
    }
  });
  const material = new THREE.MeshStandardMaterial({ map, bumpMap: map, bumpScale: 0.00065, roughness: 0.94 });
  boardStock.set(pale, material);
  return material;
}

function tapeMaterial() {
  const map = canvasTex(128, 256, g => {
    g.fillStyle = '#ab804f'; g.fillRect(0, 0, 128, 256);
    const rnd = seeded(113);
    for (let i = 0; i < 100; i++) {
      g.strokeStyle = i % 4 ? 'rgba(107,75,38,.11)' : 'rgba(255,223,170,.3)';
      const y = rnd() * 256, x = rnd() * 128;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + rnd() * 32, y + rnd() * 7); g.stroke();
    }
    g.fillStyle = 'rgba(255,236,202,.34)'; g.fillRect(1, 0, 1, 256);
  });
  return new THREE.MeshPhysicalMaterial({ map, roughness: 0.36, clearcoat: 0.6, clearcoatRoughness: 0.26 });
}

function shippingLabel(code: string, color: number, serial: number) {
  const name = DESTINATIONS.find(d => d.id === code)?.name ?? code;
  const map = canvasTex(768, 472, g => {
    const random = seeded(serial);
    g.fillStyle = '#eeeae0'; g.fillRect(0, 0, 768, 472);
    g.fillStyle = '#e3e0d5'; g.fillRect(0, 0, 768, 56);
    g.fillStyle = new THREE.Color(color).getStyle(); g.fillRect(0, 0, 11, 56);
    g.fillStyle = '#202625';
    g.font = `bold 29px ${KO_FONT}`; g.fillText('하늘길 택배', 23, 38);
    g.textAlign = 'right'; g.font = `bold 23px ${KO_FONT}`; g.fillText('항공 운송장', 744, 38);
    g.textAlign = 'left'; g.font = `900 213px ${KO_FONT}`; g.fillText(code, 14, 257, 355);
    g.fillRect(384, 85, 2, 182);
    g.font = `25px ${KO_FONT}`; g.fillText('도착지', 407, 125);
    g.font = `bold 43px ${KO_FONT}`; g.fillText(name, 406, 183, 340);
    g.font = `25px ${KO_FONT}`; g.fillText('발송   제1배송기지', 406, 244);
    g.fillRect(22, 287, 724, 2);
    for (let x = 26; x < 735;) {
      const w = 2 + Math.floor(random() * 4) * 2;
      g.fillRect(x, 309, w, 83); x += w + 2 + Math.floor(random() * 3) * 2;
    }
    g.textAlign = 'center'; g.font = `26px ${KO_FONT}`;
    g.fillText(`01   ${code}   ${serial}   1 / 1`, 384, 435);
  });
  return new THREE.MeshStandardMaterial({ map, roughness: 0.84 });
}

// One destination has several reusable pack-outs. An order keeps its carton across shelf, hand and flight.
export function crateModel(code: string, color: number, variant: number, s: Surfaces) {
  const model = new THREE.Group();
  const serial = 105781 + 401 * code.charCodeAt(0) + variant * 107;
  const rnd = seeded(serial);
  const plywood = (variant + code.charCodeAt(0)) % 4 === 0;
  const mat = plywood ? s.wood : kraftBoard(variant !== 2);
  const tape = packingTape ??= tapeMaterial();
  const band = new THREE.MeshStandardMaterial({ roughness: 0.62, map: canvasTex(512, 56, g => {
    g.fillStyle = new THREE.Color(color).getStyle(); g.fillRect(0, 0, 512, 56);
    g.fillStyle = '#313331'; g.font = `bold 29px ${KO_FONT}`; g.fillText(code, 16, 39);
    g.font = `20px ${KO_FONT}`; g.fillText('취급주의', 400, 36);
    g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(0, 2, 512, 1);
  }) });
  const paper = shippingLabel(code, color, serial);
  const seam = finish(0x725034, 0.96);
  solid(model, new RoundedBoxGeometry(0.66, 0.68, 0.66, 2, 0.007), mat);
  const tapeOffset = (rnd() - 0.5) * 0.045;
  const bandY = 0.19 + (rnd() - 0.5) * 0.016;
  const decalAngle = (rnd() - 0.5) * 0.038;
  for (let side = 0; side < 4; side++) {
    const face = new THREE.Group();
    face.rotation.y = side * Math.PI / 2; model.add(face);
    const decal = (w: number, h: number, material: THREE.Material, x: number, y: number, z: number) => {
      const mesh = solid(face, new THREE.PlaneGeometry(w, h), material, x, y, z);
      mesh.castShadow = false;
      return mesh;
    };
    if (side % 2 === 0) decal(0.077, 0.14, tape, side === 0 ? tapeOffset : -tapeOffset, 0.267, 0.3309);
    decal(0.659, 0.069, band, 0, bandY, 0.3315);
    decal(0.49, 0.301, paper, (side % 2 ? 1 : -1) * 0.01, -0.012, 0.3323).rotation.z = decalAngle;
    if (plywood) {
      for (const y of [-0.307, 0.306]) {
        box(face, 0.674, 0.047, 0.011, s.wood, 0, y, 0.333);
        for (const x of [-0.28, 0.28]) {
          const head = solid(face, new THREE.CircleGeometry(0.0048, 8), seam, x, y, 0.3388);
          head.castShadow = false;
        }
      }
    }
  }
  const lid = (w: number, d: number, material: THREE.Material, x: number, y: number, z: number) => {
    const mesh = solid(model, new THREE.PlaneGeometry(w, d), material, x, y, z);
    mesh.rotation.x = -Math.PI / 2;
    mesh.castShadow = false;
    return mesh;
  };
  lid(0.077, 0.658, tape, tapeOffset, 0.3408, 0);
  lid(0.0018, 0.655, seam, tapeOffset, 0.3411, 0);
  for (const z of [-0.253, 0.253]) lid(0.655, 0.042, tape, 0, 0.3417, z);
  // The overhead slip also reads over the lip of a carried carton.
  const topLabel = lid(0.292, 0.18, paper, -0.145, 0.3427, 0.065);
  topLabel.rotateZ(decalAngle - 0.075);
  return model;
}
