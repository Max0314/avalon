// Built with a content-derived version; never cache an API response or a room view.
const CACHE='fribench-avalon-__BUILD_ID__';
const SHELL=['/','/assets/app.js','/assets/styles.css','/manifest.json','/icons/app-icon.png'];
const ART=__ART_FILES__;
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('fribench-avalon-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const req=event.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/_fribench/')||url.pathname==='/healthz'||url.pathname==='/readyz')return;
  if(req.mode==='navigate')event.respondWith(fetch(req).then(async response=>{if(response.status>=500){const shell=await caches.match('/');if(shell)return shell;}if(response.ok)(await caches.open(CACHE)).put('/',response.clone());return response;}).catch(()=>caches.match('/')));
  else event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(async response=>{if(response.ok&&(SHELL.includes(url.pathname)||ART.includes(url.pathname)))(await caches.open(CACHE)).put(req,response.clone());return response;})));
});
self.addEventListener('message',event=>{
  if(event.data?.type!=='PREPARE_OFFLINE')return;
  const port=event.ports[0];
  event.waitUntil((async()=>{try{const cache=await caches.open(CACHE),files=[...SHELL,...ART];let done=0;
    for(const file of files){if(!await cache.match(file)){const response=await fetch(file,{cache:'reload'});if(!response.ok)throw new Error('Asset unavailable');await cache.put(file,response);}port?.postMessage({type:'progress',done:++done,total:files.length});}
    port?.postMessage({type:'done'});
  }catch{port?.postMessage({type:'error'});}})());
});
