import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes} from 'node:crypto';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {applyCommand,createRoom,joinRoom,nickname,GameError,AVATARS} from '../shared/engine.mjs';

export const hash=value=>createHash('sha256').update(value).digest('hex');
export class Store {
  constructor(path=':memory:',{now=Date.now}={}) {
    this.now=now;
    if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, secret_hash TEXT UNIQUE NOT NULL, name TEXT NOT NULL, avatar TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, state TEXT NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts (room TEXT NOT NULL, actor TEXT NOT NULL, id TEXT NOT NULL, fingerprint TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(room,actor,id), FOREIGN KEY(room) REFERENCES rooms(code) ON DELETE CASCADE);`);
    if(path!==':memory:')chmodSync(path,0o600);
  }
  session(secret) {
    if(!secret||!/^[a-f0-9]{64}$/.test(secret))return null;
    const row=this.db.prepare('SELECT id,name,avatar,expires FROM sessions WHERE secret_hash=? AND expires>?').get(hash(secret),this.now());
    return row?{...row}:null;
  }
  createSession() {
    const secret=randomBytes(32).toString('hex'),id=crypto.randomUUID(),name='圆桌旅人',avatar=AVATARS[0];
    this.db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?)').run(id,hash(secret),name,avatar,this.now()+30*86400000);
    return {secret,person:{id,name,avatar}};
  }
  profile(person,name,avatar) {
    name=nickname(name);if(!AVATARS.includes(avatar))throw new GameError('BAD_AVATAR','请选择提供的头像。');
    this.db.prepare('UPDATE sessions SET name=?,avatar=?,expires=? WHERE id=?').run(name,avatar,this.now()+30*86400000,person.id);
    return {...person,name,avatar};
  }
  get(code) {
    const row=this.db.prepare('SELECT state,updated FROM rooms WHERE code=?').get(code);
    if(!row||row.updated<this.now()-6*3600000)throw new GameError('ROOM_NOT_FOUND','房间不存在或已超过 6 小时未使用。');
    return JSON.parse(row.state);
  }
  save(room) {this.db.prepare('INSERT INTO rooms VALUES (?,?,?) ON CONFLICT(code) DO UPDATE SET state=excluded.state,updated=excluded.updated').run(room.code,JSON.stringify(room),room.updatedAt);}
  membership(id) {
    return this.db.prepare('SELECT state FROM rooms WHERE updated>?').all(this.now()-6*3600000).map(r=>JSON.parse(r.state)).find(r=>!r.closed&&r.players.some(p=>p.id===id))||null;
  }
  create(person,opts) {
    const current=this.membership(person.id);
    if(current)throw new GameError('ALREADY_IN_ROOM','你还有一个房间，请先回到原房间，离开或关闭后再创建。');
    let code;do{code=randomBytes(5).toString('hex').toUpperCase();}while(this.db.prepare('SELECT 1 FROM rooms WHERE code=?').get(code));
    const room=createRoom(person,opts,{code,now:this.now()});this.save(room);return room;
  }
  join(code,person) {
    const current=this.membership(person.id);
    if(current&&current.code!==code)throw new GameError('ALREADY_IN_ROOM','你还在另一个房间，请先离开原房间。');
    const room=joinRoom(this.get(code),person,{now:this.now()});this.save(room);return room;
  }
  command(code,person,command,online) {
    if(!command||typeof command!=='object'||Array.isArray(command)||Object.keys(command).some(k=>!['id','version','type','payload'].includes(k))||!/^[-a-zA-Z0-9_]{8,80}$/.test(command.id||'')||!Number.isSafeInteger(command.version)||command.version<0||typeof command.type!=='string')throw new GameError('BAD_COMMAND','操作格式不正确。');
    const fingerprint=hash(JSON.stringify([command.version,command.type,command.payload]));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const room=this.get(code);
      const receipt=this.db.prepare('SELECT fingerprint,version FROM receipts WHERE room=? AND actor=? AND id=?').get(code,person.id,command.id);
      if(receipt) {
        if(receipt.fingerprint!==fingerprint)throw new GameError('COMMAND_REUSED','操作标识重复，请重新同步牌桌。');
        this.db.exec('COMMIT');return {room,replayed:true};
      }
      if(room.version!==command.version)throw new GameError('STALE_VERSION','牌桌已更新，正在同步，请稍后重试。');
      const next=applyCommand(room,person.id,command.type,command.payload,{now:this.now(),online});
      this.save(next);
      this.db.prepare('INSERT INTO receipts VALUES (?,?,?,?,?)').run(code,person.id,command.id,fingerprint,next.version);
      if(command.type==='profile')this.profile(person,command.payload.name,command.payload.avatar);
      this.db.exec('COMMIT');return {room:next,replayed:false};
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  cleanup() {
    this.db.prepare('DELETE FROM rooms WHERE updated<?').run(this.now()-6*3600000);
    this.db.prepare('DELETE FROM sessions WHERE expires<?').run(this.now());
  }
  close(){this.db.close();}
}
