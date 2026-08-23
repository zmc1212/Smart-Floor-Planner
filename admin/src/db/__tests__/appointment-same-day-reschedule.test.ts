import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
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
import { localDateInTimeZone } from '@/lib/appointment-scheduling';
import {
  formatAppointmentTimeRangeIso,
  resolveCustomerHomeAction,
} from '@/lib/lead-service-stage';
import {
  buildWorkbenchAppointmentItem,
  selectMeasurerWorkbenchAppointments,
} from '@/lib/miniprogram-workbench';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';

const runKey = `appt-same-day-${process.pid}-${Date.now()}`;
const TIMEZONE = 'Asia/Shanghai';
const CUTOFF_MS = 2 * 3_600_000;
const ALL_DAY = Object.fromEntries(
  Array.from({ length: 7 }, (_, day) => [String(day), [{ start: '08:00', end: '23:00' }]])
);

let enterpriseId: bigint;
let customerUserId: bigint;
let designerUserId: bigint;
let designerId: bigint;
let measurerId: bigint;
let leadId: bigint;
let probeLeadId: bigint;
let cutoffLeadId: bigint;

type Slot = { startAt: Date; endAt: Date };

function isoRange(timeRange: string | null | undefined) {
  return formatAppointmentTimeRangeIso(timeRange);
}

function overlaps(left: Slot, right: Slot) {
  return left.startAt.getTime() < right.endAt.getTime() && right.startAt.getTime() < left.endAt.getTime();
}

async function todayAvailability(targetLeadId: bigint) {
  return withTenantTransaction(enterpriseId, (transaction) =>
    new AppointmentRepository(transaction).listAvailability({
      enterpriseId,
      leadId: targetLeadId,
      date: localDateInTimeZone(new Date(), TIMEZONE),
    })
  );
}

async function occupancyFor(targetLeadId: bigint, startAt: Date) {
  const availability = await todayAvailability(targetLeadId);
  return availability.available.some((slot) => slot.startAt.getTime() === startAt.getTime());
}

async function readPartyViews(appointmentId: bigint, targetLeadId = leadId) {
  return withTenantTransaction(enterpriseId, async (transaction) => {
    const appointments = new AppointmentRepository(transaction);
    const leadRecord = await new LeadRepository(transaction).findById(targetLeadId);
    assert.ok(leadRecord);
    const appointmentRow = await appointments.findById(enterpriseId, appointmentId);
    const customerProject = await new CustomerProjectRepository(transaction)
      .findCustomerProject(customerUserId, targetLeadId);
    const customerIndex = (await new CustomerProjectRepository(transaction).listCustomerProjects(customerUserId))
      .find((item) => item.leadId === targetLeadId);
        const measurerCalendar = (await appointments.listByMeasurer(enterpriseId, leadRecord.measurerId || measurerId))
      .filter((row) => row.leadId === targetLeadId);
    const workbenchAppointments = selectMeasurerWorkbenchAppointments(measurerCalendar);
    return {
      leadDto: leadToDto(leadRecord),
      appointmentDto: appointmentRow ? appointmentToDto(appointmentRow.appointment) : null,
      customerProject,
      customerIndex,
      measurerCalendar,
      workbenchItem: workbenchAppointments[0]
        ? buildWorkbenchAppointmentItem(workbenchAppointments[0], leadRecord)
        : null,
      home: resolveCustomerHomeAction({
        leadStatus: leadRecord.status,
        assignmentStatus: leadRecord.assignmentStatus,
        measurerId: leadRecord.measurerId,
        appointment: leadRecord.appointment,
        customerRescheduleCutoffHours: 2,
      }),
      events: await transaction
        .select()
        .from(measurementAppointmentEvents)
        .where(eq(measurementAppointmentEvents.appointmentId, appointmentId)),
    };
  });
}

