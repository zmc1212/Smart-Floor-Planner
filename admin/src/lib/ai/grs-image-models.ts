export const GRS_IMAGE_CATALOG_VERSION = '2026-06-29';

export const GRS_STANDARD_RATIOS = [
  'auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3',
  '5:4', '4:5', '21:9', '9:21', '1:2', '2:1',
] as const;

export const GRS_NANO_RATIOS = [
  'auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3',
  '5:4', '4:5', '21:9',
] as const;

export const GRS_NANO_2_EXTRA_RATIOS = ['1:4', '4:1', '1:8', '8:1'] as const;
export const GRS_RESOLUTION_TIERS = ['1K', '2K', '4K'] as const;
export type GrsResolutionTier = (typeof GRS_RESOLUTION_TIERS)[number] | 'CUSTOM';
export type GrsImageModelFamily = 'gpt-image-2' | 'gpt-image-2-vip' | 'nano-banana' | 'nano-banana-2';

export type GrsImageModelDefinition = {
  model: string;
  name: string;
  family: GrsImageModelFamily;
  aspectRatios: string[];
  resolutionTiers: GrsResolutionTier[];
  supportsCustomSize: boolean;
  defaultAspectRatio: string;
  defaultResolutionTier: GrsResolutionTier;
  maxReferenceImages: number;
};

const VIP_SIZE_TABLE: Record<string, Partial<Record<Exclude<GrsResolutionTier, 'CUSTOM'>, string>>> = {
  '1:1': { '1K': '1024x1024', '2K': '2048x2048', '4K': '2880x2880' },
  '16:9': { '1K': '1280x720', '2K': '2048x1152', '4K': '3840x2160' },
  '9:16': { '1K': '720x1280', '2K': '1152x2048', '4K': '2160x3840' },
  '4:3': { '1K': '1152x864', '2K': '2304x1728', '4K': '3264x2448' },
  '3:4': { '1K': '864x1152', '2K': '1728x2304', '4K': '2448x3264' },
  '3:2': { '1K': '1536x1024', '2K': '2048x1360', '4K': '3504x2336' },
  '2:3': { '1K': '1024x1536', '2K': '1360x2048', '4K': '2336x3504' },
  '5:4': { '1K': '1120x896', '2K': '2240x1792', '4K': '3200x2560' },
  '4:5': { '1K': '896x1120', '2K': '1792x2240', '4K': '2560x3200' },
  '21:9': { '1K': '1456x624', '2K': '2912x1248', '4K': '3840x1648' },
  '9:21': { '1K': '624x1456', '2K': '1248x2912', '4K': '1648x3840' },
  '1:3': { '2K': '688x2048', '4K': '1280x3840' },
  '3:1': { '2K': '2048x688', '4K': '3840x1280' },
  '2:1': { '1K': '1536x768', '2K': '3072x1536', '4K': '3840x1920' },
  '1:2': { '1K': '768x1536', '2K': '1536x3072', '4K': '1920x3840' },
};

const STANDARD_PIXEL_TO_RATIO: Record<string, string> = {
  '1024x1024': '1:1',
  '1672x941': '16:9',
  '941x1672': '9:16',
  '1443x1090': '4:3',
  '1090x1443': '3:4',
  '1536x1024': '3:2',
  '1024x1536': '2:3',
  '1408x1120': '5:4',
  '1120x1408': '4:5',
  '1920x832': '21:9',
  '832x1920': '9:21',
  '896x1792': '1:2',
  '1792x896': '2:1',
};

const NANO_BASE_MODELS = [
  ['nano-banana', 'Nano Banana'],
  ['nano-banana-fast', 'Nano Banana Fast'],
  ['nano-banana-pro', 'Nano Banana Pro'],
  ['nano-banana-pro-vt', 'Nano Banana Pro VT'],
  ['nano-banana-pro-cl', 'Nano Banana Pro CL'],
  ['nano-banana-pro-vip', 'Nano Banana Pro VIP'],
  ['nano-banana-pro-4k-vip', 'Nano Banana Pro 4K VIP'],
] as const;

const NANO_2_MODELS = [
  ['nano-banana-2', 'Nano Banana 2'],
  ['nano-banana-2-cl', 'Nano Banana 2 CL'],
  ['nano-banana-2-2k-cl', 'Nano Banana 2 2K CL'],
  ['nano-banana-2-4k-cl', 'Nano Banana 2 4K CL'],
] as const;

export const GRS_IMAGE_MODEL_CATALOG: GrsImageModelDefinition[] = [
  {
    model: 'gpt-image-2',
    name: 'GPT Image 2',
    family: 'gpt-image-2',
    aspectRatios: [...GRS_STANDARD_RATIOS],
    resolutionTiers: ['1K'],
    supportsCustomSize: false,
    defaultAspectRatio: '1:1',
    defaultResolutionTier: '1K',
    maxReferenceImages: 10,
  },
  {
    model: 'gpt-image-2-vip',
    name: 'GPT Image 2 VIP',
    family: 'gpt-image-2-vip',
    aspectRatios: ['auto', ...Object.keys(VIP_SIZE_TABLE)],
    resolutionTiers: ['1K', '2K', '4K', 'CUSTOM'],
    supportsCustomSize: true,
    defaultAspectRatio: '1:1',
    defaultResolutionTier: '1K',
    maxReferenceImages: 10,
  },
  ...NANO_BASE_MODELS.map(([model, name]): GrsImageModelDefinition => ({
    model,
    name,
    family: 'nano-banana',
    aspectRatios: [...GRS_NANO_RATIOS],
    resolutionTiers: [...GRS_RESOLUTION_TIERS],
    supportsCustomSize: false,
    defaultAspectRatio: '1:1',
    defaultResolutionTier: '1K',
    maxReferenceImages: 10,
  })),
  ...NANO_2_MODELS.map(([model, name]): GrsImageModelDefinition => ({
    model,
    name,
    family: 'nano-banana-2',
    aspectRatios: [...GRS_NANO_RATIOS, ...GRS_NANO_2_EXTRA_RATIOS],
    resolutionTiers: [...GRS_RESOLUTION_TIERS],
    supportsCustomSize: false,
    defaultAspectRatio: '1:1',
    defaultResolutionTier: '1K',
    maxReferenceImages: 10,
  })),
];

