import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import type { PostgresTransaction } from '@/db/transaction';
import { LeadRepository } from '@/db/repositories';
import { resolveMiniAiContext, type MiniAiContext } from '@/lib/ai/mini-ai-auth';
import {
  getSignedMiniAiAssetUrl,
  getSignedMiniAiRecipePreviewUrl,
  getSignedMiniAiStudioFloorPlanPreviewUrl,
  getSignedMiniAiStudioGenerationUrl,
} from '@/lib/ai/mini-ai-assets';
import {
  collectPostgresAssetIdsFromImageUrls,
  getPostgresAssetIdFromImageUrl,
  mediaAssetDisplayUrlTtlSeconds,
  resolveMediaAssetDisplayUrls,
} from '@/lib/ai/postgres-media-assets';
import { serializePostgresCreationTask } from '@/lib/ai/postgres-creation-runtime';
import { getGenerationImageUrl } from '@/lib/ai/workflow-utils';

const STUDIO_ROLES = new Set(['designer', 'enterprise_admin']);
const POSTGRES_GENERATION_IMAGE_RE = /^\/api\/ai\/generations\/([1-9]\d*)\/image/i;

export type MiniStudioContext = MiniAiContext;

export function canManageLead(role: string, assignedTo: bigint | null, staffId: bigint) {
  return role === 'enterprise_admin' || (role === 'designer' && assignedTo === staffId);
}

export async function requireMiniStudioContext(request: Request): Promise<MiniStudioContext | NextResponse> {
  const context = await resolveMiniAiContext(request);
  if (!context) {
    return NextResponse.json({ success: false, error: '仅企业员工可以使用 AI 方案工作台' }, { status: 403 });
  }
  if (!STUDIO_ROLES.has(context.role)) {
    return NextResponse.json({ success: false, error: '仅负责家装设计顾问或企业负责人可以使用 AI 方案工作台' }, { status: 403 });
  }
  return context;
}

export function isMiniStudioContext(value: MiniStudioContext | NextResponse): value is MiniStudioContext {
  return !(value instanceof NextResponse);
}

export async function assertMiniStudioLeadAccess(
  transaction: PostgresTransaction,
  context: MiniStudioContext,
  leadId: bigint,
) {
  const lead = await new LeadRepository(transaction).findById(leadId);
  if (!lead) {
    return { kind: 'not_found' as const, response: NextResponse.json({ success: false, error: '客户线索不存在或无权访问' }, { status: 404 }) };
  }
  if (lead.archivedAt) {
    return { kind: 'archived' as const, response: NextResponse.json({ success: false, code: 'LEAD_ARCHIVED', error: '该客户线索已归档' }, { status: 409 }) };
  }
  const staffId = parsePostgresId(context.operatorId, 'staff id');
  if (!canManageLead(context.role, lead.assignedTo, staffId)) {
    return { kind: 'forbidden' as const, response: NextResponse.json({ success: false, error: '无权访问该客户线索' }, { status: 403 }) };
  }
  return { kind: 'ok' as const, lead };
}

export function rewriteStudioImageUrl(
  request: Request,
  enterpriseId: string,
  imageUrl?: string | null,
  displayByAssetId?: Map<string, string>,
): string | undefined {
  if (!imageUrl || typeof imageUrl !== 'string') return undefined;
  const assetId = getPostgresAssetIdFromImageUrl(imageUrl);
  if (assetId) {
    const displayUrl = displayByAssetId?.get(assetId.toString());
    if (displayUrl) return displayUrl;
    return getSignedMiniAiAssetUrl({
      request,
      assetId: assetId.toString(),
      enterpriseId,
      ttlSeconds: mediaAssetDisplayUrlTtlSeconds(),
      alignDeadline: true,
    });
  }
  const generationMatch = imageUrl.match(POSTGRES_GENERATION_IMAGE_RE);
  if (generationMatch?.[1]) {
    return getSignedMiniAiStudioGenerationUrl({
      request,
      generationId: generationMatch[1],
      enterpriseId,
      ttlSeconds: mediaAssetDisplayUrlTtlSeconds(),
      alignDeadline: true,
    });
  }
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  return undefined;
}

