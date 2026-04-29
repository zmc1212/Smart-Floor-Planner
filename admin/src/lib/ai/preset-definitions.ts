export type AiPresetType = 'floor_plan_style' | 'furnishing_render';

export interface TensorControlnetConfig {
  enabled: boolean;
  preprocessor: string;
  model: string;
  weight: number;
  guidanceStart?: number;
  guidanceEnd?: number;
}

export interface TensorProviderConfig {
  modelKey: string;
  modelId: string;
  width: number;
  height: number;
  steps: number;
  cfgScale: number;
  sampler: string;
  scheduler?: string;
  guidance?: number;
  clipSkip?: number;
  denoisingStrength?: number;
  vae?: string;
  controlnet?: TensorControlnetConfig;
}

export interface DefaultAiStylePreset {
  key: string;
  type: AiPresetType;
  name: string;
  description: string;
  icon: string;
  previewClassName: string;
  mockImageUrl?: string;
  promptTemplate: string;
  negativePrompt: string;
  provider: 'tensor';
  tensor: TensorProviderConfig;
  enabled: boolean;
  sortOrder: number;
}

export const DEFAULT_AI_STYLE_PRESETS: DefaultAiStylePreset[] = [
  {
    key: 'colorful',
    type: 'floor_plan_style',
    name: '彩色风格',
    description: '彩色室内平面，适合销售展示和方案沟通。',
    icon: 'CP',
    previewClassName: 'from-pink-400 via-purple-400 to-blue-400',
    mockImageUrl: '/colorful.png',
    promptTemplate:
      'top-down 3d floor plan render, architectural floor plan visualization, dollhouse view, isometric interior layout, preserve the exact room layout from the reference image, accurate wall placement, accurate door placement, accurate window placement, realistic apartment floor plan, fully furnished rooms, living room, bedroom, kitchen, bathroom, dining area, clean modern interior design, realistic materials, wood floor, white walls, soft natural lighting, architectural visualization, high detail',
    negativePrompt:
      'EasyNegative, wrong layout, changed floor plan, extra room, missing room, extra door, extra window, distorted walls, curved walls, broken floor plan, perspective interior view, eye-level camera, people, text, watermark, blurry, low detail, surreal',
    provider: 'tensor',
    tensor: {
      modelKey: 'vision_realistic_fp16_v3',
      modelId: '701982267016309424',
      width: 640,
      height: 640,
      steps: 20,
      cfgScale: 7,
      sampler: 'Euler',
      scheduler: 'normal',
      guidance: 3.5,
      clipSkip: 2,
      denoisingStrength: 0,
      vae: 'vae-ft-mse-840000-ema-pruned.ckpt',
      controlnet: {
        enabled: true,
        preprocessor: 'canny',
        model: 'control_v11p_sd15_canny',
        weight: 1,
        guidanceStart: 0,
        guidanceEnd: 1,
      },
    },
    enabled: true,
    sortOrder: 10,
  },
  {
    key: 'cad',
    type: 'floor_plan_style',
    name: 'CAD 风格',
    description: '黑白线稿和尺寸信息更强，适合技术沟通。',
    icon: 'CAD',
    previewClassName: 'from-zinc-700 via-zinc-500 to-zinc-400',
    mockImageUrl: '/cad.png',
    promptTemplate:
      'professional CAD style apartment floor plan, top-down orthographic plan, preserve the exact room layout from the reference image, accurate wall placement, accurate door swings, accurate window placement, clean black and white linework, technical drafting presentation, neat hatching, architectural blueprint aesthetic, dimension-ready visual, high precision floor plan rendering',
    negativePrompt:
      'EasyNegative, colorful rendering, photorealistic interior, perspective view, extra rooms, wrong door position, wrong window position, distorted walls, text watermark, messy shading, blurry',
    provider: 'tensor',
    tensor: {
      modelKey: 'vision_realistic_fp16_v3',
      modelId: '701982267016309424',
      width: 640,
      height: 640,
      steps: 20,
      cfgScale: 7,
      sampler: 'Euler',
      scheduler: 'normal',
      guidance: 3.5,
      clipSkip: 2,
      denoisingStrength: 0,
      vae: 'vae-ft-mse-840000-ema-pruned.ckpt',
      controlnet: {
        enabled: true,
        preprocessor: 'canny',
        model: 'control_v11p_sd15_canny',
        weight: 1,
        guidanceStart: 0,
        guidanceEnd: 1,
      },
    },
    enabled: true,
    sortOrder: 20,
  },
  {
    key: '3d',
    type: 'floor_plan_style',
    name: '3D 风格',
    description: '俯视剖切视图，更接近营销效果图。',
    icon: '3D',
    previewClassName: 'from-cyan-400 via-blue-500 to-indigo-500',
    mockImageUrl: '/3d.png',
    promptTemplate:
      'top-down 3d cutaway floor plan render, dollhouse apartment visualization, preserve the exact room layout from the reference image, accurate walls, accurate doors, accurate windows, furnished apartment plan, photorealistic materials, warm daylight, architectural visualization, miniature diorama look, high detail',
    negativePrompt:
      'EasyNegative, eye-level perspective, wrong layout, extra room, extra door, extra window, distorted geometry, broken walls, people, text, watermark, blurry',
    provider: 'tensor',
    tensor: {
      modelKey: 'vision_realistic_fp16_v3',
      modelId: '701982267016309424',
      width: 640,
      height: 640,
      steps: 20,
      cfgScale: 7,
      sampler: 'Euler',
      scheduler: 'normal',
      guidance: 3.5,
      clipSkip: 2,
      denoisingStrength: 0,
      vae: 'vae-ft-mse-840000-ema-pruned.ckpt',
      controlnet: {
        enabled: true,
        preprocessor: 'canny',
        model: 'control_v11p_sd15_canny',
        weight: 1,
        guidanceStart: 0,
        guidanceEnd: 1,
      },
    },
    enabled: true,
    sortOrder: 30,
  },
  {
    key: 'handdrawn',
    type: 'floor_plan_style',
    name: '手绘风格',
    description: '偏草图表达，适合前期方案演示。',
    icon: 'SK',
    previewClassName: 'from-amber-300 via-orange-300 to-rose-300',
    mockImageUrl: '/handdrawn.png',
    promptTemplate:
      'hand-drawn architectural floor plan illustration, preserve the exact room layout from the reference image, top-down apartment plan, clean room zoning, sketch linework, watercolor fills, designer presentation board style, warm paper texture feeling, furniture hints, high detail',
    negativePrompt:
      'EasyNegative, photorealistic camera perspective, wrong layout, extra room, extra window, extra door, distorted walls, messy scribbles, watermark, blurry',
    provider: 'tensor',
    tensor: {
      modelKey: 'vision_realistic_fp16_v3',
      modelId: '701982267016309424',
      width: 640,
      height: 640,
      steps: 20,
      cfgScale: 7,
      sampler: 'Euler',
      scheduler: 'normal',
      guidance: 3.5,
      clipSkip: 2,
      denoisingStrength: 0,
      vae: 'vae-ft-mse-840000-ema-pruned.ckpt',
      controlnet: {
        enabled: true,
        preprocessor: 'canny',
        model: 'control_v11p_sd15_canny',
        weight: 1,
        guidanceStart: 0,
        guidanceEnd: 1,
      },
    },
    enabled: true,
    sortOrder: 40,
  },
];
