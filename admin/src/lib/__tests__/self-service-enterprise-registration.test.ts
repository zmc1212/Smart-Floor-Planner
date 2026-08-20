import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseSelfServiceEnterpriseApplicationBody,
  SelfServiceEnterpriseApplicationError,
} from '@/lib/self-service-enterprise-registration';
import {
  buildEnterpriseRegistrationPath,
  ENTERPRISE_REGISTRATION_PAGE,
} from '@/lib/wechat-miniprogram-code';

test('parseSelfServiceEnterpriseApplicationBody validates required fields and phone', () => {
  assert.throws(
    () => parseSelfServiceEnterpriseApplicationBody({}),
    (error: unknown) =>
      error instanceof SelfServiceEnterpriseApplicationError &&
      error.message === '请填写所有必填字段'
  );

  assert.throws(
    () =>
      parseSelfServiceEnterpriseApplicationBody({
        name: '测试企业',
        code: '91310000MA1KTEST01',
        contactPerson: { name: '张三', phone: '123' },
      }),
    (error: unknown) =>
      error instanceof SelfServiceEnterpriseApplicationError &&
      error.message === '联系人手机号格式不正确'
  );

  const parsed = parseSelfServiceEnterpriseApplicationBody({
    name: ' 测试企业 ',
    code: ' 91310000MA1KTEST01 ',
    contactPerson: {
      name: ' 张三 ',
      phone: '13800138000',
      email: ' a@example.com ',
    },
  });
  assert.deepEqual(parsed, {
    name: '测试企业',
    code: '91310000MA1KTEST01',
    contactPerson: {
      name: '张三',
      phone: '13800138000',
      email: 'a@example.com',
    },
  });
});

test('buildEnterpriseRegistrationPath encodes er_ tokens for the registration page', () => {
  const token = `er_${'A'.repeat(32)}`;
  assert.equal(
    buildEnterpriseRegistrationPath(token),
    `${ENTERPRISE_REGISTRATION_PAGE}?token=${token}`
  );
  assert.throws(() => buildEnterpriseRegistrationPath('ej_bad'));
});
