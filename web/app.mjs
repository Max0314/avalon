import {ROLES,SIZES,EVIL,DEFAULT_SETTINGS,AVATARS,nickname} from '../shared/engine.mjs';
import {Online,OfflineHost,OfflineGuest,actionKey} from './transports.mjs';
import {drawQR,startScanner} from './qr.mjs';
import {AVATARS as CATALOGUE,avatarId,avatarPath} from '../shared/fribench-game-kit/avatars.mjs';
import {mountJournal} from '../shared/fribench-game-kit/journal-view.mjs';
import {handbookMarkup,mountHandbook} from './handbook.mjs';
import {roleArt} from '../shared/media.mjs';
import {AUDIO_TRACKS,getAudioSettings,setAudioSettings,playCue,preloadCue} from './audio.mjs';
import {createSceneDirector} from './scenes.mjs';
import {lightingMarkup,setLighting,updateLighting} from './lighting.mjs';
import {EXPERIENCE_PATH,mountExperience} from './experience.mjs';
import {frontDoorMarkup,mountFrontDoor} from './front-door.mjs';
import {mountSeatDrag} from './seat-drag.mjs';
import {publishDisplay,openPublicDisplay,mountPublicDisplay} from './public-display.mjs';
import {Practice} from './practice.mjs';

const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LABEL={reveal:'确认身份',nominate:'队长组队',vote:'队伍表决',quest:'执行任务',questResult:'任务揭晓',lady:'湖中仙女',assassin:'刺杀梅林',finished:'终局揭晓'};
const SETTING_LABEL={percival:'派西维尔',morgana:'莫甘娜',mordred:'莫德雷德',oberon:'奥伯伦',lady:'湖中仙女'};
const PROFILE_KEY='avalon.profile.v1';
const query=new URLSearchParams(location.search);
const inviteCode=query.get('room')?.toUpperCase()||'';
const displayId=query.get('display');
const defaultPerson=()=>({id:crypto.randomUUID(),name:'圆桌旅人',avatar:AVATARS[0]});
let person;
try{person=JSON.parse(localStorage.getItem(PROFILE_KEY));}catch{}
person||=defaultPerson();
let offlinePerson=person;
let transport=null,view=null,busy=false,showHome=true,selection=new Set(),lastKey=null,settingsDraft=null,stopScan=null,pairId=null,toastTimer;
const stages=createSceneDirector({reading:()=>$('modal').open?$('modal'):null});
const online=new Online(
  next=>{if(transport===online)accept(next);},
  (text,state)=>{if(transport===online)status(text,state==='idle'?'live':state);},
  {
    onIdentityChange:()=>{if(transport===online)resetOnlineIdentity();},
    onCommandError:message=>{if(transport===online)toast(message);},
    onCommandConfirmed:message=>{if(transport===online)toast(message);},
  }
);
let accountAccess=null,guestPreview=null,cleanupJournal=null,cleanupDrag=null,handbook=null;
let knownAccount,connecting=null,accountError=false,networkState='connecting',inviteHandled=false,inviteDismissed=false;

window.addEventListener('fribench:account-change',event=>{
  const key=event.detail?.authenticated?event.detail.accountKey||'account':'guest';
  if(key===knownAccount)return;
  knownAccount=key;
  if(transport&&transport.kind!=='online'){
    online.close({clearIdentity:true});
    accountAccess=null;
    accountError=false;
    guestPreview=null;
    if($('player-journal')||$('account-panel')||$('claim-guest'))closeDialog();
    return;
  }
  resetOnlineIdentity();
});

function status(text,state){
  const node=$('network-state');
  if(state==='reconnecting'&&networkState!=='reconnecting'){clearPrivate();dismissScene();}
  if(state==='live'&&['reconnecting','degraded'].includes(networkState))playCue('reconnect');
  networkState=state||(transport?.kind==='online'?'live':'local');
  if(node.textContent!==text)node.textContent=text;
  node.title=text;
  node.dataset.state=networkState;
  $('retry-online').hidden=transport!==online||!['degraded','reconnecting'].includes(networkState);
  if($('retry-offline'))$('retry-offline').hidden=networkState!=='terminal';
}
function savePerson(p,local=transport?.kind!=='online'){
  person={id:p.id||person.id,name:p.name,avatar:p.avatar};
  if(!local)return;
  offlinePerson=person;
  try{localStorage.setItem(PROFILE_KEY,JSON.stringify(person));}catch{}
}
function stillOnline(generation){return transport===online&&online.generation===generation;}
function syncOnline(){
  if(connecting)return connecting;
  transport=online;
  const generation=online.generation;
  status('正在连接','connecting');
  connecting=(async()=>{
    try{
      const resumed=await online.boot();
      if(!stillOnline(generation))return;
      savePerson(resumed.person);
      if(!resumed.room)status('在线服务就绪','live');
      if(resumed.room)showHome=false;
      render();
      const access=await online.request('/api/account');
      if(!stillOnline(generation))return;
      accountAccess=access;
      accountError=false;
      if($('account-panel'))accountMenu();
      if(showHome)render();
      if(query.get('view')==='records'&&!$('modal').open)openRecords();
      if(inviteCode&&!inviteHandled&&!$('modal').open){
        inviteHandled=true;
        void openInviteFromLink(inviteCode);
      }
    }catch{
      if(!stillOnline(generation))return;
      accountError=true;
      if(!view)status('在线服务暂不可用','degraded');
      if($('account-panel'))accountMenu();
      render();
    }finally{
      if(stillOnline(generation)){
        connecting=null;
        if(showHome)render();
      }
    }
  })();
  return connecting;
}
function resetOnlineIdentity(){
  if(inviteCode&&!inviteDismissed)inviteHandled=false;
  online.close({clearIdentity:true});
  connecting=null;
  accountAccess=null;
  guestPreview=null;
  accountError=false;
  transport=online;
  person=defaultPerson();
  closeDialog();
  accept(null);
  void syncOnline();
}
function toast(message){
  const node=$('modal').open?$('modal-feedback'):$('toast');
  $('modal-feedback').hidden=true;
  $('toast').hidden=true;
  node.textContent=message;
  node.hidden=false;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>node.hidden=true,5000);
}
function clearDialog(){
  cleanupJournal?.();cleanupJournal=null;
  stopScan?.();stopScan=null;
  if(pairId&&transport?.kind==='offline-host')transport.cancelPair(pairId);
  pairId=null;
  handbook=null;
  $('modal-feedback').hidden=true;
  $('modal-round').hidden=true;
  $('modal-actions').hidden=true;
  $('modal-actions').replaceChildren();
  $('modal-body').replaceChildren();
}
function closeDialog(){if($('modal').open)$('modal').close();clearDialog();}
function dialog(title,body,kind='',actions=''){
  closeDialog();
  $('modal').className=kind;
  $('modal-title').textContent=title;
  $('modal-body').innerHTML=body;
  $('modal-actions').innerHTML=actions;
  $('modal-actions').hidden=!actions;
  $('modal').showModal();
  renderModalRound();
}
const dismissScene=()=>stages.reset();
function accept(next){
  recordOffline(next);
  const previous=view;
  const different=view?.id!==next?.id;
  if(different||next?.closed||view?.game?.id!==next?.game?.id){
    if(!next||next.closed||$('private-wrapper')||$('private-intel-dialog')||$('private-player-clue'))closeDialog();
    dismissScene();
  }
  view=next;
  if(different){selection.clear();settingsDraft=null;lastKey=null;}
  if(next){
    if($('answer-qr'))closeDialog();
    const key=actionKey(next);
    if(key!==lastKey){selection.clear();lastKey=key;}
    const player=next.players.find(p=>p.id===next.me);
    if(player&&transport.kind!=='practice')savePerson(player);
  }else showHome=true;
  render();
  publishDisplay(view);
  stages.update(previous,next,{live:!showHome&&!document.hidden&&!['degraded','reconnecting','connecting','terminal'].includes(networkState)});
}
function me(){return view?.players.find(p=>p.id===view.me);}
function name(id){return view?.players.find(p=>p.id===id)?.name||'已离开的玩家';}
function recordOffline(next){
  if(!transport||!transport.kind.startsWith('offline-')||next?.game?.phase!=='finished')return;
  try{const records=JSON.parse(localStorage.getItem('avalon.offline.journal.v1')||'[]');if(records.some(r=>r.id===next.game.id))return;const g=next.game;records.unshift({id:g.id,endedAt:Date.now(),winner:g.winner,players:next.players.map(p=>({name:p.name,avatar:avatarId(p.avatar),role:g.roles[p.id]}))});localStorage.setItem('avalon.offline.journal.v1',JSON.stringify(records.slice(0,100)));}catch{}
}
function openRecords(){
  dialog('游戏档案','<div class="journal-toolbar"><span>在线好友局</span><button id="offline-records" type="button">本机离线记录</button></div><div id="player-journal"></div>','wide-dialog');
  cleanupJournal=mountJournal($('player-journal'),{modes:[{id:'online',name:'在线好友局'}],request:(path,data)=>online.request(path,data)});
}
function showOfflineRecords(){
  let records=[];try{records=JSON.parse(localStorage.getItem('avalon.offline.journal.v1')||'[]');if(!Array.isArray(records))records=[];}catch{}
  dialog('离线记录 · 仅本机',`
    <div class="journal-toolbar"><span>最多保留最近 100 场</span><button id="player-records">返回在线档案</button></div>
    ${records.length?records.map(r=>`<section class="notice offline-record">
      <strong>${esc(new Date(r.endedAt).toLocaleString('zh-CN'))} · ${r.winner==='good'?'好人获胜':'邪恶获胜'}</strong>
      <ul>${r.players.map(p=>`<li>${avatarImage(p.avatar,28)}<span>${esc(p.name)} · ${esc(ROLES[p.role]?.name??'玩家')}</span></li>`).join('')}</ul>
    </section>`).join(''):'<p>还没有本机离线完成记录。</p>'}`,'wide-dialog');
}
function isHost(){return view?.me===view?.hostId;}
const disabled=value=>value?' disabled':'';
function avatarImage(value,size=36){return `<img class="game-avatar" src="${avatarPath(value)}" width="${size}" height="${size}" alt="">`;}
const GUEST_DRAFT='avalon.guest-draft.v2';
const FUN_NAMES=['失眠骑士','摸鱼梅林','锅盖爵士','迷路吟游诗人','雪地大脚板','脆饼骑士','蘑菇队长','湖边钓鱼佬','热心猫头鹰','好奇马铃薯','银甲饭团','柠檬领主'];
const pick=items=>items[crypto.getRandomValues(new Uint32Array(1))[0]%items.length];

