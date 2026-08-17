import { NextResponse } from 'next/server';
import { MiniProgramIdentityRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withPlatformTransaction } from '@/db/transaction';
import {
  isMiniProgramIdentityMode,
  miniProgramIdentityContextToDto,
  signMiniProgramIdentityContextToken,
} from '@/lib/miniprogram-identity-context';
import { verifyMiniProgramToken } from '@/lib/miniprogram-jwt';

export const dynamic = 'force-dynamic';

function optionalId(value: unknown, label: string) {
  if (value === undefined || value === null || value === '') return null;
  return parsePostgresId(String(value), label);
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;
  const payload = token ? await verifyMiniProgramToken(token) : null;
  if (!payload) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    if (!isMiniProgramIdentityMode(body.mode)) {
      return NextResponse.json(
        { success: false, error: 'Invalid identity mode' },
        { status: 400 }
      );
    }

    const result = await withPlatformTransaction(async (transaction) => {
      const identities = new MiniProgramIdentityRepository(transaction);
      const userId = parsePostgresId(payload.sub, 'user id');
      const user = await identities.findUserById(userId);
      if (!user || user.contextVersion !== payload.contextVersion) return null;

      const current = await identities.selectContext(userId, {
        mode: payload.mode,
        enterpriseId: optionalId(payload.enterpriseId, 'enterprise id'),
        staffId: optionalId(payload.staffId, 'staff id'),
        referrerMembershipId: optionalId(
          payload.referrerMembershipId,
          'referrer membership id'
        ),
      });
      if (!current) return null;

      const selected = await identities.selectContext(userId, {
        mode: body.mode,
        enterpriseId: optionalId(body.enterpriseId, 'enterprise id'),
        staffId: optionalId(body.staffId, 'staff id'),
        referrerMembershipId: optionalId(
          body.referrerMembershipId,
          'referrer membership id'
        ),
      });
      if (!selected) return { user, selected: null, contexts: [] };
      return {
        user,
        selected,
        contexts: await identities.listContexts(userId),
      };
    });

    if (!result) {
      return NextResponse.json(
        { success: false, error: 'Identity context changed' },
        { status: 401 }
      );
    }
    if (!result.selected) {
      return NextResponse.json(
        { success: false, error: 'Identity context is not active' },
        { status: 403 }
      );
    }

    const switchedToken = await signMiniProgramIdentityContextToken({
      userId: result.user.id,
      contextVersion: result.user.contextVersion,
      context: result.selected,
      source: payload.source,
    });
    return NextResponse.json({
      success: true,
      token: switchedToken,
      context: miniProgramIdentityContextToDto(result.selected),
      contexts: result.contexts.map(miniProgramIdentityContextToDto),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return NextResponse.json(
      { success: false, error: message },
      { status: 400 }
    );
  }
}
