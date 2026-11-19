import {playCue, preloadCue, setAudioScene} from './audio.mjs';
import {ROLES} from '../shared/engine.mjs';
import {ladyArt,roleArt} from '../shared/media.mjs';

const HALL = '/art/night/round-hall.webp';
const CASTLE = '/art/camelot.webp';
const PROPS = '/art/cinematics/court-props.webp';

const timings = {
  deal:1900, identity:1650, receipt:710, ballot:1550, verdict:2000,
  quest:2330, lake:1900, oath:1900, ending:2700, notice:1350,
};

const roomName = (view, id) => view.players?.find(player => player.id === id)?.name ?? '该玩家';
const notice = (title, detail) => ({kind:'notice', title, detail, mode:'light', icon:'seal', tone:'gold'});
const receipt = (title, cue, result) => ({kind:'receipt', title, cue, mode:result?'table':'light',
  prop:'letter', private:true, icon:'seal', tone:'gold'});

function newVote(before, game, me, proposal) {
  return before.phase === 'vote' && !before.voted?.includes(me)
    && (game.voted?.includes(me) || Object.hasOwn(proposal?.votes ?? {},me));
}

function newQuestCard(before, game, me, result) {
  return before.phase === 'quest' && before.team?.includes(me) && !before.questSubmitted?.includes(me)
    && (game.questSubmitted?.includes(me) || result?.team?.includes(me));
}

function finishScene(view, game) {
  const good = game.winner === 'good';
  const causes = {
    'five-rejections':'连续五次组队未通过',
    'three-fails':'三次任务失败',
    'merlin-assassinated':`${roomName(view, game.assassinated)} 被指认，梅林身份公开`,
    'merlin-survived':`${roomName(view, game.assassinated)} 被指认，梅林躲过最后一击`,
  };
  return {kind:'ending', mode:'critical', tone:good?'good':'evil', prop:good?'gold-crown':'iron-crown',
    cue:good?'crown-light':'crown-dark', winner:game.winner, icon:'seal',
    title:good?'好人守住了卡美洛':'邪恶笼罩了卡美洛', detail:causes[game.reason]};
}

