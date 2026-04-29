import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { ensureDefaultAiStylePresets, listAiStylePresets } from '@/lib/ai/presets';
import type { AiPresetType } from '@/lib/ai/preset-definitions';

export async function GET(req: Request) {
  try {
    await dbConnect();

    return await withTenantRoute(req, {}, async (context) => {
      await ensureDefaultAiStylePresets(context.userId);

      const url = new URL(req.url);
      const requestedType = url.searchParams.get('type') as AiPresetType | null;
      const includeDisabled = url.searchParams.get('includeDisabled') === 'true';
      const canManage = context.role === 'super_admin' || context.role === 'admin';
      const presets = await listAiStylePresets(requestedType || undefined, canManage ? includeDisabled : false);

      return NextResponse.json({ success: true, data: presets });
    });
  } catch (error) {
    console.error('[AI Presets GET]', error);
    return NextResponse.json({ success: false, error: 'Failed to load AI presets' }, { status: 500 });
  }
}