function randomProfile(current={},used=[]){
  const free=CATALOGUE.filter(a=>!used.includes(a.id)&&a.id!==avatarId(current.avatar));
  return {name:pick(FUN_NAMES.filter(value=>value!==current.name)),avatar:pick(free.length?free:CATALOGUE).id};
}

function newGuestProfile(){
  if(accountAccess?.signedIn||person.name!=='圆桌旅人')return person;
  try{
    const saved=JSON.parse(localStorage.getItem(GUEST_DRAFT));
    if(saved?.seat===person.id)return saved;
  }catch{}
  const draft={seat:person.id,...randomProfile()};
  try{localStorage.setItem(GUEST_DRAFT,JSON.stringify(draft));}catch{}
  return draft;
}

function avatars(current,used=[]){
  const active=avatarId(current);
  return `<details class="game-avatar-picker"><summary>${avatarImage(active)}选择头像</summary>
    <div class="game-avatar-grid" role="group" aria-label="选择头像">${CATALOGUE.map(a=>{
      const locked=used.includes(a.id)&&a.id!==active;
      return `<button type="button" class="avatar-choice ${a.id===active?'active':''}" data-avatar="${a.id}" aria-label="${esc(a.name+(locked?'，已使用':''))}" aria-pressed="${a.id===active}"${disabled(locked)}>${avatarImage(a.id,52)}<span>${esc(a.name)}${locked?' · 已使用':''}</span></button>`;
    }).join('')}</div></details>`;
}

function profileForm(p=person,used=[],random=false){
  const available=used.includes(avatarId(p.avatar))&&random?{...p,avatar:randomProfile(p,used).avatar}:p;
  return `<div class="field"><label for="nickname">游戏昵称</label><input id="nickname" value="${esc(available.name)}" maxlength="60" autocomplete="nickname"></div>
    <div class="field">${avatars(available.avatar,used)}</div>
    ${random?'<button type="button" id="shuffle-profile">换一组</button>':''}
    ${accountAccess?.signedIn?'<button type="button" id="use-account-profile" class="profile-account-use">使用账号资料</button>':''}`;
}

function readProfile(){
  const container=$('modal').open?$('modal-body'):$('app');
  return {name:nickname(container.querySelector('#nickname')?.value??person.name),avatar:container.querySelector('.avatar-choice.active')?.dataset.avatar||person.avatar};
}

async function run(fn){
  if(busy)return;
  busy=true;
  render();
  try{await fn();}catch(e){if(e.code!=='ACCOUNT_CHANGED')toast(e.message||'操作未完成，请稍后再试。');}
  finally{busy=false;render();}
}
async function command(type,payload={}){
  const activeTransport=transport;
  const result=await activeTransport.command(type,payload);
  if(activeTransport===transport&&type==='ready')playCue('submit');
  return result;
}

function renderHome(){
  const root=$('app');
  if(!root.querySelector('.front-door')){
    root.innerHTML=frontDoorMarkup();
    mountFrontDoor(root,id=>guide('roles',id));
    let hits=0,last=0;
    root.querySelector('.portrait-readout h1').addEventListener('click',()=>{
      const now=performance.now();
      hits=now-last<420?hits+1:1;last=now;
      if(hits===3){hits=0;soundSettings();}
    });
  }
  const reserved=Boolean(view&&!view.closed);
  $('resume-current').hidden=!reserved;
  $('close-own-room').hidden=!reserved;
  $('create-online').disabled=busy||Boolean(connecting);
  $('join-online').disabled=busy||Boolean(connecting);
}

function offlineMenu(){
  const saved=OfflineHost.saved();
  dialog('离线同桌',`<div class="stack-actions">
    <button id="create-offline">创建离线房间</button><button id="join-offline">扫码加入</button>
    ${saved?'<button id="restore-offline">恢复本机牌桌</button>':''}
    <button id="practice-menu">人机练习</button><button id="prepare-offline">准备离线素材</button><button id="home-offline-records">本机离线记录</button>
  </div>`);
}

function accountMenu(check=true){
  const destination=encodeURIComponent(location.pathname+location.search);
  const profile=accountAccess?.profile;
  const signedIn=accountAccess?.signedIn;
  const controls=signedIn?`
    <div class="account-identity">${avatarImage(profile?.avatar,44)}<div><strong>${esc(profile?.name||'Fribench 玩家')}</strong><small>已登录 Fribench</small></div></div>
    <p>账号座位可跨设备恢复。在线战绩随账号保存。</p>
    <div class="actions-row"><a class="button-link" href="/_fribench/auth/manage?return_to=${destination}" data-fribench-action="manage">账号资料</a><button data-fribench-action="logout">退出账号</button></div>
    <p role="status" data-account-status></p>
    ${accountAccess.guestClaimAvailable?'<button id="preview-guest" class="full">预览游客席位与战绩</button>':'<p class="muted">已使用本游戏的游客认领机会。</p>'}`
  :`<p>${accountError?'暂时无法检查账号。你仍可在同一浏览器继续游客对局。':accountAccess?'游客座位随浏览器保留。登录后可恢复账号本人座位。':'正在核对账号，可以直接使用游客入口。'}</p>
    <a class="button-link primary full" href="/_fribench/auth/login?return_to=${destination}">登录 Fribench</a>`;
  dialog('账号与在线席位',`<div id="account-panel" data-account-controls>${controls}<div class="divider"></div><button id="player-records" class="full">查看游戏档案</button></div>`);
  if(check&&!accountAccess&&transport!==online&&navigator.onLine){
    const panel=$('account-panel'),generation=online.generation;
    void online.request('/api/session').then(()=>online.request('/api/account')).then(access=>{
      if(generation!==online.generation||!panel.isConnected)return;
      accountAccess=access;
      accountError=false;
      accountMenu(false);
    }).catch(()=>{
      if(generation!==online.generation||!panel.isConnected)return;
      accountError=true;
      accountMenu(false);
    });
  }
}

