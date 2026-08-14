import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { enterpriseToDto, parsePostgresId } from '@/db/postgres-dto';
import { EnterpriseRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { getPostgresMediaAssetImageUrl, storePostgresMediaBuffer } from '@/lib/ai/postgres-media-assets';
import { withTenantRoute } from '@/lib/tenant-route';

export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin', 'enterprise_admin'] }, async (context) => {
      const { id } = await params;
      if (context.role === 'enterprise_admin' && context.enterpriseId !== id) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }
      const enterpriseId = parsePostgresId(id, 'enterpriseId');
      const formData = await request.formData();
      const file = formData.get('file');
      if (!(file instanceof File)) return NextResponse.json({ success: false, error: '请选择要上传的 Logo 图片' }, { status: 400 });
      const buffer = Buffer.from(await file.arrayBuffer());
      if (buffer.length > 1024 * 1024) return NextResponse.json({ success: false, error: 'Logo 图片不能超过 1MB' }, { status: 400 });
      const metadata = await sharp(buffer).metadata();
      const mimeType = metadata.format === 'jpeg' ? 'image/jpeg' : metadata.format === 'png' ? 'image/png' : metadata.format === 'webp' ? 'image/webp' : null;
      if (!mimeType || !metadata.width || !metadata.height) return NextResponse.json({ success: false, error: 'Logo 仅支持 JPG、PNG 或 WebP 图片' }, { status: 400 });
      const enterprise = await withPlatformTransaction((transaction) => new EnterpriseRepository(transaction).findById(enterpriseId));
      if (!enterprise) return NextResponse.json({ success: false, error: 'Enterprise not found' }, { status: 404 });
      const stored = await storePostgresMediaBuffer({ enterpriseId, ownerType: 'enterprise_logo', mimeType, buffer, width: metadata.width, height: metadata.height });
      const updated = await withPlatformTransaction((transaction) => new EnterpriseRepository(transaction).update(enterpriseId, { logo: getPostgresMediaAssetImageUrl(stored.asset.id) }));
      return NextResponse.json({ success: true, data: enterpriseToDto(updated!) });
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Logo 上传失败' }, { status: 400 });
  }
}
