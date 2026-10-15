import {applyCommand,createRoom,joinRoom,playerView,GameError} from '../shared/engine.mjs';
import {encodePair,decodePair} from './qr.mjs';

export function actionKey(v) {const g=v?.game;return g?`${g.id}:${g.phase}:${g.questIndex}:${g.leaderId}:${g.proposals.length}`:`${v?.id}:lobby`;}
export class Online {
  constructor(onView,onStatus){this.onView=onView;this.onStatus=onStatus;this.kind='online';this.view=null;this.events=null;}
  async request(path,data) {
    let response;
    try{response=await fetch(path,{method:data===undefined?'GET':'POST',headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),credentials:'same-origin',signal:AbortSignal.timeout(12000)});}catch{throw new GameError('NETWORK','连接中断，请等待重连后重试。');}
    let result;try{result=await response.json();}catch{throw new GameError('NETWORK','服务暂时没有响应，请稍后重试。');}
    if(!response.ok){const error=new GameError(result.code||'NETWORK',result.message||'操作失败，请重试。');error.view=result.view;throw error;}return result;
  }
  accept(v){if(!v)return;if(this.view?.id===v.id&&v.version<this.view.version)return;this.view=v;this.onView(v);}
  async boot(){let r;for(let attempt=0;attempt<3;attempt++){try{r=await this.request('/api/session');break;}catch(e){if(attempt===2||e.code!=='NETWORK')throw e;await new Promise(resolve=>setTimeout(resolve,800));}}this.person=r.person;if(r.room){this.accept(r.room);this.connect(r.room.code);}return r;}
  async profile(person){const r=await this.request('/api/profile',person);this.person=r.person;return r.person;}
  async create(settings){let r;try{r=await this.request('/api/rooms',{settings});}catch(e){const b=await this.request('/api/session').catch(()=>null);if(b?.room){this.accept(b.room);this.connect(b.room.code);return b.room;}throw e;}this.accept(r.view);this.connect(r.view.code);return r.view;}
  async join(code){const r=await this.request(`/api/rooms/${code}/join`,{});this.accept(r.view);this.connect(code);return r.view;}
  connect(code){this.events?.close();this.code=code;this.onStatus('连接中');const events=new EventSource(`/api/rooms/${code}/events`);this.events=events;
    events.onopen=()=>this.onStatus('在线');events.onerror=()=>this.onStatus('正在重连');
    events.addEventListener('snapshot',e=>this.accept(JSON.parse(e.data)));
    for(const event of ['removed','expired'])events.addEventListener(event,()=>{events.close();this.view=null;this.onView(null);this.onStatus(event==='expired'?'房间已过期':'你已离开房间');});
  }
  async command(type,payload={}) {
    const key=actionKey(this.view),code=this.view.code;let command={id:crypto.randomUUID(),version:this.view.version,type,payload};
    for(let i=0;i<5;i++) {
      try{const r=await this.request(`/api/rooms/${code}/commands`,command);if(r.view)this.accept(r.view);if(r.left){this.close();this.view=null;this.onView(null);}return r.view;}
      catch(e){if(e.view)this.accept(e.view);if(e.code==='STALE_VERSION'&&actionKey(this.view)===key){command={...command,version:this.view.version};continue;}if(e.code==='NETWORK'&&i<1)continue;throw e;}
    }
    throw new GameError('STALE_VERSION','大家正在同时操作，请稍后再试。');
  }
  close(){this.events?.close();this.events=null;}
}

const HOST_KEY='fribench.avalon.offline.host.v1',SEATS_KEY='fribench.avalon.offline.seats.v1';
const rtc=()=>new RTCPeerConnection({iceServers:[]});
async function gather(pc){if(pc.iceGatheringState==='complete')return;await new Promise(resolve=>{const done=()=>{if(pc.iceGatheringState==='complete'){clearTimeout(timeout);pc.removeEventListener('icegatheringstatechange',done);resolve();}};const timeout=setTimeout(()=>{pc.removeEventListener('icegatheringstatechange',done);resolve();},7000);pc.addEventListener('icegatheringstatechange',done);});}
function send(dc,value){if(dc.readyState!=='open')throw new GameError('NETWORK','离线连接已断开，请重新扫码连接。');if(dc.bufferedAmount>262144)throw new GameError('NETWORK','连接繁忙，请稍后重试。');dc.send(JSON.stringify(value));}
function readJSON(text){if(typeof text!=='string'||text.length>80000)throw new Error('连接数据过大。');return JSON.parse(text);}

