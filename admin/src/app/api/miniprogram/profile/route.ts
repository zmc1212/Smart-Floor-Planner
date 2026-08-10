import { NextResponse } from 'next/server';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import {
  serializeMiniProgramProfile,
  updateMiniProgramNickname,
} from '@/lib/miniprogram-profile';
import { withPlatformTransaction } from '@/db/transaction';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const context = await resolveMiniProgramContext(request);
  if (!context) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }
  return NextResponse.json({
    success: true,
    data: serializeMiniProgramProfile({ request, context }),
  });
}

export async function PATCH(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    const body = await request.json();
    const nickname = String(body.nickname || '').trim();
    if (!nickname || nickname.length > 30) {
      return NextResponse.json(
        { success: false, error: '昵称应为 1–30 个字符' },
        { status: 400 }
      );
    }
    const updated = await withPlatformTransaction((transaction) =>
      updateMiniProgramNickname({ transaction, context, nickname })
    );
    return NextResponse.json({
      success: true,
      data: serializeMiniProgramProfile({
        request,
        context,
        user: updated.user,
        staff: updated.staff,
      }),
    });
  } catch (error) {
    console.error('[MiniProgramProfile] Update failed', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '资料保存失败',
      },
      { status: 400 }
    );
  }
}
