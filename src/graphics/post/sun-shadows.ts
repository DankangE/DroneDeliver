import * as THREE from 'three';
import { TIERS, type TierSettings } from '../quality';

const sampleSun = /* glsl */`
  #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
  uniform vec2 sunMapSpan[NUM_DIR_LIGHT_SHADOWS]; // orthographic width and depth, in metres

  vec2 diskPoint(int i, float count) {
    float angle = float(i) * 2.39996323;
    return vec2(cos(angle), sin(angle)) * sqrt((float(i) + 0.5) / count);
  }

  float filterSun(sampler2D shadowMap, vec3 coord, DirectionalLightShadow settings, vec2 span) {
    float contact = getShadow(shadowMap, settings.shadowMapSize, 1.0, settings.shadowBias,
                              settings.shadowRadius, vec4(coord, 1.0));
    #ifdef SUN_PENUMBRA
    // The apparent solar radius is 0.27 degrees. At city-scale texel sizes the
    // native PCF footprint already covers the penumbra of a tall building.
    float texelMetres = span.x / settings.shadowMapSize.x;
    if (texelMetres >= 0.24) return contact;
    float receiver = coord.z + settings.shadowBias;
    float separation = 0.0;
    float blockers = 0.0;
    for (int j = 0; j < 12; ++j) {
      vec2 offset = j == 0 ? vec2(0.0) : diskPoint(j, 12.0) * (0.24 / span.x);
      float depth = unpackRGBAToDepth(texture2D(shadowMap, coord.xy + offset));
      if (depth < receiver) {
        separation += receiver - depth;
        blockers += 1.0;
      }
    }
    float radius = min(0.30, 0.00465 * span.y * separation / max(blockers, 1.0));
    if (radius <= texelMetres) return contact;
    float visibility = 0.0;
    for (int j = 0; j < 24; ++j) {
      vec2 offset = diskPoint(j, 24.0) * (radius / span.x);
      visibility += texture2DCompare(shadowMap, coord.xy + offset, receiver);
    }
    return mix(contact, visibility / 24.0, smoothstep(1.0, 2.0, radius / texelMetres));
    #else
    return contact;
    #endif
  }

  float sunVisibility() {
    float remaining = 1.0;
    float visibility = 0.0;
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
      if (remaining > 0.0) {
        vec3 coord = vDirectionalShadowCoord[ i ].xyz;
        vec3 edge = abs(coord * 2.0 - 1.0);
        float coverage = 1.0 - smoothstep(0.84, 0.99, max(max(edge.x, edge.y), edge.z));
        if (coverage > 0.0) {
          visibility += remaining * coverage * filterSun(directionalShadowMap[ i ], coord,
                                                          directionalLightShadows[ i ], sunMapSpan[ i ]);
          remaining *= 1.0 - coverage;
        }
      }
    }
    #pragma unroll_loop_end
    return visibility + remaining;
  }
  #endif
`;

