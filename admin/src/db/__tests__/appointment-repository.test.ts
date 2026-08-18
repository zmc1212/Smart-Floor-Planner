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
  staffUnavailabilityPeriods,
  users,
} from '@/db/schema';
import {
  AdminUserRepository,
  AppointmentRepository,
  EnterpriseRepository,
  LeadRepository,
} from '@/db/repositories';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { localDateInTimeZone, zonedDateTimeToUtc } from '@/lib/appointment-scheduling';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';

const runKey = `appointment-${process.pid}-${Date.now()}`;
let enterpriseId: bigint;
let otherEnterpriseId: bigint;
let actorUserId: bigint;
let designerId: bigint;
let measurerId: bigint;
let firstLeadId: bigint;
let secondLeadId: bigint;
let bookedLeadId: bigint;

function nextBookableSlot(hour: string) {
  const localToday = localDateInTimeZone(new Date(), 'Asia/Shanghai');
  const date = new Date(`${localToday}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  const localDate = date.toISOString().slice(0, 10);
  const startAt = zonedDateTimeToUtc(localDate, hour, 'Asia/Shanghai');
  return { startAt, endAt: new Date(startAt.getTime() + 120 * 60_000) };
}

before(async () => {
  loadEnvConfig(process.cwd());
  const databaseUrl = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['localhost', '127.0.0.1'].includes(databaseUrl.hostname), 'Appointment integration tests only mutate the local database');

  await withPlatformTransaction(async (transaction) => {
    const enterprisesRepository = new EnterpriseRepository(transaction);
    enterpriseId = (await enterprisesRepository.create({ name: `${runKey}-main`, code: `${runKey}-main`, status: 'active' })).id;
    otherEnterpriseId = (await enterprisesRepository.create({ name: `${runKey}-other`, code: `${runKey}-other`, status: 'active' })).id;
    const [actor] = await transaction.insert(users).values({ phone: `16${String(Date.now()).slice(-9)}`, nickname: `${runKey}-actor` }).returning();
    actorUserId = actor.id;
  });

  await withTenantTransaction(enterpriseId, async (transaction) => {
    const staff = new AdminUserRepository(transaction);
    designerId = (await staff.create({
      enterpriseId, username: `${runKey}-designer`, passwordHash: 'test-only', displayName: '预约设计师', role: 'designer', status: 'active', assignmentPaused: false,
    })).id;
    measurerId = (await staff.create({
      enterpriseId, username: `${runKey}-measurer`, passwordHash: 'test-only', displayName: '预约测量员', role: 'measurer', status: 'active', assignmentPaused: false,
    })).id;
    const leadRepository = new LeadRepository(transaction);
    firstLeadId = (await leadRepository.create({
      enterpriseId, assignedTo: designerId, measurerId, customerUserId: actorUserId,
      name: '预约客户一', phone: `17${String(Date.now()).slice(-9)}`, source: 'appointment-test', assignmentStatus: 'assigned',
    })).id;
    secondLeadId = (await leadRepository.create({
      enterpriseId, assignedTo: designerId, measurerId, customerUserId: actorUserId,
      name: '预约客户二', phone: `18${String(Date.now()).slice(-9)}`, source: 'appointment-test', assignmentStatus: 'assigned',
    })).id;
  });
});

after(async () => {
  await withPlatformTransaction(async (transaction) => {
    if (enterpriseId) {
      await transaction.delete(measurementAppointmentEvents).where(eq(measurementAppointmentEvents.enterpriseId, enterpriseId));
      await transaction.delete(measurementAppointments).where(eq(measurementAppointments.enterpriseId, enterpriseId));
      await transaction.delete(staffUnavailabilityPeriods).where(eq(staffUnavailabilityPeriods.enterpriseId, enterpriseId));
      await transaction.delete(leads).where(eq(leads.enterpriseId, enterpriseId));
      await transaction.delete(adminUsers).where(eq(adminUsers.enterpriseId, enterpriseId));
      await transaction.delete(enterprises).where(inArray(enterprises.id, [enterpriseId, otherEnterpriseId]));
    }
    if (actorUserId) await transaction.delete(users).where(eq(users.id, actorUserId));
  });
  await closePostgresPool();
});

test('appointments enforce the measurer range exclusion constraint and retain audit events', async () => {
  const slot = nextBookableSlot('09:00');
  const attempts = await Promise.allSettled([firstLeadId, secondLeadId].map((leadId, index) =>
    withTenantTransaction(enterpriseId, (transaction) => new AppointmentRepository(transaction).create({
      enterpriseId, leadId, startAt: slot.startAt, endAt: slot.endAt, address: '测试小区 1 号', actorUserId, eventKey: `${runKey}-create-${index}`,
    }))
  ));
  assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
  bookedLeadId = [firstLeadId, secondLeadId][attempts.findIndex((result) => result.status === 'fulfilled')];

  const persisted = await withPlatformTransaction(async (transaction) => ({
    appointments: await transaction.select().from(measurementAppointments).where(eq(measurementAppointments.enterpriseId, enterpriseId)),
    events: await transaction.select().from(measurementAppointmentEvents).where(eq(measurementAppointmentEvents.enterpriseId, enterpriseId)),
  }));
  assert.equal(persisted.appointments.length, 1);
  assert.equal(persisted.events.length, 1);
  assert.equal(persisted.events[0]?.eventType, 'created');

  const customerAccess = await withPlatformTransaction(async (transaction) => {
    const repository = new AppointmentRepository(transaction);
    return {
      lead: await repository.findCustomerLeadForAccess(actorUserId, bookedLeadId),
      appointment: await repository.findCustomerAppointmentForAccess(actorUserId, persisted.appointments[0]!.id),
      otherCustomerLead: await repository.findCustomerLeadForAccess(-1n, bookedLeadId),
      otherCustomerAppointment: await repository.findCustomerAppointmentForAccess(-1n, persisted.appointments[0]!.id),
    };
  });
  assert.equal(customerAccess.lead?.id, bookedLeadId);
  assert.equal(customerAccess.appointment?.appointment.id, persisted.appointments[0]!.id);
  assert.equal(customerAccess.otherCustomerLead, null);
  assert.equal(customerAccess.otherCustomerAppointment, null);
});

test('rescheduling, unavailability, and tenant RLS preserve appointment boundaries', async () => {
  const appointment = await withTenantTransaction(enterpriseId, (transaction) =>
    new AppointmentRepository(transaction).listByLead(enterpriseId, bookedLeadId)
  ).then((rows) => rows[0] ?? null);
  assert.ok(appointment);

  const nextSlot = nextBookableSlot('13:00');
  const rescheduled = await withTenantTransaction(enterpriseId, (transaction) =>
    new AppointmentRepository(transaction).reschedule({
      enterpriseId, appointmentId: appointment!.id, startAt: nextSlot.startAt, endAt: nextSlot.endAt,
      expectedVersion: appointment!.version, actorUserId, eventKey: `${runKey}-reschedule`, customerUserId: actorUserId,
    })
  );
  assert.equal(rescheduled.version, 2);

  await withTenantTransaction(enterpriseId, (transaction) =>
    new AppointmentRepository(transaction).createUnavailability({
      enterpriseId, staffId: measurerId, startAt: nextBookableSlot('15:00').startAt, endAt: nextBookableSlot('15:00').endAt,
      reason: '培训', createdBy: designerId,
    })
  );
  const availability = await withTenantTransaction(enterpriseId, (transaction) =>
    new AppointmentRepository(transaction).listAvailability({
      enterpriseId, leadId: bookedLeadId, date: localDateInTimeZone(nextSlot.startAt, 'Asia/Shanghai'),
    })
  );
  assert.equal(availability.available.some((slot) => slot.startAt.getTime() === nextBookableSlot('15:00').startAt.getTime()), false);

  const otherLeadId = bookedLeadId === firstLeadId ? secondLeadId : firstLeadId;
  const earlierSlot = nextBookableSlot('09:00');
  await withTenantTransaction(enterpriseId, (transaction) =>
    new AppointmentRepository(transaction).create({
      enterpriseId,
      leadId: otherLeadId,
      startAt: earlierSlot.startAt,
      endAt: earlierSlot.endAt,
      address: '测试小区 2 号',
      actorUserId,
      eventKey: `${runKey}-calendar-order`,
    })
  );
  const calendar = await withTenantTransaction(enterpriseId, (transaction) =>
    new AppointmentRepository(transaction).listByMeasurer(enterpriseId, measurerId)
  );
  assert.equal(calendar[0]?.leadId, otherLeadId, '日程应按实际上门时间而非创建时间排序');
  assert.equal(calendar[1]?.leadId, bookedLeadId);

  const crossTenant = await withTenantTransaction(otherEnterpriseId, (transaction) =>
    new AppointmentRepository(transaction).listByLead(enterpriseId, bookedLeadId)
  );
  assert.deepEqual(crossTenant, []);
});
