import {ROLES,SIZES,EVIL,DEFAULT_SETTINGS,AVATARS,nickname} from '../shared/engine.mjs';
import {Online,OfflineHost,OfflineGuest,actionKey} from './transports.mjs';
import {drawQR,startScanner} from './qr.mjs';
import {AVATARS as CATALOGUE,avatarId,avatarPath} from '../shared/fribench-game-kit/avatars.mjs';
import {mountJournal} from '../shared/fribench-game-kit/journal-view.mjs';
import {handbookMarkup,mountHandbook,roleArt} from './handbook.mjs';
import {AUDIO_TRACKS,getAudioSettings,setAudioSettings,setAudioScene,playCue} from './audio.mjs';
import {roundScene} from './scenes.mjs';

const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LABEL={reveal:'确认身份',nominate:'队长组队',vote:'队伍表决',quest:'执行任务',questResult:'任务揭晓',lady:'湖中仙女',assassin:'刺杀梅林',finished:'终局揭晓'};
const SETTING_LABEL={percival:'派西维尔',morgana:'莫甘娜',mordred:'莫德雷德',oberon:'奥伯伦',lady:'湖中仙女'};
const PROFILE_KEY='avalon.profile.v1';
const query=new URLSearchParams(location.search);
const inviteCode=query.get('room')?.toUpperCase()||'';
const defaultPerson=()=>({id:crypto.randomUUID(),name:'圆桌旅人',avatar:AVATARS[0]});
let person;
try{person=JSON.parse(localStorage.getItem(PROFILE_KEY));}catch{}
person||=defaultPerson();
let offlinePerson=person;
let transport=null,view=null,busy=false,showHome=true,selection=new Set(),lastKey=null,settingsDraft=null,stopScan=null,pairId=null,toastTimer,sceneTimer;
const online=new Online(
  next=>{if(transport===online)accept(next);},
  (text,state)=>{if(transport===online)status(text,state==='idle'?'live':state);},
  {
    onIdentityChange:()=>{if(transport===online)resetOnlineIdentity();},
    onCommandError:message=>{if(transport===online)toast(message);},
  }
);
let accountAccess=null,guestPreview=null,cleanupJournal=null,homeDraft=null,clearDraft=false;
let knownAccount,connecting=null,accountError=false,networkState='connecting',homeEdited=false;

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
  if(state==='live'&&['reconnecting','degraded'].includes(networkState))playCue('reconnect');
  networkState=state||(transport?.kind==='online'?'live':'local');
  if(node.textContent!==text)node.textContent=text;
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
  online.close({clearIdentity:true});
  connecting=null;
  accountAccess=null;
  guestPreview=null;
  accountError=false;
  transport=online;
  person=defaultPerson();
  clearDraft=true;
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
  $('modal-feedback').hidden=true;
  $('modal-body').replaceChildren();
}
function closeDialog(){if($('modal').open)$('modal').close();clearDialog();}
function dialog(title,body,kind=''){
  closeDialog();
  $('modal').className=kind;
  $('modal-body').innerHTML=`<h2 id="modal-title" class="dialog-title">${esc(title)}</h2>${body}`;
  $('modal').showModal();
}
function dismissScene(){
  clearTimeout(sceneTimer);
  $('scene-notice').hidden=true;
}
function showScene(scene){
  if(!scene||showHome||document.hidden||['degraded','reconnecting'].includes(networkState))return;
  const banner=$('scene-notice');
  dismissScene();
  banner.innerHTML=`<span class="scene-symbol" data-icon="${scene.icon}" aria-hidden="true"></span><span><strong>${esc(scene.title)}</strong><small>${esc(scene.detail)}</small></span>`;
  banner.dataset.tone=scene.tone;
  banner.hidden=false;
  playCue(scene.cue);
  sceneTimer=setTimeout(dismissScene,2800);
}
function accept(next){
  recordOffline(next);
  const scene=roundScene(view,next);
  const different=view?.id!==next?.id;
  if(different||next?.closed||view?.game?.id!==next?.game?.id){
    if(!next||next.closed||$('private-wrapper')||$('private-intel-dialog'))closeDialog();
    dismissScene();
  }
  view=next;
  if(different){selection.clear();settingsDraft=null;lastKey=null;}
  if(next){
    if($('answer-qr'))closeDialog();
    const key=actionKey(next);
    if(key!==lastKey){selection.clear();lastKey=key;}
    const player=next.players.find(p=>p.id===next.me);
    if(player)savePerson(player);
  }else showHome=true;
  render();
  showScene(scene);
}
function me(){return view?.players.find(p=>p.id===view.me);}
function name(id){return view?.players.find(p=>p.id===id)?.name||'已离开的玩家';}
function recordOffline(next){
  if(!transport||transport.kind==='online'||next?.game?.phase!=='finished')return;
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
function avatars(current){return `<details class="game-avatar-picker"><summary>${avatarImage(current)}选择头像 · ${CATALOGUE.length} 个</summary><div class="game-avatar-grid" role="group" aria-label="选择头像">${CATALOGUE.map(a=>`<button type="button" class="avatar-choice ${a.id===avatarId(current)?'active':''}" data-avatar="${a.id}" aria-label="选择${esc(a.name)}头像" aria-pressed="${a.id===avatarId(current)}">${avatarImage(a.id,52)}<span>${esc(a.name)}</span></button>`).join('')}</div></details>`;}
function profileForm(){return `<div class="field"><label for="nickname">游戏昵称</label><input id="nickname" value="${esc(person.name)}" placeholder="1～30 个字符，昵称可以重复" maxlength="60" autocomplete="nickname"></div><div class="field"><label>圆桌形象 · 不修改账号中心</label>${avatars(person.avatar)}</div>${accountAccess?.signedIn?'<button type="button" id="use-account-profile" class="profile-account-use">使用我的账号昵称与头像</button>':''}`;}
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
  if(activeTransport===transport&&['ready','confirmRole','nominate','vote','quest','inspect','assassinate'].includes(type))playCue('submit');
  return result;
}

