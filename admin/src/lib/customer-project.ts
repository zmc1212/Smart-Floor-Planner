import type { CustomerProject, CustomerProjectIndexItem } from '@/db/repositories';
import { getSignedMiniAiAssetUrl } from '@/lib/ai/mini-ai-assets';
import { resolveCustomerHomeAction } from '@/lib/lead-service-stage';

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function customerProjectToDto(
  request: Request,
  project: CustomerProject,
  options: { customerRescheduleCutoffHours?: number | null } = {}
) {
  const leadId = project.lead.id.toString();
  const enterpriseId = project.lead.enterpriseId!.toString();
  const hasFormalFloorPlan = Boolean(project.formalFloorPlan);
  const home = resolveCustomerHomeAction({
    leadStatus: project.lead.status,
    assignmentStatus: project.lead.assignmentStatus,
    measurerId: project.lead.measurerId,
    appointment: project.appointment,
    hasFormalFloorPlan,
    publishedDesignCount: project.publications.length,
    customerRescheduleCutoffHours: options.customerRescheduleCutoffHours,
  });
  return {
    leadId,
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
        }
      : null,
    publishedDesigns: project.publications.map(({ publication, generation }) => {
      const input = record(generation.input);
      return {
        id: publication.id.toString(),
        generationId: generation.id.toString(),
        type: generation.type,
        stageKey: generation.stageKey,
        title: typeof input.recipeName === 'string'
          ? input.recipeName
          : typeof input.style === 'string'
            ? input.style
            : '设计方案',
        publishedAt: publication.publishedAt,
        imageEndpoint: `/api/miniprogram/customer-projects/${leadId}/published-generations/${generation.id.toString()}/image`,
      };
    }),
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
