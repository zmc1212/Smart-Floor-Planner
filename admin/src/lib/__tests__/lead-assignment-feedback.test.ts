import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getAssignmentPendingHint,
  getAssignmentStatusLabel,
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
