import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync,existsSync,chmodSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
process.umask(0o077);
const source=process.env.DATABASE_PATH||'data/avalon.sqlite',output=process.argv[2];
if(!output)throw new Error('Specify a new private SQLite snapshot path.');
if(resolve(source)===resolve(output)||existsSync(output))throw new Error('Snapshot must not overwrite an existing file.');
mkdirSync(dirname(resolve(output)),{recursive:true,mode:0o700});
const db=new DatabaseSync(source,{readOnly:true});
try{await backup(db,output);chmodSync(output,0o600);console.log('Consistent SQLite snapshot completed.');}finally{db.close();}
