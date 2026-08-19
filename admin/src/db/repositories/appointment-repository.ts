import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  adminUsers,
  enterpriseAppointmentSettings,
  enterprises,
  leads,
  floorPlans,
  leadFloorPlans,
  measurementAppointmentEvents,
  measurementAppointments,
  staffUnavailabilityPeriods,
} from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';
import {
  appointmentRange,
  buildScheduleSlots,
  DEFAULT_APPOINTMENT_TIMEZONE,
  DEFAULT_WEEKLY_APPOINTMENT_SCHEDULE,
  localDateInTimeZone,
  normalizeWeeklyAppointmentSchedule,
} from '@/lib/appointment-scheduling';
import { parseFormalSurveyLayout } from '@/lib/survey-graph';

export type AppointmentSettingsInput = {
  timezone?: string;
  weeklySchedule?: unknown;
  defaultDurationMinutes?: number;
  slotStepMinutes?: number;
  maxAdvanceDays?: number;
  customerRescheduleCutoffHours?: number;
};

export type AppointmentRecord = typeof measurementAppointments.$inferSelect;

function appointmentError(code: string, message: string, status = 409) {
  return Object.assign(new Error(message), { code, status });
}

function normalizePositiveInteger(value: unknown, fallback: number, max: number) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= max ? number : fallback;
}

function isSupportedTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function range(startAt: Date, endAt: Date) {
  if (!(startAt instanceof Date) || Number.isNaN(startAt.getTime())) {
    throw appointmentError('appointment_time_invalid', '预约开始时间无效', 400);
  }
  if (!(endAt instanceof Date) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
    throw appointmentError('appointment_time_invalid', '预约结束时间无效', 400);
  }
  return `[${startAt.toISOString()},${endAt.toISOString()})`;
}

