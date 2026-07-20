'use client';

import React, { useMemo, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ImageCropperDialog from '@/components/ai-studio/ImageCropperDialog';
import { notify } from '@/components/ui/operation-feedback';
import { useFetch } from '@/hooks/useFetch';
import {
  ADVANCED_WORKFLOW_TOOLS,
  MAIN_WORKFLOW_STAGES,
  getWorkflowStageDefinition,
  type AiWorkflowSourceAssetRole,
  type AiWorkflowStageKey,
} from '@/lib/ai/workflow-stages';

export type WorkflowRunnerActionStatus = 'ready' | 'blocked' | 'requires_user_input';
export type WorkflowRunnerUserInputType = 'crop_image' | 'upload_image' | 'confirm';

export interface WorkflowRunnerAction {
  stageKey: AiWorkflowStageKey;
  label: string;
  status: WorkflowRunnerActionStatus;
  userInputType?: WorkflowRunnerUserInputType;
  disabledReason?: string;
  referenceImageUrl?: string;
}

export interface WorkflowRunnerGeneration {
  id: string;
  stageKey?: AiWorkflowStageKey;
  sourceAssetRole?: AiWorkflowSourceAssetRole;
  isSelectedBaseline?: boolean;
  status?: string;
  input?: {
    styleReferenceImage?: string;
    customPrompt?: string;
  };
  output?: {
    imageUrl?: string;
    promptUsed?: string;
  };
  createdAt?: string;
}

export interface WorkflowRunnerSummary {
  id: string;
  sourceImage?: string;
  sourceFloorPlanId?: string;
  sourceAssetRole?: AiWorkflowSourceAssetRole;
  currentStageKey?: AiWorkflowStageKey;
  selectedGenerationId?: string;
}

export interface WorkflowRunnerDetail {
  workflow: WorkflowRunnerSummary;
  generations: WorkflowRunnerGeneration[];
}

type RunStageInput = {
  workflowId: string;
  stageKey: AiWorkflowStageKey;
  styleReferenceImage?: string;
};

type UseAiWorkflowRunnerOptions = {
  workflowId?: string | null;
  workflowDetail?: WorkflowRunnerDetail | null;
  fetchDetail?: boolean;
  onWorkflowDetailChange?: (detail: WorkflowRunnerDetail) => void;
  onAfterAction?: () => Promise<void> | void;
  runStageRequest?: (input: RunStageInput) => Promise<WorkflowRunnerDetail | void>;
  showSuccessNotification?: boolean;
};

async function readJsonResponse(res: Response) {
  try {
    return await res.json();
  } catch {
    return { success: false, error: '服务响应异常' };
  }
}

function resolveSelectedBaseline(workflow?: WorkflowRunnerSummary, generations: WorkflowRunnerGeneration[] = []) {
  return (
    generations.find((generation) => generation.isSelectedBaseline) ||
    (workflow?.selectedGenerationId
      ? generations.find((generation) => generation.id === workflow.selectedGenerationId)
      : undefined)
  );
}

export function resolveWorkflowParentGeneration(
  stageKey: AiWorkflowStageKey | undefined,
  workflow?: WorkflowRunnerSummary,
  generations: WorkflowRunnerGeneration[] = []
) {
  if (!stageKey) return undefined;
  if (stageKey === 'direction' || stageKey === 'premium_board' || stageKey === 'perspective_upgrade') {
    return undefined;
  }

  const selectedBaseline = resolveSelectedBaseline(workflow, generations);

  if (stageKey === 'base_render') {
    return generations.find((generation) => generation.stageKey === 'direction');
  }

  if (stageKey === 'soft_furnishing') {
    return selectedBaseline || generations.find((generation) => generation.stageKey === 'base_render');
  }

  return (
    selectedBaseline ||
    generations.find((generation) => generation.stageKey === 'soft_furnishing') ||
    generations.find((generation) => generation.stageKey === 'base_render')
  );
}

function resolveCropReferenceImage(
  stageKey: AiWorkflowStageKey,
  workflow?: WorkflowRunnerSummary,
  generations: WorkflowRunnerGeneration[] = []
) {
  if (stageKey !== 'base_render') {
    return undefined;
  }

  const directionGeneration = generations.find(
    (generation) => generation.stageKey === 'direction' && generation.output?.imageUrl
  );

  return directionGeneration?.output?.imageUrl;
}

export function buildWorkflowActionPlan(
  stageKey: AiWorkflowStageKey,
  workflow?: WorkflowRunnerSummary,
  generations: WorkflowRunnerGeneration[] = []
): WorkflowRunnerAction {
  const definition = getWorkflowStageDefinition(stageKey);
  const label = definition?.actionLabel || definition?.name || '执行下一步';

  if (!workflow) {
    return {
      stageKey,
      label,
      status: 'blocked',
      disabledReason: '请先选择一个方案会话',
    };
  }

  if (stageKey === 'direction') {
    return workflow.sourceImage || workflow.sourceFloorPlanId
      ? { stageKey, label, status: 'ready' }
      : { stageKey, label, status: 'blocked', disabledReason: '需要先提供起点素材或户型图' };
  }

  if (stageKey === 'base_render') {
    const referenceImageUrl = resolveCropReferenceImage(stageKey, workflow, generations);
    return referenceImageUrl
      ? {
          stageKey,
          label,
          status: 'requires_user_input',
          userInputType: 'crop_image',
          referenceImageUrl,
        }
      : workflow.sourceImage || workflow.sourceFloorPlanId
        ? { stageKey, label, status: 'ready' }
        : { stageKey, label, status: 'blocked', disabledReason: '需要先提供起点素材或户型图' };
  }

  if (stageKey === 'premium_board') {
    return (workflow.sourceImage || workflow.sourceFloorPlanId) && workflow.sourceAssetRole === 'concept_element'
      ? { stageKey, label, status: 'ready' }
      : { stageKey, label, status: 'blocked', disabledReason: '高端提案工具需要概念元素图作为起点素材' };
  }

  if (stageKey === 'perspective_upgrade') {
    return workflow.sourceImage || workflow.sourceFloorPlanId
      ? { stageKey, label, status: 'ready' }
      : { stageKey, label, status: 'blocked', disabledReason: '需要先提供户型图或彩平素材' };
  }

  const parentGeneration = resolveWorkflowParentGeneration(stageKey, workflow, generations);
  return parentGeneration
    ? { stageKey, label, status: 'ready' }
    : { stageKey, label, status: 'blocked', disabledReason: '当前步骤缺少上一阶段产物，请先完成前一阶段或设为当前定稿' };
}

export function useAiWorkflowRunner(options: UseAiWorkflowRunnerOptions) {
  const {
    workflowId,
    workflowDetail: externalDetail,
    fetchDetail = true,
    onWorkflowDetailChange,
    onAfterAction,
    runStageRequest,
    showSuccessNotification = true,
  } = options;
  const [isRunning, setIsRunning] = useState(false);
  const [runningStageKey, setRunningStageKey] = useState<AiWorkflowStageKey | null>(null);
  const [cropAction, setCropAction] = useState<WorkflowRunnerAction | null>(null);
  const [cropImageUrl, setCropImageUrl] = useState('');
  const [isCropDialogOpen, setIsCropDialogOpen] = useState(false);
  const { data: fetchedDetail, mutate, isLoading } = useFetch<WorkflowRunnerDetail>(
    fetchDetail && workflowId ? `/api/ai/workflows/${workflowId}` : null
  );

  const workflowDetail = externalDetail || fetchedDetail;
  const workflow = workflowDetail?.workflow;
  const generations = useMemo(() => workflowDetail?.generations || [], [workflowDetail?.generations]);

  const actions = useMemo(
    () =>
      [...MAIN_WORKFLOW_STAGES, ...ADVANCED_WORKFLOW_TOOLS].map((stage) =>
        buildWorkflowActionPlan(stage.key, workflow, generations)
      ),
    [generations, workflow]
  );

  const refresh = async () => {
    const refreshed = await mutate();
    if (refreshed?.success && refreshed.data) {
      onWorkflowDetailChange?.(refreshed.data);
      return refreshed.data;
    }
    return workflowDetail || null;
  };

  const executeStage = async (action: WorkflowRunnerAction, styleReferenceImage?: string) => {
    if (!workflowId) {
      notify.error('请先选择一个方案会话');
      return;
    }

    setIsRunning(true);
    setRunningStageKey(action.stageKey);
    const loadingId = notify.loading(`正在执行 ${action.label}...`);

    try {
      const result = runStageRequest
        ? await runStageRequest({ workflowId, stageKey: action.stageKey, styleReferenceImage })
        : await (async () => {
            const res = await fetch(`/api/ai/workflows/${workflowId}/run-stage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                stageKey: action.stageKey,
                styleReferenceImage,
                confirmed: true,
              }),
            });
            const json = await readJsonResponse(res);
            if (!res.ok || !json.success) {
              throw Object.assign(new Error(json.error || '执行工作流步骤失败'), { status: res.status });
            }
            return json.data as WorkflowRunnerDetail;
          })();

      notify.dismiss(loadingId);
      if (result) {
        onWorkflowDetailChange?.(result);
        await mutate(result ? { success: true, data: result } : undefined, { revalidate: false });
      } else {
        await refresh();
      }
      await onAfterAction?.();
      if (showSuccessNotification) {
        const latestStatus = result?.generations?.[0]?.status;
        if (latestStatus === 'created' || latestStatus === 'pending' || latestStatus === 'processing') {
          notify.info(`${action.label}已提交，正在后台生成`);
        } else {
          notify.success(`${action.label}已完成`);
        }
      }
    } catch (error) {
      notify.dismiss(loadingId);
      notify.fromAlert(error);
    } finally {
      setIsRunning(false);
      setRunningStageKey(null);
    }
  };

  const runAction = async (action: WorkflowRunnerAction) => {
    if (action.status === 'blocked') {
      notify.info(action.disabledReason || '当前步骤暂不可执行');
      return;
    }

    if (action.userInputType === 'crop_image') {
      if (!action.referenceImageUrl) {
        notify.info(action.disabledReason || '请先完成上一阶段后再继续');
        return;
      }
      setCropAction(action);
      setCropImageUrl(action.referenceImageUrl);
      setIsCropDialogOpen(true);
      return;
    }

    await executeStage(action);
  };

  const cropDialog = (
    <ImageCropperDialog
      open={isCropDialogOpen}
      onOpenChange={(open) => {
        setIsCropDialogOpen(open);
        if (!open) {
          setCropAction(null);
          setCropImageUrl('');
        }
      }}
      imageUrl={cropImageUrl}
      onCropComplete={async (croppedDataUrl) => {
        if (!cropAction) return;
        await executeStage(cropAction, croppedDataUrl);
        setCropAction(null);
        setCropImageUrl('');
      }}
    />
  );

  return {
    workflowDetail,
    actions,
    runAction,
    refresh,
    cropDialog,
    isLoading,
    isRunning,
    runningStageKey,
  };
}

export function WorkflowStageActionButton({
  action,
  isRunning,
  onRun,
  className,
  idlePrefix,
}: {
  action: WorkflowRunnerAction;
  isRunning?: boolean;
  onRun: (action: WorkflowRunnerAction) => void;
  className?: string;
  idlePrefix?: React.ReactNode;
}) {
  const disabled = isRunning || action.status === 'blocked';

  return (
    <Button
      type="button"
      disabled={disabled}
      title={action.disabledReason}
      onClick={() => onRun(action)}
      className={className}
    >
      {isRunning ? <Loader2 className="mr-2 animate-spin" size={16} /> : idlePrefix || <Sparkles className="mr-2" size={16} />}
      {action.label}
    </Button>
  );
}

export function WorkflowActionPanel({
  actions,
  stageKey,
  isRunning,
  runningStageKey,
  onRun,
}: {
  actions: WorkflowRunnerAction[];
  stageKey?: AiWorkflowStageKey;
  isRunning?: boolean;
  runningStageKey?: AiWorkflowStageKey | null;
  onRun: (action: WorkflowRunnerAction) => void;
}) {
  const visibleActions = stageKey ? actions.filter((action) => action.stageKey === stageKey) : actions;

  return (
    <>
      {visibleActions.map((action) => (
        <WorkflowStageActionButton
          key={action.stageKey}
          action={action}
          isRunning={isRunning && runningStageKey === action.stageKey}
          onRun={onRun}
          className="rounded-2xl bg-zinc-950 px-5 text-white hover:bg-zinc-800"
        />
      ))}
    </>
  );
}
