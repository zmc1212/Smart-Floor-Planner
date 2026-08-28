import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getAssignmentPendingHint,
  getAssignmentStatusLabel,
  getAssignmentErrorLabel,
  getAssignmentEventTypeLabel,
  getClaimResolutionReasonLabel,
  needsStaffWechatForAssignment,
} from '@/lib/lead-assignment-feedback';

test('pending assignment shows the concrete staffing error, not a generic 待派单', () => {
  assert.equal(
    getAssignmentStatusLabel('assignment_pending', 'designer_unavailable'),
    '暂无可用家装设计顾问'
  );
  assert.equal(
    getAssignmentStatusLabel('assignment_pending', 'measurer_unavailable'),
    '暂无可用家装现场顾问'
  );
  assert.equal(getAssignmentStatusLabel('assigned', null), '已派单');
});

test('pending hint tells operators to complete designer WeChat before retry', () => {
  assert.match(
    getAssignmentPendingHint('designer_unavailable'),
    /微信号和个人微信二维码/
  );
  assert.match(
    getAssignmentPendingHint('designer_and_measurer_unavailable'),
    /微信号与二维码/
  );
  assert.equal(getAssignmentPendingHint(null), '可在下方重试派单');
});

test('designer WeChat gap exposes the staff-management shortcut', () => {
  assert.equal(needsStaffWechatForAssignment('designer_unavailable'), true);
  assert.equal(
    needsStaffWechatForAssignment('designer_and_measurer_unavailable'),
    true
  );
  assert.equal(needsStaffWechatForAssignment('measurer_unavailable'), false);
});

test('assignment audit and claim-window keys map to Chinese operator copy', () => {
  assert.equal(getAssignmentEventTypeLabel('attribution_created'), '锁定客户归属');
  assert.equal(getAssignmentEventTypeLabel('attribution_reused'), '复用已有归属');
  assert.equal(getAssignmentEventTypeLabel('assignment_auto'), '赛马自动派单');
  assert.equal(getAssignmentEventTypeLabel('assignment_manual_reassign'), '负责人改派');
  assert.equal(getClaimResolutionReasonLabel('referrer_withdrawn'), '推广人已撤销');
  assert.equal(getClaimResolutionReasonLabel('manager_assignment'), '负责人手动指派');
  assert.equal(getAssignmentErrorLabel('designer_unavailable'), '暂无可用家装设计顾问');
});
