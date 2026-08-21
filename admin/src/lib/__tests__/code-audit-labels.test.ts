import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getCodeAuditEventTypeLabel,
  getCodeAuditResultLabel,
  getCodeAuditResultTagColor,
} from '../code-audit-labels';

test('code audit labels map English keys to Chinese operator copy', () => {
  assert.equal(getCodeAuditEventTypeLabel('staff_onboarding'), '员工入驻');
  assert.equal(getCodeAuditEventTypeLabel('resolve'), '扫码解析');
  assert.equal(getCodeAuditEventTypeLabel('reveal'), '查看二维码');
  assert.equal(getCodeAuditResultLabel('ok'), '解析成功');
  assert.equal(getCodeAuditResultLabel('token_revealed'), '已展示二维码');
  assert.equal(getCodeAuditResultLabel('staff_enterprise_conflict'), '已加入其他企业');
  assert.equal(getCodeAuditResultTagColor('joined'), 'green');
  assert.equal(getCodeAuditResultTagColor('staff_enterprise_conflict'), 'red');
  assert.equal(getCodeAuditResultTagColor('code_rotated'), 'orange');
});

test('code audit labels fall back to the raw key for unknown values', () => {
  assert.equal(getCodeAuditEventTypeLabel('future_event'), 'future_event');
  assert.equal(getCodeAuditResultLabel('future_result'), 'future_result');
  assert.equal(getCodeAuditResultTagColor('future_result'), 'default');
});
