import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiCreationRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { storePostgresMediaBuffer, getPostgresMediaAssetImageUrl } from '@/lib/ai/postgres-media-assets';
import { withTenantRoute } from '@/lib/tenant-route';

export async function POST(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['enterprise_admin', 'admin', 'super_admin'], requireEnterprise: true }, async (context) => {
      const formData = await request.formData();
      const file = formData.get('file');
      if (!(file instanceof File) || !file.type.startsWith('image/')) {
        return NextResponse.json({ success: false, error: '请上传二维码图片' }, { status: 400 });
      }
      if (file.size > 5 * 1024 * 1024) {
        return NextResponse.json({ success: false, error: '二维码图片不能超过 5MB' }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const stored = await storePostgresMediaBuffer({
        enterpriseId: parsePostgresId(context.enterpriseId!, 'enterpriseId'),
        ownerType: 'staff_wechat_qr',
        mimeType: file.type,
        buffer,
      });
      return NextResponse.json({ success: true, data: { assetId: stored.asset.id.toString(), imageUrl: getPostgresMediaAssetImageUrl(stored.asset.id) } }, { status: 201 });
    });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '二维码上传失败' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    return await withTenantRoute(request, { requireEnterprise: true }, async (context) => {
      const id = new URL(request.url).searchParams.get('assetId');
      if (!id) return NextResponse.json({ success: false, error: '缺少 assetId' }, { status: 400 });
      const asset = await withTenantTransaction(parsePostgresId(context.enterpriseId!, 'enterpriseId'), (transaction) => new AiCreationRepository(transaction).findMediaAsset(parsePostgresId(id, 'assetId')));
      if (!asset || asset.ownerType !== 'staff_wechat_qr') return NextResponse.json({ success: false, error: '二维码不存在' }, { status: 404 });
      return NextResponse.json({ success: true, data: { assetId: asset.id.toString(), imageUrl: getPostgresMediaAssetImageUrl(asset.id) } });
    });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '读取二维码失败' }, { status: 500 });
  }
}
