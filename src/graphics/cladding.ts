import * as THREE from 'three';
import { solid, type Surfaces } from './materials';

// Folded trapezoidal sheets. The three height bands carry splashback up from the
// apron. Shared edges within each flat keep the folded corners sharp in sunlight.
export function hangarCladding(group: THREE.Group, iron: Surfaces['iron'], front: number, back: number, height: number) {
  const positions: number[] = [], normals: number[] = [], uv: number[] = [], colors: number[] = [], indices: number[] = [];
  const material = iron.clone();
  material.vertexColors = true;
  const folds = [[0, 0], [0.57, 0], [0.65, 0.035], [0.86, 0.035], [0.94, 0], [1, 0]];
  const rows = [0, 0.18, 0.64, 1.25, 2.42, 3.54, height];
  function sheet(x: number, z: number, yaw: number, width: number, bottom: number, top: number) {
    const c = Math.cos(yaw), s = Math.sin(yaw), count = Math.round(width / 0.235);
    const levels = [bottom, ...rows.filter(y => y > bottom && y < top), top];
    for (let rib = 0; rib < count; rib++) {
      const panel = Math.floor(rib / 4);
      const tone = 0.91 + 0.06 * Math.sin((panel + x - z) * 17.3);
      for (let k = 0; k < folds.length - 1; k++) {
        const first = positions.length / 3;
        const [u0, d0] = folds[k], [u1, d1] = folds[k + 1];
        const run = (u1 - u0) * width / count, rise = d1 - d0, length = Math.hypot(run, rise);
        for (const y of levels) for (const [u, depth] of [folds[k], folds[k + 1]]) {
          const along = width * ((rib + u) / count - 0.5);
          positions.push(x + c * along + s * depth, y, z - s * along + c * depth);
          normals.push((s * run - c * rise) / length, 0, (c * run + s * rise) / length);
          uv.push(along, y);
          const streak = 0.5 + 0.5 * Math.sin((rib + u + x) * 13.7);
          const damp = Math.exp(-y / (0.27 + 0.34 * streak));
          colors.push(tone * (0.78 - 0.37 * damp), tone * (0.84 - 0.47 * damp), tone * (0.85 - 0.55 * damp));
        }
        for (let row = 1; row < levels.length; row++) {
          const a = first + (row - 1) * 2;
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
    }
  }
  for (const side of [-1, 1]) {
    sheet(side * 12.202, (front + back) / 2, side * Math.PI / 2, front - back, 0.025, height);
    sheet(side * 9.25, front + 0.202, 0, 5.5, 0.025, 2.42);
    sheet(side * 9.25, front + 0.202, 0, 5.5, 3.54, height);
  }
  sheet(0, front + 0.202, 0, 13, height - 1.5, height);
  sheet(0, back - 0.202, Math.PI, 24, 0.025, height);
  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  solid(group, geo, material);
}
