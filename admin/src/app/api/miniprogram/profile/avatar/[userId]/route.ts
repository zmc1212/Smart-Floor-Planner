import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { UserRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import {
  decodeManagedAvatarReference,
  verifyProfileAvatarSignature,
} from '@/lib/miniprogram-profile';
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
    const buffer = await provider.getObject({
      objectKey: reference.objectKey,
      bucket: reference.bucket,
    });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': reference.mimeType,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, no-store',
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
