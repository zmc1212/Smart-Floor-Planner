import type {
  AiWorkflowCategory,
  AiWorkflowSourceAssetRole,
  AiWorkflowStageKey,
} from './workflow-stages';

export type AiPresetType = 'floor_plan_style' | 'furnishing_style' | 'scenario';

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
  promptTemplateSecondStage?: string;
  negativePrompt: string;
  provider: 'pollinations';
  image: PollinationsImageConfig;
  workflowCategory?: AiWorkflowCategory;
  workflowStage?: AiWorkflowStageKey;
  sourceAssetRole?: AiWorkflowSourceAssetRole;
  nextRecommendedStage?: AiWorkflowStageKey;
  enabled: boolean;
  sortOrder: number;
}

const BASE_POLLINATIONS_CONFIG: PollinationsImageConfig = {
  model: 'flux',
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
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux' },
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
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux', quality: 'high' },
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
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux' },
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
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux' },
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
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux', quality: 'high' },
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
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux', quality: 'high' },
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
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux', quality: 'high' },
    enabled: true,
    sortOrder: 150,
  },
  {
    key: 'scenario_1',
    type: 'scenario',
    name: '选风格',
    description: '从毛坯图、手稿或彩平快速生成多风格方向对比板，适合首次沟通定方向。',
    icon: 'S1',
    previewClassName: 'from-blue-500 via-indigo-500 to-purple-500',
    promptTemplate:
      '请基于上传的毛坯图、现场手稿或彩平，生成一张用于家装首次谈单的风格方向对比板。输出 4 到 5 套明显不同但都适合家装落地的室内设计方向，例如现代、奶油、原木、轻奢、新中式。每个方向都需要体现软装搭配、材质语言、色彩氛围和灯光气质，并保持同一空间结构和镜头逻辑不变。整体画面采用一张高质感多方案对比板排版，适合给客户快速选风格，不需要施工深化信息。',
    negativePrompt: 'distorted walls, wrong perspective, messy, bad quality, low res, text, watermark',
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux', quality: 'high', mode: 'generation' },
    workflowCategory: 'main',
    workflowStage: 'direction',
    sourceAssetRole: 'rough_sketch',
    nextRecommendedStage: 'base_render',
    enabled: true,
    sortOrder: 201,
  },
  {
    key: 'scenario_2',
    type: 'scenario',
    name: '深化软装',
    description: '基于基准效果图只替换软装、材质和色调，保留硬装结构与镜头不变。',
    icon: 'S2',
    previewClassName: 'from-emerald-400 via-teal-500 to-cyan-500',
    promptTemplate:
      '以当前基准效果图为底图，严格保留原有硬装结构、空间布局、镜头视角和构图比例不变，只对家具、窗帘、地毯、灯具、墙地面材质和整体色调做软装深化。输出一张更适合家装成交的高质感软装版本图，强调真实可落地、材质统一、氛围完整，不要改动户型骨架和硬装轮廓。',
    negativePrompt: 'changed layout, altered hard finish, structural changes, bad proportions, distorted perspective',
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux', quality: 'high', mode: 'edit' },
    workflowCategory: 'main',
    workflowStage: 'soft_furnishing',
    sourceAssetRole: 'base_render',
    nextRecommendedStage: 'proposal_pack',
    enabled: true,
    sortOrder: 202,
  },
  {
    key: 'scenario_3_image',
    type: 'scenario',
    name: '九宫格漫游',
    description: '把定稿空间扩展成多视角九宫格，用于漫游展示和社群传播。',
    icon: 'S3',
    previewClassName: 'from-amber-400 via-orange-500 to-red-500',
    promptTemplate:
      '基于当前定稿效果图，在保持空间结构、设计风格、材质和灯光逻辑统一的前提下，生成一张 3x3 九宫格的空间分镜板。九张小图要从不同镜头展示客厅、餐厅、背景墙、软装细节和氛围角度，整体适合做空间漫游预览和朋友圈传播，版式整洁，画面高级。',
    negativePrompt: 'inconsistent style, changed layout, bad grid layout, blurry, low detail',
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux', quality: 'high', mode: 'generation' },
    workflowCategory: 'advanced',
    workflowStage: 'tour_board',
    sourceAssetRole: 'approved_render',
    enabled: true,
    sortOrder: 203,
  },
  {
    key: 'scenario_4',
    type: 'scenario',
    name: '生成提案',
    description: '把定稿效果图包装成适合客户汇报的提案板，包含情绪板、选型与空间亮点。',
    icon: 'S4',
    previewClassName: 'from-pink-400 via-rose-500 to-red-500',
    promptTemplate:
      '请基于当前定稿效果图生成一张专业家装提案板。提案板需要包含主视觉效果图、2 到 3 个辅助视角或局部亮点、软装与材质情绪板、主色调说明，以及精简的软装采购建议。整体排版要像设计师给客户汇报的提案页，重点突出可落地、好沟通、好转发，而不是施工图深化。',
    negativePrompt: 'messy text, unreadable, bad layout, low resolution, missing furniture',
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux', quality: 'high', mode: 'generation' },
    workflowCategory: 'main',
    workflowStage: 'proposal_pack',
    sourceAssetRole: 'approved_render',
    nextRecommendedStage: 'lighting',
    enabled: true,
    sortOrder: 204,
  },
  {
    key: 'scenario_5',
    type: 'scenario',
    name: '高端提案工具',
    description: '围绕单一设计元素生成更偏概念表达的高端展板，适合品牌提案和高端客户汇报。',
    icon: 'S5',
    previewClassName: 'from-violet-400 via-purple-500 to-fuchsia-500',
    promptTemplate:
      '请根据上传的核心设计元素图片，例如特色家具、异形造型或特定材质，推演生成一张更偏高端表达的室内设计概念展板。内容包括概念来源、材质色板、家具搭配建议和一张代表性空间效果图。整体要体现设计感和品牌表达，适合高端提案，但不需要强调施工深化。',
    negativePrompt: 'messy board, unorganized, artistic but impractical, bad text, architectural forms, low quality',
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux', quality: 'high', mode: 'generation' },
    workflowCategory: 'advanced',
    workflowStage: 'premium_board',
    sourceAssetRole: 'concept_element',
    enabled: true,
    sortOrder: 205,
  },
  {
    key: 'scenario_6',
    type: 'scenario',
    name: '出基准方案',
    description: '把毛坯图、线稿或彩平转成可复用的基准效果图，作为后续流程统一底图。',
    icon: 'S6',
    previewClassName: 'from-slate-500 via-gray-600 to-zinc-700',
    promptTemplate:
      '请把上传的毛坯图、模型线稿、简易手稿或彩平方案，转化为一张可作为后续工作底图的家装基准效果图。需要保留原始空间比例、门窗关系、主要结构和镜头逻辑不变，生成超写实但适合家装沟通的标准室内效果图。重点是得到一张稳定、可继续深化软装和提案包装的基准方案，不需要输出多风格拼板。',
    negativePrompt: 'changed layout, bad perspective, structural changes, unrealistic materials',
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux', quality: 'high', mode: 'edit' },
    workflowCategory: 'main',
    workflowStage: 'base_render',
    sourceAssetRole: 'rough_sketch',
    nextRecommendedStage: 'soft_furnishing',
    enabled: true,
    sortOrder: 206,
  },
  {
    key: 'scenario_7',
    type: 'scenario',
    name: '彩平转透视',
    description: '把彩平或户型图转成更适合客户理解的透视效果图。',
    icon: 'S7',
    previewClassName: 'from-cyan-400 via-sky-500 to-blue-500',
    promptTemplate:
      '请严格保留原有建筑外轮廓、门窗位置、出入口布局和户型动线，把上传的彩色平面图或户型图转换为一张更适合客户理解的室内透视效果图。要突出空间氛围、功能分区和陈设排布，整体更像谈单透视图，而不是技术制图。',
    negativePrompt: 'still a floor plan, wrong perspective, top down view, distorted walls, messy layout',
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux', quality: 'high', mode: 'edit' },
    workflowCategory: 'advanced',
    workflowStage: 'perspective_upgrade',
    sourceAssetRole: 'floor_plan',
    enabled: true,
    sortOrder: 207,
  },
  {
    key: 'scenario_8',
    type: 'scenario',
    name: '多风格 PK',
    description: '已并入选风格主流程，保留为独立多方案对比能力。',
    icon: 'S8',
    previewClassName: 'from-rose-400 via-pink-500 to-fuchsia-500',
    promptTemplate:
      '请在保持当前空间结构、镜头视角和构图比例不变的前提下，生成 5 种适合家装成交沟通的不同设计风格方案，并把它们整合成一张统一视角的对比展板。每套方案都要有独立的软装、材质、色彩和灯光氛围，重点是方便客户做风格选择。',
    negativePrompt: 'changed layout, inconsistent camera angle, bad layout, low resolution, messy colors',
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux', quality: 'high', mode: 'generation' },
    workflowCategory: 'advanced',
    workflowStage: 'direction',
    sourceAssetRole: 'rough_sketch',
    nextRecommendedStage: 'base_render',
    enabled: true,
    sortOrder: 208,
  },
  {
    key: 'scenario_9',
    type: 'scenario',
    name: '深化辅助工具',
    description: '把效果图拆成黑白线稿、立面与施工参考，用于后续设计深化。',
    icon: 'S9',
    previewClassName: 'from-zinc-300 via-stone-400 to-neutral-500',
    promptTemplate:
      '请分析当前效果图的空间结构和立面关系，生成一张偏黑白 CAD 风格的深化参考板，包含平面轮廓、主要立面、局部节点和线稿表达。重点是给设计师后续深化提供参考，不要输出营销向的效果图气质。',
    negativePrompt: 'colors, shading, gradients, photorealism, low contrast, messy lines, realistic furniture',
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux', quality: 'high', mode: 'edit' },
    workflowCategory: 'advanced',
    workflowStage: 'cad_detail',
    sourceAssetRole: 'approved_render',
    enabled: true,
    sortOrder: 209,
  },
  {
    key: 'scenario_10',
    type: 'scenario',
    name: '增强签单',
    description: '补充灯光分析、日夜景和灯具建议，在接近成交时强化专业背书。',
    icon: 'S10',
    previewClassName: 'from-yellow-400 via-amber-500 to-indigo-800',
    promptTemplate:
      '这个是空间室内白天效果图，现在你帮我分析下，如何做一个灯光设计，并且需要出灯光清单，色温分析，照度分析，并且出一个夜景效果图，现在你先帮我分析设计，然后再出个对应情绪版跟清单出来',
    promptTemplateSecondStage:
      '直接生成展板图片，把灯光设计分析，灯光清单，跟夜景效果图，罗列出来',
    negativePrompt: 'inconsistent layout, bad text, poor layout, blurry, low resolution',
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux', quality: 'high', mode: 'generation' },
    workflowCategory: 'main',
    workflowStage: 'lighting',
    sourceAssetRole: 'approved_render',
    enabled: true,
    sortOrder: 210,
  },
];