function soundSettings(){
  const prefs=getAudioSettings();
  const home = $('app').dataset.screen==='home';
  const keepTable = Boolean(view && !view.closed);
  dialog(home?'设置':'声音与画面',`<div class="sound-settings device-settings">
    ${home ? `<a class="button-link primary experience-link" href="${EXPERIENCE_PATH}"${keepTable?' target="_blank" rel="noopener"':''}>视听体验 <span aria-hidden="true">›</span></a>` : ''}
    <section class="lighting-settings">${lightingMarkup()}</section>
    <section><label class="audio-toggle"><input type="checkbox" data-audio="music"${prefs.music?' checked':''}>背景音乐</label>
      <label for="audio-track">配乐</label><select id="audio-track" data-audio="track">${Object.entries(AUDIO_TRACKS).map(([id,label])=>`<option value="${id}"${prefs.track===id?' selected':''}>${label}</option>`).join('')}</select>
      <label class="audio-range">音乐音量 <output id="musicVolume-value">${prefs.musicVolume}%</output><input type="range" data-audio="musicVolume" value="${prefs.musicVolume}" min="0" max="100"></label>
    </section>
    <section><label class="audio-toggle"><input type="checkbox" data-audio="effects"${prefs.effects?' checked':''}>操作音效</label>
      <label class="audio-range">音效音量 <output id="effectsVolume-value">${prefs.effectsVolume}%</output><input type="range" data-audio="effectsVolume" value="${prefs.effectsVolume}" min="0" max="100"></label>
      <label class="audio-toggle"><input type="checkbox" data-audio="privateEffects"${prefs.privateEffects?' checked':''}>播放私密音效</label>
      <button id="preview-sound">试听音效</button>
    </section><p class="muted">声音设置保存在当前设备。</p></div>`);
}
function roomTop(){
  const mode={online:'在线好友局','offline-host':'离线主持','offline-guest':'离线同桌',practice:'本机练习'}[transport.kind];
  return `<section class="room-top" aria-label="房间工具">
    <div><span class="mode-label">${mode}</span><h1>${view.game?'卡美洛圆桌':'房间大厅'}</h1><span class="room-code">${esc(view.code||'练习牌桌')}</span></div>
    <div class="room-tools">
      ${transport.kind==='online'?'<button id="invite">邀请</button>':transport.kind==='offline-host'?'<button id="pair-host">配对</button>':transport.kind==='offline-guest'?`<button id="retry-offline"${networkState==='terminal'?'':' hidden'}>重新扫码</button>`:''}
      <button id="public-screen">大屏</button>
      <button id="go-home">首页</button><button id="room-menu">菜单</button>
    </div></section>`;
}

function settingFields(suffix=''){
  const options=settingsDraft||view.settings;
  return `<div class="settings-grid">${Object.entries(SETTING_LABEL).map(([key,label])=>
    `<label class="setting"><input id="setting-${key}${suffix}" type="checkbox" data-setting="${key}"${options[key]?' checked':''}${disabled(!isHost()||busy||transport.kind==='practice')}>${label}</label>`).join('')}</div>`;
}

function roleSettingsBody(suffix=''){
  const fit=EVIL[view.players.length];
  const chosen=1+['morgana','mordred','oberon'].filter(role=>(settingsDraft||view.settings)[role]).length;
  return `${settingFields(suffix)}<p class="role-list" data-role-limit>${fit&&chosen>fit?`本桌 ${fit} 个邪恶席位，当前选择了 ${chosen} 个特殊邪恶角色。`:'梅林和刺客固定入场。'}</p>`;
}

function showRoomSettings(){
  dialog('本局角色',roleSettingsBody('-modal'),'lobby-config',
    `${isHost()&&transport.kind!=='practice'?'<button id="save-settings" class="primary">保存角色设置</button>':''}<button id="guide-room">角色图鉴</button>`);
}

function renderLobby(){
  const players=view.players, count=players.length, validCount=Boolean(SIZES[count]);
  const ready=players.filter(p=>p.ready&&p.online).length;
  const fits=!EVIL[count]||1+['morgana','mordred','oberon'].filter(role=>(settingsDraft||view.settings)[role]).length<=EVIL[count];
  const roster=players.map((p,i)=>`<div class="roster-item ${p.id===view.me?'mine':''}" data-player-row="${p.id}">
    <span class="seat-index">${i+1}</span><button class="roster-profile" data-player-info="${p.id}" aria-label="${esc(p.name)}，${p.ready?'已准备':'未准备'}${p.online?'':'，离线'}">
    ${avatarImage(p.avatar,38)}<span class="roster-name">${esc(p.name)}${p.id===view.me?' · 你':''}${p.bot?' · 人机':''}</span></button>
    <span class="roster-dot" data-ready="${p.ready&&p.online}" title="${p.ready?'已准备':'未准备'}" aria-hidden="true">${p.online?(p.ready?'●':'○'):'×'}</span>
  </div>`).join('');
  $('app').innerHTML=roomTop()+`<div class="room-columns">
    <section class="panel lobby-roster-panel"><div class="panel-heading"><h2>圆桌席位</h2><span class="badge">${count} / 10</span></div>
      <div class="roster" data-scroll="roster" id="room-roster">${roster}</div>
      <div class="lobby-ready"><p class="role-list">${validCount?`${ready} / ${count} 人就绪`:`还差 ${5-count} 人开局`}${transport===online&&players.some(p=>p.bot)?' · 人机局不计公开排行':''}</p>
      <div class="lobby-bottom"><button id="ready" class="${me().ready?'':'primary'}"${disabled(busy)}>${me().ready?'取消准备':'准备'}</button>
        ${isHost()?`<button id="start" class="primary"${disabled(busy||!validCount||ready!==count||!fits||settingsDraft)}>开局</button>`:''}
        ${isHost()&&transport===online&&count<5?`<button id="fill-room-bots"${disabled(busy)}>人机补位</button>`:''}
        <button class="lobby-mobile-settings" id="lobby-mobile-settings">本局角色</button>
      </div></div>
    </section>
    <section class="panel lobby-settings-panel inner-scroll"><h2>本局角色</h2>${roleSettingsBody()}
      ${isHost()&&transport.kind!=='practice'?`<button id="save-settings-inline" class="full"${disabled(busy||!settingsDraft)}>保存角色设置</button>`:''}
      <button id="guide-room-desktop" class="full role-reference">角色图鉴</button>
    </section></div>`;
  if(isHost()&&!busy&&transport.kind!=='practice'){
    const version=view.version;
    cleanupDrag=mountSeatDrag($('room-roster'),ids=>{if(view?.version===version&&!view.game)void run(()=>command('reorder',{players:ids}));});
  }
}

function history(){const g=view.game;return `<details class="history" id="history"><summary>公开记录 · ${g.proposals.length} 次组队表决</summary><div class="history-body" data-scroll="history">${g.proposals.length?g.proposals.map((p,i)=>`<div class="history-item"><p>第 ${p.quest} 轮 · 第 ${i+1} 次提案 · ${p.approved?'通过':'未通过'}</p><p class="muted">队长 ${esc(name(p.leaderId))} · 出征：${p.team.map(id=>esc(name(id))).join('、')}</p><div class="vote-grid">${view.players.map(player=>`<span class="vote-tag ${p.votes[player.id]?'yes':'no'}">${esc(player.name)} ${p.votes[player.id]?'赞成':'反对'}</span>`).join('')}</div></div>`).join(''):'<p class="muted">所有人提交表决后，才会同时公布每个人的选择。</p>'}${g.results.map(r=>`<div class="history-item"><p>第 ${r.quest} 轮任务：${r.success?'成功':'失败'}</p><p class="muted">成功 ${r.successes} 张 · 失败 ${r.fails} 张 · 失败门槛 ${r.threshold} 张</p></div>`).join('')}${g.ladyHistory.map(r=>`<p class="history-item">第 ${r.quest} 轮后，${esc(name(r.from))} 查验了 ${esc(name(r.to))}。阵营只向查验者显示。</p>`).join('')}</div></details>`;}
function actionPanel(){
  const g=view.game,host=isHost(),selected=[...selection];
  let title='',summary='',controls='';
  switch(g.phase){
    case 'reveal': {
      const confirmed=g.confirmed.includes(view.me);
      title=confirmed?'已确认身份':'查看你的身份';
      summary=`${g.confirmed.length} / ${view.players.length} 人已确认`;
      controls='<button id="peek-role" class="primary">打开身份卡</button>';break;
    }
    case 'nominate': {
      const mine=g.leaderId===view.me;
      title=mine?'选择出征队员':'等待队长组队';
      summary=`${g.needed} 人出征${g.threshold===2?' · 本轮需两张失败牌':''}`;
      if(mine)controls=`<button id="nominate" class="primary"${disabled(busy||selected.length!==g.needed)}>确认队伍 ${selected.length}/${g.needed}</button>`;
      break;
    }
    case 'vote':
      title=g.myVote===null?'表决出征队伍':'你的表决已封存';
      summary=`${g.voted.length} / ${view.players.length} 人已提交 · 全员提交后揭票`;
      if(g.myVote===null)controls=`<button id="vote-yes" class="primary"${disabled(busy)}>赞成</button><button id="vote-no"${disabled(busy)}>反对</button>`;
      break;
    case 'quest': {
      const inTeam=g.team.includes(view.me);
      title=inTeam?(g.myQuest===null?'秘密提交任务牌':'你的任务牌已封存'):'等待队员交牌';
      summary=`${g.questSubmitted.length} / ${g.team.length} 人已交牌`;
      if(inTeam&&g.myQuest===null)controls=`<button id="quest-success" class="primary"${disabled(busy)}>成功</button>${ROLES[g.myRole].side==='evil'?`<button id="quest-fail" class="danger"${disabled(busy)}>失败</button>`:''}`;
      break;
    }
    case 'questResult': {
      const r=g.results.at(-1);
      title=`第 ${r.quest} 轮${r.success?'成功':'失败'}`;
      summary=`成功 ${r.successes} 张 · 失败 ${r.fails} 张`;
      if(host)controls=`<button id="continue" class="primary"${disabled(busy)}>继续</button>`;
      break;
    }
    case 'lady': {
      const mine=g.ladyHolder===view.me;
      title=mine?'选择查验对象':'等待湖中仙女查验';
      summary='结果只向本次查验者展示';
      if(mine)controls=`<button id="inspect" class="primary"${disabled(busy||selected.length!==1)}>确认查验</button>`;
      break;
    }
    case 'assassin': {
      const mine=g.myRole==='assassin';
      title=mine?'选择你怀疑是梅林的玩家':'等待刺客指认';
      summary='指认后立即揭晓结局';
      if(mine)controls=`<button id="assassinate" class="danger"${disabled(busy||selected.length!==1)}>确认指认</button>`;
      break;
    }
  }
  return `<section class="action-panel"><h3>${esc(title)}</h3><p>${esc(summary)}</p><div class="actions-row">${controls}</div></section>`;
}

