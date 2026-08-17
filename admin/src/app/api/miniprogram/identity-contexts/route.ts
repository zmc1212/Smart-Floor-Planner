import { NextResponse } from 'next/server';
import { MiniProgramIdentityRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withPlatformTransaction } from '@/db/transaction';
import { miniProgramIdentityContextToDto } from '@/lib/miniprogram-identity-context';
import { verifyMiniProgramToken } from '@/lib/miniprogram-jwt';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
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
        ? parsePostgresId(
            payload.referrerMembershipId,
            'referrer membership id'
          )
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
      { success: false, error: 'Identity context changed' },
      { status: 401 }
    );
  }
  return NextResponse.json({
    success: true,
    current: miniProgramIdentityContextToDto(result.current),
    contexts: result.contexts.map(miniProgramIdentityContextToDto),
  });
}
