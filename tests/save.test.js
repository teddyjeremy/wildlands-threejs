import { describe, it, expect } from 'vitest';
import { validateSave, SaveStore, SAVE_VERSION, DEFAULT_SETTINGS, sanitizeSettings } from '../src/systems/save.js';

const KEY = 'wildlands|240|180';
const good = () => ({
  version: SAVE_VERSION,
  seed: 'wildlands',
  worldKey: KEY,
  settings: { ...DEFAULT_SETTINGS, quality: 'high' },
  discovered: ['dock-note', 'summit'],
  collected: ['sea-glass'],
  player: { x: 1, y: 2, z: 3, heading: 0.5 },
  timeOfDay: 0.4,
  trail: { res: 320, cellSize: 0.75, data: '-100,50,-20' },
});

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

describe('save validation', () => {
  it('accepts a well-formed save', () => {
    const s = validateSave(good(), KEY);
    expect(s.discovered).toEqual(['dock-note', 'summit']);
    expect(s.collected).toEqual(['sea-glass']);
    expect(s.settings.quality).toBe('high');
    expect(s.player).toEqual({ x: 1, y: 2, z: 3, heading: 0.5 });
  });

  it('rejects junk', () => {
    for (const bad of [null, 42, 'x', [], {}, { version: 99, seed: 'a' }, { version: SAVE_VERSION }, { version: 'two', seed: 'a' }]) {
      expect(validateSave(bad, KEY)).toBeNull();
    }
  });

  it('drops progress from a different world but keeps settings', () => {
    const s = validateSave({ ...good(), worldKey: 'other' }, KEY);
    expect(s.discovered).toEqual([]);
    expect(s.collected).toEqual([]);
    expect(s.player).toBeNull();
    expect(s.trail).toBeNull();
    expect(s.settings.quality).toBe('high');
  });

  it('sanitises bad fields individually', () => {
    const s = validateSave({ ...good(), discovered: ['ok', 5, null, 'ok'], player: { x: 'a' }, settings: { quality: 'ultra', masterVolume: 7, muted: 'yes' } }, KEY);
    expect(s.discovered).toEqual(['ok']);
    expect(s.player).toBeNull();
    expect(s.settings.quality).toBe(DEFAULT_SETTINGS.quality);
    expect(s.settings.masterVolume).toBe(1);
    expect(s.settings.muted).toBe(false);
  });

  it('migrates a v1 save', () => {
    const s = validateSave({ version: 1, seed: 'wildlands', worldKey: KEY, found: ['summit'] }, KEY);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.discovered).toEqual(['summit']);
  });

  it('sanitizeSettings fills defaults', () => {
    expect(sanitizeSettings(undefined)).toEqual({ ...DEFAULT_SETTINGS });
  });
});

describe('SaveStore', () => {
  it('round-trips through storage', () => {
    const store = new SaveStore(memoryStorage());
    expect(store.save(good())).toBe(true);
    const back = store.load(KEY);
    expect(back.collected).toEqual(['sea-glass']);
    store.clear();
    expect(store.load(KEY)).toBeNull();
  });

  it('survives corrupt JSON and throwing storage', () => {
    const mem = memoryStorage();
    mem.setItem('wildlands.save', '{oops');
    expect(new SaveStore(mem).load(KEY)).toBeNull();
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); }, removeItem: () => {} };
    const s = new SaveStore(throwing);
    expect(s.load(KEY)).toBeNull();
    expect(s.save(good())).toBe(false);
  });
});