function canPick(g,id){
  return g.phase==='nominate'&&g.leaderId===view.me
    ||g.phase==='lady'&&g.ladyHolder===view.me&&!g.ladyHolders.includes(id)
    ||g.phase==='assassin'&&g.myRole==='assassin'&&id!==view.me;
}

function tableMarkup(ended=false){
  const g=view.game;
  const good=g.results.filter(r=>r.success).length, evil=g.results.length-good;
  const seats=view.players.map((p,i)=>{
    const selected=selection.has(p.id);
    const selectable=!ended&&canPick(g,p.id);
    const clue=ended||!g.confirmed.includes(view.me)?null:g.intel.find(info=>info.id===p.id);
    const marks=[
      g.leaderId===p.id?['队','队长','leader']:null, g.team.includes(p.id)?['阵','出征','team']:null,
      g.phase==='vote'&&g.voted.includes(p.id)?['票','已投票']:null,
      g.phase==='quest'&&g.questSubmitted.includes(p.id)?['牌','已交牌']:null,
      g.phase==='reveal'&&g.confirmed.includes(p.id)?['已','已确认']:null,
      clue?['线',clue.label,'private']:null
    ].filter(Boolean);
    const publicRole=ended?ROLES[g.roles[p.id]]:null;
    return `<div class="seat ${p.online?'':'seat-away'}">
      <button class="seat-button ${p.id===view.me?'self':''} ${selected?'selected':''}" data-seat="${p.id}" aria-label="${esc((selectable?'选择 ':'查看 ')+p.name+(p.online?'':' · 离线')+(marks.length?' · '+marks.map(m=>m[1]).join(' · '):''))}"${selectable?` aria-pressed="${selected}"`:''}${disabled(busy)}>
        <span class="seat-number">${i+1}</span><span class="seat-icon">${avatarImage(p.avatar,36)}</span>
        <span class="seat-name">${esc(p.name)}${p.id===view.me?' · 你':''}</span>
        ${publicRole?`<span class="seat-public-role ${publicRole.side}">${publicRole.name}</span>`:`<span class="seat-flags" aria-hidden="true">${marks.map(([symbol,label,kind])=>`<i class="seat-state-dot" data-kind="${kind||'public'}" title="${esc(label)}">${symbol}</i>`).join('')}</span>`}
      </button></div>`;
  }).join('');
  return `<div class="table-area"><div class="round-table" data-count="${view.players.length}">
    <div class="table-centre"><span class="table-emblem" aria-hidden="true"></span><small>${ended?'终局':`第 ${g.questIndex+1} 次远征`}</small>
      <strong>${good} : ${evil}</strong><small>好人 / 邪恶</small></div>${seats}</div></div>`;
}

function renderGame(){
  const g=view.game;
  const historyOpen=$('history')?.open;
  if(g.phase==='finished'){renderEnd();return;}
  const track=SIZES[view.players.length].map((size,index)=>{
    const result=g.results[index];
    const threshold=view.players.length>=7&&index===3?'两张失败牌':'一张失败牌';
    return `<div class="quest-slot ${index===g.questIndex?'current':''} ${result?(result.success?'success':'fail'):''}" title="${threshold}">
      <span>第 ${index+1} 轮</span><b>${result?(result.success?'成功':'失败'):size+' 人'}</b></div>`;
  }).join('');
  $('app').innerHTML=roomTop()+`<div class="game-layout"><section class="play-area" data-phase="${g.phase}">
    <div class="quest-track" aria-label="任务进度">${track}</div>
    <div class="phase-heading"><h2>${LABEL[g.phase]}</h2><div class="rejection-track"><span>连拒 ${g.rejections}/5</span>${Array.from({length:5},(_,i)=>`<i class="pip ${i<g.rejections?'on':''}" aria-hidden="true"></i>`).join('')}</div></div>
    ${tableMarkup()}${actionPanel()}
    <div class="table-shortcuts"><button id="public-history">记录</button><button id="guide-game">手册</button>${g.privateIntel.length?'<button id="private-intel">我的查验</button>':''}</div>
  </section><aside class="side-panel">
    <button id="guide-game-desktop" class="full">圆桌手册</button>
    ${g.privateIntel.length?'<button id="private-intel-desktop" class="full">我的查验记录</button>':''}${history()}
  </aside></div>`;
  if(historyOpen)$('history').open=true;
}

function renderEnd(){
  const g=view.game;
  const reason={'five-rejections':'五次组队连续未通过。','three-fails':'三次任务失败。',
    'merlin-assassinated':`${name(g.assassinated)} 是梅林。`,'merlin-survived':`梅林未被识破。`}[g.reason]||'';
  $('app').innerHTML=roomTop()+`<section class="result-layout">
    <div class="end-hero ${g.winner}"><h2>${g.winner==='good'?'好人守住了卡美洛':'邪恶笼罩了卡美洛'}</h2><p>${esc(reason)}</p></div>
    ${tableMarkup(true)}
    <div class="result-dock">${isHost()?'<button id="rematch" class="primary">回大厅，再来一局</button>':'<span class="muted">等待房主发起下一局</span>'}
      <button id="public-history">本局记录</button><button id="player-records">游戏档案</button></div>
  </section>`;
}

function viewPlayer(id){
  const player=view?.players.find(p=>p.id===id);
  if(!player)return;
  const g=view.game;
  const own=player.id===view.me;
  const clue=g?.phase!=='finished'&&g?.confirmed.includes(view.me)?g.intel.find(item=>item.id===id):null;
  const publicRole=g?.phase==='finished'?ROLES[g.roles[id]]:null;
  const counts=g?.proposals.filter(item=>item.team.includes(id)).length;
  const ownEditable=own&&(!g||g.phase==='finished')&&transport.kind!=='practice';
  dialog(player.name,`<div class="player-card-detail">
    ${publicRole?`<img class="player-end-portrait" src="${roleArt(g.roles[id],view.players.indexOf(player))}" alt="" width="384" height="512">`:avatarImage(player.avatar,76)}
    <p>${publicRole?publicRole.name:player.online?'已连接':'离线'}</p>
    ${clue?`<p id="private-player-clue" class="intel">你的线索 · ${esc(clue.label)}</p>`:''}
    ${counts!==undefined?`<p>被选入队伍 ${counts} 次。</p>`:''}</div>`,'player-dialog',
    `${ownEditable?'<button id="profile" class="primary">修改资料</button>':''}${isHost()&&!g&&!own&&transport.kind!=='practice'?`<button ${player.bot?'data-remove-bot':'data-kick'}="${player.id}" class="danger">${player.bot?'移除人机':'移出房间'}</button>`:''}`);
}

function showPublicHistory(){
  const html=history().replace('<details class="history" id="history">','<details class="history" open>');
  dialog('本局公开记录',html,'wide-dialog');
}