/** Only derive events from changes between two live projections for the same audience. */
export function sceneEvents(previous, next, {live=true, publicOnly=false}={}) {
  if (!live || !previous || previous.id!==next?.id || previous.me!==next.me || next.closed
      || next.version<=previous.version) return [];
  const game = next.game;
  if (!game) return [];
  const before = previous.game;
  if (!before) {
    if (game.phase!=='reveal') return [];
    return [{kind:'deal',mode:'critical',tone:'gold',prop:'letter',cue:'seal',icon:'seal',
      title:'封缄入席',detail:publicOnly?'玩家正在确认身份':'信已抵达。请在自己的设备查看身份。'}];
  }
  if (game.id!==before.id) return [];

  const events = [];
  const proposal = (game.proposals?.length??0)===(before.proposals?.length??0)+1 ? game.proposals.at(-1) : null;
  const result = (game.results?.length??0)===(before.results?.length??0)+1 ? game.results.at(-1) : null;
  const me = next.me;

  if (!publicOnly && me) {
    const role = Object.hasOwn(ROLES,game.myRole) ? ROLES[game.myRole] : null;
    if (role && before.phase==='reveal' && game.confirmed?.includes(me) && !before.confirmed?.includes(me)) {
      events.push({kind:'identity',mode:'table',tone:'gold',private:true,prop:'letter',cue:'card',icon:'seal',
        portrait:roleArt(game.myRole,next.players?.findIndex(player => player.id === me) ?? 0),
        title:'身份已确认',detail:role.name});
    }
    if (newVote(before,game,me,proposal)) events.push(receipt('你的表决已封存','wax',proposal));
    if (newQuestCard(before,game,me,result)) events.push(receipt('你的任务牌已封存','card',result));
    const intel = game.privateIntel?.at(-1);
    if (intel && before.phase==='lady' && before.ladyHolder===me &&
        game.privateIntel.length===(before.privateIntel?.length??0)+1) {
      events.push({kind:'lake',mode:'table',tone:'gold',private:true,prop:'bowl',cue:'water',icon:'seal',
        portrait:ladyArt,title:'镜水映照',detail:`${roomName(next,intel.playerId)} · ${intel.side==='good'?'好人阵营':'邪恶阵营'}`});
    }
  }

  if (proposal) {
    const forCount = Object.values(proposal.votes??{}).filter(Boolean).length;
    const total = Object.keys(proposal.votes??{}).length;
    const approved = proposal.approved;
    events.push({kind:'verdict',mode:'table',tone:approved?'good':'evil',prop:'scroll',
      cue:approved?'vote-yes':'vote-no',icon:approved?'pass':'fail',count:total?`${forCount} : ${total-forCount}`:'',
      title:approved?'出征队伍通过':'出征队伍未通过',
      detail:total?'赞成 · 反对':undefined});
  }
  if (result) {
    const success = result.success;
    events.push({kind:'quest',mode:'table',tone:success?'good':'evil',prop:'shield',
      cue:success?'shield-light':'shield-dark',icon:success?'pass':'fail',
      count:`${result.successes} : ${result.fails}`,title:`第 ${result.quest} 次任务${success?'成功':'失败'}`,detail:'成功牌 · 失败牌'});
  }
  if (game.phase===before.phase) return events;
  if (game.phase==='finished') events.push(finishScene(next,game));
  else if (game.phase==='vote') events.push({kind:'ballot',mode:'table',tone:'gold',
    prop:'scroll',cue:'scroll',icon:'seal',title:'队伍表决',detail:'全员提交后同时揭票'});
  else if (game.phase==='lady') events.push({kind:'lake',mode:'light',tone:'good',
    prop:'bowl',cue:'water',icon:'seal',title:'湖中仙女',detail:`${roomName(next,game.ladyHolder)} 持有查验权`});
  else if (game.phase==='assassin') events.push({kind:'oath',mode:'table',tone:'evil',
    prop:'iron-crown',cue:'oath',icon:'seal',title:'最后的指认',detail:'等待刺客作出选择'});
  else if (game.phase==='nominate' && !proposal && !events.length) {
    events.push(notice('队长组队',`${roomName(next,game.leaderId)} 挑选 ${game.needed} 位出征队员`));
  }
  return events;
}

/** A single FIFO for authoritative effects. Public notices yield to any accepted action. */
export function createSceneQueue({present, duration, onIdle=()=>{}, clock=globalThis}) {
  let pending = [];
  let active = null;

  function begin() {
    if (active) return;
    const entry = pending.shift();
    if (!entry) { onIdle(); return; }
    const turn = {entry, cancel:null, timer:null};
    active = turn;
    turn.cancel = present(entry, () => { if (turn===active) finish(true); });
    turn.timer = clock.setTimeout(() => { if (turn===active) finish(false); },duration(entry));
  }

  function finish(immediate, advance=true) {
    if (active) {
      const finished = active;
      active = null;
      clock.clearTimeout(finished.timer);
      finished.cancel?.(immediate);
    }
    if (advance) begin();
  }

  return {
    push(entries) {
      if (!entries.length) return;
      pending = pending.filter(entry=>entry.kind!=='notice');
      pending.push(...entries);
      if (active?.entry.kind==='notice') finish(true);
      else begin();
    },
    reset() { pending = []; finish(true,false); },
    get busy() { return Boolean(active || pending.length); },
  };
}

function node(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value) element.textContent = value;
  return element;
}

function emblem(entry) {
  const symbol = node('span','scene-symbol');
  symbol.dataset.icon = entry.icon;
  symbol.setAttribute('aria-hidden','true');
  return symbol;
}

const imageCache = new Map();
function prepareImage(path) {
  if (typeof Image === 'undefined' || imageCache.has(path)) return;
  const image = new Image();
  imageCache.set(path,image);
  image.src = path;
  if (image.decode) void image.decode().catch(()=>{imageCache.delete(path);});
}

