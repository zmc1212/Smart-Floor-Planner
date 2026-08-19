import crypto from 'node:crypto';
import { parsePostgresId } from '@/db/postgres-dto';
import {
  AdminUserRepository,
  type AdminUserRecord,
  UserRepository,
  type UserRecord,
} from '@/db/repositories';
import type { PostgresTransaction } from '@/db/transaction';
import type { MiniProgramContext } from '@/lib/miniprogram-auth';

const MANAGED_AVATAR_PREFIX = 'sfp-avatar:v1:';
const AVATAR_TTL_SECONDS = 60 * 60;

export const MINI_PROGRAM_ROLE_LABELS: Record<string, string> = {
  salesperson: '渠道地推',
  enterprise_admin: '企业负责人',
  admin: '平台负责人',
  super_admin: '平台负责人',
  designer: '设计师',
  measurer: '测量员',
  referrer: '推广人',
  viewer: '员工账号',
  user: '普通用户',
};

export type ManagedAvatarReference = {
  provider: string;
  objectKey: string;
  bucket?: string;
  mimeType: string;
};

function avatarSecret() {
  return process.env.JWT_SECRET || 'fallback_secret_random_123';
}

function avatarSignaturePayload(userId: string, expires: number) {
  return `${userId}:${expires}`;
}

function firstHeaderValue(value: string | null) {
  return value?.split(',')[0]?.trim() || '';
}

function publicRequestUrl(request: Request) {
  const requestUrl = new URL(request.url);
  const configuredOrigin = process.env.MINIPROGRAM_API_PUBLIC_ORIGIN?.trim();
  if (configuredOrigin) return new URL(configuredOrigin);

  const forwardedHost = firstHeaderValue(request.headers.get('x-forwarded-host'));
  const host = forwardedHost || request.headers.get('host')?.trim();
  const forwardedProtocol = firstHeaderValue(
    request.headers.get('x-forwarded-proto')
  ).replace(/:$/, '');
  const protocol = forwardedProtocol === 'http' || forwardedProtocol === 'https'
    ? forwardedProtocol
    : requestUrl.protocol.replace(/:$/, '');
  return host ? new URL(`${protocol}://${host}`) : requestUrl;
}

export function maskMiniProgramPhone(phone?: string | null) {
  if (!phone) return '';
  return phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
}

export function encodeManagedAvatarReference(
  reference: ManagedAvatarReference
) {
  return `${MANAGED_AVATAR_PREFIX}${Buffer.from(
    JSON.stringify(reference),
    'utf8'
  ).toString('base64url')}`;
}

export function decodeManagedAvatarReference(
  value?: string | null
): ManagedAvatarReference | null {
  if (!value?.startsWith(MANAGED_AVATAR_PREFIX)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value.slice(MANAGED_AVATAR_PREFIX.length), 'base64url').toString(
        'utf8'
      )
    ) as Partial<ManagedAvatarReference>;
    if (
      !parsed.provider ||
      !parsed.objectKey ||
      !parsed.mimeType ||
      !parsed.mimeType.startsWith('image/')
    ) {
      return null;
    }
    return {
      provider: String(parsed.provider),
      objectKey: String(parsed.objectKey),
      bucket: parsed.bucket ? String(parsed.bucket) : undefined,
      mimeType: String(parsed.mimeType),
    };
  } catch {
    return null;
  }
}

export function createProfileAvatarSignature(
  userId: string,
  expires: number
) {
  return crypto
    .createHmac('sha256', avatarSecret())
    .update(avatarSignaturePayload(userId, expires))
    .digest('hex');
}