function render(){
  if(cleanupDrag?.())toast('席位状态刚刚更新，请重新拖动。');
  cleanupDrag=null;
  const root=$('app'),active=document.activeElement;
  const restore=root.contains(active)&&active.id?active.id:null;
  const activeSeat=root.contains(active)&&active.dataset.seat;
  const cursor=restore&&active instanceof HTMLInputElement?[active.selectionStart,active.selectionEnd]:null;
  const scrolls=Array.from(root.querySelectorAll('[data-scroll]'),node=>[node.dataset.scroll,node.scrollTop]);
  const phase=showHome||!view||view.closed?'home':view.game?.phase??'lobby';
  const screen=showHome||!view?'home':view.closed?'closed':phase==='lobby'||phase==='finished'?phase:'game';
  const changed=root.dataset.screen!==screen;
  root.dataset.screen=screen;
  document.body.dataset.view=screen;
  updateLighting(phase, view?.game?.winner);
  $('identity-header').hidden=screen!=='game'||phase==='reveal';
  $('account-menu').hidden=screen==='game';
  $('audio-settings').textContent=screen==='home'?'设置':'♫';
  $('audio-settings').setAttribute('aria-label',screen==='home'?'设置':'声音与画面');
  stages.sound(phase,view?.game?.winner);
  if(showHome||!view)renderHome();
  else if(view.closed)root.innerHTML='<section class="panel end-panel"><h1>房间已关闭</h1><p>你可以回首页再开一桌。</p><button id="go-home" class="primary">回到首页</button></section>';
  else if(view.game)renderGame();
  else renderLobby();
  for(const [key,top] of scrolls){
    const node=root.querySelector(`[data-scroll="${key}"]`);
    if(node)node.scrollTop=top;
  }
  renderModalRound();
  if(changed)(root.querySelector('.end-hero')??root.firstElementChild)?.classList.add('entering');
  const focus=restore?$(restore):activeSeat?root.querySelector(`[data-seat="${CSS.escape(activeSeat)}"]`):null;
  if(root.contains(focus)&&!focus.disabled){
    focus.focus({preventScroll:true});
    if(cursor?.[0]!==null&&cursor?.[0]!==undefined)focus.setSelectionRange(...cursor);
  }
}

function renderModalRound(){
  const dock=$('modal-round'),game=view?.game;
  const wantsVote=Boolean($('modal').open&&handbook&&game?.phase==='vote'&&game.myVote===null);
  dock.hidden=!wantsVote;
  if(!wantsVote){dock.replaceChildren();return;}
  if(!dock.querySelector('span')){
    dock.innerHTML='<span role="status"></span><button id="guide-vote-yes" class="primary">赞成</button><button id="guide-vote-no">反对</button>';
  }
  dock.querySelector('span').textContent=`队伍表决 · ${game.voted.length}/${view.players.length} 已提交`;
  for(const button of dock.querySelectorAll('button'))button.disabled=busy||showHome;
}

function guide(section='rules',role=null){
  if(section instanceof Event)section='rules';
  preloadCue('paper');
  dialog('圆桌手册',handbookMarkup({players:view?.players.length,settings:view?.settings,section}),'wide-dialog handbook-dialog');
  handbook=mountHandbook($('handbook'),{onTurn:()=>playCue('paper')});
  if(role)handbook.openRole(role);
  renderModalRound();
}
function peekRole(){if(!view?.game)return;const g=view.game,r=ROLES[g.myRole],confirmed=g.confirmed.includes(view.me);let hasPeeked=false,timer;
  const portrait = roleArt(g.myRole,view.players.findIndex(player => player.id === view.me));
  dialog('我的秘密身份',`<div id="private-wrapper"><p class="private-reminder">按住卡牌查看，松开立即遮住；键盘可按住空格或回车。</p><button class="role-cover" id="hold-role" aria-label="按住查看我的身份"><span class="cover-mark" aria-hidden="true"></span><span class="cover-text">按住查看身份</span><img src="${portrait}" alt="我的角色立绘" width="384" height="512"></button><div id="private-role-details" class="private-role"><h3 class="role-name">${r.name} <span class="badge ${r.side}">${r.side==='good'?'好人':'邪恶'}</span></h3><p class="role-desc">${r.description}</p>${g.intel.length?`<div class="intel"><strong>你掌握的信息</strong><br>${g.intel.map(p=>`${esc(name(p.id))} · ${p.label}`).join('<br>')}</div>`:'<p class="muted">你没有额外的开局身份信息。</p>'}</div></div>`,'private-dialog',g.phase==='reveal'&&!confirmed?'<button id="confirm-role" class="primary full" disabled>确认身份</button>':'');
  const hold=$('hold-role'),wrapper=$('private-wrapper');hold.focus({preventScroll:true});const reveal=()=>{timer=setTimeout(()=>{wrapper.classList.add('is-peeking');playCue('reveal',{private:true});hasPeeked=true;if($('confirm-role'))$('confirm-role').disabled=false;},220);};const hide=()=>{clearTimeout(timer);wrapper.classList.remove('is-peeking');};
  hold.addEventListener('pointerdown',e=>{e.preventDefault();hold.setPointerCapture(e.pointerId);reveal();});for(const ev of ['pointerup','pointercancel','lostpointercapture','blur'])hold.addEventListener(ev,hide);
  hold.addEventListener('keydown',e=>{if([' ','Enter'].includes(e.key)&&!e.repeat){e.preventDefault();reveal();}});hold.addEventListener('keyup',hide);hold.addEventListener('contextmenu',e=>e.preventDefault());
  $('confirm-role')?.addEventListener('click',()=>{if(!hasPeeked)return;closeDialog();run(()=>command('confirmRole'));});
}
function invite(){const url=`${location.origin}/?room=${view.code}`;dialog('邀请朋友入座',`<p class="muted">朋友用浏览器打开链接即可加入，不需要注册。</p><canvas id="invite-qr" class="pair-qr" aria-label="在线房间邀请二维码"></canvas><label for="invite-link">邀请链接</label><input id="invite-link" value="${esc(url)}" readonly><div class="spacer"></div><button id="copy-invite" class="primary full">复制邀请链接</button><p class="qr-note">邀请码：${esc(view.code)}。换浏览器不会自动继承原座位。</p>`);drawQR($('invite-qr'),url).catch(()=>toast('二维码生成失败，可以直接复制链接。'));$('copy-invite').onclick=async()=>{try{await navigator.clipboard.writeText(url);toast('邀请链接已复制。');}catch{$('invite-link').select();toast('请长按或按 Ctrl+C 复制链接。');}};}
async function scanInto(callback){
  dialog('扫描连接码',`<p class="muted">将二维码放入取景框。相机只在本机识别，不上传画面。</p><video id="scan-video" class="scan-video" playsinline muted></video><label for="paste-code">也可以粘贴连接文本</label><textarea id="paste-code" class="pair-text" placeholder="粘贴 FRIBENCH-AVALON-1 开头的连接文本"></textarea><button id="use-pasted" class="primary full">使用这段连接文本</button><p id="scan-note" class="qr-note"></p>`);
  const video=$('scan-video'),button=$('use-pasted');
  const current=()=>video.isConnected&&$('modal').open;
  const receive=async text=>{
    if(!current()||button.disabled)return;
    button.disabled=true;
    stopScan?.();stopScan=null;
    try{await callback(text,current);}
    catch(error){if(current()){button.disabled=false;toast(error.message);}}
  };
  button.onclick=()=>receive($('paste-code').value.trim());
  try{
    const stop=await startScanner(video,receive,error=>{if(current())toast(error.message);});
    if(current()&&!document.hidden&&!button.disabled)stopScan=stop;else stop();
  }catch{if(current())$('scan-note').textContent='相机未开启，可使用连接文本。';}
}
async function pairHost(){
  const host=transport;
  const offer=await host.offer();
  if(transport!==host||showHome||view?.closed||$('modal').open){host.cancelPair(offer.pairId);return;}
  dialog('添加或重连一位玩家',`<p class="pair-step">第一步 · 玩家扫描房主邀请</p><p class="muted">让一位朋友点“扫码加入”，扫描下方二维码。对方生成回答码后，由房主扫描回答码完成配对。</p><canvas id="pair-qr" class="pair-qr" aria-label="离线房主邀请二维码"></canvas><details><summary>连接文本与手动配对</summary><textarea id="offer-text" class="pair-text" readonly>${esc(offer.text)}</textarea></details><div class="spacer"></div><button id="scan-answer" class="primary full">第二步：扫描玩家回答码</button><div class="spacer"></div><label for="answer-text">或粘贴玩家的回答文本</label><textarea id="answer-text" class="pair-text"></textarea><button id="accept-answer" class="full">完成连接</button><p class="qr-note">邀请 5 分钟内有效，仅用于这一次连接。每位玩家单独配对一次。</p>`);
  pairId=offer.pairId;await drawQR($('pair-qr'),offer.text);
  const receive=async(text,current=()=>pairId===offer.pairId)=>{
    await host.answer(text);
    if(transport!==host||!current())return;
    pairId=null;closeDialog();toast('回答码已接受，正在等待玩家连接。');
  };
  $('accept-answer').onclick=()=>receive($('answer-text').value.trim()).catch(e=>toast(e.message));
  $('scan-answer').onclick=()=>{pairId=null;scanInto(receive);pairId=offer.pairId;};
}
function joinOffline(p){
  detachTransport(true);
  savePerson({...person,...p},true);
  const previous=view;
  const guest=new OfflineGuest(person,next=>{
    if(transport!==guest)return;
    if(next)showHome=false;
    accept(next);
  },(message,state)=>{
    if(transport!==guest)return;
    status(message,state);
    const note=$('pair-status');
    if(note)note.textContent=message;
  });
  transport=guest;
  status('等待离线配对','terminal');
  void scanInto(async(text,current)=>{
    let answer;
    try{answer=await guest.offer(text);}
    catch(error){guest.close();throw error;}
    if(transport!==guest||!current()){guest.close();return;}
    if(previous?.closed)view=null;
    dialog('请让房主扫描回答码',`<p class="pair-step">第二步 · 房主扫描玩家回答</p><p class="muted">房主点击“扫描玩家回答码”，扫描下方二维码，连接成功后会自动进入牌桌。</p><canvas id="answer-qr" class="pair-qr" aria-label="离线玩家回答二维码"></canvas><details><summary>回答文本</summary><textarea id="answer-result" class="pair-text" readonly>${esc(answer)}</textarea></details><p id="pair-status" class="qr-note" role="status">等待房主扫描。重新扫码会尝试恢复本浏览器的原座位。</p>`,
      '','<button id="retry-offline-pair">重新扫码</button>');
    await drawQR($('answer-qr'),answer);
  });
}
async function prepareOffline(){if(!('serviceWorker'in navigator)||!window.isSecureContext)throw new Error('请通过 HTTPS 或本机 localhost 打开游戏。');const registration=await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;const worker=registration.active||registration.waiting;if(!worker)throw new Error('离线组件正在准备，请稍后重试。');await new Promise((resolve,reject)=>{const channel=new MessageChannel(),timeout=setTimeout(()=>reject(new Error('下载时间较长，请保持联网后重试。')),180000);channel.port1.onmessage=e=>{if(e.data.type==='progress')toast(`离线素材准备中：${e.data.done}/${e.data.total}`);if(e.data.type==='done'){clearTimeout(timeout);resolve();}if(e.data.type==='error'){clearTimeout(timeout);reject(new Error('部分素材未下载完成，请联网后重试。'));}};worker.postMessage({type:'PREPARE_OFFLINE'},[channel.port2]);});toast('离线素材已准备好。断网后可再次打开本站或主屏幕入口。');}
function confirmAction(title,text,fn){
  dialog(title,`<p>${esc(text)}</p>`,'confirm-dialog','<button id="cancel-action">取消</button><button id="confirm-action" class="danger">确认</button>');
  $('confirm-action').onclick=()=>{closeDialog();void run(fn);};
}