const cueByPhase = {
  lobby:['seal','paper'],
  reveal:['card','scroll'],
  nominate:['scroll','vote-yes','vote-no'],
  vote:['wax','vote-yes','vote-no','shield-light','shield-dark'],
  quest:['card','shield-light','shield-dark'],
  questResult:['water','oath','crown-dark'],
  lady:['water','scroll'],
  assassin:['crown-light','crown-dark'],
};

export const scenePreviews = {
  deal:{label:'发放身份',kind:'deal', prop:'letter', cue:'seal', title:'封缄入席', detail:'信已抵达'},
  identity:{label:'确认身份',kind:'identity', prop:'letter', cue:'card', portrait:roleArt('merlin'), title:'身份已确认', detail:'梅林'},
  ballot:{label:'开始表决',kind:'ballot', prop:'scroll', cue:'scroll', title:'队伍表决', detail:'全员提交后同时揭票'},
  vote:{label:'表决通过',kind:'verdict', prop:'scroll', cue:'vote-yes', title:'出征队伍通过', count:'4 : 2', detail:'赞成 · 反对', tone:'good'},
  reject:{label:'表决未通过',kind:'verdict', prop:'scroll', cue:'vote-no', title:'出征队伍未通过', count:'2 : 4', detail:'赞成 · 反对', tone:'evil'},
  receipt:{label:'表决封存',kind:'receipt', prop:'letter', cue:'wax', title:'你的表决已封存'},
  questGood:{label:'任务成功',kind:'quest', prop:'shield', cue:'shield-light', title:'第 2 次任务成功', count:'3 : 0', detail:'成功牌 · 失败牌', tone:'good'},
  questBad:{label:'任务失败',kind:'quest', prop:'shield', cue:'shield-dark', title:'第 2 次任务失败', count:'2 : 1', detail:'成功牌 · 失败牌', tone:'evil'},
  lady:{label:'湖中仙女',kind:'lake', prop:'bowl', cue:'water', portrait:ladyArt, title:'湖中仙女', detail:'查验已完成'},
  assassin:{label:'终局指认',kind:'oath', prop:'iron-crown', cue:'oath', title:'最后的指认', detail:'等待刺客作出选择', tone:'evil'},
  winGood:{label:'好人胜利',kind:'ending', prop:'gold-crown', cue:'crown-light', title:'好人守住了卡美洛', tone:'good'},
  winEvil:{label:'邪恶胜利',kind:'ending', prop:'iron-crown', cue:'crown-dark', title:'邪恶笼罩了卡美洛', tone:'evil'},
};

