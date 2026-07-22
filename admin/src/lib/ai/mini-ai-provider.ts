import { executeAiChat } from '@/lib/ai/execution-service';
import type { MiniAiTargetScope } from '@/lib/ai/mini-ai-floorplan';

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
  targetScope?: MiniAiTargetScope;
  usesFloorPlanControl?: boolean;
}

type ImageDimensions = { width?: number; height?: number };

const OUTPUT_SPECS = [
  { aspectRatio: '1:2', ratio: 1 / 2, vipSize: '768x1536' },
  { aspectRatio: '9:16', ratio: 9 / 16, vipSize: '720x1280' },
  { aspectRatio: '2:3', ratio: 2 / 3, vipSize: '1024x1536' },
  { aspectRatio: '3:4', ratio: 3 / 4, vipSize: '864x1152' },
  { aspectRatio: '4:5', ratio: 4 / 5, vipSize: '896x1120' },
  { aspectRatio: '1:1', ratio: 1, vipSize: '1024x1024' },
  { aspectRatio: '5:4', ratio: 5 / 4, vipSize: '1120x896' },
  { aspectRatio: '4:3', ratio: 4 / 3, vipSize: '1152x864' },
  { aspectRatio: '3:2', ratio: 3 / 2, vipSize: '1536x1024' },
  { aspectRatio: '16:9', ratio: 16 / 9, vipSize: '1280x720' },
  { aspectRatio: '2:1', ratio: 2, vipSize: '1536x768' },
  { aspectRatio: '21:9', ratio: 21 / 9, vipSize: '1456x624' },
] as const;

function isValidVipSize(dimensions?: ImageDimensions) {
  const width = Number(dimensions?.width);
  const height = Number(dimensions?.height);
  if (!(Number.isInteger(width) && Number.isInteger(height))) return false;
  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  const pixels = width * height;
  return width % 16 === 0
    && height % 16 === 0
    && longSide <= 3840
    && longSide / shortSide <= 3
    && pixels >= 655360
    && pixels <= 8294400;
}

function closestOutputSpec(dimensions?: ImageDimensions) {
  const width = Number(dimensions?.width);
  const height = Number(dimensions?.height);
  const fallback = OUTPUT_SPECS.find((item) => item.aspectRatio === '1:1')!;
  if (!(width > 0 && height > 0)) return { ...fallback, size: fallback.vipSize };
  const ratio = width / height;
  const spec = OUTPUT_SPECS.reduce((best, item) => (
    Math.abs(Math.log(ratio / item.ratio)) < Math.abs(Math.log(ratio / best.ratio)) ? item : best
  ));
  return {
    ...spec,
    size: isValidVipSize(dimensions) ? `${width}x${height}` : spec.vipSize,
  };
}

export function selectMiniAiOutputSpec(input: {
  mode: MiniAiRenderMode;
  targetScope?: MiniAiTargetScope;
  referenceDimensions?: ImageDimensions;
  spaceDimensions?: ImageDimensions;
}) {
  if (input.mode === 'floor_plan_render') {
    return input.targetScope === 'whole_floor_plan'
      ? closestOutputSpec({ width: 1, height: 1 })
      : closestOutputSpec({ width: 3, height: 2 });
  }
  return closestOutputSpec(input.mode === 'reference_recreate' ? input.referenceDimensions : input.spaceDimensions);
}

export function selectReferenceRecreateImageInputs(input: {
  controlImage?: string;
  referenceImage?: string;
  spaceImage?: string;
}) {
  const images = input.controlImage
    ? [input.controlImage, input.referenceImage]
    : [input.referenceImage, input.spaceImage];
  return images.filter((image): image is string => Boolean(image));
}

export function composeReferenceRecreatePrompt(
  referenceAnalysis: string,
  roomSummary = '',
  usesFloorPlanControl = false
) {
  if (usesFloorPlanControl) {
    return [
      'Image 1 is the measured floor-plan control image and the authoritative source for room geometry.',
      'Strictly preserve Image 1 wall topology, room boundary, proportions, door positions, window positions, and circulation. Do not invent, remove, or move structural elements.',
      'Image 2 is the design reference and the authoritative source for camera height, camera direction, focal length, perspective, framing, crop, furniture composition, materials, lighting, and visual style.',
      'Project the camera viewpoint and composition of Image 2 into the measured geometry of Image 1. Match Image 2 aspect ratio and framing; do not use the square control-image canvas as the output framing.',
      'If the two images conflict, preserve Image 1 structure first and approximate Image 2 camera and furniture arrangement within that structure.',
      'Produce an eye-level photorealistic interior, not a top-down floor plan, diagram, or drawing.',
      'Match the reference visual language described below.',
      referenceAnalysis,
      'Use natural lighting, coherent architectural scale, high material fidelity, no text, and no labels.',
      roomSummary,
    ].filter(Boolean).join(' ');
  }

  return [
    'Image 1 is the reference image and the primary composition canvas.',
    'Recreate Image 1 while strictly preserving its aspect ratio, crop, framing, camera position, focal length, perspective, room geometry, architectural boundaries, major object placement, and negative space.',
    'Do not crop, zoom, extend the canvas, reframe, rotate, or redesign the composition.',
    'Image 2 is the user space image. Use it only as secondary context for compatible room-specific details; it must not override Image 1 composition or camera.',
    'Match the reference visual language described below.',
    referenceAnalysis,
    'Produce a coherent photorealistic completed interior with natural lighting, high material fidelity, no text, and no labels.',
    roomSummary,
  ].filter(Boolean).join(' ');
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
    prompt = composeReferenceRecreatePrompt(
      referenceAnalysis,
      input.roomSummary,
      input.usesFloorPlanControl
    );
  } else if (input.mode === 'floor_plan_render') {
    if (!input.roomSummary) throw new Error('户型生成缺少有效的正式房间数据');
    if (input.targetScope === 'whole_floor_plan') {
      prompt = [
        input.stylePrompt || `Create a ${input.styleName || 'modern'} furnished whole-floor-plan rendering.`,
        'Transform the provided measured control drawing into one complete top-down orthographic furnished floor-plan visualization.',
        'Strictly preserve every wall, opening, room count, room adjacency, and the complete outer footprint. Do not crop out any room.',
        'Use practical furniture layouts, coherent scale, clear circulation, realistic materials, clean natural lighting, no text, and no labels.',
        'This is a concept visualization based on measured data, not a construction drawing.',
        input.roomSummary,
      ].join(' ');
    } else {
      prompt = [
        input.stylePrompt || `Create a ${input.styleName || 'modern'} interior concept rendering.`,
        'Generate a photorealistic eye-level interior concept for the single measured room described below.',
        'Respect the stated room dimensions, ceiling height, and opening count. Use coherent architectural scale, practical circulation, natural light, high material fidelity, no text, no labels.',
        'This is a concept visualization based on measured data; do not invent unusual structural features.',
        input.roomSummary,
      ].join(' ');
    }
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
