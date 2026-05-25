type KujialeSearchParams = {
  city?: string;
  communityName: string;
  area?: string | number | null;
  layout?: string | null;
  page?: number;
  limit?: number;
};

export type KujialeFloorPlanCard = {
  externalId: string;
  communityName: string;
  city?: string;
  area?: number;
  layoutLabel?: string;
  previewUrl?: string;
  sourceLabel: string;
  rawSummary?: Record<string, unknown>;
};

export type KujialeFloorPlanDetail = KujialeFloorPlanCard & {
  name: string;
  rooms: ImportedKujialeRoom[];
  raw: Record<string, unknown>;
};

type ImportedKujialeOpening = {
  id?: string;
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
};

type ImportedKujialeRoom = {
  id?: string;
  name?: string;
  width?: number;
  height?: number;
  area?: number;
  polygon?: Array<{ x: number; y: number }>;
  openings?: ImportedKujialeOpening[];
};

type KujialeConfig = {
  appKey?: string;
  appSecret?: string;
  baseUrl?: string;
  searchPath: string;
  detailPath: string;
  tokenPath: string;
  useMock: boolean;
};

let tokenCache: { token: string; expiresAt: number } | null = null;

function getConfig(): KujialeConfig {
  return {
    appKey: process.env.KUJIALE_APP_KEY,
    appSecret: process.env.KUJIALE_APP_SECRET,
    baseUrl: process.env.KUJIALE_BASE_URL?.replace(/\/+$/, ''),
    searchPath: process.env.KUJIALE_SEARCH_PATH || '/floorplans/search',
    detailPath: process.env.KUJIALE_DETAIL_PATH || '/floorplans/:id',
    tokenPath: process.env.KUJIALE_TOKEN_PATH || '/oauth/token',
    useMock: process.env.KUJIALE_USE_MOCK === 'true',
  };
}

function assertConfigured(config: KujialeConfig) {
  if (config.useMock) return;
  if (!config.appKey || !config.appSecret || !config.baseUrl) {
    throw new Error('KuJiale API is not configured. Set KUJIALE_APP_KEY, KUJIALE_APP_SECRET and KUJIALE_BASE_URL, or enable KUJIALE_USE_MOCK=true for local testing.');
  }
}

