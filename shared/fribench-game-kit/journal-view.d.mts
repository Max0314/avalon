export const AVATARS: {id:string;name:string;category:string}[];
export const DEFAULT_AVATAR:string;
export function avatarId(value:unknown):string;
export function avatarIndex(value:unknown):number;
export function avatarPath(value:unknown):string;
export function accountAvatar(value:unknown):string;
export function playerName(value:unknown):string;
export function journalSchema(pg?:boolean):string;
export const MIN_RANKED_GAMES:number;
export interface JournalPlayer {seatId:string;accountId?:string|null;name:string;avatar:string|number;bot?:boolean;won?:boolean;score?:number|null;place?:number|null;side?:string|null;role?:string|null}
export interface JournalMatch {id:string;startedAt:number;endedAt:number;status:'completed'|'aborted';mode:string;eligible:boolean;players:JournalPlayer[];[key:string]:unknown}
export class PlayerJournal {
  constructor(adapter:{write:(sql:string,...values:any[])=>unknown;query:(sql:string,...values:any[])=>any;pg?:boolean;now?:()=>number});
  profile(accountId:string|null|undefined,name:string,avatar:string|number):void;
  privacy(accountId:string,enabled:boolean):void;
  record(match:JournalMatch):void;
  claim(accountId:string,seatId:string):void;
  guestCount(seatId:string):Promise<number>;
  read(owner:{accountId?:string|null;seatId:string},filters?:{page?:number;period?:string;mode?:string}):Promise<any>;
  detail(owner:{accountId?:string|null;seatId:string},id:string):Promise<any>;
  companions(owner:{accountId?:string|null;seatId:string}):Promise<any>;
  leaderboard(filters?:{period?:string;mode?:string;metric?:string}):Promise<any>;
}
export function mountJournal(host:HTMLElement,options?:{modes?:{id:string;name:string}[];request?:(path:string,data?:unknown)=>Promise<any>}):()=>void;