function renderHome(){
  const root=$('app'), nicknameField=root.querySelector('#nickname');
  if(clearDraft){homeDraft=null;homeEdited=false;clearDraft=false;}
  else if(nicknameField){
    homeDraft={name:homeEdited?nicknameField.value:person.name,avatar:homeEdited?root.querySelector('.avatar-choice.active')?.dataset.avatar??person.avatar:person.avatar,
      code:$('join-code')?.value??'',avatarsOpen:root.querySelector('.game-avatar-picker')?.open,useAccount:nicknameField.dataset.useAccount};
  }
  const saved=OfflineHost.saved();
  const invited=/^[A-F0-9]{10}$/.test(inviteCode);
  const blocked=busy||Boolean(connecting);
  root.innerHTML=`
    <section class="hero camelot">
      <div class="hero-copy">
        <p class="eyebrow">5–10 人 · 好友推理桌游</p>
        <h1>阿瓦隆</h1>
        <p>围坐圆桌，选出你信任的伙伴。</p>
        <div class="hero-actions"><a class="button-link primary" href="#online-table">${invited?'前往邀请牌桌':'开始游戏'}</a><button id="home-handbook">角色图鉴</button></div>
      </div>
    </section>
    ${view&&!view.closed?`<section class="notice resume-box"><div><strong>你已坐在${transport?.kind==='online'?'在线':'离线'}牌桌</strong><span>${esc(view.code)}${view.game?' · '+LABEL[view.game.phase]:''}</span></div><button id="resume-current" class="primary">继续本局</button></section>`:''}
    <div class="home-grid">
      <section class="panel home-panel identity-panel"><h2>你的圆桌身份</h2>${profileForm()}
        <div class="account-shortcut"><span class="muted">${accountAccess?.signedIn?'已登录 Fribench':accountError?'账号暂不可用':'支持游客入座'}</span><button id="account-details">账号与席位</button></div>
      </section>
      <section id="online-table" class="panel home-panel"><h2>在线好友局</h2>
        <p class="muted">用邀请链接或房间码入座，刷新后可恢复座位。</p>
        <form id="join-form" class="join-form">
          <label for="join-code">房间码或邀请链接</label>
          <div class="form-row"><input id="join-code" placeholder="例如 8DA1E108C9" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="180"><button id="join-online" type="submit" class="primary"${disabled(blocked)}>加入牌桌</button></div>
        </form>
        <button id="create-online" class="full"${disabled(blocked)}>创建在线房间</button>
      </section>
      <section class="panel home-panel"><h2>离线同桌局</h2>
        <p class="muted">在同一 Wi-Fi 或热点双向扫码，房主设备主持本局。</p>
        <div class="actions-row"><button id="create-offline"${disabled(busy)}>创建离线房间</button><button id="join-offline"${disabled(busy)}>扫码加入</button></div>
        ${saved?'<button id="restore-offline" class="full">恢复本机离线牌桌</button>':''}
        <button id="prepare-offline" class="full"${disabled(busy)}>准备离线素材</button>
      </section>
    </div>
    <div class="home-resources"><button id="home-records">游戏档案</button><button id="home-quests">任务人数表</button><button id="home-offline-records">本机离线记录</button></div>`;
  $('join-code').value=homeDraft?.code??(invited?inviteCode:'');
  if(homeDraft){
    $('nickname').value=homeDraft.name;
    if(homeDraft.useAccount)$('nickname').dataset.useAccount='true';
    const picker=root.querySelector('.game-avatar-picker');
    picker.open=Boolean(homeDraft.avatarsOpen);
    selectAvatar(picker,homeDraft.avatar);
  }
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
  dialog('声音设置',`<div class="sound-settings">
    <section><label class="audio-toggle"><input type="checkbox" data-audio="music"${prefs.music?' checked':''}>背景音乐</label>
      <label for="audio-track">配乐</label><select id="audio-track" data-audio="track">${Object.entries(AUDIO_TRACKS).map(([id,label])=>`<option value="${id}"${prefs.track===id?' selected':''}>${label}</option>`).join('')}</select>
      <label class="audio-range">音乐音量 <output id="musicVolume-value">${prefs.musicVolume}%</output><input type="range" data-audio="musicVolume" value="${prefs.musicVolume}" min="0" max="100"></label>
    </section>
    <section><label class="audio-toggle"><input type="checkbox" data-audio="effects"${prefs.effects?' checked':''}>操作音效</label>
      <label class="audio-range">音效音量 <output id="effectsVolume-value">${prefs.effectsVolume}%</output><input type="range" data-audio="effectsVolume" value="${prefs.effectsVolume}" min="0" max="100"></label>
      <button id="preview-sound">试听音效</button>
    </section><p class="muted">声音设置保存在当前设备。</p></div>`);
}
function roomTop(){
  const mode={online:'在线好友局','offline-host':'离线同桌 · 你是主持人','offline-guest':'离线同桌'}[transport.kind];
  return `<section class="room-top">
    <div><span class="mode-label">${mode}</span><h1>${view.game?'卡美洛圆桌':'房间大厅'}</h1><span class="room-code">${esc(view.code)}</span></div>
    <div class="room-tools">
      ${transport.kind==='online'?'<button id="invite" class="primary">邀请朋友</button>':transport.kind==='offline-host'?'<button id="pair-host" class="primary">添加 / 重连玩家</button>':`<button id="retry-offline"${networkState==='terminal'?'':' hidden'}>重新扫码</button>`}
      ${!view.game||view.game.phase==='finished'?'<button id="profile">我的资料</button><button id="player-records">游戏档案</button>':''}
      ${view.game&&view.game.phase!=='finished'?'<button id="peek-role-mobile" class="mobile-role">我的身份</button>':''}
      <button id="go-home">返回首页</button>${isHost()?'<button id="room-menu">房主管理</button>':'<button id="leave-room">离开房间</button>'}
    </div>
  </section>`;
}
function settingFields(){
  const settings=settingsDraft||view.settings;
  return `<div class="settings-grid">${Object.entries(SETTING_LABEL).map(([key,label])=>
    `<label class="setting"><input id="setting-${key}" type="checkbox" data-setting="${key}"${settings[key]?' checked':''}${disabled(!isHost()||busy)}>${label}</label>`).join('')}</div>`;
}
function renderLobby(){
  const allReady=view.players.every(p=>p.ready&&p.online),validCount=!!SIZES[view.players.length];
  const options=settingsDraft||view.settings;
  const specialEvil=1+['morgana','mordred','oberon'].filter(role=>options[role]).length;
  const capacity=EVIL[view.players.length];
  const fits=!capacity||specialEvil<=capacity;
  const roster=view.players.map((p,i)=>`<div class="roster-item ${p.id===view.me?'mine':''} ${p.online?'':'disconnected'}">
    <span class="seat-index">${String(i+1).padStart(2,'0')}</span>${avatarImage(p.avatar,42)}
    <div class="roster-name">${esc(p.name)}${p.id===view.me?' · 你':''}<small>${p.id===view.hostId?'房主 · ':''}${p.online?'已连接':'等待重连'}</small></div>
    <span class="${p.ready?'ready':'muted'}">${p.ready?'已准备':'未准备'}</span>${isHost()&&p.id!==view.me?`<button data-kick="${p.id}" aria-label="移出 ${esc(p.name)}">移出</button>`:''}
  </div>`).join('');
  const readyCount=view.players.filter(p=>p.ready&&p.online).length;
  $('app').innerHTML=roomTop()+`<div class="room-columns">
    <section class="panel"><div class="panel-heading"><h2>圆桌席位</h2><span class="badge">${view.players.length} / 10 人</span></div>
      <div class="roster">${roster}</div>
      <p class="role-list">${validCount?`${view.players.length-EVIL[view.players.length]} 位好人 · ${EVIL[view.players.length]} 位邪恶 · ${readyCount}/${view.players.length} 人就绪`:`至少需要 5 人开局，还差 ${5-view.players.length} 人。`}</p>
      <div class="lobby-bottom"><button id="ready" class="${me().ready?'':'primary'}"${disabled(busy)}>${me().ready?'取消准备':'我准备好了'}</button>${isHost()?`<button id="start" class="primary"${disabled(busy||!validCount||!allReady||!fits||settingsDraft)}>发放身份</button>`:''}</div>
    </section>
    <section class="panel"><h2>本局角色</h2><p class="muted">梅林和刺客固定加入。保存新配置后，全员需要重新准备。</p>
      ${settingFields()}${isHost()?`<button id="save-settings" class="full"${disabled(busy||!settingsDraft)}>保存角色设置</button>`:''}
      ${!fits?`<p class="role-list role-limit">已选 ${specialEvil} 位特殊邪恶角色，本桌有 ${capacity} 个邪恶席位。开局前请减少角色或增加玩家。</p>`:settingsDraft?'<p class="role-list">保存后才会应用到本局。</p>':''}
      <button id="guide-room" class="full role-reference">查看角色图鉴</button>
    </section>
  </div>`;
}
function history(){const g=view.game;return `<details class="history" id="history"><summary>公开记录 · ${g.proposals.length} 次组队表决</summary><div class="history-body">${g.proposals.length?g.proposals.map((p,i)=>`<div class="history-item"><p>第 ${p.quest} 轮 · 第 ${i+1} 次提案 · ${p.approved?'通过':'未通过'}</p><p class="muted">队长 ${esc(name(p.leaderId))} · 出征：${p.team.map(id=>esc(name(id))).join('、')}</p><div class="vote-grid">${view.players.map(player=>`<span class="vote-tag ${p.votes[player.id]?'yes':'no'}">${esc(player.name)} ${p.votes[player.id]?'赞成':'反对'}</span>`).join('')}</div></div>`).join(''):'<p class="muted">所有人提交表决后，才会同时公布每个人的选择。</p>'}${g.results.map(r=>`<div class="history-item"><p>第 ${r.quest} 轮任务：${r.success?'成功':'失败'}</p><p class="muted">成功 ${r.successes} 张 · 失败 ${r.fails} 张 · 失败门槛 ${r.threshold} 张</p></div>`).join('')}${g.ladyHistory.map(r=>`<p class="history-item">第 ${r.quest} 轮后，${esc(name(r.from))} 查验了 ${esc(name(r.to))}。阵营只向查验者显示。</p>`).join('')}</div></details>`;}
function actionPanel(){const g=view.game,host=isHost(),selected=[...selection];let title='',text='',buttons='';
  if(g.phase==='reveal'){title='你的身份已封入卡牌';text=`已确认 ${g.confirmed.length} / ${view.players.length} 人。查看自己的身份与专属信息后再确认。`;buttons=`<button id="peek-role" class="primary">按住查看身份</button>`;}
  if(g.phase==='nominate'){title=g.leaderId===view.me?'由你挑选出征队伍':`等待 ${name(g.leaderId)} 组队`;text=`本轮需要 ${g.needed} 人${g.threshold===2?'；这一轮需要至少两张失败牌才会失败':''}。${g.leaderId===view.me?'点击圆桌上的玩家，选好后确认。':'可以先开麦讨论，队长确认队伍后进入表决。'}`;if(g.leaderId===view.me)buttons=`<button id="nominate" class="primary"${disabled(busy||selected.length!==g.needed)}>确认出征队伍（${selected.length}/${g.needed}）</button>`;}
  if(g.phase==='vote'){title='是否赞成这支队伍？';text=`出征：${g.team.map(id=>name(id)).join('、')}。已表决 ${g.voted.length}/${view.players.length} 人。${g.myVote===null?'所有人提交后统一公开表决。':`你已提交${g.myVote?'赞成':'反对'}，请等待其他玩家。`}`;if(g.myVote===null)buttons=`<button id="vote-yes" class="primary"${disabled(busy)}>赞成出征</button><button id="vote-no"${disabled(busy)}>反对出征</button>`;}
  if(g.phase==='quest'){const inTeam=g.team.includes(view.me);title=inTeam?'提交你的任务牌':'等待队员执行任务';text=`已提交 ${g.questSubmitted.length}/${g.team.length} 人。${inTeam?'个人出牌不会公开，所有牌收齐后只显示汇总。':'你不在本轮出征队伍中，可以继续观察和讨论。'}`;if(inTeam&&g.myQuest===null)buttons=`<button id="quest-success" class="primary"${disabled(busy)}>任务成功</button>${ROLES[g.myRole].side==='evil'?`<button id="quest-fail" class="danger"${disabled(busy)}>任务失败</button>`:''}`;else if(inTeam)text+=' 你的任务牌已提交。';}
  if(g.phase==='questResult'){const r=g.results.at(-1);title=`第 ${r.quest} 轮任务${r.success?'成功':'失败'}`;text=`成功 ${r.successes} 张，失败 ${r.fails} 张；本轮需要 ${r.threshold} 张失败牌才会失败。${host?'讨论结束后，由你推进下一阶段。':'等待房主推进下一阶段。'}`;if(host)buttons=`<button id="continue" class="primary"${disabled(busy)}>继续下一阶段</button>`;}
  if(g.phase==='lady'){const mine=g.ladyHolder===view.me;title=mine?'由你使用湖中仙女':`等待 ${name(g.ladyHolder)} 查验`;text='请选择一位未持有过湖中仙女的玩家。结果只给查验者，标记随后交给被查验者。';if(mine)buttons=`<button id="inspect" class="primary"${disabled(busy||selected.length!==1)}>查验${selected.length?' '+esc(name(selected[0])):''}</button>`;}
  if(g.phase==='assassin'){const mine=g.myRole==='assassin';title=mine?'最后一击，由你决定':'好人已完成三次任务';text=mine?'与邪恶同伴讨论后，选择你认为的梅林。指认一旦确认就会结算，不能反悔。':'等待刺客作出最终选择。此时仍可继续语音讨论。';if(mine)buttons=`<button id="assassinate" class="danger"${disabled(busy||selected.length!==1)}>确认刺杀${selected.length?' '+esc(name(selected[0])):''}</button>`;}
  return `<section class="action-panel"><h3>${esc(title)}</h3><p>${esc(text)}</p>${buttons?`<div class="actions-row">${buttons}</div>`:''}</section>`;
}
function renderGame(){
  const g=view.game,historyOpen=$('history')?.open;
  if(g.phase==='finished'){renderEnd();return;}
  const canTeam=g.phase==='nominate'&&g.leaderId===view.me;
  const canLady=g.phase==='lady'&&g.ladyHolder===view.me;
  const canAssassin=g.phase==='assassin'&&g.myRole==='assassin';
  const canSelect=canTeam||canLady||canAssassin;
  const seats=view.players.map((p,i)=>{
    const selectable=canTeam||canLady&&!g.ladyHolders.includes(p.id)||canAssassin&&p.id!==view.me;
    const selected=selection.has(p.id);
    const tags=[
      g.leaderId===p.id?'队长':'',
      g.team.includes(p.id)?'出征':'',
      g.phase==='vote'&&g.voted.includes(p.id)?'已投票':'',
      g.phase==='quest'&&g.questSubmitted.includes(p.id)?'已交牌':'',
      g.phase==='reveal'&&g.confirmed.includes(p.id)?'已确认':'',
      !p.online?'离线':'',
    ].filter(Boolean);
    return `<div class="seat ${p.online?'':'seat-away'}">
      <button class="seat-button ${p.id===view.me?'self':''} ${selected?'selected':''}" data-seat="${p.id}" aria-label="${selectable?'选择 ':'玩家 '}${esc(p.name)}${tags.length?' · '+tags.join(' · '):''}" aria-pressed="${selected}"${disabled(!selectable||busy)}>
        <span class="seat-number">${i+1}</span><span class="seat-icon">${avatarImage(p.avatar,36)}</span>
        <span class="seat-name">${esc(p.name)}${p.id===view.me?' · 你':''}</span>
        <span class="seat-flags">${tags.join(' · ')}</span></button>
    </div>`;
  }).join('');
  const track=SIZES[view.players.length].map((size,index)=>{
    const result=g.results[index];
    return `<div class="quest-slot ${index===g.questIndex?'current':''} ${result?(result.success?'success':'fail'):''}">
      <span>第 ${index+1} 轮</span><b>${result?(result.success?'成功':'失败'):size+' 人'}</b>
      <small>${view.players.length>=7&&index===3?'两张失败牌':result?'已揭晓':'一张失败牌'}</small>
    </div>`;
  }).join('');
  const goodCount=g.results.filter(r=>r.success).length;
  const evilCount=g.results.length-goodCount;
  $('app').innerHTML=roomTop()+`<div class="game-layout">
    <section class="play-area" data-phase="${g.phase}">
      <div class="quest-track" aria-label="任务进度">${track}</div>
      <div class="phase-heading"><h2>${LABEL[g.phase]}</h2>
        <div class="rejection-track" aria-label="连续 ${g.rejections} 次未通过"><span>连拒 ${g.rejections}/5</span>${Array.from({length:5},(_,i)=>`<i class="pip ${i<g.rejections?'on':''}" aria-hidden="true"></i>`).join('')}</div>
      </div>
      ${canSelect?'':actionPanel()}
      <div class="round-table" data-count="${view.players.length}">
        <div class="table-centre"><span class="table-emblem" aria-hidden="true"></span><small>第 ${g.questIndex+1} 次远征</small><strong>${goodCount} <span aria-hidden="true">:</span> ${evilCount}</strong><small>好人 / 邪恶</small></div>
        ${seats}
      </div>
      ${canSelect?actionPanel():''}
    </section>
    <aside class="side-panel">
      <button class="role-secret" id="peek-role-sidebar"><span class="sigil" aria-hidden="true"></span><span>我的秘密身份<small>按住查看，松开遮住</small></span></button>
      ${g.privateIntel.length?'<button id="private-intel" class="full">我的查验记录</button>':''}
      <button id="guide-game" class="full">圆桌手册</button>
      ${history()}
    </aside>
  </div>`;
  if(historyOpen&&$('history'))$('history').open=true;
}

