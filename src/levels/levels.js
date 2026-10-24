// The archipelago. Each island teaches one season; the last one asks for all
// of them. Crossing segments are laid out from the shore towards the shrine
// islet in order, so the puzzle reads left-to-right as you walk it.
//
// segment types:
//   vine       - a bridge of vines that only grows under Spring light
//   ice        - still lagoon water that freezes into a walkable sheet in Winter
//   hedge      - a thornwall on the shore that only Autumn strips bare (then a causeway)
//   drawbridge - raised until the shore windmill has been spun up by Storm

export const SEASONS = ['spring', 'winter', 'autumn', 'storm'];

export const SEASON_INFO = {
  summer: { label: 'Summer', color: '#ffd27a' },
  spring: { label: 'Spring', color: '#9df07a', key: '1', verb: 'grows vines and wakes the flowers' },
  winter: { label: 'Winter', color: '#bfe8ff', key: '2', verb: 'freezes still water into ice' },
  autumn: { label: 'Autumn', color: '#ff9a3c', key: '3', verb: 'strips leaves and thorns bare' },
  storm: { label: 'Storm', color: '#b29cff', key: '4', verb: 'calls the wind and fills dry channels' },
};

export const LEVELS = [
  {
    id: 'verdant',
    name: 'Verdant Isle',
    season: 'spring',
    seed: 'verdant',
    terrain: { size: 300, resolution: 225, maxHeight: 22, coastIrregularity: 0.14 },
    crossingAngle: 0.78,
    segments: ['vine'],
    emberAt: 'oldTree',
    intro: 'A lantern lies on the dock. Its glass is cold - for now.',
    emberHint: 'The violet elder tree in the forest',
  },
  {
    id: 'frostmere',
    name: 'Frostmere',
    season: 'winter',
    seed: 'frostmere',
    terrain: { size: 300, resolution: 225, maxHeight: 28, coastIrregularity: 0.2, mountain: { x: -6, z: -10 } },
    crossingAngle: -0.25,
    segments: ['ice', 'ice'],
    emberAt: 'summit',
    intro: 'The lagoon on the east shore is calm enough to freeze, if only it were colder.',
    emberHint: 'The cairn on the summit',
  },
  {
    id: 'emberwood',
    name: 'Emberwood',
    season: 'autumn',
    seed: 'emberwood',
    terrain: { size: 300, resolution: 225, maxHeight: 20, coastIrregularity: 0.18, mountain: { x: 8, z: -20 } },
    crossingAngle: 0.78,
    segments: ['hedge', 'vine'],
    emberAt: 'caveRelic',
    intro: 'A thornwall seals the causeway. Something here remembers how to let go.',
    emberHint: 'Deep in the hidden hollow',
  },
  {
    id: 'galehaven',
    name: 'Galehaven',
    season: 'storm',
    seed: 'galehaven',
    terrain: { size: 300, resolution: 225, maxHeight: 26, coastIrregularity: 0.22, mountain: { x: 0, z: -12 } },
    crossingAngle: -0.25,
    segments: ['drawbridge', 'ice'],
    emberAt: 'lighthouseDoor',
    intro: 'The old windmill stands still. The drawbridge beside it has not come down in years.',
    emberHint: 'At the foot of the lighthouse',
  },
  {
    id: 'stormpeak',
    name: 'Stormpeak',
    season: null,
    seed: 'stormpeak',
    terrain: { size: 300, resolution: 225, maxHeight: 34, coastIrregularity: 0.2, mountain: { x: 4, z: -14 } },
    crossingAngle: 0.78,
    segments: ['hedge', 'vine', 'ice', 'drawbridge'],
    emberAt: null,
    intro: 'Every season you carry will be needed. The last shrine waits beyond four crossings.',
    emberHint: null,
  },
];

/** Seasons available on a level: everything learned before it, plus its own once the ember is found. */
export function seasonsFor(levelIndex, emberFound) {
  const learned = LEVELS.slice(0, levelIndex).map((l) => l.season).filter(Boolean);
  const own = LEVELS[levelIndex]?.season;
  if (own && emberFound) learned.push(own);
  return learned;
}
