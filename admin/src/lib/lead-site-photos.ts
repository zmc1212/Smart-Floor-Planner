import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import {
  LeadLifecycleRepository,
  LeadRepository,
  LeadSitePhotoRepository,
  type LeadRecord,
  type LeadSitePhotoWithAsset,
  type LeadWithRelations,
} from '@/db/repositories';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';
import { resolveMiniProgramContext, type MiniProgramContext } from '@/lib/miniprogram-auth';
import { validateAiImage } from '@/lib/ai/image-validation';
import {
  resolveMediaAssetDisplayUrls,
  storePostgresMediaBuffer,
} from '@/lib/ai/postgres-media-assets';
import { httpError, httpErrorStatus } from '@/lib/http-error';
import { leadArchivedError } from '@/lib/lead-lifecycle';

export const LEAD_SITE_PHOTO_LIMIT = 30;

export const LEAD_SITE_PHOTO_SOURCES = ['camera', 'album', 'ai_picker'] as const;
export type LeadSitePhotoSource = (typeof LEAD_SITE_PHOTO_SOURCES)[number];

export const LEAD_SITE_PHOTO_SPACE_TAGS = [
  'living_room',
  'master_bedroom',
  'secondary_bedroom',
  'master_bathroom',
  'secondary_bathroom',
  'kitchen',
  'dining_room',
  'balcony',
  'study',
  'other',
] as const;
export type LeadSitePhotoSpaceTag = (typeof LEAD_SITE_PHOTO_SPACE_TAGS)[number];

export const LEAD_SITE_PHOTO_SPACE_TAG_LABELS: Record<LeadSitePhotoSpaceTag, string> = {
  living_room: '客厅',
  master_bedroom: '主卧',
  secondary_bedroom: '次卧',
  master_bathroom: '主卫',
  secondary_bathroom: '次卫',
  kitchen: '厨房',
  dining_room: '餐厅',
  balcony: '阳台',
  study: '书房',
  other: '其他',
};

/** First-row chips shown before capture. */
export const LEAD_SITE_PHOTO_QUICK_TAGS: LeadSitePhotoSpaceTag[] = [
  'living_room',
  'master_bedroom',
  'secondary_bedroom',
  'master_bathroom',
  'secondary_bathroom',
];

export type LeadSitePhotoActor = {
  mode: MiniProgramContext['mode'];
  userId: bigint;
  staffId?: bigint | null;
  staffRole?: string | null;
};

export type LeadSitePhotoAccessLead = Pick<
  LeadRecord,
  'id' | 'enterpriseId' | 'customerUserId' | 'assignedTo' | 'measurerId' | 'archivedAt'
>;

export function canAccessLeadSitePhotos(
  lead: LeadSitePhotoAccessLead,
  actor: LeadSitePhotoActor,
) {
  if (actor.mode === 'referrer') return false;
  if (actor.mode === 'customer') {
    return Boolean(lead.customerUserId && lead.customerUserId === actor.userId);
  }
  if (!actor.staffId) return false;
  if (actor.staffRole === 'enterprise_admin') return true;
  return lead.assignedTo === actor.staffId || lead.measurerId === actor.staffId;
}

export function parseLeadSitePhotoSource(value: unknown): LeadSitePhotoSource {
  const source = String(value || '').trim();
  if (!source) return 'album';
  if ((LEAD_SITE_PHOTO_SOURCES as readonly string[]).includes(source)) {
    return source as LeadSitePhotoSource;
  }
  throw httpError('不支持的现场图来源', 400);
}

export function parseLeadSitePhotoSpaceTag(value: unknown, { required = false } = {}): LeadSitePhotoSpaceTag | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw httpError('请选择房间标签', 400);
    return null;
  }
  const tag = String(value).trim();
  if ((LEAD_SITE_PHOTO_SPACE_TAGS as readonly string[]).includes(tag)) {
    return tag as LeadSitePhotoSpaceTag;
  }
  throw httpError('不支持的房间标签', 400);
}

