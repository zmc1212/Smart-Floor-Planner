import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMiniProgramBootstrap,
  getMiniProgramRole,
} from '@/lib/miniprogram-bootstrap';

const customer = {
  mode: 'customer' as const,
  enterpriseId: null,
  enterpriseName: null,
  staffId: null,
  staffRole: null,
  staffDisplayName: null,
  referrerMembershipId: null,
};

test('bootstrap exposes the current signed role and only valid role contexts', () => {
  const result = buildMiniProgramBootstrap({ current: customer, contexts: [customer] });
  assert.equal(result.current.role, 'customer');
  assert.equal(result.current.landingPath, '/pages/index/index');
  assert.deepEqual(result.recovery, { canSwitch: false, validRoleCount: 1 });
  assert.deepEqual(result.badges, {});
});

test('staff role mapping does not collapse designer and measurer capabilities', () => {
  assert.equal(getMiniProgramRole({ mode: 'staff', staffRole: 'designer' }), 'designer');
  assert.equal(getMiniProgramRole({ mode: 'staff', staffRole: 'measurer' }), 'measurer');
  assert.equal(getMiniProgramRole({ mode: 'staff', staffRole: 'enterprise_admin' }), 'enterprise_admin');
  assert.equal(getMiniProgramRole({ mode: 'staff', staffRole: 'salesperson' }), null);
});
