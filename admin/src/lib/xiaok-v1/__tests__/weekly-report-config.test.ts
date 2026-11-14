import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readWeeklyReportConfig } from '../weekly-report-config';

const pilot = {
  XIAOK_WEEKLY_REPORT_MODE: 'pilot',
  XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1454',
  XIAOK_WEEKLY_REPORT_PILOT_ID: 'first-pilot',
};

// A. 未配置模式时默认 enterprise，保持原有周报行为。
test('A. an unset mode defaults to the enterprise worker', () => {
  assert.deepEqual(readWeeklyReportConfig({}), {
    ok: true, mode: 'enterprise', enterpriseId: null, pilotId: null,
  });
});

// B. 显式 enterprise 模式兼容现有企业报告计划，且不会被残留 pilotId 切换。
test('B. an explicit enterprise mode keeps the enterprise worker', () => {
  assert.deepEqual(readWeeklyReportConfig({ XIAOK_WEEKLY_REPORT_MODE: 'enterprise' }), {
    ok: true, mode: 'enterprise', enterpriseId: null, pilotId: null,
  });
  assert.deepEqual(readWeeklyReportConfig({
    XIAOK_WEEKLY_REPORT_MODE: 'enterprise',
    XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1454',
    XIAOK_WEEKLY_REPORT_PILOT_ID: 'first-pilot',
  }), { ok: true, mode: 'enterprise', enterpriseId: '1454', pilotId: null });
  assert.deepEqual(readWeeklyReportConfig({
    XIAOK_WEEKLY_REPORT_MODE: 'enterprise',
    XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: 'abc',
  }), { ok: false, mode: 'enterprise', code: 'weekly_report_enterprise_invalid' });
});

// C. 完整 pilot 配置。
test('C. a complete pilot configuration is accepted', () => {
  assert.deepEqual(readWeeklyReportConfig(pilot), {
    ok: true, mode: 'pilot', enterpriseId: '1454', pilotId: 'first-pilot',
  });
});

// D. pilot 模式缺少 enterpriseId 时返回明确错误，不回退 enterprise。
test('D. a pilot run without an enterprise id is rejected', () => {
  for (const value of [undefined, '', '   ']) {
    assert.deepEqual(readWeeklyReportConfig({
      ...pilot, XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: value,
    }), { ok: false, mode: 'pilot', code: 'weekly_report_enterprise_required' });
  }
});

// E. pilot 模式缺少 pilotId 时返回明确错误，不回退 enterprise。
test('E. a pilot run without a pilot id is rejected', () => {
  for (const value of [undefined, '', '   ']) {
    assert.deepEqual(readWeeklyReportConfig({
      ...pilot, XIAOK_WEEKLY_REPORT_PILOT_ID: value,
    }), { ok: false, mode: 'pilot', code: 'weekly_report_pilot_required' });
  }
});

// F. 非法 enterpriseId：前导零、非数字、小数、超出 bigint。
test('F. an invalid pilot enterprise id is rejected', () => {
  for (const value of ['0', 'abc', '1454.0', '99999999999999999999', '1454x']) {
    assert.deepEqual(readWeeklyReportConfig({
      ...pilot, XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: value,
    }), { ok: false, mode: 'pilot', code: 'weekly_report_enterprise_invalid' });
  }
});

// G. 非法 pilotId：空格、超长、非英文字符。
test('G. an invalid pilot id is rejected', () => {
  for (const value of ['first pilot', 'a'.repeat(129), '试点']) {
    assert.deepEqual(readWeeklyReportConfig({
      ...pilot, XIAOK_WEEKLY_REPORT_PILOT_ID: value,
    }), { ok: false, mode: 'pilot', code: 'weekly_report_pilot_invalid' });
  }
});

// H. 未知模式直接报错，不猜测也不回退 enterprise。
test('H. an unknown mode is rejected', () => {
  for (const value of ['tenant', 'enterprise,pilot', '1']) {
    assert.deepEqual(readWeeklyReportConfig({
      ...pilot, XIAOK_WEEKLY_REPORT_MODE: value,
    }), { ok: false, mode: null, code: 'weekly_report_mode_invalid' });
  }
});

// I. 周报配置使用独立环境变量，不读取提醒 Worker 的模式。
test('I. the weekly worker ignores stage reminder variables', () => {
  assert.deepEqual(readWeeklyReportConfig({
    XIAOK_STAGE_REMINDER_MODE: 'pilot',
    XIAOK_STAGE_REMINDER_ENTERPRISE_ID: '1454',
    XIAOK_STAGE_REMINDER_PILOT_ID: 'first-pilot',
  }), { ok: true, mode: 'enterprise', enterpriseId: null, pilotId: null });
});
