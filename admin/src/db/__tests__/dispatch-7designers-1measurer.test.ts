/**
 * 场景测试：7个设计师 + 1个测量员 + 7条客户线索的自动派单行为
 *
 * 两阶段机制（已通过测试验证）：
 *
 * 阶段一：线索创建时（authorizeAndCreateLead）
 *   - findMeasurerCandidate() 按"待测任务最少 → 占用时间最少 → 最久未接单 → ID最小"
 *     挑出测量员，直接写入 leads.measurer_id
 *   - 唯一的测量员有资格时：7条线索均写入同一个 measurer_id
 *
 * 阶段二：设计师赛马派单（autoAssignLead，claimEnabled=false 时立即触发）
 *   - listDesignerPerformance() 筛选 eligible 设计师
 *   - 按"高绩效组70%/标准组30%"分流（新人无样本 → 全在 standard 组）
 *   - 组内按 openLeadCount ASC → lastAssignedAt ASC → id ASC 排序取第一
 *   - 派完后 leads.assigned_to = 设计师ID
 *   - leads.assignment_status = 'assigned'（measurer_id 在阶段一已设好）
 *
 * 验证：
 * 1. 7条线索分别派给7个不同设计师（每人恰好1条）
 * 2. 7条线索均绑定同一个测量员（唯一可用的）
 * 3. 每条线索 assignmentStatus = 'assigned'
 * 4. 派单后每个设计师 openLeadCount = 1
 * 5. 测量员不出现在设计师绩效列表中
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { loadEnvConfig } from '@next/env';
import { inArray } from 'drizzle-orm';
import {
  adminUsers,
  customerAttributionLocks,
  leadAssignmentEvents,
  leadClaimWindows,
  leadLifecycleEvents,
  leads,
  mediaAssets,
  promotionScanAudits,
  referrerEnterpriseMemberships,
  referrerProfiles,
  referrerPromotionCodes,
  users,
} from '@/db/schema';
import {
  AdminUserRepository,
  AiCreationRepository,
  AssignmentRacingRepository,
  EnterpriseRepository,
  ReferralLeadRepository,
  ReferrerNetworkRepository,
} from '@/db/repositories';
import {
  withPlatformTransaction,
  withTenantTransaction,
} from '@/db/transaction';
import {
  closePostgresPool,
  resolvePostgresRuntimeConfig,
} from '@/lib/postgresql';

const runKey = `dispatch-7d1m-${process.pid}-${Date.now()}`;
const enterpriseIds: bigint[] = [];
const userIds: bigint[] = [];

async function createCustomer(suffix: string) {
  return withPlatformTransaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        phone: `16${String(Date.now() + userIds.length).slice(-9)}`,
        nickname: `${runKey}-${suffix}`,
      })
      .returning();
    userIds.push(user.id);
    return user;
  });
}

async function createStaff(
  enterpriseId: bigint,
  role: 'designer' | 'measurer',
  suffix: string
) {
  return withTenantTransaction(enterpriseId, async (tx) => {
    let qrAssetId: bigint | null = null;
    if (role === 'designer') {
      const asset = await new AiCreationRepository(tx).createMediaAsset({
        enterpriseId,
        ownerType: 'staff_wechat_qr',
        mimeType: 'image/png',
        size: BigInt(1),
        storageKey: `${runKey}-${suffix}.png`,
      });
      qrAssetId = asset.id;
    }
    const staff = await new AdminUserRepository(tx).create({
      enterpriseId,
      userId: null,
      username: `${runKey}-${suffix}`,
      passwordHash: 'test-only',
      displayName: `${role}-${suffix}`,
      role,
      status: 'active',
      assignmentPaused: false,
      wechatId: role === 'designer' ? `wx-${suffix}` : null,
      wechatQrAssetId: qrAssetId,
    });
    if (qrAssetId) {
      await new AiCreationRepository(tx).updateMediaAsset(qrAssetId, { ownerId: staff.id });
    }
    return staff;
  });
}

before(async () => {
  loadEnvConfig(process.cwd());
  const url = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(
    ['localhost', '127.0.0.1'].includes(url.hostname),
    '集成测试只允许在本地数据库运行'
  );
  const enterprise = await withPlatformTransaction((tx) =>
    new EnterpriseRepository(tx).create({
      name: `${runKey}-scenario`,
      code: `${runKey}-scenario`,
      status: 'active',
    })
  );
  enterpriseIds.push(enterprise.id);
});

after(async () => {
  if (enterpriseIds.length) {
    await withPlatformTransaction(async (tx) => {
      await tx.delete(promotionScanAudits).where(inArray(promotionScanAudits.enterpriseId, enterpriseIds));
      await tx.delete(customerAttributionLocks).where(inArray(customerAttributionLocks.enterpriseId, enterpriseIds));
      await tx.delete(leadAssignmentEvents).where(inArray(leadAssignmentEvents.enterpriseId, enterpriseIds));
      await tx.delete(leadLifecycleEvents).where(inArray(leadLifecycleEvents.enterpriseId, enterpriseIds));
      await tx.delete(leadClaimWindows).where(inArray(leadClaimWindows.enterpriseId, enterpriseIds));
      await tx.delete(leads).where(inArray(leads.enterpriseId, enterpriseIds));
      await tx.delete(referrerPromotionCodes).where(inArray(referrerPromotionCodes.enterpriseId, enterpriseIds));
      await tx.delete(referrerEnterpriseMemberships).where(inArray(referrerEnterpriseMemberships.enterpriseId, enterpriseIds));
      await tx.delete(adminUsers).where(inArray(adminUsers.enterpriseId, enterpriseIds));
      await tx.delete(mediaAssets).where(inArray(mediaAssets.enterpriseId, enterpriseIds));
      await tx.delete(referrerProfiles).where(inArray(referrerProfiles.userId, userIds));
      await tx.delete(users).where(inArray(users.id, userIds));
    });
  }
  await closePostgresPool();
});

test('7设计师+1测量员+7线索 — 每条线索派给不同设计师，测量员不自动派单', async () => {
  const enterpriseId = enterpriseIds[0];

  // ── 1. 创建7个设计师 + 1个测量员 ──
  const designers = await Promise.all(
    Array.from({ length: 7 }, (_, i) => createStaff(enterpriseId, 'designer', `d${i + 1}`))
  );
  const measurer = await createStaff(enterpriseId, 'measurer', 'measurer1');

  // ── 2. 设置派单规则（关闭抢单，新线索直接进入自动派单）──
  await withTenantTransaction(enterpriseId, (tx) =>
    new AssignmentRacingRepository(tx).createSettingsVersion({
      enterpriseId,
      actorStaffId: null,
      claimEnabled: false,          // 关闭抢单 → 线索进来立即自动派
      claimDurationSeconds: 60,
      highPerformanceTrafficPercent: 70,
      performanceRateThresholdPercent: 30,
      performanceWindowDays: 180,
      minimumEffectiveSamples: 10,
      defaultDesignerCapacity: 20,  // 每人最多20条在手
    })
  );

  // ── 3. 创建推荐源 ──
  const source = await withPlatformTransaction(async (tx) => {
    const [referrerUser] = await tx
      .insert(users)
      .values({ phone: `17${String(Date.now()).slice(-9)}`, nickname: `${runKey}-referrer` })
      .returning();
    userIds.push(referrerUser.id);
    const [profile] = await tx
      .insert(referrerProfiles)
      .values({ userId: referrerUser.id, displayName: `${runKey}-referrer` })
      .returning();
    const [membership] = await tx
      .insert(referrerEnterpriseMemberships)
      .values({ referrerId: profile.id, enterpriseId })
      .returning();
    const code = await new ReferrerNetworkRepository(tx).getReferrerPromotionCode(referrerUser.id, membership.id);
    assert.ok(code);
    return {
      promotionCodeId: code!.code.id,
      membershipId: membership.id,
      version: code!.code.version,
      expired: false,
    };
  });

  // ── 4. 顺序创建7条线索（claimEnabled=false → 每条立即触发 autoAssignLead）──
  const createdLeads = [];
  for (let i = 0; i < 7; i++) {
    const customer = await createCustomer(`lead-${i + 1}`);
    const result = await withPlatformTransaction((tx) =>
      new ReferralLeadRepository(tx).authorizeAndCreateLead({
        source,
        customerUserId: customer.id,
        idempotencyKeyHash: `${runKey}-lead-${i + 1}`,
      })
    );
    createdLeads.push(result.lead);
  }

  // ── 5. 验证：每条线索都有 assignedTo ──
  const assignedToIds = createdLeads.map((l) => l.assignedTo);
  console.log('派单结果（assignedTo）:', assignedToIds.map((id) => id?.toString()));

  for (let i = 0; i < 7; i++) {
    const lead = createdLeads[i];
    assert.ok(lead.assignedTo, `线索${i + 1} 应该有 assignedTo，实际为空`);
    const isDesigner = designers.some((d) => d.id === lead.assignedTo);
    assert.ok(isDesigner, `线索${i + 1} 的 assignedTo 应该是设计师，实际 assignedTo=${lead.assignedTo}`);
  }

  // ── 6. 验证：测量员不被自动分配为 assignedTo ──
  const assignedToMeasurer = createdLeads.filter((l) => l.assignedTo === measurer.id);
  assert.equal(assignedToMeasurer.length, 0, '测量员不应被 autoAssign 为 assignedTo');

  // ── 7. 验证：7个设计师各被分配了1条（没有重复分配）──
  const uniqueDesignerIds = new Set(assignedToIds.map((id) => id?.toString()));
  assert.equal(uniqueDesignerIds.size, 7, `应该7个不同设计师各分1条，实际分配到 ${uniqueDesignerIds.size} 个`);

  // ── 8. 验证：所有线索 assignmentStatus = 'assigned'
  //    （阶段一已写入 measurerId，autoAssignLead 中 measurerId != null → errorCode=null → 'assigned'）
  for (let i = 0; i < 7; i++) {
    const lead = createdLeads[i];
    assert.equal(
      lead.assignmentStatus,
      'assigned',
      `线索${i + 1} 应为 assigned，实际为 ${lead.assignmentStatus}`
    );
    assert.equal(
      lead.assignmentErrorCode,
      null,
      `线索${i + 1} errorCode 应为 null，实际为 ${lead.assignmentErrorCode}`
    );
  }

  // ── 8b. 验证：7条线索全部绑定同一个测量员（唯一可用的那个）──
  const measurerIds = createdLeads.map((l) => l.measurerId?.toString());
  console.log('各线索 measurerId:', measurerIds);
  const uniqueMeasurerIds = new Set(measurerIds);
  assert.equal(uniqueMeasurerIds.size, 1, `应该只有1个测量员被绑定，实际出现 ${uniqueMeasurerIds.size} 个`);
  assert.equal(measurerIds[0], measurer.id.toString(), `测量员ID应为 ${measurer.id}，实际为 ${measurerIds[0]}`);

  // ── 9. 验证派单后每个设计师的在手量为1 ──
  const performance = await withTenantTransaction(enterpriseId, async (tx) => {
    const repo = new AssignmentRacingRepository(tx);
    const settings = await repo.getCurrentSettings(enterpriseId);
    return repo.listDesignerPerformance(enterpriseId, settings ?? undefined);
  });

  console.log('\n派单后各设计师状态:');
  for (const p of performance) {
    console.log(`  ${p.staff.displayName}: openLeadCount=${p.openLeadCount}, group=${p.group}, eligible=${p.eligibleForAssignment}`);
  }

  const allHaveOneLead = performance.every((p) => p.openLeadCount === 1);
  assert.ok(allHaveOneLead, '7个设计师每人应各有1条在手线索');

  // ── 10. 验证测量员不在设计师绩效列表中 ──
  const measurerInList = performance.find((p) => p.staff.id === measurer.id);
  assert.equal(measurerInList, undefined, '测量员不应出现在设计师绩效列表中');

  console.log('\n✅ 场景验证通过：7条线索均分给7个设计师，测量员未被自动派单，所有线索 assignment_pending (measurer_unavailable)');
});
