import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ROTOR_BLUR_LAYER } from './materials';
import { daylight, sunDirection } from './post/daylight';
import { aerialPerspective, printFinish } from './post/photography';
import { SunShadows } from './post/sun-shadows';
import type { TierSettings } from './quality';

export class Pipeline {
  readonly markings = new THREE.Scene();
  private readonly shadows: SunShadows;
  private readonly maxTargetSize: number;
  private scale = 1;
  private readonly hazeRange = new THREE.Vector2();
  private readonly post?: {
    beauty: THREE.WebGLRenderTarget;
    composer: EffectComposer;
    ao: GTAOPass;
    air: ReturnType<typeof aerialPerspective>;
    bloom: UnrealBloomPass;
    smaa: SMAAPass;
    sampleCounts: Int32Array;
    finish: ReturnType<typeof printFinish>;
  };
  private readonly bufferSize = new THREE.Vector2();
  private readonly eye = new THREE.Vector3();

  constructor(private renderer: THREE.WebGLRenderer, private camera: THREE.PerspectiveCamera, private scene: THREE.Scene,
    private settings: TierSettings) {
    renderer.info.autoReset = false;
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.35;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    const gl = renderer.getContext() as WebGL2RenderingContext; // r170 requires WebGL 2
    this.maxTargetSize = Math.min(renderer.capabilities.maxTextureSize, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    this.shadows = new SunShadows(scene, sunDirection, this.maxTargetSize, settings);
    renderer.domElement.addEventListener('webglcontextrestored', () => this.shadows.setTier(this.settings));
    camera.layers.enable(ROTOR_BLUR_LAYER);
    this.watchPixelRatio();

    const hdrSupported = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    const horizon = daylight(camera, scene, this.shadows.sun, hdrSupported, this.hazeRange);
    if (!horizon) {
      scene.fog = new THREE.Fog(scene.background as THREE.Color, settings.hazeStart, settings.far);
      this.setTier(settings);
      return;
    }

    const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    const sampleCounts: Int32Array = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES);
    const beauty = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, depthTexture: depth,
    });
    beauty.texture.name = 'World radiance';

    // Reconstruct GTAO normals from the actual beauty depth. This retains alpha-tested
    // silhouettes and excludes translucent rotor discs that disable depth writes.
    const ao = new GTAOPass(scene, camera, 1, 1);
    ao.setGBuffer(depth);
    ao.updateGtaoMaterial({
      radius: 0.85, thickness: 0.6, distanceExponent: 1.6,
      distanceFallOff: 0.9, screenSpaceRadius: false,
    });
    ao.updatePdMaterial({ rings: 3, radius: 4, depthPhi: 0.28, normalPhi: 8, lumaPhi: 0.85 });
    ao.output = GTAOPass.OUTPUT.Off;
    ao.needsSwap = false;

    ao.gtaoRenderTarget.depthBuffer = ao.pdRenderTarget.depthBuffer = false;
    const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, depthBuffer: false,
    }));
    composer.setPixelRatio(1);
    composer.addPass(ao);
    const air = aerialPerspective(camera, beauty, ao.gtaoMap, horizon, this.hazeRange);
    composer.addPass(air);
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.085, 0.12, 1.8);
    composer.addPass(bloom);
    // r170 SMAA detects and blends edges in display-encoded space. Only OutputPass
    // performs the HDR tone mapping and sRGB transfer.
    composer.addPass(new OutputPass());
    const smaa = new SMAAPass(1, 1);
    composer.addPass(smaa);
    const finish = printFinish(depth);
    composer.addPass(finish);
    this.post = { beauty, composer, ao, air, bloom, smaa, finish, sampleCounts };
    this.setTier(settings);
  }

  prepare(root: THREE.Object3D) {
    this.shadows.prepare(root);
    this.invalidateCasters();
  }

  invalidateCasters() {
    this.shadows.invalidateCasters();
  }

  setTier(settings: TierSettings) {
    this.settings = settings;
    this.shadows.setTier(settings);
    this.camera.far = settings.far;
    this.camera.updateProjectionMatrix();
    this.hazeRange.set(settings.hazeStart, settings.far);
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = settings.hazeStart;
      this.scene.fog.far = settings.far;
    }
    if (this.post) {
      const { beauty, ao, air, bloom, smaa, sampleCounts } = this.post;
      const samples = Math.max(0, ...Array.from(sampleCounts).filter(n => n <= settings.msaa));
      if (beauty.samples !== samples) {
        beauty.dispose();
        beauty.samples = samples;
      }
      ao.enabled = settings.aoScale > 0;
      if (ao.enabled) {
        ao.updateGtaoMaterial({ samples: settings.aoSamples });
        ao.updatePdMaterial({ samples: settings.denoiseSamples });
        air.material.defines.AMBIENT_OCCLUSION = 1;
      } else {
        delete air.material.defines.AMBIENT_OCCLUSION;
      }
      air.material.needsUpdate = true;
      bloom.enabled = settings.bloomScale > 0;
      smaa.enabled = settings.smaa;
    }
    this.setScale(1);
  }

  setScale(scale: number) {
    this.scale = scale;
    const { x, y } = this.renderer.getSize(this.bufferSize);
    this.resize(x, y);
  }

  private watchPixelRatio() {
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    query.addEventListener('change', () => {
      const { x, y } = this.renderer.getSize(this.bufferSize);
      this.resize(x, y);
      this.watchPixelRatio();
    }, { once: true });
  }

  resize(w: number, h: number) {
    const cappedDpr = Math.min(window.devicePixelRatio || 1, this.settings.pixelRatio);
    const ratio = Math.min(cappedDpr * this.scale, this.maxTargetSize / Math.max(w, h, 1));
    this.renderer.setDrawingBufferSize(w, h, ratio);
    if (!this.post) return;
    // Use integer physical pixels for all depth consumers, including fractional DPRs.
    this.renderer.getDrawingBufferSize(this.bufferSize);
    const { x, y } = this.bufferSize;
    const { beauty, composer, ao, bloom, smaa } = this.post;
    beauty.setSize(x, y);
    composer.setSize(x, y);
    const scaled = (n: number, scale: number) => Math.max(1, Math.round(n * scale));
    ao.setSize(scaled(x, this.settings.aoScale), scaled(y, this.settings.aoScale));
    bloom.setSize(scaled(x, this.settings.bloomScale), scaled(y, this.settings.bloomScale));
    if (!smaa.enabled) smaa.setSize(1, 1);
  }

  render() {
    const { renderer, scene, camera, post } = this;
    renderer.info.reset();
    this.shadows.update(camera.getWorldPosition(this.eye));
    renderer.shadowMap.needsUpdate = true;
    renderer.setRenderTarget(post?.beauty ?? null);
    renderer.render(scene, camera);
    if (post) {
      renderer.setRenderTarget(null);
      post.finish.uniforms.frame.value = (post.finish.uniforms.frame.value + 1) % 64;
      post.composer.render();
    }
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    try {
      renderer.render(this.markings, camera);
    } finally {
      renderer.autoClear = autoClear;
    }
  }
}
