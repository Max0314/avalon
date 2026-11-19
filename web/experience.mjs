import {CINEMATIC_AUDIO} from '../shared/cinematic-audio.mjs';
import {MUSIC_ASSETS} from '../shared/audio-assets.mjs';
import {AUDIO_TRACKS,getAudioSettings,pauseBackgroundAudio} from './audio.mjs';
import {createSceneDirector,scenePreviews} from './scenes.mjs';

export const EXPERIENCE_PATH = '/?preview=effects';

const groups = {scene:'动画', cue:'音效', score:'配乐'};
const sounds = {
  paper:'手册翻页', seal:'开启信封', card:'翻开卡牌', wax:'表决封蜡', scroll:'展开卷轴',
  'vote-yes':'表决通过', 'vote-no':'表决未通过', 'shield-light':'任务成功',
  'shield-dark':'任务失败', water:'湖面查验', oath:'终局指认', 'crown-light':'好人胜利', 'crown-dark':'邪恶胜利',
};
const tracks = {
  hall:'大厅与身份确认 · 拨弦与弓弦',
  quest:'组队与出征 · 弦乐与行进鼓点',
  dusk:'查验与终局 · 低音弓弦与远钟',
};
const items = {
  scene:scenePreviews,
  cue:Object.fromEntries(Object.entries(sounds).map(([id,label])=>[id,{label,src:CINEMATIC_AUDIO[id]}])),
  score:Object.fromEntries(Object.entries(tracks).map(([id,detail])=>[id,{label:AUDIO_TRACKS[id],detail,src:MUSIC_ASSETS[id]}])),
};

export function mountExperience(root) {
  pauseBackgroundAudio();
  const preferences = getAudioSettings();
  const selected = {scene:'deal', cue:'paper', score:'hall'};
  let group = 'scene';
  let playing = false;
  let playId = 0;
  let audio;
  document.body.dataset.view = 'experience';
  root.dataset.screen = 'experience';
  root.innerHTML = `<section class="experience" aria-labelledby="experience-title">
    <header class="experience-header">
      <a class="button-link" href="/">‹ 阿瓦隆首页</a>
      <div><h1 id="experience-title">视听体验</h1><p>预览游戏演出，单独试听音效和配乐。</p></div>
    </header>
    <div class="experience-tabs" role="group" aria-label="体验类别">
      ${Object.entries(groups).map(([id,label])=>`<button type="button" data-experience-group="${id}">${label}</button>`).join('')}
    </div>
    <div class="experience-main">
      <div class="experience-player">
        <div id="experience-stage" class="experience-stage" aria-label="预览区域">
          <div class="experience-idle"><span class="brand-mark" aria-hidden="true"></span><strong id="experience-label"></strong><small id="experience-detail"></small></div>
        </div>
        <div class="experience-controls">
          <div class="experience-actions">
            <button id="experience-play" class="primary" type="button">播放动画</button>
            <button id="experience-stop" type="button" disabled>停止</button>
            <span id="experience-status" role="status"></span>
          </div>
          <progress id="experience-progress" max="1" value="0" aria-label="试听进度" hidden></progress>
          <div class="experience-options">
            <label id="experience-synced"><input id="experience-sound" type="checkbox"${preferences.effects?' checked':''}>伴随音效</label>
            <label class="experience-volume">试听音量 <output id="experience-volume-value"></output>
              <input id="experience-volume" type="range" min="0" max="100" value="${preferences.effectsVolume}">
            </label>
          </div>
        </div>
      </div>
      <div class="experience-list" id="experience-list" aria-label="可选项目" role="group"></div>
    </div>
  </section>`;
  const get = id => root.querySelector('#experience-'+id);
  const stage = get('stage');
  const list = get('list');
  const volume = get('volume');
  const progress = get('progress');
  const director = createSceneDirector({previewStage:stage});

  function status(value, active = false) {
    playing = active;
    get('status').textContent = value;
    get('stop').disabled = !active;
    get('play').textContent = active ? '重新播放' : group === 'scene' ? '播放动画' : '试听';
  }
  function releaseAudio() {
    playId += 1;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    audio = undefined;
  }
  function stop(message = '') {
    director.reset();
    releaseAudio();
    progress.value = 0;
    status(message);
  }
  function applyVolume() {
    get('volume-value').value = volume.value+'%';
    if (audio) audio.volume = (volume.valueAsNumber/100)**1.4;
  }
  function playAudio(source, animation) {
    audio = new Audio(source);
    const current = audio;
    const id = ++playId;
    applyVolume();
    current.ontimeupdate = () => {
      if (id === playId && current.duration > 0) progress.value = current.currentTime/current.duration;
    };
    current.onended = () => {
      if (id !== playId || animation) return;
      progress.value = 1;
      status('播放完毕');
    };
    void current.play().catch(() => {
      if (id !== playId) return;
      status('音频暂时无法播放',animation && playing);
    });
  }
  function play() {
    stop();
    const id = selected[group];
    const entry = items[group][id];
    status('播放中',true);
    if (group !== 'scene') { playAudio(entry.src,false); return; }
    if (!director.preview(id, () => {
      releaseAudio();
      status('播放完毕');
    })) { status('请重试'); return; }
    if (get('sound').checked) playAudio(CINEMATIC_AUDIO[entry.cue],true);
  }
  function updateChoice() {
    const id = selected[group];
    const entry = items[group][id];
    get('label').textContent = entry.label;
    get('detail').textContent = group === 'scene' ? entry.title === entry.label ? entry.detail ?? '' : entry.title : entry.detail ?? '';
    for (const button of list.querySelectorAll('[data-experience-item]')) {
      button.setAttribute('aria-pressed',String(button.dataset.experienceItem === id));
    }
  }
  function showGroup(id) {
    group = id;
    stop();
    for (const button of root.querySelectorAll('[data-experience-group]')) {
      button.setAttribute('aria-pressed',String(button.dataset.experienceGroup === group));
    }
    list.innerHTML = Object.entries(items[group]).map(([key,{label,detail}])=>
      `<button type="button" data-experience-item="${key}"><span>${label}</span>${group === 'score'? `<small>${detail}</small>` : ''}</button>`).join('');
    list.scrollTop = 0;
    get('synced').hidden = group !== 'scene';
    progress.hidden = group === 'scene';
    updateChoice();
  }
  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    const {experienceGroup,experienceItem} = button.dataset;
    if (experienceGroup && experienceGroup !== group) showGroup(experienceGroup);
    if (experienceItem) {
      if (selected[group] !== experienceItem) stop();
      selected[group] = experienceItem;
      updateChoice();
    }
  });
  get('play').addEventListener('click',play);
  get('stop').addEventListener('click',() => stop('已停止'));
  get('sound').addEventListener('change',event => { if (!event.target.checked) releaseAudio(); });
  volume.addEventListener('input',applyVolume);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('pagehide', () => stop());
  applyVolume();
  showGroup(group);
}