before(async () => {
  loadEnvConfig(process.cwd());
  const databaseUrl = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(
    ['localhost', '127.0.0.1'].includes(databaseUrl.hostname),
    'Same-day appointment tests only mutate the local database'
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
        displayName: '当天改期设计师',
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
        displayName: '当天改期测量员',
        role: 'measurer',
        status: 'active',
        assignmentPaused: false,
      })
    ).id;
    const leadsRepo = new LeadRepository(transaction);
    leadId = (
      await leadsRepo.create({
        enterpriseId,
        assignedTo: designerId,
        measurerId,
        customerUserId,
        name: '当天改期客户',
        phone: `17${String(Date.now()).slice(-9)}`,
        source: 'same-day-reschedule-test',
        assignmentStatus: 'assigned',
        communityName: '当天改期小区',
      })
    ).id;
    probeLeadId = (
      await leadsRepo.create({
        enterpriseId,
        assignedTo: designerId,
        measurerId,
        customerUserId,
        name: '当天占用探测',
        phone: `18${String(Date.now()).slice(-9)}`,
        source: 'same-day-reschedule-test',
        assignmentStatus: 'assigned',
        communityName: '当天改期小区',
      })
    ).id;
    cutoffLeadId = (
      await leadsRepo.create({
        enterpriseId,
        assignedTo: designerId,
        measurerId,
        customerUserId,
        name: '当天截止客户',
        phone: `19${String(Date.now()).slice(-9)}`,
        source: 'same-day-reschedule-test',
        assignmentStatus: 'assigned',
        communityName: '当天改期小区',
      })
    ).id;
    await new AppointmentRepository(transaction).updateSettings(enterpriseId, {
      timezone: TIMEZONE,
      weeklySchedule: ALL_DAY,
      defaultDurationMinutes: 60,
      slotStepMinutes: 30,
      maxAdvanceDays: 14,
      customerRescheduleCutoffHours: 2,
    });
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

