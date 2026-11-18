import {botAction,nextBotView} from '../shared/bots.mjs';

const roomsPerTurn=8;

export function startBotTurns({store,authority,online,publish,delay=650}){
  const waiting=new Set();
  let timer,running=false,closed=false;

  function schedule(){
    if(closed||authority.failed||running||timer||!waiting.size)return;
    timer=setTimeout(move,delay);
    timer.unref();
  }

  function track(room){
    if(closed)return;
    if(room.game?.botAssisted&&nextBotView(room))waiting.add(room.code);
    else waiting.delete(room.code);
    schedule();
  }

  function move(){
    timer=null;
    running=true;
    const codes=[...waiting].slice(0,roomsPerTurn);
    for(const code of codes)waiting.delete(code);
    let started=false;
    void authority.run(()=>{
      started=true;
      if(closed)return;
      for(const code of codes){
        try{
          const room=store.get(code);
          const bot=room.game?.botAssisted?nextBotView(room):null;
          if(!bot)continue;
          const [type,payload]=botAction(bot);
          const command={id:crypto.randomUUID(),version:room.version,type,payload};
          const {room:next}=store.command(code,{id:bot.me},command,online(code));
          publish(next);
        }catch(error){
          if(error.code!=='ROOM_NOT_FOUND')console.error(JSON.stringify({event:'bot-turn-error',kind:error.code??error.name}));
        }
      }
    }).catch(()=>{
      if(!started&&!closed&&!authority.failed)for(const code of codes)waiting.add(code);
    }).finally(()=>{
      running=false;
      schedule();
    });
  }

  for(const room of store.activeBotRooms())track(room);
  return {track,close(){closed=true;clearTimeout(timer);waiting.clear();}};
}
