const KEY = 'avalon.lighting.v1';
export const LIGHTING_MODES = {auto:'随对局', day:'白天', night:'黑夜'};

let mode = 'auto';
let phase = 'home';
let winner;
try {
  const saved = localStorage.getItem(KEY);
  if (Object.hasOwn(LIGHTING_MODES,saved)) mode = saved;
} catch { /* The device can still change the lighting in memory. */ }

export function lightingForPhase(phase, winner) {
  if (phase === 'finished') return winner === 'good' ? 'day' : 'night';
  return ['lobby','nominate','vote','quest','questResult'].includes(phase) ? 'day' : 'night';
}

export function getLighting() { return mode; }

function applyLighting() {
  document.body.dataset.lighting = mode === 'auto' ? lightingForPhase(phase,winner) : mode;
}

export function updateLighting(nextPhase, nextWinner) {
  phase = nextPhase;
  winner = nextWinner;
  applyLighting();
}

export function setLighting(value) {
  if (!Object.hasOwn(LIGHTING_MODES,value)) return;
  mode = value;
  try { localStorage.setItem(KEY,mode); } catch { /* Settings apply to the current page. */ }
  applyLighting();
}

export function lightingMarkup() {
  return `<label class="lighting-choice">场景明暗
    <select id="scene-lighting">${Object.entries(LIGHTING_MODES).map(([value,label]) =>
      `<option value="${value}"${value === mode ? ' selected' : ''}>${label}</option>`).join('')}</select>
  </label><p class="muted">随对局时，大厅和出征用白天，确认身份、查验和最终指认用黑夜。</p>`;
}

if (globalThis.window) window.addEventListener('storage', event => {
  if (event.key !== KEY) return;
  const value = event.newValue;
  mode = Object.hasOwn(LIGHTING_MODES,value) ? value : 'auto';
  applyLighting();
});