function profileDialog(){
  if(view?.game&&view.game.phase!=='finished'){toast('结算后可以修改本局资料。');return;}
  const used=view?.players.filter(p=>p.id!==view.me).map(p=>avatarId(p.avatar))||[];
  dialog('我的圆桌资料',profileForm(person,used,!accountAccess?.signedIn),'setup-dialog','<button id="save-profile" class="primary">保存资料</button>');
  $('save-profile').onclick=()=>{
    try{
      const p=readProfile(),useAccount=$('nickname').dataset.useAccount;
      closeDialog();
      void run(()=>useAccount&&transport===online?online.profile({useAccount:true}):command('profile',p));
    }catch(error){toast(error.message);}
  };
}

function exitRoom(){
  if(!view||view.closed)return;
  if(transport.kind==='practice'){
    confirmAction('结束练习？','当前练习将结束。',()=>{
      transport.close();view=null;publishDisplay(null);showHome=true;render();status('本机练习结束','local');
    });
    return;
  }
  if(isHost())confirmAction('关闭房间？','所有玩家将离席，进行中的一局记为中止。',()=>command('close'));
  else if(view.game&&view.game.phase!=='finished'){toast('本局尚未结束，可以回首页保留席位。');}
  else confirmAction('离开房间？','你将离开当前牌桌。',()=>command('leave'));
}

function hostMenu(){
  const host=isHost();
  const local=transport.kind==='practice';
  dialog(host?'房间管理':'牌桌菜单',`<div class="stack-actions" id="room-menu-content">
    ${(!view.game||view.game.phase==='finished')&&!local?'<button id="profile">我的资料</button>':''}
    ${!view.game&&!local?'<button id="room-settings-menu">本局角色</button>':''}
    <button id="player-records">游戏档案</button>
    ${host&&transport===online&&!view.game?`<button id="add-bot"${disabled(view.players.length>=10)}>添加 1 个人机</button><button id="fill-bots"${disabled(view.players.length>=5)}>补到 5 人</button>`:''}
    ${local?`<button id="practice-pause">${transport.paused?'继续人机':'暂停人机'}</button><button id="practice-step"${disabled(!transport.paused||!transport.canStep)}>人机单步</button>`:''}
    ${host&&view.game?'<button id="reset-room">结束本局，回大厅</button>':''}
    <button id="leave-room" class="danger">${host&&!local?'关闭房间':'离开房间'}</button></div>`);
  $('reset-room')?.addEventListener('click',()=>confirmAction('结束当前对局？','未完成的一局记为中止。',()=>command('reset')));
}

function practiceSetup(){
  if(view&&!view.closed){toast('请先离开当前牌桌。');return;}
  dialog('本机人机练习',`<div class="field"><label for="practice-count">席位数</label><select id="practice-count">
    ${Object.keys(SIZES).map(n=>`<option value="${n}">${n} 人</option>`).join('')}</select></div>
    <div class="field"><label for="practice-role">你的角色</label><select id="practice-role"><option value="">随机</option>
    ${Object.entries(ROLES).map(([id,r])=>`<option value="${id}">${r.name}</option>`).join('')}</select></div><p class="muted">练习使用阿瓦隆规则，记录仅在当前页。</p>`,'setup-dialog',
    '<button id="enter-practice" class="primary">进入练习</button>');
}

function startPractice(){
  const count=Number($('practice-count').value),role=$('practice-role').value||null;
  const p={id:offlinePerson.id,name:person.name,avatar:person.avatar};
  detachTransport(true);
  closeDialog();
  showHome=false;
  let instance;
  instance=new Practice(p,next=>{if(transport===instance)accept(next);},status,{count,role});
  transport=instance;
}

function selectAvatar(picker,value){
  const chosen=avatarId(value);
  const image=picker?.querySelector('summary img');
  if(image)image.src=avatarPath(chosen);
  picker?.querySelectorAll('.avatar-choice').forEach(button=>{
    const active=button.dataset.avatar===chosen;
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
  });
}

function detachTransport(local=false){
  transport?.close(transport===online?{clearIdentity:local}:undefined);
  connecting=null;
  if(local){
    if(transport!==online)online.close({clearIdentity:true});
    person=offlinePerson;
  }
}

function hostOffline(p,saved){
  detachTransport(true);
  showHome=false;
  let first;
  let host;
  host=new OfflineHost(p,next=>{if(!host)first=next;else if(transport===host)accept(next);},status,saved);
  transport=host;
  status('离线主持中','local');
  accept(first??host.view);
}

function roomCode(value){
  let code=value.trim();
  if(/^https?:/i.test(code)){
    try{code=new URL(code).searchParams.get('room')||'';}catch{code='';}
  }
  return /^[A-F0-9]{10}$/i.test(code)?code.toUpperCase():null;
}

const inviteErrors={missing:'这个邀请已失效。',closed:'这个房间已关闭。',running:'这个房间已经开局。',full:'这个房间已坐满。'};

function showOwnRoom(){
  if($('online-setup')?.invitePreview?.code===inviteCode||view?.code===inviteCode)inviteDismissed=true;
  closeDialog();
  showHome=!view||view.closed;
  render();
}

function setupOnline(mode,{code='',preview=null,draft=null,focusCode=false}={}){
  if(mode==='create'&&view&&!view.closed){toast('请先离开或继续当前牌桌。');return;}
  const join=mode==='join',current=preview?.current;
  const switching=current&&current.code!==code;
  const used=preview?.usedAvatars||[];
  const starting=draft||newGuestProfile();
  const requested=used.includes(avatarId(starting.avatar))?{...starting,avatar:randomProfile(starting,used).avatar}:starting;
  const notice=switching?(current.host?
    `加入后将关闭你主持的 ${current.code} 房间${current.playing?'，进行中的一局将记为中止':''}。`:
    `加入前将先离开 ${current.code} 房间。`):'';
  dialog(join?'加入房间':'创建房间',
    `<form id="online-setup" data-mode="${mode}">
      ${join?`<div class="field"><label for="join-code">房间码或邀请链接</label><input id="join-code" value="${esc(code)}" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="180"></div>`:''}
      ${notice?`<p class="notice">${esc(notice)}</p>`:''}
      ${profileForm(requested,used,!accountAccess?.signedIn)}
    </form>`,'setup-dialog',
    `${switching?'<button id="return-own-table">回原牌桌</button>':''}<button id="submit-online" type="submit" form="online-setup" class="primary">${switching?'确认切换':join?'加入房间':'创建房间'}</button>`);
  const form=$('online-setup');
  form.invitePreview=preview;
  if(join){
    const avatarAvailability=entries=>{
      const picker=form.querySelector('.game-avatar-picker');
      const selected=picker.querySelector('.active')?.dataset.avatar;
      if(entries.includes(selected)){
        selectAvatar(picker,randomProfile({avatar:selected},entries).avatar);
        delete $('nickname').dataset.useAccount;
      }
      applyAvatarAvailability(picker,entries);
    };
    $('join-code').addEventListener('change',()=>{
      const next=roomCode($('join-code').value);
      if(!next){avatarAvailability([]);return;}
      if(next===form.invitePreview?.code){avatarAvailability(form.invitePreview.usedAvatars);return;}
      avatarAvailability([]);
      void online.previewInvite(next).then(p=>{
        if(!form.isConnected||roomCode($('join-code').value)!==next)return;
        if(p.status==='open')avatarAvailability(p.usedAvatars);
      }).catch(()=>{});
    });
    if(focusCode)$('join-code').focus();
  }
}

