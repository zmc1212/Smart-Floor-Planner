import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { AiGeneration } from '@/models/AiGeneration';
import { AiWorkflow } from '@/models/AiWorkflow';
import Lead from '@/models/Lead';
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
import { generateChatCompletion } from '@/lib/ai/pollinations';
import { ensureModelAccessibleImageUrl, persistImageReference, updateMediaAssetOwner } from '@/lib/ai/media-assets';
import type { AiWorkflowSourceAssetRole, AiWorkflowStageKey } from '@/lib/ai/workflow-stages';
import { getNextWorkflowStage } from '@/lib/ai/workflow-stages';

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
  workflowId?: string;
  stageKey?: AiWorkflowStageKey;
  parentGenerationId?: string;
  sourceAssetRole?: AiWorkflowSourceAssetRole;
  styleReferenceImage?: string;
}

function resolvePresetType(type?: string): AiPresetType {
  if (type === 'scenario') return 'scenario';
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
    workflowCategory: preset.workflowCategory,
    workflowStage: preset.workflowStage,
    sourceAssetRole: preset.sourceAssetRole,
    nextRecommendedStage: preset.nextRecommendedStage,
  };
}

function logPromptDraft(input: {
  generationId: string;
  workflowId?: string;
  leadId?: string;
  type: string;
  style: string;
  stageKey?: AiWorkflowStageKey;
  sourceAssetRole?: AiWorkflowSourceAssetRole;
  prompt: string;
  negativePrompt?: string;
}) {
  console.log('\n========== AI PROMPT DRAFT ==========');
  console.log(`generationId: ${input.generationId}`);
  console.log(`workflowId: ${input.workflowId || '-'}`);
  console.log(`leadId: ${input.leadId || '-'}`);
  console.log(`type: ${input.type}`);
  console.log(`style: ${input.style}`);
  console.log(`stageKey: ${input.stageKey || '-'}`);
  console.log(`sourceAssetRole: ${input.sourceAssetRole || '-'}`);
  console.log('prompt:');
  console.log(input.prompt);
  console.log('negativePrompt:');
  console.log(input.negativePrompt || '-');
  console.log('========== END AI PROMPT DRAFT ==========\n');
}

