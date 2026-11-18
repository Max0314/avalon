// Built with a content-derived version; never cache an API response or a room view.
const CACHE='fribench-avalon-__BUILD_ID__';
const SHELL=['/','/assets/app-__BUILD_ID__.js','/assets/styles-__BUILD_ID__.css','/manifest.json','/icons/app-icon.png','/art/camelot.webp'];
const ART=__ART_FILES__;
const READY='/__avalon_offline_ready__';
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await cache.addAll(SHELL);
  const legacy=ART.filter(path=>path.startsWith('/cards/')||path.startsWith('/icons/')||path.startsWith('/avatars/'));
  for(const key of await caches.keys()){
    if(!key.startsWith('fribench-avalon-')||key===CACHE)continue;
    const old=await caches.open(key), ready=await old.match(READY);
    const saved=await Promise.all(legacy.map(path=>old.match(path)));
    if(!ready&&!saved.every(Boolean))continue;
    await Promise.all(legacy.map((path,index)=>saved[index]?cache.put(path,saved[index]):Promise.resolve()));
    await prepare(cache);
    break;
  }
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('fribench-avalon-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const req=event.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/_fribench/')||url.pathname==='/healthz'||url.pathname==='/readyz')return;
  if(req.mode==='navigate'){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE);
      try{
        const response=await fetch(req);
        return response.status>=500?(await cache.match('/'))??response:response;
      }catch{
        return (await cache.match('/'))??Response.error();
      }
    })());
  }
  else if(SHELL.includes(url.pathname)||ART.includes(url.pathname)){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE),hit=await cache.match(req);
      if(hit){
        const range=url.pathname.startsWith('/audio/')&&req.headers.get('Range');
        return range?audioRange(hit,range):hit;
      }
      const response=await fetch(req);
      if(response.status===200)await cache.put(req,response.clone());
      return response;
    })());
  }
});
async function audioRange(hit,range){
  const match=/^bytes=(\d*)-(\d*)$/.exec(range);
  if(!match)return hit;
  const bytes=await hit.arrayBuffer();
  const [,first,last]=match;
  const start=first?Number(first):Math.max(0,bytes.byteLength-Number(last));
  const end=first&&last?Math.min(bytes.byteLength-1,Number(last)):bytes.byteLength-1;
  if(start>end)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${bytes.byteLength}`}});
  return new Response(bytes.slice(start,end+1),{status:206,headers:{
    'Content-Type':'audio/mpeg','Content-Length':String(end-start+1),'Accept-Ranges':'bytes',
    'Content-Range':`bytes ${start}-${end}/${bytes.byteLength}`
  }});
}
async function prepare(cache,port){
  const files=[...new Set([...SHELL,...ART])];
  let done=0;
  for(const file of files){
    if(!await cache.match(file)){
      const response=await fetch(file,{cache:'reload'});
      if(!response.ok)throw new Error('Asset unavailable');
      await cache.put(file,response);
    }
    port?.postMessage({type:'progress',done:++done,total:files.length});
  }
  await cache.put(READY,new Response('ready'));
}
self.addEventListener('message',event=>{
  if(event.data?.type!=='PREPARE_OFFLINE')return;
  const port=event.ports[0];
  event.waitUntil(caches.open(CACHE).then(cache=>prepare(cache,port))
    .then(()=>port?.postMessage({type:'done'}),()=>port?.postMessage({type:'error'})));
});
