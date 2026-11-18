import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rmdir,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import pg from 'pg';
import {buildApp} from '../server/app.mjs';
import {PostgresStore} from '../server/postgres-store.mjs';
import {Store} from '../server/store.mjs';
import {botAction,nextBotView} from '../shared/bots.mjs';
import {applyCommand,createRoom,joinRoom,playerView} from '../shared/engine.mjs';

const draft=id=>({id,name:id,avatar:'pet-eleven'});
const command=(room,type,payload={})=>({id:crypto.randomUUID(),version:room.version,type,payload});

test('线上房主可补位和移除机器人，旧模式或非房主不能添加，补位保留真人准备',()=>{
  const context={allowBots:true,random:()=>0};
  let room=joinRoom(createRoom(draft('host')),draft('guest'));
  room=applyCommand(room,'host','ready',{ready:true});
  assert.throws(()=>applyCommand(room,'guest','fillBots',{},context),{code:'HOST_ONLY'});
  assert.throws(()=>applyCommand(room,'host','addBot'),{code:'BOTS_UNAVAILABLE'});
  room=applyCommand(room,'host','fillBots',{},context);
  assert.equal(room.players.length,5);
  assert.equal(room.players[0].ready,true);
  assert.equal(room.players[1].ready,false);
  assert.equal(new Set(room.players.map(player=>player.avatar)).size,5);
  const bots=playerView(room,'host').players.filter(player=>player.bot);
  assert(bots.length===3&&bots.every(player=>player.ready&&player.online));
  assert.throws(()=>applyCommand(room,'host','transfer',{playerId:bots[0].id}),{code:'BAD_TARGET'});
  assert.throws(()=>applyCommand(room,'host','removeBot',{playerId:'guest'},context),{code:'BAD_TARGET'});
  room=applyCommand(room,'host','removeBot',{playerId:bots[0].id},context);
  assert.equal(room.players.length,4);
  room=applyCommand(room,'host','addBot',{},context);
  room=applyCommand(room,'host','settings',{settings:{}},context);
  assert(room.players.every(player=>player.ready===Boolean(player.bot)));
  room=applyCommand(room,'host','leave');
  assert.equal(room.hostId,'guest');
  room=applyCommand(room,'guest','leave');
  assert(room.closed&&room.players.length===0);
});

