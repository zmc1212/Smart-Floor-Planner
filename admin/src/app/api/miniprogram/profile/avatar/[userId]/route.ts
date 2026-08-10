import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { UserRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import {
  decodeManagedAvatarReference,
  verifyProfileAvatarSignature,
} from '@/lib/miniprogram-profile';
import { resolveMediaObjectDelivery } from '@/lib/media-storage/operations';
import { getMediaStorageProvider } from '@/lib/media-storage/registry';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    const url = new URL(request.url);
    const expires = Number(url.searchParams.get('expires') || 0);
    const signature = url.searchParams.get('signature') || '';
    if (
      !/^[1-9]\d*$/.test(userId) ||
      !verifyProfileAvatarSignature({ userId, expires, signature })
    ) {
      return NextResponse.json(
        { success: false, error: '头像地址已失效' },
        { status: 403 }
      );
    }
    const user = await withPlatformTransaction((transaction) =>
      new UserRepository(transaction).findById(
        parsePostgresId(userId, 'user id')
      )
    );
    const reference = decodeManagedAvatarReference(user?.avatar);
    if (!reference) {
      return NextResponse.json(
        { success: false, error: '头像不存在' },
        { status: 404 }
      );
    }
    const provider = await getMediaStorageProvider(reference.provider);
    const delivery = await resolveMediaObjectDelivery({
      provider,
      location: {
        objectKey: reference.objectKey,
        bucket: reference.bucket,
      },
      expiresInSeconds: 300,
    });
    if (delivery.kind === 'redirect') {
      return NextResponse.redirect(delivery.url, {
        status: 302,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    return new NextResponse(new Uint8Array(delivery.buffer), {
      headers: {
        'Content-Type': reference.mimeType,
        'Content-Length': String(delivery.buffer.length),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    console.error('[MiniProgramProfile] Avatar read failed', error);
    return NextResponse.json(
      { success: false, error: '头像读取失败' },
      { status: 500 }
    );
  }
}
