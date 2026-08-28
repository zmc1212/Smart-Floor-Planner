import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  hashSensitivePassword,
  isSensitivePasswordConfigured,
  validateSensitivePasswordInput,
} from '@/lib/enterprise-sensitive-password';
import {
  canManageSensitivePassword,
  sensitivePasswordApiPath,
} from '@/lib/sensitive-password-access';
import {
  buildLeadsExportCsv,
  escapeCsvCell,
  leadRecordToExportRow,
} from '@/lib/lead-export-csv';
import { getLeadSourceLabel } from '@/lib/lead-source-labels';

const sensitivePasswordRoute = fs.readFileSync(
  path.resolve(__dirname, '../../app/api/enterprise/sensitive-password/route.ts'),
  'utf8'
);
const adminSensitivePasswordRoute = fs.readFileSync(
  path.resolve(__dirname, '../../app/api/admin/sensitive-password/route.ts'),
  'utf8'
);
const proxySource = fs.readFileSync(
  path.resolve(__dirname, '../../proxy.ts'),
  'utf8'
);
const sensitivePasswordSettingsModal = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../components/admin/sensitive-password-settings-modal.tsx'
  ),
  'utf8'
);
const accountSettingsProvider = fs.readFileSync(
  path.resolve(__dirname, '../../components/admin/account-settings-provider.tsx'),
  'utf8'
);
const sidebar = fs.readFileSync(
  path.resolve(__dirname, '../../components/Sidebar.tsx'),
  'utf8'
);
const authPasswordRoute = fs.readFileSync(
  path.resolve(__dirname, '../../app/api/auth/password/route.ts'),
  'utf8'
);
const miniprogramPasswordRoute = fs.readFileSync(
  path.resolve(__dirname, '../../app/api/miniprogram/account/password/route.ts'),
  'utf8'
);
const referrerNetworkOperationsPage = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../app/(admin)/(merchant)/referrer-network-operations/page.tsx'
  ),
  'utf8'
);
const sensitivePasswordExportModal = fs.readFileSync(
  path.resolve(__dirname, '../../components/admin/sensitive-password-modal.tsx'),
  'utf8'
);
const leadsExportRoute = fs.readFileSync(
  path.resolve(__dirname, '../../app/api/leads/export/route.ts'),
  'utf8'
);
const enterprisesListPage = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../app/(admin)/(platform)/enterprises/page.tsx'
  ),
  'utf8'
);
const enterprisesDetailPage = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../app/(admin)/(platform)/enterprises/[id]/page.tsx'
  ),
  'utf8'
);
const platformEnterpriseDeleteModal = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../components/admin/platform-enterprise-delete-modal.tsx'
  ),
  'utf8'
);

test('isSensitivePasswordConfigured treats empty hash as unset', () => {
  assert.equal(isSensitivePasswordConfigured(null), false);
  assert.equal(isSensitivePasswordConfigured(''), false);
  assert.equal(isSensitivePasswordConfigured('   '), false);
  assert.equal(isSensitivePasswordConfigured('$2a$10$hash'), true);
});

test('validateSensitivePasswordInput enforces length and confirmation', () => {
  assert.throws(
    () => validateSensitivePasswordInput('12345', '12345'),
    /6–32/
  );
  assert.throws(
    () => validateSensitivePasswordInput('123456', '654321'),
    /不一致/
  );
  assert.equal(validateSensitivePasswordInput('  abc123  ', 'abc123'), 'abc123');
});

test('hashSensitivePassword produces bcrypt hash', async () => {
  const hash = await hashSensitivePassword('secure-pass');
  assert.match(hash, /^\$2[aby]\$/);
  assert.equal(await bcrypt.compare('secure-pass', hash), true);
});

