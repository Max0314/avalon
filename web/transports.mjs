import {applyCommand,createRoom,joinRoom,playerView,GameError} from '../shared/engine.mjs';
import {encodePair,decodePair} from './qr.mjs';

export function actionKey(v) {const g=v?.game;return g?`${g.id}:${g.phase}:${g.questIndex}:${g.leaderId}:${g.proposals.length}`:`${v?.id}:lobby`;}

const RECONNECT_MIN=600,RECONNECT_MAX=12000,CONNECT_TIMEOUT=12000,HEARTBEAT_TIMEOUT=35000;
const uncertainReply=error=>['NETWORK','INTERNAL_ERROR','PERSISTENCE_UNAVAILABLE'].includes(error.code);
const lostSeat=error=>['SEAT_CHANGED','UNAUTHENTICATED'].includes(error.code);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export class Online {
  constructor(onView,onStatus,{onIdentityChange,onCommandError}={}) {
    this.onView=onView;
    this.onStatus=onStatus;
    this.onIdentityChange=onIdentityChange;
    this.onCommandError=onCommandError;
    this.kind='online';
    this.view=null;
    this.generation=0;
    this.requests=new AbortController();
    this.connectionState='idle';
  }

  setStatus(text,state) {
    if(this.connectionState===state&&this.connectionText===text)return;
    this.connectionState=state;
    this.connectionText=text;
    this.onStatus(text,state);
  }

  assertGeneration(generation) {
    if(generation!==this.generation)throw new GameError('ACCOUNT_CHANGED','在线身份已变化，旧请求结果已丢弃。');
  }

  async request(path,data,{signal,timeout=12000}={}) {
    const generation=this.generation;
    const headers=data===undefined?{}:{'Content-Type':'application/json'};
    if(path!=='/api/session'&&this.person?.id)headers['X-Avalon-Seat']=this.person.id;
    const lifecycle=this.requests.signal,controller=new AbortController(),cancel=()=>controller.abort();
    const deadline=setTimeout(cancel,timeout);
    lifecycle.addEventListener('abort',cancel);
    signal?.addEventListener('abort',cancel);
    if(signal?.aborted)cancel();
    let response,result;
    try{
      response=await fetch(path,{method:data===undefined?'GET':'POST',headers,body:data===undefined?undefined:JSON.stringify(data),cache:'no-store',credentials:'same-origin',signal:controller.signal});
      result=await response.json();
    }catch{
      this.assertGeneration(generation);
      throw new GameError('NETWORK','连接中断，正在确认线上状态。');
    }finally{
      clearTimeout(deadline);
      lifecycle.removeEventListener('abort',cancel);
      signal?.removeEventListener('abort',cancel);
    }
    this.assertGeneration(generation);
    if(!response.ok){
      const error=new GameError(result?.code||'NETWORK',result?.message||'操作失败，请重试。');
      error.view=result?.view;
      if(error.code==='SEAT_CHANGED')this.identityChanged();
      throw error;
    }
    return result;
  }

  identityChanged() {
    this.close({clearIdentity:true});
    this.onView(null);
    this.setStatus('在线身份已变化','terminal');
    this.onIdentityChange?.();
  }

  accept(view) {
    if(!view)return;
    if(this.person?.id&&view.me!==this.person.id){
      this.identityChanged();
      throw new GameError('SEAT_CHANGED','在线身份已变化，请重新同步座位。');
    }
    if(this.view?.id===view.id){
      if(view.version<this.view.version)return;
      if(view.version===this.view.version&&view.players.every((p,i)=>p.online===this.view.players[i]?.online))return;
    }
    this.view=view;
    this.onView(view);
    if(view.closed){
      this.stopFeed();
      this.setStatus('房间已关闭','terminal');
    }
  }

  async boot() {
    const generation=this.generation;
    let result;
    for(let attempt=0;attempt<3;attempt++){
      try{result=await this.request('/api/session');break;}
      catch(error){
        if(attempt===2||!uncertainReply(error))throw error;
        await wait(800);
        this.assertGeneration(generation);
      }
    }
    this.assertGeneration(generation);
    this.person=result.person;
    if(result.room)this.enter(result.room);
    else this.setStatus('在线服务就绪','idle');
    return result;
  }

  async profile(person) {
    const {person:saved}=await this.request('/api/profile',person);
    this.person=saved;
    return saved;
  }

  enter(view) {
    this.accept(view);
    if(!view.closed)this.connect(view.code);
    return view;
  }

  async enterOnline(path,data,code) {
    const generation=this.generation;
    try{
      const {view}=await this.request(path,data);
      return this.enter(view);
    }catch(error){
      if(!uncertainReply(error)&&error.code!=='ALREADY_IN_ROOM')throw error;
      const session=await this.request('/api/session').catch(()=>null);
      this.assertGeneration(generation);
      if(session&&this.person?.id&&session.person.id!==this.person.id)this.identityChanged();
      else if(session?.room&&(!code||code===session.room.code)){
        this.person=session.person;
        return this.enter(session.room);
      }
      throw error;
    }
  }

  create(settings){return this.enterOnline('/api/rooms',{settings});}
  join(code){return this.enterOnline(`/api/rooms/${code}/join`,{},code);}

  connect(code) {
    this.stopFeed();
    const feed={code,aborter:new AbortController(),backoff:RECONNECT_MIN,lastSeen:0};
    this.feed=feed;
    feed.resume=()=>this.resume();
    feed.offline=()=>this.scheduleRecovery(feed);
    feed.visibility=()=>{if(!globalThis.document.hidden)this.resume();};
    globalThis.addEventListener?.('online',feed.resume);
    globalThis.addEventListener?.('offline',feed.offline);
    globalThis.document?.addEventListener('visibilitychange',feed.visibility);
    this.setStatus('连接中','connecting');
    this.openEvents(feed);
  }

  openEvents(feed) {
    try{feed.events=new EventSource(`/api/rooms/${feed.code}/events`);}
    catch{this.scheduleRecovery(feed);return;}
    const events=feed.events;
    const current=()=>this.feed===feed&&feed.events===events;
    const observe=()=>{
      feed.lastSeen=Date.now();
      clearTimeout(feed.watchdog);
      feed.watchdog=setTimeout(()=>this.scheduleRecovery(feed),HEARTBEAT_TIMEOUT);
    };
    feed.watchdog=setTimeout(()=>this.scheduleRecovery(feed),CONNECT_TIMEOUT);
    events.onerror=()=>{if(current())this.scheduleRecovery(feed);};
    events.addEventListener('snapshot',event=>{
      if(!current())return;
      try{
        const view=JSON.parse(event.data);
        if(view?.code!==feed.code||typeof view.me!=='string'||!Number.isSafeInteger(view.version))return;
        this.accept(view);
        if(!current())return;
        feed.backoff=RECONNECT_MIN;
        observe();
        this.setStatus('在线','live');
      }catch(error){if(!lostSeat(error))this.scheduleRecovery(feed);}
    });
    events.addEventListener('heartbeat',()=>{if(current()&&this.connectionState==='live')observe();});
    events.addEventListener('removed',()=>{if(current())this.finishFeed('你已离开房间');});
    events.addEventListener('expired',()=>{if(current())this.finishFeed('房间已过期');});
  }

  stopEvents(feed) {
    clearTimeout(feed.watchdog);
    const events=feed.events;
    feed.events=null;
    events?.close();
  }

  stopFeed() {
    const feed=this.feed;
    if(!feed)return;
    this.feed=null;
    this.uncertain=null;
    this.stopEvents(feed);
    clearTimeout(feed.retry);
    feed.aborter.abort();
    globalThis.removeEventListener?.('online',feed.resume);
    globalThis.removeEventListener?.('offline',feed.offline);
    globalThis.document?.removeEventListener('visibilitychange',feed.visibility);
  }

  finishFeed(message) {
    this.stopFeed();
    this.view=null;
    this.uncertain=null;
    this.onView(null);
    this.setStatus(message,'terminal');
  }

  resume() {
    const feed=this.feed;
    if(!feed||this.connectionState==='live'&&Date.now()-feed.lastSeen<HEARTBEAT_TIMEOUT)return false;
    if(feed.syncing)return true;
    clearTimeout(feed.retry);
    feed.retry=undefined;
    this.scheduleRecovery(feed,true);
    return true;
  }

  scheduleRecovery(feed,immediate=false) {
    if(this.feed!==feed||feed.retry!==undefined)return;
    this.stopEvents(feed);
    if(this.connectionState!=='degraded')this.setStatus('正在重连','reconnecting');
    feed.retry=setTimeout(()=>{
      feed.retry=undefined;
      void this.recover(feed);
    },immediate?0:feed.backoff);
    feed.backoff=Math.min(RECONNECT_MAX,feed.backoff*2);
  }

  async recover(feed) {
    if(this.feed!==feed||feed.syncing)return;
    feed.syncing=true;
    try{
      const {view}=await this.request(`/api/rooms/${feed.code}`,undefined,{signal:feed.aborter.signal,timeout:8000});
      if(this.feed!==feed)return;
      this.accept(view);
      if(this.feed!==feed)return;
      if(this.uncertain)await this.confirmPending(feed);
      if(this.feed!==feed)return;
      this.setStatus('牌桌已同步，正在恢复实时连接','degraded');
      this.openEvents(feed);
    }catch(error){
      if(this.feed!==feed)return;
      if(lostSeat(error)){this.identityChanged();return;}
      if(error.code==='ROOM_NOT_FOUND'){this.finishFeed('房间已过期');return;}
      if(error.code==='NOT_MEMBER'){this.finishFeed('你已离开房间');return;}
      this.setStatus('连接中断，正在重试','reconnecting');
      this.scheduleRecovery(feed);
    }finally{feed.syncing=false;}
  }

  async submitCommand(feed,command) {
    const result=await this.request(`/api/rooms/${feed.code}/commands`,command,{timeout:7000});
    if(this.feed===feed){
      if(result.view)this.accept(result.view);
      if(result.left)this.finishFeed('你已离开房间');
    }
    return result.view;
  }

  async confirmPending(feed) {
    try{await this.submitCommand(feed,this.uncertain);}
    catch(error){
      if(this.feed!==feed)return;
      if(uncertainReply(error)||lostSeat(error)||['RATE_LIMIT','ROOM_NOT_FOUND','NOT_MEMBER'].includes(error.code))throw error;
      if(error.view)this.accept(error.view);
      this.onCommandError?.(error.code==='STALE_VERSION'?'牌桌进度已变化，这次操作未提交。':error.message);
    }
    if(this.feed===feed)this.uncertain=null;
  }

  async command(type,payload={}) {
    if(!this.feed||!this.view||this.view.closed)throw new GameError('NOT_MEMBER','请先恢复你的座位。');
    if(this.uncertain)throw new GameError('COMMAND_PENDING','正在确认上一项操作，请稍候。');
    const generation=this.generation,key=actionKey(this.view),feed=this.feed;
    const command={id:crypto.randomUUID(),version:this.view.version,type,payload};
    let retriedNetwork=false,awaitingReceipt=false;
    for(let i=0;i<5;i++){
      try{return await this.submitCommand(feed,command);}
      catch(error){
        this.assertGeneration(generation);
        if(this.feed!==feed)return this.view;
        if(lostSeat(error)){this.identityChanged();throw error;}
        if(error.view)this.accept(error.view);
        if(error.code==='STALE_VERSION'&&actionKey(this.view)===key){
          awaitingReceipt=false;
          command.version=this.view.version;
          continue;
        }
        if(uncertainReply(error)){
          awaitingReceipt=true;
          if(!retriedNetwork&&i<4){
            retriedNetwork=true;
            await wait(450);
            this.assertGeneration(generation);
            if(this.feed!==feed)return this.view;
            continue;
          }
        }
        if(uncertainReply(error)||awaitingReceipt&&error.code==='RATE_LIMIT'){
          this.uncertain=command;
          this.scheduleRecovery(feed);
          throw new GameError('COMMAND_PENDING','正在重连并确认本次操作。');
        }
        throw error;
      }
    }
    throw new GameError('STALE_VERSION','大家正在同时操作，请稍后再试。');
  }

  close({clearIdentity=false}={}) {
    this.generation++;
    this.requests.abort();
    this.requests=new AbortController();
    this.stopFeed();
    this.view=null;
    this.uncertain=null;
    this.connectionState='idle';
    if(clearIdentity)this.person=null;
  }
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
    this.persist(this.room);this.publish();this.onStatus('离线主持中','local');
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
    this.pc.onconnectionstatechange=()=>{
      if(this.pc.connectionState==='disconnected')this.onStatus('正在恢复离线连接','reconnecting');
      if(this.pc.connectionState==='connected'&&this.dc?.readyState==='open'&&this.view)this.onStatus('已连接离线房间','live');
      if(['failed','closed'].includes(this.pc.connectionState))this.onStatus('连接断开，请重新扫码','terminal');
    };
    await this.pc.setRemoteDescription({type:'offer',sdp:data.sdp});await this.pc.setLocalDescription(await this.pc.createAnswer());await gather(this.pc);
    return encodePair({kind:'answer',pairId:data.pairId,roomId:data.roomId,expires:data.expires,sdp:this.pc.localDescription.sdp});
  }
  bind(dc){this.dc=dc;dc.onopen=()=>{this.onStatus('正在加入离线房间','connecting');let proof;try{proof=JSON.parse(localStorage.getItem(SEATS_KEY)||'{}')[this.roomId];}catch{}send(dc,{kind:'hello',name:this.person.name,avatar:this.person.avatar,proof});};
    dc.onmessage=e=>{try{const msg=readJSON(e.data);
      if(msg.kind==='welcome'){this.person=msg.person;const seats=JSON.parse(localStorage.getItem(SEATS_KEY)||'{}');seats[msg.roomId]=msg.proof;localStorage.setItem(SEATS_KEY,JSON.stringify(seats));this.onStatus('已连接离线房间','live');}
      if(msg.kind==='snapshot')this.accept(msg.view);
      if(msg.kind==='removed'){for(const [id,task]of this.pending)if(task.type==='leave'){clearTimeout(task.timer);this.pending.delete(id);task.resolve(null);}this.onView(null);this.onStatus('已离开离线房间','terminal');this.close();return;}
      if(msg.kind==='ack'||msg.kind==='error'){if(msg.view)this.accept(msg.view);const task=this.pending.get(msg.id);if(task){clearTimeout(task.timer);this.pending.delete(msg.id);msg.kind==='ack'?task.resolve(msg.view):task.reject(Object.assign(new Error(msg.message),{code:msg.code}));}else if(msg.kind==='error')this.onStatus(msg.message);}
    }catch{this.onStatus('连接数据无法读取，请重新扫码。');}};
    dc.onclose=()=>this.onStatus('离线连接已断开，请重新扫码','terminal');
  }
  async command(type,payload={}){
    const key=actionKey(this.view);const command={id:crypto.randomUUID(),version:this.view.version,type,payload};
    for(let i=0;i<5;i++){try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(command.id);reject(Object.assign(new Error('房主暂时没有回应，请重连后重试。'),{code:'NETWORK'}));},10000);this.pending.set(command.id,{resolve,reject,timer,type});try{send(this.dc,{kind:'command',command});}catch(e){clearTimeout(timer);this.pending.delete(command.id);reject(e);}});}catch(e){if(e.code==='STALE_VERSION'&&actionKey(this.view)===key){command.version=this.view.version;continue;}throw e;}}
    throw new Error('牌桌正在更新，请稍后重试。');
  }
  close(){
    if(this.pc){
      this.pc.onconnectionstatechange=null;
      this.pc.ondatachannel=null;
      if(this.dc)this.dc.onopen=this.dc.onclose=this.dc.onmessage=null;
      this.pc.close();
    }
    for(const task of this.pending.values()){clearTimeout(task.timer);task.reject(new Error('连接已经关闭。'));}
    this.pending.clear();
  }
}