function actorFromContext(context: MiniProgramContext): LeadSitePhotoActor {
  return {
    mode: context.mode,
    userId: parsePostgresId(context.user._id, 'user id'),
    staffId: context.staff?._id ? parsePostgresId(context.staff._id, 'staff id') : null,
    staffRole: context.staff?.role || null,
  };
}

export type AuthorizedLeadSitePhotoContext = {
  context: MiniProgramContext;
  lead: LeadWithRelations;
  enterpriseId: bigint;
  actor: LeadSitePhotoActor;
};

export async function authorizeLeadSitePhotos(
  request: Request,
  leadIdText: string,
): Promise<AuthorizedLeadSitePhotoContext | NextResponse> {
  const context = await resolveMiniProgramContext(request);
  if (!context) {
    return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
  }
  if (context.mode === 'referrer') {
    return NextResponse.json({ success: false, error: '无权访问该户现场图' }, { status: 403 });
  }
  const leadId = parsePostgresId(leadIdText, 'lead id');
  const actor = actorFromContext(context);
  const lead = await withMiniProgramPostgresTransaction(context, (transaction) =>
    new LeadRepository(transaction).findById(leadId)
  );
  if (!lead || !canAccessLeadSitePhotos(lead, actor)) {
    return NextResponse.json({ success: false, error: '现场图不存在或无权访问' }, { status: 404 });
  }
  if (!lead.enterpriseId) {
    return NextResponse.json({ success: false, error: '该线索缺少企业上下文' }, { status: 409 });
  }
  return { context, lead, enterpriseId: lead.enterpriseId, actor };
}

export function isAuthorizedLeadSitePhotoContext(
  value: AuthorizedLeadSitePhotoContext | NextResponse,
): value is AuthorizedLeadSitePhotoContext {
  return !(value instanceof NextResponse);
}

function assertWritable(lead: LeadSitePhotoAccessLead) {
  if (lead.archivedAt) throw leadArchivedError();
}

function serializePhoto(
  photo: Pick<
    LeadSitePhotoWithAsset,
    'id' | 'assetId' | 'spaceTag' | 'source' | 'createdAt' | 'mimeType' | 'width' | 'height' | 'size'
  >,
  previewUrl: string,
) {
  const spaceTag = photo.spaceTag && (LEAD_SITE_PHOTO_SPACE_TAGS as readonly string[]).includes(photo.spaceTag)
    ? photo.spaceTag as LeadSitePhotoSpaceTag
    : null;
  return {
    id: photo.id.toString(),
    assetId: photo.assetId.toString(),
    spaceTag,
    spaceTagLabel: spaceTag ? LEAD_SITE_PHOTO_SPACE_TAG_LABELS[spaceTag] : '',
    source: photo.source,
    createdAt: photo.createdAt.toISOString(),
    mimeType: photo.mimeType,
    width: photo.width,
    height: photo.height,
    size: Number(photo.size),
    previewUrl,
  };
}

async function previewUrlsFor(
  request: Request,
  enterpriseId: bigint,
  photos: Array<{ assetId: bigint }>,
) {
  return resolveMediaAssetDisplayUrls({
    request,
    enterpriseId,
    assetIds: photos.map((photo) => photo.assetId),
  });
}

export async function listLeadSitePhotos(
  request: Request,
  access: AuthorizedLeadSitePhotoContext,
) {
  const photos = await withMiniProgramPostgresTransaction(access.context, (transaction) =>
    new LeadSitePhotoRepository(transaction).listActive(access.lead.id)
  );
  const urls = await previewUrlsFor(request, access.enterpriseId, photos);
  return {
    limit: LEAD_SITE_PHOTO_LIMIT,
    remaining: Math.max(0, LEAD_SITE_PHOTO_LIMIT - photos.length),
    spaceTags: LEAD_SITE_PHOTO_SPACE_TAGS.map((key) => ({
      key,
      label: LEAD_SITE_PHOTO_SPACE_TAG_LABELS[key],
      quick: LEAD_SITE_PHOTO_QUICK_TAGS.includes(key),
    })),
    items: photos.map((photo) => serializePhoto(photo, urls.get(photo.assetId.toString()) || '')),
  };
}