function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function pickNumber(source: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = toNumber(source[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function toPlannerUnit(value: unknown, fallback: number): number {
  const num = toNumber(value);
  if (num === undefined || num <= 0) return fallback;
  if (num > 1000) return Math.round(num / 100); // millimeters -> decimeters
  if (num > 100) return Math.round(num / 10); // centimeters -> decimeters
  if (num <= 30) return Math.round(num * 10); // meters -> decimeters
  return Math.round(num);
}

function normalizePolygon(points: unknown): Array<{ x: number; y: number }> | undefined {
  if (!Array.isArray(points) || points.length < 3) return undefined;
  const normalized = points
    .map((point) => {
      if (!point || typeof point !== 'object') return null;
      const item = point as Record<string, unknown>;
      return {
        x: toPlannerUnit(item.x ?? item.X ?? item.left, 0),
        y: toPlannerUnit(item.y ?? item.Y ?? item.top, 0),
      };
    })
    .filter(Boolean) as Array<{ x: number; y: number }>;

  return normalized.length >= 3 ? normalized : undefined;
}

function summarizeRaw(raw: Record<string, unknown>) {
  const summaryKeys = [
    'id',
    'planId',
    'houseId',
    'name',
    'title',
    'communityName',
    'community',
    'city',
    'area',
    'layout',
    'layoutName',
    'bedroomCount',
    'livingRoomCount',
    'kitchenCount',
    'bathroomCount',
    'previewUrl',
    'coverUrl',
    'imageUrl',
  ];

  return summaryKeys.reduce<Record<string, unknown>>((summary, key) => {
    if (raw[key] !== undefined) summary[key] = raw[key];
    return summary;
  }, {});
}

function getItems(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  const candidates = [obj.data, obj.items, obj.list, obj.records, obj.result];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
    }
    if (candidate && typeof candidate === 'object') {
      const nested = getItems(candidate);
      if (nested.length) return nested;
    }
  }
  return [];
}

function normalizeCard(raw: Record<string, unknown>, fallbackCommunityName?: string): KujialeFloorPlanCard {
  const externalId = pickString(raw, ['externalId', 'id', 'planId', 'houseId', 'floorPlanId', 'guid']) || '';
  const communityName = pickString(raw, ['communityName', 'community', 'estateName', 'residentialName']) || fallbackCommunityName || '';
  const city = pickString(raw, ['city', 'cityName']);
  const area = pickNumber(raw, ['area', 'houseArea', 'buildingArea', 'usableArea']);
  const layoutLabel =
    pickString(raw, ['layoutLabel', 'layoutName', 'layout', 'houseType']) ||
    buildLayoutLabel(raw);
  const previewUrl = pickString(raw, ['previewUrl', 'coverUrl', 'imageUrl', 'thumbnailUrl', 'picUrl']);

  return {
    externalId,
    communityName,
    city,
    area,
    layoutLabel,
    previewUrl,
    sourceLabel: '酷家乐',
    rawSummary: summarizeRaw(raw),
  };
}

function buildLayoutLabel(raw: Record<string, unknown>) {
  const bedroom = pickNumber(raw, ['bedroomCount', 'bedrooms', 'roomCount']);
  const living = pickNumber(raw, ['livingRoomCount', 'livingRooms', 'hallCount']);
  const kitchen = pickNumber(raw, ['kitchenCount', 'kitchens']);
  const bathroom = pickNumber(raw, ['bathroomCount', 'bathrooms', 'toiletCount']);
  const parts = [
    bedroom ? `${bedroom}室` : '',
    living ? `${living}厅` : '',
    kitchen ? `${kitchen}厨` : '',
    bathroom ? `${bathroom}卫` : '',
  ].filter(Boolean);
  return parts.length ? parts.join('') : undefined;
}

function normalizeOpening(raw: Record<string, unknown>, index: number): ImportedKujialeOpening {
  const type = pickString(raw, ['type', 'openingType', 'category']);
  return {
    id: pickString(raw, ['id', 'guid']) || `opening-${index}`,
    type: type && /window/i.test(type) ? 'WINDOW' : 'DOOR',
    x: toPlannerUnit(raw.x ?? raw.left ?? raw.centerX, 0),
    y: toPlannerUnit(raw.y ?? raw.top ?? raw.centerY, 0),
    width: toPlannerUnit(raw.width ?? raw.w, 8),
    height: toPlannerUnit(raw.height ?? raw.h, 20),
    rotation: toNumber(raw.rotation ?? raw.angle) || 0,
  };
}

function normalizeRoom(raw: Record<string, unknown>, index: number): ImportedKujialeRoom {
  const width = toPlannerUnit(raw.width ?? raw.w ?? raw.length, 40);
  const height = toPlannerUnit(raw.height ?? raw.h ?? raw.depth, 40);
  const openingsRaw = raw.openings || raw.doors || raw.windows;
  const openings = Array.isArray(openingsRaw)
    ? openingsRaw
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map(normalizeOpening)
    : [];

  return {
    id: pickString(raw, ['id', 'guid', 'roomId']) || `kujiale-room-${index + 1}`,
    name: pickString(raw, ['name', 'roomName', 'typeName']) || `空间${index + 1}`,
    width,
    height,
    area: pickNumber(raw, ['area', 'roomArea']),
    polygon: normalizePolygon(raw.polygon || raw.points || raw.contour),
    openings,
  };
}

function extractRooms(raw: Record<string, unknown>): ImportedKujialeRoom[] {
  const roomCandidates = [raw.rooms, raw.spaces, raw.roomList, raw.spaceList, raw.data];
  for (const candidate of roomCandidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map(normalizeRoom);
    }
    if (candidate && typeof candidate === 'object') {
      const nested = extractRooms(candidate as Record<string, unknown>);
      if (nested.length) return nested;
    }
  }
  return [];
}

function mockCard(params: KujialeSearchParams, index: number): KujialeFloorPlanCard {
  const area = toNumber(params.area) || 89 + index * 12;
  const layoutLabel = params.layout || (index === 0 ? '3室2厅1厨2卫' : '2室2厅1厨1卫');
  return {
    externalId: `mock-kujiale-${encodeURIComponent(params.communityName)}-${index + 1}`,
    communityName: params.communityName,
    city: params.city,
    area,
    layoutLabel,
    previewUrl: '',
    sourceLabel: '酷家乐',
    rawSummary: {
      mock: true,
      communityName: params.communityName,
      area,
      layoutLabel,
    },
  };
}

