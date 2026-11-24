const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ReplyScroll, replyScrollPosition } = require('../packages/assistant/chat/reply-scroll');

function position(overrides = {}) {
  return replyScrollPosition({
    view: { top: 100, bottom: 720, scrollTop: 120 },
    start: { top: 180 },
    end: { bottom: 600 },
    transcriptEnd: { bottom: 650 },
    held: false,
    ...overrides,
  });
}

test('a reply follows only as far as needed to keep its ending in view', () => {
  assert.deepEqual(position({ transcriptEnd: { bottom: 735 } }), { top: 120, held: false, showEnd: false });
  assert.deepEqual(position({ end: { bottom: 760 }, transcriptEnd: { bottom: 772 } }),
    { top: 160, held: false, showEnd: false });
});

test('following stops at the reply start and shows the arrow while its ending is below the viewport', () => {
  assert.deepEqual(position({ end: { bottom: 802 }, transcriptEnd: { bottom: 816 } }),
    { top: 200, held: true, showEnd: false });
  assert.deepEqual(position({ end: { bottom: 1030 }, transcriptEnd: { bottom: 1046 } }),
    { top: 200, held: true, showEnd: true });
});

test('manual reading holds the screen and jumping to the end is a one-time move', () => {
  const later = { start: { top: -250 }, end: { bottom: 900 }, transcriptEnd: { bottom: 1040 }, held: true };
  assert.deepEqual(position(later), { top: 120, held: true, showEnd: true });
  assert.deepEqual(position({ ...later, jump: true }), { top: 300, held: true, showEnd: false });
  assert.deepEqual(position({ ...later, jump: true, end: { bottom: 700 } }), { top: 120, held: true, showEnd: false });
});

test('completion preserves a held position and compensates for the process row replacement', () => {
  const done = { held: true, start: { top: 75 }, end: { bottom: 1100 }, transcriptEnd: { bottom: 1130 } };
  assert.deepEqual(position(done), { top: 120, held: true, showEnd: true });
  assert.deepEqual(position({ ...done, anchorShift: -25 }), { top: 95, held: true, showEnd: true });
});

test('a reply that arrives already complete can follow to its opening', () => {
  const done = { start: { top: 510 }, end: { bottom: 1390 }, transcriptEnd: { bottom: 1430 } };
  assert.deepEqual(position(done), { top: 530, held: true, showEnd: true });
  assert.deepEqual(position({ ...done, jump: true }), { top: 790, held: true, showEnd: false });
});

test('a native scroll to the bottom during insertion can be corrected to the start of the reply', () => {
  const done = { start: { top: 24 }, end: { bottom: 695 }, transcriptEnd: { bottom: 720 } };
  assert.deepEqual(position(done), { top: 44, held: true, showEnd: true });
  assert.deepEqual(position({ ...done, held: true }), { top: 120, held: true, showEnd: false });
});

test('replacing the process row does not compensate twice when the native view keeps the bubble in place', () => {
  const nudges = [], scroll = new ReplyScroll({ _alive: false });
  scroll.move = (_, from, to) => nudges.push([from, to]);
  const previous = { phase: 'streaming', contentTop: 196.25, screenTop: 0.25 };
  const viewport = { top: 91, bottom: 744 };
  const final = { id: 'message-2', phase: 'saved' };
  scroll.layout({ held: true, sample: previous }, final, { ...viewport, scrollTop: 190 }, { top: 91.25 }, { bottom: 1010 }, { bottom: 1080 });
  assert.deepEqual(nudges, []);
  scroll.layout({ held: true, sample: previous }, final, { ...viewport, scrollTop: 196 }, { top: 85.25 }, { bottom: 1004 }, { bottom: 1074 });
  assert.deepEqual(nudges, [[196, 190]]);
});

test('an observed reply end follows delayed layout changes and disconnects when the page hides', t => {
  const viewSelector = '.conversation-scroll';
  const endSelector = '#message-2-end';
  const rects = new Map([
    [viewSelector, { top: 100, bottom: 720, scrollTop: 120 }],
    ['#message-2', { top: 100 }],
    [endSelector, { bottom: 610 }],
    ['#conversation-end', { bottom: 645 }],
  ]);
  const queries = [];
  const data = { conversation: { id: 'chat-1' }, run: { id: 'run-1', outputMessageId: '2' }, showReplyEnd: false };
  const host = {
    _alive: true, _shown: true, data,
    setData(patch) { Object.assign(data, patch); },
    createSelectorQuery() {
      const current = [];
      queries.push(current);
      return {
        select(selector) { current.push(selector); return this; },
        fields() { return this; },
        boundingClientRect() { return this; },
        exec(callback) { callback(current.map(selector => rects.get(selector))); },
      };
    },
  };
  let observerCallback;
  let disconnects = 0;
  const previousWx = globalThis.wx;
  t.after(() => { globalThis.wx = previousWx; });
  globalThis.wx = {
    createIntersectionObserver(owner, options) {
      assert.equal(owner, host);
      assert.deepEqual(options.thresholds, [1]);
      return {
        relativeTo(selector, margins) {
          assert.equal(selector, viewSelector);
          assert.deepEqual(margins, { bottom: 2 });
          return this;
        },
        observe(selector, callback) { assert.equal(selector, endSelector); observerCallback = callback; },
        disconnect() { disconnects += 1; },
      };
    },
  };
  const scroll = new ReplyScroll(host);
  scroll.turn = { conversation: 'chat-1', id: 'run-1', held: true };
  scroll.request = () => scroll.measure();
  scroll.measure();
  assert.equal(data.showReplyEnd, false);
  rects.set(endSelector, { bottom: 980 });
  rects.set('#conversation-end', { bottom: 1015 });
  observerCallback();
  assert.equal(data.showReplyEnd, true);
  rects.set(endSelector, { bottom: 610 });
  observerCallback();
  assert.equal(data.showReplyEnd, false);
  assert.deepEqual(queries, Array.from({ length: 3 }, () => [viewSelector, '#message-2', endSelector, '#conversation-end']));
  scroll.suspend();
  observerCallback();
  assert.equal(disconnects, 1);
  assert.equal(queries.length, 3);
});
