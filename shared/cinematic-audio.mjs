export const CINEMATIC_AUDIO = Object.freeze(Object.fromEntries([
  'paper', 'seal', 'card', 'wax', 'scroll', 'vote-yes', 'vote-no', 'shield-light', 'shield-dark',
  'water', 'oath', 'crown-light', 'crown-dark',
  'handbook-lift-1', 'handbook-lift-2', 'handbook-turn-1', 'handbook-turn-2', 'handbook-turn-3', 'handbook-turn-4',
].map(name=>[name,`/audio/cinematics/${name}.mp3`])));
