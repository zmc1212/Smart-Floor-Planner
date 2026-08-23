import type { CustomerProject, CustomerProjectIndexItem, CustomerProjectPublication } from '@/db/repositories';
import { getSignedMiniAiAssetUrl } from '@/lib/ai/mini-ai-assets';
import {
  collectPostgresAssetIdsFromImageUrls,
  getPostgresAssetIdFromImageUrl,
  resolveMediaAssetDisplayUrls,
} from '@/lib/ai/postgres-media-assets';
import { getWorkflowStageDefinition } from '@/lib/ai/workflow-stages';
import { getGenerationImageUrl } from '@/lib/ai/workflow-utils';
import { getFloorPlanDisplay } from '@/lib/floor-plan-display';
import { resolveCustomerHomeAction } from '@/lib/lead-service-stage';

export const LEGACY_PUBLISHED_SCHEME_ID = 'legacy';
export const LEGACY_PUBLISHED_SCHEME_TITLE = '其他效果图';

/** Internal style/stage keys must never surface as customer-facing image titles. */
const INTERNAL_GENERATION_TITLE_KEYS = new Set([
  'conversation',
  'direction',
  'base_render',
  'soft_furnishing',
  'proposal_pack',
  'lighting',
  'mood_board',
  'premium_board',
  'perspective_upgrade',
  'cad_detail',
  'free_create',
]);

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatAreaLabel(area: unknown) {
  const numeric = Number(area);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  const rounded = Math.round(numeric);
  return `${rounded}m²`;
}

