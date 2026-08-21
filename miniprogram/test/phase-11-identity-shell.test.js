const test = require('node:test');
const assert = require('node:assert/strict');

const navigation = require('../utils/identity-navigation.js');

test('unknown identity never silently resolves to the customer landing', () => {
  assert.equal(navigation.getRoleLanding({ mode: 'unknown' }), null);
  assert.equal(navigation.getRoleLanding({ mode: 'staff', staffRole: 'salesperson' }), null);
  assert.equal(navigation.navigateToRoleLanding({ mode: 'unknown' }), false);
  assert.equal(navigation.roleForIdentity({ role: 'user' }), 'customer');
});

test('deep links are checked against server bootstrap capabilities', () => {
  const customer = {
    current: {
      role: 'customer',
      capabilities: ['customer.service', 'customer.projects', 'account'],
      landingPath: '/pages/index/index'
    }
  };
  assert.equal(navigation.canAccessRoute('/packages/surveying/editor/surveying-editor', customer), false);
  assert.equal(navigation.canAccessRoute('/packages/business/customer-project/customer-project', customer), true);
  assert.equal(navigation.canAccessRoute('/packages/business/appointment-booking/appointment-booking', customer), true);
  assert.equal(navigation.canAccessRoute('/packages/business/lead-detail/lead-detail', customer), false);
  assert.equal(navigation.canAccessRoute('/packages/business/commission-records/commission-records', customer), false);
  assert.equal(navigation.canAccessRoute('/packages/business/staff-earnings/staff-earnings', customer), false);
  assert.equal(navigation.canAccessRoute('/packages/business/enterprise-commissions/enterprise-commissions', customer), false);
  assert.equal(navigation.canAccessRoute('/packages/business/promotion-records/promotion-records', customer), false);
  assert.deepEqual(
    navigation.guardDeepLink('/packages/surveying/editor/surveying-editor', customer),
    {
      allowed: false,
      route: '/packages/surveying/editor/surveying-editor',
      reason: 'identity_route_forbidden',
      redirectPath: '/pages/index/index'
    }
  );
});

test('staff roles retain distinct landing and capability contracts', () => {
  assert.equal(navigation.getRoleLanding({ mode: 'staff', staffRole: 'designer' }), '/pages/index/index');
  assert.equal(navigation.getRoleLanding({ mode: 'staff', staffRole: 'measurer' }), '/pages/index/index');
  assert.equal(navigation.canAccessRoute('/packages/surveying/editor/surveying-editor', { mode: 'staff', staffRole: 'measurer' }), true);
  assert.equal(navigation.canAccessRoute('/packages/surveying/editor/surveying-editor', { mode: 'staff', staffRole: 'designer' }), true);
  assert.equal(navigation.canAccessRoute('/packages/business/staff-activity-code/staff-activity-code', { mode: 'staff', staffRole: 'designer' }), true);
  assert.equal(navigation.canAccessRoute('/packages/business/staff-activity-code/staff-activity-code', { mode: 'staff', staffRole: 'measurer' }), true);
  assert.equal(navigation.canAccessRoute('/packages/business/staff-earnings/staff-earnings', { mode: 'staff', staffRole: 'designer' }), true);
  assert.equal(navigation.canAccessRoute('/packages/business/staff-earnings/staff-earnings', { mode: 'staff', staffRole: 'measurer' }), true);
  assert.equal(navigation.canAccessRoute('/packages/business/staff-earnings/staff-earnings', { mode: 'staff', staffRole: 'enterprise_admin' }), false);
  assert.equal(navigation.canAccessRoute('/packages/business/enterprise-commissions/enterprise-commissions', { mode: 'staff', staffRole: 'enterprise_admin' }), true);
  assert.equal(navigation.canAccessRoute('/packages/business/enterprise-commissions/enterprise-commissions', { mode: 'staff', staffRole: 'designer' }), false);
  assert.equal(navigation.canAccessRoute('/packages/business/enterprise-join-codes/enterprise-join-codes', { mode: 'staff', staffRole: 'enterprise_admin' }), true);
  assert.equal(navigation.canAccessRoute('/packages/business/enterprise-join-codes/enterprise-join-codes', { mode: 'staff', staffRole: 'designer' }), false);
  assert.equal(navigation.canAccessRoute('/packages/business/appointment-booking/appointment-booking', { mode: 'staff', staffRole: 'measurer' }), true);
  assert.equal(navigation.canAccessRoute('/packages/business/measurer-unavailability/measurer-unavailability', { mode: 'staff', staffRole: 'designer' }), true);
  assert.equal(navigation.canAccessRoute('/pages/ai-design/ai-design', { mode: 'staff', staffRole: 'measurer' }), true);
});
