import { NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { getEffectivePermissions } from '@/lib/staff-access';
import type { TenantContext } from '@/lib/auth';
import { ReportError } from './contract';

export const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
export function reportFailure(error: unknown) {
  const status = error instanceof ReportError ? error.status : 500;
  if (status === 500) console.error('[Design reports]', error);
  return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '汇报操作失败' }, { status, headers: privateHeaders });
}
export async function reportRoute(request: Request, handler: (context: TenantContext) => Promise<Response>) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin', 'enterprise_admin', 'designer'], requireEnterprise: true }, async (context) => {
      if (context.mustChangePassword) throw new ReportError('请先修改初始密码', 403);
      const permissions = await getEffectivePermissions(context.role);
      if (!['admin', 'super_admin'].includes(context.role) && !permissions.includes('ai-scenarios')) throw new ReportError('没有 AI 工作台权限', 403);
      return handler(context);
    });
  } catch (error) { return reportFailure(error); }
}
export function reportId(value: string) {
  if (!/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > BigInt('9223372036854775807')) throw new ReportError('汇报或客户编号无效');
  return BigInt(value);
}
export async function reportBody(request: Request) {
  const text = await request.text();
  if (text.length > 150000) throw new ReportError('汇报内容过大', 413);
  try { const body = JSON.parse(text); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); return body; }
  catch { throw new ReportError('请求内容格式无效'); }
}
