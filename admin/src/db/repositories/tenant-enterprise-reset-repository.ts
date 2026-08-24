import { and, count, eq, notInArray, sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import {
  adminUsers,
  customerAttributionLocks,
  departments,
  enterpriseAppointmentSettings,
  enterpriseAssignmentSettingVersions,
  enterpriseCommissionRules,
  enterpriseJoinCodes,
  enterpriseStatusEvents,
  enterprises,
  floorPlans,
  leads,
  leadSitePhotos,
  leadClaimWindows,
  leadOutcomeSnapshots,
  assignmentDistributionCounters,
  measurementAppointments,
  mediaAssets,
  referrerEnterpriseMemberships,
  referrerProfiles,
  staffActivityCodes,
  staffNotifications,
  aiCreditAccounts,
  aiGenerations,
  aiWorkflows,
  leadCommissions,
  users,
  workflowNotificationLogs,
} from '@/db/schema';

export type EnterpriseResetCount = {
  table: string;
  label: string;
  count: number;
};

export type EnterpriseResetMode = 'reset' | 'purge';

export type EnterpriseResetPreview = {
  enterpriseId: string;
  enterpriseName: string;
  mode: EnterpriseResetMode;
  retainOperator: boolean;
  retainedOperatorAdminUserId: string | null;
  retainedOperatorDisplayName: string | null;
  counts: EnterpriseResetCount[];
  totalRows: number;
};

export type EnterpriseResetResult = EnterpriseResetPreview & {
  deleted: EnterpriseResetCount[];
  enterpriseDeleted?: boolean;
};

function asCount(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function isTenantEnterpriseResetAllowed() {
  if (process.env.ALLOW_TENANT_ENTERPRISE_RESET === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

export class TenantEnterpriseResetRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  private async resolveRetainedOperator(enterpriseId: bigint, actorAdminUserId: bigint) {
    const [exact] = await this.transaction
      .select({
        id: adminUsers.id,
        displayName: adminUsers.displayName,
        role: adminUsers.role,
      })
      .from(adminUsers)
      .where(and(eq(adminUsers.id, actorAdminUserId), eq(adminUsers.enterpriseId, enterpriseId)))
      .limit(1);
    if (exact) {
      return { id: exact.id, displayName: exact.displayName || exact.role };
    }

    const [fallback] = await this.transaction
      .select({
        id: adminUsers.id,
        displayName: adminUsers.displayName,
        role: adminUsers.role,
      })
      .from(adminUsers)
      .where(and(eq(adminUsers.enterpriseId, enterpriseId), eq(adminUsers.role, 'enterprise_admin')))
      .orderBy(adminUsers.id)
      .limit(1);
    if (fallback) {
      return { id: fallback.id, displayName: fallback.displayName || fallback.role };
    }
    return null;
  }

  // Tables share an enterprise_id column; keep the helper table-agnostic.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle table variance
  private async countEq(table: any, enterpriseId: bigint) {
    const rows = await this.transaction
      .select({ value: count() })
      .from(table)
      .where(eq(table.enterpriseId, enterpriseId));
    return asCount(rows[0]?.value);
  }

  private async collectCounts(
    enterpriseId: bigint,
    retainedOperatorId: bigint | null,
    mode: EnterpriseResetMode
  ) {
    const staffWhere = retainedOperatorId
      ? and(eq(adminUsers.enterpriseId, enterpriseId), notInArray(adminUsers.id, [retainedOperatorId]))
      : eq(adminUsers.enterpriseId, enterpriseId);
    const staffRows = await this.transaction.select({ value: count() }).from(adminUsers).where(staffWhere);

    const counts: EnterpriseResetCount[] = [
      { table: 'leads', label: '线索', count: await this.countEq(leads, enterpriseId) },
      { table: 'lead_claim_windows', label: '抢单窗口', count: await this.countEq(leadClaimWindows, enterpriseId) },
      { table: 'lead_outcome_snapshots', label: '经营结果快照', count: await this.countEq(leadOutcomeSnapshots, enterpriseId) },
      { table: 'assignment_distribution_counters', label: '派单分流计数', count: await this.countEq(assignmentDistributionCounters, enterpriseId) },
      { table: 'enterprise_assignment_setting_versions', label: '派单规则版本', count: await this.countEq(enterpriseAssignmentSettingVersions, enterpriseId) },
      {
        table: 'customer_attribution_locks',
        label: '客户归属锁',
        count: await this.countEq(customerAttributionLocks, enterpriseId),
      },
      {
        table: 'measurement_appointments',
        label: '预约',
        count: await this.countEq(measurementAppointments, enterpriseId),
      },
      { table: 'lead_commissions', label: '提成台账', count: await this.countEq(leadCommissions, enterpriseId) },
      { table: 'floor_plans', label: '户型', count: await this.countEq(floorPlans, enterpriseId) },
      { table: 'ai_workflows', label: 'AI 方案', count: await this.countEq(aiWorkflows, enterpriseId) },
      { table: 'ai_generations', label: 'AI 生成', count: await this.countEq(aiGenerations, enterpriseId) },
      { table: 'enterprise_join_codes', label: '入驻码', count: await this.countEq(enterpriseJoinCodes, enterpriseId) },
      {
        table: 'referrer_enterprise_memberships',
        label: '推荐人成员',
        count: await this.countEq(referrerEnterpriseMemberships, enterpriseId),
      },
      {
        table: 'staff_activity_codes',
        label: '员工活动码',
        count: await this.countEq(staffActivityCodes, enterpriseId),
      },
      {
        table: 'enterprise_appointment_settings',
        label: '预约设置',
        count: await this.countEq(enterpriseAppointmentSettings, enterpriseId),
      },
      {
        table: 'enterprise_commission_rules',
        label: '提成规则',
        count: await this.countEq(enterpriseCommissionRules, enterpriseId),
      },
      {
        table: 'admin_users',
        label: mode === 'purge' ? '全部员工账号' : '其他员工账号',
        count: asCount(staffRows[0]?.value),
      },
      { table: 'departments', label: '部门', count: await this.countEq(departments, enterpriseId) },
      { table: 'lead_site_photos', label: '房屋现场图', count: await this.countEq(leadSitePhotos, enterpriseId) },
      { table: 'media_assets', label: '企业媒体记录', count: await this.countEq(mediaAssets, enterpriseId) },
      {
        table: 'workflow_notification_logs',
        label: '通知日志',
        count: await this.countEq(workflowNotificationLogs, enterpriseId),
      },
      {
        table: 'staff_notifications',
        label: '站内通知',
        count: await this.countEq(staffNotifications, enterpriseId),
      },
      {
        table: 'ai_credit_accounts',
        label: 'AI 点数账户',
        count: await this.countEq(aiCreditAccounts, enterpriseId),
      },
    ];

    if (mode === 'purge') {
      counts.push({
        table: 'enterprise_status_events',
        label: '企业状态事件',
        count: await this.countEq(enterpriseStatusEvents, enterpriseId),
      });
      counts.push({ table: 'enterprises', label: '企业壳', count: 1 });
    }

    return counts;
  }

  private async loadEnterprise(enterpriseId: bigint) {
    const [enterprise] = await this.transaction
      .select({ id: enterprises.id, name: enterprises.name })
      .from(enterprises)
      .where(eq(enterprises.id, enterpriseId))
      .limit(1);
    if (!enterprise) {
      throw Object.assign(new Error('企业不存在'), { status: 404, code: 'enterprise_not_found' });
    }
    return enterprise;
  }

  async preview(enterpriseId: bigint, actorAdminUserId: bigint): Promise<EnterpriseResetPreview> {
    const enterprise = await this.loadEnterprise(enterpriseId);
    const retained = await this.resolveRetainedOperator(enterpriseId, actorAdminUserId);
    const counts = await this.collectCounts(enterpriseId, retained?.id ?? null, 'reset');
    return {
      enterpriseId: enterprise.id.toString(),
      enterpriseName: enterprise.name,
      mode: 'reset',
      retainOperator: true,
      retainedOperatorAdminUserId: retained?.id.toString() ?? null,
      retainedOperatorDisplayName: retained?.displayName ?? null,
      counts,
      totalRows: counts.reduce((sum, item) => sum + item.count, 0),
    };
  }

  async previewPurge(enterpriseId: bigint): Promise<EnterpriseResetPreview> {
    const enterprise = await this.loadEnterprise(enterpriseId);
    const counts = await this.collectCounts(enterpriseId, null, 'purge');
    return {
      enterpriseId: enterprise.id.toString(),
      enterpriseName: enterprise.name,
      mode: 'purge',
      retainOperator: false,
      retainedOperatorAdminUserId: null,
      retainedOperatorDisplayName: null,
      counts,
      totalRows: counts.reduce((sum, item) => sum + item.count, 0),
    };
  }

  private async execDelete(label: string, table: string, query: ReturnType<typeof sql>) {
    const result = await this.transaction.execute(query);
    return { table, label, count: asCount(result.rowCount) } satisfies EnterpriseResetCount;
  }

  /**
   * Deletes all enterprise-scoped business rows and staff (optionally retaining one operator).
   * Does not touch enterprise_status_events or the enterprises shell row.
   */
  private async wipeEnterpriseScopedData(
    enterpriseId: bigint,
    options: { retainOperatorId: bigint | null }
  ): Promise<EnterpriseResetCount[]> {
    const retainedId = options.retainOperatorId;

    if (retainedId) {
      await this.transaction
        .update(adminUsers)
        .set({ wechatQrAssetId: null, departmentId: null, updatedAt: new Date() })
        .where(eq(adminUsers.id, retainedId));
    }

    const membershipIds = await this.transaction
      .select({
        id: referrerEnterpriseMemberships.id,
        referrerId: referrerEnterpriseMemberships.referrerId,
      })
      .from(referrerEnterpriseMemberships)
      .where(eq(referrerEnterpriseMemberships.enterpriseId, enterpriseId));

    const deleted: EnterpriseResetCount[] = [];

    deleted.push(
      await this.execDelete(
        'AI 任务参考图',
        'ai_creation_task_reference_assets',
        sql`delete from app.ai_creation_task_reference_assets
            where task_id in (select id from app.ai_creation_tasks where enterprise_id = ${enterpriseId})`
      )
    );
    deleted.push(
      await this.execDelete(
        'AI 批次参考图',
        'ai_creation_batch_reference_assets',
        sql`delete from app.ai_creation_batch_reference_assets
            where batch_id in (select id from app.ai_creation_batches where enterprise_id = ${enterpriseId})`
      )
    );
    deleted.push(
      await this.execDelete(
        '线索户型关联',
        'lead_floor_plans',
        sql`delete from app.lead_floor_plans
            where lead_id in (select id from app.leads where enterprise_id = ${enterpriseId})
               or floor_plan_id in (select id from app.floor_plans where enterprise_id = ${enterpriseId})`
      )
    );

    const enterpriseDeletes: Array<[string, string]> = [
      ['ai_generation_publications', '方案发布'],
      ['ai_provider_attempts', 'AI 供应商尝试'],
      ['ai_credit_ledgers', 'AI 点数字流水'],
      ['ai_creation_batches', 'AI 创作批次'],
      ['ai_creation_tasks', 'AI 创作任务'],
      ['ai_generations', 'AI 生成'],
      ['ai_workflows', 'AI 方案'],
      ['ai_chat_sessions', 'AI 会话'],
      ['ai_credit_accounts', 'AI 点数账户'],
      ['enterprise_ai_usage_snapshots', 'AI 用量快照'],
      ['measurement_appointment_events', '预约事件'],
      ['measurement_appointments', '预约'],
      ['staff_unavailability_periods', '不可用时间'],
      ['customer_attribution_locks', '客户归属锁'],
      ['lead_assignment_events', '派单事件'],
      ['lead_claim_windows', '抢单窗口'],
      ['lead_outcome_snapshots', '经营结果快照'],
      ['assignment_distribution_counters', '派单分流计数'],
      ['staff_notifications', '站内通知'],
      ['lead_commissions', '提成台账'],
      ['lead_lifecycle_events', '线索生命周期'],
      ['measurements', '量房记录'],
      ['floor_plans', '户型'],
      ['lead_site_photos', '房屋现场图'],
      ['leads', '线索'],
      ['commission_records', '旧提成记录'],
      ['enterprise_orders', '企业订单'],
      ['workflow_notification_logs', '通知日志'],
      ['promotion_enterprise_records', '推广记录'],
      ['promotion_scan_audits', '扫码审计'],
      ['staff_activity_codes', '员工活动码'],
      ['referrer_promotion_codes', '推广服务码'],
      ['referrer_enterprise_memberships', '推荐人成员'],
      ['enterprise_join_code_events', '入驻码审计'],
      ['enterprise_join_codes', '入驻码'],
      ['enterprise_commission_rules', '提成规则'],
      ['enterprise_appointment_settings', '预约设置'],
      ['enterprise_assignment_setting_versions', '派单规则版本'],
      ['enterprise_role_capabilities', '角色能力'],
      ['admin_user_capability_overrides', '员工能力覆盖'],
      ['device_user_bindings', '设备绑定'],
      ['devices', '设备'],
      ['inspirations', '灵感'],
      ['media_assets', '企业媒体记录'],
    ];

    for (const [table, label] of enterpriseDeletes) {
      deleted.push(
        await this.execDelete(
          label,
          table,
          sql`delete from app.${sql.raw(table)} where enterprise_id = ${enterpriseId}`
        )
      );
    }

    // Promoter bindings are staff-scoped without enterprise_id.
    deleted.push(
      await this.execDelete(
        '员工推广人绑定',
        'admin_user_promoters',
        sql`delete from app.admin_user_promoters
            where admin_user_id in (select id from app.admin_users where enterprise_id = ${enterpriseId})
               or promoter_id in (select id from app.admin_users where enterprise_id = ${enterpriseId})`
      )
    );

    let orphanProfiles = 0;
    const referrerIds = [...new Set(membershipIds.map((row) => row.referrerId.toString()))].map(BigInt);
    for (const referrerId of referrerIds) {
      const remaining = await this.transaction
        .select({ value: count() })
        .from(referrerEnterpriseMemberships)
        .where(eq(referrerEnterpriseMemberships.referrerId, referrerId));
      if (asCount(remaining[0]?.value) === 0) {
        const removed = await this.transaction
          .delete(referrerProfiles)
          .where(eq(referrerProfiles.id, referrerId))
          .returning({ id: referrerProfiles.id });
        orphanProfiles += removed.length;
      }
    }
    deleted.push({ table: 'referrer_profiles', label: '无成员关系的推荐人资料', count: orphanProfiles });

    if (retainedId) {
      deleted.push(
        await this.execDelete(
          '其他员工账号',
          'admin_users',
          sql`delete from app.admin_users
              where enterprise_id = ${enterpriseId} and id <> ${retainedId}`
        )
      );
    } else {
      deleted.push(
        await this.execDelete(
          '全部员工账号',
          'admin_users',
          sql`delete from app.admin_users where enterprise_id = ${enterpriseId}`
        )
      );
    }

    deleted.push(
      await this.execDelete(
        '部门',
        'departments',
        sql`delete from app.departments where enterprise_id = ${enterpriseId}`
      )
    );

    return deleted;
  }

  async execute(enterpriseId: bigint, actorAdminUserId: bigint): Promise<EnterpriseResetResult> {
    const preview = await this.preview(enterpriseId, actorAdminUserId);
    const retainedId = preview.retainedOperatorAdminUserId
      ? BigInt(preview.retainedOperatorAdminUserId)
      : null;

    const deleted = await this.wipeEnterpriseScopedData(enterpriseId, {
      retainOperatorId: retainedId,
    });

    return {
      ...preview,
      deleted,
      totalRows: deleted.reduce((sum, item) => sum + item.count, 0),
    };
  }

  async purge(enterpriseId: bigint): Promise<EnterpriseResetResult> {
    const preview = await this.previewPurge(enterpriseId);
    const deleted = await this.wipeEnterpriseScopedData(enterpriseId, { retainOperatorId: null });

    deleted.push(
      await this.execDelete(
        '企业状态事件',
        'enterprise_status_events',
        sql`delete from app.enterprise_status_events where enterprise_id = ${enterpriseId}`
      )
    );

    // Detach global end-users from this enterprise; do not delete the user rows.
    const clearedUsers = await this.transaction
      .update(users)
      .set({ enterpriseId: null, updatedAt: new Date() })
      .where(eq(users.enterpriseId, enterpriseId))
      .returning({ id: users.id });
    deleted.push({
      table: 'users',
      label: '解除企业引用的全局用户',
      count: clearedUsers.length,
    });

    deleted.push(
      await this.execDelete(
        '企业壳',
        'enterprises',
        sql`delete from app.enterprises where id = ${enterpriseId}`
      )
    );

    return {
      ...preview,
      deleted,
      enterpriseDeleted: true,
      totalRows: deleted.reduce((sum, item) => sum + item.count, 0),
    };
  }
}
