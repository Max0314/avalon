import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(await readFile(new URL('./source.json',import.meta.url),'utf8'));
if(manifest.version!==1||manifest.avatars!==33||Object.keys(manifest.artwork).length!==33)throw Error('Invalid shared avatar contract');
for(const [name,expected] of Object.entries({...manifest.hashes,...manifest.artwork})) {
  if(!/^(?:[a-z0-9.-]+|\.\.\/\.\.\/(?:apps\/web\/public\/)?avatars\/v1\/[a-z0-9-]+\.webp)$/.test(name))throw Error('Invalid shared asset path');
  const bytes=await readFile(new URL(name,import.meta.url));
  if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('Shared game kit drift: '+name);
}
console.log('Shared game kit and 33 avatar hashes verified');
