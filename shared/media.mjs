import {ROLES} from './engine.mjs';
import {MUSIC_ASSETS} from './audio-assets.mjs';
import {CINEMATIC_AUDIO} from './cinematic-audio.mjs';

export const coverArt = '/art/camelot.webp';
export const portraitPaths = Object.keys(ROLES).map(role => `/art/night/${role}.webp`);
export const sceneArt = ['/art/night/round-hall.webp','/art/council-table.webp','/art/cinematics/court-props.webp'];
export const musicPaths = Object.values(MUSIC_ASSETS);
export const effectPaths = Object.values(CINEMATIC_AUDIO);

// Tabs opened before the art update can still request their original URLs.
export const previousMediaPaths = Object.fromEntries(
  [...portraitPaths, '/art/night/round-hall.webp', ...musicPaths]
    .map(path => [path.replace('/night/', '/'), path])
);
