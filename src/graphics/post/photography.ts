import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const vertexShader = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const air = /* glsl */`
  uniform sampler2D horizon;
  uniform mat4 viewFromClip, worldFromView;
  uniform vec2 hazeRange;

  vec3 transmittance(float distanceM, float surfaceHeight) {
    // Integral of exp(-height / scaleHeight) per unit of ray length.
    const float scaleHeight = 105.0;
    float a = max(0.0, worldFromView[3].y) / scaleHeight;
    float b = max(0.0, surfaceHeight) / scaleHeight;
    float density = abs(b - a) < 0.001 ? exp(-0.5 * (a + b)) : (exp(-a) - exp(-b)) / (b - a);
    // Aerosols dominate at this altitude. Molecular scattering removes more blue.
    vec3 extinction = vec3(0.000013, 0.000030, 0.000067) + 0.00068 * density;
    return exp(-distanceM * extinction) * (1.0 - smoothstep(hazeRange.x, hazeRange.y, distanceM));
  }

  float azimuth(vec3 dir) {
    return atan(dir.z, dir.x) * 0.159154943 + 0.5;
  }
`;

export function skyBackground(
  camera: THREE.PerspectiveCamera, sky: THREE.DataTexture, horizon: THREE.Texture, yaw: number, hazeRange: THREE.Vector2,
) {
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).translate(0, 0, 1), new THREE.ShaderMaterial({
    name: 'Daylight sky',
    uniforms: {
      hazeRange: { value: hazeRange }, sky: { value: sky }, horizon: { value: horizon }, yawTurns: { value: yaw / (2 * Math.PI) },
      viewFromClip: { value: camera.projectionMatrixInverse }, worldFromView: { value: camera.matrixWorld },
    },
    depthFunc: THREE.LessEqualDepth, depthWrite: false, toneMapped: false, vertexShader,
    fragmentShader: /* glsl */`
      varying vec2 vUv;
      uniform sampler2D sky;
      uniform float yawTurns;
      ${air}
      void main() {
        vec4 ray = viewFromClip * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
        vec3 dir = normalize(mat3(worldFromView) * ray.xyz);
        float u = azimuth(dir);
        vec2 skyUv = vec2(u + yawTurns, 0.5 + asin(clamp(dir.y, -1.0, 1.0)) / 3.14159265);
        vec3 color = texture2D(sky, skyUv).rgb;
        vec3 airlight = texture2D(horizon, vec2(u, 0.5)).rgb;
        color = mix(airlight, color, smoothstep(0.035, 0.11, dir.y));
        if (dir.y < -0.00001) {
          // Continue the finite terrain to the geometric horizon with the same
          // extinction as the city. Grazing rays converge on the photographed sky.
          float distanceM = max(worldFromView[3].y, 0.1) / -dir.y;
          color = mix(airlight, vec3(0.20, 0.148, 0.061), transmittance(distanceM, 0.0));
        }
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  }));
  backdrop.frustumCulled = false;
  backdrop.renderOrder = Infinity;
  return backdrop;
}

export function aerialPerspective(
  camera: THREE.PerspectiveCamera, beauty: THREE.WebGLRenderTarget, ao: THREE.Texture, horizon: THREE.DataTexture,
  hazeRange: THREE.Vector2,
) {
  return new ShaderPass(new THREE.ShaderMaterial({
    name: 'Aerial perspective', defines: { AMBIENT_OCCLUSION: 1 },
    uniforms: {
      beauty: { value: beauty.texture }, worldDepth: { value: beauty.depthTexture },
      hazeRange: { value: hazeRange }, ambientVisibility: { value: ao }, horizon: { value: horizon },
      viewFromClip: { value: camera.projectionMatrixInverse }, worldFromView: { value: camera.matrixWorld },
    },
    depthTest: false, depthWrite: false, toneMapped: false, vertexShader,
    fragmentShader: /* glsl */`
      varying vec2 vUv;
      uniform sampler2D beauty, ambientVisibility;
      uniform highp sampler2D worldDepth;
      ${air}

      void main() {
        float depth = texture2D(worldDepth, vUv).r;
        vec3 color = texture2D(beauty, vUv).rgb;
        if (depth == 1.0) {
          gl_FragColor = vec4(color, 1.0);
          return;
        }
        vec4 view = viewFromClip * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
        vec3 ray = mat3(worldFromView) * (view.xyz / view.w);
        vec3 airlight = texture2D(horizon, vec2(azimuth(ray), 0.5)).rgb;
        #ifdef AMBIENT_OCCLUSION
        float ao = texture2D(ambientVisibility, vUv).r;
        float light = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color *= mix(1.0, ao, 0.53 * (1.0 - smoothstep(0.55, 2.2, light)));
        #endif
        gl_FragColor = vec4(mix(airlight, color, transmittance(length(ray), worldFromView[3].y + ray.y)), 1.0);
      }
    `,
  }));
}

export function printFinish(worldDepth: THREE.DepthTexture) {
  return new ShaderPass(new THREE.ShaderMaterial({
    name: 'Photographic finish',
    uniforms: { tDiffuse: { value: null }, worldDepth: { value: worldDepth }, frame: { value: 0 } },
    // Restore the beauty pass's exact opaque/cutout depth for display-space signs.
    depthFunc: THREE.AlwaysDepth, depthWrite: true, toneMapped: false, vertexShader,
    fragmentShader: /* glsl */`
      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      uniform highp sampler2D worldDepth;
      uniform float frame;

      void main() {
        vec2 size = vec2(textureSize(tDiffuse, 0));
        vec2 p = (vUv - 0.5) * size;
        float radius2 = 4.0 * dot(p, p) / dot(size, size);
        vec2 shift = p / max(length(p), 1.0) * (0.32 * radius2 * radius2) / size;
        vec3 color = texture2D(tDiffuse, vUv).rgb;
        color.r = texture2D(tDiffuse, vUv + shift).r;
        color.b = texture2D(tDiffuse, vUv - shift).b;

        const vec3 rec709 = vec3(0.2126, 0.7152, 0.0722);
        float luma = dot(color, rec709);
        float printLuma = mix(luma, smoothstep(0.0, 1.0, luma), 0.12);
        color *= printLuma / max(luma, 0.00001);
        vec3 tint = mix(vec3(-0.022, 0.001, 0.026), vec3(0.024, 0.003, -0.020),
                        smoothstep(0.28, 0.75, luma));
        color += luma * (1.0 - luma) * tint;
        color *= 1.0 - 0.041 * radius2 * radius2;

        // A triangular, zero-mean dither of about one display code value.
        vec2 pixel = gl_FragCoord.xy + frame * vec2(13.0, 29.0);
        float n1 = fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
        float n2 = fract(52.9829189 * fract(dot(pixel.yx, vec2(0.06711056, 0.00583715))));
        color += (n1 + n2 - 1.0) * (0.7 + luma * (1.0 - luma) * 1.8) / 255.0;
        gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
        gl_FragDepth = texelFetch(worldDepth, ivec2(gl_FragCoord.xy), 0).r;
      }
    `,
  }));
}
