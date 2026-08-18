import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  adminUsers,
  enterpriseCommissionRules,
  enterprises,
  leadCommissions,
  leads,
  measurementAppointments,
  referrerEnterpriseMemberships,
  referrerProfiles,
  users,
} from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export const COMMISSION_ROLES = ['referrer', 'designer', 'measurer'] as const;
export type CommissionRole = (typeof COMMISSION_ROLES)[number];
export type CommissionCalculationType = 'fixed' | 'percentage';
export type CommissionRuleStatus = 'active' | 'disabled';

export type CommissionRuleInput = {
  role: CommissionRole;
  calculationType: CommissionCalculationType;
  value: string;
  status: CommissionRuleStatus;
  version: number;
};

export type LeadCommissionWithRelations = typeof leadCommissions.$inferSelect & {
  lead: Pick<typeof leads.$inferSelect, 'id' | 'name' | 'phone' | 'communityName' | 'status' | 'contractAmount'> | null;
  beneficiary: Pick<typeof users.$inferSelect, 'id' | 'nickname' | 'phone'> | null;
  enterprise: Pick<typeof enterprises.$inferSelect, 'id' | 'name'> | null;
  customer: Pick<typeof users.$inferSelect, 'id' | 'nickname' | 'phone'> | null;
  referrer: { membershipId: bigint; userId: bigint; nickname: string | null; phone: string | null } | null;
  designer: { staffId: bigint; userId: bigint | null; displayName: string; phone: string | null } | null;
  measurer: { staffId: bigint; userId: bigint | null; displayName: string; phone: string | null } | null;
  appointment: Pick<typeof measurementAppointments.$inferSelect, 'id' | 'address' | 'timeRange' | 'status'> | null;
};

function commissionError(code: string, message: string, status = 409) {
  return Object.assign(new Error(message), { code, status });
}

function assertCommissionRole(value: string): asserts value is CommissionRole {
  if (!(COMMISSION_ROLES as readonly string[]).includes(value)) {
    throw commissionError('commission_role_invalid', '提成角色无效', 400);
  }
}

function parseDecimal(value: string, scale: number) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match || (match[2]?.length ?? 0) > scale) {
    throw commissionError('commission_value_invalid', '提成数值格式无效', 400);
  }
  const whole = match[1].replace(/^0+(?=\d)/, '');
  const fraction = (match[2] || '').padEnd(scale, '0');
  return BigInt(`${whole}${fraction}`);
}

function formatDecimal(value: bigint, scale: number) {
  const text = value.toString().padStart(scale + 1, '0');
  return `${text.slice(0, -scale)}.${text.slice(-scale)}`;
}

function roundHalfUp(value: bigint, divisor: bigint) {
  return (value + divisor / BigInt(2)) / divisor;
}

/**
 * All calculations use integer decimal units rather than JavaScript floating
 * point. Rule values carry four decimal places and payable amounts carry cents.
 */
export function calculatePayableCommission(
  calculationType: CommissionCalculationType,
  ruleValue: string,
  contractAmount: string | null
) {
  const ruleUnits = parseDecimal(ruleValue, 4);
  const cents = calculationType === 'fixed'
    ? roundHalfUp(ruleUnits, BigInt(100))
    : (() => {
        if (!contractAmount) {
          throw commissionError('commission_contract_amount_required', '比例提成必须填写签约金额', 400);
        }
        return roundHalfUp(parseDecimal(contractAmount, 2) * ruleUnits, BigInt(1_000_000));
      })();
  return formatDecimal(cents, 2);
}

