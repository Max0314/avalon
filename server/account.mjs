export function accountClient(secret=process.env.FRIBENCH_CLIENT_SECRET,origin='https://avalon.fribench.cn',fetcher=fetch){
  const cache=new Map();return async header=>{
    const cookie=header?.split(';').map(v=>v.trim()).find(v=>v.startsWith('__Host-fribench_avalon='));
    if(!cookie||!/^__Host-fribench_avalon=[\w-]{43}$/.test(cookie))return null;if(!secret)throw Error('Account verification unavailable');
    const old=cache.get(cookie);if(old&&old.expires>Date.now())return old.pending;
    const entry={expires:Date.now()+5000,pending:(async()=>{const response=await fetcher(process.env.FRIBENCH_IDENTITY_ENDPOINT??'http://fribench-services-api-1:8080/internal/identity',{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{host:new URL(origin).host,'x-fribench-app':'avalon',authorization:'Basic '+Buffer.from('fribench-avalon:'+secret).toString('base64'),cookie}});if(!response.ok)throw Error('Account verification unavailable');const value=await response.json();if(!value.authenticated)return null;if(typeof value.sub!=='string'||!value.sub)throw Error('Invalid identity');return{sub:value.sub,name:value.name??'圆桌旅人'};})()};
    if(cache.size>=256)cache.clear();cache.set(cookie,entry);try{return await entry.pending;}catch(error){cache.delete(cookie);throw error;}
  };
}
