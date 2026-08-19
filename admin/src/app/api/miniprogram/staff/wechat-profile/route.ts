import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AdminUserRepository } from '@/db/repositories';
import { getSignedMiniAiAssetUrl } from '@/lib/ai/mini-ai-assets';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

function designerSelf(context: NonNullable<Awaited<ReturnType<typeof resolveMiniProgramContext>>>) {
  return Boolean(context.enterpriseId && context.mode === 'staff' && context.staff?.role === 'designer');
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
    data: {
      wechatId: staff.wechatId || '',
      wechatQrAssetId: staff.wechatQrAssetId?.toString() || null,
      wechatQrUrl: staff.wechatQrAssetId
        ? getSignedMiniAiAssetUrl({
            request,
            assetId: staff.wechatQrAssetId.toString(),
            enterpriseId: context.enterpriseId!,
          })
        : null,
    },
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
    const wechatId = String(body.wechatId || '').trim();
    if (!wechatId || wechatId.length > 64) {
      return NextResponse.json({ success: false, error: '请填写 1–64 个字符的微信号' }, { status: 400 });
    }
    const staff = await withMiniProgramPostgresTransaction(context, (transaction) =>
      new AdminUserRepository(transaction).update(
        parsePostgresId(context.staff!._id, 'staff id'),
        { wechatId }
      )
    );
    if (!staff) return NextResponse.json({ success: false, error: '员工账号不存在' }, { status: 404 });
    return NextResponse.json({
      success: true,
      data: {
        wechatId: staff.wechatId || '',
        wechatQrAssetId: staff.wechatQrAssetId?.toString() || null,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '保存微信号失败' },
      { status: 400 }
    );
  }
}
