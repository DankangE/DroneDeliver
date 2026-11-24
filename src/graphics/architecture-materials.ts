import * as THREE from 'three';
import { canvasTex, KO_FONT, rubber, seeded, tintedWindowGlass } from './materials';

function repeat(texture: THREE.Texture, x: number, y: number) {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(x, y);
  return texture;
}

// Hand-laid running bond. UVs on architectural solids are expressed in metres.
export function masonryMaterial(base: number, joint: number, w = 0.34, h = 0.12) {
  const random = seeded(base % 65521 + 1);
  const map = canvasTex(512, 512, g => {
    g.fillStyle = new THREE.Color(joint).getStyle();
    g.fillRect(0, 0, 512, 512);
    for (let row = 0; row < 16; row++) for (let col = -1; col < 8; col++) {
      const x = (col + (row % 2) * 0.5) * 64, y = row * 32;
      g.fillStyle = new THREE.Color(base).multiplyScalar(0.8 + 0.35 * random()).getStyle();
      g.fillRect(x + 1, y + 1.6, 62.4, 29.5);
      for (let fleck = 0; fleck < 6; fleck++) {
        g.fillStyle = fleck % 2 ? 'rgba(251,235,210,.07)' : 'rgba(40,25,16,.06)';
        g.fillRect(x + random() * 52, y + 3 + random() * 24, 4 + random() * 8, 1.5);
      }
    }
  });
  repeat(map, 1 / (8 * w), 1 / (16 * h));
  return new THREE.MeshStandardMaterial({ map, bumpMap: map, bumpScale: 0.015, roughness: 0.92 });
}

type Sign = readonly [string, string, string, string?];

function paintSign(g: CanvasRenderingContext2D, title: string, line: string, background: string, lettering = '#f8f3df') {
  g.fillStyle = background; g.fillRect(0, 0, 768, 192);
  g.strokeStyle = lettering; g.globalAlpha = 0.52; g.lineWidth = 2; g.strokeRect(10, 9, 748, 174); g.globalAlpha = 1;
  g.fillStyle = lettering; g.textAlign = 'center';
  g.font = 'bold 75px ' + KO_FONT; g.fillText(title, 384, 105, 681);
  g.font = '26px ' + KO_FONT; g.fillText(line, 384, 154, 676);
}

export function signMaterial(...caption: Sign) {
  const map = canvasTex(768, 192, g => paintSign(g, ...caption));
  return new THREE.MeshStandardMaterial({ map, roughness: 0.61 });
}

export function citySignAtlas(captions: readonly Sign[]) {
  const cols = 4, rows = Math.ceil(captions.length / cols);
  const w = 384, h = 96, gutter = 4, cellW = w + gutter * 2, cellH = h + gutter * 2;
  const map = canvasTex(cols * cellW, rows * cellH, g => {
    captions.forEach((caption, i) => {
      g.save(); g.translate((i % cols) * cellW, Math.floor(i / cols) * cellH);
      g.fillStyle = caption[2]; g.fillRect(0, 0, cellW, cellH);
      g.translate(gutter, gutter); g.scale(0.5, 0.5);
      paintSign(g, ...caption);
      g.restore();
    });
  });
  const material = new THREE.MeshStandardMaterial({ map, roughness: 0.61 });
  function face(i: number, width: number, height: number) {
    const geo = new THREE.PlaneGeometry(width, height), uv = geo.getAttribute('uv');
    for (let j = 0; j < uv.count; j++) {
      const x = (i % cols) * cellW + gutter + uv.getX(j) * w;
      const y = Math.floor(i / cols) * cellH + gutter + (1 - uv.getY(j)) * h;
      uv.setXY(j, x / (cols * cellW), 1 - y / (rows * cellH));
    }
    return geo;
  }
  return { material, face };
}

/** One framed module. Silver interconnects disappear into the dark cell field at flight distance. */
export function photovoltaicPanel() {
  const map = canvasTex(160, 256, g => {
    g.fillStyle = '#aeb7b5'; g.fillRect(0, 0, 160, 256);
    g.fillStyle = '#434e54'; g.fillRect(2, 2, 156, 252);
    const random = seeded(423);
    for (let row = 0; row < 10; row++) for (let col = 0; col < 6; col++) {
      const x = 4 + col * 25.5, y = 4 + row * 24.8;
      g.fillStyle = ['#243947', '#2d4150', '#263d4a', '#304553'][Math.floor(random() * 4)];
      g.fillRect(x, y, 24.6, 24);
      g.fillStyle = '#53636b';
      for (let wire = 1; wire < 4; wire++) g.fillRect(x + wire * 6.1, y, 0.65, 24);
    }
  });
  const glass = tintedWindowGlass(0xffffff, 0);
  glass.map = map;
  glass.roughness = 0.16;
  return glass;
}

export function roofMembrane() {
  const material = rubber(0xffffff);
  // A metre-wide lap joint breaks the reflected sky along each roll of cap sheet.
  const map = canvasTex(128, 256, g => {
    g.fillStyle = '#deddd6'; g.fillRect(0, 0, 128, 256);
    const rnd = seeded(239);
    for (let i = 0; i < 1700; i++) {
      g.fillStyle = i % 2 ? '#d3d2cc' : '#e5e4dd';
      g.fillRect(rnd() * 128, rnd() * 256, 1, 1);
    }
    g.fillStyle = '#b5b6af'; g.fillRect(0, 0, 2, 256);
    g.fillStyle = '#ebeae4'; g.fillRect(2, 0, 1, 256);
  });
  material.map = repeat(map, 0.95, 0.38);
  return material;
}

export function condenserFan() {
  const map = canvasTex(96, 96, g => {
    g.fillStyle = '#a4aaa5'; g.fillRect(0, 0, 96, 96);
    g.translate(48, 48);
    g.fillStyle = '#374341'; g.beginPath(); g.arc(0, 0, 42, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#67736e';
    for (let i = 0; i < 5; i++) {
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(38, -27, 39, -4);
      g.quadraticCurveTo(19, 14, 0, 0); g.fill(); g.rotate(Math.PI * 2 / 5);
    }
    g.strokeStyle = '#9ba5a0'; g.lineWidth = 1.3;
    for (let r = 9; r < 43; r += 6) { g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); }
  });
  return new THREE.MeshStandardMaterial({ map, roughness: 0.52, metalness: 0.36 });
}
