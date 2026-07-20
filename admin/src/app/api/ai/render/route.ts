import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { AiGeneration } from '@/models/AiGeneration';
import { AiWorkflow } from '@/models/AiWorkflow';
import Lead from '@/models/Lead';
import { withTenantRoute } from '@/lib/tenant-route';
import { ensureDefaultAiStylePresets, getAiStylePresetByKey } from '@/lib/ai/presets';
import { executeGenerationImage } from '@/lib/ai/execution-service';
import { getNextWorkflowStage } from '@/lib/ai/workflow-stages';

function resolvePresetType(type?: string) {
  if (type === 'scenario') return 'scenario';
  return type === 'furnishing_render' || type === 'soft_furnishing_render'
    ? 'furnishing_style'
    : 'floor_plan_style';
}

function parseUpstreamStatus(error: unknown) {
  const maybe = error as Error & { status?: number };
  return maybe?.status || 500;
}

function logRenderPayload(input: {
  generationId: string;
  workflowId?: string;
  leadId?: string;
  stageKey?: string;
  model: string;
  size: string;
  quality: string;
  mode: 'generation' | 'edit';
  hasReferenceImage: boolean;
  prompt: string;
  negativePrompt?: string;
}) {
  console.log('\n========== AI RENDER PAYLOAD ==========');
  console.log(`generationId: ${input.generationId}`);
  console.log(`workflowId: ${input.workflowId || '-'}`);
  console.log(`leadId: ${input.leadId || '-'}`);
  console.log(`stageKey: ${input.stageKey || '-'}`);
  console.log(`mode: ${input.mode}`);
  console.log(`model: ${input.model}`);
  console.log(`size: ${input.size}`);
  console.log(`quality: ${input.quality}`);
  console.log(`hasReferenceImage: ${input.hasReferenceImage ? 'yes' : 'no'}`);
  console.log('prompt:');
  console.log(input.prompt);
  console.log('negativePrompt:');
  console.log(input.negativePrompt || '-');
  console.log('========== END AI RENDER PAYLOAD ==========\n');
}

function buildLeadFollowUp(stageKey?: string) {
  if (stageKey === 'direction') return '已生成风格方案';
  if (stageKey === 'base_render') return '已生成基准效果图';
  if (stageKey === 'proposal_pack') return '已生成提案板';
  return null;
}

