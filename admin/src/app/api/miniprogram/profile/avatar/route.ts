import crypto from 'node:crypto';
import sharp from 'sharp';
import { NextResponse } from 'next/server';
import { UserRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import {
  decodeManagedAvatarReference,
  encodeManagedAvatarReference,
  ensureMiniProgramProfileUser,
  resolveProfileAvatarUrl,
} from '@/lib/miniprogram-profile';
import { persistMediaObject } from '@/lib/media-storage/operations';
import {
  getDefaultMediaStorageProvider,
  getMediaStorageProvider,
} from '@/lib/media-storage/registry';

export const runtime = 'nodejs';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);

export async function POST(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: '请选择头像图片' },
        { status: 400 }
      );
    }
    if (file.size > MAX_AVATAR_BYTES) {
      return NextResponse.json(
        { success: false, error: '头像图片不能超过 5 MB' },
        { status: 400 }
      );
    }

    const sourceBuffer = Buffer.from(await file.arrayBuffer());
    const metadata = await sharp(sourceBuffer).metadata();
    if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
      return NextResponse.json(
        { success: false, error: '头像仅支持 JPG、PNG 或 WebP' },
        { status: 400 }
      );
    }
    // JPEG only: WeChat Mini Program <image> can fail to render remote WebP.
    const avatarBuffer = await sharp(sourceBuffer)
      .rotate()
      .resize(512, 512, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    const user = await withPlatformTransaction((transaction) =>
      ensureMiniProgramProfileUser(transaction, context)
    );
    const previousReference = decodeManagedAvatarReference(user.avatar);
    const provider = await getDefaultMediaStorageProvider();
    const logicalKey = `profile-avatars/${user.id.toString()}/${crypto.randomUUID()}.jpg`;
    const objectKey = provider.buildObjectKey?.(logicalKey) || logicalKey;
    const persisted = await persistMediaObject({
      provider,
      objectKey,
      buffer: avatarBuffer,
      contentType: 'image/jpeg',
      commit: async (stored) => {
        const avatar = encodeManagedAvatarReference({
          provider: provider.key,
          objectKey,
          bucket: stored.bucket,
          mimeType: 'image/jpeg',
        });
        const updated = await withPlatformTransaction((transaction) =>
          new UserRepository(transaction).update(user.id, { avatar })
        );
        if (!updated) throw new Error('用户资料不存在');
        return avatar;
      },
    });

    if (previousReference) {
      try {
        const oldProvider = await getMediaStorageProvider(
          previousReference.provider
        );
        await oldProvider.deleteObject({
          objectKey: previousReference.objectKey,
          bucket: previousReference.bucket,
        });
      } catch (error) {
        console.error('[MiniProgramProfile] Old avatar cleanup failed', error);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        avatar: resolveProfileAvatarUrl({
          request,
          userId: user.id.toString(),
          avatar: persisted.value,
        }),
      },
    });
  } catch (error) {
    console.error('[MiniProgramProfile] Avatar upload failed', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '头像上传失败',
      },
      { status: 400 }
    );
  }
}
