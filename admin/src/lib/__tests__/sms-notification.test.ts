import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { maskSmsPhone, normalizeSmsPhone } from '@/lib/sms/service';
import { mapAliyunSmsResponse, mapTencentSmsResponse } from '@/lib/sms/providers';

const adminSrc = join(process.cwd(), 'src');

test('SMS phone normalization accepts mainland numbers and masks stored values', () => {
  assert.equal(normalizeSmsPhone('138 0013 8000'), '+8613800138000');
  assert.equal(normalizeSmsPhone('8613800138000'), '+8613800138000');
  assert.equal(normalizeSmsPhone('12345'), null);
  assert.equal(maskSmsPhone('+8613800138000'), '+86****8000');
});

test('designer assignment notification wires SMS only for designer recipients', () => {
  const source = readFileSync(join(adminSrc, 'lib/wechat-notification.ts'), 'utf8');
  const service = readFileSync(join(adminSrc, 'lib/sms/service.ts'), 'utf8');
  assert.match(source, /sendAssignedDesignerSms/);
  assert.match(source, /designer\.role !== 'designer'/);
  assert.match(service, /lead_assignment_sms:/);
  assert.match(source, /sms: smsResult/);
});

test('SMS provider response mapping normalizes success and failure results', () => {
  assert.deepEqual(mapAliyunSmsResponse({ code: 'OK', bizId: 'biz-1', requestId: 'req-1' }), {
    success: true,
    providerMessageId: 'biz-1',
    providerRequestId: 'req-1',
  });
  assert.equal(mapAliyunSmsResponse({ code: 'isv.BUSINESS_LIMIT_CONTROL', message: 'throttled' }).errorCode, 'isv.BUSINESS_LIMIT_CONTROL');
  assert.deepEqual(mapTencentSmsResponse({ RequestId: 'req-2', SendStatusSet: [{ Code: 'Ok', SerialNo: 'serial-1' }] }), {
    success: true,
    providerMessageId: 'serial-1',
    providerRequestId: 'req-2',
  });
  assert.equal(mapTencentSmsResponse({ RequestId: 'req-3', SendStatusSet: [{ Code: 'LimitExceeded', Message: 'throttled' }] }).errorCode, 'LimitExceeded');
});

test('SMS configuration and delivery APIs are platform protected', () => {
  const config = readFileSync(join(adminSrc, 'app/api/platform/sms-config/route.ts'), 'utf8');
  const testRoute = readFileSync(join(adminSrc, 'app/api/platform/sms-config/test/route.ts'), 'utf8');
  const logs = readFileSync(join(adminSrc, 'app/api/platform/sms-delivery-logs/route.ts'), 'utf8');
  const retry = readFileSync(join(adminSrc, 'app/api/platform/sms-delivery-logs/[id]/retry/route.ts'), 'utf8');
  for (const source of [config, testRoute, logs, retry]) {
    assert.match(source, /super_admin/);
    assert.match(source, /admin/);
  }
});
