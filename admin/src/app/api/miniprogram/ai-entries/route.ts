import { NextResponse } from 'next/server';
import { readMiniProgramAiEntries } from '@/lib/miniprogram-ai-entries';

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    const data = await readMiniProgramAiEntries();
    return NextResponse.json({ success: true, data }, { headers });
  } catch {
    return NextResponse.json({ success: false, error: '入口设置暂时无法读取' }, { status: 503, headers });
  }
}
