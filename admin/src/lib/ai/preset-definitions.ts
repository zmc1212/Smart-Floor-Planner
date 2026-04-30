export type AiPresetType = 'floor_plan_style' | 'furnishing_style';

export type PollinationsImageMode = 'generation' | 'edit';

export interface PollinationsImageConfig {
  model: string;
  size: string;
  quality: 'standard' | 'hd' | 'low' | 'medium' | 'high';
  mode: PollinationsImageMode;
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
  provider: 'pollinations';
  image: PollinationsImageConfig;
  enabled: boolean;
  sortOrder: number;
}

const BASE_POLLINATIONS_CONFIG: PollinationsImageConfig = {
  model: 'gptimage',
  size: '1024x1024',
  quality: 'medium',
  mode: 'edit',
};

const FLOOR_PLAN_NEGATIVE =
  'wrong layout, changed floor plan, extra room, missing room, extra door, extra window, distorted walls, curved walls, broken floor plan, perspective interior view, eye-level camera, people, text, watermark, blurry, low detail, surreal';

const FURNISHING_BASE =
  'top-down 3d floor plan render, architectural floor plan visualization, dollhouse view, isometric interior layout, preserve the exact room layout from the reference image, accurate wall placement, accurate door placement, accurate window placement, realistic apartment floor plan, fully furnished rooms';

const FURNISHING_NEGATIVE =
  'wrong layout, changed floor plan, extra room, missing room, extra door, extra window, distorted walls, curved walls, broken floor plan, empty room, missing furniture, eye-level camera, people, text, watermark, blurry, low detail, surreal';

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
      'top-down colored floor plan render, architectural floor plan visualization, preserve the exact room layout from the reference image, accurate wall placement, accurate door placement, accurate window placement, orthographic interior layout, clean apartment floor plan, clearly separated room zones with soft pastel colors, living room, bedroom, kitchen, bathroom, dining area, simple furniture symbols, white background, neat shadows, modern sales presentation board style, high clarity, high detail',
    negativePrompt: FLOOR_PLAN_NEGATIVE,
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'nanobanana-pro' },
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
      'professional CAD style apartment floor plan, top-down orthographic plan, preserve the exact room layout from the reference image, accurate wall placement, accurate door swings, accurate window placement, precise black and white linework, clean architectural drafting, technical drawing presentation, wall outlines, door arc symbols, window symbols, neat hatch details, high precision, white background, blueprint-like floor plan rendering',
    negativePrompt:
      'photorealistic interior, perspective rendering, colorful shading, extra room, wrong door position, wrong window position, distorted walls, messy sketch, people, text, watermark, blurry',
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux' },
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
      'top-down 3d floor plan render, architectural floor plan visualization, dollhouse view, isometric interior layout, preserve the exact room layout from the reference image, accurate wall placement, accurate door placement, accurate window placement, realistic apartment floor plan, fully furnished rooms, living room, bedroom, kitchen, bathroom, dining area, clean modern interior design, realistic materials, wood floor, white walls, soft natural lighting, architectural visualization, high detail',
    negativePrompt: FLOOR_PLAN_NEGATIVE,
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'gptimage-large', size: '1536x1024', quality: 'high' },
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
      'hand-drawn architectural floor plan illustration, top-down apartment plan, preserve the exact room layout from the reference image, accurate wall placement, accurate door placement, accurate window placement, sketch linework, watercolor room zoning, soft artistic presentation, furniture hints, warm paper texture feeling, designer concept board style, clean composition, high detail',
    negativePrompt:
      'wrong layout, extra room, missing room, extra door, extra window, distorted walls, photorealistic render, 3d perspective, messy scribbles, people, watermark, blurry',
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux', quality: 'low' },
    enabled: true,
    sortOrder: 40,
  },
  {
    key: 'modern',
    type: 'furnishing_style',
    name: '现代简约',
    description: '白墙、木地板、干净线条和克制家具。',
    icon: 'MD',
    previewClassName: 'from-slate-400 via-zinc-400 to-neutral-500',
    mockImageUrl: '',
    promptTemplate:
      `${FURNISHING_BASE}, modern minimalist interior decoration, white walls, light wood flooring, clean furniture arrangement, simple sofa and dining set, uncluttered space, soft daylight, realistic materials, architectural visualization, high detail`,
    negativePrompt: FURNISHING_NEGATIVE,
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'gptimage' },
    enabled: true,
    sortOrder: 110,
  },
  {
    key: 'nordic',
    type: 'furnishing_style',
    name: '北欧风',
    description: '浅木色、柔和布艺、自然光和温和留白。',
    icon: 'NO',
    previewClassName: 'from-sky-200 via-emerald-200 to-stone-300',
    mockImageUrl: '',
    promptTemplate:
      `${FURNISHING_BASE}, nordic Scandinavian interior style, pale oak flooring, soft fabric furniture, warm white walls, plants, natural daylight, cozy rugs, simple elegant furniture, realistic apartment furnishing, high detail`,
    negativePrompt: FURNISHING_NEGATIVE,
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'nanobanana-pro' },
    enabled: true,
    sortOrder: 120,
  },
  {
    key: 'cream',
    type: 'furnishing_style',
    name: '奶油风',
    description: '暖白、柔和材质、圆润家具和轻盈氛围。',
    icon: 'CR',
    previewClassName: 'from-amber-100 via-orange-100 to-stone-200',
    mockImageUrl: '',
    promptTemplate:
      `${FURNISHING_BASE}, cream style interior decoration, warm ivory palette, rounded furniture, soft upholstery, gentle lighting, light oak floor, cozy minimalist home, elegant soft textures, high detail architectural visualization`,
    negativePrompt: FURNISHING_NEGATIVE,
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'gptimage', quality: 'high' },
    enabled: true,
    sortOrder: 130,
  },
  {
    key: 'luxury',
    type: 'furnishing_style',
    name: '轻奢风',
    description: '大理石、金属线条、高级灰和精致软装。',
    icon: 'LX',
    previewClassName: 'from-zinc-500 via-stone-400 to-amber-300',
    mockImageUrl: '',
    promptTemplate:
      `${FURNISHING_BASE}, light luxury interior design, marble texture, champagne metal accents, elegant gray palette, refined furniture arrangement, premium lighting, polished materials, high-end apartment visualization, high detail`,
    negativePrompt: FURNISHING_NEGATIVE,
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'gptimage-large', size: '1536x1024', quality: 'high' },
    enabled: true,
    sortOrder: 140,
  },
  {
    key: 'new_chinese',
    type: 'furnishing_style',
    name: '新中式',
    description: '木饰面、东方家具、留白和沉稳材质。',
    icon: 'CN',
    previewClassName: 'from-red-500 via-amber-500 to-stone-500',
    mockImageUrl: '',
    promptTemplate:
      `${FURNISHING_BASE}, modern new Chinese interior style, warm wood veneer, oriental furniture, calm neutral palette, elegant screen details, balanced negative space, refined dining and living furniture, realistic materials, high detail`,
    negativePrompt: FURNISHING_NEGATIVE,
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'nanobanana-pro', quality: 'high' },
    enabled: true,
    sortOrder: 150,
  },
];
