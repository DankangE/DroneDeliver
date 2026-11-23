import * as THREE from 'three';
import { grainMaps, type Grain } from './textures';
import { TiledMaterial } from './tiled';

function coat(profile: TiledMaterial['profile'], grain: Grain, normalStrength: number, options: THREE.MeshPhysicalMaterialParameters) {
  const { map, normalMap } = grainMaps(grain);
  const material = new TiledMaterial(profile, { map, normalMap, roughnessMap: map, ...options });
  material.normalScale.setScalar(normalStrength);
  material.name = grain;
  return material;
}

/** Powder-coated steel. Broken millimetre-wide chips reveal conducting metal at face edges. */
export function paintedSteel(color = 0x526773) {
  return coat('paintedSteel', 'enamel', 0.19, { color, roughness: 0.51, clearcoat: 0.19, clearcoatRoughness: 0.34 });
}

/** Carbon-black rubber with mould grain and a broad, dim dielectric highlight. */
export function rubber(color = 0x282b2a) {
  return coat('grain', 'rubber', 0.45, { color, roughness: 0.92, specularIntensity: 0.65 });
}

/** Tinted architectural glazing. Set transmission to zero for panes backed by a dark interior. */
export function tintedWindowGlass(color = 0x859f9e, transmission = 0.84) {
  return new THREE.MeshPhysicalMaterial({
    name: 'Tinted glass', color, transmission, ior: 1.52, roughness: 0.065,
    thickness: 0.012, attenuationColor: color, attenuationDistance: 0.09,
  });
}

/** Resin-bound 2/2 carbon twill. Eight interlaced tows span a 32 mm texture tile. */
export function carbonFibre(color = 0x363b3e) {
  return coat('carbon', 'carbon', 0.51, { color, roughness: 0.54, clearcoat: 0.78, clearcoatRoughness: 0.22 });
}

/** Textured injection-moulded ABS with a soft tooling grain. */
export function mattePlastic(color = 0x41484b) {
  return coat('grain', 'plastic', 0.29, { color, roughness: 0.71, ior: 1.49 });
}

/** Polished moulded plastic with shallow tooling grain and a clear surface highlight. */
export function glossPlastic(color = 0x41484b) {
  return coat('grain', 'plastic', 0.06, { color, roughness: 0.24, ior: 1.49, clearcoat: 0.44, clearcoatRoughness: 0.17 });
}

/** Brushed aluminium. The grain and anisotropic reflection run along the mesh U axis. */
export function brushedAluminium(color = 0xd1d5d6) {
  return coat('brushed', 'brushed', 0.32, { color, metalness: 0.97, roughness: 0.40, anisotropy: 0.65 });
}

/** Backlit microprismatic diffuser. Emissive colour and intensity remain independently animatable. */
export function emissiveLedPanel(color = 0xfff2d9, intensity = 3.0) {
  const panel = coat('diffuser', 'diffuser', 0.23, { color, emissive: color, emissiveIntensity: intensity, roughness: 0.38 });
  panel.emissiveMap = panel.map;
  return panel;
}

/** Chalked exterior paint with islands of exposed, rougher cement. */
export function weatheredPaintOverConcrete(color = 0xc7c1ad) {
  return coat('weatheredPaint', 'plaster', 0.66, { color, roughness: 0.85 });
}

/** Uncoated kraft board with crossing paper fibres and a faint impression of the flutes. */
export function cardboard(color = 0xad8555) {
  return coat('grain', 'kraft', 0.28, { color, roughness: 0.94, specularIntensity: 0.62 });
}
