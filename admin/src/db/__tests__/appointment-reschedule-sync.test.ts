import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { loadEnvConfig } from '@next/env';
import { eq, inArray } from 'drizzle-orm';
import {
  adminUsers,
  enterprises,
  leads,
  measurementAppointmentEvents,
  measurementAppointments,
  users,
} from '@/db/schema';
import {
  AdminUserRepository,
  AppointmentRepository,
  CustomerProjectRepository,
  EnterpriseRepository,
  LeadRepository,
} from '@/db/repositories';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { leadToDto } from '@/db/postgres-dto';
import { appointmentToDto } from '@/lib/appointment-api';
import { localDateInTimeZone, zonedDateTimeToUtc } from '@/lib/appointment-scheduling';
import {
  formatAppointmentTimeRangeIso,
  resolveCustomerHomeAction,
  resolveLeadServiceStage,
} from '@/lib/lead-service-stage';
import {
  buildWorkbenchAppointmentItem,
  selectMeasurerWorkbenchAppointments,
} from '@/lib/miniprogram-workbench';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';

const runKey = `appt-sync-${process.pid}-${Date.now()}`;
let enterpriseId: bigint;
let customerUserId: bigint;
let designerUserId: bigint;
let designerId: bigint;
let measurerId: bigint;
let leadId: bigint;
let probeLeadId: bigint;

