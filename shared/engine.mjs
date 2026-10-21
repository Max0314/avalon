// Pure, shared rules. The online server / offline host owns the full state.
import {PERSISTED_AVATAR_IDS} from './fribench-game-kit/avatars.mjs';
export class GameError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new GameError(code, message); };
export const SIZES = {5:[2,3,2,3,3],6:[2,3,4,3,4],7:[2,3,3,4,4],8:[3,4,4,5,5],9:[3,4,4,5,5],10:[3,4,4,5,5]};
export const EVIL = {5:2,6:2,7:3,8:3,9:3,10:4};
export const ROLES = {
  merlin:{name:'梅林',side:'good',image:'merlin.png',description:'知道除莫德雷德以外的邪恶玩家。引导好人完成任务，同时隐藏自己，避免终局被刺杀。'},
  percival:{name:'派西维尔',side:'good',image:'percival.png',description:'能看到梅林和莫甘娜这两位候选人，但不知道谁是真正的梅林。保护梅林，谨慎判断。'},
  servant:{name:'亚瑟的忠臣',side:'good',image:'loyal_servant_of_arthur.png',description:'没有额外身份信息。通过组队、表决和任务结果推理。好人只能提交任务成功。'},
  assassin:{name:'刺客',side:'evil',image:'assassin.png',description:'认识除奥伯伦以外的邪恶同伴。好人完成三次任务后，你有一次指认并刺杀梅林的机会。'},
  morgana:{name:'莫甘娜',side:'evil',image:'morgana.png',description:'在派西维尔眼中与梅林无法区分。认识除奥伯伦以外的邪恶同伴。'},
  mordred:{name:'莫德雷德',side:'evil',image:'mordred.png',description:'不会被梅林看到。认识除奥伯伦以外的邪恶同伴。'},
  oberon:{name:'奥伯伦',side:'evil',image:'oberon.png',description:'不认识邪恶同伴，邪恶同伴也不认识你；梅林仍然能看到你属于邪恶阵营。'},
  minion:{name:'莫德雷德的爪牙',side:'evil',image:'minion_of_mordred.png',description:'认识除奥伯伦以外的邪恶同伴。可提交任务成功或失败，配合阵营完成目标。'},
};
export const DEFAULT_SETTINGS = {percival:true,morgana:true,mordred:false,oberon:false,lady:false};
export const AVATARS = PERSISTED_AVATAR_IDS;
export function randomInt(n) {
  const max = Math.floor(0x100000000 / n) * n;
  const value = new Uint32Array(1);
  do { crypto.getRandomValues(value); } while (value[0] >= max);
  return value[0] % n;
}
export function shuffle(input, rng = randomInt) {
  const a = [...input];
  for (let i=a.length-1;i>0;i--) { const j=rng(i+1); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
export function nickname(input) {
  if (typeof input !== 'string') fail('BAD_NAME','请填写昵称。');
  const name = input.trim().normalize('NFKC');
  if (!name || /[\p{Cc}\p{Cf}<>]/u.test(name)) fail('BAD_NAME','昵称不能包含控制字符或尖括号。');
  if ([...name].length>30) fail('BAD_NAME','昵称最多 30 个字符。');
  return name;
}
export function settings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('BAD_SETTINGS','房间设置格式不正确。');
  for (const [k,v] of Object.entries(input)) if (!Object.hasOwn(DEFAULT_SETTINGS,k) || typeof v!=='boolean') fail('BAD_SETTINGS','存在不支持的房间设置。');
  return {...DEFAULT_SETTINGS,...input};
}
export function roleSet(n, options, rng = randomInt) {
  if (!SIZES[n]) fail('PLAYER_COUNT','阿瓦隆需要 5～10 位玩家。');
  const opts=settings(options);
  const good=['merlin',...(opts.percival?['percival']:[])];
  const evil=['assassin',...['morgana','mordred','oberon'].filter(r=>opts[r])];
  if (evil.length>EVIL[n]) fail('TOO_MANY_EVIL_ROLES',`${n} 人局只有 ${EVIL[n]} 个邪恶席位，请关闭部分特殊角色。`);
  while (good.length<n-EVIL[n]) good.push('servant');
  while (evil.length<EVIL[n]) evil.push('minion');
  return shuffle([...good,...evil],rng);
}
export function createRoom(owner, options = {}, context = {}) {
  return {id:context.id||crypto.randomUUID(),code:context.code||'',version:0,createdAt:context.now||Date.now(),updatedAt:context.now||Date.now(),
    hostId:owner.id,players:[{id:owner.id,name:nickname(owner.name),avatar:AVATARS.includes(owner.avatar)?owner.avatar:AVATARS[0],ready:false}],
    settings:settings(options),game:null,closed:false};
}
function member(room,id) {
  const p=room.players.find(p=>p.id===id);
  if (!p || room.closed) fail('NOT_MEMBER','你已不在这个房间，请重新加入。');
  return p;
}
function host(room,id) { if (room.hostId!==id) fail('HOST_ONLY','只有房主可以进行此操作。'); }
function phase(game,wanted) { if (!game || game.phase!==wanted) fail('WRONG_PHASE','当前阶段已变化，请查看最新牌桌。'); }
function finish(g,side,reason) { g.phase='finished';g.winner=side;g.reason=reason; }
function leader(g,room,id) { if (room.players[g.leader]?.id!==id) fail('LEADER_ONLY','请等待本轮队长操作。'); }
function nextQuest(room) {
  const g=room.game;
  g.questIndex++;g.leader=(g.leader+1)%room.players.length;g.rejections=0;g.team=[];g.votes={};g.questCards={};
  g.phase=room.settings.lady&&[2,3,4].includes(g.results.length)?'lady':'nominate';
}
const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
function payloadKeys(payload,keys) {
  if (!payload || typeof payload!=='object' || Array.isArray(payload) || Object.keys(payload).some(k=>!keys.includes(k))) fail('BAD_COMMAND','操作参数不正确。');
}
export function applyCommand(original, actorId, type, payload = {}, context = {}) {
  const room=structuredClone(original), actor=member(room,actorId), g=room.game;
  const permitted={ready:['ready'],settings:['settings'],start:[],confirmRole:[],nominate:['players'],vote:['approve'],quest:['success'],continue:[],inspect:['playerId'],assassinate:['playerId'],reset:[],leave:[],kick:['playerId'],transfer:['playerId'],profile:['name','avatar'],close:[]};
  if (!Object.hasOwn(permitted,type)) fail('BAD_COMMAND','不支持这个操作。');
  payloadKeys(payload,permitted[type]);
  switch(type) {
    case 'profile':
      if(g&&g.phase!=='finished')fail('GAME_RUNNING','本局昵称和头像已固定，请在大厅或结算后修改。');
      actor.name=nickname(payload.name);
      if (!AVATARS.includes(payload.avatar)) fail('BAD_AVATAR','请选择提供的头像。');
      actor.avatar=payload.avatar;break;
    case 'ready':
      if (g) fail('WRONG_PHASE','请在大厅准备。');
      if (typeof payload.ready!=='boolean') fail('BAD_COMMAND','准备状态不正确。');
      actor.ready=payload.ready;break;
    case 'settings':
      host(room,actorId);if(g) fail('WRONG_PHASE','对局开始后不能修改角色配置。');
      room.settings=settings(payload.settings);room.players.forEach(p=>p.ready=false);break;
    case 'start': {
      host(room,actorId);if(g) fail('WRONG_PHASE','当前对局已开始。');
      if (!room.players.every(p=>p.ready)) fail('NOT_READY','请等待所有玩家准备。');
      if (context.online && !room.players.every(p=>context.online.has(p.id))) fail('PLAYER_OFFLINE','有玩家离线，请等待重连。');
      const roles=roleSet(room.players.length,room.settings,context.random||randomInt), first=(context.random||randomInt)(room.players.length);
      room.game={id:crypto.randomUUID(),phase:'reveal',roles:Object.fromEntries(room.players.map((p,i)=>[p.id,roles[i]])),confirmed:[],leader:first,questIndex:0,rejections:0,team:[],votes:{},questCards:{},results:[],proposals:[],ladyHolder:room.players[(first+room.players.length-1)%room.players.length].id,ladyHolders:[],ladyHistory:[],privateIntel:{},winner:null,reason:null};
      room.game.ladyHolders=[room.game.ladyHolder];break;
    }
    case 'confirmRole':
      phase(g,'reveal');if(g.confirmed.includes(actorId)) fail('ALREADY_SUBMITTED','你已确认身份，请等待其他玩家。');
      g.confirmed.push(actorId);if(g.confirmed.length===room.players.length)g.phase='nominate';break;
    case 'nominate': {
      phase(g,'nominate');leader(g,room,actorId);
      const ids=payload.players;
      if (!Array.isArray(ids) || ids.length!==SIZES[room.players.length][g.questIndex] || new Set(ids).size!==ids.length || ids.some(id=>!room.players.some(p=>p.id===id))) fail('BAD_TEAM','请选择正确人数的出征队伍。');
      g.team=[...ids];g.votes={};g.phase='vote';break;
    }
    case 'vote':
      phase(g,'vote');if(typeof payload.approve!=='boolean')fail('BAD_COMMAND','请选择赞成或反对。');
      if(own(g.votes,actorId))fail('ALREADY_SUBMITTED','表决已经提交，不能修改。');
      g.votes[actorId]=payload.approve;
      if(Object.keys(g.votes).length===room.players.length) {
        const approved=Object.values(g.votes).filter(Boolean).length>room.players.length/2;
        g.proposals.push({quest:g.questIndex+1,leaderId:room.players[g.leader].id,team:[...g.team],votes:{...g.votes},approved});
        if(approved){g.phase='quest';g.questCards={};}
        else {g.rejections++;if(g.rejections>=5)finish(g,'evil','five-rejections');else{g.leader=(g.leader+1)%room.players.length;g.team=[];g.phase='nominate';}}
      }break;
    case 'quest':
      phase(g,'quest');if(!g.team.includes(actorId))fail('TEAM_ONLY','只有出征队员可以提交任务牌。');
      if(typeof payload.success!=='boolean')fail('BAD_COMMAND','请选择任务成功或失败。');
      if(own(g.questCards,actorId))fail('ALREADY_SUBMITTED','任务牌已经提交，不能修改。');
      if(!payload.success && ROLES[g.roles[actorId]].side==='good')fail('GOOD_CANNOT_FAIL','好人只能提交任务成功。');
      g.questCards[actorId]=payload.success;
      if(Object.keys(g.questCards).length===g.team.length) {
        const fails=Object.values(g.questCards).filter(v=>!v).length, threshold=room.players.length>=7&&g.questIndex===3?2:1;
        g.results.push({quest:g.questIndex+1,team:[...g.team],fails,successes:g.team.length-fails,threshold,success:fails<threshold});
        g.questCards={};g.phase='questResult';
      }break;
    case 'continue':
      phase(g,'questResult');host(room,actorId);
      if(g.results.filter(r=>!r.success).length>=3)finish(g,'evil','three-fails');
      else if(g.results.filter(r=>r.success).length>=3){g.phase='assassin';g.team=[];g.votes={};}
      else nextQuest(room);break;
    case 'inspect': {
      phase(g,'lady');if(g.ladyHolder!==actorId)fail('LADY_ONLY','请等待湖中仙女持有者查验。');
      const target=member(room,payload.playerId);
      if(g.ladyHolders.includes(target.id))fail('BAD_LADY_TARGET','不能查验自己或曾持有湖中仙女的玩家。');
      const info={quest:g.results.length,playerId:target.id,side:ROLES[g.roles[target.id]].side};
      (g.privateIntel[actorId]||=[]).push(info);
      g.ladyHistory.push({quest:g.results.length,from:actorId,to:target.id});g.ladyHolder=target.id;g.ladyHolders.push(target.id);g.phase='nominate';break;
    }
    case 'assassinate':
      phase(g,'assassin');if(g.roles[actorId]!=='assassin')fail('ASSASSIN_ONLY','请等待刺客作出选择。');
      member(room,payload.playerId);
      if(payload.playerId===actorId)fail('BAD_TARGET','请选择另一位玩家。');
      g.assassinated=payload.playerId;finish(g,g.roles[payload.playerId]==='merlin'?'evil':'good',g.roles[payload.playerId]==='merlin'?'merlin-assassinated':'merlin-survived');break;
    case 'reset':
      host(room,actorId);room.game=null;room.players.forEach(p=>p.ready=false);break;
    case 'kick':
      host(room,actorId);if(g)fail('WRONG_PHASE','只有大厅可以移出玩家。');
      if(payload.playerId===actorId)fail('BAD_TARGET','请使用离开房间。');member(room,payload.playerId);
      room.players=room.players.filter(p=>p.id!==payload.playerId);break;
    case 'transfer':
      host(room,actorId);member(room,payload.playerId);room.hostId=payload.playerId;break;
    case 'leave':
      if(g&&g.phase!=='finished')fail('GAME_RUNNING','对局中请先返回首页保留座位，或由房主结束本局。');
      if(g){room.game=null;room.players.forEach(p=>p.ready=false);}
      room.players=room.players.filter(p=>p.id!==actorId);
      if(room.hostId===actorId)room.hostId=room.players[0]?.id||null;
      if(!room.players.length)room.closed=true;break;
    case 'close':host(room,actorId);room.closed=true;room.game=null;break;
  }
  room.version++;room.updatedAt=context.now||Date.now();return room;
}
export function joinRoom(original,person,context={}) {
  if(original.closed)fail('ROOM_CLOSED','房间已经关闭，请创建新房间。');
  const existing=original.players.find(p=>p.id===person.id);
  if(existing)return structuredClone(original);
  if(original.game)fail('GAME_RUNNING','对局已经开始，暂时不能加入。');
  if(original.players.length>=10)fail('ROOM_FULL','房间已经坐满 10 人。');
  const room=structuredClone(original);
  room.players.push({id:person.id,name:nickname(person.name),avatar:AVATARS.includes(person.avatar)?person.avatar:AVATARS[0],ready:false});
  room.players.forEach(p=>p.ready=false);room.version++;room.updatedAt=context.now||Date.now();return room;
}
export function playerView(room,actorId,online=new Set()) {
  if(!room.players.some(p=>p.id===actorId))fail('NOT_MEMBER','你已不在这个房间，请重新加入。');
  const view={id:room.id,code:room.code,version:room.version,hostId:room.hostId,closed:room.closed,settings:{...room.settings},players:room.players.map(p=>({...p,online:online.has(p.id)})),me:actorId,game:null};
  const g=room.game;if(!g)return view;
  const role=g.roles[actorId], finished=g.phase==='finished';
  let intel=[];
  if(role==='merlin')intel=room.players.filter(p=>ROLES[g.roles[p.id]].side==='evil'&&g.roles[p.id]!=='mordred').map(p=>({id:p.id,label:'邪恶阵营'}));
  else if(role==='percival')intel=room.players.filter(p=>['merlin','morgana'].includes(g.roles[p.id])).map(p=>({id:p.id,label:'梅林候选'}));
  else if(ROLES[role].side==='evil'&&role!=='oberon')intel=room.players.filter(p=>p.id!==actorId&&ROLES[g.roles[p.id]].side==='evil'&&g.roles[p.id]!=='oberon').map(p=>({id:p.id,label:'邪恶同伴'}));
  view.game={id:g.id,phase:g.phase,questIndex:g.questIndex,leaderId:room.players[g.leader].id,team:[...g.team],needed:SIZES[room.players.length][g.questIndex]||0,
    threshold:room.players.length>=7&&g.questIndex===3?2:1,rejections:g.rejections,confirmed:[...g.confirmed],results:structuredClone(g.results),proposals:structuredClone(g.proposals),
    voted:Object.keys(g.votes),questSubmitted:Object.keys(g.questCards),myVote:g.votes[actorId]??null,myQuest:g.questCards[actorId]??null,
    myRole:role,intel,privateIntel:structuredClone(g.privateIntel[actorId]||[]),ladyHolder:g.ladyHolder,ladyHolders:[...g.ladyHolders],ladyHistory:structuredClone(g.ladyHistory),winner:g.winner,reason:g.reason};
  if(g.phase==='assassin')view.game.assassinId=room.players.find(p=>g.roles[p.id]==='assassin').id;
  if(finished){view.game.roles={...g.roles};view.game.assassinated=g.assassinated||null;}
  return view;
}
