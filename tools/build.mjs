import {build} from 'esbuild';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ROLES} from '../shared/engine.mjs';
await mkdir('.dist',{recursive:true});
await build({entryPoints:['web/app.mjs'],bundle:true,format:'esm',target:['es2022'],outfile:'.dist/app.js',minify:true,legalComments:'eof'});
let styles=await readFile('web/styles.css','utf8');
for(let count=5;count<=10;count++)for(let i=0;i<count;i++){
  const angle=-Math.PI/2+2*Math.PI*i/count;
  styles+=`\n.round-table[data-count="${count}"] .seat:nth-of-type(${i+2}){left:${(50+36*Math.cos(angle)).toFixed(3)}%;top:${(50+38*Math.sin(angle)).toFixed(3)}%;}`;
}
await writeFile('.dist/styles.css',styles,'utf8');
const art=[...new Set(Object.values(ROLES).map(r=>'/cards/'+r.image)),'/cards/quest_success.png','/cards/quest_fail.png','/icons/lady_token.png'];
const files=new Set([...(await readdir('cards')).map(f=>'cards/'+f),...(await readdir('icons')).map(f=>'icons/'+f)]);
const hash=createHash('sha256').update(await readFile('.dist/app.js')).update(styles).update(await readFile('index.html')).update(await readFile('manifest.json'));
const template=await readFile('sw.js','utf8');hash.update(template);
for(const url of [...art,'/icons/app-icon.png']){const path=url.slice(1);if(!files.has(path))throw new Error(`Missing asset or case mismatch: ${path}`);const bytes=await readFile(path);if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error(`Invalid PNG: ${path}`);hash.update(bytes);}
const digest=hash.digest('hex').slice(0,16);
const worker=template.replace('__BUILD_ID__',digest).replace('__ART_FILES__',JSON.stringify(art));
await writeFile('.dist/sw.js',worker,'utf8');
const licenses=await Promise.all([['qrcode','license'],['jsqr','LICENSE']].map(async([name,file])=>`${name}\n${await readFile(`node_modules/${name}/${file}`,'utf8')}\n`));
await writeFile('.dist/THIRD-PARTY-LICENSES.txt',licenses.join('\n'),'utf8');
console.log('中文客户端与二维码依赖已打包，运行时无需外部 CDN。');
