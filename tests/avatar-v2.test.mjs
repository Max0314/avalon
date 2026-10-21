import test from 'node:test';
import assert from 'node:assert/strict';
import {AVATARS,PERSISTED_AVATAR_IDS,avatarAssetPaths} from '../shared/fribench-game-kit/avatars.mjs';
import {createRoom,applyCommand} from '../shared/engine.mjs';
import {buildApp} from '../server/app.mjs';
test('35 active choices and retired stored choices remain valid without changing card art',()=>{
  assert.equal(AVATARS.length,35);assert.equal(PERSISTED_AVATAR_IDS.length,52);
  const owner={id:'fixture',name:'测试',avatar:'bench-chill'},room=createRoom(owner);
  assert.equal(room.players[0].avatar,'bench-chill');
  for(const {id} of AVATARS)assert.equal(applyCommand(room,owner.id,'profile',{name:'测试',avatar:id}).players[0].avatar,id);
});
test('all new and legacy URLs return WebP; unpublished versions and unknown paths fail closed',async()=>{
  const app=buildApp({rateLimit:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${app.server.address().port}`;app.publicOrigin=base;
  try{
    for(const path of avatarAssetPaths){const r=await fetch(base+path);assert.equal(r.status,200,path);assert.match(r.headers.get('content-type'),/^image\/webp/);assert.equal(Buffer.from(await r.arrayBuffer()).toString('ascii',8,12),'WEBP');}
    for(const path of ['/avatars/v2/bench-chill.webp','/avatars/v1/pet-eleven.webp','/avatars/v4/pet-eleven.webp'])assert.equal((await fetch(base+path)).status,404,path);
  }finally{await app.close();}
});
