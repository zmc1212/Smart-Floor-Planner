import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMiniProgramBadges,
  unavailableMiniProgramBadges,
} from '@/lib/miniprogram-badges';
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
  assert.deepEqual(result.badges, unavailableMiniProgramBadges());
});

test('measurer bootstrap lands at the role workbench', () => {
  const measurer = { ...customer, mode: 'staff' as const, staffRole: 'measurer' as const };
  const result = buildMiniProgramBootstrap({ current: measurer, contexts: [measurer] });
  assert.equal(result.current.role, 'measurer');
  assert.equal(result.current.landingPath, '/pages/index/index');
});

test('customer badges count reschedule and rebook work on Service and omit zeros', () => {
  assert.deepEqual(buildMiniProgramBadges({
    role: 'customer',
    facts: { customerRescheduleCount: 1, customerRebookCount: 2 },
  }), {
    status: 'ok',
    message: null,
    counts: { service: 3 },
  });
  assert.deepEqual(buildMiniProgramBadges({
    role: 'customer',
    facts: { customerRescheduleCount: 0, customerRebookCount: 0 },
  }), {
    status: 'ok',
    message: null,
    counts: {},
  });
});

test('staff and owner badges stay inside the active role and never invent zeros', () => {
  assert.deepEqual(buildMiniProgramBadges({
    role: 'designer',
    facts: { designerFollowUpCount: 4, designerExpiredCount: 2, staffPayableCount: 3 },
  }).counts, { workbench: 6, earnings: 3 });
  assert.deepEqual(buildMiniProgramBadges({
    role: 'measurer',
    facts: { measurerTodayCount: 2, measurerTaskCount: 3, staffPayableCount: 1 },
  }).counts, { workbench: 5, earnings: 1 });
  assert.deepEqual(buildMiniProgramBadges({
    role: 'enterprise_admin',
    facts: { ownerExceptionCount: 5, ownerExpiredCount: 2, ownerPayableCount: 4 },
  }).counts, { operations: 5, appointments: 2, commissions: 4 });
  assert.deepEqual(buildMiniProgramBadges({
    role: 'referrer',
    facts: { referrerOpenProgressCount: 3, referrerPayableCount: 1 },
  }).counts, { progress: 3, earnings: 1 });
});

test('failed badge queries keep a recoverable copy and no local counts', () => {
  assert.deepEqual(unavailableMiniProgramBadges(), {
    status: 'unavailable',
    message: '暂时无法读取',
    counts: {},
  });
  const result = buildMiniProgramBootstrap({
    current: customer,
    contexts: [customer],
    badges: unavailableMiniProgramBadges(),
  });
  assert.equal(result.badges.status, 'unavailable');
  assert.equal(result.badges.message, '暂时无法读取');
  assert.deepEqual(result.badges.counts, {});
});

test('staff role mapping does not collapse designer and measurer capabilities', () => {
  assert.equal(getMiniProgramRole({ mode: 'staff', staffRole: 'designer' }), 'designer');
  assert.equal(getMiniProgramRole({ mode: 'staff', staffRole: 'measurer' }), 'measurer');
  assert.equal(getMiniProgramRole({ mode: 'staff', staffRole: 'enterprise_admin' }), 'enterprise_admin');
  assert.equal(getMiniProgramRole({ mode: 'staff', staffRole: 'salesperson' }), 'salesperson');
  assert.equal(getMiniProgramRole({ mode: 'staff', staffRole: 'admin' }), 'platform_admin');
  assert.equal(getMiniProgramRole({ mode: 'staff', staffRole: 'super_admin' }), 'platform_admin');
  const designer = { ...customer, mode: 'staff' as const, staffRole: 'designer' as const };
  const measurer = { ...customer, mode: 'staff' as const, staffRole: 'measurer' as const };
  assert.ok(buildMiniProgramBootstrap({ current: designer, contexts: [designer] }).current.capabilities.includes('staff.earnings'));
  assert.ok(buildMiniProgramBootstrap({ current: measurer, contexts: [measurer] }).current.capabilities.includes('staff.earnings'));
  const owner = { ...customer, mode: 'staff' as const, staffRole: 'enterprise_admin' as const };
  assert.ok(buildMiniProgramBootstrap({ current: owner, contexts: [owner] }).current.capabilities.includes('enterprise.commissions'));
  assert.equal(buildMiniProgramBootstrap({ current: owner, contexts: [owner] }).current.capabilities.includes('staff.earnings'), false);
  const platformAdmin = { ...customer, mode: 'staff' as const, staffRole: 'admin' as const };
  const platformBootstrap = buildMiniProgramBootstrap({
    current: platformAdmin,
    contexts: [platformAdmin],
  });
  assert.ok(platformBootstrap.current.capabilities.includes('platform.devices'));
  assert.ok(platformBootstrap.current.capabilities.includes('platform.review'));
  assert.equal(
    platformBootstrap.current.landingPath,
    '/packages/platform/devices/devices'
  );
  assert.deepEqual(platformBootstrap.current.capabilities, [
    'platform.review',
    'platform.devices',
    'account',
  ]);
  const salesperson = { ...customer, mode: 'staff' as const, staffRole: 'salesperson' as const };
  const salesBootstrap = buildMiniProgramBootstrap({ current: salesperson, contexts: [salesperson] });
  assert.equal(salesBootstrap.current.role, 'salesperson');
  assert.equal(salesBootstrap.current.landingPath, '/packages/business/promotion-records/promotion-records');
  assert.deepEqual(salesBootstrap.current.capabilities, [
    'promotion.records',
    'promotion.commissions',
    'account',
  ]);
});

test('salesperson badges stay empty without inventing local counts', () => {
  assert.deepEqual(buildMiniProgramBadges({
    role: 'salesperson',
    facts: {},
  }), {
    status: 'ok',
    message: null,
    counts: {},
  });
});

test('platform admin badges count pending review work and omit zeros', () => {
  assert.deepEqual(buildMiniProgramBadges({
    role: 'platform_admin',
    facts: { reviewPendingCount: 4 },
  }), {
    status: 'ok',
    message: null,
    counts: { review: 4 },
  });
  assert.deepEqual(buildMiniProgramBadges({
    role: 'platform_admin',
    facts: { reviewPendingCount: 0 },
  }), {
    status: 'ok',
    message: null,
    counts: {},
  });
});
