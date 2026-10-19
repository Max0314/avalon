// Shared player journal v1. The game authority supplies results; browsers never do.
// Each game owns these tables in its own database/role. No dependency on room TTL.
export function journalSchema(pg = false) {
  return `CREATE TABLE IF NOT EXISTS player_profiles(account_id TEXT PRIMARY KEY,name TEXT NOT NULL,avatar TEXT NOT NULL,public_ranking INTEGER NOT NULL DEFAULT 0 CHECK(public_ranking IN (0,1)));
    CREATE TABLE IF NOT EXISTS player_matches(id TEXT PRIMARY KEY,started_at BIGINT NOT NULL,ended_at BIGINT NOT NULL,status TEXT NOT NULL,mode TEXT NOT NULL,eligible INTEGER NOT NULL,data ${pg ? 'JSONB' : 'TEXT'} NOT NULL);
    CREATE TABLE IF NOT EXISTS player_match_members(match_id TEXT NOT NULL REFERENCES player_matches(id),seat_id TEXT NOT NULL,account_id TEXT,name TEXT NOT NULL,avatar TEXT NOT NULL,bot INTEGER NOT NULL,won INTEGER NOT NULL,score REAL,place INTEGER,side TEXT,role TEXT,PRIMARY KEY(match_id,seat_id));
    CREATE INDEX IF NOT EXISTS player_members_account ON player_match_members(account_id,match_id);
    CREATE INDEX IF NOT EXISTS player_members_seat ON player_match_members(seat_id,match_id);
    CREATE INDEX IF NOT EXISTS player_matches_time ON player_matches(ended_at DESC,id);
    CREATE INDEX IF NOT EXISTS player_members_match ON player_match_members(match_id);`;
}
const number = v => Number(v ?? 0);
const summary = r => ({games:number(r?.games),wins:number(r?.wins),aborted:number(r?.aborted),winRate:number(r?.games) ? Math.round(1000*number(r.wins)/number(r.games))/10 : null,averageScore:r?.average_score == null ? null : Math.round(number(r.average_score)*10)/10});
export const MIN_RANKED_GAMES = 10;
export class PlayerJournal {
  constructor({write,query,pg=false,now=Date.now}) {Object.assign(this,{write,query,pg,now});}
  sql(sql) {return this.pg ? sql : sql.replace(/\$\d+/g,'?');}
  put(sql,...values) {this.write(this.sql(sql),...values);}
  rows(sql,...values) {return this.query(this.sql(sql),...values);}
  profile(accountId,name,avatar) {
    if(accountId)this.put('INSERT INTO player_profiles(account_id,name,avatar) VALUES($1,$2,$3) ON CONFLICT(account_id) DO UPDATE SET name=excluded.name,avatar=excluded.avatar',accountId,name,String(avatar));
  }
  privacy(accountId,enabled) {this.put('UPDATE player_profiles SET public_ranking=$1 WHERE account_id=$2',enabled?1:0,accountId);}
  record(match) {
    if(!match.id || !['completed','aborted'].includes(match.status) || !Array.isArray(match.players))throw Error('Invalid authoritative result');
    const {players,...data}=match;
    this.put('INSERT INTO player_matches(id,started_at,ended_at,status,mode,eligible,data) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING',match.id,match.startedAt,match.endedAt,match.status,match.mode,match.eligible?1:0,JSON.stringify(data));
    for(const p of players) {
      this.put('INSERT INTO player_match_members(match_id,seat_id,account_id,name,avatar,bot,won,score,place,side,role) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(match_id,seat_id) DO NOTHING',match.id,p.seatId,p.accountId??null,p.name,String(p.avatar),p.bot?1:0,p.won?1:0,p.score??null,p.place??null,p.side??null,p.role??null);
    }
  }
  claim(accountId,seatId) {this.put('UPDATE player_match_members SET account_id=$1 WHERE seat_id=$2 AND account_id IS NULL',accountId,seatId);}
  async guestCount(seatId) {return number((await this.rows('SELECT COUNT(*) AS n FROM player_match_members WHERE seat_id=$1 AND account_id IS NULL',seatId))[0]?.n);}
  owner(owner,alias='p') {return owner.accountId ? {clause:`${alias}.account_id=$1`,value:owner.accountId} : {clause:`${alias}.account_id IS NULL AND ${alias}.seat_id=$1`,value:owner.seatId};}
  async read(owner,{page=0,period='all',mode='all'}={}) {
    const who=this.owner(owner),since=period==='month'?Date.UTC(new Date(this.now()+8*3600000).getUTCFullYear(),new Date(this.now()+8*3600000).getUTCMonth(),1)-8*3600000:0;
    const where=`${who.clause} AND m.ended_at >= $2`+(mode==='all'?'':' AND m.mode=$3'),args=[who.value,since,...(mode==='all'?[]:[mode])];
    const aggregate=`COUNT(CASE WHEN m.status='completed' THEN 1 END) AS games,COALESCE(SUM(CASE WHEN m.status='completed' THEN p.won ELSE 0 END),0) AS wins,COUNT(CASE WHEN m.status='aborted' THEN 1 END) AS aborted,AVG(CASE WHEN m.status='completed' THEN p.score END) AS average_score`;
    const [totals]=await this.rows(`SELECT ${aggregate} FROM player_match_members p JOIN player_matches m ON m.id=p.match_id WHERE ${where}`,...args);
    const groups=await this.rows(`SELECT m.mode,${aggregate} FROM player_match_members p JOIN player_matches m ON m.id=p.match_id WHERE ${where} GROUP BY m.mode ORDER BY m.mode`,...args);
    const roles=await this.rows(`SELECT p.side,p.role,${aggregate} FROM player_match_members p JOIN player_matches m ON m.id=p.match_id WHERE ${where} AND m.status='completed' AND p.role IS NOT NULL GROUP BY p.side,p.role ORDER BY p.side,p.role`,...args);
    const start=args.length;
    const recent=await this.rows(`SELECT m.id,m.started_at,m.ended_at,m.status,m.mode,m.eligible,p.name,p.avatar,p.won,p.score,p.place,p.side,p.role FROM player_match_members p JOIN player_matches m ON m.id=p.match_id WHERE ${where} ORDER BY m.ended_at DESC,m.id DESC LIMIT $${start+1} OFFSET $${start+2}`,...args,21,page*20);
    const preferences=owner.accountId?(await this.rows('SELECT public_ranking FROM player_profiles WHERE account_id=$1',owner.accountId))[0]:null;
    return {signedIn:Boolean(owner.accountId),summary:summary(totals),groups:groups.map(r=>({mode:r.mode,...summary(r)})),roles:roles.map(r=>({side:r.side,role:r.role,...summary(r)})),publicRanking:preferences?.public_ranking===1,page,hasMore:recent.length>20,history:recent.slice(0,20).map(r=>({id:r.id,startedAt:number(r.started_at),endedAt:number(r.ended_at),status:r.status,mode:r.mode,ranked:r.eligible===1,name:r.name,avatar:r.avatar,won:r.won===1,score:r.score==null?null:number(r.score),place:r.place==null?null:number(r.place),side:r.side,role:r.role}))};
  }
  async detail(owner,id) {
    const who=this.owner(owner),[row]=await this.rows(`SELECT m.data FROM player_matches m JOIN player_match_members p ON p.match_id=m.id WHERE ${who.clause} AND m.id=$2`,who.value,id);
    if(!row)return null;
    const players=await this.rows('SELECT seat_id,name,avatar,bot,won,score,place,side,role FROM player_match_members WHERE match_id=$1 ORDER BY place,name',id);
    return {...(typeof row.data==='string'?JSON.parse(row.data):row.data),players:players.map(p=>({seatId:p.seat_id,name:p.name,avatar:p.avatar,bot:p.bot===1,won:p.won===1,score:p.score==null?null:number(p.score),place:p.place==null?null:number(p.place),side:p.side,role:p.role}))};
  }
  async companions(owner) {
    if(!owner.accountId)return [];
    // Only the requesting player's own shared matches. No globally browsable social graph.
    const rows=await this.rows(`SELECT q.account_id,COUNT(DISTINCT m.id) AS games,MAX(m.ended_at) AS last_played FROM player_match_members p JOIN player_match_members q ON q.match_id=p.match_id JOIN player_matches m ON m.id=p.match_id WHERE p.account_id=$1 AND q.account_id IS NOT NULL AND q.account_id<>p.account_id AND m.status='completed' GROUP BY q.account_id ORDER BY games DESC,last_played DESC LIMIT 12`,owner.accountId);
    const out=[];
    for(const row of rows) {
      const [last]=await this.rows(`SELECT q.name,q.avatar FROM player_match_members p JOIN player_match_members q ON q.match_id=p.match_id JOIN player_matches m ON m.id=p.match_id WHERE p.account_id=$1 AND q.account_id=$2 AND m.status='completed' ORDER BY m.ended_at DESC,m.id DESC LIMIT 1`,owner.accountId,row.account_id);
      out.push({name:last.name,avatar:last.avatar,games:number(row.games),lastPlayed:number(row.last_played)});
    }
    return out;
  }
  async leaderboard({period='all',mode='all',metric='wins'}={}) {
    const d=new Date(this.now()+8*3600000),since=period==='month'?Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)-8*3600000:0;
    const args=[since,...(mode==='all'?[]:[mode])];
    // Only verified full-human, distinct-account, completed games. Guest claims do not promote old games.
    const rows=await this.rows(`SELECT f.name,f.avatar,COUNT(*) AS games,SUM(p.won) AS wins FROM player_match_members p JOIN player_matches m ON m.id=p.match_id JOIN player_profiles f ON f.account_id=p.account_id WHERE f.public_ranking=1 AND m.status='completed' AND m.eligible=1 AND m.ended_at >= $1${mode==='all'?'':' AND m.mode=$2'} GROUP BY f.account_id,f.name,f.avatar`,...args);
    const value=r=>metric==='games'?number(r.games):metric==='winRate'?number(r.wins)/number(r.games):number(r.wins);
    const sorted=rows.filter(r=>metric!=='winRate'||number(r.games)>=MIN_RANKED_GAMES).sort((a,b)=>value(b)-value(a)||number(b.games)-number(a.games)||a.name.localeCompare(b.name,'zh-CN'));
    let previous,rank=0;
    return {minimumGames:MIN_RANKED_GAMES,entries:sorted.slice(0,100).map((r,i)=>{const score=value(r);if(previous!==score)rank=i+1;previous=score;return {rank,name:r.name,avatar:r.avatar,...summary(r)};})};
  }
}
