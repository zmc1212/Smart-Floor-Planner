/* eslint-disable @next/next/no-img-element -- Authenticated media routes and imported source URLs are dynamic. */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import NextImage from 'next/image';
import Link from 'next/link';
import {
  Bell,
  Bot,
  Check,
  ChevronRight,
  CircleUserRound,
  Coins,
  Columns2,
  Copy,
  Crop,
  Download,
  FileImage,
  FolderInput,
  GripHorizontal,
  GripVertical,
  History,
  Images,
  ListChecks,
  Loader2,
  Maximize2,
  Minus,
  MoreHorizontal,
  PanelsTopLeft,
  Pencil,
  Plus,
  RotateCw,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';
import { Button, ConfigProvider, Dropdown, Input, Modal, Select } from 'antd';
import { notify } from '@/components/admin/operation-feedback';
import { studioDarkAntdTheme } from '@/components/admin/studio-antd-theme';
import {
  mergeTemplateReferenceAsset,
  planPromptTemplateReferenceAttach,
  promptTemplateCoverClonePath,
  promptTemplatePreviewSrc,
} from '@/lib/ai/prompt-template-reference';
import { pickDefaultCreationModel } from '@/lib/ai/workbench-studio';
import { cn } from '@/lib/utils';
import { ImageEditorDialog } from './image-editor-dialog';
import { TemplateLibraryDialog } from './template-library-dialog';
import type {
  CreationAsset,
  CreationBatch,
  CreationGeneration,
  CreationModelProfile,
  CreationTask,
  CreationWorkflow,
  PromptTemplate,
} from './types';

const { TextArea } = Input;

type BootstrapData = {
  account: { balance: number; frozenBalance: number; availableBalance: number };
  price: { credits: number; label: string };
  provider: { actionEnabled: boolean; supportsGenerate: boolean; supportsEdit: boolean; defaultRemoteModel?: string };
  models: CreationModelProfile[];
  workflows: CreationWorkflow[];
};

type TemplateDetail = PromptTemplate & {
  parameterTemplate?: { parameters?: Record<string, unknown> };
};

type GenerationDraft = {
  prompt: string;
  negativePrompt: string;
  referenceAssetIds: string[];
  modelProfileId: string;
  aspectRatio: string;
  resolutionTier: '1K' | '2K' | '4K' | 'CUSTOM';
  width: number;
  height: number;
  templateId?: string;
  count: number;
};

const darkSelectClassName =
  '[&_.ant-select-selector]:!rounded-lg [&_.ant-select-selector]:!border-[#37373b] [&_.ant-select-selector]:!bg-[#222226] [&_.ant-select-selector]:!text-[#f5f5f5] [&_.ant-select-selection-item]:!text-[#f5f5f5] [&_.ant-select-arrow]:!text-[#f5f5f5]';
const darkSelectPopupClassName =
  'border border-white/10 bg-[#18191d] text-[#f5f5f5] [&_.ant-select-item]:text-[#f5f5f5] [&_.ant-select-item-option-active]:!bg-white/10 [&_.ant-select-item-option-selected]:!bg-white/[0.08]';
const iconToolbarButtonClassName =
  'inline-flex !h-7 !w-7 !min-w-7 items-center justify-center !border-0 !bg-transparent !p-0 text-[#e5e5ea] hover:!bg-white/10 hover:!text-white';
const secondaryToolbarButtonClassName =
  'border-white/10 bg-[#24252b] text-[#e7e7eb] hover:!border-white/20 hover:!bg-[#303138] hover:!text-white';

async function readJson(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) throw new Error(payload.error || '请求失败');
  return payload;
}

function formatTime(value: string) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function loadCanvasImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法加载对比图片'));
    image.src = url;
  });
}

function latestBatch(task?: CreationTask) {
  return task?.batches?.[0];
}

function batchResolutionTier(batch: CreationBatch): GenerationDraft['resolutionTier'] {
  const storedTier = batch.parameterSnapshot.resolutionTier
    || batch.parameterSnapshot.size?.toUpperCase()
    || '1K';
  return ['1K', '2K', '4K', 'CUSTOM'].includes(storedTier)
    ? storedTier as GenerationDraft['resolutionTier']
    : '1K';
}

function generationDraftFromBatch(batch: CreationBatch): GenerationDraft {
  return {
    prompt: batch.prompt,
    negativePrompt: batch.negativePrompt || '',
    referenceAssetIds: batch.referenceAssetIds,
    modelProfileId: batch.modelProfileId,
    aspectRatio: batch.parameterSnapshot.aspectRatio || '1:1',
    resolutionTier: batchResolutionTier(batch),
    width: batch.parameterSnapshot.width || 1024,
    height: batch.parameterSnapshot.height || 1024,
    templateId: batch.parameterSnapshot.templateId,
    count: batch.requestedCount || 1,
  };
}

function statusLabel(status: CreationBatch['status']) {
  if (status === 'succeeded') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'partial') return '部分完成';
  if (status === 'processing') return '生成中';
  return '排队中';
}

function GenerationTile({
  generation,
  batchStatus,
  onAttach,
  onPreview,
  onReuse,
  onCompare,
  onEdit,
  onDelete,
}: {
  generation?: CreationGeneration;
  batchStatus?: CreationBatch['status'];
  onAttach: (generation: CreationGeneration) => void;
  onPreview: (generation: CreationGeneration) => void;
  onReuse: (generation: CreationGeneration) => void;
  onCompare: (generation: CreationGeneration) => void;
  onEdit: (generation: CreationGeneration) => void;
  onDelete: () => void;
}) {
  if (!generation) {
    if (batchStatus === 'failed') {
      return (
        <div className="flex size-[216px] shrink-0 flex-col items-center justify-center rounded-lg bg-[#2a2b31] px-6 text-center">
          <FileImage className="mb-3 size-6 text-red-400" />
          <span className="text-sm font-medium text-white">生成失败</span>
          <span className="mt-1 text-xs text-[#8d8d94]">未生成可用图片</span>
        </div>
      );
    }
    return (
      <div className="flex size-[216px] shrink-0 items-center justify-center rounded-lg bg-[#2a2b31]">
        <div className="relative flex size-16 items-center justify-center">
          <Loader2 className="absolute inset-0 size-16 animate-spin text-[#6245ff]" strokeWidth={1.25} />
          <span className="text-xs font-medium text-[#ededf2]">生成中</span>
        </div>
      </div>
    );
  }
  const pending = ['created', 'pending', 'processing'].includes(generation.status);
  if (pending) {
    return (
      <div className="flex size-[216px] shrink-0 items-center justify-center rounded-lg bg-[#2a2b31]">
        <div className="relative flex size-16 items-center justify-center">
          <Loader2 className="absolute inset-0 size-16 animate-spin text-[#6245ff]" strokeWidth={1.25} />
          <span className="text-xs font-medium text-[#ededf2]">{generation.retryCount > 0 ? '重试中' : '生成中'}</span>
        </div>
      </div>
    );
  }
  if (generation.status === 'failed' || !generation.imageUrl) {
    return (
      <div className="flex size-[216px] shrink-0 flex-col items-center justify-center rounded-lg bg-[#2a2b31] px-6 text-center">
        <FileImage className="mb-3 size-6 text-red-400" />
        <span className="text-sm font-medium text-white">生成失败</span>
        <span className="mt-1 line-clamp-2 text-xs text-[#8d8d94]">{generation.error || '供应商未返回结果'}</span>
        {generation.retryCount > 0 ? <span className="mt-1 text-[11px] text-[#77777e]">已重试 {generation.retryCount} 次</span> : null}
      </div>
    );
  }
  return (
    <div className="group relative size-[216px] shrink-0 overflow-hidden rounded-lg bg-[#25262c] shadow-[0_10px_30px_rgba(0,0,0,0.2)]">
      <button type="button" onClick={() => onPreview(generation)} className="h-full w-full">
        <img src={generation.imageUrl} alt="AI 生成结果" className="h-full w-full object-contain" />
      </button>
      <div className="absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-1 rounded-lg bg-[#202126]/95 p-1.5 text-[#e5e5ea] opacity-0 shadow-xl backdrop-blur transition group-hover:opacity-100 group-focus-within:opacity-100">
        <Button
          type="default"
          size="small"
          title="下载"
          href={generation.imageUrl}
          download={`ai-creation-${generation.id}.png`}
          className={iconToolbarButtonClassName}
          icon={<Download className="size-3.5" />}
        />
        <Button type="default" size="small" onClick={() => onReuse(generation)} title="引用为参考图" className={iconToolbarButtonClassName} icon={<Copy className="size-3.5" />} />
        <Button type="default" size="small" onClick={() => onCompare(generation)} title="对比" className={iconToolbarButtonClassName} icon={<Columns2 className="size-3.5" />} />
        <Button type="default" size="small" onClick={() => onEdit(generation)} title="编辑" className={iconToolbarButtonClassName} icon={<Pencil className="size-3.5" />} />
        <Button type="default" size="small" onClick={() => onAttach(generation)} title="归入客户方案" className={iconToolbarButtonClassName} icon={<FolderInput className="size-3.5" />} />
        <Button type="default" size="small" className={cn(iconToolbarButtonClassName, '!text-[#ff8388] hover:!text-[#ffaaaa]')} onClick={onDelete} title="删除" icon={<Trash2 className="size-3.5" />} />
      </div>
      {generation.workflowId ? (
        <span className="absolute left-2 top-2 rounded-md bg-[#7047ff] px-2 py-1 text-[11px] font-medium text-white">已归入方案</span>
      ) : null}
    </div>
  );
}

