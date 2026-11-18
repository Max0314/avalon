import assert from 'node:assert/strict';
import {test} from 'node:test';

const tick = () => new Promise(resolve => setImmediate(resolve));

test('sound waits for a gesture, respects both channels and discards obsolete track loads', async () => {
  const saved = new Map();
  const loaded = new Map();
  const requested = [];
  const songs = [];
  const oscillators = [];
  const listeners = new Map();
  let opened = 0;
  const param = () => ({
    setValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {},
    linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {},
  });
  const node = () => ({
    start() { this.started = true; },
    stop(at) { this.stopped = at ?? true; },
    connect() {}, disconnect() {},
  });
  class TestContext {
    currentTime = 3;
    state = 'suspended';
    destination = {};
    constructor() { opened += 1; }
    async resume() { this.state = 'running'; }
    createGain() { return {...node(),gain:param()}; }
    createBufferSource() {
      const source = node();
      songs.push(source);
      return source;
    }
    createOscillator() {
      const oscillator = {...node(),frequency:param()};
      oscillators.push(oscillator);
      return oscillator;
    }
    async decodeAudioData(bytes) { return bytes; }
  }
  const globals = {
    document:{hidden:false,addEventListener:(name,handler) => listeners.set(name,handler)},
    location:{search:''},
    localStorage:{getItem:key => saved.get(key),setItem:(key,value) => saved.set(key,value)},
    AudioContext:TestContext,
    fetch:url => {
      requested.push(url);
      return new Promise(resolve => loaded.set(url,() => resolve({ok:true,arrayBuffer:async () => url})));
    },
  };
  const previous = Object.fromEntries(Object.keys(globals).map(name => [name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  for (const [name,value] of Object.entries(globals)) Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
  try {
    const audio = await import('../web/audio.mjs?test');
    audio.setAudioScene('lobby');
    audio.playCue('click');
    listeners.get('click')({isTrusted:false});
    assert.equal(opened,0);
    assert.deepEqual(requested,[]);

    listeners.get('click')({isTrusted:true});
    await tick();
    assert.equal(opened,1);
    assert.deepEqual(requested,['/audio/night/hall.mp3']);

    audio.setAudioScene('vote');
    assert.deepEqual(requested,['/audio/night/hall.mp3','/audio/night/quest.mp3']);
    loaded.get('/audio/night/hall.mp3')();
    await tick();
    assert.equal(songs.length,0);
    loaded.get('/audio/night/quest.mp3')();
    await tick();
    assert.equal(songs[0].buffer,'/audio/night/quest.mp3');
    assert.equal(songs[0].loop,true);

    audio.setAudioSettings({track:'hall',effects:false,musicVolume:62});
    await tick();
    assert.equal(songs.length,2);
    assert.equal(songs[1].buffer,'/audio/night/hall.mp3');
    assert.equal(songs[0].stopped,3.48);
    assert.deepEqual(JSON.parse(saved.get('avalon.audio.v1')),{
      track:'hall',music:true,effects:false,musicVolume:62,effectsVolume:55,privateEffects:true,
    });
    audio.playCue('reveal');
    assert.equal(oscillators.length,0);

    audio.setAudioSettings({effects:true,music:false});
    assert.equal(songs[1].stopped,true);
    audio.playCue('submit');
    assert.equal(oscillators.every(oscillator => oscillator.started),true);
    assert.equal(oscillators.length,4);

    globals.document.hidden = true;
    listeners.get('visibilitychange')();
    assert.equal(oscillators.every(oscillator => oscillator.stopped === true),true);
    audio.setAudioSettings({music:true});
    audio.playCue('success');
    assert.equal(oscillators.length,4);
    assert.equal(songs.length,2);
    globals.document.hidden = false;
    listeners.get('visibilitychange')();
    await tick();
    assert.equal(songs[2].buffer,'/audio/night/hall.mp3');
    assert.equal(requested.length,2);

    const preload=audio.preloadCue('wax');
    assert.equal(requested.at(-1),'/audio/cinematics/wax.mp3');
    loaded.get('/audio/cinematics/wax.mp3')();
    await preload;
    const privateCue=audio.playCue('wax',{private:true});
    const voice=songs.at(-1);
    assert.equal(voice.buffer,'/audio/cinematics/wax.mp3');
    const publicCue=audio.playCue('wax');
    const publicVoice=songs.at(-1);
    audio.setAudioSettings({privateEffects:false});
    assert.equal(voice.stopped,true);
    assert.equal(publicVoice.stopped,undefined);
    assert.equal(audio.playCue('wax',{private:true}),undefined);
    assert.equal(songs.at(-1),publicVoice);
    privateCue();
    publicCue();

    saved.set('avalon.audio.v1',JSON.stringify({music:false,effects:false}));
    const muted=await import('../web/audio.mjs?starts-muted');
    listeners.get('click')({isTrusted:true});
    assert.equal(opened,1);
    muted.setAudioSettings({music:true},{isTrusted:true});
    await tick();
    assert.equal(opened,2);
    assert.equal(requested.at(-1),'/audio/night/hall.mp3');

    const playerPrefs=saved.get('avalon.audio.v1');
    globals.location.search='?display=cast';
    const display=await import('../web/audio.mjs?display-prefs');
    display.setAudioSettings({music:false,effectsVolume:22});
    assert.equal(JSON.parse(saved.get('avalon.audio.display.v1')).effectsVolume,22);
    assert.equal(saved.get('avalon.audio.v1'),playerPrefs);
  } finally {
    for (const [name,descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis,name,descriptor);
      else delete globalThis[name];
    }
  }
});