async function openInviteFromLink(code){
  const generation=online.generation;
  if(!roomCode(code)){toast('邀请链接格式不正确。');return;}
  try{
    const preview=await online.previewInvite(code);
    if(!stillOnline(generation))return;
    if(preview.status==='current'){showOwnRoom();return;}
    if(preview.status==='open'){
      if(preview.current&&!preview.canSwitch){toast('你正在对局，结束后可加入其他房间。');return;}
      setupOnline('join',{code,preview});
    }else toast(inviteErrors[preview.status]||'当前邀请无法使用。');
  }catch(error){if(stillOnline(generation))toast(error.message);}
}

function applyAvatarAvailability(picker,used){
  picker.querySelectorAll('.avatar-choice').forEach(button=>{
    const option=CATALOGUE.find(avatar=>avatar.id===button.dataset.avatar);
    const locked=used.includes(button.dataset.avatar)&&!button.classList.contains('active');
    button.disabled=locked;
    button.querySelector('span').textContent=option.name+(locked?' · 已使用':'');
    button.setAttribute('aria-label',option.name+(locked?'，已使用':''));
  });
}

async function enterOnline(form){
  if(busy||!form.isConnected)return;
  const create=form.dataset.mode==='create';
  const p=readProfile();
  const useAccount=$('nickname').dataset.useAccount;
  const code=create?null:roomCode($('join-code').value);
  if(!create&&!code){toast('请输入完整的房间码或邀请链接。');$('join-code').focus();return;}
  const submit=$('submit-online');
  submit.disabled=true;
  await run(async()=>{
    if(transport!==online){
      if(view&&!view.closed)throw new Error('请先离开当前本机牌桌。');
      detachTransport();transport=online;
    }
    const generation=online.generation;
    if(!online.person){
      const resumed=await online.boot();
      if(!stillOnline(generation))return;
      savePerson(resumed.person);
    }
    if(!stillOnline(generation)||!form.isConnected)return;
    let from;
    if(!create){
      const preview=await online.previewInvite(code);
      if(!form.isConnected||!stillOnline(generation))return;
      if(preview.status==='current'){showOwnRoom();return;}
      if(preview.status!=='open')throw new Error(inviteErrors[preview.status]||'当前房间无法加入。');
      if(preview.current){
        if(!preview.canSwitch)throw new Error('请完成当前对局后再加入其他房间。');
        const confirmed=form.invitePreview?.current;
        if(form.invitePreview?.code!==code||confirmed?.version!==preview.current.version||confirmed?.code!==preview.current.code){
          setupOnline('join',{code,preview,draft:p});
          return;
        }
        from={code:preview.current.code,version:preview.current.version};
      }
    }else if(view&&!view.closed){throw new Error('请先离开或继续当前牌桌。');}
    if(!from&&(useAccount||p.name!==online.person.name||p.avatar!==online.person.avatar)){
      await online.profile(useAccount?{useAccount:true}:p);
    }
    if(!stillOnline(generation)||!form.isConnected)return;
    savePerson(online.person);
    const room=await (create?online.create(DEFAULT_SETTINGS):online.join(code,from?{from,profile:useAccount?{useAccount:true}:p}:undefined));
    if(!stillOnline(generation)||!room)return;
    if(inviteCode===code)inviteDismissed=true;
    closeDialog();
    showHome=false;
  });
  if(submit.isConnected)submit.disabled=false;
}

function shuffleProfile(){
  const field=$('nickname');
  const picker=$('modal-body').querySelector('.game-avatar-picker');
  const used=Array.from(picker.querySelectorAll('.avatar-choice:disabled'),node=>node.dataset.avatar);
  const chosen=randomProfile({name:field.value,avatar:picker.querySelector('.active')?.dataset.avatar},used);
  field.value=chosen.name;
  delete field.dataset.useAccount;
  selectAvatar(picker,chosen.avatar);
  applyAvatarAvailability(picker,used);
  playCue('pick');
}

function setupOffline(mode){
  if(view&&!view.closed){toast('请先离开当前牌桌。');return;}
  const local=offlinePerson.name==='圆桌旅人'?{...offlinePerson,...randomProfile(offlinePerson)}:offlinePerson;
  dialog(mode==='create'?'创建离线房间':'扫描离线邀请',
    profileForm(local,[],true),'setup-dialog',
    `<button id="submit-offline" type="button" class="primary" data-offline-mode="${mode}">${mode==='create'?'创建离线房间':'打开扫码'}</button>`);
}

function submitOffline(mode){
  const p={id:offlinePerson.id,...readProfile()};
  if(mode==='join'){joinOffline(p);return;}
  closeDialog();
  if(OfflineHost.saved())confirmAction('替换本机离线牌桌？','已完成的离线战绩会保留。',()=>hostOffline(p));
  else run(()=>hostOffline(p));
}

function useAccountProfile(){
  const profile=accountAccess?.profile;
  if(!profile)return;
  const container=$('modal').open?$('modal-body'):$('app');
  const field=container.querySelector('#nickname');
  field.value=profile.name;
  const picker=container.querySelector('.game-avatar-picker');
  const target=Array.from(picker.querySelectorAll('[data-avatar]')).find(button=>button.dataset.avatar===avatarId(profile.avatar));
  if(target?.disabled){
    delete field.dataset.useAccount;
    toast('账号头像已被使用，已填入账号昵称。');
    return;
  }
  field.dataset.useAccount='true';
  selectAvatar(picker,profile.avatar);
  toast('已填入账号昵称和头像。');
}

function previewGuest(){
  const panel=$('account-panel');
  const generation=online.generation;
  run(async()=>{
    const preview=await online.request('/api/account/guest-preview',{});
    if(!panel.isConnected||generation!==online.generation)return;
    guestPreview=preview;
    dialog('认领游客席位与战绩',`<p>${preview.code?`房间 ${esc(preview.code)} · ${preview.players} 人。`:''}包含 ${preview.records} 场游客记录，昵称为 ${esc(preview.name)}。</p><p>确认后使用本账号在阿瓦隆的一次认领机会。</p><div class="actions-row"><button id="claim-guest" class="primary">确认认领</button><button id="cancel-claim">取消</button></div>`);
  });
}

function claimGuest(){
  const preview=guestPreview;
  if(!preview)return;
  run(async()=>{
    const generation=online.generation;
    await online.request('/api/account/guest-claim',{previewToken:preview.previewToken,confirm:true});
    if(generation!==online.generation)return;
    guestPreview=null;
    closeDialog();
    if(transport===online)resetOnlineIdentity();
    else accountAccess=await online.request('/api/account');
    toast('已认领游客席位与战绩。');
  });
}

document.addEventListener('change',e=>{
  const key=e.target.dataset.setting;
  if(!key||!view||view.game||!isHost())return;
  settingsDraft||={...view.settings};
  settingsDraft[key]=e.target.checked;
  if(Object.keys(SETTING_LABEL).every(setting=>settingsDraft[setting]===view.settings[setting]))settingsDraft=null;
  const limit=$('modal-body').querySelector('[data-role-limit]');
  if(limit){
    const total=1+['morgana','mordred','oberon'].filter(role=>(settingsDraft||view.settings)[role]).length;
    limit.textContent=EVIL[view.players.length]&&total>EVIL[view.players.length]?`本桌 ${EVIL[view.players.length]} 个邪恶席位，当前选择了 ${total} 个特殊邪恶角色。`:'梅林和刺客固定入场。';
  }
  render();
});
document.addEventListener('input',e=>{
  if(e.target.id!=='nickname')return;
  delete e.target.dataset.useAccount;
});
document.addEventListener('submit',e=>{
  if(e.target.id!=='online-setup')return;
  e.preventDefault();
  void enterOnline(e.target).catch(error=>toast(error.message));
});

