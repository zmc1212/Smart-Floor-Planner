const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ReplyScroll, replyScrollPosition } = require('../packages/assistant/chat/reply-scroll');

function position(overrides = {}) {
  return replyScrollPosition({
    view: { top: 100, bottom: 720, scrollTop: 120 },
    bubble: { top: 180, bottom: 600 },
    end: { bottom: 650 },
    held: false,
    ...overrides,
  });
}

test('short replies stay in place and only follow enough to keep growing text in view', () => {
  assert.deepEqual(position({ end: { bottom: 735 } }), { top: 120, held: false, showEnd: false });
  assert.deepEqual(position({ bubble: { top: 180, bottom: 760 }, end: { bottom: 772 } }),
    { top: 160, held: false, showEnd: false });
});

test('following stops at the bubble start, with an arrow only while text is below the viewport', () => {
  assert.deepEqual(position({ bubble: { top: 180, bottom: 800 }, end: { bottom: 816 } }),
    { top: 200, held: true, showEnd: false });
  assert.deepEqual(position({ bubble: { top: 180, bottom: 1030 }, end: { bottom: 1046 } }),
    { top: 200, held: true, showEnd: true });
  assert.deepEqual(position({ bubble: { top: 180, bottom: 813 }, contentBottom: 799, end: { bottom: 829 } }),
    { top: 200, held: true, showEnd: false });
});

test('manual reading holds the screen and jumping to the end is a one-time move', () => {
  const later = { bubble: { top: -250, bottom: 900 }, end: { bottom: 920 }, held: true };
  assert.deepEqual(position(later), { top: 120, held: true, showEnd: true });
  assert.deepEqual(position({ ...later, jump: true }), { top: 320, held: true, showEnd: false });
});

test('completion preserves a held position and compensates for the process row replacement', () => {
  const done = { held: true, bubble: { top: 75, bottom: 1100 }, end: { bottom: 1130 } };
  assert.deepEqual(position(done), { top: 120, held: true, showEnd: true });
  assert.deepEqual(position({ ...done, anchorShift: -25 }), { top: 95, held: true, showEnd: true });
});

test('a fully rendered reply follows to its opening even when only the cards are below the viewport', () => {
  const done = { bubble: { top: 510, bottom: 610 }, contentBottom: 1390, end: { bottom: 1430 } };
  assert.deepEqual(position(done), { top: 530, held: true, showEnd: true });
  assert.deepEqual(position({ ...done, jump: true }), { top: 830, held: true, showEnd: false });
});

test('a native scroll to the bottom during insertion can be corrected to the start of the reply', () => {
  const done = { bubble: { top: 24, bottom: 120 }, contentBottom: 695, end: { bottom: 720 } };
  assert.deepEqual(position(done), { top: 44, held: true, showEnd: true });
  assert.deepEqual(position({ ...done, held: true }), { top: 120, held: true, showEnd: false });
});

test('replacing the process row does not compensate twice when the native view keeps the bubble in place', () => {
  const nudges = [], scroll = new ReplyScroll({ _alive: false });
  scroll.move = (_, from, to) => nudges.push([from, to]);
  const previous = { phase: 'streaming', contentTop: 196.25, screenTop: 0.25 };
  const viewport = { top: 91, bottom: 744 };
  const final = { id: 'message-2', phase: 'saved', growing: false };
  scroll.layout({ held: true, sample: previous }, final, { ...viewport, scrollTop: 190 }, { top: 91.25, bottom: 1020 }, { bottom: 1080 }, 1010);
  assert.deepEqual(nudges, []);
  scroll.layout({ held: true, sample: previous }, final, { ...viewport, scrollTop: 196 }, { top: 85.25, bottom: 1014 }, { bottom: 1074 }, 1004);
  assert.deepEqual(nudges, [[196, 190]]);
});
