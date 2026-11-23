import * as THREE from 'three';
import { solid, tintedWindowGlass } from '../materials';
import { finishes } from './finishes';
import { hose, point, rod, rounded, screw, turned } from './parts';

export function addCamera(body: THREE.Group) {
  const m = finishes();
  const gimbal = new THREE.Group();
  body.add(gimbal); gimbal.position.set(0, 0.388, -0.451);
  turned(gimbal, [[0.042, 0.123], [0.068, 0.129], [0.072, 0.142], [0.072, 0.179], [0.084, 0.182], [0.084, 0.207], [0, 0.208]], m.anodized);
  rounded(gimbal, 0.235, 0.027, 0.095, 0.012, m.nylon, 0, 0.123, 0);
  for (const sx of [-1, 1]) {
    const top = point(sx * 0.105, 0.123, 0.012), axle = point(sx * 0.111, 0, 0);
    rod(gimbal, top, axle, 0.022, 0.018, m.anodized);
    rod(gimbal, point(sx * 0.085, 0, 0), point(sx * 0.122, 0, 0), 0.039, 0.033, m.nylon);
    screw(gimbal, sx * 0.123, 0, 0, 0.015, m.titanium).rotation.z = -sx * Math.PI / 2;
  }
  hose(gimbal, [point(-0.035, 0.16, 0.051), point(-0.086, 0.134, 0.071),
    point(-0.097, 0.044, 0.061), point(-0.08, -0.003, 0.049)], 0.006, m.rubber);
  const head = new THREE.Group(); gimbal.add(head);
  head.rotation.x = -0.12;
  rounded(head, 0.187, 0.157, 0.163, 0.042, m.nylon);
  // Lens axis points out of the nose. Independent stops and a convex coated
  // window reveal the iris underneath as the viewing angle moves the reflection.
  const barrel = new THREE.Group(); head.add(barrel);
  barrel.position.set(0, 0, -0.069); barrel.rotation.x = -Math.PI / 2;
  turned(barrel, [[0.054, 0], [0.069, 0.004], [0.069, 0.025], [0.065, 0.03],
    [0.066, 0.047], [0.062, 0.052], [0.053, 0.052], [0.049, 0.041], [0.046, 0.029]], m.anodized);
  turned(barrel, [[0.054, 0.044], [0.055, 0.047], [0.053, 0.048], [0.050, 0.045]], m.titanium);
  const iris = solid(barrel, new THREE.CircleGeometry(0.048, 48), m.gasket, 0, 0.029, 0);
  iris.rotation.x = -Math.PI / 2;
  turned(barrel, [[0.042, 0.031], [0.041, 0.035], [0.025, 0.034], [0.022, 0.032]], m.anodized);
  const pupil = solid(barrel, new THREE.SphereGeometry(1, 32, 16), tintedWindowGlass(0x0c2128, 0), 0, 0.035, 0);
  pupil.scale.set(0.024, 0.004, 0.024);
  const glass = tintedWindowGlass(0x548e9b, 0);
  glass.iridescence = 0.45;
  glass.iridescenceIOR = 1.32;
  glass.transparent = true;
  glass.opacity = 0.33;
  glass.depthWrite = false;
  const window = solid(barrel, new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, 0.044, 0);
  window.scale.set(0.051, 0.008, 0.051);
}