describe('same-day appointment reschedule', { concurrency: 1 }, () => {
test('same-day availability hides past starts and keeps later today bookable', async () => {
  const now = new Date();
  const { available } = await todayAvailability(leadId);
  assert.ok(available.length >= 2, '当天应仍有未来时段（测试把窗口放到 23:00）');
  assert.ok(available.every((slot) => slot.startAt.getTime() > now.getTime()), '已开始的档不能出现在当天可选列表');

  await assert.rejects(
    () => withTenantTransaction(enterpriseId, (transaction) =>
      new AppointmentRepository(transaction).create({
        enterpriseId,
        leadId,
        startAt: new Date(now.getTime() - 60_000),
        endAt: new Date(now.getTime() + 59 * 60_000),
        address: '当天改期小区 1 栋',
        actorUserId: customerUserId,
        eventKey: `${runKey}-past-create`,
      })
    ),
    (error: { code?: string }) => {
      assert.equal(error.code, 'appointment_time_past');
      return true;
    }
  );
});

test('same-day customer reschedule can move to a nearby overlapping slot and syncs every party', async () => {
  const now = Date.now();
  const { available } = await todayAvailability(leadId);
  const beyondCutoff = available.filter((slot) => slot.startAt.getTime() - now > CUTOFF_MS);
  assert.ok(beyondCutoff.length >= 2, '当天需至少两个超过客户改期截止的时段');

  const bookedSlot = beyondCutoff.at(-1)!;
  const nearby = beyondCutoff
    .filter((slot) => slot.startAt.getTime() !== bookedSlot.startAt.getTime() && overlaps(slot, bookedSlot))
    .at(-1);
  const fallback = beyondCutoff
    .filter((slot) => slot.startAt.getTime() !== bookedSlot.startAt.getTime() && !overlaps(slot, bookedSlot))
    .at(-1);
  const targetSlot = nearby || fallback;
  assert.ok(targetSlot, '当天应能改到另一档');

  const booked = await withTenantTransaction(enterpriseId, (transaction) =>
    new AppointmentRepository(transaction).create({
      enterpriseId,
      leadId,
      startAt: bookedSlot.startAt,
      endAt: bookedSlot.endAt,
      address: '当天改期小区 2 栋 201',
      actorUserId: customerUserId,
      eventKey: `${runKey}-same-day-create`,
    })
  );

  assert.equal(await occupancyFor(leadId, bookedSlot.startAt), true, '改期列表应排除自身占用，仍能看到当前档');
  assert.equal(await occupancyFor(probeLeadId, bookedSlot.startAt), false, '其他线索不能抢走当天已约档');
  assert.equal(await occupancyFor(leadId, targetSlot.startAt), true, '邻近重叠档应对本线索保持可选');

  const rescheduled = await withTenantTransaction(enterpriseId, (transaction) =>
    new AppointmentRepository(transaction).reschedule({
      enterpriseId,
      appointmentId: booked.id,
      startAt: targetSlot.startAt,
      endAt: targetSlot.endAt,
      expectedVersion: booked.version,
      actorUserId: customerUserId,
      customerUserId,
      eventKey: `${runKey}-same-day-customer`,
    })
  );

  const views = await readPartyViews(booked.id);
  const nextIso = isoRange(rescheduled.timeRange);
  assert.equal(rescheduled.id, booked.id);
  assert.equal(rescheduled.version, booked.version + 1);
  assert.equal(views.appointmentDto?.timeRange, nextIso);
  assert.equal(views.leadDto.appointment?.timeRange, nextIso);
  assert.equal(isoRange(views.customerProject?.appointment?.timeRange), nextIso);
  assert.equal(isoRange(views.customerIndex?.appointmentTimeRange), nextIso);
  assert.equal(isoRange(views.measurerCalendar[0]?.timeRange), nextIso);
  assert.equal(views.workbenchItem?.timeRange, nextIso);
  assert.equal(views.home.kind, 'reschedule');
  assert.notEqual(views.home.appointmentSummary, '');
  assert.equal(views.events.some((event) => event.eventType === 'customer_rescheduled'), true);
  assert.equal(await occupancyFor(probeLeadId, targetSlot.startAt), false, '当天新档应占用测量员');
  assert.equal(
    await occupancyFor(probeLeadId, bookedSlot.startAt),
    !overlaps(bookedSlot, targetSlot),
    '仅当新旧档不重叠时，原开始时间才应对其他线索释放'
  );
});

test('same-day customer cutoff still blocks last-minute changes while staff can move the visit', async (t) => {
  const now = Date.now();
  const { available } = await todayAvailability(cutoffLeadId);
  const insideCutoff = available.find((slot) => {
    const wait = slot.startAt.getTime() - now;
    return wait > 0 && wait <= CUTOFF_MS;
  });
  const later = available.find((slot) => (
    slot.startAt.getTime() - now > CUTOFF_MS && !overlaps(slot, insideCutoff)
  ));
  if (!insideCutoff || !later) {
    t.skip('当天已没有处于客户改期截止窗口内的时段');
    return;
  }

  const booked = await withTenantTransaction(enterpriseId, (transaction) =>
    new AppointmentRepository(transaction).create({
      enterpriseId,
      leadId: cutoffLeadId,
      startAt: insideCutoff.startAt,
      endAt: insideCutoff.endAt,
      address: '当天改期小区 3 栋',
      actorUserId: customerUserId,
      eventKey: `${runKey}-cutoff-create`,
    })
  );

  const beforeStaff = await readPartyViews(booked.id, cutoffLeadId);
  assert.equal(beforeStaff.home.kind, 'view_project', '距上门不足 2 小时时应收回客户改期入口');

  await assert.rejects(
    () => withTenantTransaction(enterpriseId, (transaction) =>
      new AppointmentRepository(transaction).reschedule({
        enterpriseId,
        appointmentId: booked.id,
        startAt: later.startAt,
        endAt: later.endAt,
        expectedVersion: booked.version,
        actorUserId: customerUserId,
        customerUserId,
        eventKey: `${runKey}-cutoff-customer`,
      })
    ),
    (error: { code?: string }) => {
      assert.equal(error.code, 'appointment_customer_cutoff');
      return true;
    }
  );

  const staffMoved = await withTenantTransaction(enterpriseId, (transaction) =>
    new AppointmentRepository(transaction).reschedule({
      enterpriseId,
      appointmentId: booked.id,
      startAt: later.startAt,
      endAt: later.endAt,
      expectedVersion: booked.version,
      actorUserId: designerUserId,
      reason: '当天临时改到晚些',
      eventKey: `${runKey}-cutoff-staff`,
    })
  );

  const views = await readPartyViews(booked.id, cutoffLeadId);
  const staffIso = isoRange(staffMoved.timeRange);
  assert.equal(staffMoved.id, booked.id);
  assert.equal(views.appointmentDto?.timeRange, staffIso);
  assert.equal(views.leadDto.appointment?.timeRange, staffIso);
  assert.equal(isoRange(views.customerProject?.appointment?.timeRange), staffIso);
  assert.equal(isoRange(views.measurerCalendar[0]?.timeRange), staffIso);
  assert.equal(views.workbenchItem?.timeRange, staffIso);
  assert.equal(views.home.kind, 'reschedule');
  assert.equal(views.events.some((event) => event.eventType === 'internal_rescheduled'), true);
  assert.equal(await occupancyFor(probeLeadId, insideCutoff.startAt), true);
  assert.equal(await occupancyFor(probeLeadId, later.startAt), false);
});
});
