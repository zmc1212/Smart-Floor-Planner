import { NextResponse } from 'next/server';
import { getActivePromptTemplateAsset } from '@/lib/ai/prompt-library-query';
import { verifyMiniAiRecipePreviewSignature } from '@/lib/ai/mini-ai-assets';
import { resolveMediaObjectDelivery } from '@/lib/media-storage/operations';
import { getMediaStorageProvider } from '@/lib/media-storage/registry';
import sharp from 'sharp';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const tenant = url.searchParams.get('tenant') || '';
    const expires = Number(url.searchParams.get('expires') || 0);
    const signature = url.searchParams.get('signature') || '';
    if (!tenant || !signature || !verifyMiniAiRecipePreviewSignature({ recipeId: id, enterpriseId: tenant, expires, signature })) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const asset = await getActivePromptTemplateAsset(id);
    if (!asset) return NextResponse.json({ success: false, error: '配方预览图不存在' }, { status: 404 });
    let sourceBuffer: Buffer | null = null;
    let remoteSourceUrl = '';
    try {
      const provider = await getMediaStorageProvider(asset.storageProvider);
      const delivery = await resolveMediaObjectDelivery({
        provider,
        location: { objectKey: asset.storageKey, bucket: asset.storageBucket ?? undefined },
        expiresInSeconds: 1800,
      });
      sourceBuffer = delivery.kind === 'buffer' ? delivery.buffer : null;
      remoteSourceUrl = delivery.kind === 'redirect' ? delivery.url : '';
    } catch (error) {
      if (!asset.sourceUrl) throw error;
      console.warn('[Mini AI Recipe Preview] Stored preview unavailable; using imported source URL', {
        recipeId: id,
        storageProvider: asset.storageProvider,
      });
      remoteSourceUrl = asset.sourceUrl;
    }
    if (!sourceBuffer && remoteSourceUrl) {
      const upstream = await fetch(remoteSourceUrl, { cache: 'no-store' });
      if (!upstream.ok) throw new Error(`配方预览源读取失败：${upstream.status}`);
      sourceBuffer = Buffer.from(await upstream.arrayBuffer());
    }
    if (!sourceBuffer) throw new Error('配方预览源为空');
    const responseBuffer = await sharp(sourceBuffer)
      .rotate()
      .resize({ width: 960, height: 1280, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#f6f7f4' })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer();
    return new NextResponse(new Uint8Array(responseBuffer), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(responseBuffer.length),
        'ETag': `"recipe-${asset.checksumSha256}"`,
        'Cache-Control': 'private, max-age=1800',
      },
    });
  } catch (error) {
    console.error('[Mini AI Recipe Preview]', error);
    return NextResponse.json({ success: false, error: '读取配方预览图失败' }, { status: 500 });
  }
}