async function verifyBotRestart(open){
  let app,repository;
  try{
    repository=await open();
    const {person,secret}=repository.createSession();
    let room=repository.create(person,{});
    const act=(type,payload,actor=person)=>{
      room=repository.command(room.code,actor,command(room,type,payload),new Set([person.id])).room;
    };
    act('fillBots');
    act('ready',{ready:true});
    act('start');
    const botIds=room.players.filter(player=>player.bot).map(player=>player.id);
    act('confirmRole',{}, {id:botIds[0]});
    const beforeRestart=room.version;
    await repository.flush?.();
    await repository.close();
    repository=null;

    repository=await open();
    app=buildApp({repository,rateLimit:false,botTurnDelay:5});
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${app.server.address().port}`;
    app.publicOrigin=base;
    const url=`${base}/api/rooms/${room.code}`;
    const cookie=`avalon_sid=${secret}`;
    const fake=await fetch(url+'/commands',{method:'POST',headers:{Cookie:cookie,Origin:base,
      'X-Avalon-Seat':botIds[0],'Content-Type':'application/json'},body:JSON.stringify(command(room,'confirmRole'))});
    assert.equal(fake.status,401);
    assert.equal((await fake.json()).code,'SEAT_CHANGED');
    let view;
    for(let attempt=0;attempt<80;attempt++){
      const response=await fetch(url,{headers:{Cookie:cookie}});
      ({view}=await response.json());
      if(view.game.confirmed.length===4)break;
      await wait(10);
    }
    assert.equal(view.version,beforeRestart+3);
    assert.equal(view.game.phase,'reveal');
    assert.equal(view.game.botAssisted,true);
    assert.deepEqual([...view.game.confirmed].sort(),[...botIds].sort());
    assert(!Object.hasOwn(view.game,'roles'));
    const sessionCount=repository.sessions?.size??repository.db.prepare('SELECT count(*) AS count FROM sessions').get().count;
    assert.equal(sessionCount,1);
  }finally{
    if(app)await app.close();
    else await repository?.close();
  }
}

test('重启后服务端继续在线机器人动作，原有确认不重复，HTTP 不能冒充机器人',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'avalon-bots-'));
  const dbPath=join(dir,'rooms.sqlite');
  try{
    await verifyBotRestart(()=>new Store(dbPath));
  }finally{
    await unlink(dbPath).catch(error=>{if(error.code!=='ENOENT')throw error;});
    await rmdir(dir);
  }
});

async function verifyAssistedJournal(repository){
  try{
    const {person}=repository.createSession();
    let room=repository.create(person,{});
    // Give a lookup result for every ID to prove bots are explicitly excluded.
    repository.personAccount=id=>id;
    repository.journal.profile(person.id,person.name,person.avatar);
    repository.journal.privacy(person.id,true);
    const act=(type,payload={},actor=person)=>{
      room=repository.command(room.code,actor,command(room,type,payload),new Set([person.id])).room;
    };
    act('fillBots');
    act('ready',{ready:true});
    act('start');
    assert.throws(()=>act('addBot'),{code:'WRONG_PHASE'});
    for(let step=0;step<150&&room.game.phase!=='finished';step++){
      const bot=nextBotView(room);
      if(bot){
        const [type,payload]=botAction(bot,()=>0);
        act(type,payload,{id:bot.me});
        continue;
      }
      const {game,players}=playerView(room,person.id);
      switch(game.phase){
        case 'reveal':act('confirmRole');break;
        case 'nominate':act('nominate',{players:players.slice(0,game.needed).map(player=>player.id)});break;
        case 'vote':act('vote',{approve:true});break;
        case 'quest':act('quest',{success:true});break;
        case 'questResult':act('continue');break;
        case 'assassin':act('assassinate',{playerId:players.find(player=>player.id!==person.id).id});break;
        default:assert.fail(game.phase);
      }
    }
    assert.equal(room.game.phase,'finished');
    await repository.flush?.();
    const owner={accountId:person.id};
    const result=await repository.journal.detail(owner,room.game.id);
    assert.equal(result.botAssisted,true);
    assert.equal(result.eligible,false);
    assert.equal(result.players.filter(player=>player.bot).length,4);
    for(const player of result.players.filter(player=>player.bot))assert.equal(await repository.journal.guestCount(player.seatId),1);
    assert.equal((await repository.journal.read(owner)).summary.games,1);
    assert.deepEqual((await repository.journal.leaderboard()).entries,[]);
    act('reset');
    act('ready',{ready:true});
    act('start');
    const abortedId=room.game.id;
    act('reset');
    const expiry=repository.now()+7*3600000;
    repository.now=()=>expiry;
    repository.cleanup();
    await repository.flush?.();
    const aborted=await repository.journal.detail(owner,abortedId);
    assert.equal(aborted.status,'aborted');
    assert.equal(aborted.botAssisted,true);
  }finally{await repository.close();}
}

test('线上的补位局按标准规则完成，真人档案标记辅助，机器人没有账号且不计公榜',async()=>{
  await verifyAssistedJournal(new Store());
});

test('PostgreSQL 重启继续机器人行动，真人档案保留但不计入公开榜',
  {skip:!process.env.TEST_DATABASE_URL},async()=>{
    const url=process.env.TEST_DATABASE_URL;
    const schema='avalon_bots_'+randomBytes(8).toString('hex');
    const pool=new pg.Pool({connectionString:url,max:1});
    const open=()=>PostgresStore.open(url,{schema});
    try{
      await pool.query(`CREATE SCHEMA "${schema}"`);
      await verifyBotRestart(open);
      await verifyAssistedJournal(await open());
    }finally{
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
});
