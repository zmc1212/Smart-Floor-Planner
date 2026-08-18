import { NextResponse } from 'next/server';
import {
  AdminUserRepository,
  AppointmentRepository,
  LeadCommissionRepository,
  ReferrerNetworkRepository,
} from '@/db/repositories';
import { adminUserToDto, parsePostgresId } from '@/db/postgres-dto';
import { withTenantTransaction } from '@/db/transaction';
import { enterpriseJoinCodeToDto } from '@/lib/referrer-network-api';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin', 'enterprise_admin'], requireEnterprise: true },
      async (context) => {
        const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterpriseId');
        const actorId = parsePostgresId(context.userId, 'actorId');
        const data = await withTenantTransaction(context.enterpriseId!, async (transaction) => {
          const network = new ReferrerNetworkRepository(transaction);
          const [codes, events, activeReferrerMemberships, staff, appointmentSettings, commissionRules] = await Promise.all([
            network.listEnterpriseJoinCodes(enterpriseId),
            network.listEnterpriseJoinCodeEvents(enterpriseId),
            network.countActiveReferrerMemberships(enterpriseId),
            new AdminUserRepository(transaction).list({ roles: ['designer', 'measurer'], page: 1, limit: 200 }),
            new AppointmentRepository(transaction).getSettings(enterpriseId),
            new LeadCommissionRepository(transaction).listRules(enterpriseId, actorId),
          ]);
          return {
            codes: codes.map(enterpriseJoinCodeToDto),
            events: events.map(({ event, codeType }) => ({
              id: event.id.toString(),
              joinCodeId: event.joinCodeId.toString(),
              codeType,
              eventType: event.eventType,
              result: event.result,
              actorUserId: event.actorUserId?.toString() ?? null,
              actorStaffId: event.actorStaffId?.toString() ?? null,
              metadata: event.metadata ?? {},
              createdAt: event.createdAt,
            })),
            activeReferrerMemberships,
            staff: staff.rows.map((member) => adminUserToDto(member)),
            appointmentSettings: {
              id: appointmentSettings.id.toString(),
              configured: appointmentSettings.updatedAt.getTime() > appointmentSettings.createdAt.getTime(),
              configuredAt: appointmentSettings.updatedAt.getTime() > appointmentSettings.createdAt.getTime()
                ? appointmentSettings.updatedAt
                : null,
              timezone: appointmentSettings.timezone,
              weeklySchedule: appointmentSettings.weeklySchedule,
              defaultDurationMinutes: appointmentSettings.defaultDurationMinutes,
              slotStepMinutes: appointmentSettings.slotStepMinutes,
              maxAdvanceDays: appointmentSettings.maxAdvanceDays,
              customerRescheduleCutoffHours: appointmentSettings.customerRescheduleCutoffHours,
            },
            commissionRules: commissionRules.map((rule) => ({
              id: rule.id.toString(),
              role: rule.role,
              status: rule.status,
              calculationType: rule.calculationType,
              value: rule.value,
            })),
          };
        });
        return NextResponse.json({
          success: true,
          data: {
            ...data,
            wechatMiniProgramCodeProviderConfigured: Boolean(
              process.env.WX_APPID && process.env.WX_APPSECRET
            ),
          },
        });
      }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unable to load readiness' },
      { status: 500 }
    );
  }
}
