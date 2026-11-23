import * as THREE from 'three';

// Nested light-space squares cover the view in every direction, including a straight-down
// landing view. Each camera moves only in whole texels and has a fixed projection.
const cascades = [
  { width: 28, size: 2048, normalBias: 0.008 },
  { width: 152, size: 3072, normalBias: 0.027 },
  { width: 1120, size: 4096, normalBias: 0.10 },
];

const sampleSun = /* glsl */`
  #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS >= 3
  uniform vec2 sunMapSpan[3]; // orthographic width and depth, in metres

  vec2 diskPoint(int i, float count) {
    float angle = float(i) * 2.39996323;
    return vec2(cos(angle), sin(angle)) * sqrt((float(i) + 0.5) / count);
  }

  float filterSun(sampler2D shadowMap, vec3 coord, DirectionalLightShadow settings, vec2 span) {
    float contact = getShadow(shadowMap, settings.shadowMapSize, 1.0, settings.shadowBias,
                              settings.shadowRadius, vec4(coord, 1.0));
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
  }

  float sunVisibility() {
    float remaining = 1.0;
    float visibility = 0.0;
    #pragma unroll_loop_start
    for ( int i = 0; i < 3; i ++ ) {
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

// Keep r170's point, spot, and area lighting intact. The first directional light
// supplies solar radiance. The other two supply only shadow projections.
const lighting = THREE.ShaderChunk.lights_fragment_begin.replace(
  /^.*directLight\.color \*=.*getShadow\( directionalShadowMap.*$/m,
  `#if NUM_DIR_LIGHT_SHADOWS >= 3 && UNROLLED_LOOP_INDEX == 0
      if (directLight.visible && receiveShadow) directLight.color *= sunVisibility();
    #elif NUM_DIR_LIGHT_SHADOWS < 3 || UNROLLED_LOOP_INDEX >= 3
      $&
    #endif`,
);

export class SunShadows {
  readonly sun: THREE.DirectionalLight;
  private readonly lights: THREE.DirectionalLight[] = [];
  private readonly spans: THREE.Vector2[] = [];
  private readonly prepared = new WeakSet<THREE.Material>();
  private readonly right: THREE.Vector3;
  private readonly up: THREE.Vector3;

  constructor(private scene: THREE.Scene, private direction: THREE.Vector3, maxMapSize: number) {
    this.right = new THREE.Vector3(direction.z, 0, -direction.x).normalize();
    this.up = new THREE.Vector3().crossVectors(direction, this.right);
    for (const { width, size, normalBias } of cascades) {
      const light = new THREE.DirectionalLight(0xfff9ed, this.lights.length === 0 ? 4.5 : 0);
      light.castShadow = true;
      const { shadow } = light;
      shadow.mapSize.setScalar(Math.min(size, maxMapSize));
      shadow.normalBias = normalBias;
      const half = width * 0.5;
      const near = 0.5, far = width + 150;
      shadow.bias = -normalBias * 0.35 / (far - near);
      Object.assign(shadow.camera, { left: -half, right: half, top: half, bottom: -half, near, far });
      shadow.camera.updateProjectionMatrix();
      this.spans.push(new THREE.Vector2(width, far - near));
      this.lights.push(light);
      scene.add(light, light.target);
    }
    this.sun = this.lights[0];
  }

  private prepare(material: THREE.Material) {
    if (this.prepared.has(material)) return;
    this.prepared.add(material);
    const before = material.onBeforeCompile;
    const key = material.customProgramCacheKey.bind(material);
    const defaultKey = material.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey;
    const spans = this.spans;
    material.customProgramCacheKey = () => (defaultKey ? before.toString() : key()) + '/sun-cascades';
    material.onBeforeCompile = function (shader, renderer) {
      before.call(this, shader, renderer);
      shader.uniforms.sunMapSpan = { value: spans };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n' + sampleSun)
        .replace('#include <lights_fragment_begin>', lighting);
    };
    material.needsUpdate = true;
  }

  update(eye: THREE.Vector3) {
    this.lights.forEach((light, i) => {
      const texel = this.spans[i].x / light.shadow.mapSize.x;
      const center = light.target.position.copy(eye);
      for (const axis of [this.right, this.up]) {
        const position = eye.dot(axis);
        center.addScaledVector(axis, Math.round(position / texel) * texel - position);
      }
      const { near, far } = light.shadow.camera;
      light.position.copy(center).addScaledVector(this.direction, (far + near) * 0.5);
    });
    // Cargo, drones and their materials can appear after the first render.
    this.scene.traverseVisible(object => {
      if (!(object instanceof THREE.Mesh)) return;
      if (Array.isArray(object.material)) object.material.forEach(material => this.prepare(material));
      else this.prepare(object.material);
    });
  }
}
