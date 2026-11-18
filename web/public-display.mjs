import {ROLES,SIZES} from '../shared/engine.mjs';
import {avatarPath} from '../shared/fribench-game-kit/avatars.mjs';

const LABEL = {reveal:'确认身份',nominate:'队长组队',vote:'队伍表决',quest:'执行任务',
  questResult:'任务揭晓',lady:'湖中仙女',assassin:'最后指认',finished:'终局揭晓'};
const escape = value => String(value??'').replace(/[&<>"']/g,key=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[key]));
let relay, sharedView, sharedRoomId;

export function projectDisplay(view) {
  if(!view||view.closed)return null;
  const game=view.game;
  return {
    code:view.code,
    players:view.players.map((p,index)=>({
      id:p.id, number:index+1, name:p.name, avatar:p.avatar, ready:p.ready, online:p.online,bot:p.bot===true,
      leading:game?.leaderId===p.id, onTeam:game?.team.includes(p.id)??false,
      voted:game?.voted.includes(p.id)??false,
      publicRole:game?.phase==='finished'?game.roles[p.id]:null
    })),
    phase:game?.phase??'lobby',
    questIndex:game?.questIndex??0,
    sizes:SIZES[view.players.length]??[],
    results:game?.results.map(({quest,success})=>({quest,success}))??[],
    rejections:game?.rejections??0,
    winner:game?.phase==='finished'?game.winner:null,
    lastProposal:game?.proposals.at(-1)?.approved??null,
    cinematic:{
      id:view.id, version:view.version,
      players:view.players.map(({id,name})=>({id,name})),
      game:game?{
        id:game.id, phase:game.phase, needed:game.needed, leaderId:game.leaderId,ladyHolder:game.ladyHolder,
        proposals:game.proposals.map(({approved,votes})=>({approved,votes:Object.values(votes)})),
        results:game.results.map(({quest,success,successes,fails})=>({quest,success,successes,fails})),
        ...(game.phase==='finished'?{winner:game.winner,reason:game.reason,assassinated:game.assassinated}:{})
      }:null,
    },
  };
}

export function publishDisplay(view){
  if(!relay)return;
  if(view?.id!==sharedRoomId||view.closed){
    relay.postMessage(null);
    relay.close();
    sharedRoomId=sharedView=relay=null;
    return;
  }
  sharedView=projectDisplay(view);
  relay.postMessage(sharedView);
}

export function openPublicDisplay(view){
  if(!view||view.closed)return;
  if(!globalThis.BroadcastChannel)throw new Error('当前浏览器不支持打开同设备大屏。');
  relay?.postMessage(null);
  relay?.close();
  const id=crypto.randomUUID();
  relay=new BroadcastChannel('avalon-display-'+id);
  sharedRoomId=view.id;
  sharedView=projectDisplay(view);
  relay.addEventListener('message',event=>{if(event.data==='ready')relay.postMessage(sharedView);});
  window.open('/?display='+id,'_blank','noopener');
}

export function mountPublicDisplay(root,id,{sound,settings,animate}){
  document.body.dataset.view='display';
  const channel=new BroadcastChannel('avalon-display-'+id);
  let previous=null;
  const render=view=>{
    sound(view?.phase??'home',view?.winner);
    animate(previous?.cinematic,view?.cinematic);
    previous=view;
    if(!view){
      root.innerHTML='<section class="screen-display waiting"><h1>圆桌大屏</h1><p>在同一浏览器的牌桌内打开大屏。</p></section>';
      return;
    }
    const good=view.results.filter(item=>item.success).length, evil=view.results.length-good;
    root.innerHTML=`<section class="screen-display" data-display-phase="${view.phase}">
      <div class="screen-table">
        <p class="room-code">${escape(view.code)}</p>
        <h1>${LABEL[view.phase]??'等候入座'}</h1>
        <div class="screen-roster">${view.players.map(p=>`<div class="screen-seat ${p.onTeam?'on-team':''}">
          <span class="screen-seat-number">${p.number}</span><img src="${avatarPath(p.avatar)}" alt="" width="88" height="88">
          <strong>${escape(p.name)}</strong><small>${p.publicRole?ROLES[p.publicRole]?.name??'':[
            p.leading?'队长':'',p.onTeam?'出征':'',view.phase==='vote'&&p.voted?'已投票':'',p.bot?'人机':'',!p.online?'离线':''
          ].filter(Boolean).join(' · ')}</small>
        </div>`).join('')}</div>
      </div>
      <aside class="screen-score" aria-label="任务与结果">
        <button id="display-sound" aria-label="声音设置">♫</button>
        <h2>${view.winner==='good'?'好人获胜':view.winner==='evil'?'邪恶获胜':'远征进度'}</h2>
        <strong class="screen-points">${good} : ${evil}</strong>
        <div class="screen-quests">${view.sizes.map((size,i)=>`<div data-current="${i===view.questIndex}"><span>第 ${i+1} 轮</span><b>${view.results[i]?(view.results[i].success?'成功':'失败'):`${size} 人`}</b></div>`).join('')}</div>
        ${view.sizes.length?`<p>连续未通过 ${view.rejections} / 5</p>`:''}
      </aside>
    </section>`;
    root.querySelector('#display-sound').onclick=settings;
  };
  render(null);
  channel.addEventListener('message',event=>{if(event.data!=='ready')render(event.data);});
  channel.postMessage('ready');
  window.addEventListener('pagehide',()=>channel.close(),{once:true});
}