function BatchActionPanel({
  batch,
  isLatest,
  generating,
  retrying,
  onEdit,
  onGenerate,
  onDelete,
}: {
  batch: CreationBatch;
  isLatest: boolean;
  generating: boolean;
  retrying: boolean;
  onEdit: () => void;
  onGenerate: () => void;
  onDelete: () => void;
}) {
  const active = batch.status === 'pending' || batch.status === 'processing';
  const retryable = isLatest && (batch.status === 'failed' || batch.status === 'partial');
  const busy = generating || retrying || active;
  const actionLabel = retrying && isLatest
    ? '重试中'
    : active
      ? '生成中'
      : retryable
        ? batch.status === 'partial' ? '重试失败项' : '重试本轮'
        : '再次生成';

  return (
    <div aria-label={`第 ${batch.sequence} 轮操作`} className="mt-3 flex h-[30px] items-center gap-2">
      <button type="button" onClick={onEdit} className="flex h-[30px] items-center gap-1.5 rounded-md bg-[#2a2b31] px-3 text-xs text-[#d5d5da] hover:bg-[#34353c] hover:text-white"><Pencil className="size-3.5" />重新编辑</button>
      <button
        type="button"
        disabled={busy}
        onClick={onGenerate}
        className="flex h-[30px] items-center gap-1.5 rounded-md bg-[#2a2b31] px-3 text-xs text-[#d5d5da] hover:bg-[#34353c] hover:text-white disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        {actionLabel}
      </button>
      <button type="button" onClick={onDelete} title="删除整个任务" className="flex h-[30px] items-center gap-1.5 rounded-md bg-[#2a2b31] px-3 text-xs text-[#ff6f75] hover:bg-[#34353c]"><Trash2 className="size-3.5" />删除</button>
    </div>
  );
}