function renderEnd(){
  const g=view.game;
  const reason={
    'five-rejections':'连续五次组队未通过，邪恶阵营获胜。',
    'three-fails':'三次任务失败，邪恶阵营获胜。',
    'merlin-assassinated':`${name(g.assassinated)} 被刺中，梅林暴露了身份。`,
    'merlin-survived':`刺客指认了 ${name(g.assassinated)}，梅林成功隐藏。`
  }[g.reason]||'';
  const historyOpen=$('history')?.open;
  $('app').innerHTML=roomTop()+`
    <section class="end-hero ${g.winner}">
      <p class="eyebrow">终局 · 身份揭晓</p>
      <h2>${g.winner==='good'?'好人守住了卡美洛':'邪恶笼罩了卡美洛'}</h2><p>${esc(reason)}</p>
      ${isHost()?'<button id="rematch" class="primary">回到大厅，再来一局</button>':'<p class="muted">等待房主发起下一局。</p>'}
    </section>
    <section class="panel outcome"><h2>本局身份</h2><div class="end-roles">
      ${view.players.map(p=>{
        const roleId=g.roles[p.id],r=ROLES[roleId];
        return `<article class="end-role ${r.side}">
          <img src="${roleArt(roleId)}" alt="" loading="lazy" width="384" height="512">
          <div><strong>${r.name}</strong><small>${r.side==='good'?'好人':'邪恶'}</small></div>
          <p>${avatarImage(p.avatar,28)} ${esc(p.name)}</p>
        </article>`;
      }).join('')}
    </div></section>${history()}`;
  if(historyOpen)$('history').open=true;
}

