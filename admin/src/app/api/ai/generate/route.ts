import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { AiGeneration } from '@/models/AiGeneration';
import { withTenantRoute } from '@/lib/tenant-route';
import {
  buildPromptFromPreset,
  ensureDefaultAiStylePresets,
  getAiStylePresetByKey,
  getDefaultAiStylePresetByKey,
} from '@/lib/ai/presets';
import { buildSoftFurnishingPromptFromPreset, FurnitureSelection } from '@/lib/ai/soft-furnishing';
import type { AiPresetType, DefaultAiStylePreset } from '@/lib/ai/preset-definitions';
import { EnterpriseAiUsageSnapshot } from '@/models/EnterpriseAiUsageSnapshot';
import {
  deriveEnterpriseKeyStatus,
  getEnterprisePollinationsRuntimeConfig,
  markEnterpriseAiSyncError,
} from '@/lib/ai/enterprise-ai';

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
  furnitureItems?: FurnitureSelection[];
}

function resolvePresetType(type?: string): AiPresetType {
  return type === 'furnishing_render' || type === 'soft_furnishing_render'
    ? 'furnishing_style'
    : 'floor_plan_style';
}

function buildPresetSnapshot(preset: DefaultAiStylePreset) {
  return {
    key: preset.key,
    type: preset.type,
    name: preset.name,
    promptTemplate: preset.promptTemplate,
    negativePrompt: preset.negativePrompt,
    provider: preset.provider,
    image: preset.image,
    icon: preset.icon,
    previewClassName: preset.previewClassName,
    mockImageUrl: preset.mockImageUrl,
  };
}

export async function POST(req: Request) {
  try {
    await dbConnect();

    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      await ensureDefaultAiStylePresets(context.userId);

      const body = (await req.json()) as GenerateBody;
      const { type, style, roomType, roomName, width, height, floorPlanId, mode, roomData, furnitureItems } =
        body;

      if (!type || !style) {
        return NextResponse.json(
          { success: false, error: '缺少必要参数 type / style' },
          { status: 400 }
        );
      }

      let runtimeConfig;
      try {
        runtimeConfig = await getEnterprisePollinationsRuntimeConfig(String(context.enterpriseId));
      } catch (error) {
        return NextResponse.json(
          {
            success: false,
            error: error instanceof Error ? error.message : '当前企业 AI Key 不可用',
          },
          { status: 400 }
        );
      }

      const latestSnapshot = await EnterpriseAiUsageSnapshot.findOne({
        enterpriseId: context.enterpriseId,
      })
        .select('balance lastSyncedAt keyInfo syncError')
        .lean();
      const keyStatus = deriveEnterpriseKeyStatus({
        aiConfig: { pollinationsKeyRef: runtimeConfig.keyId },
        keyInfo: latestSnapshot?.keyInfo
          ? { id: latestSnapshot.keyInfo.keyId, valid: latestSnapshot.keyInfo.valid }
          : null,
      });

      if ((latestSnapshot?.balance ?? 0) <= 0 && process.env.MOCK_AI !== 'true') {
        return NextResponse.json(
          {
            success: false,
            error: '当前企业 Pollinations 余额不足，请联系平台管理员充值。',
            quota: {
              balance: latestSnapshot?.balance ?? 0,
              keyStatus,
            },
          },
          { status: 402 }
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
        prompt =
          type === 'soft_furnishing_render'
            ? buildSoftFurnishingPromptFromPreset({
                promptTemplate: preset.promptTemplate,
                furnitureItems: Array.isArray(furnitureItems) ? furnitureItems : [],
                roomType,
              })
            : buildPromptFromPreset(preset.promptTemplate, {
                roomName,
                roomType,
                width,
                height,
                roomData,
              });
      }

      const generation = await AiGeneration.create({
        enterpriseId: context.enterpriseId!,
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
          furnitureItems,
          presetSnapshot: preset ? buildPresetSnapshot(preset) : undefined,
        },
        status: 'processing',
        apiKeyId: runtimeConfig.keyId,
        apiKeyName: runtimeConfig.keyName,
        quotaSnapshot: {
          balance: latestSnapshot?.balance ?? 0,
          keyStatus,
          allowedModels: latestSnapshot?.keyInfo?.allowedModels || runtimeConfig.allowedModels,
          lastSyncedAt: latestSnapshot?.lastSyncedAt || undefined,
        },
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
            (width && height
              ? `Dimensions: ${(width / 10).toFixed(1)}m x ${(height / 10).toFixed(1)}m. `
              : '') +
            (roomData
              ? `\nArchitectural Data (polygons, doors, windows): ${JSON.stringify(roomData)}`
              : '');

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
            balance: latestSnapshot?.balance ?? 0,
            keyStatus,
            allowedModels: latestSnapshot?.keyInfo?.allowedModels || runtimeConfig.allowedModels,
          },
        });
      } catch (aiError: unknown) {
        generation.status = 'failed';
        generation.errorMessage =
          aiError instanceof Error ? aiError.message : 'Prompt generation failed';
        await generation.save();

        if (context.enterpriseId) {
          await markEnterpriseAiSyncError(String(context.enterpriseId), aiError).catch(
            () => undefined
          );
        }

        return NextResponse.json(
          { success: false, error: 'AI 提示词生成失败' },
          { status: 502 }
        );
      }
    });
  } catch (error: unknown) {
    console.error('[AI Generate]', error);
    return NextResponse.json({ success: false, error: '服务端内部错误' }, { status: 500 });
  }
}
