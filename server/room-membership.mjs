import {applyCommand,GameError,joinRoom} from '../shared/engine.mjs';
import {avatarId} from '../shared/fribench-game-kit/avatars.mjs';

function playing(room) {
  return Boolean(room.game&&room.game.phase!=='finished');
}

function statusOf(room,current) {
  if(!room)return 'missing';
  if(room.closed)return 'closed';
  if(current?.code===room.code)return 'current';
  if(room.game)return 'running';
  if(room.players.length>=10)return 'full';
  return 'open';
}

export function invitePreview(code,room,current,seatId) {
  const status=statusOf(room,current);
  const own=current?{
    code:current.code,version:current.version,host:current.hostId===seatId,playing:playing(current),
  }:null;
  return {
    code,status,
    usedAvatars:status==='open'?[...new Set(room.players.map(player=>avatarId(player.avatar)))]:[],
    current:own,
    canSwitch:status==='open'&&Boolean(own&&(own.host||!own.playing)),
  };
}

export function prepareSwitch(current,destination,person,from,now,profile) {
  // A repeated confirmation can recover the already committed destination.
  if(current?.code===destination.code)return {room:joinRoom(destination,person),previousRoom:null};
  if(!current||current.code!==from.code||current.version!==from.version){
    throw new GameError('SWITCH_CHANGED','原房间已更新，请重新确认后再切换。');
  }
  const context={now};
  // Validate the destination before ending the old membership or writing its journal.
  const entrant=profile?{...person,name:profile.name,avatar:profile.avatar}:person;
  const room=joinRoom(destination,entrant,context);
  const previousRoom=applyCommand(current,person.id,current.hostId===person.id?'close':'leave',{},context);
  return {room,previousRoom};
}