const lighting = THREE.ShaderChunk.lights_fragment_begin.replace(
  /(directionalLight = directionalLights\[ i \];)[\s\S]*?(RE_Direct\( [^;]+;)/,
  `#if UNROLLED_LOOP_INDEX == 0
    $1
    getDirectionalLightInfo(directionalLight, directLight);
    #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
      if (directLight.visible && receiveShadow) directLight.color *= sunVisibility();
    #endif
    $2
   #endif`,
);

export class SunShadows {
  readonly sun: THREE.DirectionalLight;
  private readonly lights: THREE.DirectionalLight[];
  private readonly spans: THREE.Vector2[];
  private readonly depotLights = new Set<THREE.SpotLight | THREE.PointLight>();
  private readonly prepared = new WeakSet<THREE.Material>();
  private readonly right: THREE.Vector3;
  private readonly up: THREE.Vector3;
  private frame = 0;
  private readonly center = new THREE.Vector3();
  private casterRevision = 0;
  private readonly renderedRevision: number[] = [];

  constructor(scene: THREE.Scene, private direction: THREE.Vector3, private maxMapSize: number,
    private settings: TierSettings) {
    this.right = new THREE.Vector3(direction.z, 0, -direction.x).normalize();
    this.up = new THREE.Vector3().crossVectors(direction, this.right);
    this.lights = TIERS.high.cascades.map((_, i) => {
      const light = new THREE.DirectionalLight(0xfff9ed, i === 0 ? 4.5 : 0);
      light.castShadow = true;
      light.shadow.autoUpdate = false;
      scene.add(light, light.target);
      return light;
    });
    this.sun = this.lights[0];
    this.spans = this.lights.map(() => new THREE.Vector2());
  }

  setTier(settings: TierSettings) {
    this.settings = settings;
    this.frame = 0;
    this.invalidateCasters();
    this.lights.forEach((light, i) => {
      const cascade = settings.cascades[i];
      light.visible = !!cascade;
      const shadow = light.shadow;
      const size = cascade ? Math.min(cascade.size, this.maxMapSize) : 0;
      if (shadow.map && shadow.mapSize.x !== size) {
        shadow.map.dispose();
        shadow.map = null;
      }
      if (!cascade) return;
      shadow.mapSize.setScalar(size);
      const half = cascade.width / 2, near = 0.5, far = cascade.width + 150;
      shadow.normalBias = 0.56 * cascade.width / size;
      shadow.bias = -shadow.normalBias * 0.35 / (far - near);
      Object.assign(shadow.camera, { left: -half, right: half, top: half, bottom: -half, near, far });
      shadow.camera.updateProjectionMatrix();
      this.spans[i].set(cascade.width, far - near);
    });
    for (const light of this.depotLights) this.setDepotShadow(light);
  }

  private setDepotShadow(light: THREE.SpotLight | THREE.PointLight) {
    light.castShadow = this.settings.depotShadows;
    light.shadow.autoUpdate = false;
    light.shadow.needsUpdate = light.castShadow;
    if (!light.castShadow && light.shadow.map) {
      light.shadow.map.dispose();
      light.shadow.map = null;
    }
  }

  prepare(root: THREE.Object3D) {
    root.traverse(object => {
      if (object instanceof THREE.SpotLight || object instanceof THREE.PointLight) {
        if (object.castShadow) {
          this.depotLights.add(object);
          this.setDepotShadow(object);
        }
      } else if (object instanceof THREE.Mesh) {
        if (Array.isArray(object.material)) object.material.forEach(material => this.prepareMaterial(material));
        else this.prepareMaterial(object.material);
      }
    });
  }

  private prepareMaterial(material: THREE.Material) {
    if (!(material instanceof THREE.MeshStandardMaterial) || this.prepared.has(material)) return;
    this.prepared.add(material);
    const before = material.onBeforeCompile;
    const key = material.customProgramCacheKey.bind(material);
    const defaultKey = material.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey;
    material.customProgramCacheKey = () => (defaultKey ? before.toString() : key()) + '/sun/' + this.settings.penumbra;
    material.onBeforeCompile = (shader, renderer) => {
      before.call(material, shader, renderer);
      shader.uniforms.sunMapSpan = { value: this.spans };
      const penumbra = this.settings.penumbra ? '#define SUN_PENUMBRA\n' : '';
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n' + penumbra + sampleSun)
        .replace('#include <lights_fragment_begin>', lighting);
    };
    material.needsUpdate = true;
  }

  invalidateCasters() {
    this.casterRevision++;
  }

  update(eye: THREE.Vector3) {
    this.settings.cascades.forEach(({ interval }, i) => {
      const light = this.lights[i];
      if (this.frame % interval !== 0 && light.shadow.map) return;
      const texel = this.spans[i].x / light.shadow.mapSize.x;
      const center = this.center.copy(eye);
      const x = eye.dot(this.right), y = eye.dot(this.up), depth = eye.dot(this.direction);
      center.addScaledVector(this.right, Math.round(x / texel) * texel - x);
      center.addScaledVector(this.up, Math.round(y / texel) * texel - y);
      center.addScaledVector(this.direction, Math.round(depth / texel) * texel - depth);
      if (light.shadow.map && this.renderedRevision[i] === this.casterRevision &&
          center.distanceToSquared(light.target.position) < 1e-10) return;
      light.target.position.copy(center);
      this.renderedRevision[i] = this.casterRevision;
      light.shadow.needsUpdate = true;
      const { near, far } = light.shadow.camera;
      light.position.copy(center).addScaledVector(this.direction, (far + near) * 0.5);
    });
    this.frame++;
  }
}
