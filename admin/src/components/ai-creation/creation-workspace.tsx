/* eslint-disable @next/next/no-img-element -- Authenticated media routes and imported source URLs are dynamic. */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { notify } from '@/components/ui/operation-feedback';
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

type BootstrapData = {
  account: { balance: number; frozenBalance: number; availableBalance: number };
  price: { credits: number; label: string };
  provider: { actionEnabled: boolean; supportsGenerate: boolean; supportsEdit: boolean };
  models: CreationModelProfile[];
  workflows: CreationWorkflow[];
};

type TemplateDetail = PromptTemplate & {
  parameterTemplate?: { parameters?: Record<string, unknown> };
};

const darkSelectItemClassName = 'text-[#f5f5f5] focus:bg-white/10 focus:text-white data-[state=checked]:bg-white/[0.08] data-[state=checked]:text-white';

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

function batchGenerations(batch?: CreationBatch) {
  return batch?.generations || [];
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
          <span className="text-xs font-medium text-[#ededf2]">生成中</span>
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
      </div>
    );
  }
  return (
    <div className="group relative size-[216px] shrink-0 overflow-hidden rounded-lg bg-[#25262c] shadow-[0_10px_30px_rgba(0,0,0,0.2)]">
      <button type="button" onClick={() => onPreview(generation)} className="h-full w-full">
        <img src={generation.imageUrl} alt="AI 生成结果" className="h-full w-full object-contain" />
      </button>
      <div className="absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-1 rounded-lg bg-[#202126]/95 p-1.5 text-[#e5e5ea] opacity-0 shadow-xl backdrop-blur transition group-hover:opacity-100 group-focus-within:opacity-100">
        <Button size="icon-sm" variant="secondary" asChild title="下载">
          <a href={generation.imageUrl} download={`ai-creation-${generation.id}.png`}><Download /></a>
        </Button>
        <Button size="icon-sm" variant="secondary" onClick={() => onReuse(generation)} title="引用为参考图"><Copy /></Button>
        <Button size="icon-sm" variant="secondary" onClick={() => onCompare(generation)} title="对比"><Columns2 /></Button>
        <Button size="icon-sm" variant="secondary" onClick={() => onEdit(generation)} title="编辑"><Pencil /></Button>
        <Button size="icon-sm" variant="secondary" onClick={() => onAttach(generation)} title="归入客户方案"><FolderInput /></Button>
        <Button size="icon-sm" variant="secondary" className="text-[#ff8388] hover:text-[#ffaaaa]" onClick={onDelete} title="删除"><Trash2 /></Button>
      </div>
      {generation.workflowId ? (
        <span className="absolute left-2 top-2 rounded-md bg-[#7047ff] px-2 py-1 text-[11px] font-medium text-white">已归入方案</span>
      ) : null}
    </div>
  );
}

