/* eslint-disable @next/next/no-img-element -- Authenticated media routes and imported source URLs are dynamic. */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Bell,
  Bot,
  Check,
  ChevronRight,
  CircleUserRound,
  Coins,
  Crop,
  Download,
  FileImage,
  FolderInput,
  History,
  Images,
  ListChecks,
  Loader2,
  Maximize2,
  MoreHorizontal,
  PanelsTopLeft,
  Pencil,
  Plus,
  RefreshCw,
  ScanLine,
  Search,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { notify } from '@/components/ui/operation-feedback';
import { cn } from '@/lib/utils';
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
}: {
  generation?: CreationGeneration;
  batchStatus?: CreationBatch['status'];
  onAttach: (generation: CreationGeneration) => void;
  onPreview: (generation: CreationGeneration) => void;
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
      <div className="absolute inset-x-0 bottom-0 flex translate-y-full items-center justify-end gap-1 bg-black/70 p-2 backdrop-blur transition group-hover:translate-y-0 group-focus-within:translate-y-0">
        <Button size="icon-sm" variant="secondary" asChild title="下载">
          <a href={generation.imageUrl} download={`ai-creation-${generation.id}.png`}><Download /></a>
        </Button>
        <Button size="icon-sm" variant="secondary" onClick={() => onAttach(generation)} title="归入客户方案">
          <FolderInput />
        </Button>
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
  const [size, setSize] = useState('1K');
  const [quality, setQuality] = useState('auto');
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
  const [promptExpanded, setPromptExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const results = batchGenerations(selectedBatch);
  const hasTaskStage = Boolean(selectedTask && selectedBatch);
  const displayGenerations = results.length
    ? results
    : Array.from({ length: selectedBatch?.requestedCount || 1 }, () => undefined);
  const model = bootstrap?.models.find((item) => item.id === modelProfileId);
  const estimatedCredits = (bootstrap?.price.credits || 0) * count;

  const applyModelDefaults = (profile?: CreationModelProfile) => {
    if (!profile) return;
    setAspectRatio(profile.defaults.aspectRatio);
    setSize(profile.defaults.size);
    setQuality(profile.defaults.quality);
    setAssets((current) => current.slice(0, profile.maxReferenceImages));
  };

  const chooseTask = (task: CreationTask) => {
    const batch = latestBatch(task);
    setSelectedTaskId(task.id);
    setPrompt(batch?.prompt || task.prompt);
    setNegativePrompt(batch?.negativePrompt || '');
    setModelProfileId(batch?.modelProfileId || task.modelProfileId);
    setAspectRatio(batch?.parameterSnapshot.aspectRatio || '1:1');
    setSize(batch?.parameterSnapshot.size || '1K');
    setQuality(batch?.parameterSnapshot.quality || 'auto');
    setCount(batch?.requestedCount || 1);
    setSelectedTemplate(batch?.parameterSnapshot.templateId ? { id: batch.parameterSnapshot.templateId } as TemplateDetail : null);
    setAssets(task.referenceAssetIds.map((id) => ({ id, previewUrl: `/api/ai/assets/${id}/image` })));
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

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length || !model) return;
    const slots = Math.max(0, model.maxReferenceImages - assets.length);
    if (!model.supportsReferenceImages || !slots) {
      notify.warning(`当前模型最多支持 ${model.maxReferenceImages} 张参考图`);
      return;
    }
    setUploading(true);
    try {
      const selected = Array.from(files).slice(0, slots);
      const uploaded = await Promise.all(selected.map(async (file) => {
        const formData = new FormData();
        formData.set('file', file);
        const payload = await readJson(await fetch('/api/ai/creation/assets', { method: 'POST', body: formData }));
        return payload.data as CreationAsset;
      }));
      setAssets((current) => [...current, ...uploaded]);
      notify.success(`已上传 ${uploaded.length} 张参考图`);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '参考图上传失败');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
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
          size,
          quality,
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
    <div className="fixed inset-0 h-screen min-h-[720px] min-w-[1440px] overflow-hidden bg-[#16171b] font-sans text-[#f6f7fb]">
      <header className="relative z-40 flex h-[68px] min-w-[1440px] items-center justify-between border-b border-white/[0.08] bg-[#16171b] px-3">
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

      <div className="absolute inset-x-0 bottom-0 top-[68px] min-w-[1440px] bg-[#17191f]">
        <aside className="absolute inset-y-0 left-0 z-30 flex w-16 flex-col items-center border-r border-white/[0.05] bg-[#0f1016]/70 pt-5">
          <Link href="/ai-studio/scenarios" title="展开创作导航" className="mb-4 flex size-8 items-center justify-center rounded-full border border-white/15 text-[#b3b3b3] hover:text-white"><ChevronRight className="size-4" /></Link>
          <button type="button" title="AI 自由创作" className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#7047ff]/55 bg-[#6f45ff]/15 text-[#987dff]"><span className="flex size-6 items-center justify-center rounded-full bg-[#6942df] text-xs font-semibold text-white">AI</span></button>
          <Link href="/ai-studio/scenarios" title="客户方案" className="mt-3 flex h-12 w-12 items-center justify-center rounded-xl text-[#7d63ff] hover:bg-white/5"><span className="flex size-6 items-center justify-center rounded-full bg-[#6844da] text-xs font-semibold text-white">W</span></Link>
        </aside>

        <div className="absolute left-[84px] top-3 z-30 flex w-[136px] flex-col gap-2">
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
                  <button key={task.id} type="button" onClick={() => chooseTask(task)} className={cn('group mb-2 flex w-full items-center gap-3 rounded-lg border p-2 text-left transition', selectedTaskId === task.id ? 'border-[#7047ff]/70 bg-[#7047ff]/10' : 'border-transparent bg-white/[0.035] hover:bg-white/[0.07]')}>
                    <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#24252a]">{firstImage ? <img src={firstImage} alt="" className="h-full w-full object-cover" /> : <Images className="size-4 text-[#717178]" />}</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-[#eeeeF2]">{task.title}</div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-[#85858c]"><span>{formatTime(task.updatedAt)}</span>{batch ? <span className={cn(batch.status === 'failed' && 'text-red-400', batch.status === 'succeeded' && 'text-emerald-400')}>{statusLabel(batch.status)}</span> : null}</div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(event) => event.stopPropagation()}><Button variant="ghost" size="icon-xs" className="text-[#8d8d94] opacity-0 group-hover:opacity-100"><MoreHorizontal /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="border-white/10 bg-[#202126] text-white"><DropdownMenuItem onSelect={() => chooseTask(task)}><RefreshCw />复用参数</DropdownMenuItem><DropdownMenuItem className="text-red-400" onSelect={() => deleteTask(task)}><Trash2 />删除</DropdownMenuItem></DropdownMenuContent>
                    </DropdownMenu>
                  </button>
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

        <main className={cn('absolute inset-y-0 left-16 overflow-hidden', hasTaskStage ? 'right-14' : 'right-0')}>

          {hasTaskStage ? (
            <>
              <section aria-label="当前任务摘要" className="absolute left-1/2 top-7 z-20 flex h-[72px] w-[1080px] -translate-x-1/2 items-start gap-5">
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
                    <span className="rounded-full border border-white/15 px-3 py-1">分辨率: {selectedBatch?.parameterSnapshot.size}</span>
                    <span className="rounded-full border border-white/15 px-3 py-1">图片质量: {selectedBatch?.parameterSnapshot.quality}</span>
                  </div>
                </div>
              </section>

              <section aria-label="生成结果" className="absolute right-0 top-[118px] z-10 h-[264px] bg-[linear-gradient(90deg,#24252c_0%,#202138_58%,#17191f_100%)] [left:calc(50%_-_540px)]">
                <div className="absolute left-0 top-0 flex max-w-[calc(100%-32px)] gap-3 overflow-hidden">
                  {displayGenerations.map((generation, index) => (
                    <GenerationTile key={generation?.id || `pending-${index}`} generation={generation} batchStatus={selectedBatch?.status} onAttach={setAttachGeneration} onPreview={setPreviewGeneration} />
                  ))}
                </div>
                <div className="absolute left-0 top-[226px] flex h-[30px] items-center gap-2">
                  <button type="button" onClick={() => setPromptExpanded(true)} className="flex h-[30px] items-center gap-1.5 rounded-md bg-[#2a2b31] px-3 text-xs text-[#d5d5da] hover:bg-[#34353c] hover:text-white"><Pencil className="size-3.5" />重新编辑</button>
                  <button type="button" disabled={generating} onClick={submitGeneration} className="flex h-[30px] items-center gap-1.5 rounded-md bg-[#2a2b31] px-3 text-xs text-[#d5d5da] hover:bg-[#34353c] hover:text-white disabled:opacity-50">{generating ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}再次生成</button>
                  {selectedTask ? <button type="button" onClick={() => deleteTask(selectedTask)} className="flex h-[30px] items-center gap-1.5 rounded-md bg-[#2a2b31] px-3 text-xs text-[#ff6f75] hover:bg-[#34353c]"><Trash2 className="size-3.5" />删除</button> : null}
                </div>
                <time className="absolute bottom-2 right-[25%] text-[11px] text-[#666f91]" dateTime={selectedBatch?.createdAt}>{selectedBatch?.createdAt ? formatDateTime(selectedBatch.createdAt) : null}</time>
              </section>
            </>
          ) : (
            <div className="pointer-events-none absolute left-1/2 top-[96px] z-10 h-[245px] w-[1098px] -translate-x-1/2 bg-[url('/ai-studio/creation-hero.png')] bg-[length:100%_100%] bg-center bg-no-repeat">
              <h2 className="sr-only">今天想创作什么?</h2>
              <p className="sr-only">输入想法，AI帮你实现创意</p>
            </div>
          )}

          <section style={{ backgroundImage: "url('/ai-studio/creation-dialog-frame.png')" }} className={cn('absolute left-1/2 z-20 grid w-[1080px] -translate-x-1/2 gap-2 overflow-visible bg-[length:100%_100%] bg-center bg-no-repeat px-[18px] pb-4 pt-[18px]', hasTaskStage ? 'bottom-[30px] h-[212px] grid-rows-[122px_48px]' : 'top-[365px] h-[251px] grid-rows-[161px_48px]')}>
            <button type="button" onClick={() => assets.length ? setPromptExpanded(true) : fileInputRef.current?.click()} aria-label="编辑参考图片" title={assets.length ? '编辑参考图片' : '上传参考图片'} className="absolute -left-[60px] top-0 flex size-12 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/15"><Pencil className="size-5" /></button>
            <div className="absolute -top-[30px] right-[30px] flex items-center gap-1.5 text-sm text-[#b3b3b3]"><span className="flex size-5 items-center justify-center rounded-full bg-[#7047ff] text-[10px] font-semibold text-white">AI</span>预计消耗 <strong className="text-[#f0d567]">{estimatedCredits}</strong> 点</div>
            <div className="grid min-h-0 grid-cols-[84px_minmax(0,1fr)] gap-3">
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

            <div aria-label="对话框操作" className="absolute -right-[60px] bottom-0 flex h-[86px] w-12 flex-col items-center justify-center gap-3">
              <button type="button" disabled={assisting || !prompt.trim()} onClick={assistPrompt} title="优化提示词" className="flex size-[30px] items-center justify-center rounded-full text-[#9b9ba2] hover:bg-white/10 hover:text-white disabled:opacity-40">{assisting ? <Loader2 className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}</button>
              <button type="button" onClick={() => setPromptExpanded(true)} title="全屏编辑提示词" className="flex size-[30px] items-center justify-center rounded-full text-[#9b9ba2] hover:bg-white/10 hover:text-white"><Maximize2 className="size-4" /></button>
            </div>

            <div className="flex min-w-0 items-center gap-2 overflow-x-auto overflow-y-hidden">
              <Select value={modelProfileId} onValueChange={(value) => { setModelProfileId(value); applyModelDefaults(bootstrap.models.find((item) => item.id === value)); }}>
                <SelectTrigger className="h-10 w-[186px] shrink-0 rounded-lg border-[#37373b] bg-[#222226] px-3 text-sm text-[#f5f5f5] focus:ring-[#7047ff]"><Bot className="size-4 text-[#7047ff]" /><SelectValue placeholder="选择模型" /></SelectTrigger>
                <SelectContent className="border-white/10 bg-[#18191d] text-[#f5f5f5]">{bootstrap.models.map((item) => <SelectItem key={item.id} value={item.id} className={darkSelectItemClassName}>{item.name}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={String(count)} onValueChange={(value) => setCount(Number(value))}><SelectTrigger className="h-10 w-[104px] shrink-0 rounded-lg border-[#37373b] bg-[#222226] px-3 text-sm text-[#f5f5f5]"><Images className="size-4" /><SelectValue /></SelectTrigger><SelectContent className="border-white/10 bg-[#18191d] text-white">{[1, 2, 3, 4].map((value) => <SelectItem key={value} value={String(value)} className={darkSelectItemClassName}>{value}张</SelectItem>)}</SelectContent></Select>
              <Select value={aspectRatio} onValueChange={setAspectRatio}><SelectTrigger className="h-10 w-[128px] shrink-0 rounded-lg border-[#37373b] bg-[#222226] px-3 text-sm text-[#f5f5f5]"><Crop className="size-4" /><SelectValue /></SelectTrigger><SelectContent className="border-white/10 bg-[#18191d] text-white">{(model?.aspectRatios || []).map((item) => <SelectItem key={item} value={item} className={darkSelectItemClassName}>{item}</SelectItem>)}</SelectContent></Select>
              <Select value={quality} onValueChange={setQuality}><SelectTrigger className="h-10 w-[114px] shrink-0 rounded-lg border-[#37373b] bg-[#222226] px-3 text-sm text-[#f5f5f5]"><ScanLine className="size-4" /><SelectValue /></SelectTrigger><SelectContent className="border-white/10 bg-[#18191d] text-white">{(model?.qualities || []).map((item) => <SelectItem key={item} value={item} className={darkSelectItemClassName}>{item === 'auto' ? '自适应' : item}</SelectItem>)}</SelectContent></Select>
              <Select value={size} onValueChange={setSize}><SelectTrigger className="h-10 w-[104px] shrink-0 rounded-lg border-[#37373b] bg-[#222226] px-3 text-sm text-[#f5f5f5]"><Maximize2 className="size-4" /><SelectValue /></SelectTrigger><SelectContent className="border-white/10 bg-[#18191d] text-white">{(model?.sizes || []).map((item) => <SelectItem key={item} value={item} className={darkSelectItemClassName}>{item}</SelectItem>)}</SelectContent></Select>
              <button type="button" onClick={() => setTemplateOpen(true)} className="flex h-10 w-[124px] shrink-0 items-center justify-center gap-2 rounded-lg border border-[#37373b] bg-[#222226] px-3 text-sm text-[#f5f5f5] hover:bg-[#2a2a2f]"><PanelsTopLeft className="size-4" />提示词模板</button>
              <button type="button" disabled={generating || !prompt.trim() || !modelProfileId} onClick={submitGeneration} className="ml-auto flex h-12 w-[152px] shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#9447ff] to-[#5f2cff] px-3 text-base font-normal text-white shadow-[0_0_24px_rgba(104,49,255,0.2)] hover:brightness-110 disabled:cursor-not-allowed disabled:bg-[#6b6b6b] disabled:bg-none disabled:opacity-100">{generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}开始生图</button>
            </div>
          </section>
        </main>
      </div>

      <TemplateLibraryDialog open={templateOpen} onOpenChange={setTemplateOpen} selectedTemplateId={selectedTemplate?.id} onSelect={applyTemplate} />

      <Dialog open={promptExpanded} onOpenChange={setPromptExpanded}>
        <DialogContent className="max-w-3xl border-white/15 bg-[#1b1c20] text-white sm:rounded-xl">
          <DialogHeader><DialogTitle className="text-base">编辑提示词</DialogTitle></DialogHeader>
          <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述空间、风格、材质、光线与构图" className="min-h-64 resize-none border-white/10 bg-[#222328] leading-6 text-white placeholder:text-[#77777e]" />
          <div><label className="mb-2 block text-xs text-[#a7a7ad]">不希望出现的内容（可选）</label><Textarea value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} className="min-h-24 resize-none border-white/10 bg-[#222328] text-white" /></div>
          <div className="flex justify-end gap-2"><Button variant="outline" className="border-white/15 bg-transparent text-white hover:bg-white/10" onClick={() => { setPrompt(''); setNegativePrompt(''); }}>清空</Button><Button className="bg-[#7047ff] text-white hover:bg-[#6034ee]" onClick={() => setPromptExpanded(false)}>完成</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(attachGeneration)} onOpenChange={(open) => !open && setAttachGeneration(null)}>
        <DialogContent className="max-w-md border-white/15 bg-[#1b1c20] text-white sm:rounded-xl">
          <DialogHeader><DialogTitle className="text-base">归入客户方案</DialogTitle></DialogHeader>
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
        <DialogContent className="h-[90vh] max-w-[92vw] border-white/10 bg-[#111216] p-2 sm:rounded-xl">
          <DialogHeader className="sr-only"><DialogTitle>生成结果预览</DialogTitle></DialogHeader>
          {previewGeneration?.imageUrl ? <img src={previewGeneration.imageUrl} alt="生成结果大图" className="h-full w-full object-contain" /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
