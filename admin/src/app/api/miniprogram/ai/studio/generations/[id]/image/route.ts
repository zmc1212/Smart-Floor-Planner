import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiCreationRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { verifyMiniAiStudioGenerationSignature } from '@/lib/ai/mini-ai-assets';
import { readPostgresMediaAssetBuffer } from '@/lib/ai/postgres-media-assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const enterpriseId = url.searchParams.get('tenant') || '';
    const expires = Number(url.searchParams.get('expires') || 0);
    const signature = url.searchParams.get('signature') || '';
    const validRequest = /^[1-9]\d*$/.test(id)
      && /^[1-9]\d*$/.test(enterpriseId)
      && Boolean(signature)
      && verifyMiniAiStudioGenerationSignature({ generationId: id, enterpriseId, expires, signature });
    if (!validRequest) {
      return NextResponse.json({ success: false, error: '图片链接无效或已过期' }, { status: 401 });
    }
    const generation = await withTenantTransaction(
      parsePostgresId(enterpriseId, 'enterpriseId'),
      (transaction) => new AiCreationRepository(transaction).findGeneration(parsePostgresId(id, 'generationId')),
    );
    const assetIdText = String(asRecord(generation?.output).imageUrl || '').match(/^\/api\/ai\/assets\/([1-9]\d*)\/image/i)?.[1];
    if (!generation || !assetIdText) {
      return NextResponse.json({ success: false, error: '图片不存在' }, { status: 404 });
    }
    const asset = await withTenantTransaction(
      parsePostgresId(enterpriseId, 'enterpriseId'),
      (transaction) => new AiCreationRepository(transaction).findMediaAsset(parsePostgresId(assetIdText, 'assetId')),
    );
    if (!asset) return NextResponse.json({ success: false, error: '图片不存在' }, { status: 404 });
    const buffer = await readPostgresMediaAssetBuffer(asset);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': asset.mimeType,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, max-age=1800',
      },
    });
  } catch (error) {
    console.error('[Mini AI Studio Generation Image GET]', error);
    return NextResponse.json({ success: false, error: '读取图片失败' }, { status: 500 });
  }
}
