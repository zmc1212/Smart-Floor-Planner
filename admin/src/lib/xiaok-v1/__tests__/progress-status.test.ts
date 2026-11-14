import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregatePlanStatus, classifyPlanTiming, constructionStatus, issueStatusLabel } from '../progress-status';

const node = { plannedStart: '2026-11-10', plannedEnd: '2026-11-12' };

test('early is green, normal is yellow, late is red and unknown is gray', () => {
  assert.equal(classifyPlanTiming({ ...node, now: new Date('2026-11-13T00:00:00+08:00'), observed: false, completedAt: '2026-11-11T10:00:00+08:00' }).color, 'green');
  assert.equal(classifyPlanTiming({ ...node, now: new Date('2026-11-13T00:00:00+08:00'), observed: false, completedAt: '2026-11-12T18:00:00+08:00' }).color, 'yellow');
  assert.equal(classifyPlanTiming({ ...node, now: new Date('2026-11-13T10:00:00+08:00'), observed: false, completedAt: '2026-11-13T09:00:00+08:00' }).color, 'red');
  assert.equal(classifyPlanTiming({ ...node, now: new Date('2026-11-10T10:00:00+08:00'), observed: false }).color, 'gray');
  assert.equal(classifyPlanTiming({ ...node, now: new Date('2026-11-13T10:00:00+08:00'), observed: false }).color, 'red');
});

test('a real in-period observation is normal, not an assumption of completion', () => {
  const timing = classifyPlanTiming({ ...node, now: new Date('2026-11-11T10:00:00+08:00'), observed: true });
  assert.deepEqual(timing, { color: 'yellow', label: '正常', reason: '处于计划期内，已有现场进展。' });
});

test('normal tolerance is explicit and never invented by the engine', () => {
  const completedAt = '2026-11-13T10:00:00+08:00';
  assert.equal(classifyPlanTiming({ ...node, now: new Date('2026-11-14T00:00:00+08:00'), observed: false, completedAt }).color, 'red');
  assert.equal(classifyPlanTiming({ ...node, now: new Date('2026-11-14T00:00:00+08:00'), observed: false, completedAt, normalToleranceDays: 1 }).color, 'yellow');
});

test('project aggregation keeps red, gray and missing plans distinct', () => {
  assert.deepEqual(aggregatePlanStatus([]), { color: 'gray', label: '未排期' });
  assert.equal(aggregatePlanStatus([{ color: 'green' }, { color: 'yellow' }]).color, 'yellow');
  assert.equal(aggregatePlanStatus([{ color: 'green' }, { color: 'red' }]).color, 'red');
  assert.equal(aggregatePlanStatus([{ color: 'green' }, { color: 'gray' }]).color, 'gray');
  assert.equal(aggregatePlanStatus([{ color: 'green' }]).color, 'green');
});

test('construction and issue status stay separate from plan colors', () => {
  assert.equal(constructionStatus({ observed: false, completed: false }), 'not_started');
  assert.equal(constructionStatus({ observed: true, completed: false }), 'in_progress');
  assert.equal(constructionStatus({ observed: true, completed: true, acceptancePending: true }), 'pending_acceptance');
  assert.equal(constructionStatus({ observed: true, completed: true }), 'completed');
  assert.equal(issueStatusLabel('awaiting_review'), '已整改待复核');
  assert.equal(issueStatusLabel('closed'), '已修正');
  assert.equal(issueStatusLabel('unknown_new_status'), '待核实');
});