export function CreationWorkspace() {
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
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
  const [templateOpen, setTemplateOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [assisting, setAssisting] = useState(false);
  const [attachGeneration, setAttachGeneration] = useState<CreationGeneration | null>(null);
  const [attachWorkflowId, setAttachWorkflowId] = useState('');
  const [previewGeneration, setPreviewGeneration] = useState<CreationGeneration | null>(null);
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
    const payload = await readJson(await fetch('/api/ai/creation/bootstrap'));
    setBootstrap(payload.data);
    setModelProfileId((current) => current || payload.data.models?.[0]?.id || '');
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

  const hasProcessing = tasks.some((task) => task.batches.some((batch) => batch.status === 'processing' || batch.status === 'pending'));
  useEffect(() => {
    if (!hasProcessing) return;
    const timer = window.setInterval(() => loadTasks(true), 4500);
    return () => window.clearInterval(timer);
  }, [hasProcessing, loadTasks]);

  const selectedTask = tasks.find((task) => task.id === selectedTaskId);
  const selectedBatch = latestBatch(selectedTask);
  const conversationBatches = selectedTask ? [...selectedTask.batches].sort((a, b) => a.sequence - b.sequence) : [];
  const hasTaskStage = Boolean(selectedTask && selectedBatch);
  const latestResults = batchGenerations(selectedBatch);
  const displayGenerations = latestResults.length
    ? latestResults
    : Array.from({ length: selectedBatch?.requestedCount || 1 }, () => undefined);
  const model = bootstrap?.models.find((item) => item.id === modelProfileId);
  const availableAspectRatios = model?.aspectRatiosByResolutionTier?.[resolutionTier] || model?.aspectRatios || [];
  const unitPrice = model?.prices.find((price) => price.resolutionTier === resolutionTier)?.credits || 0;
  const estimatedCredits = unitPrice * count;
  const hasEnabledPrice = unitPrice > 0;

  useEffect(() => {
    const viewport = conversationViewportRef.current;
    const latestRound = viewport?.lastElementChild as HTMLElement | null;
    if (viewport && latestRound) viewport.scrollTop = Math.max(0, latestRound.offsetTop - 12);
  }, [selectedTaskId, conversationBatches.length]);

  const applyModelDefaults = (profile?: CreationModelProfile) => {
    if (!profile) return;
    setAspectRatio(profile.defaults.aspectRatio);
    setResolutionTier(profile.defaults.resolutionTier);
    setCustomWidth(1024);
    setCustomHeight(1024);
    setAssets((current) => current.slice(0, profile.maxReferenceImages));
  };

  const chooseTask = (task: CreationTask) => {
    const batch = latestBatch(task);
    const storedTier = batch?.parameterSnapshot.resolutionTier
      || batch?.parameterSnapshot.size?.toUpperCase()
      || '1K';
    setSelectedTaskId(task.id);
    setPrompt(batch?.prompt || task.prompt);
    setNegativePrompt(batch?.negativePrompt || '');
    setModelProfileId(batch?.modelProfileId || task.modelProfileId);
    setAspectRatio(batch?.parameterSnapshot.aspectRatio || '1:1');
    setResolutionTier(
      ['1K', '2K', '4K', 'CUSTOM'].includes(storedTier)
        ? storedTier as '1K' | '2K' | '4K' | 'CUSTOM'
        : '1K'
    );
    setCustomWidth(batch?.parameterSnapshot.width || 1024);
    setCustomHeight(batch?.parameterSnapshot.height || 1024);
    setCount(batch?.requestedCount || 1);
    setSelectedTemplate(batch?.parameterSnapshot.templateId ? { id: batch.parameterSnapshot.templateId } as TemplateDetail : null);
    const referenceAssetIds = batch?.referenceAssetIds || task.referenceAssetIds;
    setAssets(referenceAssetIds.map((id) => ({ id, previewUrl: `/api/ai/assets/${id}/image` })));
    setHistoryOpen(false);
  };

  const newCreation = () => {
    const first = bootstrap?.models[0];
    setSelectedTaskId('');
    setPrompt('');
    setNegativePrompt('');
    setSelectedTemplate(null);
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

  const reuseGeneration = async (generation: CreationGeneration) => {
    if (!generation.imageUrl) return;
    try {
      const response = await fetch(generation.imageUrl);
      if (!response.ok) throw new Error('无法读取生成结果');
      const blob = await response.blob();
      await uploadReferenceFiles([new File([blob], `ai-creation-${generation.id}.png`, { type: blob.type || 'image/png' })], '已引用生成结果');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '引用生成结果失败');
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

  const applyTemplate = (template: TemplateDetail) => {
    setSelectedTemplate(template);
    setPrompt(template.promptContent);
    if (template.recommendedModelProfileId) {
      const recommended = bootstrap?.models.find((item) => item.id === template.recommendedModelProfileId);
      if (recommended) {
        setModelProfileId(recommended.id);
        applyModelDefaults(recommended);
      }
    }
    notify.success(`已应用模板：${template.name}`);
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

  const submitGeneration = async () => {
    if (!prompt.trim()) return notify.warning('请输入提示词');
    if (!modelProfileId) return notify.warning('请选择模型');
    if (!hasEnabledPrice) return notify.warning('当前模型分辨率尚未开放');
    if (!bootstrap?.provider.actionEnabled) return notify.error('当前企业未开放 AI 自由创作');
    if (!bootstrap?.provider.supportsGenerate) return notify.error('尚未配置可用的图片生成模型');
    if (assets.length && !bootstrap.provider.supportsEdit) return notify.error('尚未配置可用的图片编辑模型');
    if ((bootstrap.account.availableBalance || 0) < estimatedCredits) return notify.error(`AI 点数不足，本次需要 ${estimatedCredits} 点`);
    setGenerating(true);
    const loadingId = notify.loading('正在提交生成任务');
    try {
      let taskId = selectedTaskId;
      if (!taskId) {
        const created = await readJson(await fetch('/api/ai/creation/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: prompt.trim().slice(0, 32),
            prompt,
            referenceAssetIds: assets.map((asset) => asset.id),
            modelProfileId,
          }),
        }));
        taskId = created.data.id;
        setSelectedTaskId(taskId);
      }
      const generated = await readJson(await fetch(`/api/ai/creation/tasks/${taskId}/batches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          negativePrompt,
          referenceAssetIds: assets.map((asset) => asset.id),
          modelProfileId,
          aspectRatio,
          resolutionTier,
          width: resolutionTier === 'CUSTOM' ? customWidth : undefined,
          height: resolutionTier === 'CUSTOM' ? customHeight : undefined,
          templateId: selectedTemplate?.id,
          count,
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
    return <div className="flex h-screen items-center justify-center bg-[#16171b] text-sm text-[#b3b3b3]"><Loader2 className="mr-2 size-5 animate-spin text-[#7047ff]" />加载 AI 创作台</div>;
  }

  return (
    <div className="fixed inset-0 h-screen min-h-[720px] min-w-0 overflow-x-hidden overflow-y-auto bg-[#16171b] font-sans text-[#f6f7fb] lg:min-w-[1024px] lg:overflow-hidden">
      <header className="relative z-40 flex h-[68px] min-w-0 items-center justify-between border-b border-white/[0.08] bg-[#16171b] px-3 lg:min-w-[1024px]">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/ai-studio/scenarios" className="flex items-center gap-2 text-white" title="返回后台 AI 工作台">
            <span className="flex size-7 items-center justify-center rounded-md border border-[#7047ff]/70 text-[#8b6cff]"><Sparkles className="size-4" /></span>
            <span className="hidden text-[15px] font-semibold sm:inline">SMART FLOOR AI</span>
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
                <Input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="按提示词搜索任务" className="h-8 border-white/10 bg-white/[0.06] pl-9 text-xs text-white placeholder:text-[#77777e] focus-visible:ring-[#7047ff]" />
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
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(event) => event.stopPropagation()}><Button variant="ghost" size="icon-xs" className="text-[#8d8d94] opacity-0 group-hover:opacity-100"><MoreHorizontal /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="border-white/10 bg-[#202126] text-white"><DropdownMenuItem onSelect={() => chooseTask(task)}><RefreshCw />复用参数</DropdownMenuItem><DropdownMenuItem className="text-red-400" onSelect={() => deleteTask(task)}><Trash2 />删除</DropdownMenuItem></DropdownMenuContent>
                    </DropdownMenu>
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
                {assets[0] ? (
                  <div className="h-[60px] w-12 shrink-0 -rotate-[4deg] overflow-hidden rounded-md border border-white/10 bg-[#2a2b31] shadow-[0_8px_20px_rgba(0,0,0,0.25)]">
                    <img src={assets[0].previewUrl} alt="任务参考图" className="h-full w-full object-cover" />
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
                <div ref={conversationViewportRef} className="scrollbar-hide absolute inset-0 flex flex-col gap-4 overflow-y-auto p-3 pb-14 pr-4">
                  {conversationBatches.slice(0, -1).map((batch) => (
                    <article key={batch.id} className="shrink-0 rounded-xl border border-white/10 bg-[#1a1b20]/85 p-3">
                      <div className="mb-3 flex items-start gap-3">
                        <span className="shrink-0 rounded-full bg-[#7047ff]/20 px-2.5 py-1 text-[11px] font-medium text-[#b8a8ff]">第 {batch.sequence} 轮</span>
                        <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-5 text-[#e7e7eb]">{batch.prompt}</p>
                        <time className="shrink-0 text-[11px] text-[#666f91]" dateTime={batch.createdAt}>{formatDateTime(batch.createdAt)}</time>
                      </div>
                      <div className="scrollbar-hide flex gap-3 overflow-x-auto pb-1">
                        {(batch.generations.length ? batch.generations : Array.from({ length: batch.requestedCount || 1 }, () => undefined)).map((generation, index) => (
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
                    </article>
                  ))}
                  <article className="shrink-0 rounded-xl border border-[#7047ff]/35 bg-[#1a1b20]/90 p-3">
                    <div className="mb-3 flex items-start gap-3">
                      <span className="shrink-0 rounded-full bg-[#7047ff]/20 px-2.5 py-1 text-[11px] font-medium text-[#b8a8ff]">第 {selectedBatch?.sequence} 轮</span>
                      <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-5 text-[#e7e7eb]">{selectedBatch?.prompt}</p>
                      {selectedBatch?.createdAt ? <time className="shrink-0 text-[11px] text-[#666f91]" dateTime={selectedBatch.createdAt}>{formatDateTime(selectedBatch.createdAt)}</time> : null}
                    </div>
                    <div className="scrollbar-hide flex gap-3 overflow-x-auto pb-1">
                    {displayGenerations.map((generation, index) => (
                    <GenerationTile
                      key={generation?.id || `pending-${index}`}
                      generation={generation}
                      batchStatus={selectedBatch?.status}
                      onAttach={setAttachGeneration}
                      onPreview={(item) => { setPreviewGeneration(item); setPreviewZoom(1); setPreviewRotation(0); setPreviewFullscreen(false); }}
                      onReuse={(item) => { void reuseGeneration(item); }}
                      onCompare={(item) => { setCompareGeneration(item); setCompareMode('split'); setCompareSwapped(false); setCompareFullscreen(false); setSplitPosition(50); }}
                      onEdit={setEditorGeneration}
                      onDelete={() => selectedTask && deleteTask(selectedTask)}
                    />
                    ))}
                    </div>
                  </article>
                </div>
                <div className="absolute bottom-2 left-3 flex h-[30px] items-center gap-2 lg:bottom-2 lg:left-3">
                  <button type="button" onClick={() => setPromptExpanded(true)} className="flex h-[30px] items-center gap-1.5 rounded-md bg-[#2a2b31] px-3 text-xs text-[#d5d5da] hover:bg-[#34353c] hover:text-white"><Pencil className="size-3.5" />重新编辑</button>
                  <button type="button" disabled={generating} onClick={submitGeneration} className="flex h-[30px] items-center gap-1.5 rounded-md bg-[#2a2b31] px-3 text-xs text-[#d5d5da] hover:bg-[#34353c] hover:text-white disabled:opacity-50">{generating ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}再次生成</button>
                  {selectedTask ? <button type="button" onClick={() => deleteTask(selectedTask)} className="flex h-[30px] items-center gap-1.5 rounded-md bg-[#2a2b31] px-3 text-xs text-[#ff6f75] hover:bg-[#34353c]"><Trash2 className="size-3.5" />删除</button> : null}
                </div>
                <time className="absolute bottom-2 right-[25%] text-[11px] text-[#666f91]" dateTime={selectedBatch?.createdAt}>{selectedBatch?.createdAt ? formatDateTime(selectedBatch.createdAt) : null}</time>
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
            <div className="absolute -top-[30px] right-[30px] flex items-center gap-1.5 text-sm text-[#b3b3b3]"><span className="flex size-5 items-center justify-center rounded-full bg-[#7047ff] text-[10px] font-semibold text-white">AI</span>预计消耗 <strong className="text-[#f0d567]">{estimatedCredits}</strong> 点</div>
            <div className="grid min-h-0 grid-cols-[64px_minmax(0,1fr)] gap-3 sm:grid-cols-[84px_minmax(0,1fr)]">
              <div className="relative flex h-[98px] items-center justify-center">
                {assets.length ? (
                  <div className="relative h-[86px] w-[71px]">
                    {assets.slice(0, 3).map((asset, index) => <div key={asset.id} className="group absolute inset-0 overflow-hidden rounded-md border border-[#7047ff]/70 bg-[#222226] shadow-lg" style={{ transform: `translate(${index * 5}px, ${index * 3}px) rotate(${index * 4 - 5}deg)`, zIndex: index }}><img src={asset.previewUrl} alt="参考图" className="h-full w-full object-cover" /><button type="button" onClick={() => setAssets((current) => current.filter((item) => item.id !== asset.id))} className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/70 opacity-0 group-hover:opacity-100"><X className="size-3" /></button></div>)}
                  </div>
                ) : (
                  <button type="button" aria-label="上传参考图" disabled={uploading || !model?.supportsReferenceImages} onClick={() => fileInputRef.current?.click()} className="flex h-[86px] w-[71px] -rotate-[12deg] items-center justify-center rounded-md border-2 border-[#7047ff] bg-[#222226] text-white shadow-[0_0_22px_rgba(112,71,255,0.18)] hover:bg-[#29282f] disabled:opacity-40">{uploading ? <Loader2 className="size-5 animate-spin" /> : <Plus className="size-6" />}</button>
                )}
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" multiple className="hidden" onChange={(event) => uploadFiles(event.target.files)} />
              </div>
              <div className="relative min-h-0 pt-0.5">
                {selectedTemplate ? <div className="mb-1 flex items-center gap-2 text-[11px] text-[#9f8cff]"><PanelsTopLeft className="size-3" /><span className="truncate">{selectedTemplate.name || '已选择提示词模板'}</span><button type="button" onClick={() => setSelectedTemplate(null)} title="取消模板"><X className="size-3" /></button></div> : null}
                <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={model?.description || '描述空间、风格、材质、光线与构图，或从提示词模板中选择'} className="h-full min-h-0 resize-none border-0 bg-transparent p-0 text-base leading-6 text-[#b3b3b3] shadow-none placeholder:text-[#77777e] focus-visible:ring-0" />
              </div>
            </div>

            <div aria-label="对话框操作" className="absolute right-3 top-3 flex h-10 w-auto items-center justify-center gap-2 lg:-right-[60px] lg:bottom-0 lg:top-auto lg:h-[86px] lg:w-12 lg:flex-col lg:gap-3">
              <button type="button" disabled={assisting || !prompt.trim()} onClick={assistPrompt} title="优化提示词" className="flex size-[30px] items-center justify-center rounded-full text-[#9b9ba2] hover:bg-white/10 hover:text-white disabled:opacity-40">{assisting ? <Loader2 className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}</button>
              <button type="button" onClick={() => setPromptExpanded(true)} title="全屏编辑提示词" className="flex size-[30px] items-center justify-center rounded-full text-[#9b9ba2] hover:bg-white/10 hover:text-white"><Maximize2 className="size-4" /></button>
            </div>

            <div className="grid min-w-0 grid-cols-2 items-center gap-2 overflow-visible sm:flex sm:flex-wrap lg:flex-nowrap lg:overflow-x-auto lg:overflow-y-hidden">
              <Select value={modelProfileId} onValueChange={(value) => { setModelProfileId(value); applyModelDefaults(bootstrap.models.find((item) => item.id === value)); }}>
                <SelectTrigger className="col-span-2 h-10 w-full shrink-0 rounded-lg border-[#37373b] bg-[#222226] px-3 text-sm text-[#f5f5f5] focus:ring-[#7047ff] sm:w-[186px]"><Bot className="size-4 text-[#7047ff]" /><SelectValue placeholder="选择模型" /></SelectTrigger>
                <SelectContent className="border-white/10 bg-[#18191d] text-[#f5f5f5]"><SelectGroup>{bootstrap.models.map((item) => <SelectItem key={item.id} value={item.id} className={darkSelectItemClassName}>{item.name}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
              <Select value={String(count)} onValueChange={(value) => setCount(Number(value))}><SelectTrigger className="h-10 w-full shrink-0 rounded-lg border-[#37373b] bg-[#222226] px-3 text-sm text-[#f5f5f5] sm:w-[104px]"><Images className="size-4" /><SelectValue /></SelectTrigger><SelectContent className="border-white/10 bg-[#18191d] text-white"><SelectGroup>{[1, 2, 3, 4].map((value) => <SelectItem key={value} value={String(value)} className={darkSelectItemClassName}>{value}张</SelectItem>)}</SelectGroup></SelectContent></Select>
              {resolutionTier !== 'CUSTOM' ? <Select value={aspectRatio} onValueChange={setAspectRatio}><SelectTrigger className="h-10 w-full shrink-0 rounded-lg border-[#37373b] bg-[#222226] px-3 text-sm text-[#f5f5f5] sm:w-[128px]"><Crop className="size-4" /><SelectValue /></SelectTrigger><SelectContent className="border-white/10 bg-[#18191d] text-white"><SelectGroup>{availableAspectRatios.map((item) => <SelectItem key={item} value={item} className={darkSelectItemClassName}>{item === 'auto' ? '自动比例' : item}</SelectItem>)}</SelectGroup></SelectContent></Select> : null}
              <Select value={resolutionTier} onValueChange={(value) => {
                const nextTier = value as typeof resolutionTier;
                const nextRatios = model?.aspectRatiosByResolutionTier?.[nextTier] || model?.aspectRatios || [];
                setResolutionTier(nextTier);
                if (nextTier !== 'CUSTOM' && !nextRatios.includes(aspectRatio)) {
                  setAspectRatio(nextRatios.includes(model?.defaults.aspectRatio || '') ? model?.defaults.aspectRatio || nextRatios[0] : nextRatios[0]);
                }
              }}><SelectTrigger className="h-10 w-full shrink-0 rounded-lg border-[#37373b] bg-[#222226] px-3 text-sm text-[#f5f5f5] sm:w-[116px]"><Maximize2 className="size-4" /><SelectValue /></SelectTrigger><SelectContent className="border-white/10 bg-[#18191d] text-white"><SelectGroup>{(model?.resolutionTiers || []).map((item) => <SelectItem key={item} value={item} className={darkSelectItemClassName}>{item === 'CUSTOM' ? '自定义' : item}</SelectItem>)}</SelectGroup></SelectContent></Select>
              {resolutionTier === 'CUSTOM' && model?.supportsCustomSize ? (
                <div className="col-span-2 flex h-10 w-full shrink-0 items-center justify-center gap-1 rounded-lg border border-[#37373b] bg-[#222226] px-2 sm:w-auto">
                  <Input aria-label="自定义宽度" title="自定义宽度（16 的倍数）" type="number" min={16} max={3840} step={16} value={customWidth} onChange={(event) => setCustomWidth(Number(event.target.value))} className="h-8 w-[76px] border-0 bg-transparent px-1 text-center text-sm text-white shadow-none focus-visible:ring-0" />
                  <span className="text-xs text-[#77777e]">x</span>
                  <Input aria-label="自定义高度" title="自定义高度（16 的倍数）" type="number" min={16} max={3840} step={16} value={customHeight} onChange={(event) => setCustomHeight(Number(event.target.value))} className="h-8 w-[76px] border-0 bg-transparent px-1 text-center text-sm text-white shadow-none focus-visible:ring-0" />
                  <span className="text-xs text-[#77777e]">px</span>
                </div>
              ) : null}
              <button type="button" onClick={() => setTemplateOpen(true)} className="flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-[#37373b] bg-[#222226] px-3 text-sm text-[#f5f5f5] hover:bg-[#2a2a2f] sm:w-[124px]"><PanelsTopLeft className="size-4" />提示词模板</button>
              <button type="button" disabled={generating || !prompt.trim() || !modelProfileId || !hasEnabledPrice} onClick={submitGeneration} className="col-span-2 ml-0 flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#9447ff] to-[#5f2cff] px-3 text-base font-normal text-white shadow-[0_0_24px_rgba(104,49,255,0.2)] hover:brightness-110 disabled:cursor-not-allowed disabled:bg-[#6b6b6b] disabled:bg-none disabled:opacity-100 sm:ml-auto sm:w-[152px]">{generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}开始生图</button>
            </div>
          </section>
        </main>
      </div>

      <TemplateLibraryDialog open={templateOpen} onOpenChange={setTemplateOpen} selectedTemplateId={selectedTemplate?.id} onSelect={applyTemplate} />

      <Dialog open={promptExpanded} onOpenChange={setPromptExpanded}>
        <DialogContent className="max-w-3xl border-white/15 bg-[#1b1c20] text-white sm:rounded-xl">
          <DialogHeader><DialogTitle className="text-base">编辑提示词</DialogTitle><DialogDescription className="sr-only">编辑本次生成使用的正向和负向提示词。</DialogDescription></DialogHeader>
          <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述空间、风格、材质、光线与构图" className="min-h-64 resize-none border-white/10 bg-[#222328] leading-6 text-white placeholder:text-[#77777e]" />
          <div><label className="mb-2 block text-xs text-[#a7a7ad]">不希望出现的内容（可选）</label><Textarea value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} className="min-h-24 resize-none border-white/10 bg-[#222328] text-white" /></div>
          <div className="flex justify-end gap-2"><Button variant="outline" className="border-white/15 bg-transparent text-white hover:bg-white/10" onClick={() => { setPrompt(''); setNegativePrompt(''); }}>清空</Button><Button className="bg-[#7047ff] text-white hover:bg-[#6034ee]" onClick={() => setPromptExpanded(false)}>完成</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(attachGeneration)} onOpenChange={(open) => !open && setAttachGeneration(null)}>
        <DialogContent className="max-w-md border-white/15 bg-[#1b1c20] text-white sm:rounded-xl">
          <DialogHeader><DialogTitle className="text-base">归入客户方案</DialogTitle><DialogDescription className="sr-only">选择要归档生成结果的客户方案。</DialogDescription></DialogHeader>
          <Select value={attachWorkflowId} onValueChange={setAttachWorkflowId}>
            <SelectTrigger className="w-full border-white/10 bg-[#222328]"><SelectValue placeholder="选择客户方案" /></SelectTrigger>
            <SelectContent className="border-white/10 bg-[#18191d] text-white">
              {bootstrap.workflows.map((workflow) => <SelectItem key={workflow.id} value={workflow.id} className={darkSelectItemClassName}>{workflow.leadName ? `${workflow.leadName} · ` : ''}{workflow.title}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex justify-end gap-2">
            <Button variant="outline" className="border-white/15 bg-transparent text-white hover:bg-white/10" onClick={() => setAttachGeneration(null)}>取消</Button>
            <Button className="bg-[#7047ff] text-white hover:bg-[#6034ee]" disabled={!attachWorkflowId} onClick={attachToWorkflow}><Check />确认归入</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(previewGeneration)} onOpenChange={(open) => !open && setPreviewGeneration(null)}>
        <DialogContent className={cn('border-white/10 bg-[#111216] p-3 sm:rounded-xl', previewFullscreen ? 'h-screen w-screen max-w-none' : 'h-[90vh] max-w-[92vw]')}>
          <DialogHeader className="sr-only"><DialogTitle>生成结果预览</DialogTitle><DialogDescription>查看、缩放、旋转或下载生成结果。</DialogDescription></DialogHeader>
          <div className="relative flex h-full items-center justify-center overflow-hidden">
            {previewGeneration?.imageUrl ? <img src={previewGeneration.imageUrl} alt="生成结果大图" className="max-h-full max-w-full object-contain transition-transform" style={{ transform: `scale(${previewZoom}) rotate(${previewRotation}deg)` }} /> : null}
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-white/10 bg-black/70 p-1.5 backdrop-blur">
              <Button size="icon-sm" variant="secondary" title="放大图片" onClick={() => setPreviewZoom((value) => Math.min(3, value + 0.2))}><Plus /></Button>
              <Button size="icon-sm" variant="secondary" title="缩小图片" onClick={() => setPreviewZoom((value) => Math.max(0.4, value - 0.2))}><Minus /></Button>
              <Button size="sm" variant="secondary" title="恢复原始比例" onClick={() => { setPreviewZoom(1); setPreviewRotation(0); }}>1:1</Button>
              <Button size="icon-sm" variant="secondary" title="顺时针旋转图片" onClick={() => setPreviewRotation((value) => value + 90)}><RotateCw /></Button>
              <Button size="icon-sm" variant="secondary" title="全屏预览" onClick={() => setPreviewFullscreen((value) => !value)}><Maximize2 /></Button>
              {previewGeneration?.imageUrl ? <Button size="icon-sm" variant="secondary" asChild title="下载图片"><a href={previewGeneration.imageUrl} download={`ai-creation-${previewGeneration.id}.png`}><Download /></a></Button> : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(compareGeneration)} onOpenChange={(open) => { if (!open) { setCompareGeneration(null); setCompareFullscreen(false); } }}>
        <DialogContent hideCloseButton className={cn('grid-rows-[auto_auto_minmax(0,1fr)] border-white/10 bg-[#1b1c20] p-5 text-white sm:rounded-2xl', compareFullscreen ? '!inset-0 !h-[100dvh] !w-[100dvw] !max-w-none !translate-x-0 !translate-y-0 !rounded-none !border-0 !p-4 !shadow-none' : 'max-w-6xl')}>
          <DialogHeader><DialogTitle className="text-base">方案对比</DialogTitle><DialogDescription className="sr-only">比较参考图与生成结果并调整对比方式。</DialogDescription></DialogHeader>
          <button type="button" aria-label="关闭方案对比" title="关闭方案对比" onClick={() => { setCompareGeneration(null); setCompareFullscreen(false); }} className="absolute right-4 top-4 z-20 flex size-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"><X className="size-5" /></button>
          {compareGeneration?.imageUrl && assets[0]?.previewUrl ? (() => {
            const generatedUrl = compareGeneration.imageUrl;
            const referenceUrl = assets[0].previewUrl;
            const imageA = compareSwapped ? generatedUrl : referenceUrl;
            const imageB = compareSwapped ? referenceUrl : generatedUrl;
            const vertical = compareLayout === 'vertical';
            return <>
              <div className="flex flex-wrap items-center gap-2 [&>button]:border [&>button]:border-white/10 [&>button]:bg-[#24252b] [&>button]:text-[#e7e7eb] [&>button:hover]:bg-[#303138]">
                <Button size="sm" variant="secondary" onClick={() => setCompareSwapped((value) => !value)}>交换</Button>
                <Button size="sm" variant={compareMode === 'reference' ? 'default' : 'secondary'} className={cn(compareMode === 'reference' && '!border-[#8d67ff] !bg-[#6e45ef]/20')} onClick={() => setCompareMode('reference')}>只看 A 图</Button>
                <Button size="sm" variant={compareMode === 'generated' ? 'default' : 'secondary'} className={cn(compareMode === 'generated' && '!border-[#8d67ff] !bg-[#6e45ef]/20')} onClick={() => setCompareMode('generated')}>只看 B 图</Button>
                <Button size="sm" variant={compareMode === 'split' ? 'default' : 'secondary'} className={cn(compareMode === 'split' && '!border-[#8d67ff] !bg-[#6e45ef]/20')} onClick={() => setCompareMode('split')}><Columns2 />分割对比</Button>
                <Button size="sm" variant={compareMode === 'sync' ? 'default' : 'secondary'} className={cn(compareMode === 'sync' && '!border-[#8d67ff] !bg-[#6e45ef]/20')} onClick={() => setCompareMode('sync')}><Images />同步对比</Button>
                <span className="h-6 w-px bg-white/10" />
                <Button size="sm" variant={compareLayout === 'horizontal' ? 'default' : 'secondary'} className={cn(compareLayout === 'horizontal' && '!border-[#8d67ff] !bg-[#6e45ef]/20')} onClick={() => setCompareLayout('horizontal')}>左右</Button>
                <Button size="sm" variant={compareLayout === 'vertical' ? 'default' : 'secondary'} className={cn(compareLayout === 'vertical' && '!border-[#8d67ff] !bg-[#6e45ef]/20')} onClick={() => setCompareLayout('vertical')}>上下</Button>
                <Button size="sm" variant="secondary" onClick={() => { setCompareSwapped(false); setCompareMode('split'); setCompareLayout('horizontal'); setSplitPosition(50); }}>居中</Button>
                <Button size="sm" variant="secondary" onClick={() => setCompareFullscreen((value) => !value)}><Maximize2 />全屏</Button>
                <Button size="icon-sm" variant="secondary" title="下载对比图" onClick={() => { void downloadComparison(); }}><Download /></Button>
              </div>
              <div className={cn('flex min-h-0 items-center justify-center overflow-auto rounded-xl border border-white/10 bg-[#111216] p-3', compareFullscreen ? 'h-full' : 'mt-4 h-[min(62vh,620px)]')}>
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
        </DialogContent>
      </Dialog>

      <ImageEditorDialog imageUrl={editorGeneration?.imageUrl} open={Boolean(editorGeneration)} onOpenChange={(open) => !open && setEditorGeneration(null)} onUse={useAnnotatedImage} />
    </div>
  );
}
