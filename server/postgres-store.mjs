import pg from 'pg';
import {randomBytes,randomUUID} from 'node:crypto';
import {hash} from './store.mjs';
import {applyCommand,createRoom,joinRoom,nickname,GameError,AVATARS} from '../shared/engine.mjs';
import {PlayerJournal,journalSchema} from '../shared/fribench-game-kit/journal.mjs';
import {accountAvatar,playerName} from '../shared/fribench-game-kit/avatars.mjs';
import {captureTransition,settleGame} from './journal.mjs';
export class PostgresStore {
  constructor(pool,client,now){Object.assign(this,{pool,client,now,sessions:new Map(),rooms:new Map(),receipts:new Map(),claims:new Map(),writes:[],failed:false});this.journal=new PlayerJournal({pg:true,write:(sql,...values)=>this.write(sql,...values),query:async(sql,...values)=>(await client.query(sql,values)).rows,now});}
  static async open(url,{schema='public',now=Date.now}={}){
    if(!/^[a-z][a-z0-9_]{0,62}$/.test(schema))throw Error('Invalid schema');
    const pool=new pg.Pool({connectionString:url,max:1,connectionTimeoutMillis:5000,statement_timeout:8000});pool.on('error',()=>{});const client=await pool.connect();
    try{
      await client.query(`SET search_path TO "${schema}"`);
      if(!(await client.query("SELECT pg_try_advisory_lock(41043,CASE WHEN $1='public' THEN 10 ELSE hashtext($1) END) AS locked",[schema])).rows[0].locked)throw Error('Another Avalon authority is running');
      await client.query(`CREATE TABLE IF NOT EXISTS avalon_sessions(secret_hash text PRIMARY KEY,id text NOT NULL,name text NOT NULL,avatar text NOT NULL,expires bigint NOT NULL,account_id text);
        CREATE INDEX IF NOT EXISTS avalon_account_sessions ON avalon_sessions(account_id);
        CREATE TABLE IF NOT EXISTS avalon_rooms(code text PRIMARY KEY,state jsonb NOT NULL,updated bigint NOT NULL);
        CREATE TABLE IF NOT EXISTS avalon_receipts(room text REFERENCES avalon_rooms(code) ON DELETE CASCADE,actor text,id text,fingerprint text NOT NULL,version integer NOT NULL,PRIMARY KEY(room,actor,id));
        CREATE TABLE IF NOT EXISTS avalon_guest_claims(account_id text PRIMARY KEY,player_id text UNIQUE NOT NULL,room text NOT NULL,preview_hash text NOT NULL,completed_at timestamptz NOT NULL DEFAULT now());`);
      const store=new PostgresStore(pool,client,now);client.on('error',()=>{store.failed=true;});
      await client.query(journalSchema(true));await client.query("CREATE TABLE IF NOT EXISTS avalon_profile_sources(id TEXT PRIMARY KEY,source TEXT NOT NULL)");
      for(const row of(await client.query("SELECT s.*,COALESCE(p.source,'account') AS profile_source FROM avalon_sessions s LEFT JOIN avalon_profile_sources p ON p.id=s.id")).rows)store.sessions.set(row.secret_hash,{...row,expires:Number(row.expires)});
      for(const row of(await client.query('SELECT * FROM avalon_rooms')).rows)store.rooms.set(row.code,{state:JSON.stringify(row.state),updated:Number(row.updated)});
      for(const row of(await client.query('SELECT * FROM avalon_receipts')).rows)store.receipts.set(JSON.stringify([row.room,row.actor,row.id]),row);
      for(const row of(await client.query('SELECT * FROM avalon_guest_claims')).rows)store.claims.set(row.account_id,row);
      return store;
    }catch(error){client.release(true);await pool.end();throw error;}
  }
  write(sql,...values){if(this.failed)throw Error('Persistence unavailable');this.writes.push({sql,values});}
  transaction(work){const before={sessions:new Map(this.sessions),rooms:new Map(this.rooms),receipts:new Map(this.receipts),claims:new Map(this.claims),length:this.writes.length};try{return work();}catch(error){Object.assign(this,{sessions:before.sessions,rooms:before.rooms,receipts:before.receipts,claims:before.claims});this.writes.length=before.length;throw error;}}
  session(secret){if(!/^[a-f0-9]{64}$/.test(secret??''))return null;const row=this.sessions.get(hash(secret));return row&&row.expires>this.now()?{...row}:null;}
  account(sub){const row=[...this.sessions.values()].find(v=>v.account_id===sub);return row?{...row}:null;}
  personAccount(id){return[...this.sessions.values()].find(v=>v.id===id)?.account_id??null;}
  createSession(account=null){const secret=randomBytes(32).toString('hex'),old=account?this.account(account.sub):null;let name=old?.name??'圆桌旅人';if(!old&&account)try{name=nickname(account.name);}catch{}
    const row={id:old?.id??randomUUID(),secret_hash:hash(secret),name:old?.name??(account?playerName(account.name):name),avatar:old?.avatar??(account?accountAvatar(account.picture):AVATARS[0]),expires:this.now()+30*86400000,account_id:account?.sub??null,profile_source:old?.profile_source??(account?'account':'custom')};
    this.sessions.set(row.secret_hash,row);this.write('INSERT INTO avalon_sessions(secret_hash,id,name,avatar,expires,account_id) VALUES($1,$2,$3,$4,$5,$6)',row.secret_hash,row.id,row.name,row.avatar,row.expires,row.account_id);this.write('INSERT INTO avalon_profile_sources VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET source=excluded.source',row.id,row.profile_source);return{secret,person:{...row}};
  }
  profile(person,name,avatar,source='custom'){name=nickname(name);if(!AVATARS.includes(avatar))throw new GameError('BAD_AVATAR','请选择提供的头像。');for(const[key,row]of this.sessions)if(row.id===person.id)this.sessions.set(key,{...row,name,avatar,profile_source:source});this.write('UPDATE avalon_sessions SET name=$1,avatar=$2 WHERE id=$3',name,avatar,person.id);this.write('INSERT INTO avalon_profile_sources VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET source=excluded.source',person.id,source);return{...person,name,avatar,profile_source:source};}
  get(code){const row=this.rooms.get(code);if(!row||row.updated<this.now()-6*3600000)throw new GameError('ROOM_NOT_FOUND','房间不存在或已超过 6 小时未使用。');return JSON.parse(row.state);}
  save(room){this.rooms.set(room.code,{state:JSON.stringify(room),updated:room.updatedAt});this.write('INSERT INTO avalon_rooms VALUES($1,$2::jsonb,$3) ON CONFLICT(code) DO UPDATE SET state=excluded.state,updated=excluded.updated',room.code,JSON.stringify(room),room.updatedAt);}
  membership(id){return[...this.rooms.values()].filter(r=>r.updated>this.now()-6*3600000).map(r=>JSON.parse(r.state)).find(r=>!r.closed&&r.players.some(p=>p.id===id))??null;}
  create(person,opts){if(this.membership(person.id))throw new GameError('ALREADY_IN_ROOM','你还有一个房间，请先离开或关闭。');let code;do{code=randomBytes(5).toString('hex').toUpperCase();}while(this.rooms.has(code));const room=createRoom(person,opts,{code,now:this.now()});this.save(room);return room;}
  join(code,person){const old=this.membership(person.id);if(old&&old.code!==code)throw new GameError('ALREADY_IN_ROOM','请先离开原房间。');const room=joinRoom(this.get(code),person,{now:this.now()});this.save(room);return room;}
  command(code,person,command,online){
    if(!command||typeof command!=='object'||Array.isArray(command)||Object.keys(command).some(k=>!['id','version','type','payload'].includes(k))||!/^[-a-zA-Z0-9_]{8,80}$/.test(command.id??'')||!Number.isSafeInteger(command.version)||command.version<0||typeof command.type!=='string')throw new GameError('BAD_COMMAND','操作格式不正确。');
    return this.transaction(()=>{const room=this.get(code),key=JSON.stringify([code,person.id,command.id]),fingerprint=hash(JSON.stringify([command.version,command.type,command.payload])),receipt=this.receipts.get(key);
      if(receipt){if(receipt.fingerprint!==fingerprint)throw new GameError('COMMAND_REUSED','操作标识重复，请重新同步。');return{room,replayed:true};}
      if(room.version!==command.version)throw new GameError('STALE_VERSION','牌桌已更新，正在同步，请稍后重试。');
      const next=applyCommand(room,person.id,command.type,command.payload,{now:this.now(),online});captureTransition(this,room,next,this.now());this.save(next);this.receipts.set(key,{room:code,fingerprint,version:next.version});this.write('INSERT INTO avalon_receipts VALUES($1,$2,$3,$4,$5)',code,person.id,command.id,fingerprint,next.version);if(command.type==='profile')this.profile(person,command.payload.name,command.payload.avatar);return{room:next,replayed:false};});
  }
  claimRecord(sub){return this.claims.get(sub);}
  claim(account,guest,room,previewHash){return this.transaction(()=>{
    if(this.claims.has(account.sub)||[...this.claims.values()].some(v=>v.player_id===guest.id))throw new GameError('CLAIM_ALREADY_USED','本账号在阿瓦隆的游客认领机会已使用。');
    if(this.personAccount(guest.id))throw new GameError('NOT_GUEST','座位已归属账号。');if(this.membership(account.id))throw new GameError('ACCOUNT_ROOM_EXISTS','账号已有房间，不能覆盖。');
    this.journal.claim(account.sub,guest.id);
    this.claims.set(account.sub,{account_id:account.sub,player_id:guest.id,room:room?.code??null,preview_hash:previewHash});
    for(const[key,value]of this.sessions)if(value.id===guest.id||value.account_id===account.sub)this.sessions.set(key,{...value,id:guest.id,name:guest.name,avatar:guest.avatar,account_id:account.sub,profile_source:'custom'});
    this.write('INSERT INTO avalon_guest_claims(account_id,player_id,room,preview_hash) VALUES($1,$2,$3,$4)',account.sub,guest.id,room?.code??'',previewHash);
    this.write('UPDATE avalon_sessions SET id=$1,name=$2,avatar=$3,account_id=$4 WHERE id=$1 OR account_id=$4',guest.id,guest.name,guest.avatar,account.sub);this.write('INSERT INTO avalon_profile_sources VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET source=excluded.source',guest.id,'custom');return room;
  });}
  cleanup(){for(const[code,row]of this.rooms)if(row.updated<this.now()-6*3600000){const room=JSON.parse(row.state);settleGame(this,room,room.game?.phase==='finished'?'completed':'aborted',this.now());this.rooms.delete(code);for(const[key,value]of this.receipts)if(value.room===code)this.receipts.delete(key);this.write('DELETE FROM avalon_rooms WHERE code=$1',code);}for(const[key,value]of this.sessions)if(value.expires<this.now()&&!value.account_id){this.sessions.delete(key);this.write('DELETE FROM avalon_sessions WHERE secret_hash=$1',key);}}
  async flush(){if(this.failed)throw Error('Persistence unavailable');if(!this.writes.length)return;try{await this.client.query('BEGIN');for(const row of this.writes)await this.client.query(row.sql,row.values);await this.client.query('COMMIT');this.writes=[];}catch{this.failed=true;try{await this.client.query('ROLLBACK');}catch{}throw Error('PostgreSQL commit failed');}}
  async ping(){if(this.failed)throw Error('Persistence unavailable');await this.client.query('SELECT 1');}
  async close(){this.client.release(this.failed);await this.pool.end();}
}