export class OfflineHost {
  constructor(person,onView,onStatus,saved=null) {
    this.kind='offline-host';this.onView=onView;this.onStatus=onStatus;this.peers=new Map();this.pairs=new Map();this.receipts=new Map(saved?.receipts||[]);
    this.person=saved?.person||person;this.proofs=saved?.proofs||{};
    this.room=saved?.room||createRoom(this.person,{}, {code:crypto.randomUUID().replaceAll('-','').slice(0,10).toUpperCase()});
    this.persist(this.room);this.publish();this.onStatus('离线主持中');
  }
  static saved(){try{const data=JSON.parse(localStorage.getItem(HOST_KEY));return data?.room&&!data.room.closed&&Date.now()-data.room.updatedAt<6*3600000?data:null;}catch{return null;}}
  static clear(){localStorage.removeItem(HOST_KEY);}
  online(){return new Set([this.person.id,...[...this.peers].filter(([,p])=>p.dc.readyState==='open').map(([id])=>id)]);}
  persist(candidate){localStorage.setItem(HOST_KEY,JSON.stringify({person:this.person,room:candidate,proofs:this.proofs,receipts:[...this.receipts].slice(-300)}));}
  accept(v){this.view=v;this.onView(v);}
  publish(){this.accept(playerView(this.room,this.person.id,this.online()));for(const [id,peer]of this.peers){if(peer.dc.readyState!=='open')continue;try{if(!this.room.players.some(p=>p.id===id)){send(peer.dc,{kind:'removed'});peer.pc.close();this.peers.delete(id);}else send(peer.dc,{kind:'snapshot',view:playerView(this.room,id,this.online())});}catch{peer.pc.close();}}}
  run(actor,command) {
    const receiptKey=`${actor}:${command.id}`, fingerprint=JSON.stringify([command.version,command.type,command.payload]),receipt=this.receipts.get(receiptKey);
    if(receipt){if(receipt!==fingerprint)throw new GameError('COMMAND_REUSED','操作标识重复，请重新同步。');return;}
    if(command.version!==this.room.version)throw new GameError('STALE_VERSION','牌桌已更新，请重试。');
    const next=applyCommand(this.room,actor,command.type,command.payload,{online:this.online()});
    this.receipts.set(receiptKey,fingerprint);try{this.persist(next);}catch(e){this.receipts.delete(receiptKey);throw new GameError('STORAGE','浏览器无法保存本局，请检查可用存储空间。');}
    this.room=next;this.publish();
  }
  async command(type,payload={}){if(type==='leave')throw new Error('离线牌桌由本机主持，请使用“关闭整个房间”散场。');this.run(this.person.id,{id:crypto.randomUUID(),version:this.room.version,type,payload});return this.view;}
  async offer(){
    for(const [id,p]of this.pairs)if(p.expires<Date.now()){p.pc.close();this.pairs.delete(id);}
    if(this.pairs.size>=3)throw new GameError('PAIR_LIMIT','请先完成或关闭正在进行的配对。');
    const pairId=crypto.randomUUID(),pc=rtc(),dc=pc.createDataChannel('fribench-avalon'),expires=Date.now()+5*60000;
    this.pairs.set(pairId,{pc,dc,expires});this.bind(pc,dc,pairId);
    await pc.setLocalDescription(await pc.createOffer());await gather(pc);
    return {pairId,text:await encodePair({kind:'offer',pairId,roomId:this.room.id,expires,sdp:pc.localDescription.sdp})};
  }
  cancelPair(id){const p=this.pairs.get(id);if(p){p.pc.close();this.pairs.delete(id);}}
  async answer(text){const data=await decodePair(text,'answer'),pair=this.pairs.get(data.pairId);if(!pair||data.roomId!==this.room.id)throw new Error('回答码与当前邀请不匹配，请重新生成。');await pair.pc.setRemoteDescription({type:'answer',sdp:data.sdp});}
  bind(pc,dc,pairId){
    let actor=null;
    dc.onmessage=e=>{
      let msg;
      try {
        msg=readJSON(e.data);
        if(msg.kind==='hello') {
          if(actor)throw new Error('连接已建立。');
          const existing=Object.entries(this.proofs).find(([,proof])=>proof===msg.proof);
          actor=existing?.[0]||crypto.randomUUID();
          const person={id:actor,name:msg.name,avatar:msg.avatar};
          const candidate=joinRoom(this.room,person);
          const old=this.peers.get(actor);if(old){try{send(old.dc,{kind:'removed'});}catch{}old.pc.close();}
          this.proofs[actor]||=crypto.randomUUID()+crypto.randomUUID();
          this.persist(candidate);this.room=candidate;this.peers.set(actor,{pc,dc});this.pairs.delete(pairId);
          send(dc,{kind:'welcome',roomId:this.room.id,person:this.room.players.find(p=>p.id===actor),proof:this.proofs[actor]});this.publish();return;
        }
        if(!actor||this.peers.get(actor)?.dc!==dc)throw new Error('请先建立连接。');
        if(msg.kind==='command'){
          const c=msg.command;
          if(!c||typeof c.id!=='string'||c.id.length>80||!Number.isSafeInteger(c.version)||typeof c.type!=='string')throw new Error('操作格式不正确。');
          this.run(actor,c);send(dc,{kind:'ack',id:c.id,view:this.room.players.some(p=>p.id===actor)?playerView(this.room,actor,this.online()):null});
        }
      }catch(error){try{send(dc,{kind:'error',id:msg?.command?.id,code:error.code||'PAIR_ERROR',message:error instanceof GameError?error.message:'连接或加入失败，请检查房间是否已开始。',view:actor&&this.room.players.some(p=>p.id===actor)?playerView(this.room,actor,this.online()):null});}catch{}}
    };
    dc.onclose=()=>{if(actor&&this.peers.get(actor)?.dc===dc){this.peers.delete(actor);this.publish();}};
    pc.onconnectionstatechange=()=>{if(['failed','closed'].includes(pc.connectionState))dc.close();};
  }
  close(){for(const p of this.peers.values())p.pc.close();for(const p of this.pairs.values())p.pc.close();this.peers.clear();this.pairs.clear();}
}