function nextDaySlot(hour: string) {
  const localToday = localDateInTimeZone(new Date(), 'Asia/Shanghai');
  const date = new Date(`${localToday}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  const localDate = date.toISOString().slice(0, 10);
  const startAt = zonedDateTimeToUtc(localDate, hour, 'Asia/Shanghai');
  return { localDate, startAt, endAt: new Date(startAt.getTime() + 120 * 60_000) };
}

function isoRange(timeRange: string | null | undefined) {
  return formatAppointmentTimeRangeIso(timeRange);
}

async function readPartyViews(appointmentId: bigint) {
  return withTenantTransaction(enterpriseId, async (transaction) => {
    const appointments = new AppointmentRepository(transaction);
    const projects = new CustomerProjectRepository(transaction);
    const leadRecord = await new LeadRepository(transaction).findById(leadId);
    assert.ok(leadRecord);

    const appointmentRow = await appointments.findById(enterpriseId, appointmentId);
    const customerAccess = await appointments.findCustomerAppointmentForAccess(customerUserId, appointmentId);
    const leadAppointments = await appointments.listByLead(enterpriseId, leadId);
    const measurerCalendar = await appointments.listByMeasurer(enterpriseId, measurerId);
    const enterpriseSchedule = await appointments.listByEnterprise(enterpriseId, ['confirmed'], 50);
    const customerProject = await projects.findCustomerProject(customerUserId, leadId);
    const customerIndex = (await projects.listCustomerProjects(customerUserId))
      .find((item) => item.leadId === leadId);
    const events = await transaction
      .select()
      .from(measurementAppointmentEvents)
      .where(eq(measurementAppointmentEvents.appointmentId, appointmentId));

    const leadDto = leadToDto(leadRecord);
    const appointmentDto = appointmentRow
      ? appointmentToDto(appointmentRow.appointment)
      : null;
    const home = resolveCustomerHomeAction({
      leadStatus: leadRecord.status,
      assignmentStatus: leadRecord.assignmentStatus,
      measurerId: leadRecord.measurerId,
      appointment: leadRecord.appointment,
      customerRescheduleCutoffHours: 2,
    });
    const staffStage = resolveLeadServiceStage({
      leadStatus: leadRecord.status,
      assignmentStatus: leadRecord.assignmentStatus,
      measurerId: leadRecord.measurerId,
      appointment: leadRecord.appointment,
    });
    const workbenchAppointments = selectMeasurerWorkbenchAppointments(measurerCalendar);
    const workbenchItem = workbenchAppointments[0]
      ? buildWorkbenchAppointmentItem(workbenchAppointments[0], leadRecord)
      : null;

    return {
      leadRecord,
      leadDto,
      appointmentRow: appointmentRow?.appointment ?? null,
      appointmentDto,
      customerAccess,
      leadAppointments,
      measurerCalendar,
      enterpriseSchedule,
      customerProject,
      customerIndex,
      events,
      home,
      staffStage,
      workbenchItem,
    };
  });
}

async function occupancyFor(targetLeadId: bigint, date: string, startAt: Date) {
  const availability = await withTenantTransaction(enterpriseId, (transaction) =>
    new AppointmentRepository(transaction).listAvailability({
      enterpriseId,
      leadId: targetLeadId,
      date,
    })
  );
  return availability.available.some((slot) => slot.startAt.getTime() === startAt.getTime());
}

before(async () => {
  loadEnvConfig(process.cwd());
  const databaseUrl = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(
    ['localhost', '127.0.0.1'].includes(databaseUrl.hostname),
    'Appointment sync tests only mutate the local database'
  );

  await withPlatformTransaction(async (transaction) => {
    enterpriseId = (
      await new EnterpriseRepository(transaction).create({
        name: `${runKey}-shop`,
        code: `${runKey}-shop`,
        status: 'active',
      })
    ).id;
    const [customer] = await transaction.insert(users).values({
      phone: `16${String(Date.now()).slice(-9)}`,
      nickname: `${runKey}-customer`,
    }).returning();
    customerUserId = customer!.id;
    const [designerUser] = await transaction.insert(users).values({
      phone: `15${String(Date.now()).slice(-9)}`,
      nickname: `${runKey}-designer-user`,
    }).returning();
    designerUserId = designerUser!.id;
  });

  await withTenantTransaction(enterpriseId, async (transaction) => {
    const staff = new AdminUserRepository(transaction);
    designerId = (
      await staff.create({
        enterpriseId,
        userId: designerUserId,
        username: `${runKey}-designer`,
        passwordHash: 'test-only',
        displayName: '同步设计师',
        role: 'designer',
        status: 'active',
        assignmentPaused: false,
      })
    ).id;
    measurerId = (
      await staff.create({
        enterpriseId,
        username: `${runKey}-measurer`,
        passwordHash: 'test-only',
        displayName: '同步测量员',
        role: 'measurer',
        status: 'active',
        assignmentPaused: false,
      })
    ).id;
    leadId = (
      await new LeadRepository(transaction).create({
        enterpriseId,
        assignedTo: designerId,
        measurerId,
        customerUserId,
        name: '改期同步客户',
        phone: `17${String(Date.now()).slice(-9)}`,
        source: 'appointment-sync-test',
        assignmentStatus: 'assigned',
        communityName: '同步测试小区',
      })
    ).id;
    probeLeadId = (
      await new LeadRepository(transaction).create({
        enterpriseId,
        assignedTo: designerId,
        measurerId,
        customerUserId,
        name: '占用探测客户',
        phone: `18${String(Date.now()).slice(-9)}`,
        source: 'appointment-sync-test',
        assignmentStatus: 'assigned',
        communityName: '同步测试小区',
      })
    ).id;
  });
});

after(async () => {
  await withPlatformTransaction(async (transaction) => {
    if (enterpriseId) {
      await transaction.delete(measurementAppointmentEvents)
        .where(eq(measurementAppointmentEvents.enterpriseId, enterpriseId));
      await transaction.delete(measurementAppointments)
        .where(eq(measurementAppointments.enterpriseId, enterpriseId));
      await transaction.delete(leads).where(eq(leads.enterpriseId, enterpriseId));
      await transaction.delete(adminUsers).where(eq(adminUsers.enterpriseId, enterpriseId));
      await transaction.delete(enterprises).where(inArray(enterprises.id, [enterpriseId]));
    }
    const userIds = [customerUserId, designerUserId].filter(Boolean);
    if (userIds.length) await transaction.delete(users).where(inArray(users.id, userIds));
  });
  await closePostgresPool();
});

test('booking then customer and staff reschedule keep customer, designer, measurer, and enterprise views in sync', async () => {
  const firstSlot = nextDaySlot('09:00');
  const customerSlot = nextDaySlot('14:00');
  const staffSlot = nextDaySlot('16:00');

  const booked = await withTenantTransaction(enterpriseId, (transaction) =>
    new AppointmentRepository(transaction).create({
      enterpriseId,
      leadId,
      startAt: firstSlot.startAt,
      endAt: firstSlot.endAt,
      address: '同步测试小区 1 栋 101',
      actorUserId: customerUserId,
      eventKey: `${runKey}-create`,
    })
  );

  const afterCreate = await readPartyViews(booked.id);
  const createdIso = isoRange(booked.timeRange);
  assert.equal(afterCreate.leadAppointments.length, 1, '首次预约只应有一条有效记录');
  assert.equal(afterCreate.appointmentDto?.id, booked.id.toString());
  assert.equal(afterCreate.appointmentDto?.timeRange, createdIso);
  assert.equal(afterCreate.leadDto.appointment?.id, booked.id.toString());
  assert.equal(afterCreate.leadDto.appointment?.timeRange, createdIso);
  assert.equal(afterCreate.leadDto.serviceStage, 'appointment_confirmed');
  assert.equal(afterCreate.staffStage.key, 'appointment_confirmed');
  assert.equal(afterCreate.home.kind, 'reschedule');
  assert.match(afterCreate.home.appointmentSummary || '', /量房/);
  assert.equal(isoRange(afterCreate.customerProject?.appointment?.timeRange), createdIso);
  assert.equal(String(afterCreate.customerIndex?.appointmentId), booked.id.toString());
  assert.equal(isoRange(afterCreate.customerIndex?.appointmentTimeRange), createdIso);
  assert.equal(afterCreate.customerAccess?.appointment.id, booked.id);
  assert.equal(afterCreate.measurerCalendar.length, 1);
  assert.equal(afterCreate.measurerCalendar[0]?.id, booked.id);
  assert.equal(isoRange(afterCreate.measurerCalendar[0]?.timeRange), createdIso);
  assert.equal(afterCreate.enterpriseSchedule.some((row) => row.id === booked.id), true);
  assert.equal(afterCreate.workbenchItem?.appointmentId, booked.id.toString());
  assert.equal(afterCreate.workbenchItem?.timeRange, createdIso);
  assert.equal(afterCreate.appointmentRow?.measurerId, measurerId);
  assert.equal(afterCreate.appointmentRow?.designerId, designerId);
  assert.equal(afterCreate.events.map((event) => event.eventType).join(','), 'created');
  assert.equal(await occupancyFor(leadId, firstSlot.localDate, firstSlot.startAt), true, '改期列表排除本预约，自身档仍可选');
  assert.equal(await occupancyFor(probeLeadId, firstSlot.localDate, firstSlot.startAt), false, '其他线索看不到已被占用的档');
  assert.equal(await occupancyFor(probeLeadId, customerSlot.localDate, customerSlot.startAt), true, '未占用档应仍可约');

  const customerRescheduled = await withTenantTransaction(enterpriseId, (transaction) =>
    new AppointmentRepository(transaction).reschedule({
      enterpriseId,
      appointmentId: booked.id,
      startAt: customerSlot.startAt,
      endAt: customerSlot.endAt,
      expectedVersion: booked.version,
      actorUserId: customerUserId,
      customerUserId,
      eventKey: `${runKey}-customer-reschedule`,
    })
  );

  const afterCustomer = await readPartyViews(booked.id);
  const customerIso = isoRange(customerRescheduled.timeRange);
  assert.equal(customerRescheduled.id, booked.id, '改期必须原地更新，不得另开一条预约');
  assert.equal(customerRescheduled.version, booked.version + 1);
  assert.equal(afterCustomer.leadAppointments.length, 1);
  assert.equal(afterCustomer.appointmentDto?.timeRange, customerIso);
  assert.equal(afterCustomer.leadDto.appointment?.id, booked.id.toString());
  assert.equal(afterCustomer.leadDto.appointment?.timeRange, customerIso);
  assert.equal(afterCustomer.leadDto.appointment?.version, customerRescheduled.version);
  assert.equal(afterCustomer.customerProject?.appointment?.id, booked.id);
  assert.equal(isoRange(afterCustomer.customerProject?.appointment?.timeRange), customerIso);
  assert.equal(Number(afterCustomer.customerIndex?.appointmentVersion), customerRescheduled.version);
  assert.equal(isoRange(afterCustomer.customerIndex?.appointmentTimeRange), customerIso);
  assert.equal(isoRange(afterCustomer.customerAccess?.appointment.timeRange), customerIso);
  assert.equal(isoRange(afterCustomer.measurerCalendar[0]?.timeRange), customerIso);
  assert.equal(
    isoRange(afterCustomer.enterpriseSchedule.find((row) => row.id === booked.id)?.timeRange),
    customerIso
  );
  assert.equal(afterCustomer.workbenchItem?.timeRange, customerIso);
  assert.equal(afterCustomer.home.kind, 'reschedule');
  assert.notEqual(afterCustomer.home.appointmentSummary, afterCreate.home.appointmentSummary);
  assert.equal(afterCustomer.appointmentRow?.measurerId, measurerId);
  assert.deepEqual(
    afterCustomer.events.map((event) => event.eventType).sort(),
    ['created', 'customer_rescheduled']
  );
  const customerEvent = afterCustomer.events.find((event) => event.eventType === 'customer_rescheduled');
  assert.equal(isoRange(customerEvent?.previousTimeRange), createdIso);
  assert.equal(isoRange(customerEvent?.timeRange), customerIso);
  assert.equal(await occupancyFor(probeLeadId, firstSlot.localDate, firstSlot.startAt), true, '改期后原时段应释放给其他线索');
  assert.equal(await occupancyFor(probeLeadId, customerSlot.localDate, customerSlot.startAt), false, '新时段应对其他线索关闭');

  const staffRescheduled = await withTenantTransaction(enterpriseId, (transaction) =>
    new AppointmentRepository(transaction).reschedule({
      enterpriseId,
      appointmentId: booked.id,
      startAt: staffSlot.startAt,
      endAt: staffSlot.endAt,
      expectedVersion: customerRescheduled.version,
      actorUserId: designerUserId,
      reason: '设计师协调改到傍晚',
      eventKey: `${runKey}-internal-reschedule`,
    })
  );

  const afterStaff = await readPartyViews(booked.id);
  const staffIso = isoRange(staffRescheduled.timeRange);
  assert.equal(staffRescheduled.id, booked.id);
  assert.equal(staffRescheduled.version, customerRescheduled.version + 1);
  assert.equal(afterStaff.leadAppointments.length, 1);
  assert.equal(afterStaff.appointmentDto?.timeRange, staffIso);
  assert.equal(afterStaff.leadDto.appointment?.timeRange, staffIso);
  assert.equal(isoRange(afterStaff.customerProject?.appointment?.timeRange), staffIso);
  assert.equal(isoRange(afterStaff.customerIndex?.appointmentTimeRange), staffIso);
  assert.equal(isoRange(afterStaff.measurerCalendar[0]?.timeRange), staffIso);
  assert.equal(afterStaff.workbenchItem?.timeRange, staffIso);
  assert.equal(afterStaff.home.kind, 'reschedule');
  assert.notEqual(afterStaff.home.appointmentSummary, afterCustomer.home.appointmentSummary);
  assert.deepEqual(
    afterStaff.events.map((event) => event.eventType).sort(),
    ['created', 'customer_rescheduled', 'internal_rescheduled']
  );
  const staffEvent = afterStaff.events.find((event) => event.eventType === 'internal_rescheduled');
  assert.equal(staffEvent?.reason, '设计师协调改到傍晚');
  assert.equal(isoRange(staffEvent?.previousTimeRange), customerIso);
  assert.equal(isoRange(staffEvent?.timeRange), staffIso);
  assert.equal(await occupancyFor(probeLeadId, customerSlot.localDate, customerSlot.startAt), true);
  assert.equal(await occupancyFor(probeLeadId, staffSlot.localDate, staffSlot.startAt), false);
});
