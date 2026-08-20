import { AiCreationRepository, FloorPlanRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { renderMiniAiFloorPlanControlPng } from '@/lib/ai/mini-ai-floorplan';
import {
  readPostgresMediaAssetBuffer,
  storePostgresMediaBuffer,
} from '@/lib/ai/postgres-media-assets';
import { isFormalSurveyLayout } from '@/lib/survey-graph';
import {
  FLOOR_PLAN_SNAPSHOT_SIZE,
  renderSurveyFloorPlanSnapshotPng,
  surveyCanvasRenderRevision,
} from '@/lib/survey-floor-plan-snapshot';

export type FloorPlanPreviewSource = {
  id: bigint;
  enterpriseId: bigint | null;
  layoutData: unknown;
  status?: string | null;
  previewAssetId?: bigint | null;
  previewRenderRevision?: string | null;
};

function canPersistSnapshot(plan: FloorPlanPreviewSource) {
  return Boolean(
    plan.enterpriseId
    && plan.status === 'completed'
    && isFormalSurveyLayout(plan.layoutData)
  );
}

async function readStoredSnapshotBuffer(input: {
  enterpriseId: bigint;
  assetId: bigint;
}) {
  const asset = await withTenantTransaction(input.enterpriseId, (transaction) =>
    new AiCreationRepository(transaction).findMediaAsset(input.assetId)
  );
  if (!asset || asset.deletedAt || asset.ownerType !== 'floor_plan_preview') return null;
  try {
    return await readPostgresMediaAssetBuffer(asset);
  } catch (error) {
    console.error('[floor-plan-preview] failed to read stored snapshot', error);
    return null;
  }
}

export async function ensureFloorPlanPreviewSnapshot(
  plan: FloorPlanPreviewSource,
  options: { force?: boolean } = {},
) {
  if (!canPersistSnapshot(plan) || !plan.enterpriseId) return null;
  const enterpriseId = plan.enterpriseId;
  const revision = surveyCanvasRenderRevision();
  if (
    !options.force
    && plan.previewAssetId
    && plan.previewRenderRevision === revision
  ) {
    const stored = await readStoredSnapshotBuffer({
      enterpriseId,
      assetId: plan.previewAssetId,
    });
    if (stored) {
      return { buffer: stored, assetId: plan.previewAssetId, revision };
    }
  }

  let buffer: Buffer;
  try {
    buffer = renderSurveyFloorPlanSnapshotPng(plan.layoutData, FLOOR_PLAN_SNAPSHOT_SIZE);
  } catch (error) {
    console.error('[floor-plan-preview] canvas snapshot failed', error);
    return null;
  }

  const stored = await storePostgresMediaBuffer({
    enterpriseId,
    ownerType: 'floor_plan_preview',
    ownerId: plan.id,
    mimeType: 'image/png',
    buffer,
    width: FLOOR_PLAN_SNAPSHOT_SIZE,
    height: FLOOR_PLAN_SNAPSHOT_SIZE,
  });
  await withTenantTransaction(enterpriseId, (transaction) =>
    new FloorPlanRepository(transaction).update(plan.id, {
      previewAssetId: stored.asset.id,
      previewRenderRevision: revision,
    })
  );
  return { buffer, assetId: stored.asset.id, revision };
}

export async function persistCompletedFloorPlanPreview(
  plan: FloorPlanPreviewSource | null | undefined,
) {
  if (!plan) return null;
  try {
    return await ensureFloorPlanPreviewSnapshot(plan, { force: true });
  } catch (error) {
    console.error('[floor-plan-preview] persist failed', error);
    return null;
  }
}

function withSnapshotFields<T extends FloorPlanPreviewSource>(
  plan: T,
  snapshot: Awaited<ReturnType<typeof ensureFloorPlanPreviewSnapshot>>,
) {
  return snapshot
    ? {
        ...plan,
        previewAssetId: snapshot.assetId,
        previewRenderRevision: snapshot.revision,
      }
    : plan;
}

export async function persistAndAttachFloorPlanPreview<T extends FloorPlanPreviewSource>(
  plan: T,
) {
  return withSnapshotFields(plan, await persistCompletedFloorPlanPreview(plan));
}

export async function resolveFloorPlanControlPng(plan: FloorPlanPreviewSource) {
  const snapshot = await ensureFloorPlanPreviewSnapshot(plan);
  if (snapshot) return snapshot.buffer;
  try {
    return renderSurveyFloorPlanSnapshotPng(plan.layoutData, FLOOR_PLAN_SNAPSHOT_SIZE);
  } catch (error) {
    console.error('[floor-plan-preview] falling back to SVG control image', error);
    return renderMiniAiFloorPlanControlPng(plan.layoutData);
  }
}

export async function renderFloorPlanPreviewPng(plan: FloorPlanPreviewSource) {
  const snapshot = await ensureFloorPlanPreviewSnapshot(plan);
  if (snapshot) return snapshot.buffer;
  return renderSurveyFloorPlanSnapshotPng(plan.layoutData, FLOOR_PLAN_SNAPSHOT_SIZE);
}
