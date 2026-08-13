import { NextResponse } from 'next/server';
import { detectAiImageMimeType } from '@/lib/ai/image-validation';
import { verifyMiniAiTaskResultSignature } from '@/lib/ai/mini-ai-assets';
import { getPostgresMiniAiTaskForTenant } from '@/lib/ai/postgres-mini-ai-tasks';

export const runtime = 'nodejs';

const MAX_RESULT_IMAGE_BYTES = 20 * 1024 * 1024;

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
      && verifyMiniAiTaskResultSignature({ taskId: id, enterpriseId, expires, signature });
    if (!validRequest) {
      return NextResponse.json({ success: false, error: '图片链接无效或已过期' }, { status: 401 });
    }

    const generation = await getPostgresMiniAiTaskForTenant(id, enterpriseId);
    const outputImageUrl = String(asRecord(generation?.output).imageUrl || '').trim();
    if (!generation || generation.status !== 'succeeded' || !/^https?:\/\//i.test(outputImageUrl)) {
      return NextResponse.json({ success: false, error: '图片不存在' }, { status: 404 });
    }

    const upstream = await fetch(outputImageUrl, {
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    if (!upstream.ok) {
      return NextResponse.json({ success: false, error: '上游图片暂时不可用' }, { status: 502 });
    }
    const declaredSize = Number(upstream.headers.get('content-length') || 0);
    if (declaredSize > MAX_RESULT_IMAGE_BYTES) {
      return NextResponse.json({ success: false, error: '图片大小超出限制' }, { status: 413 });
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_RESULT_IMAGE_BYTES) {
      return NextResponse.json({ success: false, error: '图片大小超出限制' }, { status: 413 });
    }
    const mimeType = detectAiImageMimeType(buffer);
    if (!mimeType) {
      return NextResponse.json({ success: false, error: '图片格式不受支持' }, { status: 415 });
    }
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, max-age=1800',
      },
    });
  } catch (error) {
    console.error('[Mini AI Task Result Image]', error);
    return NextResponse.json({ success: false, error: '读取图片失败' }, { status: 502 });
  }
}