function render(){
  const root=$('app'),active=document.activeElement;
  const restore=root.contains(active)&&active.id?active.id:null;
  const activeSeat=root.contains(active)&&active.dataset.seat;
  const cursor=restore&&active instanceof HTMLInputElement?[active.selectionStart,active.selectionEnd]:null;
  const phase=showHome||!view||view.closed?'home':view.game?.phase??'lobby';
  const screen=showHome||!view?'home':view.closed?'closed':phase==='lobby'||phase==='finished'?phase:'game';
  const changed=root.dataset.screen!==screen;
  root.dataset.screen=screen;
  setAudioScene(phase);
  if(showHome||!view)renderHome();
  else if(view.closed)root.innerHTML='<section class="panel end-panel"><h1>房间已关闭</h1><p>你可以回首页再开一桌。</p><button id="go-home" class="primary">回到首页</button></section>';
  else if(view.game)renderGame();
  else renderLobby();
  if(changed)(root.querySelector('.end-hero')??root.firstElementChild)?.classList.add('entering');
  const focus=restore?$(restore):activeSeat?root.querySelector(`[data-seat="${CSS.escape(activeSeat)}"]`):null;
  if(root.contains(focus)&&!focus.disabled){
    focus.focus({preventScroll:true});
    if(cursor?.[0]!==null&&cursor?.[0]!==undefined)focus.setSelectionRange(...cursor);
  }
}

