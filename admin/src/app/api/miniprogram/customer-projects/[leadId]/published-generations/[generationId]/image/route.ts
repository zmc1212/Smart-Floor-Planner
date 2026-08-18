import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiCreationRepository, CustomerProjectRepository } from '@/db/repositories';
import { detectAiImageMimeType } from '@/lib/ai/image-validation';
import { getPostgresAssetIdFromImageUrl, readPostgresMediaAssetBuffer } from '@/lib/ai/postgres-media-assets';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';
import { withTenantTransaction } from '@/db/transaction';

export const runtime = 'nodejs';

const MAX_RESULT_IMAGE_BYTES = 20 * 1024 * 1024;

function outputImageUrl(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const imageUrl = (value as Record<string, unknown>).imageUrl;
  return typeof imageUrl === 'string' ? imageUrl.trim() : '';
}

export async function GET(request: Request, { params }: { params: Promise<{ leadId: string; generationId: string }> }) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
    if (context.mode !== 'customer') return NextResponse.json({ success: false, error: '仅客户本人可查看已发布方案' }, { status: 403 });
    const { leadId: leadIdText, generationId: generationIdText } = await params;
    const publication = await withMiniProgramPostgresTransaction(context, (transaction) =>
      new CustomerProjectRepository(transaction).findCustomerPublishedGeneration(
        parsePostgresId(context.user._id, 'customer user id'),
        parsePostgresId(leadIdText, 'lead id'),
        parsePostgresId(generationIdText, 'generation id')
      )
    );
    if (!publication) return NextResponse.json({ success: false, error: '已发布方案不存在或无权访问' }, { status: 404 });

    const imageUrl = outputImageUrl(publication.generation.output);
    if (!imageUrl) return NextResponse.json({ success: false, error: '已发布方案图片不存在' }, { status: 404 });
    const assetId = getPostgresAssetIdFromImageUrl(imageUrl);
    if (assetId) {
      const asset = await withTenantTransaction(publication.generation.enterpriseId, (transaction) =>
        new AiCreationRepository(transaction).findMediaAsset(assetId)
      );
      if (!asset) return NextResponse.json({ success: false, error: '已发布方案图片不存在' }, { status: 404 });
      const buffer = await readPostgresMediaAssetBuffer(asset);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': asset.mimeType,
          'Content-Length': String(buffer.length),
          'Cache-Control': 'private, no-store',
        },
      });
    }
    if (!/^https?:\/\//i.test(imageUrl)) return NextResponse.json({ success: false, error: '已发布方案图片无效' }, { status: 404 });

    const upstream = await fetch(imageUrl, {
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    if (!upstream.ok) return NextResponse.json({ success: false, error: '上游图片暂时不可用' }, { status: 502 });
    const declaredSize = Number(upstream.headers.get('content-length') || 0);
    if (declaredSize > MAX_RESULT_IMAGE_BYTES) return NextResponse.json({ success: false, error: '图片大小超出限制' }, { status: 413 });
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_RESULT_IMAGE_BYTES) return NextResponse.json({ success: false, error: '图片大小超出限制' }, { status: 413 });
    const mimeType = detectAiImageMimeType(buffer);
    if (!mimeType) return NextResponse.json({ success: false, error: '图片格式不受支持' }, { status: 415 });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('[Customer Project Published Design Image]', error);
    return NextResponse.json({ success: false, error: '读取已发布方案图片失败' }, { status: 500 });
  }
}
