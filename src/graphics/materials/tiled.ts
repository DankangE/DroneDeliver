import * as THREE from 'three';
import { grainMaps, withAoUv } from './textures';

type Profile = 'grass' | 'asphalt' | 'floor' | 'wood' | 'plate' | 'wall' | 'iron'
  | 'paintedSteel' | 'weatheredPaint';

// Translate samples on a triangular lattice. All channels use the same translations and
// weights, so tangent normals need no rotation. Explicit gradients keep mip selection
// continuous when a pixel quad straddles a triangle boundary.
const sampling = /* glsl */`
  varying vec3 vFinishPoint;
  struct FinishTile { vec2 a; vec2 b; vec2 c; vec3 weight; };

  vec2 finishHash(vec2 cell) {
    uvec2 h = uvec2(ivec2(cell)) * uvec2(1597334677u, 3812015801u);
    h = (h.xx ^ h.yy) * uvec2(2246822519u, 3266489917u);
    h ^= h >> 16u;
    return vec2(h >> 8u) / 16777216.0;
  }
  float finishNoise(vec2 p) {
    vec2 c = floor(p), t = fract(p);
    t *= t * (3.0 - 2.0 * t);
    return mix(mix(finishHash(c).x, finishHash(c + vec2(1,0)).x, t.x),
               mix(finishHash(c + vec2(0,1)).x, finishHash(c + vec2(1)).x, t.x), t.y);
  }
  vec2 finishOffset(vec2 cell) {
    vec2 shift = finishHash(cell + vec2(19, 43));
    // OFFSET_RULE
    return shift;
  }
  FinishTile finishTile(vec2 uv) {
    vec2 grid = vec2(uv.x - uv.y * 0.57735027, uv.y * 1.15470054);
    vec2 cell = floor(grid), f = fract(grid);
    float side = 1.0;
    if (f.x + f.y > 1.0) { cell += 1.0; f = 1.0 - f; side = -1.0; }
    vec3 w = max(vec3(1.0 - f.x - f.y, f), vec3(0));
    w *= w * w;
    return FinishTile(finishOffset(cell), finishOffset(cell + vec2(side,0)),
                      finishOffset(cell + vec2(0,side)), w / dot(w, vec3(1)));
  }
  vec4 finishSample(sampler2D tex, vec2 uv, FinishTile tile) {
    vec2 dx = dFdx(uv), dy = dFdy(uv);
    return tile.weight.x * textureGrad(tex, uv + tile.a, dx, dy)
         + tile.weight.y * textureGrad(tex, uv + tile.b, dx, dy)
         + tile.weight.z * textureGrad(tex, uv + tile.c, dx, dy);
  }
`;

const offsetRules: Partial<Record<Profile, string>> = {
  iron: 'shift.x = 0.0;', // Slip along the flutes.
  plate: 'shift = floor(shift * vec2(13, 11)) / vec2(13, 11);', // Registered tread diamonds.
  wall: 'shift = floor(shift * 2.0) * 0.5;', // Two formed panels per scan axis.
};

const grassTint = /* glsl */`
  vegetation = smoothstep(0.45, 0.88, (albedo.g - albedo.b) / max(albedo.g, 0.005));
  float luma = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
  vec3 chlorophyll = mix(vec3(0.76, 1.08, 0.40), vec3(0.44, 1.18, 0.39),
                         smoothstep(0.18, 0.82, macroTone + 0.5));
  vec3 mineral = mix(albedo, luma * vec3(1.05, 1.00, 0.93), 0.35);
  albedo = mix(mineral, luma * chlorophyll, vegetation * 0.96);
`;
const grades: Partial<Record<Profile, string>> = {
  grass: grassTint,
  floor: 'albedo = mix(albedo, vec3(dot(albedo, vec3(0.25, 0.58, 0.17))), 0.52) * 1.14;',
  plate: `
    float oxide = dot(albedo, vec3(0.27, 0.58, 0.15));
    albedo = mix(vec3(0.78, 0.71, 0.61) * oxide, vec3(0.30, 0.33, 0.34),
                 smoothstep(0.08, 0.85, finishArm.b) * 0.86);`,
  paintedSteel: 'albedo = mix(albedo * diffuseColor.rgb, vec3(0.32, 0.34, 0.34), finishWear);',
  weatheredPaint: 'albedo = mix(albedo * diffuseColor.rgb, vec3(0.25, 0.235, 0.205) * albedo, finishWear);',
};

