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
  negativePrompt: string;
  provider: 'pollinations';
  image: PollinationsImageConfig;
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
    name: '十景风格长图',
    description: '毛坯手稿一键生成10种风格方案并拼成长图。',
    icon: 'S1',
    previewClassName: 'from-blue-500 via-indigo-500 to-purple-500',
    promptTemplate:
      '这是一张毛坯房客厅的室内设计手稿，请严格按照手稿的空间结构、户型布局、构图比例和镜头视角不变，生成10张同构图、同视角、同比例的客厅装修效果图；分别采用现代风格、奶油风格、托斯卡纳风、南洋复古风、宋氏美学、自然主义、法式田园风、原木风、包豪斯风格、孟菲斯风格。每张图完整包含软装搭配、材质组合、灯光氛围、色彩体系与空间逻辑，10张风格图拼成对比长图，整体超写实建筑摄影质感、8K高清、细节拉满、真实光影还原。',
    negativePrompt: 'distorted walls, wrong perspective, messy, bad quality, low res',
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux', quality: 'high', mode: 'generation' },
    enabled: true,
    sortOrder: 201,
  },
  {
    key: 'scenario_2',
    type: 'scenario',
    name: '保留硬装换软装',
    description: '保留硬装，仅替换软装、材质与全屋色调。',
    icon: 'S2',
    previewClassName: 'from-emerald-400 via-teal-500 to-cyan-500',
    promptTemplate:
      '以图1室内效果图为基底，严格保留原有硬装结构、空间布局、构图视角完全不变；参照图2的软装款式、家具造型、墙体地面材质、整体色调与搭配逻辑，全屋同步替换软装及材质，不改动户型与硬装轮廓。输出效果为超写实建筑摄影、8K分辨率、细节精致、光影自然，整体构图比例、镜头角度与原图保持一致。',
    negativePrompt: 'changed layout, altered hard finish, structural changes, bad proportions',
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux', quality: 'high', mode: 'edit' },
    enabled: true,
    sortOrder: 202,
  },
  {
    key: 'scenario_3_image',
    type: 'scenario',
    name: '九宫格分镜',
    description: '单图生成九宫格多视角。',
    icon: 'S3',
    previewClassName: 'from-amber-400 via-orange-500 to-red-500',
    promptTemplate:
      '基于上传的室内效果图，在保持空间结构、设计风格、材质灯光完全统一的前提下，生成9张不同拍摄角度、不同特色镜头的空间分镜图；9张图片按3×3格式拼接为整张大图，单张分镜比例6:9，整体画面超写实、建筑摄影级质感、8K高清、细节高度还原，空间风格与原图无偏差。',
    negativePrompt: 'inconsistent style, changed layout, bad grid layout',
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux', quality: 'high', mode: 'generation' },
    enabled: true,
    sortOrder: 203,
  },
  {
    key: 'scenario_4',
    type: 'scenario',
    name: '清单情绪板',
    description: '自动生成软装清单+材质情绪板。',
    icon: 'S4',
    previewClassName: 'from-pink-400 via-rose-500 to-red-500',
    promptTemplate:
      '深度分析这张室内效果图里所有软装家具、灯具、装饰摆件、布艺饰品与地面墙面材质，整理一份专业完整的软装配置清单，标注物品品类、材质、色彩、风格适配；同时制作一张高级设计感的材质色彩情绪板，分类呈现主材、软装面料、配色体系，排版整洁、适合设计提案使用。',
    negativePrompt: 'messy text, unreadable, bad layout',
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux', quality: 'high', mode: 'generation' },
    enabled: true,
    sortOrder: 204,
  },
  {
    key: 'scenario_5',
    type: 'scenario',
    name: '概念设计展板',
    description: '单一元素推演整套概念方案展板。',
    icon: 'S5',
    previewClassName: 'from-violet-400 via-purple-500 to-fuchsia-500',
    promptTemplate:
      '根据上传的设计元素图形，推演生成整套室内空间竞赛概念设计展板，完整包含：概念来源形态分析、手绘概念草图、设计演变过程、材质纹理情绪板、结构技术线稿、空间拆解示意图、最终写实效果图；同步衍生对应的平面图、立面图、剖面图，整体按专业设计展板版式编排，加入标题与文字标签，风格统一、排版高级、适合方案汇报。',
    negativePrompt: 'messy board, unorganized, bad text, low quality',
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux', quality: 'high', mode: 'generation' },
    enabled: true,
    sortOrder: 205,
  },
  {
    key: 'scenario_6',
    type: 'scenario',
    name: '草图转写实',
    description: '模型草图反推写实图及提示词。',
    icon: 'S6',
    previewClassName: 'from-slate-500 via-gray-600 to-zinc-700',
    promptTemplate:
      '将上传的室内模型线稿/简易模型图，升级改造为超写实建筑摄影级效果图，还原真实物理材质、自然光影、环境氛围与细节纹理，8K超清、空间比例结构不变；同时基于这张写实效果图，反向推理生成一套专业、可复用的室内设计生图标准提示词，适配同类型空间反复使用。',
    negativePrompt: 'changed layout, bad perspective, structural changes',
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux', quality: 'high', mode: 'edit' },
    enabled: true,
    sortOrder: 206,
  },
  {
    key: 'scenario_7',
    type: 'scenario',
    name: '彩平转透视',
    description: '彩平图切换风格转室内透视。',
    icon: 'S7',
    previewClassName: 'from-cyan-400 via-sky-500 to-blue-500',
    promptTemplate:
      '将上传的彩色平面图，切换为现代设计风格，并固定一个透视视角，直接生成室内透视效果图。要求真实物理材质、自然光影环境、空间比例结构不变。',
    negativePrompt: 'still a floor plan, wrong perspective, top down view',
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux', quality: 'high', mode: 'edit' },
    enabled: true,
    sortOrder: 207,
  },
  {
    key: 'scenario_8',
    type: 'scenario',
    name: '多风格PK板',
    description: '同一空间多风格对比展板。',
    icon: 'S8',
    previewClassName: 'from-rose-400 via-pink-500 to-fuchsia-500',
    promptTemplate:
      '基于同一个室内空间图，生成5种不同设计风格（现代、北欧、法式、新中式、极简）的方案，并保持完全统一的摄影视角和空间构图，将这5张图排版成对比展板。',
    negativePrompt: 'changed layout, inconsistent camera angle, bad layout',
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux', quality: 'high', mode: 'generation' },
    enabled: true,
    sortOrder: 208,
  },
  {
    key: 'scenario_9',
    type: 'scenario',
    name: '图转线稿',
    description: '写实效果图转施工立面线稿。',
    icon: 'S9',
    previewClassName: 'from-zinc-300 via-stone-400 to-neutral-500',
    promptTemplate:
      '将这张写实效果图转换为纯正的黑白线稿、立面施工图风格。保留原有的一切空间轮廓和家具结构边缘，去除所有色彩、光影、环境光，仅以CAD线宽层次表达，适合导入CAD进行微调。',
    negativePrompt: 'colors, shading, gradients, photorealism, low contrast',
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux', quality: 'high', mode: 'edit' },
    enabled: true,
    sortOrder: 209,
  },
  {
    key: 'scenario_10',
    type: 'scenario',
    name: '光影灯光',
    description: '日夜景对比、光影分析及灯具清单。',
    icon: 'S10',
    previewClassName: 'from-yellow-400 via-amber-500 to-indigo-800',
    promptTemplate:
      '生成此空间场景的日间自然光版本与夜间人工照明版本的双重对比图；并附带详细的光影分析以及对应的灯光布局方案和灯具型号清单。',
    negativePrompt: 'inconsistent layout, bad text, poor layout',
    provider: 'pollinations',
    image: { ...BASE_POLLINATIONS_CONFIG, model: 'flux', quality: 'high', mode: 'generation' },
    enabled: true,
    sortOrder: 210,
  },
];
