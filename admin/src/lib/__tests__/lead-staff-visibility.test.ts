import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { resolveStaffLeadListOptions } from '@/lib/lead-staff-visibility';

test('measurer lead lists use measurerId visibility like the workbench', () => {
  assert.deepEqual(resolveStaffLeadListOptions('measurer', 7n), {
    staffId: 7n,
    staffVisibility: 'measurer',
  });
});

test('designer lead lists keep promoted-or-assigned visibility', () => {
  assert.deepEqual(resolveStaffLeadListOptions('designer', 7n), {
    staffId: 7n,
    staffVisibility: 'promoted-or-assigned',
  });
});

test('enterprise admin lead lists are tenant-wide', () => {
  assert.deepEqual(resolveStaffLeadListOptions('enterprise_admin', 7n), {});
});

test('Mini Program leads list routes measurer visibility through the shared helper', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../app/api/leads/route.ts'),
    'utf8'
  );
  assert.match(source, /resolveStaffLeadListOptions/);
  assert.match(source, /role === 'measurer' \? 'measurer'/);
});

test('Mini Program leads list accepts referrerMembershipId filtered against the tenant membership', () => {
  const route = fs.readFileSync(
    path.resolve(__dirname, '../../app/api/leads/route.ts'),
    'utf8'
  );
  const repository = fs.readFileSync(
    path.resolve(__dirname, '../../db/repositories/lead-repository.ts'),
    'utf8'
  );
  assert.match(route, /referrerMembershipId/);
  assert.match(route, /referrerEnterpriseMemberships/);
  assert.match(repository, /referrerMembershipId\?: bigint/);
  assert.match(repository, /eq\(leads\.referrerMembershipId, options\.referrerMembershipId\)/);
});
