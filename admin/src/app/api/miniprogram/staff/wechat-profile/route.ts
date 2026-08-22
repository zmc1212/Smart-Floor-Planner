import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AdminUserRepository } from '@/db/repositories';
import { getSignedMiniAiAssetUrl } from '@/lib/ai/mini-ai-assets';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';
import { StaffWechatQrError, validateStaffWechatId } from '@/lib/staff-wechat-qr';

export const dynamic = 'force-dynamic';

function designerSelf(context: NonNullable<Awaited<ReturnType<typeof resolveMiniProgramContext>>>) {
  return Boolean(context.enterpriseId && context.mode === 'staff' && context.staff?.role === 'designer');
}

function profileSnapshot(staff: {
  wechatId?: string | null;
  wechatQrAssetId?: bigint | null;
}, request: Request, enterpriseId: string) {
  const wechatId = String(staff.wechatId || '').trim();
  const wechatQrAssetId = staff.wechatQrAssetId?.toString() || null;
  const assignmentEligible = Boolean(wechatId && wechatQrAssetId);
  const missing: Array<'wechatId' | 'wechatQr'> = [];
  if (!wechatId) missing.push('wechatId');
  if (!wechatQrAssetId) missing.push('wechatQr');
  return {
    wechatId: wechatId || '',
    wechatQrAssetId,
    wechatQrUrl: wechatQrAssetId
      ? getSignedMiniAiAssetUrl({
          request,
          assetId: wechatQrAssetId,
          enterpriseId,
        })
      : null,
    assignmentEligible,
    missing,
  };
}

export async function GET(request: Request) {
  const context = await resolveMiniProgramContext(request);
  if (!context) return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
  if (!designerSelf(context)) {
    return NextResponse.json({ success: false, error: '仅设计师可维护微信号和二维码' }, { status: 403 });
  }
  const staff = await withMiniProgramPostgresTransaction(context, (transaction) =>
    new AdminUserRepository(transaction).findById(parsePostgresId(context.staff!._id, 'staff id'))
  );
  if (!staff) return NextResponse.json({ success: false, error: '员工账号不存在' }, { status: 404 });
  return NextResponse.json({
    success: true,
    data: profileSnapshot(staff, request, context.enterpriseId!),
  });
}

export async function PATCH(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
    if (!designerSelf(context)) {
      return NextResponse.json({ success: false, error: '仅设计师可维护微信号和二维码' }, { status: 403 });
    }
    const body = await request.json();
    const wechatId = validateStaffWechatId(body.wechatId);
    const staff = await withMiniProgramPostgresTransaction(context, (transaction) =>
      new AdminUserRepository(transaction).update(
        parsePostgresId(context.staff!._id, 'staff id'),
        { wechatId }
      )
    );
    if (!staff) return NextResponse.json({ success: false, error: '员工账号不存在' }, { status: 404 });
    const data = profileSnapshot(staff, request, context.enterpriseId!);
    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    if (error instanceof StaffWechatQrError) {
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: error.status }
      );
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '保存微信号失败' },
      { status: 400 }
    );
  }
}
