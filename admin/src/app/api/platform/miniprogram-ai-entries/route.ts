import { NextResponse } from 'next/server';
import { readMiniProgramAiEntries, saveMiniProgramAiEntries } from '@/lib/miniprogram-ai-entries';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

const access: Parameters<typeof withTenantRoute>[1] = { roles: ['super_admin', 'admin'] };
const headers = { 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
  try {
    return await withTenantRoute(request, access, async () => {
      const data = await readMiniProgramAiEntries();
      return NextResponse.json({ success: true, data }, { headers });
    });
  } catch {
    return NextResponse.json({ success: false, error: '读取小程序 AI 入口设置失败' }, { status: 503, headers });
  }
}

export async function PATCH(request: Request) {
  try {
    return await withTenantRoute(request, access, async () => {
      const body = await request.json().catch(() => null);
      if (typeof body?.enabled !== 'boolean' || Object.keys(body).length !== 1) {
        return NextResponse.json({ success: false, error: 'enabled 必须是布尔值' }, { status: 400, headers });
      }
      const data = await saveMiniProgramAiEntries(body.enabled);
      return NextResponse.json({ success: true, data }, { headers });
    });
  } catch {
    return NextResponse.json({ success: false, error: '保存小程序 AI 入口设置失败' }, { status: 503, headers });
  }
}
