import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { MediaAsset } from '@/models/MediaAsset';
import { readMediaAssetBuffer } from '@/lib/ai/media-assets';
import { resolveMiniAiContext } from '@/lib/ai/mini-ai-auth';
import { verifyMiniAiAssetSignature } from '@/lib/ai/mini-ai-assets';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
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
    const asset = await MediaAsset.findOne({ _id: id, enterpriseId, deletedAt: { $exists: false } });
    if (!asset) return NextResponse.json({ success: false, error: '图片不存在' }, { status: 404 });

    const buffer = await readMediaAssetBuffer(asset);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': asset.mimeType,
        'Content-Length': String(buffer.length),
        'Cache-Control': signedAccess ? 'private, max-age=1800' : 'private, max-age=3600',
      },
    });
  } catch (error) {
    console.error('[Mini AI Asset Image]', error);
    return NextResponse.json({ success: false, error: '读取图片失败' }, { status: 500 });
  }
}