export class LeadCommissionRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  private async ensureDefaults(enterpriseId: bigint, actorId: bigint | null = null) {
    await this.transaction
      .insert(enterpriseCommissionRules)
      .values(COMMISSION_ROLES.map((role) => ({
        enterpriseId,
        role,
        calculationType: 'fixed',
        value: '0.0000',
        status: 'active',
        createdBy: actorId,
        updatedBy: actorId,
      })))
      .onConflictDoNothing({ target: [enterpriseCommissionRules.enterpriseId, enterpriseCommissionRules.role] });
  }

  async listRules(enterpriseId: bigint, actorId: bigint | null = null) {
    await this.ensureDefaults(enterpriseId, actorId);
    return this.transaction
      .select()
      .from(enterpriseCommissionRules)
      .where(eq(enterpriseCommissionRules.enterpriseId, enterpriseId))
      .orderBy(asc(enterpriseCommissionRules.role));
  }

  async updateRules(enterpriseId: bigint, actorId: bigint, inputs: CommissionRuleInput[]) {
    if (inputs.length !== COMMISSION_ROLES.length || new Set(inputs.map((item) => item.role)).size !== COMMISSION_ROLES.length) {
      throw commissionError('commission_rules_incomplete', '必须同时提交推荐人、设计师和测量员三条提成规则', 400);
    }
    for (const input of inputs) {
      assertCommissionRole(input.role);
      if (!['fixed', 'percentage'].includes(input.calculationType)) {
        throw commissionError('commission_rule_type_invalid', '提成计算方式无效', 400);
      }
      if (!['active', 'disabled'].includes(input.status)) {
        throw commissionError('commission_rule_status_invalid', '提成规则状态无效', 400);
      }
      if (!Number.isInteger(input.version) || input.version <= 0) {
        throw commissionError('commission_rule_version_invalid', '提成规则版本无效，请刷新后重试', 400);
      }
      const units = parseDecimal(input.value, 4);
      if (input.calculationType === 'percentage' && units > BigInt(1_000_000)) {
        throw commissionError('commission_percentage_invalid', '比例提成不能超过 100%', 400);
      }
    }

    await this.ensureDefaults(enterpriseId, actorId);
    const updated = [] as Array<typeof enterpriseCommissionRules.$inferSelect>;
    for (const input of inputs) {
      const rows = await this.transaction
        .update(enterpriseCommissionRules)
        .set({
          calculationType: input.calculationType,
          value: formatDecimal(parseDecimal(input.value, 4), 4),
          status: input.status,
          version: sql`${enterpriseCommissionRules.version} + 1`,
          updatedBy: actorId,
          updatedAt: new Date(),
        })
        .where(and(
          eq(enterpriseCommissionRules.enterpriseId, enterpriseId),
          eq(enterpriseCommissionRules.role, input.role),
          eq(enterpriseCommissionRules.version, input.version)
        ))
        .returning();
      if (!rows[0]) {
        throw commissionError('commission_rule_version_conflict', '提成规则已被其他人修改，请刷新后重试');
      }
      updated.push(rows[0]);
    }
    return updated.sort((left, right) => left.role.localeCompare(right.role));
  }

  private async commissionContext(leadId: bigint) {
    const leadRows = await this.transaction
      .select()
      .from(leads)
      .where(eq(leads.id, leadId))
      .limit(1)
      .for('update');
    const lead = leadRows[0];
    if (!lead?.enterpriseId) return null;

    if (!lead.referrerMembershipId || !lead.assignedTo || !lead.measurerId) {
      throw commissionError('commission_beneficiary_missing', '线索尚未具备推荐人、设计师和测量员三方提成受益人');
    }
    const [referrerRows, staffRows] = await Promise.all([
      this.transaction
        .select({ userId: referrerProfiles.userId })
        .from(referrerEnterpriseMemberships)
        .innerJoin(referrerProfiles, eq(referrerEnterpriseMemberships.referrerId, referrerProfiles.id))
        .where(and(
          eq(referrerEnterpriseMemberships.id, lead.referrerMembershipId),
          eq(referrerEnterpriseMemberships.enterpriseId, lead.enterpriseId)
        ))
        .limit(1),
      this.transaction
        .select({ id: adminUsers.id, userId: adminUsers.userId, role: adminUsers.role })
        .from(adminUsers)
        .where(and(
          eq(adminUsers.enterpriseId, lead.enterpriseId),
          inArray(adminUsers.id, [lead.assignedTo, lead.measurerId])
        )),
    ]);
    const designer = staffRows.find((staff) => staff.id === lead.assignedTo && staff.role === 'designer');
    const measurer = staffRows.find((staff) => staff.id === lead.measurerId && staff.role === 'measurer');
    if (!referrerRows[0]?.userId || !designer?.userId || !measurer?.userId) {
      throw commissionError('commission_beneficiary_missing', '三方提成受益人身份不完整');
    }
    return {
      lead,
      beneficiaryUserIds: {
        referrer: referrerRows[0].userId,
        designer: designer.userId,
        measurer: measurer.userId,
      } satisfies Record<CommissionRole, bigint>,
    };
  }

  async snapshotForConvertedLead(leadId: bigint) {
    const context = await this.commissionContext(leadId);
    if (!context) return [];
    const { lead, beneficiaryUserIds } = context;
    const rules = await this.listRules(lead.enterpriseId!);
    const ruleByRole = new Map(rules.map((rule) => [rule.role, rule]));
    const missing = COMMISSION_ROLES.find((role) => ruleByRole.get(role)?.status !== 'active');
    if (missing) {
      throw commissionError('commission_rule_unavailable', `${missing} 提成规则未启用`);
    }
    const percentageRule = rules.some((rule) => rule.calculationType === 'percentage');
    if (percentageRule && !lead.contractAmount) {
      throw commissionError('commission_contract_amount_required', '存在比例提成规则，签单必须填写签约金额', 400);
    }
    const values = COMMISSION_ROLES.map((role) => {
      const rule = ruleByRole.get(role)!;
      return {
        enterpriseId: lead.enterpriseId!,
        leadId: lead.id,
        role,
        beneficiaryUserId: beneficiaryUserIds[role],
        ruleType: rule.calculationType,
        ruleValue: rule.value,
        ruleVersion: rule.version,
        contractAmount: lead.contractAmount,
        payableAmount: calculatePayableCommission(rule.calculationType as CommissionCalculationType, rule.value, lead.contractAmount),
        status: 'payable',
      };
    });
    const created = await this.transaction
      .insert(leadCommissions)
      .values(values)
      .onConflictDoNothing({ target: [leadCommissions.leadId, leadCommissions.role] })
      .returning();
    if (created.length === COMMISSION_ROLES.length) return created;
    const existing = await this.transaction
      .select()
      .from(leadCommissions)
      .where(eq(leadCommissions.leadId, leadId));
    if (existing.length !== COMMISSION_ROLES.length) {
      throw commissionError('commission_snapshot_conflict', '签单提成快照不完整，请联系管理员处理');
    }
    return existing;
  }

  async voidUnpaidForRevertedLead(leadId: bigint, actorId: bigint, reason: string) {
    const existing = await this.transaction
      .select()
      .from(leadCommissions)
      .where(eq(leadCommissions.leadId, leadId))
      .for('update');
    if (existing.some((commission) => commission.status === 'paid')) {
      throw commissionError('commission_paid_blocks_revert', '存在已支付提成，需先完成线下财务更正后才能撤销签单');
    }
    const payableIds = existing.filter((commission) => commission.status === 'payable').map((commission) => commission.id);
    if (!payableIds.length) return 0;
    const rows = await this.transaction
      .update(leadCommissions)
      .set({ status: 'voided', voidedAt: new Date(), voidedBy: actorId, voidReason: reason, updatedAt: new Date() })
      .where(inArray(leadCommissions.id, payableIds))
      .returning({ id: leadCommissions.id });
    return rows.length;
  }

  async list(enterpriseId: bigint, options: { status?: string; leadId?: bigint } = {}) {
    const filters = [eq(leadCommissions.enterpriseId, enterpriseId)];
    if (options.status) filters.push(eq(leadCommissions.status, options.status));
    if (options.leadId) filters.push(eq(leadCommissions.leadId, options.leadId));
    const rows = await this.transaction
      .select({ commission: leadCommissions, lead: leads, beneficiary: users })
      .from(leadCommissions)
      .leftJoin(leads, eq(leadCommissions.leadId, leads.id))
      .leftJoin(users, eq(leadCommissions.beneficiaryUserId, users.id))
      .where(and(...filters))
      .orderBy(desc(leadCommissions.createdAt), desc(leadCommissions.id));
    const leadRows = rows.map((row) => row.lead).filter((lead): lead is NonNullable<typeof lead> => Boolean(lead));
    const leadIds = [...new Set(leadRows.map((lead) => lead.id))];
    const enterpriseIds = [...new Set(leadRows.map((lead) => lead.enterpriseId).filter((id): id is bigint => id !== null))];
    const membershipIds = [...new Set(leadRows.map((lead) => lead.referrerMembershipId).filter((id): id is bigint => id !== null))];
    const staffIds = [...new Set(leadRows.flatMap((lead) => [lead.assignedTo, lead.measurerId]).filter((id): id is bigint => id !== null))];
    const [enterpriseRows, membershipRows, staffRows, appointmentRows] = await Promise.all([
      enterpriseIds.length
        ? this.transaction.select({ id: enterprises.id, name: enterprises.name }).from(enterprises).where(inArray(enterprises.id, enterpriseIds))
        : [],
      membershipIds.length
        ? this.transaction
            .select({ membershipId: referrerEnterpriseMemberships.id, userId: referrerProfiles.userId })
            .from(referrerEnterpriseMemberships)
            .innerJoin(referrerProfiles, eq(referrerEnterpriseMemberships.referrerId, referrerProfiles.id))
            .where(inArray(referrerEnterpriseMemberships.id, membershipIds))
        : [],
      staffIds.length
        ? this.transaction
            .select({ id: adminUsers.id, userId: adminUsers.userId, displayName: adminUsers.displayName, phone: adminUsers.phone })
            .from(adminUsers)
            .where(inArray(adminUsers.id, staffIds))
        : [],
      leadIds.length
        ? this.transaction
            .select({ id: measurementAppointments.id, leadId: measurementAppointments.leadId, address: measurementAppointments.address, timeRange: measurementAppointments.timeRange, status: measurementAppointments.status })
            .from(measurementAppointments)
            .where(and(inArray(measurementAppointments.leadId, leadIds), eq(measurementAppointments.status, 'confirmed')))
            .orderBy(desc(measurementAppointments.createdAt), desc(measurementAppointments.id))
        : [],
    ]);
    const userIds = [...new Set([
      ...rows.map((row) => row.commission.beneficiaryUserId),
      ...leadRows.map((lead) => lead.customerUserId).filter((id): id is bigint => id !== null),
      ...membershipRows.map((membership) => membership.userId),
    ])];
    const userRows = userIds.length
      ? await this.transaction.select({ id: users.id, nickname: users.nickname, phone: users.phone }).from(users).where(inArray(users.id, userIds))
      : [];
    const enterpriseMap = new Map(enterpriseRows.map((enterprise) => [enterprise.id, enterprise]));
    const membershipMap = new Map(membershipRows.map((membership) => [membership.membershipId, membership]));
    const staffMap = new Map(staffRows.map((staff) => [staff.id, staff]));
    const userMap = new Map(userRows.map((user) => [user.id, user]));
    const appointmentMap = new Map<bigint, (typeof appointmentRows)[number]>();
    for (const appointment of appointmentRows) {
      if (!appointmentMap.has(appointment.leadId)) appointmentMap.set(appointment.leadId, appointment);
    }
    return rows.map((row) => {
      const lead = row.lead;
      const membership = lead?.referrerMembershipId ? membershipMap.get(lead.referrerMembershipId) : null;
      const designer = lead?.assignedTo ? staffMap.get(lead.assignedTo) : null;
      const measurer = lead?.measurerId ? staffMap.get(lead.measurerId) : null;
      return {
        ...row.commission,
        lead: lead ? { id: lead.id, name: lead.name, phone: lead.phone, communityName: lead.communityName, status: lead.status, contractAmount: lead.contractAmount } : null,
        beneficiary: row.beneficiary,
        enterprise: lead?.enterpriseId ? enterpriseMap.get(lead.enterpriseId) ?? null : null,
        customer: lead?.customerUserId ? userMap.get(lead.customerUserId) ?? null : null,
        referrer: membership ? { membershipId: membership.membershipId, userId: membership.userId, nickname: userMap.get(membership.userId)?.nickname ?? null, phone: userMap.get(membership.userId)?.phone ?? null } : null,
        designer: designer ? { staffId: designer.id, userId: designer.userId, displayName: designer.displayName, phone: designer.phone } : null,
        measurer: measurer ? { staffId: measurer.id, userId: measurer.userId, displayName: measurer.displayName, phone: measurer.phone } : null,
        appointment: lead ? appointmentMap.get(lead.id) ?? null : null,
      };
    });
  }

  async markPaid(enterpriseId: bigint, commissionIds: bigint[], actorId: bigint) {
    const uniqueIds = [...new Set(commissionIds)];
    if (!uniqueIds.length || uniqueIds.length > 100) {
      throw commissionError('commission_ids_invalid', '请选择 1 至 100 条待支付提成', 400);
    }
    const current = await this.transaction
      .select()
      .from(leadCommissions)
      .where(and(eq(leadCommissions.enterpriseId, enterpriseId), inArray(leadCommissions.id, uniqueIds)))
      .for('update');
    if (current.length !== uniqueIds.length || current.some((item) => item.status !== 'payable')) {
      throw commissionError('commission_not_payable', '所选提成不存在或不是待支付状态');
    }
    return this.transaction
      .update(leadCommissions)
      .set({ status: 'paid', paidAt: new Date(), paidBy: actorId, updatedAt: new Date() })
      .where(and(eq(leadCommissions.enterpriseId, enterpriseId), inArray(leadCommissions.id, uniqueIds), eq(leadCommissions.status, 'payable')))
      .returning();
  }
}
