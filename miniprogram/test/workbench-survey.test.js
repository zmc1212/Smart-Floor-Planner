const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWorkbenchSurvey } = require('../utils/workbenchSurvey');

test('a designer sees their next Shanghai visit and only scoped local and completed records', () => {
  const now = Date.parse('2026-11-26T07:20:00Z');
  const confirmed = (leadId, start, end, date = '2026-11-26') => ({
    leadId, appointmentId: leadId + '0', status: 'confirmed', title: '合成住宅 ' + leadId, canPerformSurvey: true,
    timeRange: `[${date}T${start}:00Z,${date}T${end}:00Z)`,
  });
  const drafts = new Map([['surveying_draft_v1_4', { kind: 'survey-draft-envelope', savedAt: 1,
    draft: { kind: 'survey-wall-graph', floors: [{ walls: [{}] }] } }]]);
  const readKeys = [];
  const result = buildWorkbenchSurvey([
    confirmed('1', '05:00', '06:00'), confirmed('3', '08:00', '09:00', '2026-11-27'),
    confirmed('2', '08:00', '09:00'), confirmed('4', '10:00', '11:00'),
    { ...confirmed('9', '07:35', '08:35'), canPerformSurvey: false },
  ], [{ leadId: '5', floorPlanId: '50', floorPlanStatus: 'completed', title: '已归档' }],
  now, key => { readKeys.push(key); return drafts.get(key); });
  assert.equal(result.task.item.leadId, '2');
  assert.equal(result.task.title, '16:00–17:00');
  assert.equal(result.task.kind, 'survey');
  assert.deepEqual(result.records.map(item => [item.key, item.action]), [['local-4', 'survey'], ['cloud-50', 'plan']]);
  assert.ok(readKeys.every(key => /^surveying_draft_v1_[1-4]$/.test(key)));
});

test('a designer with a submitted formal plan completes the original appointment', () => {
  const item = { leadId: '21', appointmentId: '22', floorPlanId: '23', floorPlanStatus: 'completed',
    status: 'confirmed', canPerformSurvey: true, canCompleteSurvey: true,
    timeRange: '[2026-11-26T02:00:00Z,2026-11-26T03:00:00Z)' };
  const { task } = buildWorkbenchSurvey([item], [item], Date.parse('2026-11-26T07:20:00Z'), () => null);
  assert.equal(task.button, '确认完成量房');
  assert.equal(task.kind, 'appointment');
  assert.equal(task.item.appointmentId, '22');
});
