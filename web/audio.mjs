import {MUSIC_ASSETS} from '../shared/audio-assets.mjs';
import {CINEMATIC_AUDIO} from '../shared/cinematic-audio.mjs';

const SETTINGS_KEY = new URLSearchParams(globalThis.location?.search).has('display')
  ? 'avalon.audio.display.v1' : 'avalon.audio.v1';
const DEFAULTS = {track:'auto',music:true,effects:true,musicVolume:34,effectsVolume:55,privateEffects:true};
const CROSSFADE = .48;
export const AUDIO_TRACKS = Object.freeze({auto:'随对局切换',hall:'烛下圆桌',quest:'夜渡关隘',dusk:'铁钟密誓'});

const SCENE_TRACK = {
  nominate:'quest', vote:'quest', quest:'quest', questResult:'quest',
  lady:'dusk', assassin:'dusk', finished:'dusk',
};

// Each note specifies pitch, offset, duration and strength. Secret choices use the same cue.
const CUES = {
  click:[[62,0,.12,.095]],
  pick:[[69,0,.19,.105],[74,.028,.16,.044]],
  deal:[[50,0,.26,.13],[57,.08,.29,.13],[62,.16,.45,.125]],
  submit:[[55,0,.14,.12],[67,.055,.19,.073]],
  approve:[[62,0,.27,.12],[69,.07,.29,.12],[74,.15,.37,.14]],
  reject:[[64,0,.24,.12],[60,.10,.24,.11],[53,.20,.36,.14]],
  success:[[62,0,.29,.115],[66,.085,.30,.11],[69,.17,.34,.12],[74,.27,.58,.12]],
  failure:[[57,0,.32,.13],[53,.105,.34,.115],[50,.22,.57,.13]],
  reveal:[[50,0,.32,.115],[57,.09,.36,.105],[65,.19,.47,.10]],
  win:[[62,0,.29,.12],[69,.10,.30,.12],[74,.20,.34,.13],[78,.29,.63,.12]],
  lose:[[57,0,.29,.12],[55,.13,.31,.11],[50,.26,.63,.13]],
  reconnect:[[67,0,.15,.09],[74,.08,.28,.10]],
};

function normalize(value, fallback = DEFAULTS) {
  const volume = key => Number.isFinite(value?.[key])
    ? Math.round(Math.min(100,Math.max(0,value[key]))) : fallback[key];
  return {
    track:typeof value?.track === 'string' && Object.hasOwn(AUDIO_TRACKS,value.track) ? value.track : fallback.track,
    music:typeof value?.music === 'boolean' ? value.music : fallback.music,
    effects:typeof value?.effects === 'boolean' ? value.effects : fallback.effects,
    musicVolume:volume('musicVolume'),
    effectsVolume:volume('effectsVolume'),
    privateEffects:typeof value?.privateEffects === 'boolean' ? value.privateEffects : fallback.privateEffects,
  };
}

let settings = {...DEFAULTS};
try { settings = normalize(JSON.parse(globalThis.localStorage?.getItem(SETTINGS_KEY) ?? 'null')); }
catch { /* Storage is optional. */ }

let scene = 'home';
let winner = null;
let backgroundPaused = false;
let context, musicBus, effectBus;
let pendingTrack, playing;
const songBuffers = new Map();
const activeSongs = new Set();
const activeNotes = new Set();
const loadedCues = new Map();
const cueLoads = new Map();
const materialSources = new Map();

export function getAudioSettings() { return {...settings}; }

export function setAudioSettings(patch,event) {
  settings = normalize(patch,settings);
  try { globalThis.localStorage?.setItem(SETTINGS_KEY,JSON.stringify(settings)); }
  catch { /* The settings still apply for this page. */ }
  applyLevels();
  if(event?.isTrusted)unlockAudio(event);
  syncMusic();
  if (!settings.effects || !settings.effectsVolume) stopNotes();
  else if (!settings.privateEffects) {
    for (const [source,own] of materialSources) if (own) stopMaterial(source);
    for (const note of activeNotes) if (note.private) stopNote(note);
  }
  return getAudioSettings();
}

export function setAudioScene(phase, ending={}) {
  const side = phase==='finished' ? ending.winner??null : null;
  if (scene === phase && side === winner) return;
  scene = phase;
  winner = side;
  syncMusic();
}

export function pauseBackgroundAudio() {
  backgroundPaused = true;
  syncMusic();
}

function currentTrack() {
  if (backgroundPaused || document.hidden || !settings.music || !settings.musicVolume) return null;
  if (settings.track !== 'auto') return settings.track;
  if (scene==='finished' && winner==='good') return 'quest';
  return SCENE_TRACK[scene] ?? 'hall';
}

function applyLevels() {
  if (!context) return;
  const now = context.currentTime;
  for (const [bus,level] of [[musicBus,settings.musicVolume],[effectBus,settings.effectsVolume]]) {
    bus.gain.cancelScheduledValues(now);
    bus.gain.setTargetAtTime((level / 100) ** 1.4,now,.025);
  }
}

function loadSong(track) {
  if (!songBuffers.has(track)) {
    const promise = fetch(MUSIC_ASSETS[track]).then(response => {
      if (!response.ok) throw new Error('Soundtrack unavailable');
      return response.arrayBuffer();
    }).then(bytes => context.decodeAudioData(bytes)).catch(error => {
      songBuffers.delete(track);
      throw error;
    });
    songBuffers.set(track,promise);
  }
  return songBuffers.get(track);
}

function endSong(song, fade) {
  const now = context.currentTime;
  if (fade) {
    const volume = Math.min(1,Math.max(0,(now-song.started)/CROSSFADE));
    song.gain.cancelScheduledValues(now);
    song.gain.setValueAtTime(volume,now);
    song.gain.linearRampToValueAtTime(0,now+CROSSFADE);
    song.source.stop(now+CROSSFADE);
  } else {
    song.source.stop();
  }
}

