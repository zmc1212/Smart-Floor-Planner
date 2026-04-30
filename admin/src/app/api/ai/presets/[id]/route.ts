import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { AiStylePreset } from '@/models/AiStylePreset';
import { ensureDefaultAiStylePresets, serializeAiStylePreset } from '@/lib/ai/presets';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();

    return await withTenantRoute(req, { roles: ['super_admin', 'admin'] }, async (context) => {
      await ensureDefaultAiStylePresets(context.userId);

      const { id } = await params;
      const body = await req.json();
      const update: Record<string, unknown> = {
        updatedBy: context.userId,
      };

      const fields = [
        'name',
        'description',
        'icon',
        'previewClassName',
        'mockImageUrl',
        'promptTemplate',
        'negativePrompt',
        'enabled',
        'sortOrder',
      ] as const;

      for (const field of fields) {
        if (body[field] !== undefined) {
          update[field] = body[field];
        }
      }

      if (body.image && typeof body.image === 'object') {
        const imageFields = ['model', 'size', 'quality', 'mode'] as const;
        for (const field of imageFields) {
          if (body.image[field] !== undefined) {
            update[`image.${field}`] = body.image[field];
          }
        }
      }

      const preset = await AiStylePreset.findByIdAndUpdate(
        id,
        { $set: update },
        { returnDocument: 'after' }
      );
      if (!preset) {
        return NextResponse.json({ success: false, error: 'Preset not found' }, { status: 404 });
      }

      return NextResponse.json({ success: true, data: serializeAiStylePreset(preset) });
    });
  } catch (error) {
    console.error('[AI Presets PATCH]', error);
    return NextResponse.json({ success: false, error: 'Failed to update AI preset' }, { status: 500 });
  }
}
