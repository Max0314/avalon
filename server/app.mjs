import http from 'node:http';
import {isIP} from 'node:net';
import {createReadStream,statSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {Store} from './store.mjs';
import {Authority} from './authority.mjs';
import {accountClient} from './account.mjs';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {hash} from './store.mjs';
import {playerView,GameError,ROLES,AVATARS} from '../shared/engine.mjs';
import {accountAvatar,playerName,avatarAssetPaths} from '../shared/fribench-game-kit/avatars.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const JSON_LIMIT=8192;
const codePattern=/^[A-F0-9]{10}$/;
const cacheHeaders={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const json=(res,status,value)=>{res.writeHead(status,cacheHeaders);res.end(JSON.stringify(value));};
export function buildApp({repository,dbPath=':memory:',publicOrigin='http://localhost:3000',resolveAccount=accountClient(undefined,publicOrigin),secureCookies=publicOrigin.startsWith('https:'),now=Date.now,root=ROOT,release='dev',rateLimit=true,trustProxy=false}={}) {
  const store=repository??new Store(dbPath,{now}), streams=new Map(),limits=new Map(),accounts=new WeakMap();
  const actor=new Authority(()=>store.flush?.()??Promise.resolve(),()=>{for(const stream of streams.values())stream.res.end();streams.clear();if(process.env.NODE_ENV==='production')setTimeout(()=>process.exit(1),100).unref();});
  const sendJSON=json;
  const respond=(res,status,value)=>actor.publish(()=>sendJSON(res,status,value));
  const cookieName=secureCookies?'__Host-avalon_sid':'avalon_sid';
  const guestCookie=secureCookies?'__Host-avalon_guest':'avalon_guest';
  const previewKey=process.env.FRIBENCH_CLIENT_SECRET??crypto.randomUUID();
  const parsedBodies=new WeakMap();
  const jar=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=')).filter(x=>x.length===2));
  const setCookie=(res,name,value,age=2592000)=>{const old=res.getHeader('Set-Cookie');res.setHeader('Set-Cookie',[...(old?[old].flat():[]),`${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secureCookies?'; Secure':''}`]);};
  const online=code=>new Set([...streams.values()].filter(x=>x.code===code).map(x=>x.person.id));
  function limit(key,max,period=60000) {
    if(!rateLimit)return;
    const value=limits.get(key);
    if(!value||now()-value.start>=period){limits.set(key,{start:now(),count:1});return;}
    if(++value.count>max)throw new GameError('RATE_LIMIT','操作太频繁，请稍后再试。');
  }
  function identify(req,res,create=false) {
    const cookies=jar(req),account=accounts.get(req);
    let secret=cookies[cookieName],person=store.session(secret);
    if(account&&store.account){
      if(person&&!person.account_id&&!cookies[guestCookie])setCookie(res,guestCookie,secret);
      if(person?.account_id!==account.sub){const created=store.createSession(account);secret=created.secret;person=created.person;setCookie(res,cookieName,secret);}
    }else if(person?.account_id)person=null;
    if(!person&&!account){const guest=store.session(cookies[guestCookie]);if(guest&&!guest.account_id){person=guest;secret=cookies[guestCookie];if(create)setCookie(res,cookieName,secret);}}
    if(!person&&create){const created=store.createSession();secret=created.secret;person=created.person;setCookie(res,cookieName,secret);}
    if(!person)throw new GameError('UNAUTHENTICATED','请刷新页面重新建立访客身份。');
    return person;
  }
  function view(room,id){return playerView(room,id,online(room.code));}
  function broadcast(room) {actor.publish(()=>void publish(room));}
  async function publish(room) {
    for(const [key,stream] of streams)if(stream.code===room.code) {
      try {
        const account=await resolveAccount(stream.req.headers.cookie),owner=store.personAccount?.(stream.person.id);
        if(stream.res.writableEnded)continue;
        if(owner&&owner!==account?.sub)throw new Error('Account changed');
        if(!room.players.some(p=>p.id===stream.person.id)){stream.res.write('event: removed\ndata: {}\n\n');stream.res.end();streams.delete(key);continue;}
        const body=JSON.stringify(view(room,stream.person.id));
        if(stream.res.writableLength>262144){stream.res.destroy();streams.delete(key);continue;}
        stream.res.write(`event: snapshot\ndata: ${body}\n\n`);
      }catch{stream.res.end();streams.delete(key);}
    }
  }
  async function body(req) {
    if(parsedBodies.has(req))return parsedBodies.get(req);
    if(!(req.headers['content-type']||'').startsWith('application/json'))throw new GameError('BAD_CONTENT_TYPE','请使用正确的请求格式。');
    if(Number(req.headers['content-length']||0)>JSON_LIMIT)throw new GameError('BODY_TOO_LARGE','请求内容过大。');
    let bytes=0;const parts=[];
    for await(const part of req){bytes+=part.length;if(bytes>JSON_LIMIT)throw new GameError('BODY_TOO_LARGE','请求内容过大。');parts.push(part);}
    try {const value=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{throw new GameError('BAD_JSON','请求内容无法读取。');}
  }
  function exact(data,keys){if(Object.keys(data).some(k=>!keys.includes(k)))throw new GameError('BAD_COMMAND','请求包含不支持的参数。');}
  async function handle(req,res){
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('X-Robots-Tag','noindex, nofollow');
    res.setHeader('Permissions-Policy','camera=(self), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https://auth.fribench.cn; connect-src 'self' https://auth.fribench.cn; font-src 'self'; media-src 'self' blob:; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'");
    let person,code;
    try {
      const url=new URL(req.url,'http://localhost');const path=url.pathname;
      if(path==='/healthz'){sendJSON(res,actor.failed?503:200,{ok:!actor.failed,service:'avalon',release});return;}
      if(path==='/readyz'){if(actor.failed)throw Error('Persistence unavailable');if(store.ping)await store.ping();else store.db.prepare('SELECT 1').get();sendJSON(res,200,{ok:true});return;}
      if(path.startsWith('/api/')) {
        accounts.set(req,await resolveAccount(req.headers.cookie));
        if(req.headers['sec-fetch-site']==='cross-site')throw new GameError('BAD_ORIGIN','请从本站重新打开游戏。');
        if(!['GET','POST'].includes(req.method))throw new GameError('BAD_METHOD','不支持这个请求方法。');
        if(req.method==='POST'&&req.headers.origin!==app.publicOrigin)throw new GameError('BAD_ORIGIN','页面来源无法确认，请从游戏首页重新打开。');
        const forwarded=req.headers['x-real-ip'],clientIP=trustProxy&&typeof forwarded==='string'&&isIP(forwarded)?forwarded:req.socket.remoteAddress;
        limit(`ip:${clientIP}`,900);
        if(path==='/api/session'&&req.method==='GET') {
          limit(`session:${clientIP}`,90);person=identify(req,res,true);
          const current=store.membership(person.id),account=accounts.get(req);
          if(account&&person.profile_source!=='custom'&&(!current?.game||current.game.phase==='finished')){const name=playerName(account.name),avatar=accountAvatar(account.picture);if(person.name!==name||person.avatar!==avatar){if(current){const r=store.command(current.code,person,{id:crypto.randomUUID(),version:current.version,type:'profile',payload:{name,avatar}},online(current.code));Object.assign(current,r.room);broadcast(r.room);}person=store.profile(person,name,avatar,'account');}}
          if(account)store.journal.profile(account.sub,playerName(account.name),accountAvatar(account.picture));respond(res,200,{person:{id:person.id,name:person.name,avatar:person.avatar},room:current?view(current,person.id):null});return;
        }
        person=identify(req,res);
        if(path==='/api/account'&&req.method==='GET'){const account=accounts.get(req);respond(res,200,{signedIn:Boolean(account),profile:account?{name:playerName(account.name),avatar:accountAvatar(account.picture)}:null,guestClaimAvailable:account?!store.claimRecord?.(account.sub):false});return;}
        if(path.startsWith('/api/player')){
          const account=accounts.get(req),owner={accountId:account?.sub,seatId:person.id};
          if(path==='/api/player/privacy'&&req.method==='POST'){const data=await body(req);exact(data,['publicRanking']);if(!account)throw new GameError('UNAUTHENTICATED','请先登录账号。');if(typeof data.publicRanking!=='boolean')throw new GameError('BAD_COMMAND','请选择是否公开排行。');store.journal.profile(account.sub,playerName(account.name),accountAvatar(account.picture));store.journal.privacy(account.sub,data.publicRanking);respond(res,200,{saved:true});return;}
          if(req.method!=='GET')throw new GameError('BAD_METHOD','此接口只能读取统计。');
          if(path==='/api/player/companions'){respond(res,200,{entries:await store.journal.companions(owner)});return;}
          const detail=path.match(/^\/api\/player\/matches\/([a-f0-9-]{36})$/);
          if(detail){const record=await store.journal.detail(owner,detail[1]);if(!record)throw new GameError('NOT_FOUND','没有可访问的对局。');respond(res,200,record);return;}
          const page=Number(url.searchParams.get('page')??0),period=url.searchParams.get('period')??'all',mode=url.searchParams.get('mode')??'all',metric=url.searchParams.get('metric')??'wins';
          if(!Number.isSafeInteger(page)||page<0||page>100000||!['all','month'].includes(period)||!['all','online'].includes(mode)||!['wins','games','winRate'].includes(metric))throw new GameError('BAD_COMMAND','请选择有效的统计条件。');
          if(path==='/api/player'){respond(res,200,await store.journal.read(owner,{page,period,mode}));return;}
          if(path==='/api/player/leaderboard'){respond(res,200,await store.journal.leaderboard({period,mode:'online',metric}));return;}
          throw new GameError('NOT_FOUND','接口不存在。');
        }
        if(['/api/account/guest-preview','/api/account/guest-claim'].includes(path)&&req.method==='POST'){
          const account=accounts.get(req);if(!account||!store.claim)throw new GameError('LOGIN_REQUIRED','请先登录账号。');
          const data=await body(req),claim=store.claimRecord(account.sub),isPreview=path.endsWith('guest-preview');exact(data,isPreview?[]:['previewToken','confirm']);
          const sign=payload=>createHmac('sha256',previewKey).update(JSON.stringify([account.sub,payload])).digest('hex');
          const guest=store.session(jar(req)[guestCookie]),room=guest&&!guest.account_id?store.membership(guest.id):null,records=guest&&!guest.account_id?await store.journal.guestCount(guest.id):0;
          if(isPreview){
            if(claim)throw new GameError('CLAIM_ALREADY_USED','本账号在阿瓦隆的游客认领机会已使用。');
            if(!guest||guest.account_id||!room&&!records)throw new GameError('NO_GUEST_ROOM','此浏览器没有可认领的游客牌桌或战绩。');if(store.membership(person.id))throw new GameError('ACCOUNT_ROOM_EXISTS','账号已有房间，不能覆盖。');
            const payload=Buffer.from(JSON.stringify({guest:hash(guest.secret_hash),room:room?.code??null,version:room?.version??0,records,expires:now()+30*60000})).toString('base64url');respond(res,200,{previewToken:payload+'.'+sign(payload),code:room?.code??null,name:guest.name,players:room?.players.length??0,records,consumesOpportunity:false});return;
          }
          if(data.confirm!==true||typeof data.previewToken!=='string'||data.previewToken.length>2000)throw new GameError('CONFIRM_REQUIRED','请预览后明确确认认领。');
          const[payload,signature,...rest]=data.previewToken.split('.');if(!payload||!signature||rest.length||!timingSafeEqual(Buffer.from(hash(sign(payload)),'hex'),Buffer.from(hash(signature),'hex')))throw new GameError('PREVIEW_EXPIRED','预览已失效，请重新预览。');
          const preview=JSON.parse(Buffer.from(payload,'base64url').toString());if(preview.expires<=now())throw new GameError('PREVIEW_EXPIRED','预览已过期。');
          if(claim){if(claim.preview_hash===hash(data.previewToken)){respond(res,200,{claimed:true,roomId:claim.room||null});return;}throw new GameError('CLAIM_ALREADY_USED','本服务认领机会已使用。');}
          if(!guest||guest.account_id||preview.guest!==hash(guest.secret_hash)||preview.room!==(room?.code??null)||preview.version!==(room?.version??0)||preview.records!==records)throw new GameError('PREVIEW_EXPIRED','牌桌已变化，请重新预览。');
          store.claim({...account,id:person.id},guest,room,hash(data.previewToken));actor.publish(()=>{for(const stream of streams.values())if(stream.person.id===guest.id||stream.person.id===person.id)stream.res.end();});setCookie(res,guestCookie,'',0);respond(res,200,{claimed:true,roomId:room?.code??null});return;
        }
        if(path==='/api/profile'&&req.method==='POST') {
          let data=await body(req);const account=accounts.get(req);
          if(data.useAccount===true){exact(data,['useAccount']);if(!account)throw new GameError('UNAUTHENTICATED','请先登录账号。');data={name:playerName(account.name),avatar:accountAvatar(account.picture)};}else exact(data,['name','avatar']);
          const current=store.membership(person.id);if(current?.game&&current.game.phase!=='finished')throw new GameError('GAME_RUNNING','本局昵称和头像已固定，请在大厅或结算后修改。');
          if(current){const result=store.command(current.code,person,{id:crypto.randomUUID(),version:current.version,type:'profile',payload:data},online(current.code));broadcast(result.room);}
          const p=store.profile(person,data.name,data.avatar,(await body(req)).useAccount===true?'account':'custom');respond(res,200,{person:{id:p.id,name:p.name,avatar:p.avatar}});return;
        }
        if(path==='/api/rooms'&&req.method==='POST') {
          limit(`create:${person.id}`,6);limit(`create-ip:${clientIP}`,15);
          const data=await body(req);exact(data,['settings']);const room=store.create(person,data.settings);respond(res,201,{view:view(room,person.id)});return;
        }
        const match=path.match(/^\/api\/rooms\/([A-F0-9]{10})(?:\/(join|commands|events))?$/);
        if(!match)throw new GameError('NOT_FOUND','接口不存在。');
        code=match[1];const action=match[2];
        if(action==='join'&&req.method==='POST'){
          exact(await body(req),[]);limit(`join:${person.id}`,30);const room=store.join(code,person);broadcast(room);respond(res,200,{view:view(room,person.id)});return;
        }
        const room=store.get(code);
        if(action!=='commands'&&!room.players.some(p=>p.id===person.id))throw new GameError('NOT_MEMBER','请先通过邀请加入房间。');
        if(action==='events'&&req.method==='GET') {
          if([...streams.values()].filter(s=>s.person.id===person.id).length>=4)throw new GameError('TOO_MANY_TABS','打开的牌桌过多，请关闭一些页面再试。');
          res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
          const key=crypto.randomUUID();streams.set(key,{code,person,res,req});res.write(': connected\n\n');broadcast(room);
          req.on('close',()=>{streams.delete(key);try{broadcast(store.get(code));}catch{}});return;
        }
        if(!action&&req.method==='GET'){respond(res,200,{view:view(room,person.id)});return;}
        if(action==='commands'&&req.method==='POST') {
          limit(`command:${person.id}`,180);
          const command=await body(req),result=store.command(code,person,command,online(code));
          if(!result.replayed)broadcast(result.room);
          respond(res,200,{view:result.room.players.some(p=>p.id===person.id)?view(result.room,person.id):null,left:!result.room.players.some(p=>p.id===person.id),replayed:result.replayed});return;
        }
        throw new GameError('NOT_FOUND','接口不存在。');
      }
      if(!['GET','HEAD'].includes(req.method)){json(res,405,{message:'不支持这个请求方法。'});return;}
      let file,mime;
      const fixed={'/':['.dist/index.html','text/html; charset=utf-8'],'/index.html':['.dist/index.html','text/html; charset=utf-8'],'/assets/app.js':['.dist/app.js','text/javascript; charset=utf-8'],'/assets/styles.css':['.dist/styles.css','text/css; charset=utf-8'],'/manifest.json':['manifest.json','application/manifest+json'],'/sw.js':['.dist/sw.js','text/javascript; charset=utf-8'],'/licenses.txt':['.dist/THIRD-PARTY-LICENSES.txt','text/plain; charset=utf-8']};
      if(/^\/assets\/app-[a-f0-9]{16}\.js$/.test(path)){file='.dist/app.js';mime='text/javascript; charset=utf-8';}
      else if(/^\/assets\/styles-[a-f0-9]{16}\.css$/.test(path)){file='.dist/styles.css';mime='text/css; charset=utf-8';}
      else if(fixed[path]) [file,mime]=fixed[path];
      else if(avatarAssetPaths.includes(path)){file=path.slice(1);mime='image/webp';}
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
      respond(res,status,{code:known?e.code:'INTERNAL_ERROR',message:known?e.message:'服务暂时不可用，请稍后重试。',view:current});
    }
  }
  const server=http.createServer((req,res)=>{const pending=(async()=>{
    if(req.url.startsWith('/api/')){if(req.method==='POST'){try{parsedBodies.set(req,await body(req));}catch(error){sendJSON(res,400,{code:error.code??'BAD_JSON',message:error.message});return;}}return actor.run(()=>handle(req,res));}
    return handle(req,res);
  })();void pending.catch(()=>{if(!res.headersSent)sendJSON(res,503,{code:'PERSISTENCE_UNAVAILABLE',message:'服务暂时无法保存，请稍后重试。'});else res.end();});});
  server.requestTimeout=15000;server.headersTimeout=10000;
  const heartbeat=setInterval(()=>{for(const s of streams.values())void resolveAccount(s.req.headers.cookie).then(account=>{const owner=store.personAccount?.(s.person.id);if(owner&&owner!==account?.sub)s.res.end();else s.res.write(': ping\n\n');}).catch(()=>s.res.end());},15000);heartbeat.unref();
  const maintenance=setInterval(()=>{void actor.run(()=>{store.cleanup();for(const [k,v]of limits)if(now()-v.start>120000)limits.delete(k);for(const s of streams.values()){try{store.get(s.code);}catch{actor.publish(()=>{s.res.write('event: expired\ndata: {}\n\n');s.res.end();});}}}).catch(()=>{});},60000);maintenance.unref();
  const app={server,store,publicOrigin,online,async close(){clearInterval(heartbeat);clearInterval(maintenance);for(const s of streams.values())s.res.end();streams.clear();await new Promise(resolve=>server.close(resolve));await actor.run(()=>{}).catch(()=>{});await store.close();}};
  return app;
}
