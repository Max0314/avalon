import {buildApp} from './app.mjs';
process.umask(0o077);
const origin=process.env.PUBLIC_ORIGIN||'http://localhost:3000';
if(process.env.NODE_ENV==='production'&&!origin.startsWith('https://'))throw new Error('Production requires an HTTPS public origin');
const app=buildApp({dbPath:process.env.DATABASE_PATH||'data/avalon.sqlite',publicOrigin:origin,release:process.env.RELEASE_SHA||'dev',trustProxy:process.env.TRUST_PROXY==='1'});
app.server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log(JSON.stringify({event:'listening',service:'avalon',port:app.server.address().port})));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>app.close().then(()=>process.exit(0)).catch(()=>process.exit(1)));
