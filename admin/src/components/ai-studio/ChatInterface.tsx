'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Send,
  User,
  Bot,
  Loader2,
  Sparkles,
  PlusCircle,
  Trash2,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ArrowRight,
  Workflow,
  UserRound,
  PlayCircle,
  RefreshCw,
  Upload,
  PanelRightOpen,
} from 'lucide-react';
import { Button, Drawer, Input, Modal, Tag } from 'antd';
import { cn } from '@/lib/utils';
import { notify } from '@/components/admin/operation-feedback';
import type { ChatAction, ChatCard, ChatFloorPlanOption, ChatUiPayload, ChatWorkflowDetail } from '@/lib/ai/chat-ui';
import {
  useAiWorkflowRunner,
  WorkflowActionPanel,
  type WorkflowRunnerDetail,
} from '@/components/ai-studio/workflow-runner';
import {
  ADVANCED_WORKFLOW_TOOLS,
  MAIN_WORKFLOW_STAGES,
  getWorkflowStageDefinition,
  type AiWorkflowStageKey,
} from '@/lib/ai/workflow-stages';

type ConfirmToolAction = Extract<ChatAction, { kind: 'confirm_tool' }>;

type FloorPlanPickerState = {
  action: ConfirmToolAction;
  leadTitle: string;
  floorPlans: ChatFloorPlanOption[];
};

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  uiPayload?: ChatUiPayload;
}

interface Conversation {
  _id: string;
  title: string;
  lastMessageAt: string;
  createdAt: string;
}

interface ChatInterfaceProps {
  onSendMessage: (content: string, contextHint?: string) => Promise<void>;
  messages: Message[];
  isLoading: boolean;
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  onDeleteConversation: (id: string) => void;
  onRunAction: (action: ConfirmToolAction) => Promise<void>;
}

const QUICK_ACTIONS = [
  "帮我找一下最近的客资",
  "推荐几个适合大户型的现代风格",
  "查看最近完成的户型图",
  "我该如何提高转化率？"
];

type WorkflowTimelineItem = NonNullable<ChatWorkflowDetail['timeline']>[number];

type WorkflowResultItem = WorkflowTimelineItem & {
  stageKey?: AiWorkflowStageKey;
  stageLabel: string;
};

const WORKFLOW_RESULT_STAGES = [...MAIN_WORKFLOW_STAGES, ...ADVANCED_WORKFLOW_TOOLS];

function normalizeWorkflowStageKey(stageKey?: string): AiWorkflowStageKey | undefined {
  if (!stageKey) {
    return undefined;
  }

  return getWorkflowStageDefinition(stageKey) ? (stageKey as AiWorkflowStageKey) : undefined;
}

function getWorkflowStageLabel(stageKey?: string, fallback?: string) {
  return getWorkflowStageDefinition(stageKey)?.name || fallback || stageKey || '未命名阶段';
}

function buildWorkflowResultItems(workflowId: string, detail?: ChatWorkflowDetail): WorkflowResultItem[] {
  if (!detail) {
    return [];
  }

  const items: WorkflowResultItem[] = [];
  const seenIds = new Set<string>();

  for (const item of detail.timeline || []) {
    if (!item.id || seenIds.has(item.id)) {
      continue;
    }

    seenIds.add(item.id);
    items.push({
      ...item,
      stageKey: normalizeWorkflowStageKey(item.stageKey),
      stageLabel: getWorkflowStageLabel(item.stageKey, item.stageLabel),
    });
  }

  const latest = detail.latestGeneration;
  if (latest?.imageUrl) {
    const latestStageKey = normalizeWorkflowStageKey(latest.stageKey);
    const alreadyIncluded = items.some((item) =>
      item.imageUrl === latest.imageUrl &&
      item.createdAt === latest.createdAt &&
      item.stageKey === latestStageKey
    );

    if (!alreadyIncluded) {
      items.unshift({
        id: `${workflowId}-latest`,
        stageKey: latestStageKey,
        stageLabel: getWorkflowStageLabel(latest.stageKey, latest.stageLabel),
        status: latest.status,
        createdAt: latest.createdAt,
        imageUrl: latest.imageUrl,
      });
    }
  }

  return items;
}