export function verifyProfileAvatarSignature(input: {
  userId: string;
  expires: number;
  signature: string;
}) {
  if (
    !Number.isFinite(input.expires) ||
    input.expires < Math.floor(Date.now() / 1000)
  ) {
    return false;
  }
  const expected = createProfileAvatarSignature(input.userId, input.expires);
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(input.signature);
  if (expectedBuffer.length !== signatureBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}

export function resolveProfileAvatarUrl(input: {
  request: Request;
  userId: string;
  avatar?: string | null;
  ttlSeconds?: number;
}) {
  if (!input.avatar) return '';
  const managedReference = decodeManagedAvatarReference(input.avatar);
  if (!managedReference) {
    return input.avatar.startsWith(MANAGED_AVATAR_PREFIX) ? '' : input.avatar;
  }
  if (!/^[1-9]\d*$/.test(input.userId)) return '';

  const expires =
    Math.floor(Date.now() / 1000) +
    Math.max(60, input.ttlSeconds || AVATAR_TTL_SECONDS);
  const url = new URL(
    `/api/miniprogram/profile/avatar/${input.userId}`,
    publicRequestUrl(input.request)
  );
  url.searchParams.set('expires', String(expires));
  url.searchParams.set(
    'signature',
    createProfileAvatarSignature(input.userId, expires)
  );
  return url.toString();
}

export async function ensureMiniProgramProfileUser(
  transaction: PostgresTransaction,
  context: MiniProgramContext
) {
  const users = new UserRepository(transaction);
  const contextUserId = String(context.user._id || '');
  if (/^[1-9]\d*$/.test(contextUserId)) {
    const existing = await users.findById(
      parsePostgresId(contextUserId, 'user id')
    );
    if (existing) return existing;
  }

  if (!context.staff) {
    throw new Error('User profile not found');
  }

  const stableOpenid =
    context.staff.openid ||
    context.user.openid ||
    `staff_${String(context.staff._id)}`;
  const byOpenid = await users.findByOpenid(stableOpenid);
  if (byOpenid) return byOpenid;
  if (context.staff.phone) {
    const byPhone = await users.findByPhone(context.staff.phone);
    if (byPhone) return byPhone;
  }

  return users.create({
    enterpriseId: context.staff.enterpriseId
      ? BigInt(context.staff.enterpriseId)
      : null,
    role: 'staff',
    openid: stableOpenid,
    nickname:
      context.staff.displayName || context.staff.username || '员工账号',
    phone: context.staff.phone || null,
  });
}

export function serializeMiniProgramProfile(input: {
  request: Request;
  context: MiniProgramContext;
  user?: UserRecord | null;
  staff?: AdminUserRecord | null;
}) {
  const user = input.user || input.context.user;
  const staff = input.staff === undefined ? input.context.staff : input.staff;
  const isStaff = Boolean(staff);
  const role = input.context.mode === 'referrer'
    ? 'referrer'
    : input.context.mode === 'customer'
      ? 'user'
      : staff?.role || 'user';
  const phone = staff?.phone || String(user.phone || '');
  const userId = '_id' in user
    ? String(user._id || '')
    : 'id' in user
      ? String(user.id || '')
      : '';
  const avatar = resolveProfileAvatarUrl({
    request: input.request,
    userId,
    avatar: typeof user.avatar === 'string' ? user.avatar : '',
  });

  return {
    name:
      staff?.displayName ||
      staff?.username ||
      String(user.nickname || user.username || '微信用户'),
    avatar,
    username: staff?.username || String(user.username || ''),
    enterpriseName: input.context.enterprise?.name || '',
    role,
    roleLabel: MINI_PROGRAM_ROLE_LABELS[role] || '员工账号',
    phoneMasked: maskMiniProgramPhone(phone),
    isStaff,
    canChangePassword: isStaff,
  };
}

export async function updateMiniProgramNickname(input: {
  transaction: PostgresTransaction;
  context: MiniProgramContext;
  nickname: string;
}) {
  const user = await ensureMiniProgramProfileUser(
    input.transaction,
    input.context
  );
  const updatedUser = await new UserRepository(input.transaction).update(
    user.id,
    { nickname: input.nickname }
  );
  let updatedStaff: AdminUserRecord | null = null;
  if (input.context.staff) {
    updatedStaff = await new AdminUserRepository(input.transaction).update(
      parsePostgresId(input.context.staff._id, 'staff id'),
      { displayName: input.nickname }
    );
    if (!updatedStaff) throw new Error('员工账号不存在');
  }
  return { user: updatedUser || user, staff: updatedStaff };
}
