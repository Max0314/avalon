import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import {applyCommand,createRoom,joinRoom} from '../shared/engine.mjs';
import {buildApp} from '../server/app.mjs';
import {PostgresStore} from '../server/postgres-store.mjs';
import {Store} from '../server/store.mjs';

const profile=(id,avatar='cat-unbothered')=>({id,name:id,avatar});
const command=(type,room,payload={})=>({id:crypto.randomUUID(),type,version:room.version,payload});

test('新玩家获得空闲头像，重连保持原样，已有重复头像不影响改名',()=>{
  const room=joinRoom(createRoom(profile('host')),profile('guest'),{random:()=>0});
  assert.equal(room.players[0].avatar,'cat-unbothered');
  assert.equal(room.players[1].avatar,'shiba-sleepy');
  assert.deepEqual(joinRoom(room,profile('guest','goose-furious')),room);
  assert.throws(()=>applyCommand(room,'guest','profile',{name:'游客',avatar:'cat-unbothered'}),{code:'AVATAR_TAKEN'});

  const legacy=structuredClone(room);
  legacy.players[1].avatar=0;
  const renamed=applyCommand(legacy,'guest','profile',{name:'新昵称',avatar:'cat-unbothered'});
  assert.equal(renamed.players[1].name,'新昵称');
  assert.equal(renamed.players[1].avatar,'cat-unbothered');
});

test('只有房主可以在大厅提交完整座次，准备状态随玩家保留',()=>{
  let room=joinRoom(createRoom(profile('host')),profile('guest'));
  room=applyCommand(room,'guest','ready',{ready:true});
  const order={players:['guest','host']};
  assert.throws(()=>applyCommand(room,'guest','reorder',order),{code:'HOST_ONLY'});
  assert.throws(()=>applyCommand(room,'host','reorder',{players:['guest','guest']}),{code:'BAD_ORDER'});
  assert.throws(()=>applyCommand(room,'host','reorder',{players:['guest','somebody-else']}),{code:'BAD_ORDER'});
  const next=applyCommand(room,'host','reorder',order);
  assert.deepEqual(next.players.map(p=>p.id),order.players);
  assert.equal(next.players[0].ready,true);
  assert.equal(next.hostId,'host');
  assert.equal(next.version,room.version+1);
  assert.throws(()=>applyCommand({...room,game:{phase:'reveal'}},'host','reorder',order),{code:'WRONG_PHASE'});
});

test('真实 HTTP 邀请预览最小暴露，房主明确确认才切换并结束旧局',async()=>{
  const app=buildApp({rateLimit:false});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  app.publicOrigin=base;
  const makeSeat=()=>app.store.createSession();
  const call=async (seat,path,body)=>{
    const response=await fetch(base+path,{method:body?'POST':'GET',headers:{
      Cookie:`avalon_sid=${seat.secret}`,Origin:base,'Content-Type':'application/json','X-Avalon-Seat':seat.person.id,
    },body:JSON.stringify(body)});
    return {status:response.status,data:await response.json()};
  };
  try {
    const host=makeSeat(),newHost=makeSeat(),guest=makeSeat();
    let oldRoom=app.store.create(host.person,{});
    for(const seat of [guest,makeSeat(),makeSeat(),makeSeat()])oldRoom=app.store.join(oldRoom.code,seat.person);
    for(const seat of oldRoom.players)oldRoom=app.store.command(oldRoom.code,seat,command('ready',oldRoom,{ready:true})).room;
    oldRoom=app.store.command(oldRoom.code,host.person,command('start',oldRoom)).room;
    let nextRoom=app.store.create(newHost.person,{});
    const url=`/api/rooms/${nextRoom.code}`;
    const preview=(await call(host,url+'/invite')).data;
    assert.deepEqual(preview,{
      code:nextRoom.code,status:'open',usedAvatars:[newHost.person.avatar],
      current:{code:oldRoom.code,version:oldRoom.version,host:true,playing:true},canSwitch:true,
    });
    assert(!JSON.stringify(preview).includes(newHost.person.id));
    assert.equal((await call(guest,url+'/invite')).data.canSwitch,false);
    assert.equal((await call(host,url+'/join',{})).data.code,'ALREADY_IN_ROOM');
    const draft={name:'换桌昵称',avatar:'pet-eleven'};
    const confirmation={from:{code:oldRoom.code,version:oldRoom.version},profile:draft};
    const missing=['9999999999','8888888888','7777777777'].find(code=>![oldRoom.code,nextRoom.code].includes(code));
    assert.equal((await call(host,`/api/rooms/${missing}/join`,confirmation)).data.code,'ROOM_NOT_FOUND');
    assert.equal((await call(guest,url+'/join',confirmation)).data.code,'GAME_RUNNING');
    assert.equal((await call(host,url+'/join',{from:{...confirmation.from,version:0}})).data.code,'SWITCH_CHANGED');

    for(let i=0;i<9;i++)nextRoom=app.store.join(nextRoom.code,makeSeat().person);
    const full=await call(host,url+'/join',confirmation);
    assert.equal(full.data.code,'ROOM_FULL');
    assert.deepEqual(app.store.membership(host.person.id),oldRoom);
    assert.equal(app.store.session(host.secret).name,host.person.name);
    assert.deepEqual(app.store.get(nextRoom.code),nextRoom);
    const kick=command('kick',nextRoom,{playerId:nextRoom.players.at(-1).id});
    nextRoom=app.store.command(nextRoom.code,newHost.person,kick).room;

    const switched=await call(host,url+'/join',confirmation);
    assert.equal(switched.status,200);
    assert.equal(switched.data.view.code,nextRoom.code);
    assert.equal(switched.data.view.me,host.person.id);
    const joined=switched.data.view.players.find(player=>player.id===host.person.id);
    assert.equal(joined.name,draft.name);
    assert.equal(switched.data.person.avatar,draft.avatar);
    assert.equal(app.store.session(host.secret).name,draft.name);
    assert.equal(app.store.membership(host.person.id).code,nextRoom.code);
    assert(app.store.get(oldRoom.code).closed);
    assert.equal(app.store.db.prepare('SELECT status FROM player_matches WHERE id=?').get(oldRoom.game.id).status,'aborted');
    const replay=await call(host,url+'/join',{...confirmation,profile:{...draft,name:'旧请求不得覆写'}});
    assert.equal(replay.data.view.version,switched.data.view.version);
    assert.equal(replay.data.person.name,draft.name);
  } finally {
    await app.close();
  }
});