export function CreationWorkspace() {
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<CreationTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [modelProfileId, setModelProfileId] = useState('');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [resolutionTier, setResolutionTier] = useState<'1K' | '2K' | '4K' | 'CUSTOM'>('1K');
  const [customWidth, setCustomWidth] = useState(1024);
  const [customHeight, setCustomHeight] = useState(1024);
  const [count, setCount] = useState(1);
  const [assets, setAssets] = useState<CreationAsset[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateDetail | null>(null);
  const [templateAssetId, setTemplateAssetId] = useState('');
  const [templateOpen, setTemplateOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [assisting, setAssisting] = useState(false);
  const [attachGeneration, setAttachGeneration] = useState<CreationGeneration | null>(null);
  const [attachWorkflowId, setAttachWorkflowId] = useState('');
  const [previewGeneration, setPreviewGeneration] = useState<CreationGeneration | null>(null);
  const [previewReferenceIndex, setPreviewReferenceIndex] = useState<number | null>(null);
  const [activeReferenceIndex, setActiveReferenceIndex] = useState(0);
  const [hoveredReferenceIndex, setHoveredReferenceIndex] = useState<number | null>(null);
  const [referenceStackExpanded, setReferenceStackExpanded] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewRotation, setPreviewRotation] = useState(0);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const [compareGeneration, setCompareGeneration] = useState<CreationGeneration | null>(null);
  const [compareMode, setCompareMode] = useState<'generated' | 'reference' | 'split' | 'sync'>('split');
  const [compareLayout, setCompareLayout] = useState<'horizontal' | 'vertical'>('horizontal');
  const [compareSwapped, setCompareSwapped] = useState(false);
  const [compareFullscreen, setCompareFullscreen] = useState(false);
  const [splitPosition, setSplitPosition] = useState(50);
  const [editorGeneration, setEditorGeneration] = useState<CreationGeneration | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const compareViewportRef = useRef<HTMLDivElement>(null);
  const conversationViewportRef = useRef<HTMLDivElement>(null);

  const loadBootstrap = useCallback(async () => {
    try {
      const payload = await readJson(await fetch('/api/ai/creation/bootstrap'));
      if (!payload.data) throw new Error('AI 创作台初始化数据为空');
      setBootstrap(payload.data);
      setBootstrapError(null);
      setModelProfileId((current) => current || pickDefaultCreationModel(
        payload.data.models as CreationModelProfile[] | undefined,
        payload.data.provider?.defaultRemoteModel,
      )?.id || '');
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载 AI 创作台失败';
      setBootstrapError(message);
      throw error;
    }
  }, []);

  const loadTasks = useCallback(async (silent = false) => {
    try {
      const params = new URLSearchParams({ limit: '24' });
      if (historyQuery.trim()) params.set('q', historyQuery.trim());
      const payload = await readJson(await fetch(`/api/ai/creation/tasks?${params}`));
      setTasks(payload.data || []);
    } catch (error) {
      if (!silent) notify.error(error instanceof Error ? error.message : '加载历史失败');
    }
  }, [historyQuery]);

  useEffect(() => {
    Promise.all([loadBootstrap(), loadTasks()]).catch((error) => {
      notify.error(error instanceof Error ? error.message : '加载创作台失败');
    });
  }, [loadBootstrap, loadTasks]);

  const retryBootstrap = useCallback(() => {
    setBootstrapError(null);
    void Promise.all([loadBootstrap(), loadTasks()]).catch((error) => {
      notify.error(error instanceof Error ? error.message : '加载创作台失败');
    });
  }, [loadBootstrap, loadTasks]);

  const hasProcessing = tasks.some((task) => task.batches.some((batch) => batch.status === 'processing' || batch.status === 'pending'));
  useEffect(() => {
    if (!hasProcessing) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      await loadTasks(true);
      if (!cancelled) timer = window.setTimeout(poll, 4500);
    };
    timer = window.setTimeout(poll, 4500);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [hasProcessing, loadTasks]);

  const selectedTask = tasks.find((task) => task.id === selectedTaskId);
  const selectedBatch = latestBatch(selectedTask);
  const conversationBatches = selectedTask ? [...selectedTask.batches].sort((a, b) => a.sequence - b.sequence) : [];
  const hasTaskStage = Boolean(selectedTask && selectedBatch);
  const model = bootstrap?.models.find((item) => item.id === modelProfileId);
  const availableAspectRatios = model?.aspectRatiosByResolutionTier?.[resolutionTier] || model?.aspectRatios || [];
  const unitPrice = model?.prices.find((price) => price.resolutionTier === resolutionTier)?.credits || 0;
  const estimatedCredits = unitPrice * count;
  const hasEnabledPrice = unitPrice > 0;
  const previewReference = previewReferenceIndex === null ? null : assets[previewReferenceIndex];
  const selectedBatchTier = selectedBatch?.parameterSnapshot.resolutionTier
    || selectedBatch?.parameterSnapshot.size?.toUpperCase()
    || '1K';
  const selectedBatchReferenceIds = selectedBatch?.referenceAssetIds || [];
  const composerChangedFromSelectedBatch = Boolean(selectedBatch && (
    prompt !== selectedBatch.prompt
    || negativePrompt !== (selectedBatch.negativePrompt || '')
    || modelProfileId !== selectedBatch.modelProfileId
    || aspectRatio !== (selectedBatch.parameterSnapshot.aspectRatio || '1:1')
    || resolutionTier !== selectedBatchTier
    || count !== selectedBatch.requestedCount
    || assets.map((asset) => asset.id).join(',') !== selectedBatchReferenceIds.join(',')
    || (resolutionTier === 'CUSTOM' && (
      customWidth !== (selectedBatch.parameterSnapshot.width || 1024)
      || customHeight !== (selectedBatch.parameterSnapshot.height || 1024)
    ))
    || (selectedTemplate?.id || '') !== (selectedBatch.parameterSnapshot.templateId || '')
  ));
  const currentBatchRetryable = selectedBatch?.status === 'failed' || selectedBatch?.status === 'partial';
  const shouldRetryCurrentBatch = Boolean(currentBatchRetryable && !composerChangedFromSelectedBatch);
  const currentBatchActive = selectedBatch?.status === 'pending' || selectedBatch?.status === 'processing';
  const failedGenerationCount = selectedBatch?.generations.filter((generation) => generation.status === 'failed').length || 0;
  const actionEstimatedCredits = shouldRetryCurrentBatch ? unitPrice * failedGenerationCount : estimatedCredits;
  // The task summary is a submitted-batch snapshot, not the mutable composer draft.
  const taskReferenceAssetId = selectedBatch?.referenceAssetIds[0] || selectedTask?.referenceAssetIds[0];
  const taskReferencePreviewUrl = taskReferenceAssetId ? `/api/ai/assets/${taskReferenceAssetId}/image` : null;

  useEffect(() => {
    const viewport = conversationViewportRef.current;
    const latestRound = viewport?.lastElementChild as HTMLElement | null;
    if (viewport && latestRound) viewport.scrollTop = Math.max(0, latestRound.offsetTop - 12);
  }, [selectedTaskId, conversationBatches.length]);

  useEffect(() => {
    setActiveReferenceIndex((current) => Math.min(current, Math.max(assets.length - 1, 0)));
    setPreviewReferenceIndex((current) => current === null || current < assets.length ? current : null);
  }, [assets.length]);

  const applyModelDefaults = (profile?: CreationModelProfile) => {
    if (!profile) return;
    setAspectRatio(profile.defaults.aspectRatio);
    setResolutionTier(profile.defaults.resolutionTier);
    setCustomWidth(1024);
    setCustomHeight(1024);
    setAssets((current) => current.slice(0, profile.maxReferenceImages));
  };

  const applyBatchToComposer = (batch: CreationBatch) => {
    const draft = generationDraftFromBatch(batch);
    setPrompt(draft.prompt);
    setNegativePrompt(draft.negativePrompt);
    setModelProfileId(draft.modelProfileId);
    setAspectRatio(draft.aspectRatio);
    setResolutionTier(draft.resolutionTier);
    setCustomWidth(draft.width);
    setCustomHeight(draft.height);
    setCount(draft.count);
    setSelectedTemplate(draft.templateId ? { id: draft.templateId } as TemplateDetail : null);
    setAssets(draft.referenceAssetIds.map((id) => ({ id, previewUrl: `/api/ai/assets/${id}/image` })));
    setTemplateAssetId('');
  };

  const chooseTask = (task: CreationTask) => {
    const batch = latestBatch(task);
    setSelectedTaskId(task.id);
    if (batch) applyBatchToComposer(batch);
    setHistoryOpen(false);
  };

  const newCreation = () => {
    const first = pickDefaultCreationModel(bootstrap?.models, bootstrap?.provider.defaultRemoteModel);
    setSelectedTaskId('');
    setPrompt('');
    setNegativePrompt('');
    setSelectedTemplate(null);
    setTemplateAssetId('');
    setAssets([]);
    setCount(1);
    setHistoryOpen(false);
    if (first) {
      setModelProfileId(first.id);
      applyModelDefaults(first);
    }
  };

  const uploadReferenceFiles = async (files: File[], successMessage = '已添加参考图') => {
    if (!files.length || !model) return false;
    const slots = Math.max(0, model.maxReferenceImages - assets.length);
    if (!model.supportsReferenceImages || !slots) {
      notify.warning(`当前模型最多支持 ${model.maxReferenceImages} 张参考图`);
      return false;
    }
    setUploading(true);
    try {
      const selected = files.slice(0, slots);
      const uploaded = await Promise.all(selected.map(async (file) => {
        const formData = new FormData();
        formData.set('file', file);
        const payload = await readJson(await fetch('/api/ai/creation/assets', { method: 'POST', body: formData }));
        return payload.data as CreationAsset;
      }));
      setAssets((current) => [...current, ...uploaded]);
      notify.success(`${successMessage}（${uploaded.length} 张）`);
      return true;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '参考图上传失败');
      return false;
    } finally {
      setUploading(false);
    }
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    await uploadReferenceFiles(Array.from(files), '已上传参考图');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeReferenceAsset = (assetId: string) => {
    if (assetId === templateAssetId) setTemplateAssetId('');
    setAssets((current) => current.filter((asset) => asset.id !== assetId));
  };

  const reuseGeneration = async (generation: CreationGeneration) => {
    if (!generation.imageUrl || !model) return;
    const slots = Math.max(0, model.maxReferenceImages - assets.length);
    if (!model.supportsReferenceImages || !slots) {
      notify.warning(`当前模型最多支持 ${model.maxReferenceImages} 张参考图`);
      return;
    }
    try {
      setUploading(true);
      const payload = await readJson(await fetch('/api/ai/creation/assets/from-generation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generationId: generation.id }),
      }));
      const asset = payload.data as CreationAsset;
      if (assets.some((item) => item.id === asset.id)) {
        notify.info('该图片已在参考图中');
        return;
      }
      setAssets((current) => current.some((item) => item.id === asset.id) ? current : [...current, asset]);
      notify.success('已引用生成结果（1 张）');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '引用生成结果失败');
    } finally {
      setUploading(false);
    }
  };

  const useAnnotatedImage = async (file: File, extraPrompt: string) => {
    const added = await uploadReferenceFiles([file], '已使用标注图片');
    if (added && extraPrompt) {
      setPrompt((current) => current.trim() ? `${current.trim()}\n${extraPrompt}` : extraPrompt);
    }
  };

  const downloadComparison = async () => {
    if (!compareGeneration?.imageUrl || !assets[0]?.previewUrl) return notify.warning('请先准备一张参考图再下载对比图');
    try {
      const [first, second] = await Promise.all([
        loadCanvasImage(compareSwapped ? assets[0].previewUrl : compareGeneration.imageUrl),
        loadCanvasImage(compareSwapped ? compareGeneration.imageUrl : assets[0].previewUrl),
      ]);
      const vertical = compareLayout === 'vertical';
      const width = vertical ? Math.max(first.naturalWidth, second.naturalWidth) : first.naturalWidth + second.naturalWidth;
      const height = vertical ? first.naturalHeight + second.naturalHeight : Math.max(first.naturalHeight, second.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法创建对比图');
      if (vertical) {
        context.drawImage(first, 0, 0);
        context.drawImage(second, 0, first.naturalHeight);
      } else {
        context.drawImage(first, 0, 0);
        context.drawImage(second, first.naturalWidth, 0);
      }
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'ai-creation-comparison.png';
        link.click();
        URL.revokeObjectURL(url);
      }, 'image/png');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '下载对比图失败');
    }
  };

  const moveSplitDivider = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const rect = compareViewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = compareLayout === 'horizontal'
      ? (event.clientX - rect.left) / rect.width
      : (event.clientY - rect.top) / rect.height;
    setSplitPosition(Math.min(96, Math.max(4, ratio * 100)));
  };

  const applyTemplate = async (template: TemplateDetail) => {
    setSelectedTemplate(template);
    setPrompt(template.promptContent);
    let nextModel = model;
    if (template.recommendedModelProfileId) {
      const recommended = bootstrap?.models.find((item) => item.id === template.recommendedModelProfileId);
      if (recommended) {
        setModelProfileId(recommended.id);
        applyModelDefaults(recommended);
        nextModel = recommended;
      }
    }
    const nextMaxUserRefs = nextModel?.supportsReferenceImages ? (nextModel.maxReferenceImages || 0) : 0;
    const plan = planPromptTemplateReferenceAttach({
      previewSrc: promptTemplatePreviewSrc(template),
      maxUserRefs: nextMaxUserRefs,
      currentAssetIds: assets.map((asset) => asset.id),
      previousTemplateAssetId: templateAssetId,
    });
    if (!plan.canAttach) {
      if (plan.reason === 'no_slots' || plan.reason === 'no_capacity') {
        notify.success(`已应用模板：${template.name}`);
        notify.warning(plan.reason === 'no_slots'
          ? '当前模型无法带入模板参考图'
          : '参考图已满，已应用模板文案但未带入封面');
        return;
      }
      notify.success(`已应用模板：${template.name}`);
      return;
    }
    setUploading(true);
    try {
      const payload = await readJson(await fetch(promptTemplateCoverClonePath(template.id), { method: 'POST' }));
      const uploaded = payload.data as CreationAsset;
      const kept = assets.filter((asset) => plan.keptAssetIds.includes(asset.id));
      setAssets(mergeTemplateReferenceAsset(kept, uploaded));
      setTemplateAssetId(uploaded.id);
      notify.success(`已应用模板：${template.name}`);
    } catch (error) {
      notify.error(error instanceof Error
        ? `已应用「${template.name}」的提示词，但未能带入参考图：${error.message}`
        : `已应用「${template.name}」的提示词，但未能带入参考图`);
    } finally {
      setUploading(false);
    }
  };

  const assistPrompt = async () => {
    if (!prompt.trim()) return notify.warning('请先输入提示词');
    setAssisting(true);
    try {
      const payload = await readJson(await fetch('/api/ai/creation/prompt-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      }));
      setPrompt(payload.data.prompt);
      await loadBootstrap();
      notify.success('提示词已优化');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '提示词优化失败');
    } finally {
      setAssisting(false);
    }
  };

  const submitGeneration = async (sourceBatch?: CreationBatch) => {
    const draft: GenerationDraft = sourceBatch ? generationDraftFromBatch(sourceBatch) : {
      prompt,
      negativePrompt,
      referenceAssetIds: assets.map((asset) => asset.id),
      modelProfileId,
      aspectRatio,
      resolutionTier,
      width: customWidth,
      height: customHeight,
      templateId: selectedTemplate?.id,
      count,
    };
    const draftModel = bootstrap?.models.find((item) => item.id === draft.modelProfileId);
    const draftUnitPrice = draftModel?.prices.find((price) => price.resolutionTier === draft.resolutionTier)?.credits || 0;
    const draftEstimatedCredits = draftUnitPrice * draft.count;
    if (!draft.prompt.trim()) return notify.warning('请输入提示词');
    if (!draft.modelProfileId) return notify.warning('请选择模型');
    if (!draftUnitPrice) return notify.warning('当前模型分辨率尚未开放');
    if (!bootstrap?.provider.actionEnabled) return notify.error('当前企业未开放 AI 自由创作');
    if (!bootstrap?.provider.supportsGenerate) return notify.error('尚未配置可用的图片生成模型');
    if (draft.referenceAssetIds.length && !bootstrap.provider.supportsEdit) return notify.error('尚未配置可用的图片编辑模型');
    if ((bootstrap.account.availableBalance || 0) < draftEstimatedCredits) return notify.error(`AI 点数不足，本次需要 ${draftEstimatedCredits} 点`);
    setGenerating(true);
    const loadingId = notify.loading('正在提交生成任务');
    try {
      let taskId = selectedTaskId;
      if (!taskId) {
        const created = await readJson(await fetch('/api/ai/creation/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: draft.prompt.trim().slice(0, 32),
            prompt: draft.prompt,
            referenceAssetIds: draft.referenceAssetIds,
            modelProfileId: draft.modelProfileId,
          }),
        }));
        taskId = created.data.id;
        setSelectedTaskId(taskId);
      }
      const generated = await readJson(await fetch(`/api/ai/creation/tasks/${taskId}/batches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: draft.prompt,
          negativePrompt: draft.negativePrompt,
          referenceAssetIds: draft.referenceAssetIds,
          modelProfileId: draft.modelProfileId,
          aspectRatio: draft.aspectRatio,
          resolutionTier: draft.resolutionTier,
          width: draft.resolutionTier === 'CUSTOM' ? draft.width : undefined,
          height: draft.resolutionTier === 'CUSTOM' ? draft.height : undefined,
          templateId: draft.templateId,
          count: draft.count,
        }),
      }));
      setBootstrap((current) => current ? { ...current, account: generated.data.account } : current);
      await loadTasks(true);
      notify.success('生成任务已提交', { id: loadingId });
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '生成任务提交失败', { id: loadingId });
    } finally {
      setGenerating(false);
    }
  };

  const editBatch = (batch: CreationBatch) => {
    applyBatchToComposer(batch);
    setPromptExpanded(true);
  };

  const regenerateBatch = (batch: CreationBatch) => {
    applyBatchToComposer(batch);
    void submitGeneration(batch);
  };

  const retryCurrentBatch = async () => {
    if (!selectedTask || !selectedBatch || !currentBatchRetryable) return;
    if ((bootstrap?.account.availableBalance || 0) < actionEstimatedCredits) {
      return notify.error(`AI 点数不足，本次重试需要 ${actionEstimatedCredits} 点`);
    }
    setRetrying(true);
    const loadingId = notify.loading(selectedBatch.status === 'partial' ? '正在重试当前轮失败项' : '正在重试当前轮');
    try {
      const payload = await readJson(await fetch(`/api/ai/creation/tasks/${selectedTask.id}/batches/${selectedBatch.id}/retry`, {
        method: 'POST',
      }));
      const retriedTask = payload.data.task as CreationTask;
      setTasks((current) => [retriedTask, ...current.filter((item) => item.id !== retriedTask.id)]);
      setBootstrap((current) => current ? { ...current, account: payload.data.account } : current);
      notify.success(`已在第 ${selectedBatch.sequence} 轮重试 ${payload.data.retriedCount} 个失败项`, { id: loadingId });
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '当前轮重试失败', { id: loadingId });
      await loadTasks(true);
    } finally {
      setRetrying(false);
    }
  };

  const deleteTask = async (task: CreationTask) => {
    if (!window.confirm(`确认删除“${task.title}”及其历史记录吗？`)) return;
    try {
      await readJson(await fetch(`/api/ai/creation/tasks/${task.id}`, { method: 'DELETE' }));
      setTasks((current) => current.filter((item) => item.id !== task.id));
      if (selectedTaskId === task.id) newCreation();
      notify.success('创作任务已删除');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '删除任务失败');
    }
  };

  const attachToWorkflow = async () => {
    if (!attachGeneration || !attachWorkflowId) return;
    try {
      await readJson(await fetch(`/api/ai/creation/generations/${attachGeneration.id}/attach-workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId: attachWorkflowId }),
      }));
      setAttachGeneration(null);
      setAttachWorkflowId('');
      await loadTasks(true);
      notify.success('结果已归入客户方案');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '归入客户方案失败');
    }
  };

  const filteredTasks = useMemo(() => {
    const query = historyQuery.trim().toLowerCase();
    return query
      ? tasks.filter((task) => `${task.title} ${task.prompt}`.toLowerCase().includes(query))
      : tasks;
  }, [tasks, historyQuery]);

  if (!bootstrap) {
    if (bootstrapError) {
      const message = bootstrapError === 'Please select an enterprise first'
        ? '请先在后台选择企业，再打开 AI 创作台。'
        : bootstrapError === 'Unauthorized'
          ? '登录状态已失效，请重新登录后再试。'
          : bootstrapError;
      return (
        <div className="flex h-screen items-center justify-center bg-[#16171b] px-6 text-[#f6f7fb]">
          <div role="alert" className="w-full max-w-md rounded-2xl border border-white/10 bg-[#202127] p-6 shadow-2xl">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-full bg-[#7047ff]/15 text-[#9b82ff]"><Sparkles className="size-4" /></div>
              <h1 className="text-base font-semibold">AI 创作台暂不可用</h1>
            </div>
            <p className="text-sm leading-6 text-[#b3b3b3]">{message}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button type="button" onClick={retryBootstrap} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#7047ff] px-4 text-sm font-medium text-white hover:bg-[#805cff]"><RefreshCw className="size-4" />重试</button>
          <Link href="/ai-studio/scenarios" className="inline-flex h-9 items-center rounded-lg border border-white/10 px-4 text-sm text-[#d7d7dc] hover:bg-white/5">打开 AI 工作台</Link>
            </div>
          </div>
        </div>
      );
    }
    return <div className="flex h-screen items-center justify-center bg-[#16171b] text-sm text-[#b3b3b3]"><Loader2 className="mr-2 size-5 animate-spin text-[#7047ff]" />加载 AI 创作台</div>;
  }

  return (
    <ConfigProvider theme={studioDarkAntdTheme}>
    <div className="fixed inset-0 h-screen min-h-[720px] min-w-0 overflow-x-hidden overflow-y-auto bg-[#16171b] font-sans text-[#f6f7fb] lg:min-w-[1024px] lg:overflow-hidden">
      <header className="relative z-40 flex h-[68px] min-w-0 items-center justify-between border-b border-white/[0.08] bg-[#16171b] px-3 lg:min-w-[1024px]">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/ai-studio/scenarios" className="flex items-center gap-2 text-white" title="返回后台 AI 工作台">
            <NextImage src="/brand-logo.png" alt="" aria-hidden="true" width={28} height={28} className="shrink-0 rounded-md" />
            <span className="hidden text-[15px] font-semibold sm:inline">家客来</span>
          </Link>
          <span className="h-6 w-px bg-white/20" />
          <h1 className="truncate text-base font-medium sm:text-lg">创作工作台</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/workflow-logs" title="系统消息" className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[#b3b3b3] hover:text-white"><Bell className="size-4" /></Link>
          <div className="flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 text-xs text-[#d7d7dc]" title="可用 AI 点数">
            <Coins className="size-4 text-[#8b6cff]" />
            <strong className="font-semibold text-white">{bootstrap.account.availableBalance}</strong>
          </div>
          <Link href="/" title="返回管理后台" className="flex size-9 items-center justify-center rounded-full bg-white/10 text-[#d7d7dc] hover:text-white"><CircleUserRound className="size-5" /></Link>
        </div>
      </header>

      <div className="absolute inset-x-0 bottom-0 top-[68px] min-w-0 bg-[#17191f] lg:min-w-[1024px]">
        <aside className="absolute inset-y-0 left-0 z-30 hidden w-16 flex-col items-center border-r border-white/[0.05] bg-[#0f1016]/70 pt-5 min-[1440px]:flex">
          <Link href="/ai-studio/scenarios" title="展开创作导航" className="mb-4 flex size-8 items-center justify-center rounded-full border border-white/15 text-[#b3b3b3] hover:text-white"><ChevronRight className="size-4" /></Link>
          <button type="button" title="AI 自由创作" className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#7047ff]/55 bg-[#6f45ff]/15 text-[#987dff]"><span className="flex size-6 items-center justify-center rounded-full bg-[#6942df] text-xs font-semibold text-white">AI</span></button>
          <Link href="/ai-studio/scenarios" title="客户方案" className="mt-3 flex h-12 w-12 items-center justify-center rounded-xl text-[#7d63ff] hover:bg-white/5"><span className="flex size-6 items-center justify-center rounded-full bg-[#6844da] text-xs font-semibold text-white">W</span></Link>
        </aside>

        <div className="absolute left-4 top-3 z-30 flex w-[136px] flex-col gap-2 sm:left-[84px]">
          <button type="button" onClick={newCreation} className="flex h-9 items-center justify-center gap-2 rounded-[18px] bg-gradient-to-r from-[#56a7ff] to-[#6030ff] px-3 text-sm text-white hover:brightness-110"><Plus className="size-4" />新建任务</button>
          <button type="button" onClick={() => setHistoryOpen((open) => !open)} className={cn('flex h-9 items-center justify-center gap-2 rounded-[18px] border px-3 text-sm text-white transition', historyOpen ? 'border-white bg-white/10' : 'border-[#6947ee] bg-[#5d45aa]/20 hover:bg-[#5d45aa]/35')}><ListChecks className="size-4" />任务列表</button>
        </div>

        {historyOpen ? (
          <section role="dialog" aria-label="任务列表" className="absolute left-[84px] top-[100px] z-40 flex h-[422px] w-[392px] flex-col overflow-hidden rounded-xl border border-white/20 bg-[#18191d] shadow-2xl">
            <div className="flex items-center justify-between px-4 pb-2 pt-4">
              <h2 className="text-base font-medium">任务列表</h2>
              <button type="button" onClick={() => setHistoryOpen(false)} aria-label="关闭任务列表" className="flex size-8 items-center justify-center rounded-full bg-white/10 text-[#b3b3b3] hover:text-white"><X className="size-4" /></button>
            </div>
            <div className="px-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#77777e]" />
                <Input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="按提示词搜索任务" className="h-8 border-white/10 bg-white/[0.06] pl-9 text-xs text-white placeholder:text-[#77777e] focus:border-[#7047ff]" />
              </div>
              <p className="py-2 text-right text-[11px] text-[#8d8d94]">已展示 {filteredTasks.length} 条</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              {filteredTasks.map((task) => {
                const batch = latestBatch(task);
                const firstImage = batch?.generations.find((item) => item.imageUrl)?.imageUrl;
                return (
                  <div
                    key={task.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => chooseTask(task)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        chooseTask(task);
                      }
                    }}
                    className={cn('group mb-2 flex w-full items-center gap-3 rounded-lg border p-2 text-left transition', selectedTaskId === task.id ? 'border-[#7047ff]/70 bg-[#7047ff]/10' : 'border-transparent bg-white/[0.035] hover:bg-white/[0.07]')}
                  >
                    <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#24252a]">{firstImage ? <img src={firstImage} alt="" className="h-full w-full object-cover" /> : <Images className="size-4 text-[#717178]" />}</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-[#eeeeF2]">{task.title}</div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-[#85858c]"><span>{formatTime(task.updatedAt)}</span>{batch ? <span className={cn(batch.status === 'failed' && 'text-red-400', batch.status === 'succeeded' && 'text-emerald-400')}>{statusLabel(batch.status)}</span> : null}</div>
                    </div>
                    <Dropdown
                      trigger={['click']}
                      menu={{
                        items: [
                          {
                            key: 'reuse',
                            label: (
                              <span className="inline-flex items-center gap-2">
                                <RefreshCw className="size-3.5" />
                                复用参数
                              </span>
                            ),
                            onClick: () => chooseTask(task),
                          },
                          {
                            key: 'delete',
                            danger: true,
                            label: (
                              <span className="inline-flex items-center gap-2">
                                <Trash2 className="size-3.5" />
                                删除
                              </span>
                            ),
                            onClick: () => deleteTask(task),
                          },
                        ],
                      }}
                      popupRender={(menu) => (
                        <div className="rounded-md border border-white/10 bg-[#202126] text-white shadow-xl [&_.ant-dropdown-menu]:bg-transparent [&_.ant-dropdown-menu]:shadow-none [&_.ant-dropdown-menu-item]:text-white [&_.ant-dropdown-menu-item:hover]:!bg-white/10">
                          {menu}
                        </div>
                      )}
                    >
                      <Button
                        type="text"
                        size="small"
                        className="!text-[#8d8d94] opacity-0 group-hover:opacity-100 hover:!bg-white/10 hover:!text-white"
                        icon={<MoreHorizontal className="size-4" />}
                        onClick={(event) => event.stopPropagation()}
                      />
                    </Dropdown>
                  </div>
                );
              })}
              {!filteredTasks.length ? <div className="py-14 text-center text-xs text-[#77777e]">暂无匹配任务</div> : null}
            </div>
          </section>
        ) : null}

        {hasTaskStage ? (
          <aside aria-label="历史记录" className="absolute inset-y-0 right-0 z-30 flex w-14 flex-col items-center border-l border-white/[0.05] bg-[#111218] pt-4">
            <button type="button" onClick={() => setHistoryOpen((open) => !open)} title="打开历史记录" className="flex size-10 items-center justify-center rounded-lg bg-white/[0.06] text-[#c5c5ca] hover:bg-white/10 hover:text-white"><ListChecks className="size-5" /></button>
            <History className="mt-6 size-4 text-[#d7d7dc]" />
            <span className="mt-2 text-sm leading-5 text-white [writing-mode:vertical-rl]">历史记录</span>
            <span className="mt-3 size-2 rounded-full bg-[#7047ff]" />
          </aside>
        ) : null}

        <main className={cn('absolute inset-y-0 left-0 right-0 overflow-x-hidden overflow-y-auto min-[1440px]:left-16 lg:overflow-hidden', hasTaskStage && 'lg:right-14')}>

          {hasTaskStage ? (
            <>
              <section aria-label="当前任务摘要" className="absolute left-1/2 top-7 z-20 flex h-[72px] w-[calc(100%-32px)] max-w-[1080px] -translate-x-1/2 items-start gap-5">
                {taskReferencePreviewUrl ? (
                  <div className="h-[60px] w-12 shrink-0 -rotate-[4deg] overflow-hidden rounded-md border border-white/10 bg-[#2a2b31] shadow-[0_8px_20px_rgba(0,0,0,0.25)]">
                    <img src={taskReferencePreviewUrl} alt="任务参考图" className="h-full w-full object-cover" />
                  </div>
                ) : (
                  <div className="flex h-[60px] w-12 shrink-0 items-center justify-center rounded-md bg-[#24252b] text-[#777780]"><Images className="size-5" /></div>
                )}
                <div className="min-w-0 flex-1 pt-1">
                  <p className="truncate text-sm leading-5 text-[#f0f0f3]">{selectedBatch?.prompt || selectedTask?.prompt}</p>
                  <div className="mt-3 flex items-center gap-2 text-[11px] text-[#9a9aa2]">
                    <span className="rounded-full border border-white/15 px-3 py-1">模型: {selectedBatch?.modelProfileSnapshot.name || model?.name}</span>
                    <span className="rounded-full border border-white/15 px-3 py-1">
                      比例: {selectedBatch?.parameterSnapshot.aspectRatio || '1:1'}
                    </span>
                    <span className="rounded-full border border-white/15 px-3 py-1">
                      分辨率: {selectedBatch?.parameterSnapshot.resolutionTier || selectedBatch?.parameterSnapshot.size || selectedBatch?.parameterSnapshot.quality || '1K'}
                    </span>
                    {selectedBatch?.parameterSnapshot.resolutionTier === 'CUSTOM' ? (
                      <span className="rounded-full border border-white/15 px-3 py-1">
                        {selectedBatch.parameterSnapshot.width} x {selectedBatch.parameterSnapshot.height}px
                      </span>
                    ) : null}
                  </div>
                </div>
              </section>

              <section aria-label="生成结果" className="absolute left-1/2 top-[118px] z-10 h-[360px] w-[calc(100%-32px)] max-w-[1080px] -translate-x-1/2 bg-[linear-gradient(90deg,#24252c_0%,#202138_58%,#17191f_100%)] lg:bottom-[266px] lg:top-[118px] lg:h-auto">
                <div ref={conversationViewportRef} className="scrollbar-hide absolute inset-0 flex flex-col gap-4 overflow-y-auto p-3 pr-4">
                  {conversationBatches.map((batch) => {
                    const isLatest = batch.id === selectedBatch?.id;
                    const generations = batch.generations.length
                      ? batch.generations
                      : Array.from({ length: batch.requestedCount || 1 }, () => undefined);
                    return (
                      <article key={batch.id} className={cn('shrink-0 rounded-xl border bg-[#1a1b20]/90 p-3', isLatest ? 'border-[#7047ff]/35' : 'border-white/10')}>
                        <div className="mb-3 flex items-start gap-3">
                          <span className="shrink-0 rounded-full bg-[#7047ff]/20 px-2.5 py-1 text-[11px] font-medium text-[#b8a8ff]">第 {batch.sequence} 轮</span>
                          <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-5 text-[#e7e7eb]">{batch.prompt}</p>
                          <time className="shrink-0 text-[11px] text-[#666f91]" dateTime={batch.createdAt}>{formatDateTime(batch.createdAt)}</time>
                        </div>
                        <div className="scrollbar-hide flex gap-3 overflow-x-auto pb-1">
                          {generations.map((generation, index) => (
                            <GenerationTile
                              key={generation?.id || `pending-${batch.id}-${index}`}
                              generation={generation}
                              batchStatus={batch.status}
                              onAttach={setAttachGeneration}
                              onPreview={(item) => { setPreviewGeneration(item); setPreviewZoom(1); setPreviewRotation(0); setPreviewFullscreen(false); }}
                              onReuse={(item) => { void reuseGeneration(item); }}
                              onCompare={(item) => { setCompareGeneration(item); setCompareMode('split'); setCompareSwapped(false); setCompareFullscreen(false); setSplitPosition(50); }}
                              onEdit={setEditorGeneration}
                              onDelete={() => selectedTask && deleteTask(selectedTask)}
                            />
                          ))}
                        </div>
                        <BatchActionPanel
                          batch={batch}
                          isLatest={isLatest}
                          generating={generating}
                          retrying={retrying}
                          onEdit={() => editBatch(batch)}
                          onGenerate={() => {
                            if (isLatest && (batch.status === 'failed' || batch.status === 'partial')) {
                              void retryCurrentBatch();
                              return;
                            }
                            regenerateBatch(batch);
                          }}
                          onDelete={() => selectedTask && deleteTask(selectedTask)}
                        />
                      </article>
                    );
                  })}
                </div>
              </section>
            </>
          ) : (
            <div className="pointer-events-none absolute left-1/2 top-[96px] z-10 hidden h-[245px] w-[calc(100%-32px)] max-w-[1098px] -translate-x-1/2 bg-[url('/ai-studio/creation-hero.png')] bg-[length:100%_100%] bg-center bg-no-repeat sm:block min-[1440px]:w-[1098px]">
              <h2 className="sr-only">今天想创作什么?</h2>
              <p className="sr-only">输入想法，AI帮你实现创意</p>
            </div>
          )}

          <section style={{ backgroundImage: "url('/ai-studio/creation-dialog-frame.png')" }} className={cn('absolute left-4 right-4 z-20 grid w-auto translate-x-0 grid-rows-[minmax(140px,1fr)_auto] gap-3 overflow-visible bg-[#1b1c20]/95 bg-[length:100%_100%] bg-center bg-no-repeat px-4 pb-4 pt-5 sm:left-1/2 sm:right-auto sm:w-[calc(100%-96px)] sm:max-w-[1080px] sm:-translate-x-1/2 lg:w-[calc(100%-96px)] lg:max-w-[1080px] lg:gap-2 lg:px-[18px] lg:pb-4 lg:pt-[18px]', hasTaskStage ? 'top-[150px] min-h-[500px] sm:top-[220px] sm:min-h-[400px] lg:bottom-[30px] lg:top-auto lg:h-[212px] lg:min-h-0 lg:grid-rows-[122px_48px]' : 'top-[180px] min-h-[440px] sm:top-[280px] sm:min-h-[350px] lg:top-[365px] lg:h-[251px] lg:min-h-0 lg:grid-rows-[161px_48px]')}>
            <button type="button" onClick={() => assets.length ? setPromptExpanded(true) : fileInputRef.current?.click()} aria-label="编辑参考图片" title={assets.length ? '编辑参考图片' : '上传参考图片'} className="absolute -top-14 left-0 flex size-12 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/15 lg:-left-[60px] lg:top-0"><Pencil className="size-5" /></button>
            <div className="absolute -top-[30px] right-[30px] flex items-center gap-1.5 text-sm text-[#b3b3b3]"><span className="flex size-5 items-center justify-center rounded-full bg-[#7047ff] text-[10px] font-semibold text-white">AI</span>预计消耗 <strong className="text-[#f0d567]">{actionEstimatedCredits}</strong> 点</div>
            <div className="grid min-h-0 grid-cols-[64px_minmax(0,1fr)] gap-3 sm:grid-cols-[84px_minmax(0,1fr)]">
              <div
                className="relative flex h-[98px] items-center justify-center overflow-visible"
                onMouseEnter={() => setReferenceStackExpanded(true)}
                onMouseLeave={() => setReferenceStackExpanded(false)}
                onFocus={() => setReferenceStackExpanded(true)}
                onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setReferenceStackExpanded(false); }}
              >
                {assets.length ? (
                  <div className="relative h-[86px] w-[71px] overflow-visible">
                    {assets.map((asset, index) => {
                      const isActive = index === activeReferenceIndex;
                      const isHovered = referenceStackExpanded && hoveredReferenceIndex === index;
                      const offsetX = referenceStackExpanded ? index * 65 : index * 4;
                      const offsetY = (isActive ? -4 : index % 2 ? -1 : 1) + (isHovered ? -8 : 0);
                      const rotation = [-5, 7, -4, 6, -7, 4][index % 6];
                      return (
                        <div
                          key={asset.id}
                          className={cn(
                            'group absolute left-0 top-1.5 h-[78px] w-[61px] cursor-pointer rounded-md border border-[#8b72ff]/80 bg-[#222226] shadow-[0_6px_14px_rgba(0,0,0,0.28)] outline-none transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:z-20 hover:shadow-[0_16px_28px_rgba(0,0,0,0.38)] focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-[#a584ff]',
                            isHovered && 'z-20 shadow-[0_16px_28px_rgba(0,0,0,0.38)]'
                          )}
                          style={{ transform: `translate3d(${offsetX}px, ${offsetY}px, 0) rotate(${rotation}deg) scale(${isHovered ? 1.1 : 1})`, zIndex: referenceStackExpanded ? index + 1 : index + 2 }}
                          role="button"
                          tabIndex={0}
                          aria-label={`预览第 ${index + 1} 张参考图`}
                          onClick={() => { setActiveReferenceIndex(index); setPreviewReferenceIndex(index); setPreviewZoom(1); setPreviewRotation(0); setPreviewFullscreen(false); }}
                          onMouseEnter={() => setHoveredReferenceIndex(index)}
                          onMouseLeave={() => setHoveredReferenceIndex((current) => current === index ? null : current)}
                          onFocus={() => setHoveredReferenceIndex(index)}
                          onBlur={() => setHoveredReferenceIndex((current) => current === index ? null : current)}
                          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActiveReferenceIndex(index); setPreviewReferenceIndex(index); setPreviewZoom(1); setPreviewRotation(0); setPreviewFullscreen(false); } }}
                        >
                          <img src={asset.previewUrl} alt={`参考图 ${index + 1}`} className="h-full w-full rounded-[5px] object-cover" />
                          <span aria-hidden className="absolute left-1 top-1 flex min-w-[18px] items-center justify-center rounded-full border border-white/30 bg-[#17171f]/80 px-1 text-[11px] font-semibold leading-4 text-white">{index + 1}</span>
                          <button
                            type="button"
                            aria-label={`删除第 ${index + 1} 张参考图`}
                            className={cn('absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full border border-white/10 bg-[#414148] text-white shadow-lg transition duration-150 hover:bg-[#5b5b64] focus-visible:opacity-100', referenceStackExpanded ? 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100' : 'pointer-events-none opacity-0')}
                            onClick={(event) => { event.stopPropagation(); removeReferenceAsset(asset.id); }}
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      );
                    })}
                    {model?.supportsReferenceImages && assets.length < model.maxReferenceImages ? (
                      <button
                        type="button"
                        aria-label="添加参考图"
                        title="添加参考图"
                        disabled={uploading}
                        onClick={() => fileInputRef.current?.click()}
                        className="absolute bottom-0 left-0 flex size-[38px] items-center justify-center rounded-full border-2 border-[#5a48cf] bg-[#1a1a1c] text-white shadow-[0_5px_14px_rgba(0,0,0,0.32)] transition-[transform,filter] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 active:scale-95 disabled:opacity-40"
                        style={{ transform: `translate3d(${referenceStackExpanded ? assets.length * 65 - 6 : 38}px, 0, 0)`, zIndex: referenceStackExpanded ? assets.length + 2 : 20 }}
                      >
                        {uploading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-5" />}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <button type="button" aria-label="上传参考图" disabled={uploading || !model?.supportsReferenceImages} onClick={() => fileInputRef.current?.click()} className="flex h-[86px] w-[71px] -rotate-[12deg] items-center justify-center rounded-md border-2 border-[#7047ff] bg-[#222226] text-white shadow-[0_0_22px_rgba(112,71,255,0.18)] hover:bg-[#29282f] disabled:opacity-40">{uploading ? <Loader2 className="size-5 animate-spin" /> : <Plus className="size-6" />}</button>
                )}
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" multiple className="hidden" onChange={(event) => uploadFiles(event.target.files)} />
              </div>
              <div className="relative min-h-0 pt-0.5">
                {selectedTemplate ? <div className="mb-1 flex items-center gap-2 text-[11px] text-[#9f8cff]"><PanelsTopLeft className="size-3" /><span className="truncate">{selectedTemplate.name || '已选择提示词模板'}</span><button type="button" onClick={() => {
                  setSelectedTemplate(null);
                  if (templateAssetId) {
                    setAssets((current) => current.filter((item) => item.id !== templateAssetId));
                    setTemplateAssetId('');
                  }
                }} title="取消模板"><X className="size-3" /></button></div> : null}
                <TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={model?.description || '描述空间、风格、材质、光线与构图，或从提示词模板中选择'} className="scrollbar-hide h-full min-h-0 resize-none !border-0 !bg-transparent p-0 text-base leading-6 !text-[#b3b3b3] !shadow-none placeholder:!text-[#77777e] focus:!shadow-none" />
              </div>
            </div>

            <div aria-label="对话框操作" className="absolute right-3 top-3 flex h-10 w-auto items-center justify-center gap-2 lg:-right-[60px] lg:bottom-0 lg:top-auto lg:h-[86px] lg:w-12 lg:flex-col lg:gap-3">
              <button type="button" disabled={assisting || !prompt.trim()} onClick={assistPrompt} title="优化提示词" className="flex size-[30px] items-center justify-center rounded-full text-[#9b9ba2] hover:bg-white/10 hover:text-white disabled:opacity-40">{assisting ? <Loader2 className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}</button>
              <button type="button" onClick={() => setPromptExpanded(true)} title="全屏编辑提示词" className="flex size-[30px] items-center justify-center rounded-full text-[#9b9ba2] hover:bg-white/10 hover:text-white"><Maximize2 className="size-4" /></button>
            </div>

            <div className="grid min-w-0 grid-cols-2 items-center gap-2 overflow-visible sm:flex sm:flex-wrap lg:flex-nowrap lg:overflow-x-auto lg:overflow-y-hidden">
              <Select
                value={modelProfileId || undefined}
                placeholder="选择模型"
                onChange={(value) => {
                  setModelProfileId(value);
                  applyModelDefaults(bootstrap.models.find((item) => item.id === value));
                }}
                className={cn(darkSelectClassName, 'col-span-2 h-10 w-full shrink-0 sm:w-[186px] [&_.ant-select-selector]:!h-10')}
                popupClassName={darkSelectPopupClassName}
                options={bootstrap.models.map((item) => ({ value: item.id, label: item.name }))}
                suffixIcon={<Bot className="size-4 text-[#7047ff]" />}
              />
              <Select
                value={String(count)}
                onChange={(value) => setCount(Number(value))}
                className={cn(darkSelectClassName, 'h-10 w-full shrink-0 sm:w-[104px] [&_.ant-select-selector]:!h-10')}
                popupClassName={darkSelectPopupClassName}
                options={[1, 2, 3, 4].map((value) => ({ value: String(value), label: `${value}张` }))}
                suffixIcon={<Images className="size-4 text-[#f5f5f5]" />}
              />
              {resolutionTier !== 'CUSTOM' ? (
                <Select
                  value={aspectRatio}
                  onChange={setAspectRatio}
                  className={cn(darkSelectClassName, 'h-10 w-full shrink-0 sm:w-[128px] [&_.ant-select-selector]:!h-10')}
                  popupClassName={darkSelectPopupClassName}
                  options={availableAspectRatios.map((item) => ({ value: item, label: item === 'auto' ? '自动比例' : item }))}
                  suffixIcon={<Crop className="size-4 text-[#f5f5f5]" />}
                />
              ) : null}
              <Select
                value={resolutionTier}
                onChange={(value) => {
                  const nextTier = value as typeof resolutionTier;
                  const nextRatios = model?.aspectRatiosByResolutionTier?.[nextTier] || model?.aspectRatios || [];
                  setResolutionTier(nextTier);
                  if (nextTier !== 'CUSTOM' && !nextRatios.includes(aspectRatio)) {
                    setAspectRatio(nextRatios.includes(model?.defaults.aspectRatio || '') ? model?.defaults.aspectRatio || nextRatios[0] : nextRatios[0]);
                  }
                }}
                className={cn(darkSelectClassName, 'h-10 w-full shrink-0 sm:w-[116px] [&_.ant-select-selector]:!h-10')}
                popupClassName={darkSelectPopupClassName}
                options={(model?.resolutionTiers || []).map((item) => ({ value: item, label: item === 'CUSTOM' ? '自定义' : item }))}
                suffixIcon={<Maximize2 className="size-4 text-[#f5f5f5]" />}
              />
              {resolutionTier === 'CUSTOM' && model?.supportsCustomSize ? (
                <div className="col-span-2 flex h-10 w-full shrink-0 items-center justify-center gap-1 rounded-lg border border-[#37373b] bg-[#222226] px-2 sm:w-auto">
                  <Input aria-label="自定义宽度" title="自定义宽度（16 的倍数）" type="number" min={16} max={3840} step={16} value={customWidth} onChange={(event) => setCustomWidth(Number(event.target.value))} className="h-8 w-[76px] !border-0 !bg-transparent px-1 text-center text-sm !text-white !shadow-none focus:!shadow-none" />
                  <span className="text-xs text-[#77777e]">x</span>
                  <Input aria-label="自定义高度" title="自定义高度（16 的倍数）" type="number" min={16} max={3840} step={16} value={customHeight} onChange={(event) => setCustomHeight(Number(event.target.value))} className="h-8 w-[76px] !border-0 !bg-transparent px-1 text-center text-sm !text-white !shadow-none focus:!shadow-none" />
                  <span className="text-xs text-[#77777e]">px</span>
                </div>
              ) : null}
              <button type="button" onClick={() => setTemplateOpen(true)} className="flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-[#37373b] bg-[#222226] px-3 text-sm text-[#f5f5f5] hover:bg-[#2a2a2f] sm:w-[124px]"><PanelsTopLeft className="size-4" />提示词模板</button>
              <button
                type="button"
                disabled={generating || retrying || currentBatchActive || !prompt.trim() || !modelProfileId || !hasEnabledPrice}
                onClick={shouldRetryCurrentBatch ? retryCurrentBatch : () => { void submitGeneration(); }}
                className="col-span-2 ml-0 flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#9447ff] to-[#5f2cff] px-3 text-base font-normal text-white shadow-[0_0_24px_rgba(104,49,255,0.2)] hover:brightness-110 disabled:cursor-not-allowed disabled:bg-[#6b6b6b] disabled:bg-none disabled:opacity-100 sm:ml-auto sm:w-[152px]"
              >
                {generating || retrying || currentBatchActive ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {retrying ? '重试中' : currentBatchActive ? '生成中' : shouldRetryCurrentBatch ? (selectedBatch?.status === 'partial' ? '重试失败项' : '重试本轮') : hasTaskStage ? '开始新一轮' : '开始生图'}
              </button>
            </div>
          </section>
        </main>
      </div>

      <TemplateLibraryDialog open={templateOpen} onOpenChange={setTemplateOpen} selectedTemplateId={selectedTemplate?.id} onSelect={applyTemplate} />

      <Modal
        open={promptExpanded}
        onCancel={() => setPromptExpanded(false)}
        footer={null}
        title={<span className="text-base text-white">编辑提示词</span>}
        width="48rem"
        destroyOnHidden
        classNames={{
          content: 'border border-white/15 bg-[#1b1c20] text-white sm:rounded-xl',
          header: 'border-0 bg-transparent',
          body: 'pt-2',
        }}
      >
        <span className="sr-only">编辑本次生成使用的正向和负向提示词。</span>
        <TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述空间、风格、材质、光线与构图" className="min-h-64 resize-none border-white/10 bg-[#222328] leading-6 !text-white placeholder:!text-[#77777e]" />
        <div className="mt-4">
          <label className="mb-2 block text-xs text-[#a7a7ad]">不希望出现的内容（可选）</label>
          <TextArea value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} className="min-h-24 resize-none border-white/10 bg-[#222328] !text-white" />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button className="border-white/15 bg-transparent text-white hover:!border-white/25 hover:!bg-white/10 hover:!text-white" onClick={() => { setPrompt(''); setNegativePrompt(''); }}>清空</Button>
          <Button type="primary" className="!bg-[#7047ff] !text-white hover:!bg-[#6034ee]" onClick={() => setPromptExpanded(false)}>完成</Button>
        </div>
      </Modal>

      <Modal
        open={Boolean(attachGeneration)}
        onCancel={() => setAttachGeneration(null)}
        footer={null}
        title={<span className="text-base text-white">归入客户方案</span>}
        width={448}
        destroyOnHidden
        classNames={{
          content: 'border border-white/15 bg-[#1b1c20] text-white sm:rounded-xl',
          header: 'border-0 bg-transparent',
          body: 'pt-2',
        }}
      >
        <span className="sr-only">选择要归档生成结果的客户方案。</span>
        <Select
          value={attachWorkflowId || undefined}
          placeholder="选择客户方案"
          onChange={setAttachWorkflowId}
          className={cn(darkSelectClassName, 'w-full [&_.ant-select-selector]:!border-white/10 [&_.ant-select-selector]:!bg-[#222328]')}
          popupClassName={darkSelectPopupClassName}
          options={bootstrap.workflows.map((workflow) => ({
            value: workflow.id,
            label: `${workflow.leadName ? `${workflow.leadName} · ` : ''}${workflow.title}`,
          }))}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button className="border-white/15 bg-transparent text-white hover:!border-white/25 hover:!bg-white/10 hover:!text-white" onClick={() => setAttachGeneration(null)}>取消</Button>
          <Button type="primary" className="!bg-[#7047ff] !text-white hover:!bg-[#6034ee]" disabled={!attachWorkflowId} onClick={attachToWorkflow} icon={<Check className="size-4" />}>确认归入</Button>
        </div>
      </Modal>

      <Modal
        open={Boolean(previewGeneration)}
        onCancel={() => setPreviewGeneration(null)}
        footer={null}
        title={null}
        closable
        destroyOnHidden
        width={previewFullscreen ? '100vw' : '92vw'}
        centered={!previewFullscreen}
        classNames={{
          content: cn('border border-white/10 bg-[#111216] sm:rounded-xl', previewFullscreen && '!rounded-none'),
          body: 'p-0',
        }}
        styles={{
          content: {
            height: previewFullscreen ? '100vh' : '90vh',
            maxWidth: previewFullscreen ? '100vw' : '92vw',
            padding: 12,
            ...(previewFullscreen ? { top: 0, margin: 0, maxWidth: '100vw' } : {}),
          },
          body: { height: '100%', padding: 0 },
        }}
      >
        <span className="sr-only">生成结果预览</span>
        <span className="sr-only">查看、缩放、旋转或下载生成结果。</span>
        <div className="relative flex h-full items-center justify-center overflow-hidden">
          {previewGeneration?.imageUrl ? <img src={previewGeneration.imageUrl} alt="生成结果大图" className="max-h-full max-w-full object-contain transition-transform" style={{ transform: `scale(${previewZoom}) rotate(${previewRotation}deg)` }} /> : null}
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-white/10 bg-black/70 p-1.5 backdrop-blur">
            <Button type="default" size="small" title="放大图片" className={iconToolbarButtonClassName} onClick={() => setPreviewZoom((value) => Math.min(3, value + 0.2))} icon={<Plus className="size-3.5" />} />
            <Button type="default" size="small" title="缩小图片" className={iconToolbarButtonClassName} onClick={() => setPreviewZoom((value) => Math.max(0.4, value - 0.2))} icon={<Minus className="size-3.5" />} />
            <Button type="default" size="small" title="恢复原始比例" className={secondaryToolbarButtonClassName} onClick={() => { setPreviewZoom(1); setPreviewRotation(0); }}>1:1</Button>
            <Button type="default" size="small" title="顺时针旋转图片" className={iconToolbarButtonClassName} onClick={() => setPreviewRotation((value) => value + 90)} icon={<RotateCw className="size-3.5" />} />
            <Button type="default" size="small" title="全屏预览" className={iconToolbarButtonClassName} onClick={() => setPreviewFullscreen((value) => !value)} icon={<Maximize2 className="size-3.5" />} />
            {previewGeneration?.imageUrl ? (
              <Button type="default" size="small" title="下载图片" href={previewGeneration.imageUrl} download={`ai-creation-${previewGeneration.id}.png`} className={iconToolbarButtonClassName} icon={<Download className="size-3.5" />} />
            ) : null}
          </div>
        </div>
      </Modal>

      <Modal
        open={previewReferenceIndex !== null}
        onCancel={() => setPreviewReferenceIndex(null)}
        footer={null}
        title={<span className="text-base text-white">图片预览</span>}
        destroyOnHidden
        width={previewFullscreen ? '100vw' : '92vw'}
        centered={!previewFullscreen}
        classNames={{
          content: cn('border border-white/10 bg-[#111216] text-white sm:rounded-xl', previewFullscreen && '!rounded-none'),
          header: 'border-0 bg-transparent',
          body: 'pt-2',
        }}
        styles={{
          content: {
            height: previewFullscreen ? '100vh' : '90vh',
            maxWidth: previewFullscreen ? '100vw' : '92vw',
            padding: 16,
            display: 'grid',
            gridTemplateRows: 'auto minmax(0, 1fr) auto',
            ...(previewFullscreen ? { top: 0, margin: 0 } : {}),
          },
        }}
      >
        <span className="sr-only">查看、切换、缩放、旋转或下载已上传的参考图片。</span>
        <div className="relative min-h-0 overflow-hidden rounded-lg bg-black/25">
          {previewReference ? <img src={previewReference.previewUrl} alt={`参考图 ${(previewReferenceIndex || 0) + 1} 大图`} className="h-full w-full object-contain transition-transform" style={{ transform: `scale(${previewZoom}) rotate(${previewRotation}deg)` }} /> : null}
          {assets.length > 1 ? (
            <>
              <Button type="default" size="small" className={cn(iconToolbarButtonClassName, 'absolute left-2 top-1/2 -translate-y-1/2 !bg-black/60 hover:!bg-black/80')} title="查看上一张图片" onClick={() => { setPreviewReferenceIndex((current) => current === null ? 0 : (current - 1 + assets.length) % assets.length); setPreviewZoom(1); setPreviewRotation(0); }} icon={<ChevronRight className="size-4 rotate-180" />} />
              <Button type="default" size="small" className={cn(iconToolbarButtonClassName, 'absolute right-2 top-1/2 -translate-y-1/2 !bg-black/60 hover:!bg-black/80')} title="查看下一张图片" onClick={() => { setPreviewReferenceIndex((current) => current === null ? 0 : (current + 1) % assets.length); setPreviewZoom(1); setPreviewRotation(0); }} icon={<ChevronRight className="size-4" />} />
            </>
          ) : null}
          <div className="absolute right-3 top-3 flex items-center gap-1 rounded-lg border border-white/10 bg-black/70 p-1.5 backdrop-blur">
            <Button type="default" size="small" title="放大图片" className={iconToolbarButtonClassName} onClick={() => setPreviewZoom((value) => Math.min(3, value + 0.2))} icon={<Plus className="size-3.5" />} />
            <Button type="default" size="small" title="缩小图片" className={iconToolbarButtonClassName} onClick={() => setPreviewZoom((value) => Math.max(0.4, value - 0.2))} icon={<Minus className="size-3.5" />} />
            <Button type="default" size="small" title="恢复原始比例" className={secondaryToolbarButtonClassName} onClick={() => { setPreviewZoom(1); setPreviewRotation(0); }}>1:1</Button>
            <Button type="default" size="small" title="顺时针旋转图片" className={iconToolbarButtonClassName} onClick={() => setPreviewRotation((value) => value + 90)} icon={<RotateCw className="size-3.5" />} />
            <Button type="default" size="small" title="全屏预览" className={iconToolbarButtonClassName} onClick={() => setPreviewFullscreen((value) => !value)} icon={<Maximize2 className="size-3.5" />} />
            {previewReference ? (
              <Button type="default" size="small" title="下载图片" href={previewReference.previewUrl} download={`ai-reference-${previewReference.id}.png`} className={iconToolbarButtonClassName} icon={<Download className="size-3.5" />} />
            ) : null}
          </div>
        </div>
        {assets.length > 1 ? (
          <div aria-label="参考图缩略图列表" className="mt-3 flex justify-center gap-3 overflow-x-auto pb-1">
            {assets.map((asset, index) => (
              <button
                key={asset.id}
                type="button"
                title={`查看第 ${index + 1} 张参考图`}
                aria-label={`查看第 ${index + 1} 张参考图`}
                onClick={() => { setPreviewReferenceIndex(index); setActiveReferenceIndex(index); setPreviewZoom(1); setPreviewRotation(0); }}
                className={cn('relative h-20 w-16 shrink-0 overflow-hidden rounded-md border-2 bg-[#24252b] transition', previewReferenceIndex === index ? 'border-[#8b72ff] shadow-[0_0_0_2px_rgba(112,71,255,0.28)]' : 'border-white/15 hover:border-white/40')}
              >
                <img src={asset.previewUrl} alt={`缩略图 ${index + 1}`} className="h-full w-full object-cover" />
                <span className="absolute left-1 top-1 rounded bg-black/65 px-1 text-[10px] font-semibold text-white">{index + 1}</span>
              </button>
            ))}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(compareGeneration)}
        onCancel={() => { setCompareGeneration(null); setCompareFullscreen(false); }}
        footer={null}
        closable={false}
        title={<span className="text-base text-white">方案对比</span>}
        destroyOnHidden
        width={compareFullscreen ? '100vw' : '72rem'}
        centered={!compareFullscreen}
        classNames={{
          content: cn('border border-white/10 bg-[#1b1c20] text-white sm:rounded-2xl', compareFullscreen && '!rounded-none !border-0 !shadow-none'),
          header: 'border-0 bg-transparent',
          body: 'pt-2',
        }}
        styles={{
          content: {
            padding: compareFullscreen ? 16 : 20,
            ...(compareFullscreen
              ? { top: 0, margin: 0, height: '100dvh', maxWidth: '100dvw', width: '100dvw' }
              : {}),
          },
        }}
      >
        <span className="sr-only">比较参考图与生成结果并调整对比方式。</span>
        <button type="button" aria-label="关闭方案对比" title="关闭方案对比" onClick={() => { setCompareGeneration(null); setCompareFullscreen(false); }} className="absolute right-4 top-4 z-20 flex size-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"><X className="size-5" /></button>
        {compareGeneration?.imageUrl && assets[0]?.previewUrl ? (() => {
          const generatedUrl = compareGeneration.imageUrl;
          const referenceUrl = assets[0].previewUrl;
          const imageA = compareSwapped ? generatedUrl : referenceUrl;
          const imageB = compareSwapped ? referenceUrl : generatedUrl;
          const vertical = compareLayout === 'vertical';
          return <>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="small" className={secondaryToolbarButtonClassName} onClick={() => setCompareSwapped((value) => !value)}>交换</Button>
              <Button size="small" className={cn(secondaryToolbarButtonClassName, compareMode === 'reference' && '!border-[#8d67ff] !bg-[#6e45ef]/20')} onClick={() => setCompareMode('reference')}>只看 A 图</Button>
              <Button size="small" className={cn(secondaryToolbarButtonClassName, compareMode === 'generated' && '!border-[#8d67ff] !bg-[#6e45ef]/20')} onClick={() => setCompareMode('generated')}>只看 B 图</Button>
              <Button size="small" className={cn(secondaryToolbarButtonClassName, compareMode === 'split' && '!border-[#8d67ff] !bg-[#6e45ef]/20')} onClick={() => setCompareMode('split')} icon={<Columns2 className="size-3.5" />}>分割对比</Button>
              <Button size="small" className={cn(secondaryToolbarButtonClassName, compareMode === 'sync' && '!border-[#8d67ff] !bg-[#6e45ef]/20')} onClick={() => setCompareMode('sync')} icon={<Images className="size-3.5" />}>同步对比</Button>
              <span className="h-6 w-px bg-white/10" />
              <Button size="small" className={cn(secondaryToolbarButtonClassName, compareLayout === 'horizontal' && '!border-[#8d67ff] !bg-[#6e45ef]/20')} onClick={() => setCompareLayout('horizontal')}>左右</Button>
              <Button size="small" className={cn(secondaryToolbarButtonClassName, compareLayout === 'vertical' && '!border-[#8d67ff] !bg-[#6e45ef]/20')} onClick={() => setCompareLayout('vertical')}>上下</Button>
              <Button size="small" className={secondaryToolbarButtonClassName} onClick={() => { setCompareSwapped(false); setCompareMode('split'); setCompareLayout('horizontal'); setSplitPosition(50); }}>居中</Button>
              <Button size="small" className={secondaryToolbarButtonClassName} onClick={() => setCompareFullscreen((value) => !value)} icon={<Maximize2 className="size-3.5" />}>全屏</Button>
              <Button size="small" className={iconToolbarButtonClassName} title="下载对比图" onClick={() => { void downloadComparison(); }} icon={<Download className="size-3.5" />} />
            </div>
            <div className={cn('flex min-h-0 items-center justify-center overflow-auto rounded-xl border border-white/10 bg-[#111216] p-3', compareFullscreen ? 'mt-3 h-full' : 'mt-4 h-[min(62vh,620px)]')}>
              {compareMode === 'reference' ? <img src={imageA} alt="方案 A" className="max-h-full max-w-full object-contain" /> : null}
              {compareMode === 'generated' ? <img src={imageB} alt="方案 B" className="max-h-full max-w-full object-contain" /> : null}
              {compareMode === 'split' ? <div ref={compareViewportRef} className="relative h-full w-full overflow-hidden">
                <img src={imageB} alt="方案 B" className="absolute inset-0 h-full w-full object-contain" />
                <img src={imageA} alt="方案 A" className="absolute inset-0 h-full w-full object-contain" style={{ clipPath: vertical ? `inset(0 0 ${100 - splitPosition}% 0)` : `inset(0 ${100 - splitPosition}% 0 0)` }} />
                <span className="absolute bottom-2 left-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white">A</span>
                <span className="absolute bottom-2 right-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white">B</span>
                <button
                  type="button"
                  aria-label="拖动分割线"
                  title="拖动分割线"
                  className={cn('absolute z-10 touch-none', vertical ? 'inset-x-0 h-8 -translate-y-1/2 cursor-row-resize' : 'inset-y-0 w-8 -translate-x-1/2 cursor-col-resize')}
                  style={vertical ? { top: `${splitPosition}%` } : { left: `${splitPosition}%` }}
                  onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); moveSplitDivider(event); }}
                  onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) moveSplitDivider(event); }}
                  onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
                >
                  <span className={cn('absolute left-1/2 top-1/2 flex items-center justify-center rounded-full border border-white/30 bg-[#2c2d32] text-white shadow-lg', vertical ? 'h-5 w-9 -translate-x-1/2 -translate-y-1/2' : 'h-9 w-5 -translate-x-1/2 -translate-y-1/2')}>
                    {vertical ? <GripHorizontal className="size-3" /> : <GripVertical className="size-3" />}
                  </span>
                </button>
                <span aria-hidden className={cn('pointer-events-none absolute z-[5] bg-white shadow-[0_0_6px_rgba(0,0,0,0.65)]', vertical ? 'inset-x-0 h-px -translate-y-1/2' : 'inset-y-0 w-px -translate-x-1/2')} style={vertical ? { top: `${splitPosition}%` } : { left: `${splitPosition}%` }} />
              </div> : null}
              {compareMode === 'sync' ? <div className={cn('flex h-full w-full gap-3', vertical ? 'flex-col' : 'flex-row')}><img src={imageA} alt="方案 A" className="min-h-0 min-w-0 flex-1 object-contain" /><img src={imageB} alt="方案 B" className="min-h-0 min-w-0 flex-1 object-contain" /></div> : null}
            </div>
          </>;
        })() : <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-white/15 text-sm text-[#a3a3aa]">引用一张参考图后，即可进行方案对比。</div>}
      </Modal>

      <ImageEditorDialog imageUrl={editorGeneration?.imageUrl} open={Boolean(editorGeneration)} onOpenChange={(open) => !open && setEditorGeneration(null)} onUse={useAnnotatedImage} />
    </div>
    </ConfigProvider>
  );
}