function guide(section='rules'){
  dialog('圆桌手册',handbookMarkup({players:view?.players.length,settings:view?.settings,section}),'wide-dialog handbook-dialog');
  mountHandbook($('handbook'));
}
function peekRole(){if(!view?.game)return;const g=view.game,r=ROLES[g.myRole],confirmed=g.confirmed.includes(view.me);let hasPeeked=false,timer;
  dialog('我的秘密身份',`<div id="private-wrapper"><p class="private-reminder">按住卡牌查看，松开立即遮住；键盘可按住空格或回车。</p><button class="role-cover" id="hold-role" aria-label="按住查看我的身份"><span class="cover-mark" aria-hidden="true"></span><span class="cover-text">按住查看身份</span><img src="${roleArt(g.myRole)}" alt="我的角色立绘" width="384" height="512"></button><div id="private-role-details" class="private-role"><h3 class="role-name">${r.name} <span class="badge ${r.side}">${r.side==='good'?'好人':'邪恶'}</span></h3><p class="role-desc">${r.description}</p>${g.intel.length?`<div class="intel"><strong>你掌握的信息</strong><br>${g.intel.map(p=>`${esc(name(p.id))} · ${p.label}`).join('<br>')}</div>`:'<p class="muted">你没有额外的开局身份信息。</p>'}</div></div>${g.phase==='reveal'&&!confirmed?'<button id="confirm-role" class="primary full" disabled>我已看清身份，确认入局</button>':'<p class="private-reminder">关闭弹窗不会推进对局阶段。</p>'}`);
  const hold=$('hold-role'),wrapper=$('private-wrapper');const reveal=()=>{timer=setTimeout(()=>{wrapper.classList.add('is-peeking');playCue('reveal');hasPeeked=true;if($('confirm-role'))$('confirm-role').disabled=false;},220);};const hide=()=>{clearTimeout(timer);wrapper.classList.remove('is-peeking');};
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
  },(message,state)=>{if(transport===guest)status(message,state);});
  transport=guest;
  status('等待离线配对','terminal');
  void scanInto(async(text,current)=>{
    let answer;
    try{answer=await guest.offer(text);}
    catch(error){guest.close();throw error;}
    if(transport!==guest||!current()){guest.close();return;}
    if(previous?.closed)view=null;
    dialog('请让房主扫描回答码',`<p class="pair-step">第二步 · 房主扫描玩家回答</p><p class="muted">房主点击“扫描玩家回答码”，扫描下方二维码，连接成功后会自动进入牌桌。</p><canvas id="answer-qr" class="pair-qr" aria-label="离线玩家回答二维码"></canvas><details><summary>回答文本</summary><textarea id="answer-result" class="pair-text" readonly>${esc(answer)}</textarea></details><p class="qr-note">若断线或刷新，重新扫码会尝试恢复本浏览器的原座位。</p>`);
    await drawQR($('answer-qr'),answer);
  });
}
async function prepareOffline(){if(!('serviceWorker'in navigator)||!window.isSecureContext)throw new Error('请通过 HTTPS 或本机 localhost 打开游戏。');const registration=await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;const worker=registration.active||registration.waiting;if(!worker)throw new Error('离线组件正在准备，请稍后重试。');await new Promise((resolve,reject)=>{const channel=new MessageChannel(),timeout=setTimeout(()=>reject(new Error('下载时间较长，请保持联网后重试。')),180000);channel.port1.onmessage=e=>{if(e.data.type==='progress')toast(`离线素材准备中：${e.data.done}/${e.data.total}`);if(e.data.type==='done'){clearTimeout(timeout);resolve();}if(e.data.type==='error'){clearTimeout(timeout);reject(new Error('部分素材未下载完成，请联网后重试。'));}};worker.postMessage({type:'PREPARE_OFFLINE'},[channel.port2]);});toast('离线素材已准备好。断网后可再次打开本站或主屏幕入口。');}
function confirmAction(title,text,fn){dialog(title,`<p>${esc(text)}</p><div class="actions-row"><button id="confirm-action" class="danger">确认</button><button id="cancel-action">取消</button></div>`);$('confirm-action').onclick=()=>{closeDialog();run(fn);};$('cancel-action').onclick=closeDialog;}
function profileDialog(){
  if(view?.game&&view.game.phase!=='finished'){toast('本局资料已固定，结算后可以修改。');return;}
  dialog('我的圆桌资料',`${profileForm()}<button id="save-profile" class="primary full">保存资料</button>`);
  $('save-profile').onclick=()=>{
    try{
      const p=readProfile(),useAccount=$('nickname').dataset.useAccount;
      closeDialog();
      run(()=>useAccount&&transport===online?online.profile({useAccount:true}):command('profile',p));
    }catch(error){toast(error.message);}
  };
}
function hostMenu(){dialog('房主管理',`<p class="muted">返回大厅会中止当前对局，已经完成的历史战绩保留。关闭房间后，所有人需要重新加入新房。</p>${view.game?'<button id="reset-room" class="full">结束本局，返回大厅</button><div class="spacer"></div>':''}<button id="close-room" class="danger full">关闭整个房间</button><div class="spacer"></div>${transport.kind==='online'?'<button id="leave-host" class="full">离开房间</button>':'<p class="qr-note">离线牌桌由本机主持，房主散场请关闭整个房间。</p>'}`);$('reset-room')?.addEventListener('click',()=>confirmAction('结束当前对局？','所有玩家回到大厅，未完成对局标记中止，不计胜负。',()=>command('reset')));$('close-room').onclick=()=>confirmAction('关闭整个房间？','这会让所有玩家散场，不能继续本局。',()=>command('close'));if($('leave-host'))$('leave-host').onclick=()=>run(async()=>{await command('leave');closeDialog();showHome=true;render();});}

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