test('escapeCsvCell quotes cells with commas and newlines', () => {
  assert.equal(escapeCsvCell('plain'), 'plain');
  assert.equal(escapeCsvCell('a,b'), '"a,b"');
  assert.equal(escapeCsvCell('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCsvCell('line\nbreak'), '"line\nbreak"');
  assert.equal(escapeCsvCell('13800138000', { forceSpreadsheetText: true }), '\t13800138000');
});

test('buildLeadsExportCsv includes BOM and Chinese headers', () => {
  const csv = buildLeadsExportCsv([]);
  assert.match(csv, /^\uFEFF客户称呼,手机号,小区/);
});

test('buildLeadsExportCsv forces phone and datetime cells as spreadsheet text', () => {
  const csv = buildLeadsExportCsv([
    {
      id: 1n,
      enterpriseId: 2n,
      name: '张三',
      phone: '18712345678',
      communityName: '阳光花园',
      city: '上海',
      area: '120',
      stylePreference: '现代',
      source: 'manual_entry',
      status: 'new',
      assignmentStatus: 'assigned',
      archivedAt: null,
      convertedOn: '2026-01-20',
      convertedAt: null,
      contractAmount: '128000',
      createdAt: new Date('2026-01-15T04:00:00.000Z'),
      floorPlanRecords: [],
      primaryFloorPlanRecord: null,
      assignedUser: {
        id: 3n,
        displayName: '李设计',
        username: 'designer1',
        phone: '15912345678',
        role: 'designer',
      },
      measurerUser: {
        id: 4n,
        displayName: '赵测量',
        username: 'measurer1',
        phone: '14012345678',
        role: 'measurer',
      },
      promoter: null,
      referrer: {
        id: 5n,
        membershipId: 6n,
        displayName: '王推荐',
        username: 'referrer1',
        phone: '13700137000',
        role: 'referrer',
      },
      archivedUser: null,
      convertedUser: null,
      appointment: {
        id: 7n,
        address: '阳光花园 3 栋',
        timeRange: '2026-01-20 10:00-12:00',
        status: 'confirmed',
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    } as Parameters<typeof leadRecordToExportRow>[0],
  ]);

  assert.match(csv, /,\t18712345678,/);
  assert.match(csv, /,\t13700137000,/);
  assert.match(csv, /,\t15912345678,/);
  assert.match(csv, /,\t14012345678,/);
  assert.match(csv, /,\t2026-01-20 10:00-12:00,/);
  assert.match(csv, /,\t128000,/);
  assert.match(csv, /,\t2026-01-20,/);
  assert.match(csv, /,\t2026-01-15 /);
});

test('leadRecordToExportRow maps core business fields', () => {
  const row = leadRecordToExportRow({
    id: 1n,
    enterpriseId: 2n,
    name: '张三',
    phone: '13800138000',
    communityName: '阳光花园',
    city: '上海',
    area: '120',
    stylePreference: '现代',
    source: 'manual_entry',
    status: 'new',
    assignmentStatus: 'assigned',
    serviceStageLabel: '新线索',
    archivedAt: null,
    convertedOn: null,
    convertedAt: null,
    contractAmount: null,
    createdAt: new Date('2026-01-15T04:00:00.000Z'),
    floorPlanRecords: [],
    primaryFloorPlanRecord: null,
    assignedUser: {
      id: 3n,
      displayName: '李设计',
      username: 'designer1',
      phone: '13900139000',
      role: 'designer',
    },
    measurerUser: null,
    promoter: null,
    referrer: {
      id: 4n,
      membershipId: 5n,
      displayName: '王推荐',
      username: 'referrer1',
      phone: '13700137000',
      role: 'referrer',
    },
    archivedUser: null,
    convertedUser: null,
    appointment: {
      id: 6n,
      address: '阳光花园 3 栋',
      timeRange: '2026-01-20 10:00-12:00',
      status: 'confirmed',
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  } as Parameters<typeof leadRecordToExportRow>[0]);

  assert.equal(row[0], '张三');
  assert.equal(row[1], '13800138000');
  assert.equal(row[6], getLeadSourceLabel('manual_entry'));
  assert.equal(row[10], '王推荐');
  assert.equal(row[12], '李设计');
  assert.equal(row[13], '13900139000');
  assert.equal(row[16], '阳光花园 3 栋');
  assert.equal(row[21], '否');
});

test('sensitive password API is enterprise_admin only', () => {
  assert.match(sensitivePasswordRoute, /roles:\s*\['enterprise_admin'\]/);
  assert.match(sensitivePasswordRoute, /setEnterpriseSensitivePassword/);
  assert.match(sensitivePasswordRoute, /isSensitivePasswordConfigured/);
});

test('platform admin sensitive password API is super_admin/admin only', () => {
  assert.match(
    adminSensitivePasswordRoute,
    /roles:\s*\['super_admin', 'admin'\]/
  );
  assert.match(adminSensitivePasswordRoute, /requireEnterprise:\s*false/);
  assert.match(adminSensitivePasswordRoute, /setAdminSensitivePassword/);
  assert.match(adminSensitivePasswordRoute, /isSensitivePasswordConfigured/);
  assert.doesNotMatch(adminSensitivePasswordRoute, /setEnterpriseSensitivePassword/);
  assert.doesNotMatch(
    proxySource,
    /\/api\/admin\/sensitive-password/
  );
});

test('platform and enterprise sensitive password APIs stay on separate hashes', () => {
  const helper = fs.readFileSync(
    path.resolve(__dirname, '../enterprise-sensitive-password.ts'),
    'utf8'
  );
  assert.match(helper, /export async function verifyAdminSensitivePassword/);
  assert.match(helper, /export async function setAdminSensitivePassword/);
  assert.match(helper, /new AdminUserRepository/);
  assert.match(helper, /请先设置安全密码/);
  assert.match(helper, /请先设置企业安全密码/);
});

test('sensitive password access helper routes by role', () => {
  assert.equal(canManageSensitivePassword('enterprise_admin'), true);
  assert.equal(canManageSensitivePassword('admin'), true);
  assert.equal(canManageSensitivePassword('super_admin'), true);
  assert.equal(canManageSensitivePassword('designer'), false);
  assert.equal(
    sensitivePasswordApiPath('admin'),
    '/api/admin/sensitive-password'
  );
  assert.equal(
    sensitivePasswordApiPath('super_admin'),
    '/api/admin/sensitive-password'
  );
  assert.equal(
    sensitivePasswordApiPath('enterprise_admin'),
    '/api/enterprise/sensitive-password'
  );
});

test('sensitive password settings modal does not notify parent during GET status load', () => {
  const loadStatusStart = sensitivePasswordSettingsModal.indexOf(
    'const loadStatus = useCallback'
  );
  const loadStatusEnd = sensitivePasswordSettingsModal.indexOf('useEffect', loadStatusStart);
  const loadStatusBlock = sensitivePasswordSettingsModal.slice(
    loadStatusStart,
    loadStatusEnd
  );

  assert.ok(
    loadStatusBlock.includes('sensitivePasswordApiPath(user.role)') ||
      loadStatusBlock.includes("fetch('/api/enterprise/sensitive-password')")
  );
  assert.doesNotMatch(loadStatusBlock, /onSaved/);
  assert.match(sensitivePasswordSettingsModal, /sensitivePasswordApiPath/);
  assert.match(
    sensitivePasswordSettingsModal,
    /与登录密码分离，用于删除企业等危险操作确认/
  );
  assert.match(sensitivePasswordSettingsModal, /onSaved\?\.\(\)/);
});

test('referrer network operations page no longer embeds sensitive password card', () => {
  assert.doesNotMatch(referrerNetworkOperationsPage, /EnterpriseSensitivePasswordCard/);
  assert.match(referrerNetworkOperationsPage, /openSensitivePassword/);
  assert.match(referrerNetworkOperationsPage, /onSaved:\s*\(\)\s*=>\s*void loadReadiness\(\)/);
});

test('account settings provider exposes shared modal entry points', () => {
  assert.match(accountSettingsProvider, /openLoginPassword/);
  assert.match(accountSettingsProvider, /openSensitivePassword/);
  assert.match(accountSettingsProvider, /LoginPasswordSettingsModal/);
  assert.match(accountSettingsProvider, /SensitivePasswordSettingsModal/);
  assert.match(accountSettingsProvider, /canManageSensitivePassword\(user\?\.role\)/);
});

test('sidebar avatar dropdown includes password actions and logout', () => {
  assert.match(sidebar, /trigger=\{\['hover', 'click'\]\}/);
  assert.match(sidebar, /修改登录密码/);
  assert.match(sidebar, /修改安全密码/);
  assert.match(sidebar, /canManageSensitivePassword\(admin\?\.role\)/);
  assert.equal((sidebar.match(/退出系统/g) || []).length, 1);
});

test('admin auth password route validates current password and length', () => {
  assert.match(authPasswordRoute, /getTenantContext/);
  assert.match(authPasswordRoute, /currentPassword/);
  assert.match(authPasswordRoute, /confirmPassword/);
  assert.match(authPasswordRoute, /新密码不能少于 6 位/);
  assert.match(authPasswordRoute, /新密码不能超过 32 位/);
  assert.match(authPasswordRoute, /新密码不能与当前密码相同/);
  assert.match(authPasswordRoute, /AdminUserRepository/);
});

test('admin auth password route is separate from miniprogram password route', () => {
  assert.match(miniprogramPasswordRoute, /resolveMiniProgramContext/);
  assert.doesNotMatch(authPasswordRoute, /resolveMiniProgramContext/);
  assert.doesNotMatch(miniprogramPasswordRoute, /getTenantContext/);
});

test('leads export modal opens shared sensitive password settings instead of navigating away', () => {
  assert.match(sensitivePasswordExportModal, /openSensitivePassword\(\)/);
  assert.doesNotMatch(sensitivePasswordExportModal, /referrer-network-operations/);
});

test('leads export API is enterprise_admin only and verifies security password', () => {
  assert.match(leadsExportRoute, /roles:\s*\['enterprise_admin'\]/);
  assert.match(leadsExportRoute, /verifyEnterpriseSensitivePassword/);
  assert.match(leadsExportRoute, /buildLeadsExportCsv/);
  assert.match(leadsExportRoute, /archiveState:\s*'all'/);
  assert.match(leadsExportRoute, /text\/csv; charset=utf-8/);
});

test('enterprises list and detail delete dialogs use the platform sensitive password', () => {
  assert.match(enterprisesListPage, /PlatformEnterpriseDeleteModal/);
  assert.match(enterprisesListPage, /label: '删除企业'/);
  assert.match(enterprisesListPage, /批量删除/);
  assert.match(enterprisesDetailPage, /删除企业/);
  assert.match(enterprisesDetailPage, /PlatformEnterpriseDeleteModal/);
  assert.match(platformEnterpriseDeleteModal, /PLATFORM_SENSITIVE_PASSWORD_API/);
  assert.match(platformEnterpriseDeleteModal, /openSensitivePassword/);
  assert.doesNotMatch(
    platformEnterpriseDeleteModal,
    /\/api\/enterprise\/sensitive-password/
  );
});
