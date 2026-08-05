import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiCreationRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';
import { resolvePostgresMediaAssetDelivery } from '@/lib/ai/postgres-media-assets';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      const { id } = await params;
      if (!/^[1-9]\d*$/.test(id)) {
        return NextResponse.json({ success: false, error: 'Asset not found' }, { status: 404 });
      }
      const asset = await withTenantTransaction(
        parsePostgresId(context.enterpriseId!, 'enterpriseId'),
        (transaction) => new AiCreationRepository(transaction).findMediaAsset(parsePostgresId(id, 'assetId'))
      );
      if (!asset) {
        return NextResponse.json({ success: false, error: 'Asset not found' }, { status: 404 });
      }
      const delivery = await resolvePostgresMediaAssetDelivery(asset);
      if (delivery.kind === 'redirect') {
        return NextResponse.redirect(delivery.url, {
          status: 302,
          headers: { 'Cache-Control': 'private, no-store' },
        });
      }
      return new NextResponse(new Uint8Array(delivery.buffer), {
        headers: {
          'Content-Type': asset.mimeType,
          'Content-Length': String(delivery.buffer.length),
          'Cache-Control': 'private, max-age=3600',
        },
      });
    });
  } catch (error) {
    console.error('[AI Asset Image GET]', error);
    return NextResponse.json({ success: false, error: 'Failed to load image asset' }, { status: 500 });
  }
}
