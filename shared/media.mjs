import {ROLES} from './engine.mjs';
import {MUSIC_ASSETS} from './audio-assets.mjs';
import {CINEMATIC_AUDIO} from './cinematic-audio.mjs';

export const coverArt = '/art/camelot.webp';
export const portraitPaths = Object.keys(ROLES).map(role => `/art/${role}.webp`);
export const sceneArt = ['/art/round-hall.webp','/art/cinematics/court-props.webp'];
export const musicPaths = Object.values(MUSIC_ASSETS);
export const effectPaths = Object.values(CINEMATIC_AUDIO);
