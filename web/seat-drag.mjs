export function mountSeatDrag(list, commit) {
  const controller = new AbortController();
  const signal = controller.signal;
  let press, ghost, suppressClick = false;
  const rows = () => Array.from(list.querySelectorAll('[data-player-row]'));
  const order = () => rows().map(row => row.dataset.playerRow);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  function position(event) {
    ghost.style.transform = `translate3d(${Math.round(event.clientX - press.offsetX)}px,${Math.round(event.clientY - press.offsetY)}px,0)`;
  }

  function start() {
    const {row, event} = press;
    const rect = row.getBoundingClientRect();
    press.offsetX = event.clientX - rect.left;
    press.offsetY = event.clientY - rect.top;
    ghost = row.cloneNode(true);
    ghost.removeAttribute('data-player-row');
    ghost.classList.add('seat-drag-ghost');
    ghost.inert = true;
    ghost.setAttribute('aria-hidden','true');
    ghost.style.width = `${rect.width}px`;
    document.body.append(ghost);
    row.classList.add('seat-drag-gap');
    list.setPointerCapture(event.pointerId);
    position(event);
    suppressClick = true;
  }

  function reorder(event) {
    position(event);
    const {row} = press;
    const neighbors = rows().filter(other => other !== row);
    const before = neighbors.find(other => {
      const {top,height} = other.getBoundingClientRect();
      return event.clientY < top + height / 2;
    });
    if (before === row.nextElementSibling || !before && row === list.lastElementChild) return;
    const positions = new Map(neighbors.map(other => [other,other.getBoundingClientRect().top]));
    list.insertBefore(row,before ?? null);
    if (reducedMotion.matches) return;
    for (const other of neighbors) {
      const distance = positions.get(other) - other.getBoundingClientRect().top;
      if (distance) other.animate([{transform:`translateY(${distance}px)`},{transform:'translateY(0)'}],
        {duration:165,easing:'ease-out'});
    }
  }

  function stop(save) {
    if (!press) return;
    const {row, initial, timer} = press;
    const hadGhost = Boolean(ghost);
    press = null;
    clearTimeout(timer);
    ghost?.remove();
    ghost = null;
    row.classList.remove('seat-drag-gap');
    if (!hadGhost) return;
    const next = order();
    if (save && next.some((id,i)=>id!==initial[i])) commit(next);
    else if (!save) {
      const byId = new Map(rows().map(item => [item.dataset.playerRow,item]));
      for (const id of initial) list.append(byId.get(id));
    }
    setTimeout(()=>{suppressClick=false;},0);
  }

  list.addEventListener('pointerdown',event=>{
    if (!event.isPrimary || event.button !== 0 || event.target.closest('[data-nodrag]')) return;
    const row = event.target.closest('[data-player-row]');
    if (!row) return;
    stop(false);
    press = {row,event,initial:order(),timer:setTimeout(start,600)};
  },{signal});
  list.addEventListener('pointermove',event=>{
    if (event.pointerId !== press?.event.pointerId) return;
    if (ghost) reorder(event);
    else if (Math.hypot(event.clientX-press.event.clientX,event.clientY-press.event.clientY)>9) stop(false);
  },{signal});
  for (const name of ['pointerup','pointercancel','lostpointercapture']) {
    window.addEventListener(name,event=>{
      if(name==='lostpointercapture'&&event.target!==list)return;
      if (event.pointerId === press?.event.pointerId) stop(name==='pointerup');
    },{signal});
  }
  list.addEventListener('touchmove',event=>{if(ghost)event.preventDefault();},{signal,passive:false});
  list.addEventListener('contextmenu',event=>{if(press)event.preventDefault();},{signal});
  list.addEventListener('click',event=>{
    if (!suppressClick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  },{signal,capture:true});
  list.addEventListener('keydown',event=>{
    if (!event.altKey || !['ArrowUp','ArrowDown'].includes(event.key)) return;
    const next=order(), id=event.target.closest('[data-player-row]')?.dataset.playerRow, index=next.indexOf(id);
    const target=index+(event.key==='ArrowUp'?-1:1);
    if(index<0||target<0||target>=next.length)return;
    event.preventDefault();
    next.splice(index,1);
    next.splice(target,0,id);
    commit(next);
  },{signal});
  return ()=>{
    const interrupted=Boolean(ghost);
    stop(false);
    controller.abort();
    return interrupted;
  };
}