export class AppointmentRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  async getSettings(enterpriseId: bigint) {
    await this.transaction
      .insert(enterpriseAppointmentSettings)
      .values({
        enterpriseId,
        timezone: DEFAULT_APPOINTMENT_TIMEZONE,
        weeklySchedule: DEFAULT_WEEKLY_APPOINTMENT_SCHEDULE,
      })
      .onConflictDoNothing({ target: enterpriseAppointmentSettings.enterpriseId });
    const rows = await this.transaction
      .select()
      .from(enterpriseAppointmentSettings)
      .where(eq(enterpriseAppointmentSettings.enterpriseId, enterpriseId))
      .limit(1);
    const settings = rows[0];
    if (!settings) throw appointmentError('appointment_settings_missing', '预约设置不存在', 500);
    return settings;
  }

  async updateSettings(enterpriseId: bigint, input: AppointmentSettingsInput) {
    const current = await this.getSettings(enterpriseId);
    const timezone = typeof input.timezone === 'string' && input.timezone.trim()
      ? input.timezone.trim()
      : current.timezone;
    if (!isSupportedTimeZone(timezone)) {
      throw appointmentError('appointment_timezone_invalid', '时区无效', 400);
    }
    const defaultDurationMinutes = normalizePositiveInteger(
      input.defaultDurationMinutes, current.defaultDurationMinutes, 480
    );
    const slotStepMinutes = normalizePositiveInteger(input.slotStepMinutes, current.slotStepMinutes, 120);
    if (defaultDurationMinutes % slotStepMinutes !== 0) {
      throw appointmentError('appointment_step_invalid', '预约时长必须是时段步长的整数倍', 400);
    }
    const rows = await this.transaction
      .update(enterpriseAppointmentSettings)
      .set({
        timezone,
        weeklySchedule: input.weeklySchedule === undefined
          ? current.weeklySchedule
          : normalizeWeeklyAppointmentSchedule(input.weeklySchedule),
        defaultDurationMinutes,
        slotStepMinutes,
        maxAdvanceDays: normalizePositiveInteger(input.maxAdvanceDays, current.maxAdvanceDays, 180),
        customerRescheduleCutoffHours: Math.max(
          0,
          Math.min(72, Number.isInteger(Number(input.customerRescheduleCutoffHours))
            ? Number(input.customerRescheduleCutoffHours)
            : current.customerRescheduleCutoffHours)
        ),
        updatedAt: new Date(),
      })
      .where(eq(enterpriseAppointmentSettings.id, current.id))
      .returning();
    return rows[0] ?? current;
  }

  private async findLead(enterpriseId: bigint, leadId: bigint, lock = false) {
    const query = this.transaction
      .select()
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.enterpriseId, enterpriseId)))
      .limit(1);
    const rows = lock ? await query.for('update') : await query;
    return rows[0] ?? null;
  }

  async findLeadForAccess(enterpriseId: bigint, leadId: bigint) {
    return this.findLead(enterpriseId, leadId);
  }

  async findCustomerLeadForAccess(customerUserId: bigint, leadId: bigint) {
    const rows = await this.transaction
      .select()
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.customerUserId, customerUserId)))
      .limit(1);
    return rows[0] ?? null;
  }

  private async activeAppointmentForLead(leadId: bigint) {
    const rows = await this.transaction
      .select()
      .from(measurementAppointments)
      .where(and(
        eq(measurementAppointments.leadId, leadId),
        eq(measurementAppointments.status, 'confirmed'),
        sql`upper(${measurementAppointments.timeRange}) > now()`
      ))
      .limit(1)
      .for('update');
    return rows[0] ?? null;
  }

  private async expireStaleConfirmedAppointmentsForLead(leadId: bigint) {
    const stale = await this.transaction
      .select()
      .from(measurementAppointments)
      .where(and(
        eq(measurementAppointments.leadId, leadId),
        eq(measurementAppointments.status, 'confirmed'),
        sql`upper(${measurementAppointments.timeRange}) <= now()`
      ))
      .for('update');
    for (const row of stale) {
      await this.transaction.execute(sql.raw('SAVEPOINT expire_stale_appointment'));
      try {
        const expired = await this.expireAppointmentRow(row);
        if (!expired) {
          await this.transaction.execute(sql.raw('ROLLBACK TO SAVEPOINT expire_stale_appointment'));
          continue;
        }
        await this.transaction.execute(sql.raw('RELEASE SAVEPOINT expire_stale_appointment'));
      } catch {
        // Older databases may not yet allow the expired status; past-end confirmed rows
        // no longer block booking through activeAppointmentForLead.
        await this.transaction.execute(sql.raw('ROLLBACK TO SAVEPOINT expire_stale_appointment'));
      }
    }
  }

  private async expireAppointmentRow(current: AppointmentRecord, now = new Date()) {
    const rows = await this.transaction
      .update(measurementAppointments)
      .set({
        status: 'expired',
        version: current.version + 1,
        updatedAt: now,
      })
      .where(and(
        eq(measurementAppointments.id, current.id),
        eq(measurementAppointments.version, current.version),
        eq(measurementAppointments.status, 'confirmed')
      ))
      .returning();
    const appointment = rows[0];
    if (!appointment) return null;
    await this.transaction.insert(measurementAppointmentEvents).values({
      enterpriseId: appointment.enterpriseId,
      appointmentId: appointment.id,
      eventType: 'expired',
      previousTimeRange: current.timeRange,
      timeRange: appointment.timeRange,
      previousMeasurerId: appointment.measurerId,
      measurerId: appointment.measurerId,
      actorUserId: null,
      reason: '预约时段已结束',
      eventKey: `appointment_expired:${appointment.id.toString()}:${current.version}`,
      metadata: {},
    });
    return appointment;
  }

  private async isMeasurerAvailable(measurerId: bigint, timeRange: string) {
    const [appointments, unavailable] = await Promise.all([
      this.transaction
        .select({ id: measurementAppointments.id })
        .from(measurementAppointments)
        .where(and(
          eq(measurementAppointments.measurerId, measurerId),
          eq(measurementAppointments.status, 'confirmed'),
          sql`${measurementAppointments.timeRange} && ${timeRange}::tstzrange`
        ))
        .limit(1),
      this.transaction
        .select({ id: staffUnavailabilityPeriods.id })
        .from(staffUnavailabilityPeriods)
        .where(and(
          eq(staffUnavailabilityPeriods.staffId, measurerId),
          sql`${staffUnavailabilityPeriods.timeRange} && ${timeRange}::tstzrange`
        ))
        .limit(1),
    ]);
    return !appointments[0] && !unavailable[0];
  }

  private async measurerCandidates(
    enterpriseId: bigint,
    preferredId: bigint | null,
    options: { lockPreferred?: boolean } = {}
  ) {
    if (options.lockPreferred && preferredId) {
      const rows = await this.transaction
        .select()
        .from(adminUsers)
        .where(and(
          eq(adminUsers.id, preferredId),
          eq(adminUsers.enterpriseId, enterpriseId),
          eq(adminUsers.status, 'active')
        ))
        .limit(1);
      return rows;
    }
    const pendingLeadCount = sql<number>`(
      select count(*)::int from app.leads appointment_load
      where appointment_load.measurer_id = ${adminUsers.id}
        and appointment_load.archived_at is null
        and appointment_load.status in ('new', 'measuring')
    )`;
    const rows = await this.transaction
      .select({ staff: adminUsers, pendingLeadCount })
      .from(adminUsers)
      .where(and(
        eq(adminUsers.enterpriseId, enterpriseId),
        eq(adminUsers.role, 'measurer'),
        eq(adminUsers.status, 'active'),
        eq(adminUsers.assignmentPaused, false)
      ))
      .orderBy(
        sql`case when ${adminUsers.id} = ${preferredId} then 0 else 1 end`,
        asc(pendingLeadCount),
        sql`${adminUsers.lastAssignedAt} asc nulls first`,
        asc(adminUsers.id)
      );
    return rows.map((row) => row.staff);
  }

  private async resolveMeasurer(
    enterpriseId: bigint,
    preferredId: bigint | null,
    timeRange: string,
    options: { lockPreferred?: boolean } = {}
  ) {
    for (const candidate of await this.measurerCandidates(enterpriseId, preferredId, options)) {
      if (await this.isMeasurerAvailable(candidate.id, timeRange)) return candidate;
    }
    return null;
  }

  async listAvailability(input: {
    enterpriseId: bigint;
    leadId: bigint;
    date: string;
  }) {
    const [settings, lead] = await Promise.all([
      this.getSettings(input.enterpriseId),
      this.findLead(input.enterpriseId, input.leadId),
    ]);
    if (!lead || lead.archivedAt || lead.status === 'closed') {
      throw appointmentError('appointment_lead_not_found', '线索不存在或已关闭', 404);
    }
    const today = localDateInTimeZone(new Date(), settings.timezone);
    const maxDate = new Date(`${today}T00:00:00.000Z`);
    maxDate.setUTCDate(maxDate.getUTCDate() + settings.maxAdvanceDays);
    const maxDateText = maxDate.toISOString().slice(0, 10);
    if (input.date < today || input.date > maxDateText) {
      throw appointmentError('appointment_date_out_of_range', '日期不在可预约范围内', 400);
    }
    const slots = buildScheduleSlots({
      date: input.date,
      schedule: normalizeWeeklyAppointmentSchedule(settings.weeklySchedule),
      timeZone: settings.timezone,
      durationMinutes: settings.defaultDurationMinutes,
      stepMinutes: settings.slotStepMinutes,
    });
    const candidates = await this.measurerCandidates(
      input.enterpriseId,
      lead.measurerId,
      { lockPreferred: lead.source === 'staff_activity' }
    );
    const available = [] as Array<{ startAt: Date; endAt: Date; measurerId: bigint }>;
    for (const slot of slots) {
      if (slot.startAt <= new Date()) continue;
      const target = appointmentRange(slot.startAt, settings.defaultDurationMinutes);
      for (const candidate of candidates) {
        if (await this.isMeasurerAvailable(candidate.id, target)) {
          available.push({ ...slot, measurerId: candidate.id });
          break;
        }
      }
    }
    return { settings, available };
  }

  private async assertBookableSlot(
    enterpriseId: bigint,
    startAt: Date,
    endAt: Date
  ) {
    const settings = await this.getSettings(enterpriseId);
    if (startAt <= new Date()) {
      throw appointmentError('appointment_time_past', '预约时间必须晚于当前时间', 400);
    }
    if (endAt.getTime() - startAt.getTime() !== settings.defaultDurationMinutes * 60_000) {
      throw appointmentError('appointment_duration_invalid', '预约时长不符合企业设置', 400);
    }
    const date = localDateInTimeZone(startAt, settings.timezone);
    const today = localDateInTimeZone(new Date(), settings.timezone);
    const latest = new Date(`${today}T00:00:00.000Z`);
    latest.setUTCDate(latest.getUTCDate() + settings.maxAdvanceDays);
    if (date < today || date > latest.toISOString().slice(0, 10)) {
      throw appointmentError('appointment_date_out_of_range', '日期不在可预约范围内', 400);
    }
    const valid = buildScheduleSlots({
      date,
      schedule: normalizeWeeklyAppointmentSchedule(settings.weeklySchedule),
      timeZone: settings.timezone,
      durationMinutes: settings.defaultDurationMinutes,
      stepMinutes: settings.slotStepMinutes,
    }).some((slot) => slot.startAt.getTime() === startAt.getTime() && slot.endAt.getTime() === endAt.getTime());
    if (!valid) throw appointmentError('appointment_slot_invalid', '该时间不在企业可预约时段内', 400);
  }

  async create(input: {
    enterpriseId: bigint;
    leadId: bigint;
    startAt: Date;
    endAt: Date;
    address: string;
    actorUserId: bigint | null;
    eventKey: string;
  }) {
    const lead = await this.findLead(input.enterpriseId, input.leadId, true);
    if (!lead || lead.archivedAt || lead.status === 'closed' || !lead.assignedTo) {
      throw appointmentError('appointment_lead_not_ready', '线索尚未完成设计师派单', 409);
    }
    await this.expireStaleConfirmedAppointmentsForLead(input.leadId);
    if (await this.activeAppointmentForLead(input.leadId)) {
      throw appointmentError('appointment_already_exists', '该线索已有有效预约', 409);
    }
    await this.assertBookableSlot(input.enterpriseId, input.startAt, input.endAt);
    const timeRange = range(input.startAt, input.endAt);
    const measurer = await this.resolveMeasurer(
      input.enterpriseId,
      lead.measurerId,
      timeRange,
      { lockPreferred: lead.source === 'staff_activity' }
    );
    if (!measurer) throw appointmentError('appointment_no_measurer_available', '暂无可用测量员', 409);
    const [appointment] = await this.transaction
      .insert(measurementAppointments)
      .values({
        enterpriseId: input.enterpriseId,
        leadId: input.leadId,
        designerId: lead.assignedTo,
        measurerId: measurer.id,
        address: input.address.trim().slice(0, 300),
        timeRange,
        updatedByUserId: input.actorUserId,
      })
      .returning();
    if (!appointment) throw appointmentError('appointment_create_failed', '预约创建失败', 500);
    await this.transaction.insert(measurementAppointmentEvents).values({
      enterpriseId: input.enterpriseId,
      appointmentId: appointment.id,
      eventType: measurer.id === lead.measurerId ? 'created' : 'created_with_measurer_replacement',
      timeRange,
      measurerId: measurer.id,
      actorUserId: input.actorUserId,
      eventKey: input.eventKey,
      metadata: {},
    });
    return appointment;
  }

  async findById(enterpriseId: bigint, appointmentId: bigint, lock = false) {
    const query = this.transaction
      .select({ appointment: measurementAppointments, lead: leads })
      .from(measurementAppointments)
      .innerJoin(leads, eq(measurementAppointments.leadId, leads.id))
      .where(and(eq(measurementAppointments.id, appointmentId), eq(measurementAppointments.enterpriseId, enterpriseId)))
      .limit(1);
    const rows = lock ? await query.for('update') : await query;
    return rows[0] ?? null;
  }

  async findByIdAndMeasurer(enterpriseId: bigint, appointmentId: bigint, measurerId: bigint) {
    const rows = await this.transaction
      .select()
      .from(measurementAppointments)
      .where(and(
        eq(measurementAppointments.id, appointmentId),
        eq(measurementAppointments.enterpriseId, enterpriseId),
        eq(measurementAppointments.measurerId, measurerId)
      ))
      .limit(1);
    return rows[0] ?? null;
  }

  async findCustomerAppointmentForAccess(customerUserId: bigint, appointmentId: bigint) {
    const rows = await this.transaction
      .select({ appointment: measurementAppointments, lead: leads })
      .from(measurementAppointments)
      .innerJoin(leads, eq(measurementAppointments.leadId, leads.id))
      .where(and(
        eq(measurementAppointments.id, appointmentId),
        eq(leads.customerUserId, customerUserId)
      ))
      .limit(1);
    return rows[0] ?? null;
  }

  async listByLead(enterpriseId: bigint, leadId: bigint) {
    return this.transaction
      .select()
      .from(measurementAppointments)
      .where(and(
        eq(measurementAppointments.enterpriseId, enterpriseId),
        eq(measurementAppointments.leadId, leadId)
      ))
      .orderBy(asc(measurementAppointments.createdAt));
  }

  async listByLeadAndMeasurer(enterpriseId: bigint, leadId: bigint, measurerId: bigint) {
    return this.transaction
      .select()
      .from(measurementAppointments)
      .where(and(
        eq(measurementAppointments.enterpriseId, enterpriseId),
        eq(measurementAppointments.leadId, leadId),
        eq(measurementAppointments.measurerId, measurerId)
      ))
      .orderBy(asc(measurementAppointments.createdAt));
  }

  async hasCompletedFormalSurveyForLead(enterpriseId: bigint, leadId: bigint) {
    const rows = await this.transaction
      .select({ layoutData: floorPlans.layoutData })
      .from(leadFloorPlans)
      .innerJoin(floorPlans, eq(leadFloorPlans.floorPlanId, floorPlans.id))
      .where(and(
        eq(leadFloorPlans.leadId, leadId),
        eq(floorPlans.enterpriseId, enterpriseId),
        eq(floorPlans.status, 'completed'),
        sql`${floorPlans.layoutData} ->> 'version' = '4'`,
        sql`${floorPlans.layoutData} ->> 'measurementMode' = 'surveying'`,
        sql`${floorPlans.layoutData} #>> '{surveyGraph,kind}' = 'survey-wall-graph'`
      ));

    return rows.some(({ layoutData }) => {
      const layout = parseFormalSurveyLayout(layoutData);
      return !!layout?.surveyGraph.floors.some((floor) =>
        (floor.spaces || []).some((space) => space.closed === true)
      );
    });
  }

  async listByMeasurer(enterpriseId: bigint, measurerId: bigint, statuses: string[] = ['confirmed']) {
    return this.transaction
      .select()
      .from(measurementAppointments)
      .where(and(
        eq(measurementAppointments.enterpriseId, enterpriseId),
        eq(measurementAppointments.measurerId, measurerId),
        inArray(measurementAppointments.status, statuses)
      ))
      .orderBy(
        sql`case when ${measurementAppointments.status} = 'confirmed' then 0 else 1 end`,
        sql`lower(${measurementAppointments.timeRange}) asc`,
        asc(measurementAppointments.id)
      );
  }

  async listByDesigner(enterpriseId: bigint, designerId: bigint) {
    return this.transaction
      .select()
      .from(measurementAppointments)
      .where(and(
        eq(measurementAppointments.enterpriseId, enterpriseId),
        eq(measurementAppointments.designerId, designerId),
        eq(measurementAppointments.status, 'confirmed')
      ))
      .orderBy(sql`lower(${measurementAppointments.timeRange}) asc`, asc(measurementAppointments.id));
  }

  async listConfirmedByEnterprise(enterpriseId: bigint, limit = 6) {
    return this.listByEnterprise(enterpriseId, ['confirmed'], limit);
  }

  async listByEnterprise(enterpriseId: bigint, statuses: string[] = ['confirmed', 'expired'], limit = 20) {
    return this.transaction
      .select()
      .from(measurementAppointments)
      .where(and(
        eq(measurementAppointments.enterpriseId, enterpriseId),
        inArray(measurementAppointments.status, statuses)
      ))
      .orderBy(
        sql`case when ${measurementAppointments.status} = 'expired' then 0 when ${measurementAppointments.status} = 'confirmed' then 1 else 2 end`,
        sql`lower(${measurementAppointments.timeRange}) asc`,
        asc(measurementAppointments.id)
      )
      .limit(Math.min(Math.max(limit, 1), 50));
  }

  async reschedule(input: {
    enterpriseId: bigint;
    appointmentId: bigint;
    startAt: Date;
    endAt: Date;
    expectedVersion: number;
    actorUserId: bigint | null;
    eventKey: string;
    reason?: string | null;
    customerUserId?: bigint;
  }) {
    const current = await this.findById(input.enterpriseId, input.appointmentId, true);
    if (!current || current.appointment.status !== 'confirmed') {
      throw appointmentError('appointment_not_found', '预约不存在或不可改期', 404);
    }
    if (current.appointment.version !== input.expectedVersion) {
      throw appointmentError('appointment_version_conflict', '预约已被其他操作更新，请刷新后重试', 409);
    }
    if (input.customerUserId && current.lead.customerUserId !== input.customerUserId) {
      throw appointmentError('appointment_customer_forbidden', '无权修改该预约', 403);
    }
    const settings = await this.getSettings(input.enterpriseId);
    if (input.customerUserId) {
      const appointmentStart = current.appointment.timeRange;
      const match = appointmentStart.match(/[[(]([^,]+),/);
      const start = match ? new Date(match[1].replaceAll('"', '')) : null;
      if (!start || Date.now() > start.getTime() - settings.customerRescheduleCutoffHours * 3_600_000) {
        throw appointmentError('appointment_customer_cutoff', '已超过客户可改期时间', 409);
      }
    }
    await this.assertBookableSlot(input.enterpriseId, input.startAt, input.endAt);
    const timeRange = range(input.startAt, input.endAt);
    const measurer = await this.resolveMeasurer(
      input.enterpriseId,
      current.appointment.measurerId,
      timeRange,
      { lockPreferred: current.lead.source === 'staff_activity' }
    );
    if (!measurer) throw appointmentError('appointment_no_measurer_available', '暂无可用测量员', 409);
    const rows = await this.transaction
      .update(measurementAppointments)
      .set({
        measurerId: measurer.id,
        timeRange,
        version: current.appointment.version + 1,
        updatedByUserId: input.actorUserId,
        updatedAt: new Date(),
      })
      .where(and(
        eq(measurementAppointments.id, current.appointment.id),
        eq(measurementAppointments.version, input.expectedVersion)
      ))
      .returning();
    const appointment = rows[0];
    if (!appointment) throw appointmentError('appointment_version_conflict', '预约已被其他操作更新，请刷新后重试', 409);
    await this.transaction.insert(measurementAppointmentEvents).values({
      enterpriseId: input.enterpriseId,
      appointmentId: appointment.id,
      eventType: input.customerUserId ? 'customer_rescheduled' : 'internal_rescheduled',
      previousTimeRange: current.appointment.timeRange,
      timeRange,
      previousMeasurerId: current.appointment.measurerId,
      measurerId: measurer.id,
      actorUserId: input.actorUserId,
      reason: input.reason?.trim().slice(0, 200) || null,
      eventKey: input.eventKey,
      metadata: {},
    });
    return appointment;
  }

  async updateAddress(input: {
    enterpriseId: bigint;
    appointmentId: bigint;
    address: string;
    expectedVersion: number;
    actorUserId: bigint | null;
    eventKey: string;
  }) {
    const current = await this.findById(input.enterpriseId, input.appointmentId, true);
    if (!current || current.appointment.status !== 'confirmed') {
      throw appointmentError('appointment_not_found', '预约不存在或不可更新地址', 404);
    }
    if (current.appointment.version !== input.expectedVersion) {
      throw appointmentError('appointment_version_conflict', '预约已被其他操作更新，请刷新后重试', 409);
    }
    const address = input.address.trim().slice(0, 300);
    if (!address) throw appointmentError('appointment_address_required', '请填写上门地址', 400);
    if (address === current.appointment.address) return current.appointment;
    const rows = await this.transaction
      .update(measurementAppointments)
      .set({
        address,
        version: current.appointment.version + 1,
        updatedByUserId: input.actorUserId,
        updatedAt: new Date(),
      })
      .where(and(
        eq(measurementAppointments.id, current.appointment.id),
        eq(measurementAppointments.version, input.expectedVersion)
      ))
      .returning();
    const appointment = rows[0];
    if (!appointment) throw appointmentError('appointment_version_conflict', '预约已被其他操作更新，请刷新后重试', 409);
    await this.transaction.insert(measurementAppointmentEvents).values({
      enterpriseId: input.enterpriseId,
      appointmentId: appointment.id,
      eventType: 'address_updated',
      previousTimeRange: appointment.timeRange,
      timeRange: appointment.timeRange,
      measurerId: appointment.measurerId,
      actorUserId: input.actorUserId,
      reason: '补充或修正服务地址',
      eventKey: input.eventKey,
      metadata: { previousAddress: current.appointment.address, address },
    });
    return appointment;
  }

  async updateStatus(input: {
    enterpriseId: bigint;
    appointmentId: bigint;
    expectedVersion: number;
    actorUserId: bigint;
    status: 'cancelled' | 'completed';
    reason?: string | null;
    eventKey: string;
  }) {
    const current = await this.findById(input.enterpriseId, input.appointmentId, true);
    if (!current) {
      throw appointmentError('appointment_not_found', '预约不存在或不可操作', 404);
    }
    if (input.status === 'cancelled' && current.appointment.status !== 'confirmed') {
      throw appointmentError('appointment_not_found', '预约不存在或不可操作', 404);
    }
    if (input.status === 'completed' && !['confirmed', 'expired'].includes(current.appointment.status)) {
      throw appointmentError('appointment_not_found', '预约不存在或不可操作', 404);
    }
    if (current.appointment.version !== input.expectedVersion) {
      throw appointmentError('appointment_version_conflict', '预约已被其他操作更新，请刷新后重试', 409);
    }
    if (input.status === 'completed' && !(await this.hasCompletedFormalSurveyForLead(input.enterpriseId, current.appointment.leadId))) {
      throw appointmentError('appointment_survey_required', '请先完成并保存正式量房数据', 409);
    }
    if (input.status === 'cancelled' && !input.reason?.trim()) {
      throw appointmentError('appointment_reason_required', '请填写取消原因', 400);
    }
    const rows = await this.transaction.update(measurementAppointments).set({
      status: input.status,
      version: current.appointment.version + 1,
      updatedByUserId: input.actorUserId,
      updatedAt: new Date(),
    }).where(and(
      eq(measurementAppointments.id, current.appointment.id),
      eq(measurementAppointments.version, input.expectedVersion)
    )).returning();
    const appointment = rows[0];
    if (!appointment) throw appointmentError('appointment_version_conflict', '预约已被其他操作更新，请刷新后重试', 409);
    await this.transaction.insert(measurementAppointmentEvents).values({
      enterpriseId: input.enterpriseId,
      appointmentId: appointment.id,
      eventType: input.status,
      previousTimeRange: current.appointment.timeRange,
      timeRange: current.appointment.timeRange,
      previousMeasurerId: current.appointment.measurerId,
      measurerId: current.appointment.measurerId,
      actorUserId: input.actorUserId,
      reason: input.reason?.trim().slice(0, 200) || null,
      eventKey: input.eventKey,
      metadata: {},
    });
    return appointment;
  }

  async expireOverdue(input: { now?: Date; limit?: number } = {}) {
    const now = input.now || new Date();
    const limit = Math.min(Math.max(input.limit || 100, 1), 500);
    const due = await this.transaction
      .select()
      .from(measurementAppointments)
      .where(and(
        eq(measurementAppointments.status, 'confirmed'),
        sql`upper(${measurementAppointments.timeRange}) <= ${now.toISOString()}::timestamptz`
      ))
      .orderBy(asc(measurementAppointments.id))
      .limit(limit)
      .for('update');
    const expired: AppointmentRecord[] = [];
    for (const current of due) {
      await this.transaction.execute(sql.raw('SAVEPOINT expire_overdue_appointment'));
      try {
        const appointment = await this.expireAppointmentRow(current, now);
        if (!appointment) {
          await this.transaction.execute(sql.raw('ROLLBACK TO SAVEPOINT expire_overdue_appointment'));
          continue;
        }
        await this.transaction.execute(sql.raw('RELEASE SAVEPOINT expire_overdue_appointment'));
        expired.push(appointment);
      } catch {
        await this.transaction.execute(sql.raw('ROLLBACK TO SAVEPOINT expire_overdue_appointment'));
      }
    }
    return expired;
  }

  async listExpiredUnbooked(enterpriseId: bigint, limit = 20) {
    return this.transaction
      .select({ appointment: measurementAppointments, lead: leads })
      .from(measurementAppointments)
      .innerJoin(leads, eq(measurementAppointments.leadId, leads.id))
      .where(and(
        eq(measurementAppointments.enterpriseId, enterpriseId),
        eq(measurementAppointments.status, 'expired'),
        sql`not exists (
          select 1 from app.measurement_appointments confirmed
          where confirmed.lead_id = ${measurementAppointments.leadId}
            and confirmed.status = 'confirmed'
        )`,
        sql`${leads.status} in ('new', 'measuring')`
      ))
      .orderBy(asc(sql`upper(${measurementAppointments.timeRange})`))
      .limit(Math.min(Math.max(limit, 1), 50));
  }

  async listExpiredUnbookedDue(now = new Date(), limit = 100) {
    return this.transaction
      .select({
        appointment: measurementAppointments,
        lead: leads,
        reminderIntervalHours: sql<number>`coalesce((${enterprises.automationConfig} ->> 'reminderIntervalHours')::int, 24)`,
      })
      .from(measurementAppointments)
      .innerJoin(leads, eq(measurementAppointments.leadId, leads.id))
      .innerJoin(enterprises, eq(measurementAppointments.enterpriseId, enterprises.id))
      .where(and(
        eq(measurementAppointments.status, 'expired'),
        sql`not exists (
          select 1 from app.measurement_appointments confirmed
          where confirmed.lead_id = ${measurementAppointments.leadId}
            and confirmed.status = 'confirmed'
        )`,
        sql`${leads.status} in ('new', 'measuring')`,
        sql`${measurementAppointments.updatedAt} + make_interval(hours => coalesce((${enterprises.automationConfig} ->> 'reminderIntervalHours')::int, 24)) <= ${now.toISOString()}::timestamptz`
      ))
      .orderBy(asc(measurementAppointments.updatedAt), asc(measurementAppointments.id))
      .limit(Math.min(Math.max(limit, 1), 200));
  }

  async listUnavailability(enterpriseId: bigint, staffId?: bigint) {
    return this.transaction
      .select()
      .from(staffUnavailabilityPeriods)
      .where(staffId
        ? and(eq(staffUnavailabilityPeriods.enterpriseId, enterpriseId), eq(staffUnavailabilityPeriods.staffId, staffId))
        : eq(staffUnavailabilityPeriods.enterpriseId, enterpriseId))
      .orderBy(asc(staffUnavailabilityPeriods.createdAt));
  }

  async createUnavailability(input: {
    enterpriseId: bigint;
    staffId: bigint;
    startAt: Date;
    endAt: Date;
    reason?: string | null;
    createdBy: bigint;
  }) {
    const staff = await this.transaction.select().from(adminUsers).where(and(
      eq(adminUsers.id, input.staffId), eq(adminUsers.enterpriseId, input.enterpriseId),
      eq(adminUsers.role, 'measurer'), eq(adminUsers.status, 'active')
    )).limit(1).for('update');
    if (!staff[0]) throw appointmentError('appointment_measurer_not_found', '测量员不存在或不可用', 404);
    const timeRange = range(input.startAt, input.endAt);
    const rows = await this.transaction.insert(staffUnavailabilityPeriods).values({
      enterpriseId: input.enterpriseId, staffId: input.staffId, timeRange,
      reason: input.reason?.trim().slice(0, 200) || null, createdBy: input.createdBy,
    }).returning();
    return rows[0];
  }

  async deleteUnavailability(enterpriseId: bigint, id: bigint) {
    const rows = await this.transaction.delete(staffUnavailabilityPeriods).where(and(
      eq(staffUnavailabilityPeriods.id, id), eq(staffUnavailabilityPeriods.enterpriseId, enterpriseId)
    )).returning({ id: staffUnavailabilityPeriods.id });
    return Boolean(rows[0]);
  }
}
