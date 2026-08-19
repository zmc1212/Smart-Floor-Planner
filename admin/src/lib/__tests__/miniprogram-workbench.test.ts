import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStaffingGapItems,
  isAssignmentEligibleStaff,
} from '@/lib/miniprogram-workbench';

test('designers need an active wechat profile and measurers only need to stay assignable', () => {
  assert.equal(isAssignmentEligibleStaff({
    role: 'designer',
    status: 'active',
    assignmentPaused: false,
    wechatId: 'wx-designer',
    wechatQrAssetId: '12',
  }), true);
  assert.equal(isAssignmentEligibleStaff({
    role: 'designer',
    status: 'active',
    assignmentPaused: false,
    wechatId: '  ',
    wechatQrAssetId: '12',
  }), false);
  assert.equal(isAssignmentEligibleStaff({
    role: 'measurer',
    status: 'active',
    assignmentPaused: false,
  }), true);
  assert.equal(isAssignmentEligibleStaff({
    role: 'measurer',
    status: 'active',
    assignmentPaused: true,
  }), false);
});

test('enterprise operations expose missing designer and measurer staffing as exceptions', () => {
  assert.deepEqual(buildStaffingGapItems({ eligibleDesignerCount: 0, eligibleMeasurerCount: 2 }).map((item) => item.id), [
    'staffing-designer',
  ]);
  assert.deepEqual(buildStaffingGapItems({ eligibleDesignerCount: 1, eligibleMeasurerCount: 0 }).map((item) => ({
    id: item.id,
    metaLabel: item.metaLabel,
    action: item.action,
    serviceStage: item.serviceStage,
  })), [{
    id: 'staffing-measurer',
    metaLabel: '人员缺口',
    action: 'staffing',
    serviceStage: 'assignment_pending',
  }]);
  assert.deepEqual(buildStaffingGapItems({ eligibleDesignerCount: 1, eligibleMeasurerCount: 1 }), []);
});