export async function POST(req: Request) {
  try {
    await dbConnect();

    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      await ensureDefaultAiStylePresets(context.userId);

      const body = (await req.json()) as GenerateBody;
      const {
        type,
        style,
        roomType,
        roomName,
        width,
        height,
        floorPlanId,
        mode,
        roomData,
        furnitureItems,
        workflowId,
        stageKey,
        parentGenerationId,
        sourceAssetRole,
        styleReferenceImage,
      } = body;

      if (!type || !style) {
        return NextResponse.json(
          { success: false, error: 'Missing required params: type / style' },
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

      let workflow = null;
      if (workflowId) {
        workflow = await AiWorkflow.findOne({
          _id: workflowId,
          enterpriseId: context.enterpriseId,
        });

        if (!workflow) {
          return NextResponse.json(
            { success: false, error: '鏂规浼氳瘽涓嶅瓨鍦ㄦ垨宸叉棤鏉冮檺璁块棶' },
            { status: 404 }
          );
        }

        const lead = await Lead.findById(workflow.leadId).select('_id').lean();
        if (!lead) {
          return NextResponse.json(
            { success: false, error: 'Associated lead not found or inaccessible' },
            { status: 404 }
          );
        }
      }

      let parentGeneration = null;
      if (parentGenerationId) {
        parentGeneration = await AiGeneration.findOne({
          _id: parentGenerationId,
          enterpriseId: context.enterpriseId,
        });

        if (!parentGeneration) {
          return NextResponse.json(
            { success: false, error: '涓婁竴浜х墿涓嶅瓨鍦ㄦ垨宸叉棤鏉冮檺璁块棶' },
            { status: 404 }
          );
        }
      }

      const resolvedStageKey = stageKey || preset?.workflowStage;
      const resolvedSourceAssetRole = sourceAssetRole || preset?.sourceAssetRole;
      const nextRecommendedStage = preset?.nextRecommendedStage || getNextWorkflowStage(resolvedStageKey);
      const persistedStyleReferenceImage = styleReferenceImage
        ? await persistImageReference({
            enterpriseId: String(context.enterpriseId),
            ownerType: 'ai_generation_input',
            image: styleReferenceImage,
          })
        : undefined;

      const generation = await AiGeneration.create({
        enterpriseId: context.enterpriseId!,
        operatorId: context.userId,
        leadId: workflow?.leadId,
        workflowId: workflow?._id,
        parentGenerationId: parentGeneration?._id,
        floorPlanId: floorPlanId || undefined,
        type,
        stageKey: resolvedStageKey,
        sourceAssetRole: resolvedSourceAssetRole,
        nextRecommendedStage,
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
          styleReferenceImage: persistedStyleReferenceImage,
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
      await updateMediaAssetOwner(persistedStyleReferenceImage, generation._id);

      try {
        let promptData: { prompt: string; negative_prompt?: string };

        if (resolvedStageKey === 'lighting') {
          // Check for reference image
          let referenceImageUrl = persistedStyleReferenceImage;
          if (!referenceImageUrl && parentGeneration) {
            referenceImageUrl = parentGeneration.output?.imageUrl || parentGeneration.input?.styleReferenceImage;
          }

          if (!referenceImageUrl) {
            return NextResponse.json(
              { success: false, error: '增强签单阶段必须提供白天参考效果图，以供分析与重绘。' },
              { status: 400 }
            );
          }

          // 1. Upload reference image if it is base64
          const publicImageUrl = await ensureModelAccessibleImageUrl(
            referenceImageUrl,
            String(context.enterpriseId),
            runtimeConfig.apiKey
          );

          // Update styleReferenceImage with public URL to ensure rendering has access
          generation.input.styleReferenceImage = referenceImageUrl;

          // 2. Stage 1: 鑴戝姏瑙勫垝 (Mental Planning)
          const formattedFirstStagePrompt = buildPromptFromPreset(preset?.promptTemplate || '', {
            roomName,
            roomType,
            width,
            height,
            roomData,
          });

          console.log('[AI Generate Lighting] Stage 1 - Mentally planning with prompt:', formattedFirstStagePrompt);

          const sceneAnalysisText = await generateChatCompletion({
            apiKey: runtimeConfig.apiKey,
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: formattedFirstStagePrompt,
                  },
                  {
                    type: 'image_url',
                    image_url: {
                      url: publicImageUrl,
                    },
                  },
                ],
              },
            ],
            temperature: 0.7,
          });

          console.log('[AI Generate Lighting] Stage 1 - Mental Plan result:', sceneAnalysisText);

          // Save sceneAnalysis text to the generation input record
          generation.input.sceneAnalysis = sceneAnalysisText;

          // 3. Stage 2: 澶у浘缁樺埗缂栬瘧 (Board Prompt Compilation)
          const formattedSecondStagePrompt = preset?.promptTemplateSecondStage || '直接生成展板图片，把灯光设计分析、灯光清单、夜景效果图排列出来。';

          const compilePrompt = `
            Task: Compile a highly detailed, professional English image generation prompt for Stable Diffusion/Flux.
            
            Inputs:
            1. Space Design & Analysis (Mental Plan):
            ${sceneAnalysisText}
            
            2. Generation Goal:
            ${formattedSecondStagePrompt}
            
            Requirements:
            - Translate the design analysis, night scene requirements, and lighting list into a visual description of a professional interior design presentation board (mood board).
            - Describe a structured, beautiful design presentation poster/board layout. For example, "A professional interior design presentation board featuring: on the left, a detailed night scene rendering of a ${style} style ${roomType} with warm ambient lighting, elegant shadow play, and refined textures; on the right, neatly formatted text columns showing the 'Lighting Concept', 'Color Temperature Analysis', and a structured 'Lighting Equipment List' with clean typography. Minimalist design, high-end architectural portfolio aesthetic, photorealistic, 8k resolution, volumetric light, highly detailed."
            - Make it highly visual, photorealistic, and focused on layout, colors, lighting, and presentation.
            - Avoid generic placeholder words or instructions. Do not include any greeting or conversational filler.
            - Output MUST be a JSON object with keys "prompt" and "negative_prompt".
            
            Format:
            {
              "prompt": "...",
              "negative_prompt": "..."
            }
          `;

          console.log('[AI Generate Lighting] Stage 2 - Compiling board prompt...');

          const compileResponse = await generateChatCompletion({
            apiKey: runtimeConfig.apiKey,
            messages: [
              { role: 'system', content: 'You are an expert compiler of visual design boards and interior design prompts.' },
              { role: 'user', content: compilePrompt },
            ],
            temperature: 0.7,
          });

          console.log('[AI Generate Lighting] Stage 2 - Compilation response:', compileResponse);

          let secondStageData: { prompt: string; negative_prompt?: string } = {
            prompt: '',
            negative_prompt: '',
          };

          const jsonMatch = compileResponse.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              secondStageData = JSON.parse(jsonMatch[0]);
            } catch {
              console.error('Failed to parse compiled prompt JSON:', compileResponse);
              secondStageData = {
                prompt: `A professional interior design presentation board showing: night scene rendering of a ${style} style ${roomType} with warm lighting; clean typography showing lighting list and analysis. High-end, photorealistic, 8k.`,
                negative_prompt: 'ugly, blurry, low quality',
              };
            }
          } else {
            secondStageData = {
              prompt: `A professional interior design presentation board showing: night scene rendering of a ${style} style ${roomType} with warm lighting; clean typography showing lighting list and analysis. High-end, photorealistic, 8k.`,
              negative_prompt: 'ugly, blurry, low quality',
            };
          }

          promptData = {
            prompt: secondStageData.prompt,
            negative_prompt: secondStageData.negative_prompt || negativePrompt,
          };

        } else if (prompt) {
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
            details,
            runtimeConfig.apiKey
          );
        }

        generation.input.customPrompt = promptData.prompt;
        generation.output.promptUsed = promptData.prompt || prompt;
        generation.status = 'pending';
        await generation.save();

        logPromptDraft({
          generationId: String(generation._id),
          workflowId: workflow ? String(workflow._id) : undefined,
          leadId: workflow?.leadId ? String(workflow.leadId) : undefined,
          type,
          style,
          stageKey: resolvedStageKey,
          sourceAssetRole: resolvedSourceAssetRole,
          prompt: promptData.prompt,
          negativePrompt: promptData.negative_prompt || negativePrompt,
        });

        return NextResponse.json({
          success: true,
          data: {
            id: generation._id,
            prompt: promptData.prompt,
            negativePrompt: promptData.negative_prompt || negativePrompt,
            type,
            style,
            presetType,
            workflowId: workflow ? String(workflow._id) : undefined,
            leadId: workflow?.leadId ? String(workflow.leadId) : undefined,
            stageKey: resolvedStageKey,
            nextRecommendedStage,
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
