import type { CustomerProject, CustomerProjectIndexItem, CustomerProjectPublication } from '@/db/repositories';
import { getSignedMiniAiAssetUrl } from '@/lib/ai/mini-ai-assets';
import { getWorkflowStageDefinition } from '@/lib/ai/workflow-stages';
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
  'tour_board',
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
  imageEndpoint: string;
};

export type PublishedSchemeDto = {
  id: string;
  workflowId: string | null;
  title: string;
  publishedAt: Date;
  images: PublishedDesignDto[];
};

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
        publishedAt: publication.publishedAt,
        images: [image],
      });
      order.push(groupId);
      continue;
    }
    existing.images.push(image);
    if (publication.publishedAt > existing.publishedAt) existing.publishedAt = publication.publishedAt;
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
    .sort((left, right) => right.publishedAt.getTime() - left.publishedAt.getTime());
}

export function customerProjectToDto(
  request: Request,
  project: CustomerProject,
  options: { customerRescheduleCutoffHours?: number | null } = {}
) {
  const leadId = project.lead.id.toString();
  const enterpriseId = project.lead.enterpriseId!.toString();
  const hasFormalFloorPlan = Boolean(project.formalFloorPlan);
  const publishedSchemes = groupPublishedSchemes(project.publications, leadId);
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
  const featuredScheme = publishedSchemes[0]
    ? {
        id: publishedSchemes[0].id,
        title: publishedSchemes[0].title,
        styleTag: publishedSchemes[0].title.startsWith('#')
          ? publishedSchemes[0].title
          : `#${publishedSchemes[0].title}`,
        imageEndpoint: publishedSchemes[0].images[0]?.imageEndpoint || null,
        generationId: publishedSchemes[0].images[0]?.generationId || null,
        imageCount: publishedSchemes[0].images.length,
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
