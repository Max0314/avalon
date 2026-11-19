import '../shared/fribench-game-kit/verify.mjs';
import {build} from 'esbuild';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ROLES} from '../shared/engine.mjs';
import {coverArt,musicPaths,effectPaths,portraitPaths,sceneArt,previousMediaPaths} from '../shared/media.mjs';
import {avatarAssetPaths} from '../shared/fribench-game-kit/avatars.mjs';
await mkdir('.dist',{recursive:true});
await build({entryPoints:['web/app.mjs'],bundle:true,format:'esm',target:['es2022'],outfile:'.dist/app.js',minify:true,legalComments:'eof'});
let styles=(await Promise.all(['web/styles.css','shared/fribench-game-kit/journal.css','web/handbook.css','web/round-table.css','web/cinematics.css','web/viewport.css','web/experience.css'].map(file=>readFile(file,'utf8')))).join('\n');
for(let count=5;count<=10;count++)for(let i=0;i<count;i++){
  const angle=-Math.PI/2+2*Math.PI*i/count;
  styles+=`\n.round-table[data-count="${count}"] .seat:nth-of-type(${i+2}){left:${(50+37*Math.cos(angle)).toFixed(3)}%;top:${(50+37*Math.sin(angle)).toFixed(3)}%;}`;
}
await writeFile('.dist/styles.css',styles,'utf8');
const art=[...new Set(Object.values(ROLES).map(r=>'/cards/'+r.image)),'/cards/quest_success.png','/cards/quest_fail.png','/icons/lady_token.png'];
const files=new Set([...(await readdir('cards')).map(f=>'cards/'+f),...(await readdir('icons')).map(f=>'icons/'+f)]);
const hash=createHash('sha256').update(await readFile('.dist/app.js')).update(styles).update(await readFile('index.html')).update(await readFile('manifest.json'));
const template=await readFile('sw.js','utf8');hash.update(template);
for(const url of [...art,'/icons/app-icon.png']){const path=url.slice(1);if(!files.has(path))throw new Error(`Missing asset or case mismatch: ${path}`);const bytes=await readFile(path);if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error(`Invalid PNG: ${path}`);hash.update(bytes);}
for(const url of avatarAssetPaths){art.push(url);hash.update(await readFile(url.slice(1)));}
for(const url of [coverArt,...portraitPaths,...sceneArt,...musicPaths,...effectPaths]){
  const bytes=await readFile(url.slice(1));
  art.push(url);
  hash.update(bytes);
}
const digest=hash.digest('hex').slice(0,16);
const worker=template.replaceAll('__BUILD_ID__',digest).replace('__ART_FILES__',JSON.stringify(art)).replace('__PREVIOUS_MEDIA__',JSON.stringify(previousMediaPaths));
await writeFile('.dist/index.html',(await readFile('index.html','utf8')).replace('/assets/app.js',`/assets/app-${digest}.js`).replace('/assets/styles.css',`/assets/styles-${digest}.css`),'utf8');
await writeFile('.dist/sw.js',worker,'utf8');
const licenses=await Promise.all([['qrcode','license'],['jsqr','LICENSE']].map(async([name,file])=>`${name}\n${await readFile(`node_modules/${name}/${file}`,'utf8')}\n`));
await writeFile('.dist/THIRD-PARTY-LICENSES.txt',licenses.join('\n'),'utf8');
console.log('中文客户端与二维码依赖已打包，运行时无需外部 CDN。');
