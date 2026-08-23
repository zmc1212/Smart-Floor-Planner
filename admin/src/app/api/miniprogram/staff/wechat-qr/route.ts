import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AdminUserRepository } from '@/db/repositories';
import { storePostgresMediaBuffer } from '@/lib/ai/postgres-media-assets';
import { getSignedMiniAiAssetUrl } from '@/lib/ai/mini-ai-assets';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';
import { prepareStaffWechatQrUpload, StaffWechatQrError } from '@/lib/staff-wechat-qr';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context?.enterpriseId || context.mode !== 'staff' || context.staff?.role !== 'designer') {
      return NextResponse.json({ success: false, error: '仅设计师可上传个人微信二维码' }, { status: 403 });
    }
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: '请上传二维码图片' }, { status: 400 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ success: false, error: '二维码图片不能超过 5MB' }, { status: 400 });
    }
    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
    const prepared = await prepareStaffWechatQrUpload({
      buffer: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type,
    });
    const stored = await storePostgresMediaBuffer({
      enterpriseId,
      ownerType: 'staff_wechat_qr',
      mimeType: prepared.mimeType,
      buffer: prepared.buffer,
      width: prepared.width,
      height: prepared.height,
    });
    const staff = await withMiniProgramPostgresTransaction(context, (transaction) =>
      new AdminUserRepository(transaction).update(
        parsePostgresId(context.staff!._id, 'staff id'),
        { wechatQrAssetId: stored.asset.id }
      )
    );
    if (!staff) return NextResponse.json({ success: false, error: '员工账号不存在' }, { status: 404 });
    const wechatId = String(staff.wechatId || '').trim();
    const assignmentEligible = Boolean(wechatId && staff.wechatQrAssetId);
    return NextResponse.json({
      success: true,
      data: {
        assetId: stored.asset.id.toString(),
        wechatQrUrl: getSignedMiniAiAssetUrl({
          request,
          assetId: stored.asset.id.toString(),
          enterpriseId: context.enterpriseId,
        }),
        assignmentEligible,
        missing: assignmentEligible
          ? []
          : [
              ...(!wechatId ? ['wechatId'] as const : []),
            ],
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof StaffWechatQrError) {
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: error.status }
      );
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '二维码上传失败' },
      { status: 500 }
    );
  }
}
