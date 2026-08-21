import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
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
import { selectOperationalAppointment } from '@/lib/lead-service-stage';
import { isTwoRoleCommissionSource } from '@/lib/lead-source';

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

export type AdjustPayableInput = {
  payableAmount?: string;
  beneficiaryUserId?: bigint;
  reason?: string;
};

export type CommissionBeneficiaryOption = {
  userId: bigint;
  displayName: string;
  phone: string | null;
};

export type LeadCommissionWithRelations = typeof leadCommissions.$inferSelect & {
  lead: Pick<typeof leads.$inferSelect, 'id' | 'name' | 'phone' | 'communityName' | 'status' | 'contractAmount' | 'source'> | null;
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

    if (isTwoRoleCommissionSource(lead.source)) {
      if (!lead.assignedTo || !lead.measurerId) {
        throw commissionError('commission_beneficiary_missing', '线索尚未具备设计师和测量员提成受益人');
      }
    } else if (!lead.referrerMembershipId || !lead.assignedTo || !lead.measurerId) {
      throw commissionError('commission_beneficiary_missing', '线索尚未具备推荐人、设计师和测量员三方提成受益人');
    }
    const [referrerRows, staffRows] = await Promise.all([
      isTwoRoleCommissionSource(lead.source) || !lead.referrerMembershipId
        ? Promise.resolve([] as Array<{ userId: bigint }>)
        : this.transaction
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
    const designer = staffRows.find((staff) => staff.id === lead.assignedTo);
    const measurer = staffRows.find((staff) => staff.id === lead.measurerId);
    if (isTwoRoleCommissionSource(lead.source)) {
      if (!designer?.userId || !measurer?.userId) {
        throw commissionError('commission_beneficiary_missing', '设计师或测量员提成受益人身份不完整');
      }
      return {
        lead,
        roles: ['designer', 'measurer'] as const,
        beneficiaryUserIds: {
          designer: designer.userId,
          measurer: measurer.userId,
        },
      };
    }
    const designerRole = staffRows.find((staff) => staff.id === lead.assignedTo && staff.role === 'designer');
    const measurerRole = staffRows.find((staff) => staff.id === lead.measurerId && staff.role === 'measurer');
    if (!referrerRows[0]?.userId || !designerRole?.userId || !measurerRole?.userId) {
      throw commissionError('commission_beneficiary_missing', '三方提成受益人身份不完整');
    }
    return {
      lead,
      roles: COMMISSION_ROLES,
      beneficiaryUserIds: {
        referrer: referrerRows[0].userId,
        designer: designerRole.userId,
        measurer: measurerRole.userId,
      } satisfies Record<CommissionRole, bigint>,
    };
  }

  async snapshotForConvertedLead(leadId: bigint) {
    const context = await this.commissionContext(leadId);
    if (!context) return [];
    const { lead, beneficiaryUserIds, roles } = context;
    const rules = await this.listRules(lead.enterpriseId!);
    const ruleByRole = new Map(rules.map((rule) => [rule.role, rule]));
    const missing = roles.find((role) => ruleByRole.get(role)?.status !== 'active');
    if (missing) {
      throw commissionError('commission_rule_unavailable', `${missing} 提成规则未启用`);
    }
    const snapshotRules = rules.filter((rule) => (roles as readonly string[]).includes(rule.role));
    const percentageRule = snapshotRules.some((rule) => rule.calculationType === 'percentage');
    if (percentageRule && !lead.contractAmount) {
      throw commissionError('commission_contract_amount_required', '存在比例提成规则，签单必须填写签约金额', 400);
    }
    const values = roles.map((role) => {
      const rule = ruleByRole.get(role)!;
      const beneficiaryUserId = beneficiaryUserIds[role as keyof typeof beneficiaryUserIds];
      if (!beneficiaryUserId) {
        throw commissionError('commission_beneficiary_missing', '提成受益人身份不完整');
      }
      const payableAmount = calculatePayableCommission(
        rule.calculationType as CommissionCalculationType,
        rule.value,
        lead.contractAmount
      );
      return {
        enterpriseId: lead.enterpriseId!,
        leadId: lead.id,
        role,
        beneficiaryUserId,
        originalBeneficiaryUserId: beneficiaryUserId,
        ruleType: rule.calculationType,
        ruleValue: rule.value,
        ruleVersion: rule.version,
        contractAmount: lead.contractAmount,
        payableAmount,
        originalPayableAmount: payableAmount,
        status: 'payable' as const,
      };
    });
    const created = await this.transaction
      .insert(leadCommissions)
      .values(values)
      .onConflictDoNothing({ target: [leadCommissions.leadId, leadCommissions.role] })
      .returning();
    if (created.length === roles.length) return created;
    const existing = await this.transaction
      .select()
      .from(leadCommissions)
      .where(eq(leadCommissions.leadId, leadId));
    if (existing.length !== roles.length) {
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

  async list(enterpriseId: bigint, options: {
    status?: string;
    role?: CommissionRole;
    leadId?: bigint;
    createdFrom?: Date;
    createdBefore?: Date;
    source?: string;
  } = {}) {
    const filters = [eq(leadCommissions.enterpriseId, enterpriseId)];
    if (options.status) filters.push(eq(leadCommissions.status, options.status));
    if (options.role) filters.push(eq(leadCommissions.role, options.role));
    if (options.leadId) filters.push(eq(leadCommissions.leadId, options.leadId));
    if (options.source) filters.push(eq(leads.source, options.source));
    if (options.createdFrom) filters.push(gte(leadCommissions.createdAt, options.createdFrom));
    if (options.createdBefore) filters.push(lt(leadCommissions.createdAt, options.createdBefore));
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
            .select({
              membershipId: referrerEnterpriseMemberships.id,
              userId: referrerProfiles.userId,
              displayName: referrerProfiles.displayName,
              phone: referrerProfiles.phone,
            })
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
            .select({ id: measurementAppointments.id, leadId: measurementAppointments.leadId, address: measurementAppointments.address, timeRange: measurementAppointments.timeRange, status: measurementAppointments.status, createdAt: measurementAppointments.createdAt })
            .from(measurementAppointments)
            .where(inArray(measurementAppointments.leadId, leadIds))
        : Promise.resolve([] as Array<{
            id: bigint;
            leadId: bigint;
            address: string;
            timeRange: string;
            status: string;
            createdAt: Date;
          }>),
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
    const appointmentsByLead = new Map<bigint, Array<(typeof appointmentRows)[number]>>();
    for (const appointment of appointmentRows) {
      const current = appointmentsByLead.get(appointment.leadId);
      if (current) current.push(appointment);
      else appointmentsByLead.set(appointment.leadId, [appointment]);
    }
    for (const [leadId, appointments] of appointmentsByLead) {
      const selected = selectOperationalAppointment(appointments);
      if (selected) appointmentMap.set(leadId, selected);
    }
    return rows.map((row) => {
      const lead = row.lead;
      const membership = lead?.referrerMembershipId ? membershipMap.get(lead.referrerMembershipId) : null;
      const designer = lead?.assignedTo ? staffMap.get(lead.assignedTo) : null;
      const measurer = lead?.measurerId ? staffMap.get(lead.measurerId) : null;
      return {
        ...row.commission,
        lead: lead ? { id: lead.id, name: lead.name, phone: lead.phone, communityName: lead.communityName, status: lead.status, contractAmount: lead.contractAmount, source: lead.source } : null,
        beneficiary: row.beneficiary,
        enterprise: lead?.enterpriseId ? enterpriseMap.get(lead.enterpriseId) ?? null : null,
        customer: lead?.customerUserId ? userMap.get(lead.customerUserId) ?? null : null,
        referrer: membership
          ? {
              membershipId: membership.membershipId,
              userId: membership.userId,
              nickname: membership.displayName || membership.phone || userMap.get(membership.userId)?.nickname || '未命名推广人',
              phone: membership.phone || userMap.get(membership.userId)?.phone || null,
            }
          : null,
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

  async listEligibleBeneficiaries(enterpriseId: bigint, role: CommissionRole): Promise<CommissionBeneficiaryOption[]> {
    assertCommissionRole(role);
    if (role === 'referrer') {
      const rows = await this.transaction
        .select({
          userId: referrerProfiles.userId,
          displayName: referrerProfiles.displayName,
          phone: referrerProfiles.phone,
        })
        .from(referrerEnterpriseMemberships)
        .innerJoin(referrerProfiles, eq(referrerEnterpriseMemberships.referrerId, referrerProfiles.id))
        .where(and(
          eq(referrerEnterpriseMemberships.enterpriseId, enterpriseId),
          eq(referrerEnterpriseMemberships.status, 'active'),
          eq(referrerProfiles.status, 'active')
        ))
        .orderBy(asc(referrerProfiles.displayName), asc(referrerProfiles.userId));
      return rows.map((row) => ({
        userId: row.userId,
        displayName: row.displayName || row.phone || '未命名推荐人',
        phone: row.phone,
      }));
    }

    const rows = await this.transaction
      .select({
        userId: adminUsers.userId,
        displayName: adminUsers.displayName,
        phone: adminUsers.phone,
      })
      .from(adminUsers)
      .where(and(
        eq(adminUsers.enterpriseId, enterpriseId),
        eq(adminUsers.role, role),
        eq(adminUsers.status, 'active'),
        isNotNull(adminUsers.userId)
      ))
      .orderBy(asc(adminUsers.displayName), asc(adminUsers.id));
    return rows
      .filter((row): row is { userId: bigint; displayName: string; phone: string | null } => row.userId !== null)
      .map((row) => ({
        userId: row.userId,
        displayName: row.displayName,
        phone: row.phone,
      }));
  }

  private async assertEligibleBeneficiary(
    enterpriseId: bigint,
    role: CommissionRole,
    beneficiaryUserId: bigint
  ) {
    if (role === 'referrer') {
      const rows = await this.transaction
        .select({ userId: referrerProfiles.userId })
        .from(referrerEnterpriseMemberships)
        .innerJoin(referrerProfiles, eq(referrerEnterpriseMemberships.referrerId, referrerProfiles.id))
        .where(and(
          eq(referrerEnterpriseMemberships.enterpriseId, enterpriseId),
          eq(referrerEnterpriseMemberships.status, 'active'),
          eq(referrerProfiles.status, 'active'),
          eq(referrerProfiles.userId, beneficiaryUserId)
        ))
        .limit(1);
      if (!rows[0]) {
        throw commissionError('commission_beneficiary_ineligible', '目标受益人不是本企业活动推荐人成员', 400);
      }
      return;
    }

    const rows = await this.transaction
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(and(
        eq(adminUsers.enterpriseId, enterpriseId),
        eq(adminUsers.role, role),
        eq(adminUsers.userId, beneficiaryUserId),
        eq(adminUsers.status, 'active')
      ))
      .limit(1);
    if (!rows[0]) {
      throw commissionError(
        'commission_beneficiary_ineligible',
        role === 'designer' ? '目标受益人不是本企业已绑定的设计师' : '目标受益人不是本企业已绑定的测量员',
        400
      );
    }
  }

  async adjustPayable(
    enterpriseId: bigint,
    commissionId: bigint,
    actorId: bigint,
    input: AdjustPayableInput
  ) {
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (input.payableAmount === undefined && input.beneficiaryUserId === undefined) {
      throw commissionError('commission_adjust_fields_required', '请至少调整应付金额或受益人之一', 400);
    }

    const rows = await this.transaction
      .select()
      .from(leadCommissions)
      .where(and(eq(leadCommissions.id, commissionId), eq(leadCommissions.enterpriseId, enterpriseId)))
      .for('update');
    const current = rows[0];
    if (!current) {
      throw commissionError('commission_not_found', '提成记录不存在或不属于本企业');
    }
    if (current.status !== 'payable') {
      throw commissionError('commission_not_payable', '仅待支付提成可调整');
    }

    assertCommissionRole(current.role);
    let nextAmount = current.payableAmount;
    let nextBeneficiary = current.beneficiaryUserId;

    if (input.payableAmount !== undefined) {
      nextAmount = formatDecimal(parseDecimal(input.payableAmount, 2), 2);
    }
    if (input.beneficiaryUserId !== undefined) {
      await this.assertEligibleBeneficiary(enterpriseId, current.role, input.beneficiaryUserId);
      nextBeneficiary = input.beneficiaryUserId;
    }
    if (nextAmount === current.payableAmount && nextBeneficiary === current.beneficiaryUserId) {
      throw commissionError('commission_adjust_noop', '应付金额与受益人均未变化', 400);
    }

    const updated = await this.transaction
      .update(leadCommissions)
      .set({
        payableAmount: nextAmount,
        beneficiaryUserId: nextBeneficiary,
        adjustedAt: new Date(),
        adjustedBy: actorId,
        adjustReason: reason || null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(leadCommissions.id, commissionId),
        eq(leadCommissions.enterpriseId, enterpriseId),
        eq(leadCommissions.status, 'payable')
      ))
      .returning();
    if (!updated[0]) {
      throw commissionError('commission_not_payable', '仅待支付提成可调整');
    }
    return updated[0];
  }

  async listOwnStaffEarnings(input: {
    userId: bigint;
    enterpriseId: bigint;
    staffId: bigint;
    role: 'designer' | 'measurer';
    enterpriseName: string;
  }) {
    const rows = await this.transaction
      .select({
        commission: leadCommissions,
        leadId: leads.id,
        leadName: leads.name,
        assignedTo: leads.assignedTo,
        measurerId: leads.measurerId,
      })
      .from(leadCommissions)
      .innerJoin(leads, eq(leadCommissions.leadId, leads.id))
      .where(and(
        eq(leadCommissions.enterpriseId, input.enterpriseId),
        eq(leadCommissions.role, input.role),
        eq(leadCommissions.beneficiaryUserId, input.userId),
        eq(leads.enterpriseId, input.enterpriseId),
        isNull(leads.archivedAt)
      ))
      .orderBy(desc(leadCommissions.createdAt), desc(leadCommissions.id));

    return {
      enterpriseName: input.enterpriseName,
      items: rows.map(({ commission, leadId, leadName, assignedTo, measurerId }) => {
        const assigned = input.role === 'designer'
          ? assignedTo === input.staffId
          : measurerId === input.staffId;
        return {
          id: commission.id.toString(),
          customerLabel: assigned && leadName
            ? leadName
            : `服务客户 #${leadId.toString().slice(-4).padStart(4, '0')}`,
          amount: commission.payableAmount,
          status: commission.status,
          createdAt: commission.createdAt,
          paidAt: commission.paidAt,
        };
      }),
    };
  }

  async countEnterprisePayable(enterpriseId: bigint) {
    const rows = await this.transaction
      .select({ id: leadCommissions.id })
      .from(leadCommissions)
      .innerJoin(leads, eq(leadCommissions.leadId, leads.id))
      .where(and(
        eq(leadCommissions.enterpriseId, enterpriseId),
        eq(leads.enterpriseId, enterpriseId),
        eq(leadCommissions.status, 'payable'),
        isNull(leads.archivedAt)
      ));
    return rows.length;
  }

  async listEnterprisePayouts(enterpriseId: bigint, enterpriseName: string) {
    const rows = await this.transaction
      .select({
        commission: leadCommissions,
        leadId: leads.id,
        leadName: leads.name,
        leadSource: leads.source,
      })
      .from(leadCommissions)
      .innerJoin(leads, eq(leadCommissions.leadId, leads.id))
      .where(and(
        eq(leadCommissions.enterpriseId, enterpriseId),
        eq(leads.enterpriseId, enterpriseId),
        isNull(leads.archivedAt)
      ))
      .orderBy(desc(leadCommissions.createdAt), desc(leadCommissions.id));

    const beneficiaryIds = [...new Set(rows.map((row) => row.commission.beneficiaryUserId))];
    const [staffRows, membershipRows, userRows] = await Promise.all([
      beneficiaryIds.length
        ? this.transaction
            .select({ userId: adminUsers.userId, displayName: adminUsers.displayName })
            .from(adminUsers)
            .where(and(
              eq(adminUsers.enterpriseId, enterpriseId),
              isNotNull(adminUsers.userId),
              inArray(adminUsers.userId, beneficiaryIds)
            ))
        : Promise.resolve([]),
      beneficiaryIds.length
        ? this.transaction
            .select({
              userId: referrerProfiles.userId,
              displayName: referrerProfiles.displayName,
            })
            .from(referrerEnterpriseMemberships)
            .innerJoin(referrerProfiles, eq(referrerEnterpriseMemberships.referrerId, referrerProfiles.id))
            .where(and(
              eq(referrerEnterpriseMemberships.enterpriseId, enterpriseId),
              inArray(referrerProfiles.userId, beneficiaryIds)
            ))
        : Promise.resolve([]),
      beneficiaryIds.length
        ? this.transaction
            .select({ id: users.id, nickname: users.nickname })
            .from(users)
            .where(inArray(users.id, beneficiaryIds))
        : Promise.resolve([]),
    ]);

    const staffMap = new Map(
      staffRows
        .filter((row): row is { userId: bigint; displayName: string } => row.userId !== null)
        .map((row) => [row.userId.toString(), row.displayName])
    );
    const referrerMap = new Map(
      membershipRows.map((row) => [row.userId.toString(), row.displayName])
    );
    const userMap = new Map(
      userRows.map((row) => [row.id.toString(), row.nickname])
    );
    const roleLabels: Record<CommissionRole, string> = {
      referrer: '推荐人',
      designer: '设计师',
      measurer: '测量员',
    };

    const items = rows.map(({ commission, leadId, leadName, leadSource }) => {
      const role = commission.role as CommissionRole;
      const userKey = commission.beneficiaryUserId.toString();
      const named = role === 'referrer' ? referrerMap.get(userKey) : staffMap.get(userKey);
      return {
        id: commission.id.toString(),
        leadId: leadId.toString(),
        customerLabel: leadName || `客户 #${leadId.toString().slice(-4).padStart(4, '0')}`,
        role,
        roleLabel: roleLabels[role] || role,
        beneficiaryLabel: named || userMap.get(userKey) || (role === 'referrer' ? '未命名推荐人' : '未命名员工'),
        amount: commission.payableAmount,
        status: commission.status,
        source: leadSource,
        createdAt: commission.createdAt,
        paidAt: commission.paidAt,
      };
    });

    const sum = (status: string) => items
      .filter((item) => item.status === status)
      .reduce((total, item) => total + Number(item.amount || 0), 0)
      .toFixed(2);

    return {
      enterpriseName,
      totals: {
        payable: sum('payable'),
        paid: sum('paid'),
        voided: sum('voided'),
      },
      payableCount: items.filter((item) => item.status === 'payable').length,
      items,
    };
  }
}
