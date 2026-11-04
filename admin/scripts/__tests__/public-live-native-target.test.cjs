/* eslint-disable @typescript-eslint/no-require-imports -- Exercise the same CommonJS Stable driver module. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { liveTargetSelectors, liveScrollPlan, revealLiveTarget } = require('../public-live-native-target.cjs');
const rect = (top, bottom) => ({ left: 45, right: 308, top, bottom });
const layout = () => ({ window: { windowWidth: 390, windowHeight: 844 }, container: { left: 20, right: 390, top: 98, bottom: 780 }, composer: { top: 750 }, offset: { scrollTop: 0 }, start: rect(1923.90625, 2071.84375), end: rect(2275.796875, 2321.796875) });

test('the retained native09 offscreen scope is rejected until the actual scroll container moves', async () => {
  const original = layout(); let top = 0; const scrolls = [];
  const receipt = await revealLiveTarget({ measure: async () => ({ ...original, offset: { scrollTop: top }, start: rect(original.start.top - top, original.start.bottom - top), end: rect(original.end.top - top, original.end.bottom - top) }), scroll: async value => { scrolls.push(value); top = value; } });
  assert.equal(liveScrollPlan(original).visible, false);
  assert.equal(scrolls.length, 1); assert.equal(scrolls[0], 1580);
  assert.ok(receipt.final.target.top >= 106); assert.ok(receipt.final.target.bottom <= 742);
});

test('C05 clears the real fractional button edge on an integer-only scroll container', async () => {
  const original = { ...layout(), container: { left: 0, right: 390, top: 91, bottom: 744 }, composer: { top: 744 },
    start: rect(379.3125, 527.25), end: rect(731.203125, 777.203125) };
  let offset = 0;
  const result = await revealLiveTarget({ measure: async () => ({ ...original, offset: { scrollTop: offset },
    start: rect(original.start.top - offset, original.start.bottom - offset), end: rect(original.end.top - offset, original.end.bottom - offset) }),
  scroll: async value => { offset = Math.trunc(value); } });
  assert.equal(offset, 42);
  assert.equal(result.observations.length, 2);
  assert.equal(result.final.target.bottom, 735.203125);
});

test('a successful scroll receipt cannot pass a target that physically remains offscreen', async () => {
  await assert.rejects(revealLiveTarget({ measure: async () => layout(), scroll: async () => ({ success: true }) }), /remains outside/);
});

test('the current message ID scopes every action and rejects selector injection', () => {
  assert.deepEqual(liveTargetSelectors('5178', 'scope'), ['#message-5178 .owner-live-preview', '#message-5178 .owner-live-primary']);
  for (const id of ['0', '1 .owner-public-primary', undefined]) assert.throws(() => liveTargetSelectors(id, 'action'));
  assert.throws(() => liveTargetSelectors('1', 'unknown'));
});

test('missing, clipped or oversized geometry cannot become a false visible pass', () => {
  for (const patch of [{ start: null }, { end: { ...rect(100, 500), right: 400 } }, { start: rect(100, 300), end: rect(700, 900) }, { offset: {} }]) assert.throws(() => liveScrollPlan({ ...layout(), ...patch }));
});

test('already visible and scrolled-above targets use their measured container offset', () => {
  const m = { ...layout(), start: rect(120, 268), end: rect(450, 496), offset: { scrollTop: 800 } };
  assert.equal(liveScrollPlan(m).visible, true);
  const above = liveScrollPlan({ ...m, start: rect(20, 168), end: rect(350, 396) });
  assert.equal(above.visible, false); assert.equal(above.scrollTop, 714);
});
