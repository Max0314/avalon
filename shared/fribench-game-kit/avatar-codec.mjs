// Persisted numeric IDs are independent of the currently selectable display order.
export function createAvatarCodec(avatars, persisted, versions) {
  const known=new Set(persisted);
  const latest=new Map();
  for(const [version,ids] of Object.entries(versions))for(const id of ids)latest.set(id,version);
  const DEFAULT_AVATAR='cat-unbothered';
  const avatarId=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0
    ? persisted[value]??DEFAULT_AVATAR : known.has(value)?value:DEFAULT_AVATAR;
  const avatarIndex=value=>persisted.indexOf(avatarId(value));
  const avatarPath=value=>{const id=avatarId(value);return '/avatars/'+latest.get(id)+'/'+id+'.webp';};
  const avatarAssetPaths=Object.entries(versions).flatMap(([version,ids])=>ids.map(id=>'/avatars/'+version+'/'+id+'.webp'));
  const accountAvatar=picture=>{
    try {
      const u=new URL(picture);
      if(u.origin!=='https://auth.fribench.cn'||u.search||u.hash||u.username||u.password)return DEFAULT_AVATAR;
      const match=/^\/assets\/avatars\/(v[1-9][0-9]*)\/([a-z0-9-]+)\.webp$/.exec(u.pathname);
      return match&&Object.hasOwn(versions,match[1])&&versions[match[1]].includes(match[2])?match[2]:DEFAULT_AVATAR;
    } catch {return DEFAULT_AVATAR;}
  };
  return {DEFAULT_AVATAR,avatarId,avatarIndex,avatarPath,avatarAssetPaths,accountAvatar};
}