/** Keeps the existing book dialog mounted while a priority stage occupies the top layer. */
export function createSceneDirector({reading=()=>null,previewStage=null}={}) {
  let desired = {phase:'home'};
  let shownVersion = null;
  const reduced = ()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const queue = createSceneQueue({
    present,
    duration:entry => (timings[entry.kind]??timings.notice)+140,
    onIdle:()=>setAudioScene(desired.phase,{winner:desired.winner}),
  });

  function present(entry, skip) {
    const book = reading();
    const inline = entry.preview && previewStage;
    const immersive = entry.mode==='critical' || entry.mode==='table'&&!book;
    let output;
    let cue;
    let closed = false;
    let startTimer;
    let musicTimer;
    let started = false;
    if (immersive) {
      output = node(inline?'div':'dialog','cinematic-dialog');
      output.dataset.scene = entry.kind;
      output.dataset.tone = entry.tone;
      output.setAttribute('aria-label',entry.title);

      const frame = node('div','cinematic-frame');
      const object = node('div','cinematic-object');
      object.setAttribute('aria-hidden','true');
      const prop = node('span','cinematic-prop');
      prop.dataset.prop = entry.prop;
      object.append(node('span','cinematic-halo'),prop);
      if (entry.kind==='quest') {
        const cards = node('div','cinematic-cards');
        cards.append(node('i'),node('i'),node('i'));
        object.prepend(cards);
      }
      if (entry.portrait) {
        const picture = node('img','cinematic-portrait');
        picture.src = entry.portrait;
        picture.alt = '';
        object.append(picture);
      }
      frame.append(node('div','cinematic-light'),object);

      const caption = node('div','cinematic-caption');
      caption.setAttribute('role','status');
      if (entry.count) caption.append(node('strong','cinematic-count',entry.count));
      caption.append(node('h2',null,entry.title));
      if (entry.detail) caption.append(node('p',null,entry.detail));
      output.append(frame,caption);
      if (inline) previewStage.append(output);
      else {
        const dismiss = node('button','cinematic-skip','跳过');
        dismiss.type = 'button';
        dismiss.setAttribute('aria-label','跳过演出');
        dismiss.addEventListener('click',skip);
        output.addEventListener('cancel',event=>{event.preventDefault();skip();});
        output.append(dismiss);
        document.body.append(output);
        output.showModal();
      }
    } else {
      output = node('div',`scene-notice cinematic-notice${book?' cinematic-book-notice':''}`);
      output.setAttribute('role','status');
      output.dataset.tone = entry.tone;
      const words = node('span');
      words.append(node('strong',null,entry.title));
      const detail = entry.count?`${entry.count} · ${entry.detail}`:entry.detail;
      if (detail) words.append(node('small',null,detail));
      output.append(emblem(entry),words);
      (book ?? document.body).append(output);
    }
    function start() {
      if (closed || started) return;
      started = true;
      clearTimeout(startTimer);
      output.dataset.running = '';
      if (!inline) cue = playCue(entry.cue,{private:entry.private});
      if (entry.kind==='ending' && !entry.preview) {
        musicTimer = setTimeout(()=>setAudioScene('finished',{winner:entry.winner}),reduced()?0:980);
      }
    }
    const priming = !inline && preloadCue(entry.cue);
    if (priming && immersive && !reduced()) {
      startTimer = setTimeout(start,140);
      void priming.then(start);
    } else start();
    return immediate => {
      closed = true;
      clearTimeout(startTimer);
      clearTimeout(musicTimer);
      cue?.();
      if (output.open) output.close();
      output.remove();
      if (inline) entry.done();
      if (immediate && entry.kind==='ending' && !entry.preview) setAudioScene(desired.phase,{winner:desired.winner});
    };
  }

  return {
    update(previous,next,options={}) {
      if (!next || next.closed || previous && (previous.id!==next.id || previous.me!==next.me ||
          (previous.game?.id && previous.game.id!==next.game?.id))) queue.reset();
      if (!next || document.hidden || options.live===false) { queue.reset(); return; }
      const stamp = `${next.id}:${next.me??''}:${next.version}`;
      if (stamp===shownVersion) return;
      shownVersion = stamp;
      queue.push(sceneEvents(previous,next,options));
    },
    reset() { queue.reset(); shownVersion = null; },
    preview(kind, done=()=>{}) {
      if (queue.busy || document.hidden || !Object.hasOwn(scenePreviews,kind)) return false;
      prepareImage(HALL);
      prepareImage(CASTLE);
      prepareImage(PROPS);
      queue.push([{mode:'critical', preview:true, icon:'seal', tone:'gold', ...scenePreviews[kind], done}]);
      return true;
    },
    sound(phase,winner) {
      desired = {phase,winner};
      for (const cue of cueByPhase[phase]??[]) void preloadCue(cue);
      if (phase==='lobby'||phase==='reveal') {
        prepareImage(HALL);
        prepareImage(PROPS);
      }
      if (phase==='assassin'||phase==='questResult') prepareImage(CASTLE);
      if (phase!=='finished') setAudioScene(phase,{winner});
      else queueMicrotask(()=>{if (!queue.busy) setAudioScene(desired.phase,{winner:desired.winner});});
    },
  };
}
