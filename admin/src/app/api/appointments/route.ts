import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { AdminUserRepository, AppointmentRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { appointmentToDto, parseAppointmentAddress, parseAppointmentDateTime, parseAppointmentId } from '@/lib/appointment-api';
import { httpErrorStatus } from '@/lib/http-error';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { getTenantContext } from '@/lib/auth';
import { withAdminPostgresTransaction, withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';
import { canStaffCreateLeadAppointment } from '@/lib/lead-staff-access';
import { notifyAppointmentStaff, notifyCustomerOfAppointment } from '@/lib/wechat-notification';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (context) {
      const searchParams = new URL(request.url).searchParams;
      const leadIdText = searchParams.get('leadId');
      const appointmentIdText = searchParams.get('appointmentId');
      const data = await withMiniProgramPostgresTransaction(context, async (transaction) => {
        const repository = new AppointmentRepository(transaction);
        if (context.mode === 'customer') {
          const leadId = parseAppointmentId(leadIdText, '线索');
          const lead = await repository.findCustomerLeadForAccess(BigInt(context.user._id), leadId);
          return lead?.enterpriseId ? repository.listByLead(lead.enterpriseId, leadId) : null;
        }
        if (!context.enterpriseId) return null;
        const enterpriseId = parsePostgresId(context.enterpriseId, 'enterprise id');
        if (context.mode === 'staff' && context.staff?.role === 'measurer' && appointmentIdText) {
          const appointmentId = parseAppointmentId(appointmentIdText, '预约');
          const appointment = await repository.findByIdAndMeasurer(
            enterpriseId,
            appointmentId,
            BigInt(context.staff._id)
          );
          return appointment ? [appointment] : null;
        }
        if (context.mode === 'staff' && context.staff?.role === 'measurer' && !leadIdText) {
          return repository.listByMeasurer(enterpriseId, BigInt(context.staff._id), ['confirmed', 'expired']);
        }
        const leadId = parseAppointmentId(leadIdText, '线索');
        const lead = await repository.findLeadForAccess(enterpriseId, leadId);
        if (!lead) return null;
        if (context.mode === 'staff' && context.staff?.role === 'designer' && lead.assignedTo !== BigInt(context.staff._id) && lead.measurerId !== BigInt(context.staff._id)) return null;
        if (context.mode === 'staff' && context.staff?.role === 'measurer') {
          if (lead.measurerId === BigInt(context.staff._id)) {
            return repository.listByLead(enterpriseId, leadId);
          }
          const appointments = await repository.listByLeadAndMeasurer(
            enterpriseId,
            leadId,
            BigInt(context.staff._id)
          );
          return appointments.length ? appointments : null;
        }
        return repository.listByLead(enterpriseId, leadId);
      });
      if (!data) return NextResponse.json({ success: false, error: '无权查看该预约' }, { status: 403 });
      return NextResponse.json({ success: true, data: data.map(appointmentToDto) });
    }

    // Keep the legacy Admin bearer/cookie path after Mini Program context
    // resolution so a Mini Program JWT is never treated as an Admin session.
    const admin = await getTenantContext(request);
    if (admin) {
      if (!admin.enterpriseId) return NextResponse.json({ success: false, error: '请先选择企业' }, { status: 400 });
      const leadId = parseAppointmentId(new URL(request.url).searchParams.get('leadId'), '线索');
      const data = await withAdminPostgresTransaction(admin, async (transaction) => {
        const repository = new AppointmentRepository(transaction);
        const lead = await repository.findLeadForAccess(parsePostgresId(admin.enterpriseId!, 'enterprise id'), leadId);
        if (!lead) return null;
        if (admin.role === 'designer' && lead.assignedTo !== parsePostgresId(admin.userId, 'user id')) return null;
        if (admin.role === 'measurer' && lead.measurerId !== parsePostgresId(admin.userId, 'user id')) return null;
        return repository.listByLead(parsePostgresId(admin.enterpriseId!, 'enterprise id'), leadId);
      });
      if (!data) return NextResponse.json({ success: false, error: '无权查看该预约' }, { status: 403 });
      return NextResponse.json({ success: true, data: data.map(appointmentToDto) });
    }
    return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
  } catch (error) {
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '读取预约失败' }, { status: httpErrorStatus(error, 400) });
  }
}

