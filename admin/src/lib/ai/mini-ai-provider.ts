import { executeAiChat } from '@/lib/ai/execution-service';

export type MiniAiRenderMode =
  | 'reference_recreate'
  | 'style_transform'
  | 'floor_plan_render'
  | 'soft_furnishing';

export interface MiniAiPromptInput {
  enterpriseId: string;
  generationId: string;
  mode: MiniAiRenderMode;
  referenceImageUrl?: string;
  styleName?: string;
  stylePrompt?: string;
  roomSummary?: string;
}

export async function buildMiniAiRenderPrompt(input: MiniAiPromptInput) {
  let referenceAnalysis = '';
  let prompt = '';
  if (input.mode === 'reference_recreate') {
    if (!input.referenceImageUrl) throw new Error('复刻模式缺少参考图片');
    if (process.env.MOCK_AI === 'true') {
      referenceAnalysis = 'Modern interior with a restrained palette, natural materials, layered lighting, and coherent furniture.';
    } else {
      const result = await executeAiChat({
        enterpriseId: input.enterpriseId,
        generationId: input.generationId,
        logicalModelKey: 'vision.reference_analysis',
        temperature: 0.35,
        maxTokens: 500,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this interior reference image for image-to-image restyling. Return one concise English paragraph describing design style, color palette, materials, furniture language, lighting, and atmosphere. Do not describe the room geometry and do not add commentary.' },
            { type: 'image_url', image_url: { url: input.referenceImageUrl, detail: 'high' } },
          ],
        }],
      });
      referenceAnalysis = result.content;
    }
    prompt = [
      'Restyle the provided real room photo using the visual language below.',
      referenceAnalysis,
      'Strictly preserve the original room geometry, camera position, perspective, doors, windows, wall openings, ceiling height, and structural boundaries.',
      'Replace only finishes, furniture, lighting fixtures, textiles, and decoration. Produce a coherent photorealistic completed interior, natural lighting, high material fidelity, no text, no labels.',
      input.roomSummary || '',
    ].filter(Boolean).join(' ');
  } else if (input.mode === 'floor_plan_render') {
    if (!input.roomSummary) throw new Error('户型生成缺少有效的正式房间数据');
    prompt = [
      input.stylePrompt || `Create a ${input.styleName || 'modern'} interior concept rendering.`,
      'Generate a photorealistic eye-level interior concept for the measured room described below.',
      'Respect the stated room dimensions and opening count. Use coherent architectural scale, practical circulation, natural light, high material fidelity, no text, no labels.',
      'This is a concept visualization based on measured data; do not invent unusual structural features.',
      input.roomSummary,
    ].join(' ');
  } else if (input.mode === 'soft_furnishing') {
    prompt = [
      input.stylePrompt || `Refine this room with ${input.styleName || 'modern'} soft furnishings.`,
      'Change only movable furniture, rugs, curtains, cushions, artwork, plants, decorative objects, and decorative lighting in the provided real room photo.',
      'Strictly preserve camera position, perspective, walls, ceiling, floor, doors, windows, built-in cabinets, fixed finishes, and all structural boundaries.',
      'Create a professionally styled, practical, photorealistic interior with coherent scale and natural material texture. No text, no labels.',
      input.roomSummary || '',
    ].filter(Boolean).join(' ');
  } else {
    prompt = [
      input.stylePrompt || `Create a ${input.styleName || 'modern'} interior design.`,
      'Apply this style to the provided real room photo while strictly preserving its geometry, camera position, perspective, doors, windows, wall openings, and structural boundaries.',
      'Change finishes, furniture, lighting, textiles, and decoration only. Photorealistic architectural photography, coherent scale, natural light, no text, no labels.',
      input.roomSummary || '',
    ].filter(Boolean).join(' ');
  }
  return { prompt, referenceAnalysis };
}
