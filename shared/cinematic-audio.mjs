export const CINEMATIC_AUDIO = Object.freeze(Object.fromEntries([
  'paper', 'seal', 'card', 'wax', 'scroll', 'vote-yes', 'vote-no', 'shield-light', 'shield-dark',
  'water', 'oath', 'crown-light', 'crown-dark',
].map(name=>[name,`/audio/cinematics/${name}.mp3`])));
