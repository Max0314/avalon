// Persisted numeric IDs are independent of the currently selectable display order.
export function createAvatarCodec(avatars, persisted, previous) {
  const selected=new Set(avatars.map(a=>a.id)), known=new Set(persisted);
  const DEFAULT_AVATAR='cat-unbothered';
  const avatarId=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0
    ? persisted[value]??DEFAULT_AVATAR : known.has(value)?value:DEFAULT_AVATAR;
  const avatarIndex=value=>persisted.indexOf(avatarId(value));
  const avatarPath=value=>{const id=avatarId(value);return '/avatars/'+(selected.has(id)?'v2':'v1')+'/'+id+'.webp';};
  const avatarAssetPaths=[...previous.map(id=>'/avatars/v1/'+id+'.webp'),...avatars.map(a=>'/avatars/v2/'+a.id+'.webp')];
  const accountAvatar=picture=>{
    try {
      const u=new URL(picture);
      if(u.origin!=='https://auth.fribench.cn'||u.search||u.hash||u.username||u.password)return DEFAULT_AVATAR;
      const match=/^\/assets\/avatars\/(v[12])\/([a-z0-9-]+)\.webp$/.exec(u.pathname);
      return match&&(match[1]==='v1'?previous.includes(match[2]):selected.has(match[2]))?match[2]:DEFAULT_AVATAR;
    } catch {return DEFAULT_AVATAR;}
  };
  return {DEFAULT_AVATAR,avatarId,avatarIndex,avatarPath,avatarAssetPaths,accountAvatar};
}