const edgeWear = /* glsl */`
  // Recover local metres per unit of face UV, also for ordinary 0..1 UV boxes.
  vec2 du = dFdx(vFinishFace), dv = dFdy(vFinishFace);
  float det = du.x * dv.y - du.y * dv.x;
  vec3 dx = dFdx(vFinishPoint), dy = dFdy(vFinishPoint);
  vec2 span = vec2(length(dx * dv.y - dy * du.y), length(dy * du.x - dx * dv.x))
            / max(abs(det), 1e-15);
  vec2 margin = min(vFinishFace, 1.0 - vFinishFace) * span;
  float edge = min(margin.x, margin.y);
  float chips = 0.64 * finishNoise(finishPlane * 270.0) + 0.36 * finishNoise(finishPlane * 51.0);
  float reach = 0.0005 + 0.004 * chips;
  float aa = clamp(fwidth(edge), 0.0001, 0.003);
  float finishWear = (1.0 - smoothstep(reach - aa, reach + aa, abs(edge)))
    * smoothstep(0.39, 0.65, chips) * step(1e-14, abs(det));
`;

// In r170 the normal, AO and metalness chunks also perform lighting work. Replace only
// their texture lookups so double-sided shading and environment specular occlusion survive.
function sampleChunk(chunk: string, sampler: string, uv: string) {
  return chunk.replaceAll(`texture2D( ${sampler}, ${uv} )`, `finishSample(${sampler}, ${uv}, tile)`);
}

export class TiledMaterial extends THREE.MeshPhysicalMaterial {
  // Raw primitives carry ordinary 0..1 UVs. Metric helper geometry supplies its face UVs.
  readonly defaultAttributeValues = { finishFaceUv: [-1, -1] };

  constructor(public profile: Profile = 'floor', options?: THREE.MeshPhysicalMaterialParameters) {
    super(options);
  }

  override copy(source: this): this {
    super.copy(source);
    this.profile = source.profile;
    return this;
  }

  override onBeforeRender(_renderer: THREE.WebGLRenderer, _scene: THREE.Scene, _camera: THREE.Camera, geometry: THREE.BufferGeometry) {
    if (this.aoMap?.channel === 1) withAoUv(geometry);
  }

  override customProgramCacheKey() {
    return 'finish/' + this.profile + '/' + (this.roughnessMap === this.metalnessMap) + '/' + (this.roughnessMap === this.map);
  }

