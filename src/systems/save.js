// Versioned localStorage save. Only plain data goes in here - IDs, settings,
// a compact trail snapshot - never Three.js objects. Everything read back is
// validated; anything malformed is dropped rather than crashing startup.

export const SAVE_KEY = 'wildlands.save';
export const SAVE_VERSION = 3;

export const DEFAULT_SETTINGS = Object.freeze({
  quality: 'medium',
  muted: false,
  masterVolume: 0.8,
  ambienceVolume: 0.7,
  effectsVolume: 0.8,
  sensitivity: 1,
  invertY: false,
  reducedMotion: false,
});

const QUALITIES = ['low', 'medium', 'high'];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp01 = (v, d) => (isNum(v) ? Math.max(0, Math.min(1, v)) : d);

export function sanitizeSettings(s) {
  const src = s && typeof s === 'object' ? s : {};
  return {
    quality: QUALITIES.includes(src.quality) ? src.quality : DEFAULT_SETTINGS.quality,
    muted: typeof src.muted === 'boolean' ? src.muted : DEFAULT_SETTINGS.muted,
    masterVolume: clamp01(src.masterVolume, DEFAULT_SETTINGS.masterVolume),
    ambienceVolume: clamp01(src.ambienceVolume, DEFAULT_SETTINGS.ambienceVolume),
    effectsVolume: clamp01(src.effectsVolume, DEFAULT_SETTINGS.effectsVolume),
    sensitivity: isNum(src.sensitivity) ? Math.max(0.2, Math.min(3, src.sensitivity)) : DEFAULT_SETTINGS.sensitivity,
    invertY: typeof src.invertY === 'boolean' ? src.invertY : DEFAULT_SETTINGS.invertY,
    reducedMotion: typeof src.reducedMotion === 'boolean' ? src.reducedMotion : DEFAULT_SETTINGS.reducedMotion,
  };
}

const idList = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && x.length < 64))] : []);

/**
 * Upgrade older shapes. v1 stored `found` instead of `discovered`; v2 was a
 * single island, which became the first island of the archipelago in v3.
 */
function migrate(raw) {
  let d = raw;
  if (d.version === 1) d = { ...d, version: 2, discovered: d.found || [], collected: d.collected || [] };
  if (d.version === 2) d = { ...d, version: 3, level: 0, progression: null, levels: {} };
  return d;
}

function sanitizeLevels(v) {
  const out = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, e] of Object.entries(v)) {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i > 16 || !e || typeof e !== 'object') continue;
    out[i] = { discovered: idList(e.discovered), collected: idList(e.collected) };
  }
  return out;
}

/**
 * Validate a parsed save object. Returns a clean save or null.
 * @param {object} raw
 * @param {string} worldKey configKey() of the current world
 */
export function validateSave(raw, worldKey) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!isNum(raw.version) || raw.version < 1 || raw.version > SAVE_VERSION) return null;
  const data = migrate(raw);
  if (typeof data.seed !== 'string' || !data.seed) return null;
  const sameWorld = typeof data.worldKey === 'string' && data.worldKey === worldKey;

  const out = {
    version: SAVE_VERSION,
    seed: data.seed,
    worldKey: data.worldKey,
    settings: sanitizeSettings(data.settings),
    // Progress only applies to the world it was earned in.
    discovered: sameWorld ? idList(data.discovered) : [],
    collected: sameWorld ? idList(data.collected) : [],
    player: null,
    timeOfDay: isNum(data.timeOfDay) ? ((data.timeOfDay % 1) + 1) % 1 : null,
    trail: null,
    savedAt: isNum(data.savedAt) ? data.savedAt : 0,
    level: Number.isInteger(data.level) && data.level >= 0 && data.level < 16 ? data.level : 0,
    progression: data.progression && typeof data.progression === 'object' && !Array.isArray(data.progression) ? data.progression : null,
    levels: sanitizeLevels(data.levels),
  };
  const p = data.player;
  if (sameWorld && p && isNum(p.x) && isNum(p.y) && isNum(p.z) && Math.abs(p.x) < 500 && Math.abs(p.z) < 500) {
    out.player = { x: p.x, y: p.y, z: p.z, heading: isNum(p.heading) ? p.heading : 0 };
  }
  const t = data.trail;
  if (sameWorld && t && isNum(t.res) && isNum(t.cellSize) && typeof t.data === 'string' && t.data.length < 400000) {
    out.trail = { res: t.res, cellSize: t.cellSize, data: t.data };
  }
  return out;
}

export class SaveStore {
  constructor(storage = globalThis.localStorage, key = SAVE_KEY) {
    this.storage = storage;
    this.key = key;
  }

  load(worldKey) {
    try {
      const text = this.storage?.getItem(this.key);
      if (!text) return null;
      return validateSave(JSON.parse(text), worldKey);
    } catch (err) {
      console.warn('[save] ignoring unreadable save:', err.message);
      return null;
    }
  }

  save(data) {
    try {
      const payload = { ...data, version: SAVE_VERSION, savedAt: Date.now() };
      let text = JSON.stringify(payload);
      if (text.length > 450000) {
        // Too big for comfort: drop the trail, keep progress.
        text = JSON.stringify({ ...payload, trail: null });
      }
      this.storage?.setItem(this.key, text);
      return true;
    } catch (err) {
      console.warn('[save] could not write save:', err.message);
      return false;
    }
  }

  clear() {
    try {
      this.storage?.removeItem(this.key);
    } catch {
      /* storage unavailable - nothing to clear */
    }
  }
}