function mockDetail(externalId: string): KujialeFloorPlanDetail {
  const areaMatch = externalId.match(/(\d{2,3})/);
  const area = areaMatch ? Number(areaMatch[1]) : 98;
  const card: KujialeFloorPlanCard = {
    externalId,
    communityName: '示例小区',
    city: '示例城市',
    area,
    layoutLabel: '3室2厅1厨2卫',
    previewUrl: '',
    sourceLabel: '酷家乐',
    rawSummary: { mock: true, externalId },
  };

  return {
    ...card,
    name: `${card.communityName} ${card.layoutLabel}`,
    rooms: [
      { id: `${externalId}-living`, name: '客厅', width: 56, height: 42, area: 23.5 },
      { id: `${externalId}-master`, name: '主卧', width: 38, height: 34, area: 12.9 },
      { id: `${externalId}-bedroom`, name: '次卧', width: 32, height: 30, area: 9.6 },
      { id: `${externalId}-kitchen`, name: '厨房', width: 28, height: 22, area: 6.1 },
      { id: `${externalId}-bath`, name: '卫生间', width: 22, height: 18, area: 4 },
    ],
    raw: { mock: true, externalId },
  };
}

async function getAccessToken(config: KujialeConfig) {
  assertConfigured(config);
  if (config.useMock) return 'mock-token';
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;

  const res = await fetch(`${config.baseUrl}${config.tokenPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: config.appKey,
      client_secret: config.appSecret,
      appKey: config.appKey,
      appSecret: config.appSecret,
    }),
    cache: 'no-store',
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || data?.message || 'Failed to authenticate with KuJiale API.');
  }

  const token = data.access_token || data.accessToken || data.token;
  if (!token) throw new Error('KuJiale token response did not include an access token.');

  const expiresIn = Number(data.expires_in || data.expiresIn || 7200);
  tokenCache = {
    token,
    expiresAt: Date.now() + Math.max(300, expiresIn - 60) * 1000,
  };
  return token;
}

function appendQuery(url: URL, params: Record<string, string | number | undefined | null>) {
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
}

export async function searchKujialeFloorPlans(params: KujialeSearchParams) {
  const config = getConfig();
  assertConfigured(config);

  const page = Math.max(Number(params.page) || 1, 1);
  const limit = Math.min(Math.max(Number(params.limit) || 10, 1), 50);

  if (config.useMock) {
    return {
      items: [mockCard(params, 0), mockCard(params, 1)],
      pagination: { page, limit, total: 2, totalPages: 1 },
    };
  }

  const token = await getAccessToken(config);
  const url = new URL(`${config.baseUrl}${config.searchPath}`);
  appendQuery(url, {
    city: params.city,
    communityName: params.communityName,
    keyword: params.communityName,
    area: params.area,
    layout: params.layout,
    page,
    limit,
  });

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-App-Key': config.appKey || '',
    },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.error || data?.message || 'Failed to search KuJiale floor plans.');
  }

  const items = getItems(data)
    .map((item) => normalizeCard(item, params.communityName))
    .filter((item) => item.externalId);
  const total = toNumber((data as Record<string, unknown>).total) || toNumber((data as Record<string, unknown>).count) || items.length;

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function getKujialeFloorPlanDetail(externalId: string): Promise<KujialeFloorPlanDetail> {
  const config = getConfig();
  assertConfigured(config);

  if (config.useMock) return mockDetail(externalId);

  const token = await getAccessToken(config);
  const detailPath = config.detailPath.replace(':id', encodeURIComponent(externalId));
  const url = new URL(`${config.baseUrl}${detailPath}`);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-App-Key': config.appKey || '',
    },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.error || data?.message || 'Failed to fetch KuJiale floor plan detail.');
  }

  const raw = (data?.data && typeof data.data === 'object' ? data.data : data) as Record<string, unknown>;
  const card = normalizeCard(raw);
  const rooms = extractRooms(raw);

  return {
    ...card,
    externalId: card.externalId || externalId,
    name: pickString(raw, ['name', 'title']) || [card.communityName, card.layoutLabel].filter(Boolean).join(' ') || `酷家乐户型 ${externalId}`,
    rooms,
    raw,
  };
}

export function convertKujialeDetailToLayoutData(detail: KujialeFloorPlanDetail) {
  const rooms = detail.rooms.length
    ? detail.rooms
    : [{ id: `${detail.externalId}-room`, name: detail.layoutLabel || '酷家乐户型', width: 40, height: 40 }];

  return rooms.map((room, index) => {
    const width = room.width || 40;
    const height = room.height || 40;
    return {
      id: room.id || `kujiale-room-${index + 1}`,
      name: room.name || `空间${index + 1}`,
      x: (index % 3) * 48,
      y: Math.floor(index / 3) * 42,
      width,
      height,
      defaultWidth: width,
      defaultHeight: height,
      polygon: room.polygon,
      polygonClosed: !!room.polygon?.length,
      openings: room.openings || [],
      measured: true,
      color: 'rgba(255, 255, 255, 0.8)',
      source: 'kujiale',
      externalRoomId: room.id,
    };
  });
}