  override onBeforeCompile(shader: THREE.WebGLProgramParametersWithUniforms, _renderer: THREE.WebGLRenderer) {
    const profile = this.profile;
    const paint = profile === 'paintedSteel', plaster = profile === 'weatheredPaint';
    const packed = this.roughnessMap && this.roughnessMap === this.metalnessMap;
    const chunks = THREE.ShaderChunk;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFinishPoint;
        ${paint ? 'attribute vec2 finishFaceUv; varying vec2 vFinishFace;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFinishPoint = position;
        #ifdef USE_INSTANCING
          vFinishPoint = (instanceMatrix * vec4(position, 1)).xyz;
        #endif
        ${paint ? 'vFinishFace = finishFaceUv.x >= 0.0 ? finishFaceUv : uv;' : ''}`);

    if (profile === 'grass') shader.uniforms.tuftNormal = { value: grainMaps('grass').normalMap };
    const microGrain = paint || plaster;
    const normalChunk = (microGrain ? chunks.normal_fragment_maps : sampleChunk(chunks.normal_fragment_maps, 'normalMap', 'vNormalMapUv'))
      .replace('mapN.xy *= normalScale;', `mapN.xy *= normalScale;
        ${profile === 'grass' ? `
          // The 9.6 m scan and 24 cm tuft detail share a tangent frame.
          vec2 tuftUv = vNormalMapUv * 40.0;
          vec3 tuft = finishSample(tuftNormal, tuftUv, finishTile(tuftUv)).xyz * 2.0 - 1.0;
          mapN = vec3(mapN.xy * tuft.z + tuft.xy * (mapN.z * vegetation * 0.39), mapN.z * tuft.z);` : ''}`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${sampling.replace('// OFFSET_RULE', offsetRules[profile] ?? '')}
        ${profile === 'grass' ? 'uniform sampler2D tuftNormal;' : ''}
        ${paint ? 'varying vec2 vFinishFace;' : ''}`)
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          FinishTile tile = finishTile(vMapUv);
        #elif defined(USE_NORMALMAP)
          FinishTile tile = finishTile(vNormalMapUv);
        #elif defined(USE_ROUGHNESSMAP)
          FinishTile tile = finishTile(vRoughnessMapUv);
        #else
          FinishTile tile = finishTile(vec2(0));
        #endif
        vec2 finishPlane = vFinishPoint.xz + vec2(0.47, 0.81) * vFinishPoint.y;
        float macroTone = 0.68 * finishNoise(finishPlane * 0.078)
                        + 0.32 * finishNoise(finishPlane * 0.217 + vec2(9, 23)) - 0.5;
        ${paint ? edgeWear : ''}
        ${plaster ? `float flecks = finishNoise(finishPlane * 83.0);
          float finishWear = smoothstep(0.58, 0.71, 0.46 * finishNoise(finishPlane * 2.7)
            + 0.24 * finishNoise(finishPlane * 14.0) + 0.30 * flecks);` : ''}
        ${profile === 'grass' ? 'float vegetation = 0.0;' : ''}
        #ifdef USE_ROUGHNESSMAP
          vec4 finishArm = ${microGrain ? 'texture2D(roughnessMap, vRoughnessMapUv)' : 'finishSample(roughnessMap, vRoughnessMapUv, tile)'};
        #else
          vec4 finishArm = vec4(1, 1, 0, 1);
        #endif
        #ifdef USE_MAP
          vec4 sampleColor = ${this.roughnessMap === this.map ? 'finishArm' : 'finishSample(map, vMapUv, tile)'};
          vec3 albedo = sampleColor.rgb;
          ${grades[profile] ?? ''}
          diffuseColor.rgb ${paint || plaster ? '=' : '*='} albedo;
          diffuseColor.a *= sampleColor.a;
        #endif
        diffuseColor.rgb *= 1.0 + macroTone * ${profile === 'grass' ? 'vec3(0.37, 0.28, 0.23)' : 'vec3(0.16, 0.14, 0.12)'};
      `)
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness * finishArm.g + macroTone * 0.09;
        ${paint ? 'roughnessFactor = mix(roughnessFactor, 0.47, finishWear);' : ''}
        ${plaster ? 'roughnessFactor = mix(roughnessFactor, 0.94, finishWear);' : ''}
        roughnessFactor = clamp(roughnessFactor, 0.045, 1.0);`)
      .replace('#include <metalnessmap_fragment>', (packed
        ? 'float metalnessFactor = metalness * finishArm.b;'
        : sampleChunk(chunks.metalnessmap_fragment, 'metalnessMap', 'vMetalnessMapUv')) +
        (paint ? '\nmetalnessFactor = mix(metalnessFactor, 0.92, finishWear);' : ''))
      .replace('#include <normal_fragment_maps>', normalChunk)
      .replace('#include <aomap_fragment>', sampleChunk(chunks.aomap_fragment, 'aoMap', 'vAoMapUv'))
      .replace('#include <emissivemap_fragment>', sampleChunk(chunks.emissivemap_fragment, 'emissiveMap', 'vEmissiveMapUv'));
  }
}
