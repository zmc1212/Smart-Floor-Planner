import type { CustomerProject } from '@/db/repositories';
import { getSignedMiniAiAssetUrl } from '@/lib/ai/mini-ai-assets';

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function customerProjectToDto(request: Request, project: CustomerProject) {
  const leadId = project.lead.id.toString();
  const enterpriseId = project.lead.enterpriseId!.toString();
  return {
    leadId,
    enterprise: { name: project.enterpriseName },
    status: project.lead.status,
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