async function enterOnline(create){
  if(view&&!view.closed){toast('请先离开当前牌桌。');return;}
  if(busy||connecting)return;
  const p=readProfile();
  const useAccount=$('nickname').dataset.useAccount;
  let code=$('join-code').value.trim();
  if(!create){
    if(/^https?:/i.test(code)){try{code=new URL(code).searchParams.get('room')||'';}catch{code='';}}
    code=code.toUpperCase();
    if(!/^[A-F0-9]{10}$/.test(code)){toast('请输入完整的房间码或邀请链接。');$('join-code').focus();return;}
  }
  await run(async()=>{
    if(transport!==online){detachTransport();transport=online;}
    const generation=online.generation;
    if(!online.person){
      const resumed=await online.boot();
      if(!stillOnline(generation))return;
      savePerson(resumed.person);
      if(resumed.room){showHome=false;return;}
    }
    if(useAccount||p.name!==online.person.name||p.avatar!==online.person.avatar){
      await online.profile(useAccount?{useAccount:true}:p);
    }
    if(!stillOnline(generation))return;
    savePerson(online.person);
    const room=await (create?online.create(DEFAULT_SETTINGS):online.join(code));
    if(!stillOnline(generation)||!room)return;
    showHome=false;
    homeEdited=false;
    window.scrollTo(0,0);
  });
}

