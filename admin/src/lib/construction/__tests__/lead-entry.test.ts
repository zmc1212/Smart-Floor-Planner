import assert from 'node:assert/strict';
import { test } from 'node:test';
import { constructionLeadEntry } from '@/components/construction/lead-entry';
import { getDefaultMenuKeys, isEnterpriseManagementRole } from '@/lib/admin-user-roles';

const owner = { role: 'enterprise_admin', effectivePermissions: ['leads', 'construction-projects'] };
const lead = { _id: '123', status: 'new' };

test('owners, administrators and super administrators inherit the same customer-to-project entry', () => {
  for (const role of ['enterprise_admin', 'admin', 'super_admin']) {
    const user = { ...owner, role };
    assert.equal(isEnterpriseManagementRole(role), true);
    assert.equal(constructionLeadEntry(user, lead), '/construction-projects?leadId=123');
    assert.equal(constructionLeadEntry(user, { ...lead, status: 'converted' }), '/construction-projects?leadId=123');
    assert.equal(constructionLeadEntry(user, { ...lead, status: 'closed' }), null);
    assert.equal(constructionLeadEntry(user, { ...lead, archivedAt: '2026-10-17' }), null);
    assert.equal(constructionLeadEntry({ ...user, effectivePermissions: ['leads'] }, lead), null);
  }
});

test('lead entry preserves owner/menu and archived/closed boundaries', () => {
  for (const role of ['designer', 'construction_staff', 'measurer', 'salesperson', 'viewer']) {
    assert.equal(isEnterpriseManagementRole(role), false);
    assert.equal(constructionLeadEntry({ ...owner, role }, lead), null, role);
  }
  assert.equal(constructionLeadEntry({ ...owner, effectivePermissions: ['leads'] }, lead), null);
  assert.equal(constructionLeadEntry(owner, { ...lead, status: 'closed' }), null);
  assert.equal(constructionLeadEntry(owner, { ...lead, archivedAt: '2026-10-17' }), null);
  assert.equal(constructionLeadEntry(null, lead), null);
  assert.equal(constructionLeadEntry(owner, null), null);
  for (const _id of ['0', '-1', '123/other', '123?enterpriseId=9']) assert.equal(constructionLeadEntry(owner, { ...lead, _id }), null);
});

test('administrator default menus include every enterprise-owner default permission', () => {
  for (const role of ['admin', 'super_admin']) {
    const permissions = new Set(getDefaultMenuKeys(role));
    for (const permission of getDefaultMenuKeys('enterprise_admin')) assert.ok(permissions.has(permission), `${role} must inherit ${permission}`);
  }
});
