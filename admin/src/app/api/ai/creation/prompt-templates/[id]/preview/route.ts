import { NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { getActivePromptTemplateAsset } from '@/lib/ai/prompt-library-query';
import { isHttpSourceUrl } from '@/lib/ai/prompt-template-cover';
import { resolveMediaObjectDelivery } from '@/lib/media-storage/operations';
import { getMediaStorageProvider } from '@/lib/media-storage/registry';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await withTenantRoute(req, {}, async () => {
      const { id } = await params;
      const asset = await getActivePromptTemplateAsset(id);
      if (!asset) return NextResponse.json({ success: false, error: 'Prompt preview not found' }, { status: 404 });
      try {
        const provider = await getMediaStorageProvider(asset.storageProvider);
        const delivery = await resolveMediaObjectDelivery({
          provider,
          location: {
            objectKey: asset.storageKey,
            bucket: asset.storageBucket ?? undefined,
          },
          expiresInSeconds: 3600,
        });
        if (delivery.kind === 'redirect') {
          return NextResponse.redirect(delivery.url, { status: 302, headers: { 'Cache-Control': 'private, no-store' } });
        }
        return new NextResponse(new Uint8Array(delivery.buffer), {
          headers: {
            'Content-Type': asset.mimeType,
            'Content-Length': String(delivery.buffer.length),
            'ETag': `\"${asset.checksumSha256}\"`,
            'Cache-Control': 'private, max-age=86400',
          },
        });
      } catch (storedError) {
        if (!isHttpSourceUrl(asset.sourceUrl)) throw storedError;
        return NextResponse.redirect(String(asset.sourceUrl).trim(), {
          status: 302,
          headers: { 'Cache-Control': 'private, no-store' },
        });
      }
    });
  } catch (error) {
    console.error('[AI Prompt Preview GET]', error);
    return NextResponse.json({ success: false, error: 'Failed to load prompt preview' }, { status: 500 });
  }
}
