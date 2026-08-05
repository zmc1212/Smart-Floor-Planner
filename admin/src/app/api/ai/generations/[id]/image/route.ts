import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiCreationRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';
import { getAssetIdFromImageUrl, parseImageDataUri, readMediaAssetBuffer } from '@/lib/ai/media-assets';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      const { id } = await params;
      if (/^[1-9]\d*$/.test(id)) {
        const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterpriseId');
        const generation = await withTenantTransaction(enterpriseId, (transaction) =>
          new AiCreationRepository(transaction).findGeneration(parsePostgresId(id, 'generationId'))
        );
        const assetId = generation?.output && typeof generation.output === 'object'
          ? String((generation.output as Record<string, unknown>).imageUrl || '').match(/^\/api\/ai\/assets\/([1-9]\d*)\/image/i)?.[1]
          : undefined;
        if (!assetId) {
          return NextResponse.json({ success: false, error: 'Generation image not found' }, { status: 404 });
        }
        return NextResponse.redirect(new URL(`/api/ai/assets/${assetId}/image`, req.url));
      }
      const [{ default: dbConnect }, { AiGeneration }, { MediaAsset }] = await Promise.all([
        import('@/lib/mongodb'),
        import('@/models/AiGeneration'),
        import('@/models/MediaAsset'),
      ]);
      await dbConnect();
      const generation = await AiGeneration.findOne({
        _id: id,
        enterpriseId: context.enterpriseId,
        deletedAt: { $exists: false },
      })
        .select('output.imageUrl')
        .lean();

      if (!generation?.output?.imageUrl) {
        return NextResponse.json({ success: false, error: 'Generation image not found' }, { status: 404 });
      }

      const imageUrl = generation.output.imageUrl;
      const assetId = getAssetIdFromImageUrl(imageUrl);
      if (assetId) {
        const asset = await MediaAsset.findOne({
          _id: assetId,
          enterpriseId: context.enterpriseId,
          deletedAt: { $exists: false },
        });
        if (!asset) {
          return NextResponse.json({ success: false, error: 'Asset not found' }, { status: 404 });
        }

        const buffer = await readMediaAssetBuffer(asset);
        return new NextResponse(new Uint8Array(buffer), {
          headers: {
            'Content-Type': asset.mimeType,
            'Content-Length': String(buffer.length),
            'Cache-Control': 'private, max-age=3600',
          },
        });
      }

      if (imageUrl.startsWith('data:image')) {
        const parsed = parseImageDataUri(imageUrl);
        return new NextResponse(new Uint8Array(parsed.buffer), {
          headers: {
            'Content-Type': parsed.mimeType,
            'Content-Length': String(parsed.buffer.length),
            'Cache-Control': 'private, max-age=3600',
          },
        });
      }

      if (/^https?:\/\//i.test(imageUrl) || imageUrl.startsWith('/')) {
        return NextResponse.redirect(new URL(imageUrl, req.url));
      }

      return NextResponse.json({ success: false, error: 'Unsupported generation image' }, { status: 400 });
    });
  } catch (error) {
    console.error('[AI Generation Image GET]', error);
    return NextResponse.json({ success: false, error: 'Failed to load generation image' }, { status: 500 });
  }
}
