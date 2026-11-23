import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { ROTOR_BLUR_LAYER } from './materials';

// Brightest texel of the supplied 2048 × 1024 equirectangular sky, in Three's world axes.
const sunlight = new THREE.Vector3(0.55456, 0.74198, 0.37673).normalize();
const horizon = new THREE.Color().setRGB(0.412, 0.446, 0.539);
const shadowExtent = 55;

// The GTAO override material otherwise turns transparent rotor quads into opaque squares.
class OpaqueWorldAO extends GTAOPass {
  override render(...args: Parameters<GTAOPass['render']>) {
    const background = this.scene.background;
    const layers = this.camera.layers.mask;
    this.scene.background = null;
    this.camera.layers.disable(ROTOR_BLUR_LAYER);
    try {
      super.render(...args);
    } finally {
      this.camera.layers.mask = layers;
      this.scene.background = background;
    }
  }
}

export class Pipeline {
  readonly markings = new THREE.Scene();
  private readonly composer: EffectComposer;
  private readonly sun = new THREE.DirectionalLight(0xfff0d9, 3.3);
  private readonly focus = new THREE.Vector3();
  private readonly lightRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), sunlight).normalize();
  private readonly lightUp = new THREE.Vector3().crossVectors(sunlight, this.lightRight);
  private readonly restoreDepth: FullScreenQuad;

  constructor(private renderer: THREE.WebGLRenderer, private camera: THREE.PerspectiveCamera, scene: THREE.Scene) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.03;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.setScalar(Math.min(4096, renderer.capabilities.maxTextureSize));
    this.sun.shadow.bias = -0.00012;
    this.sun.shadow.normalBias = 0.025;
    Object.assign(this.sun.shadow.camera, { left: -shadowExtent, right: shadowExtent, top: shadowExtent, bottom: -shadowExtent, near: 1, far: 240 });
    this.sun.shadow.camera.updateProjectionMatrix();
    const fill = new THREE.HemisphereLight(0xd9eaff, 0xab9977, 1.35);
    scene.add(this.sun, this.sun.target, fill);
    scene.background = horizon;
    scene.fog = new THREE.FogExp2(horizon, 0.0037);

    new RGBELoader().load('/assets/hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr', sky => {
      // The solar disc reaches 70,000. Its direct light is represented by the shadow-casting sun.
      // Limit that tiny hotspot before convolution and bloom, retaining the cloud radiance.
      const { buffer, byteOffset, byteLength } = sky.image.data;
      const pixels = new Uint16Array(buffer, byteOffset, byteLength / Uint16Array.BYTES_PER_ELEMENT);
      const limit = THREE.DataUtils.toHalfFloat(16);
      for (let i = 0; i < pixels.length; i += 4) {
        const peak = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
        if (peak <= limit) continue;
        const scale = 16 / THREE.DataUtils.fromHalfFloat(peak);
        for (let j = i; j < i + 3; j++) pixels[j] = THREE.DataUtils.toHalfFloat(THREE.DataUtils.fromHalfFloat(pixels[j]) * scale);
      }
      sky.mapping = THREE.EquirectangularReflectionMapping;
      const pmrem = new THREE.PMREMGenerator(renderer);
      const environment = pmrem.fromEquirectangular(sky);
      scene.environment = environment.texture;
      scene.background = sky;
      fill.intensity = 0.16;
      pmrem.dispose();
    }, undefined, () => { /* The horizon and hemisphere light also work offline if the HDR is unavailable. */ });

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    camera.layers.enable(ROTOR_BLUR_LAYER);
    const ao = new OpaqueWorldAO(scene, camera);
    ao.updateGtaoMaterial({ radius: 0.65, thickness: 0.9, samples: 16, screenSpaceRadius: false });
    ao.blendIntensity = 0.55;
    this.composer.addPass(ao);
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.13, 0.3, 1.55));
    this.composer.addPass(new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse;
        varying vec2 vUv;
        void main() {
          vec3 rgb = texture2D(tDiffuse, vUv).rgb;
          float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
          vec3 balance = mix(vec3(0.982, 0.996, 1.018), vec3(1.018, 1.004, 0.984), smoothstep(0.04, 1.6, luma));
          vec2 p = vUv - 0.5;
          gl_FragColor = vec4(mix(vec3(luma), rgb, 0.99) * balance * (1.0 - 0.13 * dot(p, p)), 1.0);
        }`,
    }));
    this.composer.addPass(new SMAAPass(1, 1));
    this.composer.addPass(new OutputPass());

    // OutputPass grades the entire HDR image. Draw ink in display space afterwards,
    // restoring the opaque world depth from GTAO so signs still disappear behind walls.
    this.restoreDepth = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { worldDepth: { value: ao.depthTexture } },
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform highp sampler2D worldDepth; void main() { gl_FragDepth = texelFetch(worldDepth, ivec2(gl_FragCoord.xy), 0).r; gl_FragColor = vec4(0.0); }',
      depthFunc: THREE.AlwaysDepth, colorWrite: false, toneMapped: false,
    }));
  }

  resize(w: number, h: number) {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (ratio !== this.renderer.getPixelRatio()) {
      this.renderer.setPixelRatio(ratio);
      this.composer.setPixelRatio(ratio);
    }
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
  }

  render() {
    const { renderer, camera, sun, focus } = this;
    camera.getWorldDirection(focus).multiplyScalar(16).add(camera.position);
    focus.y = Math.max(3, focus.y * 0.5);
    const texel = 2 * shadowExtent / sun.shadow.mapSize.x;
    for (const axis of [this.lightRight, this.lightUp]) {
      const coord = focus.dot(axis);
      focus.addScaledVector(axis, Math.round(coord / texel) * texel - coord);
    }
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(sunlight, 125);
    renderer.shadowMap.needsUpdate = true;
    this.composer.render();
    renderer.autoClear = false;
    this.restoreDepth.render(renderer);
    renderer.render(this.markings, camera);
    renderer.autoClear = true;
  }
}
