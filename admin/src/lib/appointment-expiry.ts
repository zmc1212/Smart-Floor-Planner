import { AppointmentRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import {
  notifyAppointmentStaff,
  notifyCustomerOfAppointment,
} from '@/lib/wechat-notification';
import { parseAppointmentBounds } from '@/lib/lead-service-stage';

function appointmentStartsAt(appointment: { timeRange: string; updatedAt: Date }) {
  return parseAppointmentBounds(appointment.timeRange)?.startAt || appointment.updatedAt;
}

async function notifyExpiry(appointment: {
  id: bigint;
  enterpriseId: bigint;
  leadId: bigint;
  designerId: bigint;
  measurerId: bigint;
  address: string;
  timeRange: string;
  updatedAt: Date;
  version: number;
}, eventKey: string, includeCustomer: boolean) {
  const startsAt = appointmentStartsAt(appointment);
  await Promise.allSettled([
    notifyAppointmentStaff({
      enterpriseId: appointment.enterpriseId,
      leadId: appointment.leadId,
      designerId: appointment.designerId,
      measurerId: appointment.measurerId,
      address: appointment.address,
      startsAt,
      eventKey,
      eventType: 'expired',
    }),
    includeCustomer
      ? notifyCustomerOfAppointment({
          enterpriseId: appointment.enterpriseId,
          leadId: appointment.leadId,
          address: appointment.address,
          startsAt,
          eventType: 'expired',
        })
      : Promise.resolve(),
  ]);
}

export async function expireOverdueAppointmentsAndNotify(input: { now?: Date; limit?: number } = {}) {
  const now = input.now || new Date();
  const expired = await withPlatformTransaction((transaction) =>
    new AppointmentRepository(transaction).expireOverdue({ ...input, now })
  );
  await Promise.allSettled(expired.map((appointment) =>
    notifyExpiry(appointment, `appointment_expired:${appointment.id.toString()}:${appointment.version}`, true)
  ));

  const followUps = await withPlatformTransaction((transaction) =>
    new AppointmentRepository(transaction).listExpiredUnbookedDue(now, input.limit)
  );
  let reminded = 0;
  for (const row of followUps) {
    const intervalHours = Math.max(1, Number(row.reminderIntervalHours || 24));
    const bucket = Math.floor(now.getTime() / (intervalHours * 60 * 60 * 1000));
    const eventKey = `appointment_expired_followup:${row.appointment.id.toString()}:${bucket}`;
    await notifyExpiry(row.appointment, eventKey, false);
    reminded += 1;
  }

  return { expired: expired.length, reminded };
}
