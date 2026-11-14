import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readStageReminderConfig } from '../stage-reminder-config';

const pilot = {
  XIAOK_STAGE_REMINDER_MODE: 'pilot',
  XIAOK_STAGE_REMINDER_ENTERPRISE_ID: '1454',
  XIAOK_STAGE_REMINDER_PILOT_ID: 'first-pilot',
};

// 未配置模式时默认 enterprise，保持旧 Worker 行为。
test('an unset mode defaults to the enterprise worker', () => {
  assert.deepEqual(readStageReminderConfig({}), {
    ok: true, mode: 'enterprise', enterpriseId: null, pilotId: null,
  });
});

// 显式 enterprise 模式不要求 pilotId，且不会因残留 pilotId 切换到试点。
test('an explicit enterprise mode keeps the enterprise worker', () => {
  assert.deepEqual(readStageReminderConfig({ XIAOK_STAGE_REMINDER_MODE: 'enterprise' }), {
    ok: true, mode: 'enterprise', enterpriseId: null, pilotId: null,
  });
  assert.deepEqual(readStageReminderConfig({
    XIAOK_STAGE_REMINDER_MODE: 'enterprise',
    XIAOK_STAGE_REMINDER_ENTERPRISE_ID: '1454',
    XIAOK_STAGE_REMINDER_PILOT_ID: 'first-pilot',
  }), { ok: true, mode: 'enterprise', enterpriseId: '1454', pilotId: null });
  assert.deepEqual(readStageReminderConfig({
    XIAOK_STAGE_REMINDER_MODE: 'enterprise',
    XIAOK_STAGE_REMINDER_ENTERPRISE_ID: 'abc',
  }), { ok: false, mode: 'enterprise', code: 'stage_reminder_enterprise_invalid' });
});

// 完整 pilot 配置。
test('a complete pilot configuration is accepted', () => {
  assert.deepEqual(readStageReminderConfig(pilot), {
    ok: true, mode: 'pilot', enterpriseId: '1454', pilotId: 'first-pilot',
  });
});

// pilot 模式缺少 enterpriseId 时返回明确配置错误，不回退 enterprise。
test('a pilot run without an enterprise id is rejected', () => {
  for (const value of [undefined, '', '   ']) {
    assert.deepEqual(readStageReminderConfig({
      ...pilot, XIAOK_STAGE_REMINDER_ENTERPRISE_ID: value,
    }), { ok: false, mode: 'pilot', code: 'stage_reminder_enterprise_required' });
  }
});

// pilot 模式缺少 pilotId 时返回明确配置错误，不回退 enterprise。
test('a pilot run without a pilot id is rejected', () => {
  for (const value of [undefined, '', '   ']) {
    assert.deepEqual(readStageReminderConfig({
      ...pilot, XIAOK_STAGE_REMINDER_PILOT_ID: value,
    }), { ok: false, mode: 'pilot', code: 'stage_reminder_pilot_required' });
  }
});

// 非法 enterpriseId：前导零、非数字、小数、超出 bigint。
test('an invalid pilot enterprise id is rejected', () => {
  for (const value of ['0', 'abc', '1454.0', '99999999999999999999', '1454x']) {
    assert.deepEqual(readStageReminderConfig({
      ...pilot, XIAOK_STAGE_REMINDER_ENTERPRISE_ID: value,
    }), { ok: false, mode: 'pilot', code: 'stage_reminder_enterprise_invalid' });
  }
});

// 非法 pilotId：空格、超长、非英文字符。
test('an invalid pilot id is rejected', () => {
  for (const value of ['first pilot', 'a'.repeat(129), '试点']) {
    assert.deepEqual(readStageReminderConfig({
      ...pilot, XIAOK_STAGE_REMINDER_PILOT_ID: value,
    }), { ok: false, mode: 'pilot', code: 'stage_reminder_pilot_invalid' });
  }
});

// 未知模式直接报错，不猜测也不回退 enterprise。
test('an unknown mode is rejected', () => {
  for (const value of ['tenant', 'enterprise,pilot', '1']) {
    assert.deepEqual(readStageReminderConfig({
      ...pilot, XIAOK_STAGE_REMINDER_MODE: value,
    }), { ok: false, mode: null, code: 'stage_reminder_mode_invalid' });
  }
});
