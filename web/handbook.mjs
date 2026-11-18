import {EVIL, ROLES, SIZES} from '../shared/engine.mjs';

const SECTIONS = {rules: '玩法', roles: '角色图鉴', quests: '任务人数'};
const COUNTS = Object.keys(SIZES).map(Number);
const OPTIONAL = new Set(['percival', 'morgana', 'mordred', 'oberon']);
const FACTIONS = {good: '好人', evil: '邪恶'};

export function roleArt(roleId) {
  return Object.hasOwn(ROLES, roleId) ? `/art/${roleId}.webp` : null;
}

function roleType(id) {
  if (OPTIONAL.has(id)) return '房主可选';
  if (id === 'merlin' || id === 'assassin') return '每局必有';
  return '补足阵营席位';
}

function roleDetail(id, enabled) {
  const {name, side, image, description} = ROLES[id];
  const status = typeof enabled === 'boolean' ? (enabled ? '本桌已启用' : '本桌未启用') : roleType(id);
  const guidance = id === 'percival'
    ? '<p class="handbook-clarification">如果未启用莫甘娜，你只会看到梅林一位候选人。</p>'
    : '';
  return `<article class="handbook-profile" data-faction="${side}">
    <div class="handbook-portrait"><img src="${roleArt(id)}" alt="" width="480" height="640" decoding="async"></div>
    <div class="handbook-profile-copy">
      <div class="handbook-tags"><span>${FACTIONS[side]}阵营</span><span>${status}</span></div>
      <h3>${name}</h3>
      <p>${description}</p>${guidance}
      <details class="handbook-original">
        <summary>查看原版卡面</summary>
        <img src="/cards/${image}" alt="${name}的原版英文卡面" loading="lazy" decoding="async">
      </details>
    </div>
  </article>`;
}

function rules() {
  return `<div class="handbook-rule-banner">
    <h3>如何赢得一局？</h3>
    <p>好人要完成三次任务，并在终局保护梅林。邪恶可通过三次任务失败、连续五次组队未通过，或在终局刺中梅林获胜。</p>
  </div>
  <ol class="handbook-steps">
    <li><h3>确认身份</h3><p>全员私下查看并确认自己的角色。只有结算时，所有身份才会公开。</p></li>
    <li><h3>提名队伍</h3><p>队长按本轮人数选择出征队员，也可选择自己。任务人数由总玩家数和轮次决定。</p></li>
    <li><h3>全员表决</h3><p>赞成超过半数，队伍才可出征。赞成未过半时，更换队长重新组队。所有人投完后才公开每人的选择。</p></li>
    <li><h3>秘密交牌</h3><p>只有出征队员交牌。好人只能交成功，邪恶可以交成功或失败。通常一张失败牌就令任务失败；7～10 人局的第 4 轮需要两张。牌桌只公布数量。</p></li>
    <li><h3>刺客终局</h3><p>任务第三次成功后，由刺客指认一位玩家。指认梅林则邪恶反胜，指认其他人则好人获胜。</p></li>
  </ol>
  <details class="handbook-note"><summary>湖中仙女（可选规则）</summary><p>开启后，标记在开局时由首任队长右手边的玩家持有。第 2、3、4 次任务结束后，若尚未进入终局，持有者可私下查验一人的阵营，并把标记交给被查验者。曾持有标记的玩家不能再次成为查验对象。</p></details>
  <details class="handbook-note"><summary>在线和离线如何入桌？</summary><p>在线局分享邀请链接或房间码，同一浏览器保留自己的座位。离线同桌需要连接同一个 Wi-Fi 或热点，玩家与房主双向扫码；房主设备需要保持运行，掉线可重新扫码恢复座位。游戏无内置语音，可用外部通话或当面讨论。</p></details>`;
}

function roleGallery(settings) {
  return `<div class="handbook-gallery">
    <div class="handbook-role-picker" role="group" aria-label="选择要查看的角色">
      ${Object.entries(ROLES).map(([id, role]) => {
        const enabled = OPTIONAL.has(id) && typeof settings?.[id] === 'boolean' ? ` data-enabled="${settings[id]}"` : '';
        return `<button type="button" class="handbook-role-button" data-role="${id}" data-faction="${role.side}"${enabled} aria-controls="handbook-role-detail" aria-pressed="${id === 'merlin'}">
        <span class="handbook-thumb"><img src="${roleArt(id)}" alt="" width="480" height="640" loading="lazy" decoding="async"></span>
        <span class="handbook-role-label">${role.name}<small>${FACTIONS[role.side]}</small></span>
      </button>`;
      }).join('')}
    </div>
    <div id="handbook-role-detail" class="handbook-role-detail" aria-live="polite">${roleDetail('merlin')}</div>
  </div>`;
}

