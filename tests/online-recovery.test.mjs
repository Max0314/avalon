import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Online} from '../web/transports.mjs';
import {buildApp} from '../server/app.mjs';

const code='AA00000010';
const snapshot=(version=0,me='first-seat')=>({
  id:'round-table',code,me,version,closed:false,players:[{id:me,online:true}],game:null
});
const pending=()=>new Promise(resolve=>setImmediate(resolve));
const response=(body,status=200)=>Response.json(body,{status});

function harness(t,fetcher) {
  const feeds=[],views=[],states=[],commandErrors=[];
  let identityChanges=0;
  const original=Object.getOwnPropertyDescriptor(globalThis,'EventSource');
  Object.defineProperty(globalThis,'EventSource',{configurable:true,value:class extends EventTarget{
    constructor(url){super();this.url=url;feeds.push(this);}
    close(){this.closed=true;}
    send(type,data){this.dispatchEvent(new MessageEvent(type,{data:JSON.stringify(data)}));}
  }});
  t.mock.timers.enable({apis:['setTimeout','Date']});
  t.mock.method(globalThis,'fetch',fetcher);
  const online=new Online(view=>views.push(view),(text,state)=>states.push({text,state}),{
    onIdentityChange:()=>identityChanges++,
    onCommandError:message=>commandErrors.push(message)
  });
  online.person={id:'first-seat'};
  online.enter(snapshot());
  t.after(()=>{
    online.close();
    if(original)Object.defineProperty(globalThis,'EventSource',original);
    else delete globalThis.EventSource;
  });
  return {online,feeds,views,states,commandErrors,identityChanges:()=>identityChanges};
}

test('掉线通过受授权的快照追平，再恢复实时消息并丢弃旧流事件',async t=>{
  const reads=[];
  const {online,feeds,views,states}=harness(t,async(path,opts)=>{
    reads.push([path,opts.headers['X-Avalon-Seat']]);
    return response({view:snapshot(3)});
  });
  feeds[0].send('snapshot',snapshot(1));
  assert.equal(online.connectionState,'live');
  feeds[0].onerror();
  assert(feeds[0].closed);
  assert.equal(online.connectionState,'reconnecting');
  t.mock.timers.tick(600);
  await pending();
  assert.deepEqual(reads,[[`/api/rooms/${code}`,'first-seat']]);
  assert.equal(online.view.version,3);
  assert.equal(feeds.length,2);
  feeds[0].send('snapshot',snapshot(8));
  feeds[0].send('removed',{});
  feeds[1].send('snapshot',snapshot(2));
  assert.equal(online.view.version,3);
  feeds[1].send('snapshot',snapshot(4));
  assert.deepEqual(views.map(v=>v.version),[0,1,3,4]);
  assert.deepEqual(states.map(s=>s.state),['connecting','live','reconnecting','degraded','live']);
});

test('有效心跳延长连接时间，静默超时通过快照识别已过期房间并停止重试',async t=>{
  let polls=0;
  const {online,feeds,views}=harness(t,async()=>{
    polls++;
    return response({code:'ROOM_NOT_FOUND'},404);
  });
  feeds[0].send('snapshot',snapshot());
  t.mock.timers.tick(32000);
  feeds[0].send('heartbeat',{});
  t.mock.timers.tick(32000);
  assert(!feeds[0].closed);
  t.mock.timers.tick(3000);
  assert(feeds[0].closed);
  t.mock.timers.tick(600);
  await pending();
  assert.equal(polls,1);
  assert.equal(views.at(-1),null);
  assert.equal(online.connectionState,'terminal');
  t.mock.timers.tick(60000);
  assert.equal(polls,1);
});

test('新流不能把另一账号的投影视图带进旧席位，旧 HTTP 结果也会丢弃',async t=>{
  let release;
  const {online,feeds,views,identityChanges}=harness(t,()=>new Promise(resolve=>{release=resolve;}));
  const request=online.request('/api/player');
  const rejected=assert.rejects(request,{code:'ACCOUNT_CHANGED'});
  feeds[0].send('snapshot',snapshot(1,'second-seat'));
  assert.equal(identityChanges(),1);
  assert.equal(views.at(-1),null);
  assert(!views.some(v=>v?.me==='second-seat'));
  release(response({private:'from previous account'}));
  await rejected;
  assert.equal(online.connectionState,'terminal');
});

