import { NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { ensureDefaultAiStylePresets, serializeAiStylePreset } from '@/lib/ai/presets';
import {
  AiStylePresetRepository,
  type AiStylePresetUpdate,
} from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { parsePostgresId } from '@/db/postgres-dto';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await withTenantRoute(req, { roles: ['super_admin', 'admin'] }, async (context) => {
      await ensureDefaultAiStylePresets(context.userId);

      const { id } = await params;
      const body = await req.json();
      const update: Record<string, unknown> = {
        updatedBy: parsePostgresId(context.userId, 'userId'),
      };

      const fields = [
        'name',
        'description',
        'icon',
        'previewClassName',
        'mockImageUrl',
        'promptTemplate',
        'promptTemplateSecondStage',
        'negativePrompt',
        'enabled',
        'sortOrder',
      ] as const;

      for (const field of fields) {
        if (body[field] !== undefined) {
          update[field] = body[field];
        }
      }

      let presetId: bigint;
      try {
        presetId = parsePostgresId(id, 'id');
      } catch {
        return NextResponse.json({ success: false, error: 'Preset not found' }, { status: 404 });
      }

      if (body.image && typeof body.image === 'object') {
        const existing = await withPlatformTransaction((transaction) =>
          new AiStylePresetRepository(transaction).findById(presetId)
        );
        if (!existing) {
          return NextResponse.json({ success: false, error: 'Preset not found' }, { status: 404 });
        }
        const imageFields = ['model', 'logicalModelKey', 'size', 'quality', 'mode'] as const;
        const image = { ...(existing.image || {}) } as Record<string, unknown>;
        for (const field of imageFields) {
          if (body.image[field] !== undefined) {
            image[field] = body.image[field];
          }
        }
        update.image = image;
      }
      const preset = await withPlatformTransaction((transaction) =>
        new AiStylePresetRepository(transaction).update(
          presetId,
          update as AiStylePresetUpdate
        )
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
