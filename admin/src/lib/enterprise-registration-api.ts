import type {
  platformEnterpriseRegistrationCodeEvents,
  platformEnterpriseRegistrationCodes,
} from '@/db/schema';

export function enterpriseRegistrationCodeToDto(
  code: typeof platformEnterpriseRegistrationCodes.$inferSelect
) {
  return {
    id: code.id.toString(),
    status: code.status,
    version: code.version,
    expiresAt: code.expiresAt,
    disabledAt: code.disabledAt,
    createdAt: code.createdAt,
    updatedAt: code.updatedAt,
  };
}

export function enterpriseRegistrationCodeEventToDto(
  event: typeof platformEnterpriseRegistrationCodeEvents.$inferSelect
) {
  return {
    id: event.id.toString(),
    registrationCodeId: event.registrationCodeId.toString(),
    eventType: event.eventType,
    result: event.result,
    actorUserId: event.actorUserId?.toString() ?? null,
    actorStaffId: event.actorStaffId?.toString() ?? null,
    createdAt: event.createdAt,
  };
}

export const ENTERPRISE_REGISTRATION_PLATFORM_LABEL = '家客来企业入驻';