export default function ChatInterface({ 
  onSendMessage, 
  messages, 
  isLoading,
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  onRunAction
}: ChatInterfaceProps) {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [pendingAction, setPendingAction] = useState<ConfirmToolAction | null>(null);
  const [pendingUploadAction, setPendingUploadAction] = useState<ConfirmToolAction | null>(null);
  const [floorPlanPicker, setFloorPlanPicker] = useState<FloorPlanPickerState | null>(null);
  const [selectedFloorPlanId, setSelectedFloorPlanId] = useState('');
  const [isActionRunning, setIsActionRunning] = useState(false);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [selectedWorkflowStageById, setSelectedWorkflowStageById] = useState<Record<string, AiWorkflowStageKey>>({});
  const [selectedWorkflowGenerationById, setSelectedWorkflowGenerationById] = useState<Record<string, string>>({});
  const [isWorkflowSheetOpen, setIsWorkflowSheetOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const latestContext = React.useMemo(() => {
    const assistantMessages = messages.filter((message) => message.role === 'assistant');

    for (let index = assistantMessages.length - 1; index >= 0; index -= 1) {
      const cards = assistantMessages[index].uiPayload?.cards || [];
      for (let cardIndex = cards.length - 1; cardIndex >= 0; cardIndex -= 1) {
        const card = cards[cardIndex];
        if (card.type === 'workflow') {
          const continueAction = card.actions.find(
            (action) => action.kind === 'navigate' && action.value.includes('/ai-studio/scenarios?')
          );
          const leadId = continueAction?.kind === 'navigate'
            ? new URLSearchParams(continueAction.value.split('?')[1] || '').get('leadId') || undefined
            : undefined;

          return {
            label: `当前方案：${card.title}`,
            hint: `当前上下文：workflowId=${card.id}${leadId ? `，leadId=${leadId}` : ''}`,
          };
        }

        if (card.type === 'lead') {
          return {
            label: `当前客户：${card.title}`,
            hint: `当前上下文：leadId=${card.id}`,
          };
        }

        if (card.type === 'workflow_empty') {
          return {
            label: `当前客户：${card.title}`,
            hint: `当前上下文：leadId=${card.id}`,
          };
        }
      }
    }

    return undefined;
  }, [messages]);

  const workflowCards = React.useMemo(
    () =>
      messages.flatMap((message) =>
        (message.uiPayload?.cards || []).filter(
          (card): card is Extract<ChatCard, { type: 'workflow' }> => card.type === 'workflow'
        )
      ),
    [messages]
  );

  const activeWorkflowCard = React.useMemo(() => {
    if (workflowCards.length === 0) {
      return undefined;
    }

    return (
      [...workflowCards].reverse().find((card) => card.id === selectedWorkflowId) ||
      workflowCards[workflowCards.length - 1]
    );
  }, [selectedWorkflowId, workflowCards]);

  const latestWorkflowId = workflowCards[workflowCards.length - 1]?.id;

  useEffect(() => {
    if (latestWorkflowId) {
      setSelectedWorkflowId(latestWorkflowId);
    }
  }, [latestWorkflowId]);

  const runnerWorkflowDetail = React.useMemo<WorkflowRunnerDetail | null>(() => {
    if (!activeWorkflowCard) {
      return null;
    }

    const detail = activeWorkflowCard.detail;
    const generations = [
      ...(detail?.latestGeneration?.imageUrl
        ? [
            {
              id: `${activeWorkflowCard.id}-latest`,
              stageKey: detail.latestGeneration.stageKey as AiWorkflowStageKey | undefined,
              status: detail.latestGeneration.status,
              output: { imageUrl: detail.latestGeneration.imageUrl },
              createdAt: detail.latestGeneration.createdAt,
            },
          ]
        : []),
      ...(detail?.timeline || []).map((item) => ({
        id: item.id,
        stageKey: item.stageKey as AiWorkflowStageKey | undefined,
        status: item.status,
        isSelectedBaseline: item.isSelectedBaseline,
        output: { imageUrl: item.imageUrl },
        createdAt: item.createdAt,
      })),
    ];

    return {
      workflow: {
        id: activeWorkflowCard.id,
        currentStageKey: detail?.recommendedNextAction?.stageKey as AiWorkflowStageKey | undefined,
      },
      generations,
    };
  }, [activeWorkflowCard]);

  const workflowRunner = useAiWorkflowRunner({
    workflowId: activeWorkflowCard?.id,
    workflowDetail: runnerWorkflowDetail,
    fetchDetail: false,
    showSuccessNotification: false,
    runStageRequest: async ({ workflowId, stageKey, styleReferenceImage }) => {
      await onRunAction({
        label: '执行工作流步骤',
        kind: 'confirm_tool',
        actionName: 'run_workflow_stage',
        arguments: {
          workflowId,
          stageKey,
          ...(styleReferenceImage ? { styleReferenceImage } : {}),
        },
        confirmTitle: '确认执行该工作流步骤？',
        confirmDescription: '系统会按当前工作流规则继续生成下一阶段产物。',
        variant: 'primary',
      });
    },
  });

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;
    onSendMessage(input, latestContext?.hint);
    setInput('');
  };

  const handleQuickAction = (action: string) => {
    if (isLoading) return;
    onSendMessage(action);
  };

  const compressImageFile = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) {
        reject(new Error('请上传图片文件'));
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => reject(new Error('图片读取失败'));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error('图片加载失败'));
        image.onload = () => {
          const maxSide = 1600;
          const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
          const width = Math.max(1, Math.round(image.width * scale));
          const height = Math.max(1, Math.round(image.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          if (!context) {
            reject(new Error('图片压缩失败'));
            return;
          }
          context.drawImage(image, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        image.src = String(reader.result || '');
      };
      reader.readAsDataURL(file);
    });
  };

  const runAction = async (action: ConfirmToolAction) => {
    setIsActionRunning(true);
    try {
      await onRunAction(action);
    } finally {
      setIsActionRunning(false);
    }
  };

  const handleChatAction = (action: ChatAction, card?: ChatCard) => {
    if (isLoading || isActionRunning) return;

    if (action.kind === 'prompt') {
      const fallbackText =
        card?.type === 'lead'
          ? `查看${card.title}的 AI 设计工作流`
          : card?.type === 'workflow'
            ? `查看${card.title}的 AI 设计工作流详情`
            : action.value.replace(/\b[a-f0-9]{24}\b/gi, '该对象');
      const displayText = action.displayText || fallbackText;
      const hiddenContext = action.hiddenContext || (displayText !== action.value ? action.value : undefined);
      onSendMessage(displayText, hiddenContext);
      return;
    }

    if (action.kind === 'confirm_tool') {
      if (action.actionName === 'run_workflow_stage') {
        const runnerAction = workflowRunner.actions.find(
          (item) => item.stageKey === action.arguments.stageKey
        );
        if (runnerAction) {
          workflowRunner.runAction(runnerAction);
        } else {
          setPendingAction(action);
        }
        return;
      }

      if (action.actionName === 'create_workflow' && action.needsUpload) {
        setPendingUploadAction(action);
        fileInputRef.current?.click();
        return;
      }

      if (action.actionName === 'create_workflow' && action.needsFloorPlanSelection) {
        const floorPlans = card?.type === 'workflow_empty' ? card.floorPlans || [] : [];
        setSelectedFloorPlanId(floorPlans[0]?.id || '');
        setFloorPlanPicker({
          action,
          leadTitle: card?.title || '该客户',
          floorPlans,
        });
        return;
      }

      setPendingAction(action);
      return;
    }

    router.push(action.value);
  };

  const handleConfirmAction = async () => {
    if (!pendingAction) return;

    await runAction(pendingAction);
    setPendingAction(null);
  };

  const handleFloorPlanCreate = async () => {
    if (!floorPlanPicker) return;
    if (!selectedFloorPlanId) {
      notify.fromAlert('当前客户暂无户型图，请上传参考图创建');
      return;
    }

    await runAction({
      ...floorPlanPicker.action,
      arguments: {
        ...floorPlanPicker.action.arguments,
        sourceFloorPlanId: selectedFloorPlanId,
        sourceAssetRole: 'floor_plan',
      },
    });
    setFloorPlanPicker(null);
    setSelectedFloorPlanId('');
  };

  const handleReferenceImageSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !pendingUploadAction) return;

    try {
      const sourceImage = await compressImageFile(file);
      await runAction({
        ...pendingUploadAction,
        arguments: {
          ...pendingUploadAction.arguments,
          sourceImage,
          sourceAssetRole: 'rough_sketch',
        },
      });
    } catch (error) {
      notify.fromAlert(error);
    } finally {
      setPendingUploadAction(null);
    }
  };

  const renderChatAction = (action: ChatAction, index: number, card?: ChatCard) => {
    const isPrimary = action.variant === 'primary';
    const Icon =
      action.kind === 'navigate'
        ? ExternalLink
        : action.kind === 'confirm_tool'
          ? action.needsUpload
            ? Upload
            : action.actionName === 'refresh_workflow_detail'
            ? RefreshCw
            : PlayCircle
          : ArrowRight;

    return (
      <Button
        key={`${action.kind}-${action.kind === 'confirm_tool' ? action.actionName : action.value}-${index}`}
        htmlType="button"
        size="small"
        disabled={isLoading || isActionRunning}
        onClick={() => handleChatAction(action, card)}
        className={cn(
          'h-9 rounded-xl px-3 text-xs font-bold',
          isPrimary
            ? 'bg-zinc-900 text-white hover:bg-zinc-800'
            : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
        )}
        icon={<Icon size={14} />}
        iconPosition="end"
      >
        {action.label}
      </Button>
    );
  };

  const renderWorkflowDetail = (workflowId: string, detail?: ChatWorkflowDetail) => {
    if (!detail) {
      return null;
    }

    const progress = detail.progress;
    const latestGeneration = detail.latestGeneration;
    const nextAction = detail.recommendedNextAction;
    const leadInfo = [
      detail.lead?.name,
      detail.lead?.communityName,
      detail.lead?.status,
    ].filter(Boolean).join(' / ');
    const resultItems = buildWorkflowResultItems(workflowId, detail);
    const resultsByStage = resultItems.reduce((groups, item) => {
      if (!item.stageKey) {
        return groups;
      }

      const current = groups.get(item.stageKey) || [];
      groups.set(item.stageKey, [...current, item]);
      return groups;
    }, new Map<AiWorkflowStageKey, WorkflowResultItem[]>());
    const latestStageKey =
      resultItems.find((item) => item.stageKey)?.stageKey ||
      normalizeWorkflowStageKey(latestGeneration?.stageKey) ||
      normalizeWorkflowStageKey(nextAction?.stageKey) ||
      MAIN_WORKFLOW_STAGES[0]?.key;
    const selectedStageKey = selectedWorkflowStageById[workflowId] || latestStageKey;
    const selectedStage = selectedStageKey ? getWorkflowStageDefinition(selectedStageKey) : undefined;
    const selectedStageResults = selectedStageKey ? resultsByStage.get(selectedStageKey) || [] : [];
    const selectedGenerationId = selectedWorkflowGenerationById[workflowId];
    const selectedResult =
      selectedStageResults.find((item) => item.id === selectedGenerationId) ||
      selectedStageResults[0];
    const selectedStageAction = workflowRunner.actions.find((action) => action.stageKey === selectedStageKey);
    const canSelectBaseline = Boolean(
      selectedResult &&
      !selectedResult.isSelectedBaseline &&
      !selectedResult.id.endsWith('-latest')
    );

    return (
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
          <div className="rounded-xl bg-white px-3 py-2.5">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">关联客户</p>
            <p className="mt-1 truncate text-xs font-bold text-zinc-800">{leadInfo || '暂无客户信息'}</p>
          </div>
          <div className="rounded-xl bg-white px-3 py-2.5">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">进度</p>
            <p className="mt-1 text-xs font-bold text-zinc-800">
              已完成 {progress?.completedStageCount ?? 0} / 可执行 {progress?.availableStageCount ?? 0} / 产物 {progress?.generationCount ?? 0}
            </p>
          </div>
          <div className="rounded-xl bg-white px-3 py-2.5">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">阶段版本</p>
            <p className="mt-1 truncate text-xs font-bold text-zinc-800">
              {selectedResult
                ? [selectedResult.stageLabel, selectedResult.status, selectedResult.createdAt].filter(Boolean).join(' / ')
                : '暂无产物'}
            </p>
          </div>
        </div>
        <div className="rounded-2xl border border-zinc-100 bg-zinc-50/80 p-3">
          <div className="grid grid-cols-2 gap-2 2xl:grid-cols-3">
            {WORKFLOW_RESULT_STAGES.map((stage) => {
              const stageResults = resultsByStage.get(stage.key) || [];
              const isSelected = selectedStageKey === stage.key;
              const isNext = nextAction?.stageKey === stage.key;
              const isRunningStage = workflowRunner.runningStageKey === stage.key;
              const outputCount = stageResults.filter((item) => item.imageUrl && item.status !== 'failed').length;
              const hasFailed = stageResults.some((item) => item.status === 'failed');
              const statusText = isRunningStage
                ? '生成中'
                : outputCount > 0
                  ? `${outputCount} 个成果`
                  : hasFailed
                    ? '生成失败'
                  : isNext
                    ? '推荐下一步'
                    : '暂无成果';

              return (
                <button
                  key={stage.key}
                  type="button"
                  onClick={() => {
                    setSelectedWorkflowStageById((current) => ({ ...current, [workflowId]: stage.key }));
                    setSelectedWorkflowGenerationById((current) => {
                      const next = { ...current };
                      delete next[workflowId];
                      return next;
                    });
                  }}
                  className={cn(
                    'rounded-xl border px-3 py-2 text-left transition',
                    isSelected
                      ? 'border-emerald-200 bg-white shadow-sm ring-1 ring-emerald-100'
                      : 'border-transparent bg-white/70 hover:border-zinc-200 hover:bg-white'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-black text-zinc-900">{stage.name}</span>
                    <span
                      className={cn(
                        'h-2 w-2 shrink-0 rounded-full',
                        isRunningStage
                          ? 'bg-blue-500'
                          : outputCount > 0
                            ? 'bg-emerald-500'
                            : hasFailed
                              ? 'bg-red-400'
                              : isNext
                              ? 'bg-amber-400'
                              : 'bg-zinc-300'
                      )}
                    />
                  </div>
                  <p className="mt-1 truncate text-[10px] font-bold text-zinc-500">{statusText}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-100 bg-zinc-50/80 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">当前查看</p>
              <h4 className="mt-1 truncate text-base font-black text-zinc-950">
                {selectedStage?.name || selectedResult?.stageLabel || '工作流成果'}
              </h4>
              <p className="mt-1 text-xs font-semibold text-zinc-500">
                {selectedResult
                  ? [selectedResult.status, selectedResult.createdAt].filter(Boolean).join(' / ')
                  : selectedStage?.description || '该阶段暂时还没有生成成果'}
              </p>
            </div>
            {selectedResult?.isSelectedBaseline && (
              <Tag bordered={false} className="border-none bg-emerald-50 text-[10px] font-black text-emerald-700">
                当前定稿
              </Tag>
            )}
          </div>

          {selectedResult?.imageUrl ? (
            <div className="mt-3 overflow-hidden rounded-xl bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selectedResult.imageUrl}
                alt=""
                className="h-60 w-full object-cover"
                loading="lazy"
              />
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed border-zinc-200 bg-white px-4 py-6 text-center">
              <p className="text-sm font-black text-zinc-900">该阶段暂无成果</p>
              <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-zinc-500">
                {selectedStage?.inputHint && selectedStage?.outputHint
                  ? `${selectedStage.inputHint} -> ${selectedStage.outputHint}`
                  : '可以从这里直接执行该阶段，系统会复用同一套工作流规则。'}
              </p>
              {selectedStageAction && (
                <div className="mt-4 flex justify-center">
                  <WorkflowActionPanel
                    actions={workflowRunner.actions}
                    stageKey={selectedStageAction.stageKey}
                    isRunning={workflowRunner.isRunning || isActionRunning}
                    runningStageKey={workflowRunner.runningStageKey}
                    onRun={workflowRunner.runAction}
                  />
                </div>
              )}
              {selectedStageAction?.disabledReason && (
                <p className="mt-2 text-xs font-semibold text-amber-700">{selectedStageAction.disabledReason}</p>
              )}
            </div>
          )}

          {canSelectBaseline && selectedResult && (
            <Button
              htmlType="button"
              size="small"
              disabled={isLoading || isActionRunning}
              onClick={() =>
                setPendingAction({
                  label: '设为定稿',
                  kind: 'confirm_tool',
                  actionName: 'select_generation_baseline',
                  arguments: { workflowId, generationId: selectedResult.id },
                  confirmTitle: '确认设为当前定稿？',
                  confirmDescription: '该操作会影响后续软装、提案和灯光等步骤使用的来源产物。',
                  variant: 'secondary',
                })
              }
              className="mt-3 h-9 rounded-xl bg-white px-3 text-xs font-bold"
            >
              设为定稿
            </Button>
          )}
        </div>
        {nextAction?.stageLabel && (
          <div className="mt-2 rounded-xl bg-white px-3 py-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">推荐下一步</p>
            <p className="mt-1 text-xs font-bold text-zinc-800">
              {nextAction.stageLabel}
              {nextAction.reason ? `：${nextAction.reason}` : ''}
            </p>
          </div>
        )}
        {detail.blockedReasons && detail.blockedReasons.length > 0 && (
          <div className="mt-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-600">暂不可执行</p>
            <div className="mt-1 space-y-1">
              {detail.blockedReasons.map((reason) => (
                <p key={reason} className="text-xs font-semibold text-amber-800">{reason}</p>
              ))}
            </div>
          </div>
        )}
        {selectedStageResults.length > 1 && (
          <div className="mt-2 rounded-xl bg-white px-3 py-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">最近产物</p>
            <div className="mt-2 space-y-2">
              {selectedStageResults.map((item) => (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    setSelectedWorkflowGenerationById((current) => ({ ...current, [workflowId]: item.id }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedWorkflowGenerationById((current) => ({ ...current, [workflowId]: item.id }));
                    }
                  }}
                  className={cn(
                    'flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 transition',
                    selectedResult?.id === item.id
                      ? 'bg-emerald-50 ring-1 ring-emerald-100'
                      : 'bg-zinc-50 hover:bg-zinc-100'
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-zinc-800">
                      {[item.stageLabel, item.status, item.createdAt].filter(Boolean).join(' / ') || '未命名产物'}
                    </p>
                    {item.isSelectedBaseline && (
                      <p className="mt-0.5 text-[10px] font-black text-emerald-600">当前定稿</p>
                    )}
                  </div>
                  {!item.isSelectedBaseline && !item.id.endsWith('-latest') && (
                    <Button
                      htmlType="button"
                      size="small"
                      disabled={isLoading || isActionRunning}
                      onClick={(event) => {
                        event.stopPropagation();
                        setPendingAction({
                          label: '设为定稿',
                          kind: 'confirm_tool',
                          actionName: 'select_generation_baseline',
                          arguments: { workflowId, generationId: item.id },
                          confirmTitle: '确认设为当前定稿？',
                          confirmDescription: '该操作会影响后续软装、提案和灯光等步骤使用的来源产物。',
                          variant: 'secondary',
                        });
                      }}
                      className="h-7 rounded-lg bg-white px-2 text-[11px] font-bold"
                    >
                      设为定稿
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderWorkflowWorkspace = (card?: Extract<ChatCard, { type: 'workflow' }>) => {
    if (!card) {
      return (
        <div className="flex h-full flex-col items-center justify-center px-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-50 text-zinc-300">
            <Workflow size={26} />
          </div>
          <h3 className="mt-4 text-base font-black text-zinc-900">暂无当前方案</h3>
          <p className="mt-2 max-w-xs text-sm leading-6 text-zinc-500">
            向 Agent 查询客户或 AI 设计工作流后，方案详情会在这里展开，方便查看图片、阶段和下一步操作。
          </p>
        </div>
      );
    }

    const detail = card.detail;
    const leadInfo = [detail?.lead?.name, detail?.lead?.communityName].filter(Boolean).join(' / ');
    const stageText = card.subtitle?.replace(/^当前阶段[:：]\s*/, '') || card.badge || '待确认';

    return (
      <div className="flex h-full min-h-0 flex-col bg-white">
        <div className="border-b border-zinc-100 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Tag bordered={false} className="border-none bg-emerald-50 text-[10px] font-black text-emerald-700">
                  当前工作流
                </Tag>
                {card.badge && (
                  <Tag bordered={false} className="border-none bg-amber-50 text-[10px] font-black text-amber-700">
                    {card.badge}
                  </Tag>
                )}
              </div>
              <h3 className="mt-3 truncate text-lg font-black tracking-tight text-zinc-950">{card.title}</h3>
              <p className="mt-1 truncate text-xs font-semibold text-zinc-500">
                {card.subtitle || leadInfo || 'AI 设计方案工作区'}
              </p>
            </div>
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
              <Workflow size={20} />
            </div>
          </div>
          {card.meta && card.meta.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {card.meta.map((item) => (
                <span
                  key={item}
                  className="rounded-lg bg-zinc-50 px-2.5 py-1 text-[11px] font-bold text-zinc-500"
                >
                  {item}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {detail ? (
            renderWorkflowDetail(card.id, detail)
          ) : (
            <div className="space-y-3">
              <div className="rounded-2xl border border-zinc-100 bg-zinc-50/80 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">方案摘要</p>
                <div className="mt-3 grid gap-2">
                  <div className="rounded-xl bg-white px-3 py-2.5">
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">当前阶段</p>
                    <p className="mt-1 text-sm font-black text-zinc-900">{stageText}</p>
                  </div>
                  {card.meta?.map((item) => (
                    <div key={item} className="rounded-xl bg-white px-3 py-2.5">
                      <p className="text-xs font-bold text-zinc-700">{item}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                <p className="text-xs font-black text-emerald-800">可继续同步完整详情</p>
                <p className="mt-1 text-xs leading-5 text-emerald-700">
                  使用底部的查看详情或刷新状态，可以同步完整阶段进度和产物预览。
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-zinc-100 bg-white p-5">
          <div className="flex flex-wrap gap-2">
            {card.detail?.recommendedNextAction?.stageKey && (
              <WorkflowActionPanel
                actions={workflowRunner.actions}
                stageKey={card.detail.recommendedNextAction.stageKey as AiWorkflowStageKey}
                isRunning={workflowRunner.isRunning || isActionRunning}
                runningStageKey={workflowRunner.runningStageKey}
                onRun={workflowRunner.runAction}
              />
            )}
            {card.actions
              .filter((action) => action.kind !== 'confirm_tool' || action.actionName !== 'run_workflow_stage')
              .map((action, index) => renderChatAction(action, index, card))}
          </div>
        </div>
      </div>
    );
  };

  const renderBusinessCard = (card: ChatCard) => {
    if (card.type === 'workflow') {
      const isActiveWorkflow = activeWorkflowCard?.id === card.id;

      return (
        <div
          key={`${card.type}-${card.id}`}
          className={cn(
            'rounded-2xl border bg-white px-4 py-3 shadow-sm transition-all',
            isActiveWorkflow ? 'border-emerald-200 bg-emerald-50/40' : 'border-zinc-200'
          )}
        >
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <Workflow size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-black text-zinc-900">已定位方案：{card.title}</p>
                {card.badge && (
                  <Tag bordered={false} className="border-none bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">
                    {card.badge}
                  </Tag>
                )}
              </div>
              <p className="mt-1 text-xs font-semibold text-emerald-700 xl:text-zinc-500">
                {isActiveWorkflow ? '详情已在右侧工作区打开' : '点击可切换到右侧工作区'}
              </p>
            </div>
          </div>
          <Button
            htmlType="button"
            size="small"
            onClick={() => {
              setSelectedWorkflowId(card.id);
              setIsWorkflowSheetOpen(true);
            }}
            className="mt-3 h-9 w-full justify-center rounded-xl border-emerald-100 bg-white text-xs font-black text-emerald-700 hover:bg-emerald-50 xl:hidden"
            icon={<PanelRightOpen size={14} />}
          >
            打开方案工作区
          </Button>
          <button
            type="button"
            onClick={() => setSelectedWorkflowId(card.id)}
            className="mt-3 hidden w-full rounded-xl border border-emerald-100 bg-white px-3 py-2 text-xs font-black text-emerald-700 transition-colors hover:bg-emerald-50 xl:block"
          >
            {isActiveWorkflow ? '当前右侧工作区正在显示该方案' : '切换右侧工作区到该方案'}
          </button>
        </div>
      );
    }

    const isLead = card.type === 'lead';
    const Icon = isLead ? UserRound : Workflow;
    const floorPlans = card.type === 'workflow_empty' ? card.floorPlans || [] : [];

    return (
      <div
        key={`${card.type}-${card.id}`}
        className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition-all"
      >
        <div className="flex items-start gap-3">
          <div className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
            isLead ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600'
          )}>
            <Icon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-black text-zinc-900">{card.title}</p>
            </div>
            {card.subtitle && (
              <p className="mt-1 truncate text-xs font-medium text-zinc-500">{card.subtitle}</p>
            )}
            {card.meta && card.meta.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {card.meta.map((item) => (
                  <span
                    key={item}
                    className="rounded-lg bg-zinc-50 px-2 py-1 text-[11px] font-semibold text-zinc-500"
                  >
                    {item}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        {card.type === 'workflow_empty' && (
          <div className="mt-4 rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/80 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-black text-zinc-800">创建 AI 设计工作流</p>
              <Tag bordered={false} className="border-none bg-white text-[10px] font-black text-zinc-500">
                {floorPlans.length > 0 ? `${floorPlans.length} 份户型图可用` : '暂无户型图'}
              </Tag>
            </div>
            <p className="mt-2 text-xs font-medium leading-5 text-zinc-500">
              可使用已有户型图数据创建，也可以上传参考图创建。图片只用于本次创建请求，不会写入对话卡片。
            </p>
            {floorPlans.length > 0 && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {floorPlans.slice(0, 4).map((plan) => (
                  <div key={plan.id} className="rounded-xl bg-white px-3 py-2">
                    <p className="truncate text-xs font-bold text-zinc-800">{plan.name || '未命名户型图'}</p>
                    <p className="mt-1 truncate text-[11px] font-medium text-zinc-400">
                      {[plan.status, plan.createdAt].filter(Boolean).join(' / ') || '户型图数据'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {card.actions.map((action, index) => renderChatAction(action, index, card))}
        </div>
      </div>
    );
  };

  const renderUiPayload = (payload?: ChatUiPayload) => {
    if (!payload?.cards?.length && !payload?.actions?.length) {
      return null;
    }

    return (
      <div className="mt-4 space-y-3">
        {payload.cards?.map(renderBusinessCard)}
        {payload.actions && payload.actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {payload.actions.map((action, index) => renderChatAction(action, index))}
          </div>
        )}
      </div>
    );
  };

  const maskVisibleContent = (content: string) => {
    return content
      .replace(/\b(?:leadId|workflowId|generationId)\s*[:=：]?\s*["']?[a-f0-9]{24}["']?/gi, '该对象')
      .replace(/\b(?:leadId|workflowId|generationId)\b/gi, '该对象')
      .replace(/\b[a-f0-9]{24}\b/gi, '该对象');
  };

  return (
    <div className="flex h-[calc(100vh-190px)] min-h-[620px] overflow-hidden rounded-lg border bg-card shadow-sm">
      {/* Sidebar - History */}
      <div className={cn(
        "flex shrink-0 flex-col border-r border-border bg-muted/30 transition-all duration-300 ease-in-out",
        isSidebarOpen ? "w-64" : "w-0 overflow-hidden border-none"
      )}>
        <div className="p-4 shrink-0">
          <Button
            onClick={onNewChat}
            className="w-full justify-start"
            icon={<PlusCircle size={16} />}
          >
            <span className="font-semibold">新对话</span>
          </Button>
        </div>

        <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-2">
          {conversations.map((chat) => (
            <div 
              key={chat._id}
              className={cn(
                "group relative flex cursor-pointer items-center gap-3 rounded-md px-3 py-3 transition-colors",
                activeConversationId === chat._id 
                  ? "border border-border bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              onClick={() => onSelectConversation(chat._id)}
            >
              <MessageSquare size={16} className={cn(
                activeConversationId === chat._id ? "text-primary" : "text-muted-foreground"
              )} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold truncate">{chat.title || '新对话'}</p>
                <p className="text-[10px] font-medium text-muted-foreground">
                  {new Date(chat.lastMessageAt || chat.createdAt).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteConversation(chat._id);
                }}
                className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="border-t border-border p-4">
          <p className="text-center text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            对话记录自动保存
          </p>
        </div>
      </div>

      {/* Main Chat Content */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Toggle Sidebar Button (Floating) */}
        <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className={cn(
            "absolute -left-3 top-1/2 flex h-12 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:text-foreground",
            !isSidebarOpen && "left-0"
          )}
        >
          {isSidebarOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-card px-5 py-4 sm:px-6">
          <div className="flex items-center gap-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles size={24} />
            </div>
            <div>
              <h2 className="text-base font-semibold tracking-tight text-foreground">
                {activeConversationId ? conversations.find(c => c._id === activeConversationId)?.title || 'AI 设计师' : 'AI 设计师'}
              </h2>
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-50"></span>
                  <span className="relative inline-flex size-2 rounded-full bg-primary"></span>
                </span>
                <p className="text-xs font-medium text-muted-foreground">在线 · 随时为您服务</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeWorkflowCard && (
              <Button
                htmlType="button"
                size="small"
                onClick={() => setIsWorkflowSheetOpen(true)}
                className="xl:hidden"
                icon={<PanelRightOpen size={14} />}
              >
                方案工作区
              </Button>
            )}
            <Tag bordered={false} className="text-[10px] font-semibold uppercase tracking-widest">
              LongCat Flash
            </Tag>
          </div>
        </div>

        {/* Messages Area */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-5 space-y-6 scroll-smooth lg:p-6"
        >
          {messages.length === 0 && !isLoading && (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-6">
              <div className="w-20 h-20 rounded-[30%] bg-zinc-50 flex items-center justify-center">
                <Bot size={40} className="text-zinc-200" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-zinc-900 mb-2">我是您的 AI 助理设计师</h3>
                <p className="text-sm text-zinc-500 leading-relaxed">
                  您可以问我关于客户跟进、户型分析或设计风格的问题。我会实时查阅系统数据为您提供精准建议。
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 w-full mt-4">
                {QUICK_ACTIONS.map((action, i) => (
                  <button
                    key={i}
                    onClick={() => handleQuickAction(action)}
                    className="px-4 py-3 text-sm font-medium text-zinc-600 bg-zinc-50 hover:bg-zinc-100 hover:text-zinc-900 rounded-2xl transition-all border border-zinc-100 text-left"
                  >
                    {action}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.filter(m => m.role !== 'system' && m.role !== 'tool').map((m, i) => (
            <div 
              key={i}
              className={cn(
                "flex w-full gap-4 animate-in fade-in slide-in-from-bottom-4 duration-300",
                m.role === 'user' ? "flex-row-reverse" : "flex-row"
              )}
            >
              <div className={cn(
                "w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 shadow-sm",
                m.role === 'user' ? "bg-zinc-900 text-white" : "bg-white border border-zinc-100 text-indigo-500"
              )}>
                {m.role === 'user' ? <User size={18} /> : <Sparkles size={18} />}
              </div>
              <div className={cn(
                "rounded-[24px] px-5 py-4 text-sm leading-relaxed",
                m.role === 'user' 
                  ? "max-w-[76%] bg-zinc-900 text-white shadow-xl shadow-zinc-200"
                  : "max-w-[92%] bg-zinc-50 text-zinc-800 border border-zinc-100 shadow-sm"
              )}>
                {maskVisibleContent(m.content).split('\n').map((line, j) => (
                  <p key={j} className={j > 0 ? "mt-2" : ""}>{line}</p>
                ))}
                {m.role === 'assistant' && renderUiPayload(m.uiPayload)}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex w-full gap-4 animate-pulse">
              <div className="w-10 h-10 rounded-2xl bg-zinc-50 border border-zinc-100 flex items-center justify-center shrink-0">
                <Loader2 size={18} className="text-zinc-300 animate-spin" />
              </div>
              <div className="bg-zinc-50 border border-zinc-100 rounded-[24px] px-6 py-4">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 bg-zinc-300 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                  <div className="w-1.5 h-1.5 bg-zinc-300 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                  <div className="w-1.5 h-1.5 bg-zinc-300 rounded-full animate-bounce"></div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-8 border-t border-zinc-50 bg-white/80 backdrop-blur-md shrink-0">
          {latestContext && (
            <div className="mx-auto mb-3 flex max-w-4xl items-center justify-between gap-3 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-2 text-xs">
              <div className="min-w-0">
                <p className="truncate font-black text-indigo-800">{latestContext.label}</p>
                <p className="truncate font-medium text-indigo-500">后续提问会自动带上该上下文</p>
              </div>
              <Tag bordered={false} className="shrink-0 border-none bg-white text-indigo-700">上下文已锁定</Tag>
            </div>
          )}
          <form 
            onSubmit={handleSubmit}
            className="relative flex items-center gap-3 max-w-4xl mx-auto"
          >
            <button 
              type="button"
              onClick={onNewChat}
              className="p-3 text-zinc-400 hover:text-zinc-600 transition-colors"
              title="新建对话"
            >
              <PlusCircle size={24} />
            </button>
            <div className="flex-1 relative">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="在这里输入您的问题，如：帮我找找万科小区的客资..."
                className="h-14 pl-6 pr-16 rounded-[20px] bg-zinc-50 border-zinc-100 focus:bg-white focus:border-indigo-200 focus:ring-indigo-100 transition-all text-base placeholder:text-zinc-400"
                disabled={isLoading}
              />
              <Button
                htmlType="submit"
                disabled={!input.trim() || isLoading}
                className="absolute right-2 top-2 h-10 w-10 rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 transition-all shadow-lg"
                size="small"
                icon={<Send size={18} />}
              />
            </div>
          </form>
          <p className="mt-4 text-center text-[10px] text-zinc-400 font-medium uppercase tracking-widest">
            AI 可能会产生误差，请结合实际业务核对数据
          </p>
        </div>
      </div>
      <aside className="hidden w-[420px] shrink-0 border-l border-zinc-100 bg-white xl:flex 2xl:w-[480px]">
        {renderWorkflowWorkspace(activeWorkflowCard)}
      </aside>
      <Drawer
        open={isWorkflowSheetOpen}
        onClose={() => setIsWorkflowSheetOpen(false)}
        width={576}
        title="方案工作区"
        styles={{ body: { padding: 0, height: 'calc(100% - 55px)' } }}
      >
        {renderWorkflowWorkspace(activeWorkflowCard)}
      </Drawer>
      <Modal
        open={Boolean(pendingAction)}
        onCancel={() => {
          if (!isActionRunning) setPendingAction(null);
        }}
        title={pendingAction?.confirmTitle || '确认执行该操作？'}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              htmlType="button"
              disabled={isActionRunning}
              onClick={() => setPendingAction(null)}
              className="rounded-2xl"
            >
              取消
            </Button>
            <Button
              htmlType="button"
              type="primary"
              disabled={isActionRunning}
              onClick={handleConfirmAction}
              className="rounded-2xl bg-zinc-900 text-white hover:!bg-zinc-800"
              icon={isActionRunning ? <Loader2 className="animate-spin" size={16} /> : undefined}
            >
              确认执行
            </Button>
          </div>
        }
      >
        <p className="leading-6 text-zinc-600">
          {pendingAction?.confirmDescription || '该操作会更新当前方案状态。'}
        </p>
      </Modal>
      <Modal
        open={Boolean(floorPlanPicker)}
        onCancel={() => {
          if (!isActionRunning) {
            setFloorPlanPicker(null);
            setSelectedFloorPlanId('');
          }
        }}
        title={`为${floorPlanPicker?.leadTitle || '客户'}选择户型图`}
        width={512}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              htmlType="button"
              disabled={isActionRunning}
              onClick={() => {
                if (floorPlanPicker) {
                  setPendingUploadAction(floorPlanPicker.action);
                }
                setFloorPlanPicker(null);
                setSelectedFloorPlanId('');
                fileInputRef.current?.click();
              }}
              className="rounded-2xl"
            >
              上传参考图
            </Button>
            <Button
              htmlType="button"
              type="primary"
              disabled={isActionRunning || !selectedFloorPlanId}
              onClick={handleFloorPlanCreate}
              className="rounded-2xl bg-zinc-900 text-white hover:!bg-zinc-800"
              icon={isActionRunning ? <Loader2 className="animate-spin" size={16} /> : undefined}
            >
              确认创建
            </Button>
          </div>
        }
      >
        <p className="mb-4 leading-6 text-zinc-600">
          选择一份户型图数据创建 AI 设计工作流；如果没有合适户型图，也可以改为上传参考图。
        </p>
        <div className="max-h-[360px] overflow-y-auto">
          {floorPlanPicker?.floorPlans.length ? (
            <div className="space-y-2">
              {floorPlanPicker.floorPlans.map((plan) => (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => setSelectedFloorPlanId(plan.id)}
                  disabled={isActionRunning}
                  className={cn(
                    'w-full rounded-2xl border px-4 py-3 text-left transition-all',
                    selectedFloorPlanId === plan.id
                      ? 'border-zinc-900 bg-zinc-900 text-white'
                      : 'border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50'
                  )}
                >
                  <p className="truncate text-sm font-black">{plan.name || '未命名户型图'}</p>
                  <p className={cn(
                    'mt-1 truncate text-xs font-medium',
                    selectedFloorPlanId === plan.id ? 'text-zinc-300' : 'text-zinc-400'
                  )}>
                    {[plan.status, plan.createdAt].filter(Boolean).join(' / ') || '户型图数据'}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 p-6 text-center">
              <p className="text-sm font-black text-zinc-800">当前客户暂无户型图</p>
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                请改用上传参考图创建，后续仍可回到工作流页补充或更换素材。
              </p>
            </div>
          )}
        </div>
      </Modal>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleReferenceImageSelected}
      />
      {workflowRunner.cropDialog}
    </div>
  );
}
