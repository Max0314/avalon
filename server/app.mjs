import http from 'node:http';
import {isIP} from 'node:net';
import {createReadStream,statSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {Store} from './store.mjs';
import {playerView,GameError,ROLES,AVATARS} from '../shared/engine.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const JSON_LIMIT=8192;
const codePattern=/^[A-F0-9]{10}$/;
const cacheHeaders={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const json=(res,status,value)=>{res.writeHead(status,cacheHeaders);res.end(JSON.stringify(value));};
export function buildApp({dbPath=':memory:',publicOrigin='http://localhost:3000',secureCookies=publicOrigin.startsWith('https:'),now=Date.now,root=ROOT,release='dev',rateLimit=true,trustProxy=false}={}) {
  const store=new Store(dbPath,{now}), streams=new Map(),limits=new Map();
  const cookieName=secureCookies?'__Host-avalon_sid':'avalon_sid';
  const online=code=>new Set([...streams.values()].filter(x=>x.code===code).map(x=>x.person.id));
  function limit(key,max,period=60000) {
    if(!rateLimit)return;
    const value=limits.get(key);
    if(!value||now()-value.start>=period){limits.set(key,{start:now(),count:1});return;}
    if(++value.count>max)throw new GameError('RATE_LIMIT','操作太频繁，请稍后再试。');
  }
  function identify(req,res,create=false) {
    const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=')).filter(x=>x.length===2));
    let secret=cookies[cookieName],person=store.session(secret);
    if(!person&&create){const created=store.createSession();secret=created.secret;person=created.person;res.setHeader('Set-Cookie',`${cookieName}=${secret}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secureCookies?'; Secure':''}`);}
    if(!person)throw new GameError('UNAUTHENTICATED','请刷新页面重新建立访客身份。');
    return person;
  }
  function view(room,id){return playerView(room,id,online(room.code));}
  function broadcast(room) {
    for(const [key,stream] of streams)if(stream.code===room.code) {
      try {
        if(!room.players.some(p=>p.id===stream.person.id)){stream.res.write('event: removed\ndata: {}\n\n');stream.res.end();streams.delete(key);continue;}
        const body=JSON.stringify(view(room,stream.person.id));
        if(stream.res.writableLength>262144){stream.res.destroy();streams.delete(key);continue;}
        stream.res.write(`event: snapshot\ndata: ${body}\n\n`);
      }catch{stream.res.end();streams.delete(key);}
    }
  }
  async function body(req) {
    if(!(req.headers['content-type']||'').startsWith('application/json'))throw new GameError('BAD_CONTENT_TYPE','请使用正确的请求格式。');
    if(Number(req.headers['content-length']||0)>JSON_LIMIT)throw new GameError('BODY_TOO_LARGE','请求内容过大。');
    let bytes=0;const parts=[];
    for await(const part of req){bytes+=part.length;if(bytes>JSON_LIMIT)throw new GameError('BODY_TOO_LARGE','请求内容过大。');parts.push(part);}
    try {const value=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{throw new GameError('BAD_JSON','请求内容无法读取。');}
  }
  function exact(data,keys){if(Object.keys(data).some(k=>!keys.includes(k)))throw new GameError('BAD_COMMAND','请求包含不支持的参数。');}
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('X-Robots-Tag','noindex, nofollow');
    res.setHeader('Permissions-Policy','camera=(self), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; media-src 'self' blob:; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'");
    let person,code;
    try {
      const url=new URL(req.url,'http://localhost');const path=url.pathname;
      if(path==='/healthz'){json(res,200,{ok:true,service:'avalon',release});return;}
      if(path==='/readyz'){store.db.prepare('SELECT 1').get();json(res,200,{ok:true});return;}
      if(path.startsWith('/api/')) {
        if(req.headers['sec-fetch-site']==='cross-site')throw new GameError('BAD_ORIGIN','请从本站重新打开游戏。');
        if(!['GET','POST'].includes(req.method))throw new GameError('BAD_METHOD','不支持这个请求方法。');
        if(req.method==='POST'&&req.headers.origin!==app.publicOrigin)throw new GameError('BAD_ORIGIN','页面来源无法确认，请从游戏首页重新打开。');
        const forwarded=req.headers['x-real-ip'],clientIP=trustProxy&&typeof forwarded==='string'&&isIP(forwarded)?forwarded:req.socket.remoteAddress;
        limit(`ip:${clientIP}`,900);
        if(path==='/api/session'&&req.method==='GET') {
          limit(`session:${clientIP}`,90);person=identify(req,res,true);
          const current=store.membership(person.id);json(res,200,{person:{id:person.id,name:person.name,avatar:person.avatar},room:current?view(current,person.id):null});return;
        }
        person=identify(req,res);
        if(path==='/api/profile'&&req.method==='POST') {
          const data=await body(req);exact(data,['name','avatar']);
          const current=store.membership(person.id);if(current)throw new GameError('ALREADY_IN_ROOM','请在房间中修改自己的资料。');
          const p=store.profile(person,data.name,data.avatar);json(res,200,{person:{id:p.id,name:p.name,avatar:p.avatar}});return;
        }
        if(path==='/api/rooms'&&req.method==='POST') {
          limit(`create:${person.id}`,6);limit(`create-ip:${clientIP}`,15);
          const data=await body(req);exact(data,['settings']);const room=store.create(person,data.settings);json(res,201,{view:view(room,person.id)});return;
        }
        const match=path.match(/^\/api\/rooms\/([A-F0-9]{10})(?:\/(join|commands|events))?$/);
        if(!match)throw new GameError('NOT_FOUND','接口不存在。');
        code=match[1];const action=match[2];
        if(action==='join'&&req.method==='POST'){
          exact(await body(req),[]);limit(`join:${person.id}`,30);const room=store.join(code,person);broadcast(room);json(res,200,{view:view(room,person.id)});return;
        }
        const room=store.get(code);
        if(action!=='commands'&&!room.players.some(p=>p.id===person.id))throw new GameError('NOT_MEMBER','请先通过邀请加入房间。');
        if(action==='events'&&req.method==='GET') {
          if([...streams.values()].filter(s=>s.person.id===person.id).length>=4)throw new GameError('TOO_MANY_TABS','打开的牌桌过多，请关闭一些页面再试。');
          res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
          const key=crypto.randomUUID();streams.set(key,{code,person,res});res.write(': connected\n\n');broadcast(room);
          req.on('close',()=>{streams.delete(key);try{broadcast(store.get(code));}catch{}});return;
        }
        if(!action&&req.method==='GET'){json(res,200,{view:view(room,person.id)});return;}
        if(action==='commands'&&req.method==='POST') {
          limit(`command:${person.id}`,180);
          const command=await body(req),result=store.command(code,person,command,online(code));
          if(!result.replayed)broadcast(result.room);
          json(res,200,{view:result.room.players.some(p=>p.id===person.id)?view(result.room,person.id):null,left:!result.room.players.some(p=>p.id===person.id),replayed:result.replayed});return;
        }
        throw new GameError('NOT_FOUND','接口不存在。');
      }
      if(!['GET','HEAD'].includes(req.method)){json(res,405,{message:'不支持这个请求方法。'});return;}
      let file,mime;
      const fixed={'/':['index.html','text/html; charset=utf-8'],'/index.html':['index.html','text/html; charset=utf-8'],'/assets/app.js':['.dist/app.js','text/javascript; charset=utf-8'],'/assets/styles.css':['.dist/styles.css','text/css; charset=utf-8'],'/manifest.json':['manifest.json','application/manifest+json'],'/sw.js':['.dist/sw.js','text/javascript; charset=utf-8'],'/licenses.txt':['.dist/THIRD-PARTY-LICENSES.txt','text/plain; charset=utf-8']};
      if(fixed[path]) [file,mime]=fixed[path];
      else if(/^\/cards\/[a-z0-9_-]+\.png$/.test(path)&&Object.values(ROLES).some(r=>path===`/cards/${r.image}`)||['/cards/quest_success.png','/cards/quest_fail.png','/icons/app-icon.png','/icons/lady_token.png'].includes(path)){file=path.slice(1);mime='image/png';}
      else {json(res,404,{message:'页面不存在。'});return;}
      const full=resolve(root,file);if(!full.startsWith(resolve(root)))throw new Error('Invalid static path');
      const stat=statSync(full);if(!stat.isFile())throw new Error('Invalid static file');
      res.setHeader('Content-Type',mime);res.setHeader('Cache-Control',path==='/sw.js'||mime.startsWith('text/html')?'no-cache':mime==='image/png'?'public, max-age=604800':'no-cache');
      res.setHeader('Content-Length',stat.size);if(req.method==='HEAD')res.end();else createReadStream(full).on('error',()=>res.destroy()).pipe(res);
    }catch(e){
      if(res.headersSent){res.end();return;}
      const known=e instanceof GameError;
      const status=!known?500:e.code==='RATE_LIMIT'?429:['BAD_ORIGIN','NOT_MEMBER','HOST_ONLY'].includes(e.code)?403:e.code==='UNAUTHENTICATED'?401:['ROOM_NOT_FOUND','NOT_FOUND'].includes(e.code)?404:409;
      let current=null;if(known&&code&&person){try{current=view(store.get(code),person.id);}catch{}}
      if(!known)console.error(JSON.stringify({event:'request-error',kind:e.name||'Error'}));
      json(res,status,{code:known?e.code:'INTERNAL_ERROR',message:known?e.message:'服务暂时不可用，请稍后重试。',view:current});
    }
  });
  const heartbeat=setInterval(()=>{for(const s of streams.values())s.res.write(': ping\n\n');},15000);heartbeat.unref();
  const maintenance=setInterval(()=>{store.cleanup();for(const [k,v]of limits)if(now()-v.start>120000)limits.delete(k);for(const s of streams.values()){try{store.get(s.code);}catch{s.res.write('event: expired\ndata: {}\n\n');s.res.end();}}},60000);maintenance.unref();
  const app={server,store,publicOrigin,online,async close(){clearInterval(heartbeat);clearInterval(maintenance);for(const s of streams.values())s.res.end();streams.clear();await new Promise(resolve=>server.close(resolve));store.close();}};
  return app;
}
