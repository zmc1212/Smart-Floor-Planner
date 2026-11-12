import assert from 'node:assert/strict';
import { test } from 'node:test';
import { delegationCommand } from '../live/delegation-chat';
import { affectsDelegationTask } from '../live/delegation-inputs';
import { deriveDelegationState, nextDelegationWake, setDelegationWait, type DelegationTask } from '../live/delegation-state';
import { runNativeDelegationTick } from '../live/delegation-worker';

const progress: DelegationTask = { key: 'progress', roomId: '11', roomName: '主卧', kind: 'progress', completion: 'published_progress', next: 'collect_report' };
const outlet: DelegationTask = { key: 'outlet', roomId: '12', roomName: '书房', kind: 'outlet', completion: 'manager_resolution', next: 'review_design' };
const now = new Date('2026-11-12T03:00:00.000Z');

test('the explicit owner command carries its scope and optional in-app reminder permission', () => {
  assert.deepEqual(delegationCommand('请持续跟进主卧的水电进展和书房的插座点位，等我回复超时就在小K里提醒我。'),
    { action: 'start', progressRoom: '主卧', outletRoom: '书房', remind: true });
  for (const text of ['听说可以持续跟进主卧水电和书房插座', '书桌靠窗，主要用电脑和台灯。', '暂停施工', '可以，继续。']) {
    assert.equal(delegationCommand(text), null);
  }
  assert.deepEqual(delegationCommand('暂停这次水电跟进。'), { action: 'pause' });
});

test('project, room, issue, record and conversation-bound requirement filters address only their own tasks', () => {
  assert.equal(affectsDelegationTask({ kind: 'record', roomIds: ['11'], recordId: '101' }, progress), true);
  assert.equal(affectsDelegationTask({ kind: 'record', roomIds: ['11'], recordId: '101' }, outlet), false);
  assert.equal(affectsDelegationTask({ kind: 'material', roomIds: ['12'] }, outlet), true);
  assert.equal(affectsDelegationTask({ kind: 'material', roomIds: ['12'] }, progress), false);
  assert.equal(affectsDelegationTask({ kind: 'plan', roomIds: ['12'], issueId: '42' }, { ...outlet, issueId: '43' }), false);
  assert.equal(affectsDelegationTask({ kind: 'requirement', roomNames: [''] }, outlet), false);
  assert.equal(affectsDelegationTask({ kind: 'requirement', roomNames: [''] }, { ...outlet, next: 'ask_owner' }), true);
});

test('a repeated wait does not move its deadline or send another reminder, and paused work only expires', () => {
  const target = { for: 'owner' as const, personId: '34', requested: ['书桌放在哪里'] };
  const waiting = setDelegationWait(outlet, 'ask_owner', '21', now, target);
  const later = new Date('2026-11-13T04:00:00.000Z');
  assert.deepEqual(setDelegationWait(waiting, 'ask_owner', '22', later, target).wait, waiting.wait);
  assert.equal(waiting.wait?.deadlineAt, '2026-11-14T03:00:00.000Z');
  const end = new Date('2026-12-12T03:00:00.000Z');
  assert.equal(nextDelegationWake('waiting', [waiting], end)?.toISOString(), waiting.wait?.deadlineAt);
  assert.equal(nextDelegationWake('paused', [waiting], end)?.toISOString(), end.toISOString());
  assert.equal(nextDelegationWake('cancelled', [waiting], end), null);
});

test('an individual task success and an external wait are not terminal delegation states', () => {
  const done = { ...progress, next: 'done' as const };
  const wait = setDelegationWait(outlet, 'review_design', '22', now, { for: 'designer', personId: '42', requested: ['核对图纸'] });
  assert.equal(deriveDelegationState([done, wait]), 'waiting');
  assert.equal(deriveDelegationState([done, { ...wait, next: 'authorize_plan' }]), 'awaiting_authorization');
  assert.equal(deriveDelegationState([done, { ...wait, next: 'organize_report' }]), 'processing');
  assert.equal(deriveDelegationState([done, { ...wait, next: 'retry_report' }]), 'blocked');
  assert.equal(deriveDelegationState([done, { ...wait, next: 'room_removed' }]), 'failed');
  assert.equal(deriveDelegationState([done, { ...outlet, next: 'done' }]), 'completed');
});

test('the Worker leaves unrelated environments alone without an explicit allowlist', async () => {
  assert.deepEqual(await runNativeDelegationTick({ NODE_ENV: 'test', NATIVE_WORKFLOW_DELEGATION_ENABLED: '1', NATIVE_WORKFLOW_DELEGATION_ENTERPRISE_IDS: 'invalid,0,9999999999999999999' }),
    { enabled: false, enterprises: [] });
});
