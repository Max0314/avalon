const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function dragGrip(dx, dy, width, height, direction, corner) {
  const progress = clamp(-direction * dx / width, 0, 1);
  const edgeY = corner === 'top' ? 0 : 1;
  if (!progress) return {progress, x: 1, y: edgeY};
  const bend = Math.min(.025, progress * .1);
  const travel = dy / height;
  return {
    progress,
    x: clamp(1 + direction * dx / width, -1.16, 1),
    y: corner === 'top' ? clamp(travel, bend, .9) : clamp(1 + travel, .1, 1 - bend),
  };
}

export function commitsTurn(progress, dx, velocity, direction) {
  return progress >= .28 || (-direction * velocity >= .45 && -direction * dx >= 24);
}

export function settleDuration(progress, complete, button, reduced) {
  if (reduced) return 120;
  if (button) return 360;
  return complete ? 160 + 120 * (1 - progress) : 180;
}

export function settleGrip(initial, time, corner, complete, button) {
  const ease = 1 - (1 - time) ** 3;
  const edgeY = corner === 'top' ? 0 : 1;
  const lift = button ? Math.sin(time * Math.PI) * .16 * (1 - 2 * edgeY) : 0;
  return {
    progress: initial.progress + ((complete ? 1 : 0) - initial.progress) * ease,
    x: initial.x + ((complete ? -1.16 : 1) - initial.x) * ease,
    y: initial.y + (edgeY - initial.y) * ease + lift,
  };
}

// The crease is perpendicular to the line joining the resting corner and the fingertip.
export function pageCurl(width, height, {direction, corner, grip}) {
  const x = direction > 0 ? width : 0;
  const y = corner === 'top' ? 0 : height;
  const dx = x - (direction > 0 ? grip.x : 1 - grip.x) * width;
  const dy = y - grip.y * height;
  const length = Math.hypot(dx, dy);
  return {
    middle: {x: x - dx / 2, y: y - dy / 2},
    normal: length > 0 ? {x: dx / length, y: dy / length} : {x: direction, y: 0},
    arc: Math.min(width * .12, length * .35),
    flat: length < .01,
  };
}

function distance(point, {middle, normal}) {
  return (point.x - middle.x) * normal.x + (point.y - middle.y) * normal.y;
}

export function clipPaper(points, curl, offset, keepFront = true) {
  const clipped = [];
  for (const [i, a] of points.entries()) {
    const b = points[(i + 1) % points.length];
    const da = distance(a, curl) - offset;
    const db = distance(b, curl) - offset;
    const inside = keepFront ? da <= 0 : da >= 0;
    const nextInside = keepFront ? db <= 0 : db >= 0;
    if (inside) clipped.push(a);
    if (inside !== nextInside) {
      const t = da / (da - db);
      clipped.push({x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t});
    }
  }
  return clipped;
}

export function projectPaper(point, curl) {
  const {arc, normal} = curl;
  const s = distance(point, curl) + arc / 2;
  if (curl.flat || s <= 0) return point;
  const radius = arc / Math.PI;
  const projected = s < arc ? radius * Math.sin(s / radius) : arc - s;
  return {x: point.x + (projected - s) * normal.x, y: point.y + (projected - s) * normal.y};
}

const PAPER_BANDS = 16;
const emptyClip = 'polygon(0 0,0 0,0 0)';

function fillBand(context, points, curl, color) {
  if (points.length < 3) return;
  context.beginPath();
  for (const [i, point] of points.entries()) {
    const {x, y} = projectPaper(point, curl);
    if (i) context.lineTo(x, y);
    else context.moveTo(x, y);
  }
  context.closePath();
  context.fillStyle = color;
  context.strokeStyle = color;
  context.fill();
  context.stroke();
}

export function drawTurn(outgoing, canvas, turn) {
  if (turn.reduced) {
    outgoing.style.opacity = String(1 - turn.grip.progress);
    return;
  }

  const {width, height} = turn;
  const curl = pageCurl(width, height, turn);
  const paper = [{x: 0, y: 0}, {x: width, y: 0}, {x: width, y: height}, {x: 0, y: height}];
  const front = curl.flat ? paper : clipPaper(paper, curl, -curl.arc / 2);
  outgoing.style.clipPath = front.length >= 3
    ? `polygon(${front.map(({x, y}) => `${x}px ${y}px`).join(',')})`
    : emptyClip;

  const context = canvas.getContext('2d');
  if (!context) return;
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  const canvasWidth = Math.round(width * dpr);
  const canvasHeight = Math.round(height * dpr);
  if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  if (curl.flat) return;

  // Paint the curvature over the clipped live page. The live incoming page sits beneath it.
  context.lineWidth = .7;
  for (let i = 0; i < PAPER_BANDS; i++) {
    const start = curl.arc * (i / PAPER_BANDS - .5);
    const end = start + curl.arc / PAPER_BANDS;
    const strip = clipPaper(clipPaper(paper, curl, start, false), curl, end);
    const grain = i < PAPER_BANDS / 2 ? [218, 200, 163] : [214, 184, 130];
    const brightness = 1 - .39 * Math.sin(Math.PI * (i + .5) / PAPER_BANDS);
    fillBand(context, strip, curl, `rgb(${grain.map(channel => Math.round(channel * brightness)).join(' ')})`);
  }
  const reverse = clipPaper(paper, curl, curl.arc / 2, false);
  const shade = context.createLinearGradient(
    curl.middle.x, curl.middle.y,
    curl.middle.x - curl.normal.x * width * .45, curl.middle.y - curl.normal.y * width * .45,
  );
  shade.addColorStop(0, '#ae8955');
  shade.addColorStop(.25, '#dfc28e');
  shade.addColorStop(.8, '#edddaf');
  shade.addColorStop(1, '#dac298');
  fillBand(context, reverse, curl, shade);
}
