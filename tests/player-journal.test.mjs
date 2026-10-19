import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {PostgresStore} from '../server/postgres-store.mjs';
import {buildApp} from '../server/app.mjs';
const account=async header=>{const id=header?.match(/fixture=(p[0-5])/)?.[1];return id?{sub:id+'-private',name:id==='p0'?'中央昵称'.repeat(7):'棋友'+id,picture:'https://auth.fribench.cn/assets/avatars/v1/snow-king.webp'}:null;};
test('PostgreSQL full online match, account profile, hidden-role protection, stable journal, consent and participant isolation',{skip:!process.env.TEST_DATABASE_URL,timeout:180000},async()=>{
  const url=process.env.TEST_DATABASE_URL,schema='avalon_journal_'+randomBytes(7).toString('hex'),admin=new pg.Pool({connectionString:url,max:1});await admin.query(`CREATE SCHEMA "${schema}"`);let app,base,repo;const streams=[];let time=Date.now(),centralName='中央昵称'.repeat(7);
  const accountResolver=async h=>{const a=await account(h);return a?.sub==='p0-private'?{...a,name:centralName}:a;};
  async function start(){repo=await PostgresStore.open(url,{schema,now:()=>time});app=buildApp({repository:repo,resolveAccount:accountResolver,rateLimit:false,now:()=>time});await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));base=`http://127.0.0.1:${app.server.address().port}`;app.publicOrigin=base;}
  async function req(path,cookie='',data){const r=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{cookie,...(data===undefined?{}:{origin:base,'content-type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});return{status:r.status,value:await r.json(),cookie:r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')};}
  try{await start();const players=[];
    for(let i=0;i<5;i++){const r=await req('/api/session','fixture=p'+i);assert.equal(r.value.person.avatar,'snow-king');players.push({id:r.value.person.id,cookie:'fixture=p'+i+'; '+r.cookie});}
    const host=players[0];assert.equal((await req('/api/session',host.cookie)).value.person.name.length,28);
    assert.equal((await req('/api/profile',host.cookie,{name:'本局别名',avatar:'bench-chill'})).status,200);centralName='更新的中央昵称';assert.equal((await req('/api/session',host.cookie)).value.person.name,'本局别名');assert.equal((await req('/api/profile',host.cookie,{useAccount:true})).value.person.name,centralName);centralName='中央昵称'.repeat(7);assert.equal((await req('/api/session',host.cookie)).value.person.name.length,28);
    const created=await req('/api/rooms',host.cookie,{}),code=created.value.view.code;
    for(const p of players.slice(1))assert.equal((await req('/api/rooms/'+code+'/join',p.cookie,{})).status,200);
    for(const p of players){const control=new AbortController();streams.push(control);const r=await fetch(base+'/api/rooms/'+code+'/events',{headers:{cookie:p.cookie},signal:control.signal});assert.equal(r.status,200);void(async()=>{try{for await(const _chunk of r.body){}}catch{}})();}
    const current=async p=>(await req('/api/rooms/'+code,p.cookie)).value.view;
    let last;
    const command=async(p,type,payload={})=>{time+=1000;const v=await current(p),data={id:randomUUID(),version:v.version,type,payload};last={p,data};const r=await req('/api/rooms/'+code+'/commands',p.cookie,data);assert.equal(r.status,200,JSON.stringify(r.value));return r.value.view;};
    for(const p of players)await command(p,'ready',{ready:true});await command(host,'start');
    assert.equal((await req('/api/profile',host.cookie,{useAccount:true})).value.code,'GAME_RUNNING');assert.equal((await req('/api/player',host.cookie)).value.history.length,0);
    for(const p of players)await command(p,'confirmRole');
    for(let round=0;round<5;round++){const v=await current(host),leader=players.find(p=>p.id===v.game.leaderId);await command(leader,'nominate',{players:players.slice(0,v.game.needed).map(p=>p.id)});for(const p of players)await command(p,'vote',{approve:false});}
    const end=await current(host);assert.equal(end.game.phase,'finished');const own=(await req('/api/player',host.cookie)).value;assert.equal(own.summary.games,1);assert.equal(own.history[0].ranked,true);assert.equal(own.publicRanking,false);assert(!JSON.stringify(own).includes('-private'));
    const id=own.history[0].id,detail=(await req('/api/player/matches/'+id,host.cookie)).value;assert.equal(detail.players.length,5);assert(detail.players.every(p=>p.role));assert(!JSON.stringify(detail).includes('-private'));assert(!JSON.stringify(detail).includes('questCards'));assert.equal((await req('/api/player/companions',host.cookie)).value.entries.length,4);
    assert.equal((await req('/api/player/leaderboard',host.cookie)).value.entries.length,0);await req('/api/player/privacy',host.cookie,{publicRanking:true});assert.equal((await req('/api/player/leaderboard',host.cookie)).value.entries.length,1);await req('/api/player/privacy',host.cookie,{publicRanking:false});assert.equal((await req('/api/player/leaderboard',host.cookie)).value.entries.length,0);
    assert.equal((await req('/api/rooms/'+code+'/commands',last.p.cookie,last.data)).value.replayed,true);assert.equal((await req('/api/player',host.cookie)).value.summary.games,1);
    const outsider=await req('/api/session','fixture=p5'),other='fixture=p5; '+outsider.cookie;assert.equal((await req('/api/player/matches/'+id,other)).status,404);assert.equal((await req('/api/player',other)).value.summary.games,0);
    await command(host,'reset');for(const p of players)await command(p,'ready',{ready:true});await command(host,'start');await command(host,'reset');const after=(await req('/api/player',host.cookie)).value;assert.equal(after.summary.games,1);assert.equal(after.summary.aborted,1);const aborted=(await req('/api/player/matches/'+after.history[0].id,host.cookie)).value;assert(aborted.players.every(p=>p.role===null&&p.side===null));
    for(const s of streams)s.abort();await app.close();app=null;time+=7*3600000;repo=await PostgresStore.open(url,{schema,now:()=>time});repo.cleanup();await repo.flush();await repo.close();await start();assert.equal((await req('/api/player',host.cookie)).value.summary.games,1);assert.equal((await req('/api/player',host.cookie)).value.summary.aborted,1);
  }finally{for(const s of streams)s.abort();if(app)await app.close();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
});
test('guest history without a room requires an explicit one-time claim; failed confirmation does not consume it',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  const url=process.env.TEST_DATABASE_URL,schema='avalon_history_'+randomBytes(7).toString('hex'),admin=new pg.Pool({connectionString:url,max:1});await admin.query(`CREATE SCHEMA "${schema}"`);let app;
  try{const repo=await PostgresStore.open(url,{schema});app=buildApp({repository:repo,resolveAccount:account,rateLimit:false});await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));const base=`http://127.0.0.1:${app.server.address().port}`;app.publicOrigin=base;
    const req=async(path,cookie='',body)=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{cookie,...(body===undefined?{}:{origin:base,'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,value:await r.json(),cookie:r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')};};
    const guest=await req('/api/session'),id=randomUUID();await admin.query(`INSERT INTO "${schema}".player_matches VALUES($1,1,2,'completed','online',0,$2::jsonb)`,[id,JSON.stringify({id,status:'completed'})]);await admin.query(`INSERT INTO "${schema}".player_match_members(match_id,seat_id,name,avatar,bot,won) VALUES($1,$2,'游客','bench-chill',0,1)`,[id,guest.value.person.id]);
    const login=await req('/api/session','fixture=p0; '+guest.cookie),owner='fixture=p0; '+login.cookie,preview=await req('/api/account/guest-preview',owner,{});assert.equal(preview.value.records,1);assert.equal(preview.value.code,null);
    assert.equal((await req('/api/account/guest-claim',owner,{confirm:false,previewToken:preview.value.previewToken})).status,409);assert.equal((await req('/api/account',owner)).value.guestClaimAvailable,true);
    const claimed=await req('/api/account/guest-claim',owner,{confirm:true,previewToken:preview.value.previewToken});assert.equal(claimed.status,200);assert.equal((await req('/api/player',owner)).value.summary.games,1);assert.equal((await req('/api/account/guest-preview',owner,{})).value.code,'CLAIM_ALREADY_USED');assert.equal((await req('/api/player',guest.cookie)).status,401);
  }finally{if(app)await app.close();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
});
