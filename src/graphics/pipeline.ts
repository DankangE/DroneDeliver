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

export class Pipeline {
  readonly markings = new THREE.Scene();
  private readonly composer: EffectComposer;
  private readonly shadows: SunShadows;
  private readonly beauty: THREE.WebGLRenderTarget;
  private readonly finish: ReturnType<typeof printFinish>;
  private readonly bufferSize = new THREE.Vector2();
  private readonly eye = new THREE.Vector3();

  constructor(private renderer: THREE.WebGLRenderer, private camera: THREE.PerspectiveCamera, private scene: THREE.Scene) {
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.35;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    this.shadows = new SunShadows(scene, sunDirection, renderer.capabilities.maxTextureSize);
    const horizon = daylight(renderer, camera, scene, this.shadows.sun);
    camera.layers.enable(ROTOR_BLUR_LAYER);

    const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    const gl = renderer.getContext() as WebGL2RenderingContext; // r170 requires WebGL 2
    const sampleCounts: Int32Array = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES);
    this.beauty = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, depthTexture: depth,
      samples: Math.max(0, ...Array.from(sampleCounts).filter(n => n <= 4)),
    });
    this.beauty.texture.name = 'World radiance';

    // Reconstruct GTAO normals from the actual beauty depth. This retains alpha-tested
    // silhouettes and excludes translucent rotor discs that disable depth writes.
    const ao = new GTAOPass(scene, camera, 1, 1);
    ao.setGBuffer(depth);
    ao.updateGtaoMaterial({
      radius: 0.85, thickness: 0.6, samples: 40, distanceExponent: 1.6,
      distanceFallOff: 0.9, screenSpaceRadius: false,
    });
    ao.updatePdMaterial({ samples: 24, rings: 3, radius: 4, depthPhi: 0.28, normalPhi: 8, lumaPhi: 0.85 });
    ao.output = GTAOPass.OUTPUT.Off;
    ao.needsSwap = false;

    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(1);
    this.composer.addPass(ao);
    this.composer.addPass(aerialPerspective(camera, this.beauty, ao.gtaoMap, horizon));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.085, 0.12, 1.8));
    // r170 SMAA detects and blends edges in display-encoded space. Only OutputPass
    // performs the HDR tone mapping and sRGB transfer.
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new SMAAPass(1, 1));
    this.finish = printFinish(depth);
    this.composer.addPass(this.finish);
  }

  resize(w: number, h: number) {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.renderer.getDrawingBufferSize(this.bufferSize);
    // Use integer physical pixels for all depth consumers, including fractional DPRs.
    this.beauty.setSize(this.bufferSize.x, this.bufferSize.y);
    this.composer.setSize(this.bufferSize.x, this.bufferSize.y);
  }

  render() {
    const { renderer, scene, camera } = this;
    this.shadows.update(camera.getWorldPosition(this.eye));
    renderer.shadowMap.needsUpdate = true;
    renderer.setRenderTarget(this.beauty);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    this.finish.uniforms.frame.value = (this.finish.uniforms.frame.value + 1) % 64;
    this.composer.render();
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    try {
      renderer.render(this.markings, camera);
    } finally {
      renderer.autoClear = autoClear;
    }
  }
}
