import crypto from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import {
  platformEnterpriseRegistrationCodeEvents,
  platformEnterpriseRegistrationCodes,
} from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';

export type EnterpriseRegistrationCodeResolution =
  | 'ok'
  | 'code_not_found'
  | 'code_rotated'
  | 'code_disabled'
  | 'code_expired';

const TOKEN_BYTES = 24;
const LOCK_KEY = 'platform-enterprise-registration-code';

function tokenSecret() {
  const configured =
    process.env.REFERRER_TOKEN_SECRET || process.env.JWT_SECRET;
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

export function hashEnterpriseRegistrationToken(token: string) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createEnterpriseRegistrationToken(version: number) {
  const digest = crypto
    .createHmac('sha256', tokenSecret())
    .update(`enterprise-registration:${version}`)
    .digest()
    .subarray(0, TOKEN_BYTES)
    .toString('base64url');
  return `er_${digest}`;
}

function registrationCodeState(
  code: typeof platformEnterpriseRegistrationCodes.$inferSelect | null
): EnterpriseRegistrationCodeResolution {
  if (!code) return 'code_not_found';
  if (code.status === 'rotated') return 'code_rotated';
  if (code.status === 'disabled') return 'code_disabled';
  if (code.status === 'expired') return 'code_expired';
  if (code.expiresAt && code.expiresAt.getTime() <= Date.now()) {
    return 'code_expired';
  }
  return 'ok';
}

export class EnterpriseRegistrationCodeRepository {
  constructor(private readonly transaction: PostgresTransaction) {}

  private async lockKey(key: string) {
    await this.transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`
    );
  }

  private async findByHash(tokenHash: string) {
    const rows = await this.transaction
      .select()
      .from(platformEnterpriseRegistrationCodes)
      .where(eq(platformEnterpriseRegistrationCodes.tokenHash, tokenHash))
      .limit(1);
    return rows[0] ?? null;
  }

  private async recordEvent(input: {
    code: typeof platformEnterpriseRegistrationCodes.$inferSelect;
    eventType: string;
    result: string;
    actorUserId?: bigint | null;
    actorStaffId?: bigint | null;
    metadata?: Record<string, unknown>;
  }) {
    await this.transaction.insert(platformEnterpriseRegistrationCodeEvents).values({
      registrationCodeId: input.code.id,
      eventType: input.eventType,
      result: input.result,
      actorUserId: input.actorUserId ?? null,
      actorStaffId: input.actorStaffId ?? null,
      metadata: input.metadata ?? {},
    });
  }

  async listEvents(limit = 50) {
    return this.transaction
      .select()
      .from(platformEnterpriseRegistrationCodeEvents)
      .orderBy(
        desc(platformEnterpriseRegistrationCodeEvents.createdAt),
        desc(platformEnterpriseRegistrationCodeEvents.id)
      )
      .limit(Math.max(1, Math.min(limit, 100)));
  }

  async getActiveCode() {
    const rows = await this.transaction
      .select()
      .from(platformEnterpriseRegistrationCodes)
      .where(eq(platformEnterpriseRegistrationCodes.status, 'active'))
      .orderBy(
        desc(platformEnterpriseRegistrationCodes.version),
        desc(platformEnterpriseRegistrationCodes.id)
      )
      .limit(1);
    const code = rows[0] ?? null;
    if (!code) return null;
    if (code.expiresAt && code.expiresAt.getTime() <= Date.now()) {
      return null;
    }
    return code;
  }

  async revealActive(input: { actorStaffId: bigint }) {
    const code = await this.getActiveCode();
    if (!code) return null;
    await this.recordEvent({
      code,
      eventType: 'reveal',
      result: 'token_revealed',
      actorStaffId: input.actorStaffId,
    });
    return {
      code,
      token: createEnterpriseRegistrationToken(code.version),
    };
  }

  async rotate(input: {
    actorStaffId: bigint;
    expiresAt?: Date | null;
  }) {
    await this.lockKey(LOCK_KEY);
    const existing = await this.transaction
      .select()
      .from(platformEnterpriseRegistrationCodes)
      .orderBy(
        desc(platformEnterpriseRegistrationCodes.version),
        desc(platformEnterpriseRegistrationCodes.id)
      )
      .for('update');
    const active = existing.find((row) => row.status === 'active') ?? null;
    const now = new Date();
    if (active) {
      await this.transaction
        .update(platformEnterpriseRegistrationCodes)
        .set({
          status: 'rotated',
          disabledAt: now,
          disabledBy: input.actorStaffId,
          updatedAt: now,
        })
        .where(eq(platformEnterpriseRegistrationCodes.id, active.id));
      await this.recordEvent({
        code: active,
        eventType: 'rotate_out',
        result: 'code_rotated',
        actorStaffId: input.actorStaffId,
      });
    }

    const version = (existing[0]?.version ?? 0) + 1;
    const token = createEnterpriseRegistrationToken(version);
    const rows = await this.transaction
      .insert(platformEnterpriseRegistrationCodes)
      .values({
        tokenHash: hashEnterpriseRegistrationToken(token),
        status: 'active',
        version,
        expiresAt: input.expiresAt ?? null,
        createdBy: input.actorStaffId,
      })
      .returning();
    await this.recordEvent({
      code: rows[0],
      eventType: 'rotate_in',
      result: 'active',
      actorStaffId: input.actorStaffId,
      metadata: {
        replacedRegistrationCodeId: active?.id.toString() ?? null,
      },
    });
    return { code: rows[0], token };
  }

  async disable(input: { actorStaffId: bigint }) {
    await this.lockKey(LOCK_KEY);
    const rows = await this.transaction
      .select()
      .from(platformEnterpriseRegistrationCodes)
      .where(eq(platformEnterpriseRegistrationCodes.status, 'active'))
      .limit(1)
      .for('update');
    const active = rows[0] ?? null;
    if (!active) return null;
    const now = new Date();
    const updated = await this.transaction
      .update(platformEnterpriseRegistrationCodes)
      .set({
        status: 'disabled',
        disabledAt: now,
        disabledBy: input.actorStaffId,
        updatedAt: now,
      })
      .where(eq(platformEnterpriseRegistrationCodes.id, active.id))
      .returning();
    await this.recordEvent({
      code: active,
      eventType: 'disable',
      result: 'code_disabled',
      actorStaffId: input.actorStaffId,
    });
    return updated[0];
  }

  async resolve(token: string, actorUserId?: bigint | null) {
    const inspected = await this.inspect(token);
    if (inspected.code) {
      await this.recordEvent({
        code: inspected.code,
        eventType: 'resolve',
        result: inspected.result,
        actorUserId,
      });
    }
    return inspected;
  }

  async inspect(token: string) {
    const code = await this.findByHash(hashEnterpriseRegistrationToken(token));
    return { code, result: registrationCodeState(code) };
  }

  async recordSubmissionEvent(input: {
    code: typeof platformEnterpriseRegistrationCodes.$inferSelect;
    result: string;
    actorUserId?: bigint | null;
    metadata?: Record<string, unknown>;
  }) {
    await this.recordEvent({
      code: input.code,
      eventType: 'submit',
      result: input.result,
      actorUserId: input.actorUserId,
      metadata: input.metadata,
    });
  }

  async recordSubmission(input: {
    code: typeof platformEnterpriseRegistrationCodes.$inferSelect;
    result: string;
    actorUserId?: bigint | null;
    metadata?: Record<string, unknown>;
  }) {
    return this.recordSubmissionEvent(input);
  }
}
