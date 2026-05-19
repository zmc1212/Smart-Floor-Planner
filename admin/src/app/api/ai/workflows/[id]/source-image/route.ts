import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { AiWorkflow } from '@/models/AiWorkflow';
import { getAssetIdFromImageUrl, parseImageDataUri, readMediaAssetBuffer } from '@/lib/ai/media-assets';
import { MediaAsset } from '@/models/MediaAsset';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();

    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      const { id } = await params;
      const workflow = await AiWorkflow.findOne({
        _id: id,
        enterpriseId: context.enterpriseId,
      })
        .select('sourceImage')
        .lean();

      if (!workflow?.sourceImage) {
        return NextResponse.json({ success: false, error: 'Workflow source image not found' }, { status: 404 });
      }

      const imageUrl = workflow.sourceImage;
      const assetId = getAssetIdFromImageUrl(imageUrl);
      if (assetId) {
        const asset = await MediaAsset.findOne({ _id: assetId, enterpriseId: context.enterpriseId });
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

      return NextResponse.json({ success: false, error: 'Unsupported workflow source image' }, { status: 400 });
    });
  } catch (error) {
    console.error('[AI Workflow Source Image GET]', error);
    return NextResponse.json({ success: false, error: 'Failed to load workflow source image' }, { status: 500 });
  }
}
