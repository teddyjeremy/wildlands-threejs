// Quality presets. Each knob maps to something that measurably costs GPU or
// CPU time; see PERFORMANCE.md for the numbers behind the defaults.

export const QUALITY_PRESETS = {
  low: {
    pixelRatio: 1,
    shadows: false,
    shadowMapSize: 0,
    grassCount: 5000,
    bloom: false,
    particles: 250,
    grassDensity: 0.4,
    rainCount: 500,
    flowers: 300,
    oceanSegments: 64,
    maxAnimals: 2,
    fogFar: 190,
  },
  medium: {
    pixelRatio: 1.5,
    shadows: true,
    shadowMapSize: 1024,
    grassCount: 24000,
    bloom: true,
    particles: 900,
    grassDensity: 0.75,
    rainCount: 1200,
    flowers: 600,
    oceanSegments: 128,
    maxAnimals: 3,
    fogFar: 240,
  },
  high: {
    pixelRatio: 2,
    shadows: true,
    shadowMapSize: 2048,
    grassCount: 48000,
    bloom: true,
    particles: 1600,
    grassDensity: 1,
    rainCount: 2400,
    flowers: 900,
    oceanSegments: 192,
    maxAnimals: 4,
    fogFar: 280,
  },
};

export function getPreset(name) {
  return QUALITY_PRESETS[name] || QUALITY_PRESETS.medium;
}

/** Rough first guess for people without a saved setting. */
export function suggestQuality() {
  if (typeof navigator === 'undefined') return 'medium';
  const touch = navigator.maxTouchPoints > 1;
  const cores = navigator.hardwareConcurrency || 4;
  if (touch || cores <= 4) return 'low';
  return 'medium';
}
