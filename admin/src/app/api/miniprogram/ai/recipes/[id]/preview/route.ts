import { NextResponse } from 'next/server';
import { getActivePromptTemplateAsset } from '@/lib/ai/prompt-library-query';
import { verifyMiniAiRecipePreviewSignature } from '@/lib/ai/mini-ai-assets';
import { readLibraryCoverBuffer } from '@/lib/ai/prompt-template-cover';
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
    const sourceBuffer = await readLibraryCoverBuffer(asset);
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
