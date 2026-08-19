import crypto from 'node:crypto';
import { and, asc, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import {
  adminUsers,
  enterpriseJoinCodeEvents,
  enterpriseJoinCodes,
  enterprises,
  platformConfigs,
  promotionScanAudits,
  referrerEnterpriseMemberships,
  referrerProfiles,
  referrerPromotionCodes,
  staffActivityCodes,
  users,
} from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type EnterpriseJoinCodeType = 'staff' | 'referrer';

export type JoinCodeResolutionCode =
  | 'ok'
  | 'code_not_found'
  | 'code_rotated'
  | 'code_disabled'
  | 'code_expired';

export type StaffOnboardingCode =
  | JoinCodeResolutionCode
  | 'code_type_mismatch'
  | 'phone_authorization_required'
  | 'staff_enterprise_conflict';

export type ReferrerOnboardingCode =
  | JoinCodeResolutionCode
  | 'code_type_mismatch'
  | 'phone_authorization_required'
  | 'referrer_disabled'
  | 'membership_limit_reached';

const TOKEN_BYTES = 24;

function tokenSecret() {
  const configured =
    process.env.REFERRER_TOKEN_SECRET ||
    process.env.JWT_SECRET;
  if (
    process.env.NODE_ENV === 'production' &&
    (!configured || Buffer.byteLength(configured, 'utf8') < 16)
  ) {
    throw new Error(
      'REFERRER_TOKEN_SECRET or JWT_SECRET must contain at least 128 bits'
    );
  }
  return configured || 'local_referrer_token_secret_32_bytes';
}

export function hashReferrerNetworkToken(token: string) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createEnterpriseJoinToken(
  enterpriseId: bigint,
  codeType: EnterpriseJoinCodeType,
  version: number
) {
  const digest = crypto
    .createHmac('sha256', tokenSecret())
    .update(
      `enterprise-join:${enterpriseId.toString()}:${codeType}:${version}`
    )
    .digest()
    .subarray(0, TOKEN_BYTES)
    .toString('base64url');
  return `ej_${digest}`;
}

export function createStaffActivityToken(staffId: bigint, version: number) {
  const digest = crypto
    .createHmac('sha256', tokenSecret())
    .update(`staff-activity:${staffId.toString()}:${version}`)
    .digest()
    .subarray(0, TOKEN_BYTES)
    .toString('base64url');
  return `sa_${digest}`;
}

export function createReferrerPromotionToken(
  membershipId: bigint,
  version: number
) {
  const digest = crypto
    .createHmac('sha256', tokenSecret())
    .update(`referrer-promotion:${membershipId.toString()}:${version}`)
    .digest()
    .subarray(0, TOKEN_BYTES)
    .toString('base64url');
  return `rp_${digest}`;
}

function joinCodeState(
  code: typeof enterpriseJoinCodes.$inferSelect | null
): JoinCodeResolutionCode {
  if (!code) return 'code_not_found';
  if (code.status === 'rotated') return 'code_rotated';
  if (code.status === 'disabled') return 'code_disabled';
  if (code.status === 'expired') return 'code_expired';
  if (code.expiresAt && code.expiresAt.getTime() <= Date.now()) {
    return 'code_expired';
  }
  return 'ok';
}

export interface ReferrerMembershipRecord {
  membership: typeof referrerEnterpriseMemberships.$inferSelect;
  enterpriseName: string;
  promotionCode: typeof referrerPromotionCodes.$inferSelect | null;
}

export interface EnterpriseReferrerMembershipRecord {
  membership: typeof referrerEnterpriseMemberships.$inferSelect;
  displayName: string;
  phone: string | null;
  promotionCode: typeof referrerPromotionCodes.$inferSelect | null;
}

export type ReferrerMembershipStatus = 'active' | 'disabled' | 'exited';

export class ReferrerNetworkRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  private async lockKey(key: string) {
    await this.transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`
    );
  }

  private async findUserForUpdate(userId: bigint) {
    const rows = await this.transaction
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for('update');
    return rows[0] ?? null;
  }

  private async findJoinCodeByHash(tokenHash: string) {
    const rows = await this.transaction
      .select()
      .from(enterpriseJoinCodes)
      .where(eq(enterpriseJoinCodes.tokenHash, tokenHash))
      .limit(1);
    return rows[0] ?? null;
  }

  private async recordJoinCodeEvent(input: {
    code: typeof enterpriseJoinCodes.$inferSelect;
    eventType: string;
    result: string;
    actorUserId?: bigint | null;
    actorStaffId?: bigint | null;
    metadata?: Record<string, unknown>;
  }) {
    await this.transaction.insert(enterpriseJoinCodeEvents).values({
      enterpriseId: input.code.enterpriseId,
      joinCodeId: input.code.id,
      eventType: input.eventType,
      result: input.result,
      actorUserId: input.actorUserId ?? null,
      actorStaffId: input.actorStaffId ?? null,
      metadata: input.metadata ?? {},
    });
  }

  async listEnterpriseJoinCodes(enterpriseId: bigint) {
    return this.transaction
      .select()
      .from(enterpriseJoinCodes)
      .where(eq(enterpriseJoinCodes.enterpriseId, enterpriseId))
      .orderBy(
        asc(enterpriseJoinCodes.codeType),
        desc(enterpriseJoinCodes.version),
        desc(enterpriseJoinCodes.id)
      );
  }

  async listEnterpriseJoinCodeEvents(enterpriseId: bigint, limit = 50) {
    return this.transaction
      .select({
        event: enterpriseJoinCodeEvents,
        codeType: enterpriseJoinCodes.codeType,
      })
      .from(enterpriseJoinCodeEvents)
      .innerJoin(
        enterpriseJoinCodes,
        eq(enterpriseJoinCodeEvents.joinCodeId, enterpriseJoinCodes.id)
      )
      .where(eq(enterpriseJoinCodeEvents.enterpriseId, enterpriseId))
      .orderBy(desc(enterpriseJoinCodeEvents.createdAt), desc(enterpriseJoinCodeEvents.id))
      .limit(Math.max(1, Math.min(limit, 100)));
  }

  async countActiveReferrerMemberships(enterpriseId: bigint) {
    const rows = await this.transaction
      .select({ value: count() })
      .from(referrerEnterpriseMemberships)
      .where(
        and(
          eq(referrerEnterpriseMemberships.enterpriseId, enterpriseId),
          eq(referrerEnterpriseMemberships.status, 'active')
        )
      );
    return Number(rows[0]?.value ?? 0);
  }

  async countActiveReferrerPromotionCodes(enterpriseId: bigint) {
    const rows = await this.transaction
      .select({ value: count() })
      .from(referrerPromotionCodes)
      .innerJoin(
        referrerEnterpriseMemberships,
        eq(referrerPromotionCodes.membershipId, referrerEnterpriseMemberships.id)
      )
      .where(
        and(
          eq(referrerPromotionCodes.enterpriseId, enterpriseId),
          eq(referrerPromotionCodes.status, 'active'),
          eq(referrerEnterpriseMemberships.status, 'active')
        )
      );
    return Number(rows[0]?.value ?? 0);
  }

  async revealActiveEnterpriseJoinCode(input: {
    enterpriseId: bigint;
    codeType: EnterpriseJoinCodeType;
    actorStaffId: bigint;
  }) {
    const rows = await this.transaction
      .select()
      .from(enterpriseJoinCodes)
      .where(
        and(
          eq(enterpriseJoinCodes.enterpriseId, input.enterpriseId),
          eq(enterpriseJoinCodes.codeType, input.codeType),
          eq(enterpriseJoinCodes.status, 'active')
        )
      )
      .orderBy(desc(enterpriseJoinCodes.version), desc(enterpriseJoinCodes.id))
      .limit(1);
    const code = rows[0] ?? null;
    if (!code || (code.expiresAt && code.expiresAt <= new Date())) return null;
    await this.recordJoinCodeEvent({
      code,
      eventType: 'reveal',
      result: 'token_revealed',
      actorStaffId: input.actorStaffId,
    });
    return {
      code,
      token: createEnterpriseJoinToken(code.enterpriseId, input.codeType, code.version),
    };
  }

  async rotateEnterpriseJoinCode(input: {
    enterpriseId: bigint;
    codeType: EnterpriseJoinCodeType;
    actorStaffId: bigint;
    expiresAt?: Date | null;
  }) {
    await this.lockKey(
      `enterprise-join-code:${input.enterpriseId.toString()}:${input.codeType}`
    );
    const existing = await this.transaction
      .select()
      .from(enterpriseJoinCodes)
      .where(
        and(
          eq(enterpriseJoinCodes.enterpriseId, input.enterpriseId),
          eq(enterpriseJoinCodes.codeType, input.codeType)
        )
      )
      .orderBy(desc(enterpriseJoinCodes.version), desc(enterpriseJoinCodes.id))
      .for('update');
    const active = existing.find((row) => row.status === 'active') ?? null;
    const now = new Date();
    if (active) {
      await this.transaction
        .update(enterpriseJoinCodes)
        .set({
          status: 'rotated',
          disabledAt: now,
          disabledBy: input.actorStaffId,
          updatedAt: now,
        })
        .where(eq(enterpriseJoinCodes.id, active.id));
      await this.recordJoinCodeEvent({
        code: active,
        eventType: 'rotate_out',
        result: 'code_rotated',
        actorStaffId: input.actorStaffId,
      });
    }

    const version = (existing[0]?.version ?? 0) + 1;
    const token = createEnterpriseJoinToken(
      input.enterpriseId,
      input.codeType,
      version
    );
    const rows = await this.transaction
      .insert(enterpriseJoinCodes)
      .values({
        enterpriseId: input.enterpriseId,
        codeType: input.codeType,
        tokenHash: hashReferrerNetworkToken(token),
        status: 'active',
        version,
        expiresAt: input.expiresAt ?? null,
        createdBy: input.actorStaffId,
      })
      .returning();
    await this.recordJoinCodeEvent({
      code: rows[0],
      eventType: 'rotate_in',
      result: 'active',
      actorStaffId: input.actorStaffId,
      metadata: { replacedJoinCodeId: active?.id.toString() ?? null },
    });
    return { code: rows[0], token };
  }

  async disableEnterpriseJoinCode(input: {
    enterpriseId: bigint;
    codeType: EnterpriseJoinCodeType;
    actorStaffId: bigint;
  }) {
    await this.lockKey(
      `enterprise-join-code:${input.enterpriseId.toString()}:${input.codeType}`
    );
    const rows = await this.transaction
      .select()
      .from(enterpriseJoinCodes)
      .where(
        and(
          eq(enterpriseJoinCodes.enterpriseId, input.enterpriseId),
          eq(enterpriseJoinCodes.codeType, input.codeType),
          eq(enterpriseJoinCodes.status, 'active')
        )
      )
      .limit(1)
      .for('update');
    const active = rows[0] ?? null;
    if (!active) return null;
    const now = new Date();
    const updated = await this.transaction
      .update(enterpriseJoinCodes)
      .set({
        status: 'disabled',
        disabledAt: now,
        disabledBy: input.actorStaffId,
        updatedAt: now,
      })
      .where(eq(enterpriseJoinCodes.id, active.id))
      .returning();
    await this.recordJoinCodeEvent({
      code: active,
      eventType: 'disable',
      result: 'code_disabled',
      actorStaffId: input.actorStaffId,
    });
    return updated[0];
  }

  async resolveEnterpriseJoinToken(
    token: string,
    actorUserId?: bigint | null
  ) {
    const code = await this.findJoinCodeByHash(hashReferrerNetworkToken(token));
    const result = joinCodeState(code);
    if (code) {
      await this.recordJoinCodeEvent({
        code,
        eventType: 'resolve',
        result,
        actorUserId,
      });
    }
    return { code, result };
  }

  async resolvePromotionToken(input: {
    token: string;
    sessionKey?: string | null;
    ipHash?: string | null;
    deviceSummary?: Record<string, unknown>;
  }) {
    const tokenHash = hashReferrerNetworkToken(input.token);
    const rows = await this.transaction
      .select()
      .from(referrerPromotionCodes)
      .where(eq(referrerPromotionCodes.tokenHash, tokenHash))
      .limit(1);
    const code = rows[0] ?? null;
    const membership = code
      ? await this.transaction
          .select()
          .from(referrerEnterpriseMemberships)
          .where(eq(referrerEnterpriseMemberships.id, code.membershipId))
          .limit(1)
          .then((membershipRows) => membershipRows[0] ?? null)
      : null;
    const result = !code
      ? 'code_not_found'
      : code.status === 'active' && membership?.status === 'active'
        ? 'ok'
        : 'code_disabled';
    if (code) {
      await this.transaction.insert(promotionScanAudits).values({
        enterpriseId: code.enterpriseId,
        promotionCodeId: code.id,
        tokenHash,
        sessionKey: input.sessionKey ?? null,
        result,
        ipHash: input.ipHash ?? null,
        deviceSummary: input.deviceSummary ?? {},
      });
    }
    return { code, membership, result };
  }

  async resolveStaffActivityToken(input: {
    token: string;
    sessionKey?: string | null;
    ipHash?: string | null;
    deviceSummary?: Record<string, unknown>;
  }) {
    const tokenHash = hashReferrerNetworkToken(input.token);
    const rows = await this.transaction
      .select({
        code: staffActivityCodes,
        staff: adminUsers,
        enterpriseName: enterprises.name,
      })
      .from(staffActivityCodes)
      .innerJoin(adminUsers, eq(staffActivityCodes.staffId, adminUsers.id))
      .innerJoin(enterprises, eq(staffActivityCodes.enterpriseId, enterprises.id))
      .where(eq(staffActivityCodes.tokenHash, tokenHash))
      .limit(1);
    const row = rows[0] ?? null;
    const result = !row
      ? 'code_not_found'
      : row.code.status === 'active' &&
          row.staff.status === 'active' &&
          ['designer', 'measurer'].includes(row.staff.role)
        ? 'ok'
        : 'code_disabled';
    if (row) {
      await this.transaction.insert(promotionScanAudits).values({
        enterpriseId: row.code.enterpriseId,
        staffActivityCodeId: row.code.id,
        tokenHash,
        sessionKey: input.sessionKey ?? null,
        result,
        ipHash: input.ipHash ?? null,
        deviceSummary: input.deviceSummary ?? {},
      });
    }
    return {
      code: row?.code ?? null,
      staff: row?.staff ?? null,
      enterpriseName: row?.enterpriseName ?? null,
      result,
    };
  }

  async countActiveStaffActivityCodes(enterpriseId: bigint) {
    const rows = await this.transaction
      .select({ value: count() })
      .from(staffActivityCodes)
      .where(
        and(
          eq(staffActivityCodes.enterpriseId, enterpriseId),
          eq(staffActivityCodes.status, 'active')
        )
      );
    return Number(rows[0]?.value ?? 0);
  }

  private async designerProfileComplete(staff: typeof adminUsers.$inferSelect) {
    if (staff.role !== 'designer') return true;
    if (!staff.wechatId?.trim() || !staff.wechatQrAssetId) return false;
    const rows = await this.transaction
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(
        and(
          eq(adminUsers.id, staff.id),
          sql`exists (
            select 1
            from app.media_assets assignment_qr
            where assignment_qr.id = ${staff.wechatQrAssetId}
              and assignment_qr.enterprise_id = ${staff.enterpriseId}
              and assignment_qr.deleted_at is null
          )`
        )
      )
      .limit(1);
    return Boolean(rows[0]);
  }

  private async ensureStaffActivityCode(staff: typeof adminUsers.$inferSelect) {
    const currentRows = await this.transaction
      .select()
      .from(staffActivityCodes)
      .where(
        and(
          eq(staffActivityCodes.staffId, staff.id),
          eq(staffActivityCodes.status, 'active')
        )
      )
      .limit(1);
    if (currentRows[0]) return currentRows[0];
    const previousRows = await this.transaction
      .select({ version: staffActivityCodes.version })
      .from(staffActivityCodes)
      .where(eq(staffActivityCodes.staffId, staff.id))
      .orderBy(desc(staffActivityCodes.version))
      .limit(1);
    const version = (previousRows[0]?.version ?? 0) + 1;
    const token = createStaffActivityToken(staff.id, version);
    const created = await this.transaction
      .insert(staffActivityCodes)
      .values({
        enterpriseId: staff.enterpriseId!,
        staffId: staff.id,
        tokenHash: hashReferrerNetworkToken(token),
        status: 'active',
        version,
      })
      .returning();
    return created[0];
  }

  async getStaffActivityCode(userId: bigint, staffId: bigint) {
    const rows = await this.transaction
      .select({
        staff: adminUsers,
        enterpriseName: enterprises.name,
      })
      .from(adminUsers)
      .innerJoin(enterprises, eq(adminUsers.enterpriseId, enterprises.id))
      .where(
        and(
          eq(adminUsers.id, staffId),
          eq(adminUsers.userId, userId),
          eq(adminUsers.status, 'active')
        )
      )
      .limit(1)
      .for('update');
    const row = rows[0];
    if (!row?.staff.enterpriseId) return { ok: false as const, code: 'staff_not_found' as const };
    if (!['designer', 'measurer'].includes(row.staff.role)) {
      return { ok: false as const, code: 'staff_role_unsupported' as const };
    }
    if (!(await this.designerProfileComplete(row.staff))) {
      return { ok: false as const, code: 'designer_profile_incomplete' as const };
    }
    const code = await this.ensureStaffActivityCode(row.staff);
    return {
      ok: true as const,
      code,
      token: createStaffActivityToken(code.staffId, code.version),
      staff: row.staff,
      enterpriseName: row.enterpriseName,
    };
  }

  async onboardStaff(input: {
    token: string;
    userId: bigint;
    contextVersion: number;
    role: 'designer' | 'measurer';
    displayName: string;
    menuPermissions: string[];
    passwordHash: string;
  }): Promise<
    | { ok: true; staff: typeof adminUsers.$inferSelect; user: typeof users.$inferSelect; idempotent: boolean }
    | { ok: false; code: StaffOnboardingCode }
  > {
    const user = await this.findUserForUpdate(input.userId);
    if (!user || user.contextVersion !== input.contextVersion) {
      return { ok: false, code: 'code_not_found' };
    }
    const joinCode = await this.findJoinCodeByHash(
      hashReferrerNetworkToken(input.token)
    );
    const state = joinCodeState(joinCode);
    if (!joinCode || state !== 'ok') {
      if (joinCode) {
        await this.recordJoinCodeEvent({
          code: joinCode,
          eventType: 'staff_onboarding',
          result: state,
          actorUserId: user.id,
        });
      }
      return { ok: false, code: state };
    }
    if (joinCode.codeType !== 'staff') {
      await this.recordJoinCodeEvent({
        code: joinCode,
        eventType: 'staff_onboarding',
        result: 'code_type_mismatch',
        actorUserId: user.id,
      });
      return { ok: false, code: 'code_type_mismatch' };
    }
    if (!user.phone) {
      await this.recordJoinCodeEvent({
        code: joinCode,
        eventType: 'staff_onboarding',
        result: 'phone_authorization_required',
        actorUserId: user.id,
      });
      return { ok: false, code: 'phone_authorization_required' };
    }

    const existingRows = await this.transaction
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.userId, user.id))
      .limit(1);
    const existing = existingRows[0] ?? null;
    if (existing) {
      const idempotent =
        existing.status === 'active' &&
        existing.enterpriseId === joinCode.enterpriseId &&
        existing.role === input.role;
      await this.recordJoinCodeEvent({
        code: joinCode,
        eventType: 'staff_onboarding',
        result: idempotent ? 'already_joined' : 'staff_enterprise_conflict',
        actorUserId: user.id,
        metadata: { existingStaffId: existing.id.toString() },
      });
      return idempotent
        ? { ok: true, staff: existing, user, idempotent: true }
        : { ok: false, code: 'staff_enterprise_conflict' };
    }

    const createdRows = await this.transaction
      .insert(adminUsers)
      .values({
        userId: user.id,
        enterpriseId: joinCode.enterpriseId,
        username: `wx_${user.id.toString()}_${crypto.randomBytes(6).toString('hex')}`,
        passwordHash: input.passwordHash,
        displayName: input.displayName,
        role: input.role,
        phone: user.phone,
        menuPermissions: input.menuPermissions,
        status: 'active',
      })
      .returning();
    const updatedUsers = await this.transaction
      .update(users)
      .set({
        contextVersion: sql`${users.contextVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();
    await this.recordJoinCodeEvent({
      code: joinCode,
      eventType: 'staff_onboarding',
      result: 'joined',
      actorUserId: user.id,
      metadata: {
        staffId: createdRows[0].id.toString(),
        role: input.role,
      },
    });
    return {
      ok: true,
      staff: createdRows[0],
      user: updatedUsers[0],
      idempotent: false,
    };
  }

  private async ensurePromotionCode(
    membership: typeof referrerEnterpriseMemberships.$inferSelect
  ) {
    const currentRows = await this.transaction
      .select()
      .from(referrerPromotionCodes)
      .where(
        and(
          eq(referrerPromotionCodes.membershipId, membership.id),
          eq(referrerPromotionCodes.status, 'active')
        )
      )
      .limit(1);
    if (currentRows[0]) return currentRows[0];
    const previousRows = await this.transaction
      .select({ version: referrerPromotionCodes.version })
      .from(referrerPromotionCodes)
      .where(eq(referrerPromotionCodes.membershipId, membership.id))
      .orderBy(desc(referrerPromotionCodes.version))
      .limit(1);
    const version = (previousRows[0]?.version ?? 0) + 1;
    const token = createReferrerPromotionToken(membership.id, version);
    const created = await this.transaction
      .insert(referrerPromotionCodes)
      .values({
        enterpriseId: membership.enterpriseId,
        membershipId: membership.id,
        tokenHash: hashReferrerNetworkToken(token),
        status: 'active',
        version,
      })
      .returning();
    return created[0];
  }

  async onboardReferrer(input: {
    token: string;
    userId: bigint;
    contextVersion: number;
    displayName: string;
    membershipLimit: number;
  }): Promise<
    | {
        ok: true;
        membership: typeof referrerEnterpriseMemberships.$inferSelect;
        promotionCode: typeof referrerPromotionCodes.$inferSelect;
        user: typeof users.$inferSelect;
        idempotent: boolean;
      }
    | { ok: false; code: ReferrerOnboardingCode }
  > {
    let user = await this.findUserForUpdate(input.userId);
    if (!user || user.contextVersion !== input.contextVersion) {
      return { ok: false, code: 'code_not_found' };
    }
    const joinCode = await this.findJoinCodeByHash(
      hashReferrerNetworkToken(input.token)
    );
    const state = joinCodeState(joinCode);
    if (!joinCode || state !== 'ok') {
      if (joinCode) {
        await this.recordJoinCodeEvent({
          code: joinCode,
          eventType: 'referrer_onboarding',
          result: state,
          actorUserId: user.id,
        });
      }
      return { ok: false, code: state };
    }
    if (joinCode.codeType !== 'referrer') {
      await this.recordJoinCodeEvent({
        code: joinCode,
        eventType: 'referrer_onboarding',
        result: 'code_type_mismatch',
        actorUserId: user.id,
      });
      return { ok: false, code: 'code_type_mismatch' };
    }
    if (!user.phone) {
      await this.recordJoinCodeEvent({
        code: joinCode,
        eventType: 'referrer_onboarding',
        result: 'phone_authorization_required',
        actorUserId: user.id,
      });
      return { ok: false, code: 'phone_authorization_required' };
    }

    const profileRows = await this.transaction
      .select()
      .from(referrerProfiles)
      .where(eq(referrerProfiles.userId, user.id))
      .limit(1)
      .for('update');
    let profile = profileRows[0] ?? null;
    if (profile?.status === 'disabled') {
      await this.recordJoinCodeEvent({
        code: joinCode,
        eventType: 'referrer_onboarding',
        result: 'referrer_disabled',
        actorUserId: user.id,
      });
      return { ok: false, code: 'referrer_disabled' };
    }
    const displayName = input.displayName.trim();
    if (!profile) {
      const created = await this.transaction
        .insert(referrerProfiles)
        .values({
          userId: user.id,
          displayName,
          phone: user.phone,
          status: 'active',
        })
        .returning();
      profile = created[0];
    } else if (displayName && displayName !== profile.displayName) {
      const updated = await this.transaction
        .update(referrerProfiles)
        .set({
          displayName,
          phone: profile.phone || user.phone,
          updatedAt: new Date(),
        })
        .where(eq(referrerProfiles.id, profile.id))
        .returning();
      profile = updated[0];
    }
    if (displayName && displayName !== (user.nickname || '')) {
      const updatedUsers = await this.transaction
        .update(users)
        .set({ nickname: displayName, updatedAt: new Date() })
        .where(eq(users.id, user.id))
        .returning();
      user = updatedUsers[0] ?? user;
    }

    const existingRows = await this.transaction
      .select()
      .from(referrerEnterpriseMemberships)
      .where(
        and(
          eq(referrerEnterpriseMemberships.referrerId, profile.id),
          eq(referrerEnterpriseMemberships.enterpriseId, joinCode.enterpriseId),
          eq(referrerEnterpriseMemberships.status, 'active')
        )
      )
      .limit(1)
      .for('update');
    if (existingRows[0]) {
      const promotionCode = await this.ensurePromotionCode(existingRows[0]);
      await this.recordJoinCodeEvent({
        code: joinCode,
        eventType: 'referrer_onboarding',
        result: 'already_joined',
        actorUserId: user.id,
        metadata: { membershipId: existingRows[0].id.toString() },
      });
      return {
        ok: true,
        membership: existingRows[0],
        promotionCode,
        user,
        idempotent: true,
      };
    }

    const activeCountRows = await this.transaction
      .select({ value: count() })
      .from(referrerEnterpriseMemberships)
      .where(
        and(
          eq(referrerEnterpriseMemberships.referrerId, profile.id),
          eq(referrerEnterpriseMemberships.status, 'active')
        )
      );
    if (Number(activeCountRows[0]?.value ?? 0) >= input.membershipLimit) {
      await this.recordJoinCodeEvent({
        code: joinCode,
        eventType: 'referrer_onboarding',
        result: 'membership_limit_reached',
        actorUserId: user.id,
        metadata: { membershipLimit: input.membershipLimit },
      });
      return { ok: false, code: 'membership_limit_reached' };
    }

    const memberships = await this.transaction
      .insert(referrerEnterpriseMemberships)
      .values({
        referrerId: profile.id,
        enterpriseId: joinCode.enterpriseId,
        status: 'active',
      })
      .returning();
    const promotionCode = await this.ensurePromotionCode(memberships[0]);
    const updatedUsers = await this.transaction
      .update(users)
      .set({
        contextVersion: sql`${users.contextVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();
    await this.recordJoinCodeEvent({
      code: joinCode,
      eventType: 'referrer_onboarding',
      result: 'joined',
      actorUserId: user.id,
      metadata: { membershipId: memberships[0].id.toString() },
    });
    return {
      ok: true,
      membership: memberships[0],
      promotionCode,
      user: updatedUsers[0],
      idempotent: false,
    };
  }

  async listEnterpriseReferrerMemberships(
    enterpriseId: bigint,
    options: { query?: string; status?: ReferrerMembershipStatus } = {}
  ): Promise<EnterpriseReferrerMembershipRecord[]> {
    const filters = [eq(referrerEnterpriseMemberships.enterpriseId, enterpriseId)];
    if (options.status) {
      filters.push(eq(referrerEnterpriseMemberships.status, options.status));
    }
    const query = options.query?.trim().replace(/[%_]/g, '\\$&');
    if (query) {
      const pattern = `%${query}%`;
      filters.push(
        or(
          ilike(referrerProfiles.displayName, pattern),
          ilike(referrerProfiles.phone, pattern)
        )!
      );
    }
    return this.transaction
      .select({
        membership: referrerEnterpriseMemberships,
        displayName: referrerProfiles.displayName,
        phone: referrerProfiles.phone,
        promotionCode: referrerPromotionCodes,
      })
      .from(referrerEnterpriseMemberships)
      .innerJoin(
        referrerProfiles,
        eq(referrerProfiles.id, referrerEnterpriseMemberships.referrerId)
      )
      .leftJoin(
        referrerPromotionCodes,
        and(
          eq(referrerPromotionCodes.membershipId, referrerEnterpriseMemberships.id),
          eq(referrerPromotionCodes.status, 'active')
        )
      )
      .where(and(...filters))
      .orderBy(
        desc(referrerEnterpriseMemberships.status),
        desc(referrerEnterpriseMemberships.joinedAt),
        asc(referrerEnterpriseMemberships.id)
      );
  }

  async disableEnterpriseReferrerMembership(enterpriseId: bigint, membershipId: bigint) {
    const rows = await this.transaction
      .select({ membership: referrerEnterpriseMemberships, userId: referrerProfiles.userId })
      .from(referrerEnterpriseMemberships)
      .innerJoin(referrerProfiles, eq(referrerProfiles.id, referrerEnterpriseMemberships.referrerId))
      .where(and(
        eq(referrerEnterpriseMemberships.id, membershipId),
        eq(referrerEnterpriseMemberships.enterpriseId, enterpriseId)
      ))
      .limit(1)
      .for('update');
    const current = rows[0];
    if (!current) return null;
    if (current.membership.status !== 'active') {
      return { membership: current.membership, idempotent: true };
    }
    const now = new Date();
    const updated = await this.transaction
      .update(referrerEnterpriseMemberships)
      .set({ status: 'disabled', exitedAt: now, updatedAt: now })
      .where(eq(referrerEnterpriseMemberships.id, membershipId))
      .returning();
    await this.transaction
      .update(referrerPromotionCodes)
      .set({ status: 'disabled', disabledAt: now, updatedAt: now })
      .where(and(
        eq(referrerPromotionCodes.membershipId, membershipId),
        eq(referrerPromotionCodes.status, 'active')
      ));
    await this.transaction
      .update(users)
      .set({
        contextVersion: sql`${users.contextVersion} + 1`,
        updatedAt: now,
      })
      .where(eq(users.id, current.userId));
    return { membership: updated[0], idempotent: false };
  }

  async listReferrerMemberships(userId: bigint): Promise<ReferrerMembershipRecord[]> {
    return this.transaction
      .select({
        membership: referrerEnterpriseMemberships,
        enterpriseName: enterprises.name,
        promotionCode: referrerPromotionCodes,
      })
      .from(referrerProfiles)
      .innerJoin(
        referrerEnterpriseMemberships,
        eq(referrerEnterpriseMemberships.referrerId, referrerProfiles.id)
      )
      .innerJoin(
        enterprises,
        eq(enterprises.id, referrerEnterpriseMemberships.enterpriseId)
      )
      .leftJoin(
        referrerPromotionCodes,
        and(
          eq(referrerPromotionCodes.membershipId, referrerEnterpriseMemberships.id),
          eq(referrerPromotionCodes.status, 'active')
        )
      )
      .where(eq(referrerProfiles.userId, userId))
      .orderBy(
        desc(referrerEnterpriseMemberships.status),
        asc(enterprises.name),
        asc(referrerEnterpriseMemberships.id)
      );
  }

  async getReferrerPromotionCode(userId: bigint, membershipId: bigint) {
    const rows = await this.transaction
      .select({ membership: referrerEnterpriseMemberships })
      .from(referrerProfiles)
      .innerJoin(
        referrerEnterpriseMemberships,
        eq(referrerEnterpriseMemberships.referrerId, referrerProfiles.id)
      )
      .where(
        and(
          eq(referrerProfiles.userId, userId),
          eq(referrerProfiles.status, 'active'),
          eq(referrerEnterpriseMemberships.id, membershipId),
          eq(referrerEnterpriseMemberships.status, 'active')
        )
      )
      .limit(1)
      .for('update');
    if (!rows[0]) return null;
    const code = await this.ensurePromotionCode(rows[0].membership);
    return {
      code,
      token: createReferrerPromotionToken(code.membershipId, code.version),
    };
  }

  async exitReferrerMembership(input: {
    userId: bigint;
    contextVersion: number;
    membershipId: bigint;
  }) {
    const user = await this.findUserForUpdate(input.userId);
    if (!user || user.contextVersion !== input.contextVersion) return null;
    const rows = await this.transaction
      .select({ membership: referrerEnterpriseMemberships })
      .from(referrerProfiles)
      .innerJoin(
        referrerEnterpriseMemberships,
        eq(referrerEnterpriseMemberships.referrerId, referrerProfiles.id)
      )
      .where(
        and(
          eq(referrerProfiles.userId, user.id),
          eq(referrerEnterpriseMemberships.id, input.membershipId)
        )
      )
      .limit(1)
      .for('update');
    const membership = rows[0]?.membership ?? null;
    if (!membership) return null;
    if (membership.status !== 'active') {
      return { membership, user, idempotent: true };
    }
    const now = new Date();
    const updatedMemberships = await this.transaction
      .update(referrerEnterpriseMemberships)
      .set({ status: 'exited', exitedAt: now, updatedAt: now })
      .where(eq(referrerEnterpriseMemberships.id, membership.id))
      .returning();
    await this.transaction
      .update(referrerPromotionCodes)
      .set({ status: 'disabled', disabledAt: now, updatedAt: now })
      .where(
        and(
          eq(referrerPromotionCodes.membershipId, membership.id),
          eq(referrerPromotionCodes.status, 'active')
        )
      );
    const updatedUsers = await this.transaction
      .update(users)
      .set({
        contextVersion: sql`${users.contextVersion} + 1`,
        updatedAt: now,
      })
      .where(eq(users.id, user.id))
      .returning();
    return {
      membership: updatedMemberships[0],
      user: updatedUsers[0],
      idempotent: false,
    };
  }

  async getMembershipLimit() {
    const rows = await this.transaction
      .select({ promotionConfig: platformConfigs.promotionConfig })
      .from(platformConfigs)
      .where(eq(platformConfigs.key, 'default'))
      .limit(1);
    const configured = Number(
      (rows[0]?.promotionConfig as { referrerMembershipLimit?: unknown } | null)
        ?.referrerMembershipLimit ?? 3
    );
    return Number.isInteger(configured) && configured > 0 ? configured : 3;
  }
}
