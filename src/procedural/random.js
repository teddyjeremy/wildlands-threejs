// Small seeded PRNG helpers. Everything that shapes the world goes through
// these instead of Math.random so a seed always rebuilds the same island.

/** Turn any string/number into a 32-bit seed (FNV-1a). */
export function hashSeed(value) {
  const str = String(value);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 - tiny, fast and good enough for placement work. */
export function createRandom(seed) {
  let a = hashSeed(seed) || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    /** Derive an independent stream so sub-systems don't shift each other. */
    fork: (label) => createRandom(`${seed}:${label}`),
  };
}