async function resolveStudioDisplayByAssetId(
  request: Request,
  enterpriseId: string,
  imageUrls: Array<string | null | undefined>,
) {
  return resolveMediaAssetDisplayUrls({
    request,
    enterpriseId,
    assetIds: collectPostgresAssetIdsFromImageUrls(imageUrls),
  });
}

function signGenerationForMini<T extends Record<string, unknown>>(
  request: Request,
  enterpriseId: string,
  generation: T | null | undefined,
  displayByAssetId?: Map<string, string>,
): T | undefined {
  if (!generation) return undefined;
  return {
    ...generation,
    imageUrl: rewriteStudioImageUrl(
      request,
      enterpriseId,
      getGenerationImageUrl(generation),
      displayByAssetId,
    ),
  };
}

type WorkflowListItem = {
  coverImageUrl?: string;
  latestGeneration?: Record<string, unknown>;
  selectedGeneration?: Record<string, unknown>;
  [key: string]: unknown;
};

export async function serializeWorkflowListForMini<T extends { data: readonly unknown[] }>(
  request: Request,
  enterpriseId: string,
  result: T,
) {
  const imageUrls: Array<string | null | undefined> = [];
  for (const item of result.data) {
    const workflow = item as WorkflowListItem;
    imageUrls.push(
      typeof workflow.coverImageUrl === 'string' ? workflow.coverImageUrl : undefined,
      getGenerationImageUrl(workflow.latestGeneration, { requireSucceeded: true }),
      getGenerationImageUrl(workflow.selectedGeneration, { requireSucceeded: true }),
      getGenerationImageUrl(workflow.latestGeneration),
      getGenerationImageUrl(workflow.selectedGeneration),
    );
  }
  const displayByAssetId = await resolveStudioDisplayByAssetId(request, enterpriseId, imageUrls);

  return {
    ...result,
    data: result.data.map((item) => {
      const workflow = item as WorkflowListItem;
      const coverSource = typeof workflow.coverImageUrl === 'string'
        ? workflow.coverImageUrl
        : getGenerationImageUrl(workflow.latestGeneration, { requireSucceeded: true })
          || getGenerationImageUrl(workflow.selectedGeneration, { requireSucceeded: true });
      const coverUrl = rewriteStudioImageUrl(request, enterpriseId, coverSource, displayByAssetId);
      return {
        ...workflow,
        coverUrl,
        coverImageUrl: coverUrl,
        latestGeneration: signGenerationForMini(request, enterpriseId, workflow.latestGeneration, displayByAssetId),
        selectedGeneration: signGenerationForMini(request, enterpriseId, workflow.selectedGeneration, displayByAssetId),
      };
    }),
  };
}

type WorkflowContext = Awaited<ReturnType<typeof import('@/lib/ai/postgres-workflow-service').getPostgresAiWorkflowContext>>;

