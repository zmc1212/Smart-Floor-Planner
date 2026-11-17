const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ownerSiteContext, shanghaiDay } = require('../packages/assistant/lib/owner-site-context');

const project = { id: '12', name: '春和苑', stageName: '水电施工', progressAccess: true };
const now = Date.parse('2026-11-17T04:00:00Z'); // 12:00 in Shanghai

test('only a readable active site with progress access becomes the has-site state', () => {
  assert.equal(ownerSiteContext(null, null, now), null);
  assert.equal(ownerSiteContext({ ...project, progressAccess: false }, null, now), null);
});

test('a today report produces the today-update greeting and three site topics', () => {
  const view = ownerSiteContext(project, { periodStart: '2026-11-17T00:00:00Z' }, now);
  assert.equal(view.siteContext.hasTodayReport, true);
  assert.equal(view.siteContext.hasReport, true);
  assert.match(view.siteGreeting, /今天有新的进展/);
  assert.deepEqual(view.siteTopics.map(item => item.title), [
    '今天做了什么',
    '阶段注意什么',
    '下一步安排'
  ]);
});

test('an older report is shown as a new report, never as today progress', () => {
  const view = ownerSiteContext(project, { periodStart: '2026-11-16T00:00:00Z' }, now);
  assert.equal(view.siteContext.hasTodayReport, false);
  assert.equal(view.siteContext.hasReport, true);
  assert.match(view.siteGreeting, /有新的日报/);
  assert.doesNotMatch(view.siteGreeting, /今天有新的进展/);
});

test('no report and no stage stay truthful', () => {
  const view = ownerSiteContext({ ...project, stageName: '' }, null, now);
  assert.equal(view.siteContext.hasReport, false);
  assert.match(view.siteGreeting, /目前在施工中/);
  assert.equal(view.siteTopics[1].title, '阶段注意什么');
});

test('Shanghai day comparison handles the UTC+8 boundary', () => {
  assert.equal(shanghaiDay('2026-11-16T16:30:00Z'), '2026-11-17');
  assert.equal(shanghaiDay('2026-11-17T15:59:00Z'), '2026-11-17');
  assert.equal(shanghaiDay('2026-11-17T16:00:00Z'), '2026-11-18');
  assert.equal(shanghaiDay('invalid'), '');
});