function useAccountProfile(){
  const profile=accountAccess?.profile;
  if(!profile)return;
  const container=$('modal').open?$('modal-body'):$('app');
  const field=container.querySelector('#nickname');
  field.value=profile.name;
  field.dataset.useAccount='true';
  selectAvatar(container.querySelector('.game-avatar-picker'),profile.avatar);
  if(container===$('app'))homeEdited=true;
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

$('app').addEventListener('change',e=>{
  const key=e.target.dataset.setting;
  if(!key)return;
  settingsDraft||={...view.settings};
  settingsDraft[key]=e.target.checked;
  if(Object.keys(SETTING_LABEL).every(setting=>settingsDraft[setting]===view.settings[setting]))settingsDraft=null;
  render();
});
document.addEventListener('input',e=>{
  if(e.target.id!=='nickname')return;
  delete e.target.dataset.useAccount;
  if($('app').contains(e.target))homeEdited=true;
});
$('app').addEventListener('submit',e=>{
  if(e.target.id!=='join-form')return;
  e.preventDefault();
  void enterOnline(false).catch(error=>toast(error.message));
});

$('modal').addEventListener('input',e=>{
  const input=e.target,key=input.dataset.audio;
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
      if($('app').contains(avatar))homeEdited=true;
      const field=($('modal').open?$('modal-body'):$('app')).querySelector('#nickname');
      if(field)delete field.dataset.useAccount;
      selectAvatar(picker,avatar.dataset.avatar);
      playCue('pick');
      return;
    }
    const seat=e.target.closest('[data-seat]');
    if(seat&&!seat.disabled){
      const g=view.game,id=seat.dataset.seat;
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
      case 'preview-guest': previewGuest();return;
      case 'cancel-claim': guestPreview=null;closeDialog();return;
      case 'claim-guest': claimGuest();return;
      case 'guide': case 'guide-game': guide();return;
      case 'guide-room': case 'home-handbook': guide('roles');return;
      case 'home-quests': guide('quests');return;
      case 'modal-close': case 'cancel-action': closeDialog();return;
      case 'peek-role': case 'peek-role-sidebar': case 'peek-role-mobile': peekRole();return;
      case 'invite': invite();return;
      case 'profile': profileDialog();return;
      case 'room-menu': hostMenu();return;
      case 'go-home': case 'brand-home': e.preventDefault();closeDialog();dismissScene();showHome=true;render();window.scrollTo(0,0);return;
      case 'resume-current': showHome=false;render();window.scrollTo(0,0);return;
      case 'create-online': void enterOnline(true).catch(error=>toast(error.message));return;
      case 'pair-host': run(pairHost);return;
      case 'retry-offline': run(()=>joinOffline(person));return;
      case 'prepare-offline': run(prepareOffline);return;
    }
    if(['create-offline','join-offline','restore-offline'].includes(id)){
      if(view&&!view.closed){toast('请先离开当前牌桌。');return;}
      if(id==='restore-offline'){
        run(()=>{const saved=OfflineHost.saved();if(!saved)throw new Error('原离线牌桌已过期。');hostOffline(saved.person,saved);});
      }else{
        const p={id:offlinePerson.id,...readProfile()};
        if(id==='join-offline')run(()=>joinOffline(p));
        else if(OfflineHost.saved())confirmAction('创建新的离线牌桌？','新建会替换本机保存的离线牌桌，已完成战绩会保留。',()=>hostOffline(p));
        else run(()=>hostOffline(p));
      }
      return;
    }
    if(!view||view.closed)return;
    if(id==='private-intel'){
      dialog('我的查验记录',`<div id="private-intel-dialog" class="intel">${view.game.privateIntel.map(r=>`第 ${r.quest} 轮后：${esc(name(r.playerId))} · <strong>${r.side==='good'?'好人阵营':'邪恶阵营'}</strong>`).join('<br>')}</div><p class="private-reminder">这些结果只在你的设备显示。</p>`);
      return;
    }
    const commands={
      ready:()=>command('ready',{ready:!me().ready}),start:()=>command('start'),
      'save-settings':async()=>{await command('settings',{settings:settingsDraft||view.settings});settingsDraft=null;},
      nominate:()=>command('nominate',{players:[...selection]}),
      'vote-yes':()=>command('vote',{approve:true}),'vote-no':()=>command('vote',{approve:false}),
      'quest-success':()=>command('quest',{success:true}),'quest-fail':()=>command('quest',{success:false}),
      continue:()=>command('continue'),inspect:()=>command('inspect',{playerId:[...selection][0]}),
      rematch:()=>command('reset'),
    };
    if(id==='assassinate'){
      const [target]=selection;
      confirmAction('确认最终指认？',`你将指认 ${name(target)} 为梅林。确认后立即结算。`,()=>command('assassinate',{playerId:target}));
    }else if(id==='leave-room'){
      confirmAction('离开房间？','如果对局尚未结束，请返回首页保留座位。',()=>command('leave'));
    }else if(Object.hasOwn(commands,id))run(commands[id]);
  }catch(error){toast(error.message||'操作未完成，请重试。');}
});

$('modal').addEventListener('close',()=>{if(!$('modal').open)clearDialog();});
function clearPrivate(){
  if($('private-wrapper')||$('private-intel-dialog'))closeDialog();
}
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){stopScan?.();stopScan=null;clearPrivate();dismissScene();}
});
window.addEventListener('blur',clearPrivate);
window.addEventListener('pagehide',()=>stopScan?.());
window.addEventListener('online',()=>{if(transport===online&&!online.resume()&&!view&&networkState==='degraded')void syncOnline();});

if('serviceWorker'in navigator&&window.isSecureContext)navigator.serviceWorker.register('/sw.js').catch(()=>{});
void syncOnline();
render();
