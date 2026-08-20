import {
  AdminUserRepository,
  EnterpriseRepository,
} from '@/db/repositories';
import type { PostgresTransaction } from '@/db/transaction';

export type SelfServiceEnterpriseContactPerson = {
  name: string;
  phone: string;
  email?: string;
};

export type SelfServiceEnterpriseApplicationInput = {
  name: string;
  code: string;
  contactPerson: SelfServiceEnterpriseContactPerson;
};

export class SelfServiceEnterpriseApplicationError extends Error {
  code: 'VALIDATION' | 'ACCOUNT_CONFLICT' | '23505';

  constructor(
    message: string,
    code: 'VALIDATION' | 'ACCOUNT_CONFLICT' | '23505' = 'VALIDATION'
  ) {
    super(message);
    this.name = 'SelfServiceEnterpriseApplicationError';
    this.code = code;
  }
}

function normalizeContactPerson(input: SelfServiceEnterpriseContactPerson) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
  const email =
    typeof input.email === 'string' && input.email.trim()
      ? input.email.trim()
      : undefined;
  if (!name || !phone) {
    throw new SelfServiceEnterpriseApplicationError('请填写所有必填字段');
  }
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    throw new SelfServiceEnterpriseApplicationError(
      '联系人手机号格式不正确'
    );
  }
  return { name, phone, ...(email ? { email } : {}) };
}

export function parseSelfServiceEnterpriseApplicationBody(body: {
  name?: unknown;
  code?: unknown;
  contactPerson?: Partial<SelfServiceEnterpriseContactPerson> | null;
}): SelfServiceEnterpriseApplicationInput {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!name || !code || !body.contactPerson) {
    throw new SelfServiceEnterpriseApplicationError('请填写所有必填字段');
  }
  return {
    name,
    code,
    contactPerson: normalizeContactPerson({
      name: body.contactPerson.name || '',
      phone: body.contactPerson.phone || '',
      email: body.contactPerson.email,
    }),
  };
}

/**
 * Shared create path for Web `/api/auth/register-enterprise` and Mini Program
 * `/api/miniprogram/enterprise-registration`.
 */
export async function createSelfServiceEnterpriseApplication(
  transaction: PostgresTransaction,
  input: SelfServiceEnterpriseApplicationInput
) {
  const parsed = parseSelfServiceEnterpriseApplicationBody(input);
  const adminUsers = new AdminUserRepository(transaction);
  const enterprises = new EnterpriseRepository(transaction);

  if (await adminUsers.findByUsernameOrPhone(parsed.contactPerson.phone)) {
    throw new SelfServiceEnterpriseApplicationError(
      '该联系人手机号已注册为系统账号，请更换手机号或联系平台管理员',
      'ACCOUNT_CONFLICT'
    );
  }
  if (await enterprises.findByCode(parsed.code)) {
    throw new SelfServiceEnterpriseApplicationError(
      '该统一社会信用代码已注册',
      '23505'
    );
  }

  return enterprises.create({
    name: parsed.name,
    code: parsed.code,
    contactPerson: parsed.contactPerson,
    status: 'pending_approval',
    registrationMode: 'self_service',
  });
}

export function selfServiceEnterpriseApplicationHttpStatus(
  error: unknown
): number {
  if (error instanceof SelfServiceEnterpriseApplicationError) {
    return error.code === 'VALIDATION' ? 400 : 400;
  }
  const details = error as { code?: string };
  if (details.code === '23505' || details.code === 'ACCOUNT_CONFLICT') {
    return 400;
  }
  return 500;
}
