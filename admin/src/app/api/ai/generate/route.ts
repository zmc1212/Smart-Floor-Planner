import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { AiQuota, TIER_LIMITS } from '@/models/AiQuota';
import { AiGeneration } from '@/models/AiGeneration';
import { withTenantRoute } from '@/lib/tenant-route';

interface GenerateBody {
  type?: string;
  style?: string;
  roomType?: string;
  roomName?: string;
  width?: number;
  height?: number;
  floorPlanId?: string;
  mode?: string;
  roomData?: unknown;
}

export async function POST(req: Request) {
  try {
    await dbConnect();

    return await withTenantRoute(
      req,
      { requireEnterprise: true },
      async (context) => {
        const body = (await req.json()) as GenerateBody;
        const { type, style, roomType, roomName, width, height, floorPlanId, mode, roomData } = body;

        if (!type || !style) {
          return NextResponse.json({ success: false, error: '缺少必填参数 type / style' }, { status: 400 });
        }

        let quota = await AiQuota.findOne({ enterpriseId: context.enterpriseId });
        if (!quota) {
          quota = await AiQuota.create({
            enterpriseId: context.enterpriseId,
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

        const generation = await AiGeneration.create({
          enterpriseId: context.enterpriseId,
          operatorId: context.userId,
          floorPlanId: floorPlanId || undefined,
          type,
          input: { style, roomType, roomName, width, height, mode },
          status: 'processing',
        });

        const stylePrompts: Record<string, string> = {
          colorful:
            'Colorful professional 2D floor plan rendering. Vibrant pastel colors for each room zone (living room in soft blue, bedroom in warm pink, kitchen in light green, bathroom in lavender). Clean lines, furniture icons, room labels in Chinese, dimension annotations. Modern architectural illustration style, top-down orthographic view, white background.',
          cad:
            'Professional CAD technical drawing style floor plan. Black and white linework, precise dimension lines with measurements in millimeters, wall hatch patterns, door arc swings, window symbols, north arrow indicator. Engineering drafting standard, clean white background, no color fills.',
          '3d':
            '3D isometric cutaway view of an apartment floor plan. Photorealistic interior rendering visible from above at 45 degree angle, walls cut at 1.2m height showing furniture, flooring textures, and room layouts. Soft ambient lighting, architectural visualization quality, miniature diorama style.',
          handdrawn:
            'Hand-drawn architectural sketch style floor plan. Pencil/ink illustration with loose artistic linework, watercolor wash fills for room zones, hand-lettered room labels in Chinese, sketchy furniture outlines, vintage blueprint aesthetic. Cream paper texture background.',
        };

        const furnishingStyles: Record<string, string> = {
          modern: '现代简约',
          cream: '奶油风',
          chinese: '新中式',
          luxury: '意式轻奢',
          wabi: '侘寂风',
          scandinavian: '北欧风',
          japanese: '日式原木',
          industrial: '工业风',
        };

        let prompt = '';
        if (type === 'floor_plan_style') {
          const roomDesc = roomName ? `for a ${roomName}` : '';
          const dimDesc = width && height ? `Dimensions: ${(width / 10).toFixed(1)}m x ${(height / 10).toFixed(1)}m. ` : '';
          prompt = `${stylePrompts[style] || stylePrompts.colorful} ${roomDesc} ${dimDesc} Professional quality, no text watermarks, publication ready.`;
        } else if (type === 'furnishing_render') {
          const styleName = furnishingStyles[style] || style;
          const room = roomType || '客厅';
          prompt =
            `Hyper-photorealistic interior rendering of a ${styleName} style ${room}. ` +
            `Eye-level perspective, ${width && height ? `room size approximately ${(width / 10).toFixed(1)}m x ${(height / 10).toFixed(1)}m` : 'spacious room'}. ` +
            'Complete furniture arrangement, premium materials and textures, warm natural lighting through windows, 8K resolution, architectural photography quality. Strictly NO text, NO labels, NO watermarks.';
        }

        try {
          let promptData: { prompt: string; negative_prompt?: string };
          if (process.env.MOCK_AI === 'true') {
            promptData = {
              prompt: 'Mock prompt for testing...',
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
              negativePrompt: promptData.negative_prompt,
              type,
              style,
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
          generation.errorMessage = aiError instanceof Error ? aiError.message : 'LongCat Prompt Generation Failed';
          await generation.save();

          return NextResponse.json({ success: false, error: 'AI 提示词生成失败 (LongCat)' }, { status: 502 });
        }
      }
    );
  } catch (error: unknown) {
    console.error('[AI Generate]', error);
    return NextResponse.json({ success: false, error: '服务器内部错误' }, { status: 500 });
  }
}
