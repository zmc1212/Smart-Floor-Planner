import { NextResponse } from 'next/server';
import { MiniProgramIdentityRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import {
  buildMiniProgramBadges,
  loadMiniProgramBadgeCounts,
  unavailableMiniProgramBadges,
} from '@/lib/miniprogram-badges';
import {
  buildMiniProgramBootstrap,
  getMiniProgramRole,
} from '@/lib/miniprogram-bootstrap';
import { verifyMiniProgramToken } from '@/lib/miniprogram-jwt';
import { withMiniProgramRequestLog, type MiniProgramRequestLog } from '@/lib/miniprogram-request-log';

export const dynamic = 'force-dynamic';

function bearerToken(request: Request) {
  const value = request.headers.get('Authorization') || '';
  return value.startsWith('Bearer ') ? value.slice(7).trim() : null;
}

export async function GET(request: Request) {
  return withMiniProgramRequestLog(request, '/api/miniprogram/bootstrap', (log) => bootstrap(request, log));
}

async function bootstrap(request: Request, log: MiniProgramRequestLog) {
  log.stage('authenticate');
  const token = bearerToken(request);
  const payload = token ? await verifyMiniProgramToken(token) : null;
  if (!payload) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized', code: 'unauthorized' },
      { status: 401 }
    );
  }

  try {
    log.stage('database');
    const result = await withPlatformTransaction(async (transaction) => {
      const identities = new MiniProgramIdentityRepository(transaction);
      const userId = parsePostgresId(payload.sub, 'user id');
      const user = await identities.findUserById(userId);
      if (!user || user.contextVersion !== payload.contextVersion) return null;
      const current = await identities.selectContext(userId, {
        mode: payload.mode,
        enterpriseId: payload.enterpriseId
          ? parsePostgresId(payload.enterpriseId, 'enterprise id')
          : null,
        staffId: payload.staffId
          ? parsePostgresId(payload.staffId, 'staff id')
          : null,
        referrerMembershipId: payload.referrerMembershipId
          ? parsePostgresId(payload.referrerMembershipId, 'referrer membership id')
          : null,
      });
      if (!current) return null;
      return {
        current,
        contexts: await identities.listContexts(userId),
      };
    });

    if (!result) {
      return NextResponse.json(
        {
          success: false,
          error: 'Identity context changed',
          code: 'identity_context_invalid',
        },
        { status: 401 }
      );
    }
    const role = getMiniProgramRole(result.current);
    if (!role) {
      return NextResponse.json(
        {
          success: false,
          error: 'Identity role is not available in the Mini Program',
          code: 'identity_role_unsupported',
        },
        { status: 403 }
      );
    }

    let badges = unavailableMiniProgramBadges();
    try {
      log.stage('badges');
      const facts = result.current.enterpriseId
        ? await withTenantTransaction(result.current.enterpriseId, (transaction) =>
          loadMiniProgramBadgeCounts({
            transaction,
            userId: parsePostgresId(payload.sub, 'user id'),
            current: result.current,
            role,
          }))
        : await withPlatformTransaction((transaction) =>
          loadMiniProgramBadgeCounts({
            transaction,
            userId: parsePostgresId(payload.sub, 'user id'),
            current: result.current,
            role,
          }));
      badges = buildMiniProgramBadges({ role, facts });
    } catch (error) {
      log.error(error);
      badges = unavailableMiniProgramBadges();
    }

    return NextResponse.json({
      success: true,
      ...buildMiniProgramBootstrap({ ...result, badges }),
    });
  } catch (error) {
    log.error(error);
    return NextResponse.json(
      { success: false, error: 'Unable to load identity bootstrap', code: 'bootstrap_unavailable' },
      { status: 500 }
    );
  }
}