$('modal').addEventListener('input',e=>{
  const input=e.target,key=input.dataset.audio;
  if(input.id==='scene-lighting'){setLighting(input.value);return;}
  if(!key)return;
  const value=input.type==='checkbox'?input.checked:input.type==='range'?input.valueAsNumber:input.value;
  const settings=setAudioSettings({[key]:value},e);
  const meter=$(key+'-value');
  if(meter)meter.textContent=settings[key]+'%';
});

document.addEventListener('click',e=>{
  try{
    const avatar=e.target.closest('[data-avatar]');
    if(avatar){
      const picker=avatar.closest('.game-avatar-picker');
      const field=($('modal').open?$('modal-body'):$('app')).querySelector('#nickname');
      if(field)delete field.dataset.useAccount;
      selectAvatar(picker,avatar.dataset.avatar);
      playCue('pick');
      return;
    }
    const selectedPlayer=e.target.closest('[data-player-info]')?.dataset.playerInfo;
    if(selectedPlayer){viewPlayer(selectedPlayer);return;}
    const seat=e.target.closest('[data-seat]');
    if(seat&&!seat.disabled){
      const g=view.game,id=seat.dataset.seat;
      if(!canPick(g,id)){viewPlayer(id);return;}
      if(selection.has(id))selection.delete(id);
      else if(g.phase==='nominate'){
        if(selection.size>=g.needed){toast(`本轮只需要 ${g.needed} 人。`);return;}
        selection.add(id);
      }else{selection.clear();selection.add(id);}
      playCue('pick');
      render();
      return;
    }
    const kick=e.target.closest('[data-kick]')?.dataset.kick;
    if(kick){confirmAction('移出这位玩家？',`${name(kick)} 将离开大厅，仍可通过邀请重新加入。`,()=>command('kick',{playerId:kick}));return;}
    const removeBot=e.target.closest('[data-remove-bot]')?.dataset.removeBot;
    if(removeBot){closeDialog();run(()=>command('removeBot',{playerId:removeBot}));return;}
    const id=e.target.closest('button,a')?.id;
    if(!id)return;
    switch(id){
      case 'player-records': case 'home-records': openRecords();return;
      case 'offline-records': case 'home-offline-records': showOfflineRecords();return;
      case 'account-menu': case 'account-details': accountMenu();return;
      case 'audio-settings': soundSettings();return;
      case 'preview-sound': playCue('success');return;
      case 'retry-online': if(!online.resume())void syncOnline();return;
      case 'use-account-profile': useAccountProfile();return;
      case 'shuffle-profile': shuffleProfile();return;
      case 'preview-guest': previewGuest();return;
      case 'cancel-claim': guestPreview=null;closeDialog();return;
      case 'claim-guest': claimGuest();return;
      case 'guide': case 'guide-home': case 'guide-game': case 'guide-game-desktop': guide();return;
      case 'guide-room': case 'guide-room-desktop': case 'home-handbook': guide('roles');return;
      case 'home-quests': guide('quests');return;
      case 'modal-close': case 'cancel-action':
        if($('online-setup')?.invitePreview?.code===inviteCode)inviteDismissed=true;
        closeDialog();return;
      case 'peek-role': case 'identity-header': peekRole();return;
      case 'invite': invite();return;
      case 'profile': profileDialog();return;
      case 'room-menu': hostMenu();return;
      case 'room-settings-menu': case 'lobby-mobile-settings': showRoomSettings();return;
      case 'go-home': case 'brand-home': e.preventDefault();closeDialog();dismissScene();showHome=true;render();return;
      case 'resume-current': case 'return-own-table': showOwnRoom();return;
      case 'create-online': setupOnline('create');return;
      case 'join-online': setupOnline('join',{code:inviteCode,focusCode:true});return;
      case 'public-history': showPublicHistory();return;
      case 'public-screen': openPublicDisplay(view);return;
      case 'offline-menu': offlineMenu();return;
      case 'practice-menu': practiceSetup();return;
      case 'enter-practice': startPractice();return;
      case 'practice-pause': transport.setPaused(!transport.paused);hostMenu();return;
      case 'practice-step': if(transport.canStep)transport.step();hostMenu();return;
      case 'add-bot': run(async()=>{await command('addBot');hostMenu();});return;
      case 'fill-bots': run(async()=>{await command('fillBots');hostMenu();});return;
      case 'fill-room-bots': run(()=>command('fillBots'));return;
      case 'pair-host': run(pairHost);return;
      case 'retry-offline': case 'retry-offline-pair': run(()=>joinOffline(person));return;
      case 'prepare-offline': run(prepareOffline);return;
      case 'close-own-room': case 'leave-room': exitRoom();return;
      case 'create-offline': setupOffline('create');return;
      case 'join-offline': setupOffline('join');return;
      case 'submit-offline': submitOffline($('submit-offline').dataset.offlineMode);return;
      case 'restore-offline':
        if(view&&!view.closed){toast('请先离开当前牌桌。');return;}
        closeDialog();
        run(()=>{const saved=OfflineHost.saved();if(!saved)throw new Error('原离线牌桌已过期。');hostOffline(saved.person,saved);});
        return;
    }
    if(!view||view.closed)return;
    if(id==='private-intel'||id==='private-intel-desktop'){
      dialog('我的查验记录',`<div id="private-intel-dialog" class="intel">${view.game.privateIntel.map(r=>`第 ${r.quest} 轮后：${esc(name(r.playerId))} · <strong>${r.side==='good'?'好人阵营':'邪恶阵营'}</strong>`).join('<br>')}</div><p class="private-reminder">这些结果只在你的设备显示。</p>`);
      return;
    }
    const commands={
      ready:()=>command('ready',{ready:!me().ready}),start:()=>command('start'),
      'save-settings':async()=>{if(settingsDraft){await command('settings',{settings:settingsDraft});settingsDraft=null;}closeDialog();},
      'save-settings-inline':async()=>{if(settingsDraft){await command('settings',{settings:settingsDraft});settingsDraft=null;}},
      nominate:()=>command('nominate',{players:[...selection]}),
      'vote-yes':()=>command('vote',{approve:true}),'vote-no':()=>command('vote',{approve:false}),
      'guide-vote-yes':()=>command('vote',{approve:true}),'guide-vote-no':()=>command('vote',{approve:false}),
      'quest-success':()=>command('quest',{success:true}),'quest-fail':()=>command('quest',{success:false}),
      continue:()=>command('continue'),inspect:()=>command('inspect',{playerId:[...selection][0]}),
      rematch:()=>command('reset'),
    };
    if(id==='assassinate'){
      const [target]=selection;
      confirmAction('确认最终指认？',`你将指认 ${name(target)} 为梅林。确认后立即结算。`,()=>command('assassinate',{playerId:target}));
    }else if(Object.hasOwn(commands,id))run(commands[id]);
  }catch(error){toast(error.message||'操作未完成，请重试。');}
});

$('modal').addEventListener('close',()=>{if(!$('modal').open)clearDialog();});
function clearPrivate(){
  if($('private-wrapper')||$('private-intel-dialog')||$('private-player-clue'))closeDialog();
}
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){stopScan?.();stopScan=null;clearPrivate();dismissScene();}
});
window.addEventListener('blur',clearPrivate);
window.addEventListener('pagehide',()=>{stopScan?.();publishDisplay(null);});
window.addEventListener('online',()=>{if(transport===online&&!online.resume()&&!view&&networkState==='degraded')void syncOnline();});

function measureViewport(){
  const viewport=window.visualViewport;
  const height=Math.floor(viewport?.height??window.innerHeight);
  document.documentElement.style.setProperty('--visual-height',`${height}px`);
  document.documentElement.style.setProperty('--visual-top',`${Math.floor(viewport?.offsetTop??0)}px`);
  document.body.toggleAttribute('data-short-viewport',height<500);
}
measureViewport();
window.addEventListener('resize',measureViewport);
window.visualViewport?.addEventListener('resize',measureViewport);
window.visualViewport?.addEventListener('scroll',measureViewport);
if('serviceWorker'in navigator&&window.isSecureContext)navigator.serviceWorker.register('/sw.js').catch(()=>{});
if(displayId&&/^[0-9a-f-]{36}$/.test(displayId)){
  mountPublicDisplay($('app'),displayId,{
    sound:(phase,winner)=>{updateLighting(phase,winner);stages.sound(phase,winner);},
    settings:soundSettings,
    animate:(old,next)=>stages.update(old,next,{publicOnly:true,live:Boolean(old)}),
  });
}else if(query.get('preview')==='effects'){
  updateLighting('home');
  mountExperience($('app'));
}else{
  for(const path of ['/_fribench/client.js','/_fribench/account-view.js']){
    const script=document.createElement('script');script.async=false;script.src=path;document.head.append(script);
  }
  void syncOnline();
  render();
}
