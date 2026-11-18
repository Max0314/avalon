import {ROLES} from './engine.mjs';
import {MUSIC_ASSETS} from './audio-assets.mjs';

export const coverArt = '/art/camelot.webp';
export const portraitPaths = Object.keys(ROLES).map(role => `/art/${role}.webp`);
export const musicPaths = Object.values(MUSIC_ASSETS);