export async function POST(request: Request) {
  try {
    const miniContext = await resolveMiniProgramContext(request);
    const admin = miniContext ? null : await getTenantContext(request);
    if (admin) {
      if (!admin.enterpriseId || !['designer', 'measurer', 'enterprise_admin'].includes(admin.role)) {
        return NextResponse.json({ success: false, error: '仅负责设计师、已派测量员或企业负责人可创建预约' }, { status: 403 });
      }
      const body = await request.json();
      const leadId = parseAppointmentId(body.leadId, '线索');
      const appointment = await withAdminPostgresTransaction(admin, async (transaction) => {
        const repository = new AppointmentRepository(transaction);
        const enterpriseId = parsePostgresId(admin.enterpriseId!, 'enterprise id');
        const actorUserId = await new AdminUserRepository(transaction).findLinkedUserId(parsePostgresId(admin.userId, 'user id'));
        const access = await repository.findLeadForAccess(enterpriseId, leadId);
        if (!access || !canStaffCreateLeadAppointment({
          staffRole: admin.role,
          staffId: parsePostgresId(admin.userId, 'user id'),
          assignedTo: access.assignedTo,
          measurerId: access.measurerId,
          source: access.source,
          status: access.status,
        })) return null;
        return repository.create({
          enterpriseId,
          leadId,
          startAt: parseAppointmentDateTime(body.startAt, '开始时间'),
          endAt: parseAppointmentDateTime(body.endAt, '结束时间'),
          address: parseAppointmentAddress(body.address),
          actorUserId,
          eventKey: `admin-created:${randomUUID()}`,
        });
      });
      if (!appointment) return NextResponse.json({ success: false, error: '无权操作该线索' }, { status: 403 });
      const startAt = new Date(appointment.timeRange.match(/[[(]([^,]+),/)?.[1].replaceAll('"', '') || '');
      if (!Number.isNaN(startAt.getTime())) {
        await Promise.allSettled([
          notifyAppointmentStaff({ enterpriseId: appointment.enterpriseId, leadId, designerId: appointment.designerId, measurerId: appointment.measurerId, address: appointment.address, startsAt: startAt, eventKey: appointment.id.toString(), eventType: 'created' }),
          notifyCustomerOfAppointment({ enterpriseId: appointment.enterpriseId, leadId, address: appointment.address, startsAt: startAt, eventType: 'created' }),
        ]);
      }
      return NextResponse.json({ success: true, data: appointmentToDto(appointment) }, { status: 201 });
    }
    const context = miniContext;
    const isCustomer = context?.mode === 'customer';
    if (!context || (!isCustomer && (!context.enterpriseId || context.mode !== 'staff' || !context.staff || !['designer', 'measurer', 'enterprise_admin'].includes(context.staff.role)))) {
      return NextResponse.json({ success: false, error: '仅客户本人、负责设计师、已派测量员或企业负责人可创建预约' }, { status: 403 });
    }
    const body = await request.json();
    const leadId = parseAppointmentId(body.leadId, '线索');
    const appointment = await withMiniProgramPostgresTransaction(context, async (transaction) => {
      const repository = new AppointmentRepository(transaction);
      const access = isCustomer
        ? await repository.findCustomerLeadForAccess(BigInt(context.user._id), leadId)
        : await repository.findLeadForAccess(parsePostgresId(context.enterpriseId!, 'enterprise id'), leadId);
      if (!access?.enterpriseId) return null;
      if (!isCustomer && !canStaffCreateLeadAppointment({
        staffRole: context.staff!.role,
        staffId: BigInt(context.staff!._id),
        assignedTo: access.assignedTo,
        measurerId: access.measurerId,
        source: access.source,
        status: access.status,
      })) {
        return null;
      }
      return repository.create({
        enterpriseId: access.enterpriseId, leadId,
        startAt: parseAppointmentDateTime(body.startAt, '开始时间'),
        endAt: parseAppointmentDateTime(body.endAt, '结束时间'),
        address: parseAppointmentAddress(body.address),
        actorUserId: BigInt(context.user._id),
        eventKey: `created:${randomUUID()}`,
      });
    });
    if (!appointment) return NextResponse.json({ success: false, error: '无权操作该线索' }, { status: 403 });
    const enterpriseId = appointment.enterpriseId;
    const startAt = new Date(appointment.timeRange.match(/[[(]([^,]+),/)?.[1].replaceAll('"', '') || '');
    if (!Number.isNaN(startAt.getTime())) {
      await Promise.allSettled([
        notifyAppointmentStaff({ enterpriseId, leadId, designerId: appointment.designerId, measurerId: appointment.measurerId, address: appointment.address, startsAt: startAt, eventKey: appointment.id.toString(), eventType: 'created' }),
        notifyCustomerOfAppointment({ enterpriseId, leadId, address: appointment.address, startsAt: startAt, eventType: 'created' }),
      ]);
    }
    return NextResponse.json({ success: true, data: appointmentToDto(appointment) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '创建预约失败' }, { status: httpErrorStatus(error, 400) });
  }
}