function startSong(track, buffer) {
  const source = context.createBufferSource();
  const gain = context.createGain();
  const started = context.currentTime;
  const song = {track,source,gain:gain.gain,started};
  source.buffer = buffer;
  source.loop = true;
  source.connect(gain);
  gain.connect(musicBus);
  gain.gain.setValueAtTime(0,started);
  gain.gain.linearRampToValueAtTime(1,started+CROSSFADE);
  source.onended = () => {
    activeSongs.delete(song);
    source.disconnect();
    gain.disconnect();
  };
  source.start();
  activeSongs.add(song);
  if (playing) endSong(playing,true);
  playing = song;
}

function stopMusic() {
  pendingTrack = null;
  playing = null;
  for (const song of activeSongs) endSong(song,false);
  activeSongs.clear();
}

function syncMusic() {
  if (!context) return;
  const track = currentTrack();
  if (!track) { stopMusic(); return; }
  if (context.state !== 'running' || pendingTrack?.track === track) return;
  if (playing?.track === track) { pendingTrack = null; return; }
  const request = {track};
  pendingTrack = request;
  void loadSong(track).then(buffer => {
    if (pendingTrack === request && currentTrack() === track && context.state === 'running') {
      startSong(track,buffer);
    }
  }).catch(() => { /* The next gesture or scene can retry the download. */ }).finally(() => {
    if (pendingTrack === request) pendingTrack = null;
  });
}

function startContext() {
  if (context || document.hidden || !(settings.music || settings.effects)) return;
  const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Audio) return;
  try {
    const audio = new Audio();
    const music = audio.createGain();
    const effects = audio.createGain();
    music.gain.value = 0;
    effects.gain.value = 0;
    music.connect(audio.destination);
    effects.connect(audio.destination);
    context = audio;
    musicBus = music;
    effectBus = effects;
    applyLevels();
  } catch { /* Audio availability must not block gameplay. */ }
}

function resumeAudio() {
  if (!context || document.hidden || !(settings.music || settings.effects)) return;
  if (context.state === 'running') syncMusic();
  else void context.resume().then(syncMusic).catch(() => {});
}

function unlockAudio(event) {
  if (!event.isTrusted) return;
  startContext();
  resumeAudio();
}

function soundNote([pitch,offset,duration,level], now, own) {
  const begin = now+offset;
  const frequency = 440 * 2 ** ((pitch-69)/12);
  const oscillator = context.createOscillator();
  const shimmer = context.createOscillator();
  const gain = context.createGain();
  const overtone = context.createGain();
  oscillator.frequency.value = frequency;
  shimmer.frequency.value = frequency * 2.007;
  gain.gain.setValueAtTime(.0001,begin);
  gain.gain.exponentialRampToValueAtTime(level,begin+.009);
  gain.gain.exponentialRampToValueAtTime(.0001,begin+duration);
  overtone.gain.value = .22;
  oscillator.connect(gain);
  shimmer.connect(overtone);
  overtone.connect(gain);
  gain.connect(effectBus);
  const note = {oscillator,shimmer,private:own};
  oscillator.onended = () => {
    activeNotes.delete(note);
    oscillator.disconnect();
    shimmer.disconnect();
    overtone.disconnect();
    gain.disconnect();
  };
  activeNotes.add(note);
  oscillator.start(begin);
  shimmer.start(begin);
  oscillator.stop(begin+duration);
  shimmer.stop(begin+duration);
  return note;
}

function stopNote(note) {
  if(!activeNotes.delete(note))return;
  note.oscillator.stop();
  note.shimmer.stop();
}

function stopMaterial(source) {
  if(materialSources.delete(source))source.stop();
}

function stopNotes() {
  for (const note of activeNotes) stopNote(note);
  for (const source of materialSources.keys()) stopMaterial(source);
}

export function preloadCue(name) {
  if (!Object.hasOwn(CINEMATIC_AUDIO,name) || !context || !settings.effects || loadedCues.has(name)) return;
  if (cueLoads.has(name)) return cueLoads.get(name);
  const load = fetch(CINEMATIC_AUDIO[name]).then(response => {
    if (!response.ok) throw new Error('Cue unavailable');
    return response.arrayBuffer();
  }).then(buffer => context.decodeAudioData(buffer)).then(buffer => {
    loadedCues.set(name,buffer);
  }).catch(()=>{}).finally(()=>cueLoads.delete(name));
  cueLoads.set(name,load);
  return load;
}

export function playCue(name, options={}) {
  const own = options.private === true;
  if (!settings.effects || !settings.effectsVolume || own&&!settings.privateEffects ||
      context?.state !== 'running' || document.hidden) return;
  if (Object.hasOwn(CINEMATIC_AUDIO,name)) {
    const sample = loadedCues.get(name);
    if (!sample) { void preloadCue(name); return; }
    const source = context.createBufferSource();
    source.buffer = sample;
    source.connect(effectBus);
    source.onended = () => { materialSources.delete(source); source.disconnect(); };
    materialSources.set(source,own);
    source.start();
    return ()=>stopMaterial(source);
  }
  if (Object.hasOwn(CUES,name)) {
    const now = context.currentTime;
    const playing = CUES[name].map(note=>soundNote(note,now,own));
    return ()=>playing.forEach(stopNote);
  }
}

if (globalThis.document) {
  for (const event of ['pointerup','click','keydown']) document.addEventListener(event,unlockAudio,{capture:true,passive:true});
  document.addEventListener('visibilitychange',() => {
    if (document.hidden) { stopMusic(); stopNotes(); }
    else resumeAudio();
  });
}