test('PostgreSQL 目标写入失败保留原房，重连可读取完整的成功切换',
  {skip:!process.env.TEST_DATABASE_URL},async()=>{
    const url=process.env.TEST_DATABASE_URL;
    const schema='avalon_switch_'+randomBytes(8).toString('hex');
    const admin=new pg.Pool({connectionString:url,max:1});
    let store;
    const open=async()=>{store=await PostgresStore.open(url,{schema});};
    const close=async()=>{if(store){await store.close();store=null;}};
    try{
      await admin.query(`CREATE SCHEMA "${schema}"`);
      await open();
      const {person:host,secret}=store.createSession();
      const old=store.create(host,{}),target=store.create(store.createSession().person,{});
      await store.flush();
      const confirmation={code:old.code,version:old.version};
      const draft={name:'换桌后',avatar:'pet-eleven',source:'custom'};
      const table=`"${schema}".avalon_rooms`;
      await admin.query(`ALTER TABLE ${table}
        ADD CONSTRAINT reject_join CHECK (code <> '${target.code}' OR jsonb_array_length(state->'players') < 2)`);
      store.switchRoom(target.code,host,confirmation,draft);
      await assert.rejects(store.flush(),/PostgreSQL commit failed/);
      await close();
      await open();
      assert.deepEqual(store.get(old.code),old);
      assert.deepEqual(store.get(target.code),target);
      assert.equal(store.session(secret).name,host.name);
      await admin.query(`ALTER TABLE ${table} DROP CONSTRAINT reject_join`);
      const {room}=store.switchRoom(target.code,host,confirmation,draft);
      await store.flush();
      await close();
      await open();
      assert.deepEqual(store.membership(host.id),room);
      assert(store.get(old.code).closed);
      assert.equal(store.session(secret).name,draft.name);
    }finally{
      await close();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

test('目标房间写入失败时两个房间一起回滚',()=>{
  const store=new Store();
  try {
    const {person:host,secret}=store.createSession();
    const old=store.create(host,{}),target=store.create(store.createSession().person,{});
    store.db.exec(`CREATE TEMP TRIGGER reject_destination BEFORE UPDATE ON rooms
      WHEN NEW.code='${target.code}' BEGIN SELECT RAISE(ABORT,'test write failure'); END;`);
    assert.throws(()=>store.switchRoom(target.code,host,{code:old.code,version:old.version},{name:'换桌后',avatar:'pet-eleven'}),/test write failure/);
    assert.deepEqual(store.get(old.code),old);
    assert.deepEqual(store.get(target.code),target);
    assert.equal(store.membership(host.id).code,old.code);
    assert.equal(store.session(secret).name,host.name);
  } finally {
    store.close();
  }
});