test('操作响应连续丢失后只以完全相同的回执请求确认，不重复执行',async t=>{
  const posted=[];
  const {online,feeds}=harness(t,async(path,opts)=>{
    if(opts.method==='GET')return response({view:snapshot(1)});
    posted.push(opts.body);
    if(posted.length<3)throw Error('connection lost after submit');
    return response({view:snapshot(1),replayed:true});
  });
  feeds[0].send('snapshot',snapshot());
  const command=online.command('ready',{ready:true});
  const rejected=assert.rejects(command,{code:'COMMAND_PENDING'});
  await pending();
  t.mock.timers.tick(450);
  await rejected;
  await assert.rejects(online.command('ready',{ready:false}),{code:'COMMAND_PENDING'});
  t.mock.timers.tick(600);
  await pending();
  assert.equal(posted.length,3);
  assert(posted.every(body=>body===posted[0]));
  assert.equal(JSON.parse(posted[0]).version,0);
  assert.equal(online.view.version,1);
  assert.equal(online.uncertain,null);
  assert.equal(feeds.length,2);
});

test('离席消息先到时仍接受进行中的离席回执',async t=>{
  let release;
  const {online,feeds,views}=harness(t,()=>new Promise(resolve=>{release=resolve;}));
  const command=online.command('leave');
  feeds[0].send('removed',{});
  release(response({view:null,left:true}));
  assert.equal(await command,null);
  assert.equal(views.at(-1),null);
  assert.equal(online.connectionState,'terminal');
});

test('服务器确认旧操作未提交且牌桌已推进时，恢复流程提醒玩家重试',async t=>{
  const posted=[];
  const {online,feeds,commandErrors}=harness(t,async(path,opts)=>{
    if(opts.method==='GET')return response({view:snapshot(2)});
    posted.push(opts.body);
    if(posted.length<3)throw Error('unavailable');
    return response({code:'STALE_VERSION',view:snapshot(2)},409);
  });
  feeds[0].send('snapshot',snapshot());
  const rejected=assert.rejects(online.command('ready',{ready:true}),{code:'COMMAND_PENDING'});
  await pending();
  t.mock.timers.tick(450);
  await rejected;
  t.mock.timers.tick(600);
  await pending();
  assert.equal(online.uncertain,null);
  assert.deepEqual(commandErrors,['牌桌进度已变化，这次操作未提交。']);
  assert.equal(new Set(posted).size,1,'恢复过程不以新版本替玩家提交旧操作');
});

test('HTTP 写入以 Cookie 实际识别的玩家核对旧席位，拒绝跨账号提交',async()=>{
  const app=buildApp({rateLimit:false});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  app.publicOrigin=base;
  try{
    const a=app.store.createSession(),b=app.store.createSession();
    const created=app.store.create(a.person,{});
    const room=app.store.join(created.code,b.person);
    const url=`${base}/api/rooms/${room.code}/commands`;
    const body=JSON.stringify({id:crypto.randomUUID(),version:room.version,type:'ready',payload:{ready:true}});
    const headers={cookie:`avalon_sid=${b.secret}`,origin:base,'content-type':'application/json'};
    const rejected=await fetch(url,{method:'POST',headers:{...headers,'X-Avalon-Seat':a.person.id},body});
    assert.equal(rejected.status,401);
    assert.equal((await rejected.json()).code,'SEAT_CHANGED');
    assert.equal(app.store.get(room.code).version,room.version);
    const accepted=await fetch(url,{method:'POST',headers:{...headers,'X-Avalon-Seat':b.person.id},body});
    assert.equal(accepted.status,200);
    assert.equal((await accepted.json()).view.me,b.person.id);
  }finally{await app.close();}
});

test('真实 SSE 在已授权的快照之后发出可被客户端观察的心跳',async t=>{
  t.mock.timers.enable({apis:['setInterval']});
  const app=buildApp({rateLimit:false});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const {secret,person}=app.store.createSession(),room=app.store.create(person,{});
  let reader;
  async function readThrough(marker) {
    const decoder=new TextDecoder();
    let text='';
    while(!text.includes(marker)||!text.includes('\n\n',text.indexOf(marker))){
      const {value,done}=await reader.read();
      assert(!done);
      text+=decoder.decode(value,{stream:true});
    }
    return text;
  }
  try{
    const stream=await fetch(`${base}/api/rooms/${room.code}/events`,{
      headers:{cookie:`avalon_sid=${secret}`},signal:AbortSignal.timeout(3000)
    });
    assert.equal(stream.status,200);
    reader=stream.body.getReader();
    assert.match(await readThrough('event: snapshot'),new RegExp(person.id));
    t.mock.timers.tick(15000);
    assert.match(await readThrough('event: heartbeat'),/data: \{\}/);
  }finally{
    await reader?.cancel();
    await app.close();
  }
});