function formatShortSurveyDate(value?: Date | string | null) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}/${date.getDate()}已量房`;
}

function buildCustomerProjectIdentity(project: CustomerProject) {
  const display = getFloorPlanDisplay(
    { name: project.formalFloorPlan?.name || null },
    { lead: project.lead },
  );
  const communityName = text(project.lead.communityName);
  const customerName = text(project.lead.name);
  const areaLabel = formatAreaLabel(project.lead.area);
  const heroTitle = communityName && customerName && customerName !== communityName
    ? `${communityName} ${customerName}`
    : display.projectTitle;
  const navSubtitle = [communityName || display.projectTitle, areaLabel].filter(Boolean).join(' · ');
  return {
    heroTitle,
    heroSubtitle: '免费量房与设计方案全纪录',
    navSubtitle,
    areaLabel,
  };
}

function generationTitle(generation: CustomerProjectPublication['generation'], fallback: string) {
  const input = record(generation.input);
  // Never expose designer prompts (userMessage) — they are internal production text.
  const recipeName = text(input.recipeName);
  if (recipeName && !INTERNAL_GENERATION_TITLE_KEYS.has(recipeName)) return recipeName;
  const style = text(input.style);
  if (style && !INTERNAL_GENERATION_TITLE_KEYS.has(style)) return style;
  if (fallback) return fallback;
  return getWorkflowStageDefinition(generation.stageKey)?.name || '效果图';
}

export type PublishedDesignDto = {
  id: string;
  generationId: string;
  type: string;
  stageKey: string | null;
  title: string;
  publishedAt: Date;
  /** https display URL from `directQiniuDisplayUrls` (default Qiniu) or aligned API fallback. Prefer for Mini Program `<image>`. */
  imageUrl?: string | null;
  /** Authenticated byte endpoint kept as save-to-album / Admin fallback. */
  imageEndpoint: string;
};

export type PublishedSchemeDto = {
  id: string;
  workflowId: string | null;
  title: string;
  firstPublishedAt: Date;
  publishedAt: Date;
  finalized?: boolean;
  images: PublishedDesignDto[];
};

function publicationFirstVisibleAt(publication: CustomerProjectPublication['publication']) {
  const publishedAt = publication.publishedAt;
  const createdAt = publication.createdAt;
  if (createdAt && createdAt < publishedAt) return createdAt;
  return publishedAt;
}

function publicationActivityAt(publication: CustomerProjectPublication['publication']) {
  const publishedAt = publication.publishedAt;
  const updatedAt = publication.updatedAt;
  if (updatedAt && updatedAt > publishedAt) return updatedAt;
  return publishedAt;
}

export function pickFeaturedPublishedScheme(
  schemes: PublishedSchemeDto[],
  finalizedWorkflowId?: string | bigint | null,
) {
  const finalizedId = finalizedWorkflowId?.toString() || null;
  if (finalizedId) {
    const finalized = schemes.find((scheme) => scheme.workflowId === finalizedId);
    if (finalized) return finalized;
  }
  return schemes.reduce<PublishedSchemeDto | null>((latest, scheme) => {
    if (!latest) return scheme;
    if (scheme.publishedAt > latest.publishedAt) return scheme;
    return latest;
  }, null);
}

export function buildPublishedSchemeViews(
  publications: CustomerProjectPublication[],
  leadId: string,
  finalizedWorkflowId?: string | bigint | null,
): PublishedSchemeDto[] {
  const finalizedId = finalizedWorkflowId?.toString() || null;
  const schemes = groupPublishedSchemes(publications, leadId).map((scheme) => ({
    ...scheme,
    finalized: finalizedId !== null && scheme.workflowId === finalizedId,
  }));
  if (!finalizedId) return schemes;
  const finalizedIndex = schemes.findIndex((scheme) => scheme.finalized);
  if (finalizedIndex <= 0) return schemes;
  const reordered = [...schemes];
  const [finalized] = reordered.splice(finalizedIndex, 1);
  return [finalized, ...reordered];
}

export function groupPublishedSchemes(
  publications: CustomerProjectPublication[],
  leadId: string
): PublishedSchemeDto[] {
  const groups = new Map<string, PublishedSchemeDto>();
  const order: string[] = [];
  for (const { publication, generation } of publications) {
    const workflowId = publication.workflowId?.toString() || null;
    const groupId = workflowId || LEGACY_PUBLISHED_SCHEME_ID;
    const title = publication.schemeTitle?.trim()
      || (workflowId ? '设计方案' : LEGACY_PUBLISHED_SCHEME_TITLE);
    const firstVisibleAt = publicationFirstVisibleAt(publication);
    const activityAt = publicationActivityAt(publication);
    const image: PublishedDesignDto = {
      id: publication.id.toString(),
      generationId: generation.id.toString(),
      type: generation.type,
      stageKey: generation.stageKey,
      title: generationTitle(generation, title),
      publishedAt: publication.publishedAt,
      // The Mini Program API client already appends paths to an `/api` base URL.
      imageEndpoint: `/miniprogram/customer-projects/${leadId}/published-generations/${generation.id.toString()}/image`,
    };
    const existing = groups.get(groupId);
    if (!existing) {
      groups.set(groupId, {
        id: groupId,
        workflowId,
        title,
        firstPublishedAt: firstVisibleAt,
        publishedAt: activityAt,
        images: [image],
      });
      order.push(groupId);
      continue;
    }
    existing.images.push(image);
    if (firstVisibleAt < existing.firstPublishedAt) existing.firstPublishedAt = firstVisibleAt;
    if (activityAt > existing.publishedAt) existing.publishedAt = activityAt;
    if (publication.schemeTitle?.trim()) existing.title = publication.schemeTitle.trim();
  }
  for (const scheme of groups.values()) {
    scheme.images.sort((left, right) => {
      const leftPublication = publications.find((item) => item.publication.id.toString() === left.id);
      const rightPublication = publications.find((item) => item.publication.id.toString() === right.id);
      const leftOrder = leftPublication?.publication.sortOrder ?? 0;
      const rightOrder = rightPublication?.publication.sortOrder ?? 0;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.publishedAt.getTime() - right.publishedAt.getTime();
    });
  }
  return order
    .map((id) => groups.get(id)!)
    .sort((left, right) => {
      const firstDiff = left.firstPublishedAt.getTime() - right.firstPublishedAt.getTime();
      if (firstDiff !== 0) return firstDiff;
      return String(left.id).localeCompare(String(right.id));
    });
}

/**
 * Attach stable https `imageUrl` values to published scheme images from generation outputs.
 */
export async function attachPublishedSchemeDisplayUrls(
  request: Request,
  enterpriseId: string,
  publications: CustomerProjectPublication[],
  schemes: PublishedSchemeDto[],
): Promise<PublishedSchemeDto[]> {
  const sourceByGenerationId = new Map<string, string>();
  for (const { generation } of publications) {
    const source = getGenerationImageUrl(generation);
    if (source) sourceByGenerationId.set(generation.id.toString(), source);
  }
  const displayByAssetId = await resolveMediaAssetDisplayUrls({
    request,
    enterpriseId,
    assetIds: collectPostgresAssetIdsFromImageUrls([...sourceByGenerationId.values()]),
  });

  return schemes.map((scheme) => ({
    ...scheme,
    images: scheme.images.map((image) => {
      const source = sourceByGenerationId.get(image.generationId);
      if (!source) return { ...image, imageUrl: image.imageUrl ?? null };
      if (/^https?:\/\//i.test(source) && !getPostgresAssetIdFromImageUrl(source)) {
        return { ...image, imageUrl: source };
      }
      const assetId = getPostgresAssetIdFromImageUrl(source);
      if (assetId) {
        return {
          ...image,
          imageUrl: displayByAssetId.get(assetId.toString()) || null,
        };
      }
      return { ...image, imageUrl: null };
    }),
  }));
}

export async function customerProjectToDto(
  request: Request,
  project: CustomerProject,
  options: { customerRescheduleCutoffHours?: number | null } = {}
) {
  const leadId = project.lead.id.toString();
  const enterpriseId = project.lead.enterpriseId!.toString();
  const hasFormalFloorPlan = Boolean(project.formalFloorPlan);
  const publishedSchemes = await attachPublishedSchemeDisplayUrls(
    request,
    enterpriseId,
    project.publications,
    buildPublishedSchemeViews(
      project.publications,
      leadId,
      project.lead.finalizedWorkflowId,
    ),
  );
  const publishedDesigns = publishedSchemes.flatMap((scheme) => scheme.images);
  const home = resolveCustomerHomeAction({
    leadStatus: project.lead.status,
    assignmentStatus: project.lead.assignmentStatus,
    measurerId: project.lead.measurerId,
    appointment: project.appointment,
    hasFormalFloorPlan,
    publishedDesignCount: publishedDesigns.length,
    customerRescheduleCutoffHours: options.customerRescheduleCutoffHours,
  });
  const identity = buildCustomerProjectIdentity(project);
  const featuredSource = pickFeaturedPublishedScheme(publishedSchemes, project.lead.finalizedWorkflowId);
  const featuredScheme = featuredSource
    ? {
        id: featuredSource.id,
        title: featuredSource.title,
        styleTag: featuredSource.title.startsWith('#')
          ? featuredSource.title
          : `#${featuredSource.title}`,
        imageUrl: featuredSource.images[0]?.imageUrl || null,
        imageEndpoint: featuredSource.images[0]?.imageEndpoint || null,
        generationId: featuredSource.images[0]?.generationId || null,
        imageCount: featuredSource.images.length,
        finalized: Boolean(featuredSource.finalized),
      }
    : null;
  return {
    leadId,
    ...identity,
    featuredScheme,
    enterprise: { name: project.enterpriseName },
    status: project.lead.status,
    serviceStage: home.stageKey,
    serviceStageLabel: home.stageLabel,
    nextAction: home.nextAction,
    nextActionKind: home.kind,
    nextActionLabel: home.label,
    appointmentSummary: home.appointmentSummary,
    canRebook: home.canRebook,
    canReschedule: home.canReschedule,
    designer: project.designer
      ? {
          id: project.designer.id.toString(),
          displayName: project.designer.displayName,
          wechatId: project.designer.wechatId,
          phone: text(project.designer.phone) || null,
          wechatQrUrl: project.designer.wechatQrAssetId
            ? getSignedMiniAiAssetUrl({
                request,
                assetId: project.designer.wechatQrAssetId.toString(),
                enterpriseId,
              })
            : null,
        }
      : null,
    measurerName: project.measurerName,
    measurerPhone: text(project.measurerPhone) || text(project.appointment?.measurerPhone) || null,
    appointment: project.appointment
      ? {
          id: project.appointment.id.toString(),
          address: project.appointment.address,
          locationName: project.appointment.locationName,
          latitude: project.appointment.latitude == null ? null : Number(project.appointment.latitude),
          longitude: project.appointment.longitude == null ? null : Number(project.appointment.longitude),
          coordinateSystem: project.appointment.coordinateSystem,
          timeRange: project.appointment.timeRange,
          status: project.appointment.status,
          version: project.appointment.version,
          measurerName: project.appointment.measurerName,
          measurerPhone: text(project.appointment.measurerPhone) || null,
          updatedAt: project.appointment.updatedAt,
        }
      : null,
    formalFloorPlan: project.formalFloorPlan
      ? {
          id: project.formalFloorPlan.id.toString(),
          name: project.formalFloorPlan.name,
          status: project.formalFloorPlan.status,
          completedAt: project.formalFloorPlan.completedAt,
          updatedAt: project.formalFloorPlan.updatedAt,
          areaLabel: identity.areaLabel,
          previewEndpoint: `/miniprogram/customer-projects/${leadId}/formal-floor-plan/preview`,
          surveyStatusLabel: formatShortSurveyDate(
            project.formalFloorPlan.completedAt || project.formalFloorPlan.updatedAt
          ),
        }
      : null,
    publishedSchemes,
    publishedDesigns,
  };
}

