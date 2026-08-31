import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mineRoute = readFileSync(
  new URL('../../app/api/miniprogram/mine/route.ts', import.meta.url),
  'utf8'
);

test('Mine exposes a personal referrer-network entry to each enterprise employee role', () => {
  for (const role of ['salesperson', 'designer', 'measurer']) {
    const roleActions = mineRoute.match(
      new RegExp(`\\n  ${role}: \\[([\\s\\S]*?)\\n  \\],`)
    )?.[1];

    assert.ok(roleActions, `${role} actions must exist`);
    assert.match(
      roleActions,
      /key: 'referrers', label: '我的推广人', sublabel: '邀请并查看我的推广人', icon: 'user-round-plus', target: 'referrers'/
    );
  }
});

test('Mine labels the enterprise-owner entry as the complete promotion network', () => {
  const ownerActions = mineRoute.match(
    /enterprise_admin: \[([\s\S]*?)\n  \],/
  )?.[1];

  assert.ok(ownerActions, 'enterprise_admin actions must exist');
  assert.match(
    ownerActions,
    /key: 'referrers', label: '推广网络', sublabel: '查看员工分支与全部推广人', icon: 'user-round-plus', target: 'referrers'/
  );
  assert.doesNotMatch(ownerActions, /已入驻推荐人|查看名单并停用扫码/);
});

test('Mine does not expose the referrer-network entry to non-enterprise roles', () => {
  for (const role of ['admin', 'super_admin']) {
    const roleActions = mineRoute.match(
      new RegExp(`\\n  ${role}: \\[([\\s\\S]*?)\\n  \\],`)
    )?.[1];

    assert.ok(roleActions, `${role} actions must exist`);
    assert.doesNotMatch(roleActions, /target: 'referrers'/);
  }
  assert.match(mineRoute, /admin: '平台管理员'/);
  assert.match(mineRoute, /super_admin: '平台管理员'/);
});

test('Mine filters the referrer entry through the signed-context capability', () => {
  assert.match(mineRoute, /getMiniProgramCapabilities\(\{/);
  assert.match(mineRoute, /enterpriseId: context\.enterpriseId/);
  assert.match(mineRoute, /ACTIONS_BY_ROLE\[role\] \|\| \[\]/);
  assert.doesNotMatch(
    mineRoute,
    /ACTIONS_BY_ROLE\[role\] \|\| ACTIONS_BY_ROLE\.enterprise_admin/
  );
  assert.match(
    mineRoute,
    /action\.target !== 'referrers' \|\|\s+capabilities\.includes\('referrer\.network'\)/
  );
});