export async function POST(req: Request) {
  try {
    await dbConnect();

    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      await ensureDefaultAiStylePresets(context.userId);
      const body = await req.json();
      const { generationId, image, prompt, negativePrompt } = body;

      if (!generationId) {
        return NextResponse.json({ success: false, error: 'Missing generationId' }, { status: 400 });
      }

      const generation = await AiGeneration.findOne({
        _id: generationId,
        enterpriseId: context.enterpriseId,
      });

      if (!generation) {
        return NextResponse.json({ success: false, error: 'Generation record not found' }, { status: 404 });
      }

      if (generation.status !== 'pending' && generation.status !== 'failed') {
        return NextResponse.json({ success: false, error: 'Generation is already in progress or completed' }, { status: 400 });
      }

      const workflow = generation.workflowId
        ? await AiWorkflow.findOne({
            _id: generation.workflowId,
            enterpriseId: context.enterpriseId,
          })
        : null;

      if (workflow) {
        const lead = await Lead.findById(workflow.leadId).select('_id').lean();
        if (!lead) {
          generation.status = 'failed';
          generation.errorMessage = 'Associated lead not found or inaccessible';
          await generation.save();
          return NextResponse.json(
            { success: false, error: generation.errorMessage },
            { status: 404 }
          );
        }
      }

      try {
        generation.status = 'processing';
        const resolvedImage = await resolveSourceImage({
          explicitImage: image,
          generation,
          workflow,
        });

        if (!resolvedImage) {
          generation.status = 'failed';
          generation.errorMessage = '未找到可用于继续生成的来源图片';
          await generation.save();
          return NextResponse.json(
            { success: false, error: '当前步骤缺少来源图片，请先创建方案会话或选择上一步产物' },
            { status: 400 }
          );
        }

        generation.input.sourceImage =
          typeof resolvedImage === 'string' && resolvedImage.startsWith('data:image')
            ? 'data-uri'
            : resolvedImage;
        await generation.save();

        const presetType = resolvePresetType(generation.type);
        const preset = await getAiStylePresetByKey(presetType, generation.input.style);
        const requestPayload = {
          prompt: prompt || generation.output.promptUsed || generation.input.customPrompt || '',
          negativePrompt: negativePrompt || preset?.negativePrompt,
          images: preset?.image.mode === 'generation' ? undefined : [resolvedImage],
          logicalModelKey: preset?.image.mode === 'generation' ? 'image.generate.standard' as const : 'image.edit.standard' as const,
          size: preset?.image.size || '1024x1024',
          quality: preset?.image.quality || 'medium',
          user: String(context.userId),
        };
        logRenderPayload({
          generationId: String(generation._id),
          workflowId: generation.workflowId ? String(generation.workflowId) : undefined,
          leadId: generation.leadId ? String(generation.leadId) : undefined,
          stageKey: generation.stageKey,
          model: requestPayload.logicalModelKey,
          size: requestPayload.size,
          quality: requestPayload.quality,
          mode: preset?.image.mode === 'generation' ? 'generation' : 'edit',
          hasReferenceImage: Boolean(requestPayload.images?.length),
          prompt: requestPayload.prompt,
          negativePrompt: requestPayload.negativePrompt,
        });
        const completedGeneration = await executeGenerationImage(generation, requestPayload);
        if (completedGeneration.status !== 'succeeded') {
          return NextResponse.json({ success: true, data: { id: generation._id, status: completedGeneration.status } });
        }

        if (workflow) {
          workflow.lastGenerationId = generation._id;
          if (generation.stageKey === 'base_render' || generation.stageKey === 'soft_furnishing') {
            await AiGeneration.updateMany(
              { workflowId: workflow._id, isSelectedBaseline: true },
              { $set: { isSelectedBaseline: false } }
            );
            generation.isSelectedBaseline = true;
            await generation.save();
            workflow.selectedGenerationId = generation._id;
          }

          workflow.currentStageKey =
            generation.nextRecommendedStage ||
            getNextWorkflowStage(generation.stageKey) ||
            workflow.currentStageKey;
          await workflow.save();

          const followUpContent = buildLeadFollowUp(generation.stageKey);
          if (followUpContent) {
            await Lead.updateOne(
              { _id: workflow.leadId },
              {
                $push: {
                  followUpRecords: {
                    content: followUpContent,
                    operator: context.username || 'System',
                    createdAt: new Date(),
                  },
                },
              }
            ).catch(() => undefined);
          }
        }

        return NextResponse.json({ success: true, data: { id: generation._id, status: generation.status, imageUrl: generation.output.imageUrl } });
      } catch (err: unknown) {
        console.error('[AI Render Error]', err);

        if (generation.status !== 'processing') generation.status = 'failed';
        generation.errorMessage = err instanceof Error ? err.message : 'Render failed';
        generation.remoteModel = generation.remoteModel || undefined;
        await generation.save();

        const status = parseUpstreamStatus(err);
        const readableMessage = status === 402
          ? '当前企业 AI 点数不足，请联系平台管理员调整。'
          : err instanceof Error ? err.message : '图片生成失败';

        return NextResponse.json({ success: false, error: readableMessage }, { status: status >= 400 ? status : 500 });
      }
    });
  } catch (error: unknown) {
    console.error('[AI Render Server Error]', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

async function resolveSourceImage({
  explicitImage,
  generation,
  workflow,
}: {
  explicitImage?: string;
  generation: {
    parentGenerationId?: unknown;
  };
  workflow: {
    selectedGenerationId?: unknown;
    sourceImage?: string;
  } | null;
}) {
  if (explicitImage) {
    return explicitImage;
  }

  if (generation.parentGenerationId) {
    const parentGeneration = await AiGeneration.findById(String(generation.parentGenerationId));

    if (parentGeneration?.output?.imageUrl) {
      return parentGeneration.output.imageUrl;
    }
  }

  if (workflow?.selectedGenerationId) {
    const selectedGeneration = await AiGeneration.findById(String(workflow.selectedGenerationId));

    if (selectedGeneration?.output?.imageUrl) {
      return selectedGeneration.output.imageUrl;
    }
  }

  if (workflow?.sourceImage) {
    return workflow.sourceImage;
  }

  return undefined;
}
