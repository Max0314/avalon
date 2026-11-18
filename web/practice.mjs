import {
  applyCommand,BOT_NAMES,createRoom,DEFAULT_SETTINGS,EVIL,GameError,joinRoom,playerView,randomInt,roleSet,ROLES,shuffle,SIZES,
} from '../shared/engine.mjs';
import {AVATARS} from '../shared/fribench-game-kit/avatars.mjs';
import {botAction,nextBotView} from '../shared/bots.mjs';

const specialEvil=['morgana','mordred','oberon'];
const decisionDelay=650;

function practiceSettings(count,role){
  const settings={...DEFAULT_SETTINGS};
  if(specialEvil.includes(role)){
    settings[role]=true;
    if(EVIL[count]===2&&role!=='morgana')settings.morgana=false;
  }
  if(role==='minion'&&EVIL[count]===2)settings.morgana=false;
  return settings;
}

// No storage or server transport. Full practice state stays internal to this tab.
export class Practice {
  #room;
  #seatId;
  #online;
  #random;
  #ownRole;
  #paused;
  #disposed=false;
  #timer;
  #onView;
  #onStatus;

  constructor(person,onView,onStatus,{count=5,role=null,paused=false,random=randomInt}={}){
    if(!Number.isInteger(count)||!SIZES[count])throw new GameError('PLAYER_COUNT','练习需要 5～10 个席位。');
    if(role!==null&&!Object.hasOwn(ROLES,role))throw new GameError('PRACTICE_ROLE','请选择可用的练习身份。');
    this.kind='practice';
    this.#seatId=person.id;
    this.#onView=onView;
    this.#onStatus=onStatus;
    this.#random=random;
    this.#ownRole=role;
    this.#paused=Boolean(paused);
    let room=createRoom(person,practiceSettings(count,role),{code:'练习桌'});
    const avatars=shuffle(AVATARS.map(avatar=>avatar.id).filter(id=>id!==room.players[0].avatar),this.#random);
    for(let i=0;i<count-1;i++){
      room=joinRoom(room,{id:crypto.randomUUID(),name:BOT_NAMES[i],avatar:avatars[i]});
      room.players.at(-1).bot=true;
    }
    this.#online=new Set(room.players.map(player=>player.id));
    this.#room=this.#readyBots(room);
    this.view=this.#project();
    globalThis.document?.addEventListener('visibilitychange',this.#visibility);
    queueMicrotask(()=>{
      if(this.#disposed)return;
      this.#announce();
      this.#publish();
    });
  }

  get paused(){return this.#paused;}
  get canStep(){return this.#botView()!==null;}

  #project(){return playerView(this.#room,this.#seatId,this.#online);}

  #readyBots(room){
    for(const player of room.players){
      if(player.bot&&!player.ready)room=applyCommand(room,player.id,'ready',{ready:true});
    }
    return room;
  }

  #announce(){
    this.#onStatus?.(this.#paused?'练习中 · 人机已暂停':'单人练习','local');
  }

  #publish(){
    this.view=this.#project();
    this.#onView(this.view);
    this.#schedule();
  }

  #botView(){return this.#disposed?null:nextBotView(this.#room);}

  #moveBot(){
    const view=this.#botView();
    if(!view)return false;
    const [type,payload]=botAction(view,this.#random);
    this.#room=applyCommand(this.#room,view.me,type,payload,{online:this.#online,random:this.#random});
    this.#publish();
    return true;
  }

  #visibility=()=>this.#schedule();

  #schedule(){
    clearTimeout(this.#timer);
    if(this.#disposed||this.#paused||globalThis.document?.hidden||!this.canStep)return;
    this.#timer=setTimeout(()=>this.#moveBot(),decisionDelay);
  }

  setPaused(paused){
    if(this.#disposed)return;
    this.#paused=Boolean(paused);
    this.#announce();
    this.#publish();
  }

  step(){return this.#paused&&this.#moveBot();}

  async command(type,payload={}){
    if(this.#disposed)throw new GameError('NOT_MEMBER','练习桌已退出。');
    if(type==='kick'||type==='transfer')throw new GameError('PRACTICE_SEATS','练习座位由本桌预设。');
    if(type==='leave')type='close';
    let next=applyCommand(this.#room,this.#seatId,type,payload,{online:this.#online,random:this.#random});
    if(type==='settings'&&this.#ownRole&&!roleSet(next.players.length,next.settings,()=>0).includes(this.#ownRole)){
      throw new GameError('PRACTICE_ROLE','请保留本次练习选定的身份。');
    }
    if(type==='settings'||type==='reset')next=this.#readyBots(next);
    if(type==='start'&&this.#ownRole){
      const {roles}=next.game;
      const seat=next.players.find(player=>roles[player.id]===this.#ownRole)?.id;
      if(!seat)throw new GameError('PRACTICE_ROLE','当前设置未包含你选定的身份。');
      [roles[seat],roles[this.#seatId]]=[roles[this.#seatId],roles[seat]];
    }
    this.#room=next;
    this.#publish();
    return this.view;
  }

  close(){
    this.#disposed=true;
    clearTimeout(this.#timer);
    globalThis.document?.removeEventListener('visibilitychange',this.#visibility);
  }
}