export function customerProjectIndexToDto(project: CustomerProjectIndexItem) {
  const appointment = project.appointmentStatus
    ? { status: project.appointmentStatus, timeRange: project.appointmentTimeRange }
    : null;
  const home = resolveCustomerHomeAction({
    leadStatus: project.status,
    assignmentStatus: project.assignmentStatus,
    measurerId: project.measurerId,
    appointment,
    hasFormalFloorPlan: project.hasFormalFloorPlan,
    publishedDesignCount: Number(project.publishedDesignCount || 0),
    customerRescheduleCutoffHours: project.customerRescheduleCutoffHours,
  });
  return {
    leadId: project.leadId.toString(),
    enterprise: { name: project.enterpriseName },
    status: project.status,
    updatedAt: project.updatedAt,
    appointmentId: project.appointmentId?.toString() || null,
    appointmentVersion: project.appointmentVersion ?? null,
    appointmentStatus: project.appointmentStatus,
    appointmentTimeRange: project.appointmentTimeRange || null,
    hasFormalFloorPlan: project.hasFormalFloorPlan,
    publishedDesignCount: project.publishedDesignCount,
    serviceStage: home.stageKey,
    serviceStageLabel: home.stageLabel,
    nextAction: home.nextAction,
    nextActionKind: home.kind,
    nextActionLabel: home.label,
    appointmentSummary: home.appointmentSummary,
    canRebook: home.canRebook,
    canReschedule: home.canReschedule,
  };
}

export function buildPublishedSchemeFolioDto(input: {
  leadId: string;
  communityName?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  publishedSchemes: PublishedSchemeDto[];
}) {
  void input.customerName;
  void input.customerPhone;
  const communityName = text(input.communityName);
  const featured = pickFeaturedPublishedScheme(input.publishedSchemes, null);
  const featuredTitle = text(featured?.title) || text(input.publishedSchemes[0]?.title) || '设计方案';
  return {
    leadId: input.leadId,
    heroTitle: communityName || featuredTitle,
    publishedSchemes: input.publishedSchemes.map((scheme) => ({
      ...scheme,
      images: scheme.images.map((image) => ({
        ...image,
        imageEndpoint: '',
      })),
    })),
  };
}
