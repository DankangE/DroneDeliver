export type QualityTier = 'low' | 'medium' | 'high';
export type QualitySetting = 'auto' | QualityTier;

export const QUALITY_SETTINGS: QualitySetting[] = ['auto', 'low', 'medium', 'high'];
export const QUALITY_LABEL: Record<QualitySetting, string> = { auto: '자동', low: '낮음', medium: '보통', high: '높음' };

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