function questReference(count) {
  const evil = EVIL[count];
  return `<div class="handbook-faction-counts">
    <p data-faction="good"><span>好人</span><strong>${count - evil} 人</strong></p>
    <p data-faction="evil"><span>邪恶</span><strong>${evil} 人</strong></p>
  </div>
  <table class="handbook-quest-table">
    <caption>${count} 人局任务表</caption>
    <thead><tr><th scope="col">任务轮次</th><th scope="col">出征人数</th><th scope="col">失败门槛</th></tr></thead>
    <tbody>${SIZES[count].map((size, round) => {
      const special = count >= 7 && round === 3;
      return `<tr${special ? ' class="handbook-two-fail"' : ''}><th scope="row">第 ${round + 1} 轮</th><td>${size} 人</td><td>${special ? '2 张失败牌' : '1 张失败牌'}</td></tr>`;
    }).join('')}</tbody>
  </table>
  <p class="handbook-clarification">梅林与刺客固定加入。选用的莫甘娜、莫德雷德和奥伯伦与刺客合计最多 ${evil} 人，阵营的剩余席位由忠臣和爪牙补足。</p>`;
}

function questGuide(count, seated) {
  return `<div class="handbook-count-heading"><h3>选择玩家人数</h3>${seated ? `<p>本桌当前 ${count} 人</p>` : ''}</div>
    <div class="handbook-counts" role="group" aria-label="选择玩家人数">
      ${COUNTS.map(size => `<button type="button" data-count="${size}" aria-pressed="${size === count}" aria-controls="handbook-quest-detail">${size} 人</button>`).join('')}
    </div>
    <div id="handbook-quest-detail" aria-live="polite">${questReference(count)}</div>`;
}

export function handbookMarkup({players, settings, section = 'rules'} = {}) {
  const selected = Object.hasOwn(SECTIONS, section) ? section : 'rules';
  const seated = COUNTS.includes(players);
  const sections = {rules: rules(), roles: roleGallery(settings), quests: questGuide(seated ? players : COUNTS[0], seated)};
  return `<div id="handbook" class="handbook">
    <div class="handbook-tabs" role="tablist" aria-label="手册章节">${Object.entries(SECTIONS).map(([id, label]) => `<button type="button" role="tab" id="handbook-tab-${id}" data-section="${id}" aria-controls="handbook-pane-${id}" aria-selected="${selected === id}" tabindex="${selected === id ? 0 : -1}">${label}</button>`).join('')}</div>
    ${Object.entries(sections).map(([id, body]) => `<section class="handbook-pane" id="handbook-pane-${id}" role="tabpanel" aria-labelledby="handbook-tab-${id}" tabindex="0"${selected === id ? '' : ' hidden'}>${body}</section>`).join('')}
  </div>`;
}

function setPressed(buttons, selected) {
  for (const button of buttons) button.setAttribute('aria-pressed', String(button === selected));
}

export function mountHandbook(root) {
  const tabs = [...root.querySelectorAll('[data-section]')];
  const roles = root.querySelectorAll('[data-role]');
  const counts = root.querySelectorAll('[data-count]');
  const panels = tabs.map(tab => root.querySelector(`#${tab.getAttribute('aria-controls')}`));
  const rolePanel = root.querySelector('#handbook-role-detail');
  const questPanel = root.querySelector('#handbook-quest-detail');

  function selectTab(selected) {
    for (const [index, tab] of tabs.entries()) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      panels[index].hidden = !active;
    }
  }

  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.section) {
      selectTab(button);
    } else if (button.dataset.role && button.getAttribute('aria-pressed') !== 'true') {
      setPressed(roles, button);
      const {role, enabled} = button.dataset;
      rolePanel.innerHTML = roleDetail(role, enabled === undefined ? undefined : enabled === 'true');
    } else if (button.dataset.count && button.getAttribute('aria-pressed') !== 'true') {
      setPressed(counts, button);
      questPanel.innerHTML = questReference(Number(button.dataset.count));
    }
  });

  root.addEventListener('keydown', event => {
    const current = tabs.indexOf(event.target);
    if (current < 0) return;
    const neighbors = {ArrowLeft: (current + tabs.length - 1) % tabs.length, ArrowRight: (current + 1) % tabs.length, Home: 0, End: tabs.length - 1};
    if (!Object.hasOwn(neighbors, event.key)) return;
    event.preventDefault();
    const selected = tabs[neighbors[event.key]];
    selectTab(selected);
    selected.focus();
  });
}
