import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { AiQuota, TIER_LIMITS } from '@/models/AiQuota';
import { AiGeneration } from '@/models/AiGeneration';
import { withTenantRoute } from '@/lib/tenant-route';
import {
  buildPromptFromPreset,
  ensureDefaultAiStylePresets,
  getAiStylePresetByKey,
  getDefaultAiStylePresetByKey,
} from '@/lib/ai/presets';
import type { AiPresetType, DefaultAiStylePreset } from '@/lib/ai/preset-definitions';

interface GenerateBody {
  type?: 'floor_plan_style' | 'furnishing_render' | 'advice' | string;
  style?: string;
  roomType?: string;
  roomName?: string;
  width?: number;
  height?: number;
  floorPlanId?: string;
  mode?: string;
  roomData?: unknown;
}

function resolvePresetType(type?: string): AiPresetType {
  return type === 'furnishing_render' ? 'furnishing_style' : 'floor_plan_style';
}

function buildPresetSnapshot(preset: DefaultAiStylePreset | any) {
  return {
    key: preset.key,
    type: preset.type,
    name: preset.name,
    promptTemplate: preset.promptTemplate,
    negativePrompt: preset.negativePrompt,
    tensor: preset.tensor,
    mockImageUrl: preset.mockImageUrl,
  };
}

export async function POST(req: Request) {
  try {
    await dbConnect();

    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      await ensureDefaultAiStylePresets(context.userId);

      const body = (await req.json()) as GenerateBody;
      const { type, style, roomType, roomName, width, height, floorPlanId, mode, roomData } = body;

      if (!type || !style) {
        return NextResponse.json({ success: false, error: '缺少必要参数 type / style' }, { status: 400 });
      }

      const enterpriseId = context.enterpriseId ?? undefined;
      let quota = await AiQuota.findOne({ enterpriseId });
      if (!quota) {
        quota = await AiQuota.create({
          enterpriseId,
          tier: 'free',
          monthlyLimit: TIER_LIMITS.free,
        });
      }

      (quota as any).checkAndResetPeriod();
      if (!(quota as any).hasQuota()) {
        return NextResponse.json(
          {
            success: false,
            error: 'AI 配额已用完，请升级会员或购买加油包',
            quota: {
              tier: quota.tier,
              used: quota.usedCount,
              limit: quota.monthlyLimit,
              bonus: quota.bonusCredits,
            },
          },
          { status: 429 }
        );
      }

      const presetType = resolvePresetType(type);
      const preset =
        (await getAiStylePresetByKey(presetType, style)) ||
        getDefaultAiStylePresetByKey(presetType, style) ||
        getDefaultAiStylePresetByKey('floor_plan_style', 'colorful');

      let prompt = '';
      const negativePrompt = preset?.negativePrompt;

      if (preset) {
        prompt = buildPromptFromPreset(preset.promptTemplate, {
          roomName,
          roomType,
          width,
          height,
          roomData,
        });
      }

      const generation: any = await AiGeneration.create({
        enterpriseId,
        operatorId: context.userId,
        floorPlanId: floorPlanId || undefined,
        type,
        input: {
          style,
          roomType,
          roomName,
          width,
          height,
          mode,
          roomData,
          presetSnapshot: preset ? buildPresetSnapshot(preset) : undefined,
        },
        status: 'processing',
      });

      try {
        let promptData: { prompt: string; negative_prompt?: string };

        if (prompt) {
          promptData = {
            prompt,
            negative_prompt: negativePrompt,
          };
        } else if (process.env.MOCK_AI === 'true') {
          promptData = {
            prompt: 'Mock prompt for testing.',
            negative_prompt: 'mock negative prompt',
          };
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } else {
          const { generateAIPrompt } = await import('@/lib/gemini');
          const details =
            (roomName ? `Room Name: ${roomName}. ` : '') +
            (width && height ? `Dimensions: ${(width / 10).toFixed(1)}m x ${(height / 10).toFixed(1)}m. ` : '') +
            (roomData ? `\nArchitectural Data (polygons, doors, windows): ${JSON.stringify(roomData)}` : '');

          promptData = await generateAIPrompt(
            style,
            type === 'floor_plan_style' ? 'floor plan' : roomType || 'interior',
            details
          );
        }

        generation.input.customPrompt = promptData.prompt;
        generation.output.promptUsed = promptData.prompt || prompt;
        generation.status = 'pending';
        await generation.save();

        return NextResponse.json({
          success: true,
          data: {
            id: generation._id,
            prompt: promptData.prompt,
            negativePrompt: promptData.negative_prompt || negativePrompt,
            type,
            style,
            presetType,
          },
          quota: {
            tier: quota.tier,
            used: quota.usedCount,
            limit: quota.monthlyLimit,
            bonus: quota.bonusCredits,
          },
        });
      } catch (aiError: unknown) {
        generation.status = 'failed';
        generation.errorMessage = aiError instanceof Error ? aiError.message : 'Prompt generation failed';
        await generation.save();

        return NextResponse.json({ success: false, error: 'AI 提示词生成失败' }, { status: 502 });
      }
    });
  } catch (error: unknown) {
    console.error('[AI Generate]', error);
    return NextResponse.json({ success: false, error: '服务器内部错误' }, { status: 500 });
  }
}