export async function createLeadSitePhoto(
  request: Request,
  access: AuthorizedLeadSitePhotoContext,
  input: { buffer: Buffer; source: unknown; spaceTag?: unknown },
) {
  assertWritable(access.lead);
  const source = parseLeadSitePhotoSource(input.source);
  const spaceTag = parseLeadSitePhotoSpaceTag(input.spaceTag, { required: true });
  const image = validateAiImage({ buffer: input.buffer });
  const currentCount = await withMiniProgramPostgresTransaction(access.context, (transaction) =>
    new LeadSitePhotoRepository(transaction).countActive(access.lead.id)
  );
  if (currentCount >= LEAD_SITE_PHOTO_LIMIT) {
    throw httpError(`本户现场图最多 ${LEAD_SITE_PHOTO_LIMIT} 张`, 400);
  }

  const stored = await storePostgresMediaBuffer({
    enterpriseId: access.enterpriseId,
    ownerType: 'lead_site_photo',
    ownerId: access.lead.id,
    mimeType: image.mimeType,
    buffer: input.buffer,
    width: image.width,
    height: image.height,
  });

  const photo = await withMiniProgramPostgresTransaction(access.context, async (transaction) => {
    await new LeadLifecycleRepository(transaction).lockByIds([access.lead.id]);
    const repository = new LeadSitePhotoRepository(transaction);
    const activeCount = await repository.countActive(access.lead.id);
    if (activeCount >= LEAD_SITE_PHOTO_LIMIT) {
      throw httpError(`本户现场图最多 ${LEAD_SITE_PHOTO_LIMIT} 张`, 400);
    }
    return repository.create({
      enterpriseId: access.enterpriseId,
      leadId: access.lead.id,
      assetId: stored.asset.id,
      spaceTag,
      source,
      createdByUserId: access.actor.userId,
      createdByStaffId: access.actor.staffId ?? null,
    });
  });

  const urls = await previewUrlsFor(request, access.enterpriseId, [photo]);
  return serializePhoto(
    {
      ...photo,
      mimeType: image.mimeType,
      width: image.width,
      height: image.height,
      size: stored.asset.size,
    },
    urls.get(photo.assetId.toString()) || '',
  );
}

export async function updateLeadSitePhotoTag(
  request: Request,
  access: AuthorizedLeadSitePhotoContext,
  photoIdText: string,
  spaceTagValue: unknown,
) {
  assertWritable(access.lead);
  const photoId = parsePostgresId(photoIdText, 'photo id');
  const spaceTag = parseLeadSitePhotoSpaceTag(spaceTagValue);
  const updated = await withMiniProgramPostgresTransaction(access.context, async (transaction) => {
    const repository = new LeadSitePhotoRepository(transaction);
    const current = await repository.findActiveById(access.lead.id, photoId);
    if (!current) return null;
    await repository.updateSpaceTag(access.lead.id, photoId, spaceTag);
    return repository.findActiveById(access.lead.id, photoId);
  });
  if (!updated) {
    throw httpError('现场图不存在或已删除', 404);
  }
  const urls = await previewUrlsFor(request, access.enterpriseId, [updated]);
  return serializePhoto(updated, urls.get(updated.assetId.toString()) || '');
}

export async function softDeleteLeadSitePhoto(
  access: AuthorizedLeadSitePhotoContext,
  photoIdText: string,
) {
  assertWritable(access.lead);
  const photoId = parsePostgresId(photoIdText, 'photo id');
  const deleted = await withMiniProgramPostgresTransaction(access.context, (transaction) =>
    new LeadSitePhotoRepository(transaction).softDelete(access.lead.id, photoId)
  );
  if (!deleted) {
    throw httpError('现场图不存在或已删除', 404);
  }
  return { id: deleted.id.toString(), assetId: deleted.assetId.toString(), deleted: true };
}

export function leadSitePhotoErrorResponse(error: unknown, fallback: string) {
  const status = httpErrorStatus(error, 400);
  return NextResponse.json(
    { success: false, error: error instanceof Error ? error.message : fallback },
    { status },
  );
}