const MODEL_BY_ID = new Map(GRS_IMAGE_MODEL_CATALOG.map((definition) => [definition.model, definition]));

export function getGrsImageModelDefinition(model: string) {
  return MODEL_BY_ID.get(model);
}

export function listGrsImageModelIds() {
  return GRS_IMAGE_MODEL_CATALOG.map((definition) => definition.model);
}

export function getGrsAspectRatiosForTier(model: string, tier: GrsResolutionTier) {
  const definition = getGrsImageModelDefinition(model);
  if (!definition) return [];
  if (definition.family !== 'gpt-image-2-vip') return [...definition.aspectRatios];
  if (tier === 'CUSTOM') return [];
  return [
    'auto',
    ...Object.entries(VIP_SIZE_TABLE)
      .filter(([, presets]) => Boolean(presets[tier]))
      .map(([ratio]) => ratio),
  ];
}

export function validateVipCustomSize(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height)) throw new Error('自定义宽高必须是整数');
  if (width <= 0 || height <= 0 || width > 3840 || height > 3840) throw new Error('自定义宽高必须在 1-3840px 之间');
  if (width % 16 !== 0 || height % 16 !== 0) throw new Error('自定义宽高必须是 16 的倍数');
  const ratio = Math.max(width, height) / Math.min(width, height);
  if (ratio > 3) throw new Error('自定义尺寸的长短边比例不能超过 3:1');
  const pixels = width * height;
  if (pixels < 655360 || pixels > 8294400) throw new Error('自定义尺寸总像素必须在 655360-8294400 之间');
  return `${width}x${height}`;
}

function normalizeTier(value: unknown, definition: GrsImageModelDefinition): GrsResolutionTier {
  const tier = String(value || '').toUpperCase() as GrsResolutionTier;
  return definition.resolutionTiers.includes(tier) ? tier : definition.defaultResolutionTier;
}

function ratioFromDimensions(value: string) {
  const match = value.match(/^(\d+)x(\d+)$/i);
  if (!match) return undefined;
  let width = Number(match[1]);
  let height = Number(match[2]);
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const divisor = gcd(width, height);
  width /= divisor;
  height /= divisor;
  return `${width}:${height}`;
}

export function resolveGrsImageParameters(input: {
  model: string;
  aspectRatio?: string;
  resolutionTier?: string;
  width?: number;
  height?: number;
  legacySize?: string;
  legacyQuality?: string;
}) {
  const definition = getGrsImageModelDefinition(input.model);
  if (!definition) throw new Error(`不支持的 GRS 生图模型：${input.model}`);
  const legacySize = String(input.legacySize || '').trim();
  const requestedRatio = String(input.aspectRatio || '').trim();

  if (definition.family === 'gpt-image-2') {
    const aspectRatio = definition.aspectRatios.includes(requestedRatio)
      ? requestedRatio
      : STANDARD_PIXEL_TO_RATIO[requestedRatio]
        ? requestedRatio
        : STANDARD_PIXEL_TO_RATIO[legacySize]
          ? legacySize
          : definition.defaultAspectRatio;
    return { aspectRatio, resolutionTier: '1K' as const };
  }

  if (definition.family === 'gpt-image-2-vip') {
    const tier = normalizeTier(input.resolutionTier || input.legacyQuality, definition);
    if (tier === 'CUSTOM') {
      return {
        aspectRatio: validateVipCustomSize(Number(input.width), Number(input.height)),
        resolutionTier: tier,
        width: Number(input.width),
        height: Number(input.height),
      };
    }
    if (/^\d+x\d+$/i.test(legacySize) && !input.resolutionTier) {
      const match = legacySize.match(/^(\d+)x(\d+)$/i);
      return {
        aspectRatio: validateVipCustomSize(Number(match?.[1]), Number(match?.[2])),
        resolutionTier: 'CUSTOM' as const,
        width: Number(match?.[1]),
        height: Number(match?.[2]),
      };
    }
    const aspectRatio = definition.aspectRatios.includes(requestedRatio) ? requestedRatio : definition.defaultAspectRatio;
    const presetRatio = aspectRatio === 'auto' ? '1:1' : aspectRatio;
    const pixelSize = VIP_SIZE_TABLE[presetRatio]?.[tier];
    if (!pixelSize) throw new Error(`${aspectRatio} 不支持 ${tier} 分辨率`);
    return { aspectRatio: pixelSize, resolutionTier: tier, selectedAspectRatio: aspectRatio };
  }

  const tier = normalizeTier(input.resolutionTier || input.legacyQuality, definition);
  const derivedRatio = ratioFromDimensions(legacySize);
  const aspectRatio = definition.aspectRatios.includes(requestedRatio)
    ? requestedRatio
    : derivedRatio && definition.aspectRatios.includes(derivedRatio)
      ? derivedRatio
      : definition.defaultAspectRatio;
  return { aspectRatio, imageSize: tier, resolutionTier: tier };
}
