import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clipPaper, commitsTurn, dragGrip, pageCurl, projectPaper, settleDuration, settleGrip} from '../web/handbook-turn.mjs';

test('a dragged curl mirrors for the other side and follows the top or bottom corner', () => {
  const width = 300;
  const height = 450;
  const forward = dragGrip(-120, 72, width, height, 1, 'top');
  const backward = dragGrip(120, -72, width, height, -1, 'bottom');
  const topRight = pageCurl(width, height, {direction: 1, corner: 'top', grip: forward});
  const bottomLeft = pageCurl(width, height, {direction: -1, corner: 'bottom', grip: backward});
  const right = projectPaper({x: width, y: 0}, topRight);
  const left = projectPaper({x: 0, y: height}, bottomLeft);
  assert.equal(forward.progress, .4);
  assert.equal(backward.progress, .4);
  assert(right.x < width && right.y > 0);
  assert(Math.abs(right.x + left.x - width) < .001);
  assert(Math.abs(right.y + left.y - height) < .001);
  assert.deepEqual(dragGrip(20, 72, width, height, 1, 'top'), {progress: 0, x: 1, y: 0});
});

test('a turn clips to the crease, reveals the next sheet when settled, and restores the old sheet on rollback', () => {
  const paper = [{x: 0, y: 0}, {x: 300, y: 0}, {x: 300, y: 450}, {x: 0, y: 450}];
  const options = {direction: 1, corner: 'bottom'};
  const initial = dragGrip(-60, -40, 300, 450, 1, options.corner);
  const lifted = pageCurl(300, 450, {...options, grip: initial});
  const front = clipPaper(paper, lifted, -lifted.arc / 2);
  assert(front.length >= 3 && front.some(point => point.x > 0 && point.x < 300));
  const back = settleGrip(initial, 1, options.corner, false, false);
  assert.deepEqual(back, {progress: 0, x: 1, y: 1});
  assert(pageCurl(300, 450, {...options, grip: back}).flat);
  const complete = settleGrip(initial, 1, options.corner, true, false);
  const finished = pageCurl(300, 450, {...options, grip: complete});
  assert.equal(complete.progress, 1);
  assert.deepEqual(clipPaper(paper, finished, -finished.arc / 2), []);
});

test('only sufficient distance or a directional flick commits a turn and reduced motion shortens settling', () => {
  assert(commitsTurn(.28, -84, 0, 1));
  assert(commitsTurn(.12, 36, .45, -1));
  assert(!commitsTurn(.12, -36, .45, 1));
  assert(!commitsTurn(.12, -23, -.9, 1));
  assert(!commitsTurn(.27, -81, -.2, 1));
  assert.equal(settleDuration(.2, false, false, false), 180);
  assert.equal(settleDuration(0, true, true, false), 360);
  assert.equal(settleDuration(0, true, true, true), 120);
  assert(settleGrip({progress: 0, x: 1, y: 1}, .5, 'bottom', true, true).y < 1);
});
