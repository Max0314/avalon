import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(await readFile(new URL('./source.json',import.meta.url),'utf8'));
if(manifest.version!==2||manifest.avatars!==35||manifest.persistedAvatars!==47||Object.keys(manifest.artwork).length!==68)throw Error('Invalid shared avatar contract');
for(const [name,expected] of Object.entries({...manifest.hashes,...manifest.artwork})) {
  if(!/^(?:[a-z0-9.-]+|\.\.\/\.\.\/(?:apps\/web\/public\/)?avatars\/v[12]\/[a-z0-9-]+\.webp)$/.test(name))throw Error('Invalid shared asset path');
  const bytes=await readFile(new URL(name,import.meta.url));
  if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('Shared game kit drift: '+name);
}
console.log('Shared game kit, 35 selectable avatars and 33 legacy assets verified');
