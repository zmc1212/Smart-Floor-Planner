import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EnterpriseStatusTransitionError,
  enterpriseAccessDeniedMessage,
  isEnterpriseOperationallyActive,
  resolveEnterpriseStatusTransition,
} from '@/lib/enterprise-status';

test('enterprise status FSM allows approve from pending and rejected', () => {
  assert.deepEqual(
    resolveEnterpriseStatusTransition({
      currentStatus: 'pending_approval',
      action: 'approve',
    }),
    {
      action: 'approve',
      fromStatus: 'pending_approval',
      toStatus: 'active',
      reason: null,
    }
  );
  assert.equal(
    resolveEnterpriseStatusTransition({
      currentStatus: 'rejected',
      action: 'approve',
      reason: '资料已补齐并复核通过',
    }).toStatus,
    'active'
  );
});

test('enterprise status FSM requires reason for reject and disable', () => {
  assert.throws(
    () =>
      resolveEnterpriseStatusTransition({
        currentStatus: 'pending_approval',
        action: 'reject',
      }),
    (error: unknown) =>
      error instanceof EnterpriseStatusTransitionError &&
      error.code === 'REASON_REQUIRED'
  );

  const rejected = resolveEnterpriseStatusTransition({
    currentStatus: 'pending_approval',
    action: 'reject',
    reason: '营业执照信息不符',
  });
  assert.equal(rejected.toStatus, 'rejected');
  assert.equal(rejected.reason, '营业执照信息不符');

  assert.throws(
    () =>
      resolveEnterpriseStatusTransition({
        currentStatus: 'active',
        action: 'disable',
        reason: 'abc',
      }),
    (error: unknown) =>
      error instanceof EnterpriseStatusTransitionError &&
      error.code === 'REASON_INVALID'
  );
});

test('enterprise status FSM blocks illegal transitions', () => {
  assert.throws(
    () =>
      resolveEnterpriseStatusTransition({
        currentStatus: 'active',
        action: 'reject',
        reason: '不应允许从正常直接拒绝',
      }),
    (error: unknown) =>
      error instanceof EnterpriseStatusTransitionError &&
      error.code === 'INVALID_TRANSITION'
  );
  assert.throws(
    () =>
      resolveEnterpriseStatusTransition({
        currentStatus: 'disabled',
        action: 'approve',
      }),
    (error: unknown) =>
      error instanceof EnterpriseStatusTransitionError &&
      error.code === 'INVALID_TRANSITION'
  );
  assert.equal(
    resolveEnterpriseStatusTransition({
      currentStatus: 'disabled',
      action: 'enable',
    }).toStatus,
    'active'
  );
  assert.equal(
    resolveEnterpriseStatusTransition({
      currentStatus: 'rejected',
      action: 'resubmit_review',
    }).toStatus,
    'pending_approval'
  );
});

test('enterprise access helpers describe inactive statuses', () => {
  assert.equal(isEnterpriseOperationallyActive('active'), true);
  assert.equal(isEnterpriseOperationallyActive('disabled'), false);
  assert.equal(
    enterpriseAccessDeniedMessage('pending_approval'),
    '企业仍在审核中，暂时无法登录'
  );
  assert.equal(
    enterpriseAccessDeniedMessage('rejected'),
    '企业入驻申请未通过，暂时无法登录'
  );
  assert.equal(
    enterpriseAccessDeniedMessage('disabled'),
    '企业已停用，暂时无法登录'
  );
});
