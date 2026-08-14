import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiCreationRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import {
  readPostgresMediaAssetBuffer,
  resolvePostgresMediaAssetDelivery,
} from '@/lib/ai/postgres-media-assets';
import { resolveMiniAiContext } from '@/lib/ai/mini-ai-auth';
import { verifyMiniAiAssetSignature } from '@/lib/ai/mini-ai-assets';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const tenant = url.searchParams.get('tenant') || '';
    const expires = Number(url.searchParams.get('expires') || 0);
    const signature = url.searchParams.get('signature') || '';
    const signedAccess = Boolean(
      tenant && signature && verifyMiniAiAssetSignature({ assetId: id, enterpriseId: tenant, expires, signature })
    );
    const context = signedAccess ? null : await resolveMiniAiContext(request);
    if (!signedAccess && !context) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const enterpriseId = signedAccess ? tenant : String(context!.enterpriseId);
    if (!/^[1-9]\d*$/.test(id) || !/^[1-9]\d*$/.test(enterpriseId)) {
      return NextResponse.json({ success: false, error: '图片不存在' }, { status: 404 });
    }
    const asset = await withTenantTransaction(
      parsePostgresId(enterpriseId, 'enterpriseId'),
      (transaction) => new AiCreationRepository(transaction).findMediaAsset(parsePostgresId(id, 'assetId'))
    );
    if (!asset) return NextResponse.json({ success: false, error: '图片不存在' }, { status: 404 });
    // Signed Mini Program URLs must remain on the configured API origin. A
    // Qiniu signed-download redirect would make the client enter a separate
    // download-domain path that is not part of the Mini Program API contract.
    if (signedAccess) {
      const buffer = await readPostgresMediaAssetBuffer(asset);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': asset.mimeType,
          'Content-Length': String(buffer.length),
          'Cache-Control': 'private, no-store',
        },
      });
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
        'Cache-Control': signedAccess ? 'private, max-age=1800' : 'private, max-age=3600',
      },
    });
  } catch (error) {
    console.error('[Mini AI Asset Image]', error);
    return NextResponse.json({ success: false, error: '读取图片失败' }, { status: 500 });
  }
}
