import {ROLES} from './engine.mjs';
import {MUSIC_ASSETS} from './audio-assets.mjs';
import {CINEMATIC_AUDIO} from './cinematic-audio.mjs';

export const coverArt = '/art/camelot.webp';
const previousPortraits = Object.keys(ROLES).map(role => `/art/night/${role}.webp`);
export const rolePortraits = Object.fromEntries(Object.keys(ROLES).map(role => {
  const count = {servant:4, minion:3}[role] ?? 1;
  const paths = Array.from({length:count}, (_,index) => `/art/court/${role}${index ? '-'+(index+1) : ''}.webp`);
  return [role, paths];
}));
export function roleArt(role, variant = 0) {
  if (!Object.hasOwn(rolePortraits, role)) return null;
  const paths = rolePortraits[role];
  return paths[Math.max(0,variant) % paths.length];
}
export const ladyArt = '/art/court/lady.webp';
export const portraitPaths = [...previousPortraits, ...Object.values(rolePortraits).flat(), ladyArt];
export const sceneArt = [
  '/art/night/round-hall.webp', '/art/court/hall-day.webp', '/art/court/gate-day.webp', '/art/court/gate-night.webp',
  '/art/council-table.webp', '/art/cinematics/court-props.webp',
];
export const musicPaths = Object.values(MUSIC_ASSETS);
export const effectPaths = Object.values(CINEMATIC_AUDIO);

// Tabs opened before the art update can still request their original URLs.
export const previousMediaPaths = Object.fromEntries(
  [...previousPortraits, '/art/night/round-hall.webp', ...musicPaths]
    .map(path => [path.replace('/night/', '/'), path])
);
