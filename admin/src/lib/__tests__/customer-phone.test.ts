import assert from 'node:assert/strict';
import test from 'node:test';
import {
  customerPhoneLookupValues,
  isPlaceholderCustomerName,
  normalizeCustomerPhone,
} from '@/lib/customer-phone';

test('normalizeCustomerPhone strips China country codes and separators', () => {
  assert.equal(normalizeCustomerPhone('18112346445'), '18112346445');
  assert.equal(normalizeCustomerPhone('8618112346445'), '18112346445');
  assert.equal(normalizeCustomerPhone('+86 181-1234-6445'), '18112346445');
  assert.equal(normalizeCustomerPhone('008618112346445'), '18112346445');
});

test('customerPhoneLookupValues include legacy 86-prefixed forms', () => {
  const values = customerPhoneLookupValues('18112346445');
  assert.ok(values.includes('18112346445'));
  assert.ok(values.includes('8618112346445'));
  assert.ok(values.includes('+8618112346445'));
});

test('placeholder WeChat customer names are recognized', () => {
  assert.equal(isPlaceholderCustomerName('微信客户'), true);
  assert.equal(isPlaceholderCustomerName('1111'), false);
});
