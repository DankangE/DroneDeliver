export type QualityTier = 'low' | 'medium' | 'high';
export type QualitySetting = 'auto' | QualityTier;

export const QUALITY_SETTINGS: QualitySetting[] = ['auto', 'low', 'medium', 'high'];
export const QUALITY_LABEL: Record<QualitySetting, string> = { auto: '자동', low: '낮음', medium: '보통', high: '높음' };

export interface TierSettings {
  pixelRatio: number;
  minScale: number;
  cascades: { width: number; size: number; interval: number }[];
  penumbra: boolean;
  depotShadows: boolean;
  aoScale: number;
  aoSamples: number;
  denoiseSamples: number;
  bloomScale: number;
  msaa: number;
  smaa: boolean;
  blendTiles: boolean;
  canvasSize: number;
  anisotropy: number;
  far: number;
  hazeStart: number;
  terrainShadowDistance: number;
  fullFoliage: boolean;
  foliageDetail: number;
  streetDetail: number;
}

export const TIERS: Record<QualityTier, TierSettings> = {
  low: {
    pixelRatio: 0.75, minScale: 0.7,
    cascades: [{ width: 70, size: 1024, interval: 1 }],
    penumbra: false, depotShadows: false,
    aoScale: 0, aoSamples: 0, denoiseSamples: 0, bloomScale: 0, msaa: 0, smaa: false,
    blendTiles: false, canvasSize: 1024, anisotropy: 2, far: 300, hazeStart: 170,
    terrainShadowDistance: 45, fullFoliage: false, foliageDetail: 0, streetDetail: 48,
  },
  medium: {
    pixelRatio: 1, minScale: 0.7,
    cascades: [{ width: 38, size: 1024, interval: 1 }, { width: 200, size: 1536, interval: 4 }],
    penumbra: false, depotShadows: false,
    aoScale: 0.5, aoSamples: 12, denoiseSamples: 8, bloomScale: 0.5, msaa: 0, smaa: true,
    blendTiles: true, canvasSize: 1024, anisotropy: 4, far: 460, hazeStart: 280,
    terrainShadowDistance: 120, fullFoliage: false, foliageDetail: 32, streetDetail: 100,
  },
  high: {
    pixelRatio: 1.5, minScale: 0.8,
    cascades: [{ width: 28, size: 2048, interval: 1 }, { width: 152, size: 3072, interval: 2 },
      { width: 1120, size: 4096, interval: 4 }],
    penumbra: true, depotShadows: true,
    aoScale: 1, aoSamples: 40, denoiseSamples: 24, bloomScale: 1, msaa: 4, smaa: true,
    blendTiles: true, canvasSize: 2048, anisotropy: 16, far: 1200, hazeStart: 850,
    terrainShadowDistance: 320, fullFoliage: true, foliageDetail: 80, streetDetail: 520,
  },
};

const initialTier = (setting: QualitySetting): QualityTier => setting === 'auto' ? 'high' : setting;

export class AdaptiveQuality {
  tier: QualityTier;
  scale = 1;
  private previousTime?: number;
  private warmup = 3000;
  private scaleTime = 0;
  private windowTime = 0;
  private frames = 0;
  private meanMs = 1000 / 60;

  constructor(public setting: QualitySetting) {
    this.tier = initialTier(setting);
  }

  select(setting: QualitySetting) {
    this.setting = setting;
    this.startTier(initialTier(setting));
  }

  private startTier(tier: QualityTier) {
    this.tier = tier;
    this.scale = 1;
    this.warmup = 3000;
    this.previousTime = undefined;
    this.scaleTime = this.windowTime = this.frames = 0;
    this.meanMs = 1000 / 60;
  }

  sample(now: number) {
    const dt = now - (this.previousTime ?? now);
    this.previousTime = now;
    if (dt <= 0 || dt > 250) return;
    if (this.warmup > 0) {
      this.warmup -= dt;
      return;
    }

    this.windowTime += dt;
    this.frames++;
    if (this.windowTime >= 2000) {
      const fps = 1000 * this.frames / this.windowTime;
      this.windowTime = this.frames = 0;
      if (this.setting === 'auto' && fps < 52 && this.tier !== 'low') {
        this.startTier(this.tier === 'high' ? 'medium' : 'low');
        return;
      }
    }

    this.meanMs += (dt - this.meanMs) * (1 - Math.exp(-dt / 500));
    this.scaleTime += dt;
    if (this.scaleTime < 1000) return;
    this.scaleTime = 0;
    const step = this.meanMs > 17.5 ? -0.1 : this.meanMs < 15.5 ? 0.1 : 0;
    this.scale = Math.max(TIERS[this.tier].minScale, Math.min(1, Math.round((this.scale + step) * 10) / 10));
  }
}

const KEY = 'dronedeliver.quality';

export function loadQualitySetting(): QualitySetting {
  try {
    const v = localStorage.getItem(KEY);
    return QUALITY_SETTINGS.includes(v as QualitySetting) ? (v as QualitySetting) : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveQualitySetting(setting: QualitySetting) {
  try { localStorage.setItem(KEY, setting); } catch { /* storage blocked */ }
}
