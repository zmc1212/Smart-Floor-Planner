import { NextResponse } from 'next/server';
import { getTenantContext, withTenantContext } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const context = await getTenantContext(req);
  return NextResponse.json({
    context,
    cookies: req.headers.get('cookie')
  });
}