export async function serializeWorkflowContextForMini(
  request: Request,
  enterpriseId: string,
  context: WorkflowContext,
) {
  const publishedCount = context.publishedScheme?.generationIds.length ?? 0;
  const publishedIds = new Set(context.publishedScheme?.generationIds.map((id) => String(id)) ?? []);
  const coverSource = context.generations.find((generation) => (
    publishedIds.has(String(generation.id)) && getGenerationImageUrl(generation, { requireSucceeded: true })
  )) || context.generations.find((generation) => getGenerationImageUrl(generation, { requireSucceeded: true }));
  const imageUrls = [
    getGenerationImageUrl(coverSource, { requireSucceeded: true }),
    getGenerationImageUrl(context.workflow.latestGeneration, { requireSucceeded: true }),
    getGenerationImageUrl(context.workflow.latestGeneration as Record<string, unknown> | undefined),
    ...context.generations.map((generation) => getGenerationImageUrl(generation)),
  ];
  const displayByAssetId = await resolveStudioDisplayByAssetId(request, enterpriseId, imageUrls);
  const coverUrl = rewriteStudioImageUrl(
    request,
    enterpriseId,
    getGenerationImageUrl(coverSource, { requireSucceeded: true })
      || getGenerationImageUrl(context.workflow.latestGeneration, { requireSucceeded: true }),
    displayByAssetId,
  );
  return {
    workflow: {
      ...context.workflow,
      publishedCount,
      coverUrl,
      floorPlanPreviewUrl: context.workflow.floorPlanPreviewUrl
        ? getSignedMiniAiStudioFloorPlanPreviewUrl({
            request,
            workflowId: String(context.workflow.id),
            enterpriseId,
          })
        : undefined,
      latestGeneration: signGenerationForMini(
        request,
        enterpriseId,
        context.workflow.latestGeneration as Record<string, unknown> | undefined,
        displayByAssetId,
      ),
    },
    lead: context.lead,
    generations: context.generations.map((generation) => ({
      ...generation,
      imageUrl: rewriteStudioImageUrl(
        request,
        enterpriseId,
        getGenerationImageUrl(generation),
        displayByAssetId,
      ),
    })),
    publishedScheme: context.publishedScheme,
  };
}

type CreationTaskView = Parameters<typeof serializePostgresCreationTask>[0];

export async function serializeCreationTaskForMini(
  request: Request,
  enterpriseId: string,
  task: CreationTaskView,
) {
  const serialized = serializePostgresCreationTask(task);
  const imageUrls = serialized.batches.flatMap((batch) =>
    batch.generations.map((generation) => generation.imageUrl)
  );
  const displayByAssetId = await resolveStudioDisplayByAssetId(request, enterpriseId, imageUrls);
  return {
    ...serialized,
    batches: serialized.batches.map((batch) => ({
      ...batch,
      generations: batch.generations.map((generation) => ({
        ...generation,
        imageUrl: rewriteStudioImageUrl(request, enterpriseId, generation.imageUrl, displayByAssetId),
      })),
    })),
  };
}

export async function serializeAssetPreviewForMini(
  request: Request,
  enterpriseId: string,
  asset: { id: bigint | string; mimeType?: string; size?: number; width?: number; height?: number },
) {
  const assetId = asset.id.toString();
  const displayByAssetId = await resolveMediaAssetDisplayUrls({
    request,
    enterpriseId,
    assetIds: [assetId],
  });
  return {
    id: assetId,
    mimeType: asset.mimeType,
    size: asset.size,
    width: asset.width,
    height: asset.height,
    previewUrl: displayByAssetId.get(assetId) || getSignedMiniAiAssetUrl({
      request,
      assetId,
      enterpriseId,
      ttlSeconds: mediaAssetDisplayUrlTtlSeconds(),
      alignDeadline: true,
    }),
  };
}

type PromptTemplateList = Awaited<ReturnType<typeof import('@/lib/ai/prompt-library-query').listActivePromptTemplates>>;

/** Rewrite template covers onto the signed Mini recipe-preview endpoint (WeChat-loadable). */
export function serializePromptTemplatesForMini(
  request: Request,
  enterpriseId: string,
  payload: PromptTemplateList,
) {
  return {
    ...payload,
    items: payload.items.map((template) => {
      const hasPreview = Boolean(template.previewUrl || template.localPreviewUrl);
      return {
        id: template.id,
        name: template.name,
        promptContent: template.promptContent,
        categorySourceId: template.categorySourceId,
        bestModelSourceId: template.bestModelSourceId,
        recommendedModelProfileId: template.recommendedModelProfileId,
        parameterTemplateSourceId: template.parameterTemplateSourceId,
        adaptationModel: template.adaptationModel,
        weight: template.weight,
        previewUrl: hasPreview
          ? getSignedMiniAiRecipePreviewUrl({
              request,
              recipeId: template.id,
              enterpriseId,
            })
          : undefined,
      };
    }),
  };
}