export class OfflineGuest {
  constructor(person,onView,onStatus){this.kind='offline-guest';this.person=person;this.onView=onView;this.onStatus=onStatus;this.pending=new Map();this.view=null;}
  accept(v){if(!v)return;if(this.view?.id===v.id&&v.version<this.view.version)return;this.view=v;this.onView(v);}
  async offer(text){
    const data=await decodePair(text,'offer');this.roomId=data.roomId;this.pc=rtc();
    this.pc.ondatachannel=e=>this.bind(e.channel);
    this.pc.onconnectionstatechange=()=>{if(['failed','disconnected','closed'].includes(this.pc.connectionState))this.onStatus('连接断开，请重新扫码');};
    await this.pc.setRemoteDescription({type:'offer',sdp:data.sdp});await this.pc.setLocalDescription(await this.pc.createAnswer());await gather(this.pc);
    return encodePair({kind:'answer',pairId:data.pairId,roomId:data.roomId,expires:data.expires,sdp:this.pc.localDescription.sdp});
  }
  bind(dc){this.dc=dc;dc.onopen=()=>{this.onStatus('正在加入离线房间');let proof;try{proof=JSON.parse(localStorage.getItem(SEATS_KEY)||'{}')[this.roomId];}catch{}send(dc,{kind:'hello',name:this.person.name,avatar:this.person.avatar,proof});};
    dc.onmessage=e=>{try{const msg=readJSON(e.data);
      if(msg.kind==='welcome'){this.person=msg.person;const seats=JSON.parse(localStorage.getItem(SEATS_KEY)||'{}');seats[msg.roomId]=msg.proof;localStorage.setItem(SEATS_KEY,JSON.stringify(seats));this.onStatus('已连接离线房间');}
      if(msg.kind==='snapshot')this.accept(msg.view);
      if(msg.kind==='removed'){for(const [id,task]of this.pending)if(task.type==='leave'){clearTimeout(task.timer);this.pending.delete(id);task.resolve(null);}this.onView(null);this.close();return;}
      if(msg.kind==='ack'||msg.kind==='error'){if(msg.view)this.accept(msg.view);const task=this.pending.get(msg.id);if(task){clearTimeout(task.timer);this.pending.delete(msg.id);msg.kind==='ack'?task.resolve(msg.view):task.reject(Object.assign(new Error(msg.message),{code:msg.code}));}else if(msg.kind==='error')this.onStatus(msg.message);}
    }catch{this.onStatus('连接数据无法读取，请重新扫码。');}};
    dc.onclose=()=>this.onStatus('离线连接已断开，请重新扫码');
  }
  async command(type,payload={}){
    const key=actionKey(this.view);const command={id:crypto.randomUUID(),version:this.view.version,type,payload};
    for(let i=0;i<5;i++){try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(command.id);reject(Object.assign(new Error('房主暂时没有回应，请重连后重试。'),{code:'NETWORK'}));},10000);this.pending.set(command.id,{resolve,reject,timer,type});try{send(this.dc,{kind:'command',command});}catch(e){clearTimeout(timer);this.pending.delete(command.id);reject(e);}});}catch(e){if(e.code==='STALE_VERSION'&&actionKey(this.view)===key){command.version=this.view.version;continue;}throw e;}}
    throw new Error('牌桌正在更新，请稍后重试。');
  }
  close(){this.pc?.close();for(const task of this.pending.values()){clearTimeout(task.timer);task.reject(new Error('连接已经关闭。'));}this.pending.clear();}
}
