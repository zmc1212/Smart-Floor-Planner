import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { MediaAsset } from '@/models/MediaAsset';
import { readMediaAssetBuffer } from '@/lib/ai/media-assets';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();

    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      const { id } = await params;
      const asset = await MediaAsset.findOne({
        _id: id,
        enterpriseId: context.enterpriseId,
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
    });
  } catch (error) {
    console.error('[AI Asset Image GET]', error);
    return NextResponse.json({ success: false, error: 'Failed to load image asset' }, { status: 500 });
  }
}
