/* eslint-disable @next/next/no-img-element -- Authenticated media routes and generated image URLs are dynamic. */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NextImage from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Bot,
  CircleUserRound,
  Coins,
  Columns2,
  Copy,
  Crop,
  Download,
  ExternalLink,
  FileImage,
  Images,
  Loader2,
  Maximize2,
  Moon,
  PanelsTopLeft,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Sun,
  WandSparkles,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { notify } from '@/components/ui/operation-feedback';
import { ImageEditorDialog } from '@/components/ai-creation/image-editor-dialog';
import { TemplateLibraryDialog } from '@/components/ai-creation/template-library-dialog';
import type {
  CreationAsset,
  CreationBatch,
  CreationGeneration,
  CreationModelProfile,
  CreationTask,
  PromptTemplate,
} from '@/components/ai-creation/types';
import {
  readStoredWorkbenchTheme,
  WORKBENCH_THEME_STORAGE_KEY,
  workbenchMaxUserReferenceImages,
  type WorkbenchTheme,
} from '@/lib/ai/workbench-studio';
import { cn } from '@/lib/utils';

type BootstrapData = {
  account: { balance: number; frozenBalance: number; availableBalance: number };
  price: { credits: number; label: string };
  provider: { actionEnabled: boolean; supportsGenerate: boolean; supportsEdit: boolean };
  models: CreationModelProfile[];
};

type FloorPlanOption = { id: string; name?: string; status?: string };
type LeadSummary = {
  id: string;
  name: string;
  communityName?: string;
  floorPlans: FloorPlanOption[];
  workflowCount?: number;
};
type WorkflowSummary = { id: string; title: string; generationCount?: number };
type WorkflowDetail = {
  workflow: WorkflowSummary & {
    sourceFloorPlanId?: string;
    floorPlanPreviewUrl?: string;
    sourceFloorPlan?: { id: string; name?: string } | null;
  };
  lead: { id: string; name: string; communityName?: string; floorPlans: FloorPlanOption[] };
  generations: Array<{
    id: string;
    status: string;
    input?: { userMessage?: string; customPrompt?: string };
    output?: { imageUrl?: string };
    errorMessage?: string | null;
    createdAt: string;
  }>;
  publishedScheme?: { title: string; publishedAt?: string; generationIds: string[] } | null;
};
type TemplateDetail = PromptTemplate & { parameterTemplate?: { parameters?: Record<string, unknown> } };

const darkSelectItemClassName = 'text-[#f5f5f5] focus:bg-white/10 focus:text-white data-[state=checked]:bg-white/[0.08] data-[state=checked]:text-white';
const lightSelectItemClassName = 'text-[#171717] focus:bg-[#f3faf4] focus:text-[#171717] data-[state=checked]:bg-[#e8f6ea] data-[state=checked]:text-[#166534]';

async function readJson(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) throw new Error(payload.error || '请求失败');
  return payload;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function latestBatch(task?: CreationTask | null) {
  return task?.batches?.[0];
}

function userReferenceIds(batch: CreationBatch) {
  const controlId = String(asRecord(batch.parameterSnapshot).floorPlanControlAssetId || '');
  return batch.referenceAssetIds.filter((id) => id !== controlId);
}

function batchResolutionTier(batch: CreationBatch): '1K' | '2K' | '4K' | 'CUSTOM' {
  const storedTier = batch.parameterSnapshot.resolutionTier || batch.parameterSnapshot.size?.toUpperCase() || '1K';
  return ['1K', '2K', '4K', 'CUSTOM'].includes(storedTier) ? storedTier as '1K' | '2K' | '4K' | 'CUSTOM' : '1K';
}

function GenerationTile({
  generation,
  batchStatus,
  selected,
  dark,
  onPreview,
  onReuse,
  onEdit,
  onToggle,
}: {
  generation?: CreationGeneration;
  batchStatus?: CreationBatch['status'];
  selected: boolean;
  dark: boolean;
  onPreview: (generation: CreationGeneration) => void;
  onReuse: (generation: CreationGeneration) => void;
  onEdit: (generation: CreationGeneration) => void;
  onToggle: (generation: CreationGeneration, selected: boolean) => void;
}) {
  const tileClass = dark ? 'bg-[#2a2b31]' : 'bg-[#eef3ee]';
  if (!generation || ['created', 'pending', 'processing'].includes(generation.status) || batchStatus === 'processing' || batchStatus === 'pending') {
    if (generation && (generation.status === 'failed' || (!generation.imageUrl && generation.status !== 'pending' && generation.status !== 'processing' && generation.status !== 'created'))) {
      return (
        <div className={cn('flex size-[216px] shrink-0 flex-col items-center justify-center rounded-lg px-6 text-center', tileClass)}>
          <FileImage className="mb-3 size-6 text-red-400" />
          <span className={cn('text-sm font-medium', dark ? 'text-white' : 'text-[#171717]')}>生成失败</span>
          <span className="mt-1 line-clamp-2 text-xs text-[#8d8d94]">{generation.error || '供应商未返回结果'}</span>
        </div>
      );
    }
    if (!generation && batchStatus === 'failed') {
      return (
        <div className={cn('flex size-[216px] shrink-0 flex-col items-center justify-center rounded-lg px-6 text-center', tileClass)}>
          <FileImage className="mb-3 size-6 text-red-400" />
          <span className={cn('text-sm font-medium', dark ? 'text-white' : 'text-[#171717]')}>生成失败</span>
        </div>
      );
    }
    return (
      <div className={cn('flex size-[216px] shrink-0 items-center justify-center rounded-lg', tileClass)}>
        <div className="relative flex size-16 items-center justify-center">
          <Loader2 className={cn('absolute inset-0 size-16 animate-spin', dark ? 'text-[#6245ff]' : 'text-[#16a34a]')} strokeWidth={1.25} />
          <span className={cn('text-xs font-medium', dark ? 'text-[#ededf2]' : 'text-[#526052]')}>生成中</span>
        </div>
      </div>
    );
  }
  if (generation.status === 'failed' || !generation.imageUrl) {
    return (
      <div className={cn('flex size-[216px] shrink-0 flex-col items-center justify-center rounded-lg px-6 text-center', tileClass)}>
        <FileImage className="mb-3 size-6 text-red-400" />
        <span className={cn('text-sm font-medium', dark ? 'text-white' : 'text-[#171717]')}>生成失败</span>
        <span className="mt-1 line-clamp-2 text-xs text-[#8d8d94]">{generation.error || '供应商未返回结果'}</span>
      </div>
    );
  }
  return (
    <div className={cn('group relative size-[216px] shrink-0 overflow-hidden rounded-lg shadow-[0_10px_30px_rgba(0,0,0,0.12)]', dark ? 'bg-[#25262c]' : 'bg-white', selected && (dark ? 'ring-2 ring-[#7047ff]' : 'ring-2 ring-[#16a34a]'))}>
      <button type="button" onClick={() => onPreview(generation)} className="h-full w-full">
        <img src={generation.imageUrl} alt="AI 生成结果" className="h-full w-full object-contain" />
      </button>
      <label className={cn('absolute bottom-2 left-2 flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium', dark ? 'bg-[#202126]/95 text-white' : 'bg-white/95 text-[#166534]')}>
        <input type="checkbox" checked={selected} onChange={(event) => onToggle(generation, event.target.checked)} />
        发给客户
      </label>
      <div className={cn('absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-1 rounded-lg p-1.5 opacity-0 shadow-xl backdrop-blur transition group-hover:opacity-100 group-focus-within:opacity-100', dark ? 'bg-[#202126]/95 text-[#e5e5ea]' : 'bg-white/95 text-[#171717]')}>
        <Button size="icon-sm" variant="secondary" asChild title="下载"><a href={generation.imageUrl} download={`ai-workbench-${generation.id}.png`}><Download /></a></Button>
        <Button size="icon-sm" variant="secondary" onClick={() => onReuse(generation)} title="基于此图继续"><Copy /></Button>
        <Button size="icon-sm" variant="secondary" onClick={() => onEdit(generation)} title="编辑"><Pencil /></Button>
      </div>
    </div>
  );
}

export function WorkbenchWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialLeadId = searchParams.get('leadId') || '';
  const initialWorkflowId = searchParams.get('workflowId') || '';
  const [theme, setTheme] = useState<WorkbenchTheme>('dark');
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [leads, setLeads] = useState<LeadSummary[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [leadSearch, setLeadSearch] = useState('');
  const [selectedLeadId, setSelectedLeadId] = useState(initialLeadId);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [workflowsLoading, setWorkflowsLoading] = useState(false);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(initialWorkflowId);
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [task, setTask] = useState<CreationTask | null>(null);
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
  const [retrying, setRetrying] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [assisting, setAssisting] = useState(false);
  const [previewGeneration, setPreviewGeneration] = useState<CreationGeneration | null>(null);
  const [floorPlanOpen, setFloorPlanOpen] = useState(false);
  const [compareFloorPlan, setCompareFloorPlan] = useState(true);
  const [editorGeneration, setEditorGeneration] = useState<CreationGeneration | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createFloorPlanId, setCreateFloorPlanId] = useState('');
  const [creating, setCreating] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendTitle, setSendTitle] = useState('');
  const [sendingScheme, setSendingScheme] = useState(false);
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);
  const [referenceStackExpanded, setReferenceStackExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const conversationViewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTheme(readStoredWorkbenchTheme(window.localStorage.getItem(WORKBENCH_THEME_STORAGE_KEY)));
  }, []);

  const persistTheme = (next: WorkbenchTheme) => {
    setTheme(next);
    window.localStorage.setItem(WORKBENCH_THEME_STORAGE_KEY, next);
  };

  const dark = theme === 'dark';
  const t = {
    page: dark ? 'bg-[#16171b] text-[#f6f7fb]' : 'bg-[#f6f8f6] text-[#171717]',
    header: dark ? 'border-white/[0.08] bg-[#16171b]' : 'border-[#e5e9e5] bg-white',
    panel: dark ? 'border-white/10 bg-[#18191d]' : 'border-[#e5e9e5] bg-white',
    muted: dark ? 'text-[#8d8d94]' : 'text-[#526052]',
    selected: dark ? 'border-[#7047ff]/70 bg-[#7047ff]/10' : 'border-emerald-500 bg-emerald-50',
    card: dark ? 'border-transparent bg-white/[0.035] hover:bg-white/[0.07]' : 'border-[#e5e9e5] bg-background hover:bg-[#f3faf4]',
    input: dark ? 'border-white/10 bg-white/[0.06] text-white placeholder:text-[#77777e] focus-visible:ring-[#7047ff]' : 'border-[#e5e9e5] bg-white text-[#171717] placeholder:text-[#8aa08a] focus-visible:ring-[#16a34a]',
    iconBtn: dark ? 'border-white/10 bg-white/[0.04] text-[#b3b3b3] hover:text-white' : 'border-[#e5e9e5] bg-white text-[#526052] hover:text-[#166534]',
    selectTrigger: dark ? 'border-[#37373b] bg-[#222226] text-[#f5f5f5]' : 'border-[#e5e9e5] bg-white text-[#171717]',
    selectContent: dark ? 'border-white/10 bg-[#18191d] text-white' : 'border-[#e5e9e5] bg-white text-[#171717]',
    selectItem: dark ? darkSelectItemClassName : lightSelectItemClassName,
    accent: dark ? 'text-[#7047ff]' : 'text-[#16a34a]',
    generate: dark ? 'bg-gradient-to-r from-[#9447ff] to-[#5f2cff] shadow-[0_0_24px_rgba(104,49,255,0.2)]' : 'bg-[#16a34a] hover:bg-[#15803d]',
    badge: dark ? 'bg-[#7047ff]/20 text-[#b8a8ff]' : 'bg-[#e8f6ea] text-[#166534]',
    round: dark ? 'border-[#7047ff]/35 bg-[#1a1b20]/90' : 'border-[#16a34a]/35 bg-white',
    roundIdle: dark ? 'border-white/10 bg-[#1a1b20]/90' : 'border-[#e5e9e5] bg-white',
  };

  const loadBootstrap = useCallback(async () => {
    const payload = await readJson(await fetch('/api/ai/creation/bootstrap'));
    if (!payload.data) throw new Error('AI 工作台初始化数据为空');
    setBootstrap(payload.data);
    setBootstrapError(null);
    setModelProfileId((current) => current || payload.data.models?.[0]?.id || '');
  }, []);

  const loadLeads = useCallback(async () => {
    setLeadsLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (leadSearch.trim()) params.set('search', leadSearch.trim());
      const payload = await readJson(await fetch(`/api/ai/workflow-leads?${params}`));
      const items = [...(payload.data || [])] as LeadSummary[];
      items.sort((left, right) => Number(Boolean(right.floorPlans?.length)) - Number(Boolean(left.floorPlans?.length)));
      setLeads(items);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '加载客户失败');
    } finally {
      setLeadsLoading(false);
    }
  }, [leadSearch]);

  const loadWorkflows = useCallback(async (leadId: string) => {
    if (!leadId) {
      setWorkflows([]);
      return;
    }
    setWorkflowsLoading(true);
    try {
      const payload = await readJson(await fetch(`/api/ai/workflows?leadId=${encodeURIComponent(leadId)}&limit=50`));
      setWorkflows(payload.data || []);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '加载方案对话失败');
    } finally {
      setWorkflowsLoading(false);
    }
  }, []);

  const loadConversation = useCallback(async (workflowId: string, silent = false) => {
    if (!workflowId) {
      setDetail(null);
      setTask(null);
      return;
    }
    try {
      const [detailPayload, taskPayload] = await Promise.all([
        readJson(await fetch(`/api/ai/workflows/${workflowId}`)),
        readJson(await fetch(`/api/ai/creation/tasks?workflowId=${encodeURIComponent(workflowId)}`)),
      ]);
      setDetail(detailPayload.data || null);
      setTask(taskPayload.data?.[0] || null);
    } catch (error) {
      if (!silent) notify.error(error instanceof Error ? error.message : '加载对话失败');
    }
  }, []);

  useEffect(() => {
    void loadBootstrap().catch((error) => {
      setBootstrapError(error instanceof Error ? error.message : '加载 AI 工作台失败');
    });
  }, [loadBootstrap]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadLeads(); }, 250);
    return () => window.clearTimeout(timer);
  }, [leadSearch, loadLeads]);

  useEffect(() => {
    void loadWorkflows(selectedLeadId);
  }, [loadWorkflows, selectedLeadId]);

  useEffect(() => {
    void loadConversation(selectedWorkflowId);
    setSelectedImageIds([]);
    setAssets([]);
    setPrompt('');
    setSelectedTemplate(null);
    setFloorPlanOpen(false);
    setPreviewGeneration(null);
  }, [loadConversation, selectedWorkflowId]);

  const hasProcessing = Boolean(
    task?.batches.some((batch) => batch.status === 'processing' || batch.status === 'pending')
    || detail?.generations.some((generation) => ['created', 'pending', 'processing'].includes(generation.status))
  );
  useEffect(() => {
    if (!hasProcessing || !selectedWorkflowId) return;
    const timer = window.setInterval(() => loadConversation(selectedWorkflowId, true), 4000);
    return () => window.clearInterval(timer);
  }, [hasProcessing, loadConversation, selectedWorkflowId]);

  useEffect(() => {
    if (selectedLeadId || !initialLeadId) return;
    setSelectedLeadId(initialLeadId);
  }, [initialLeadId, selectedLeadId]);

  useEffect(() => {
    if (selectedWorkflowId || !workflows.length) return;
    const preferred = initialWorkflowId && workflows.some((item) => item.id === initialWorkflowId)
      ? initialWorkflowId
      : workflows[0]?.id;
    if (preferred) setSelectedWorkflowId(preferred);
  }, [initialWorkflowId, selectedWorkflowId, workflows]);

  const syncQuery = (leadId: string, workflowId?: string) => {
    const params = new URLSearchParams();
    if (leadId) params.set('leadId', leadId);
    if (workflowId) params.set('workflowId', workflowId);
    router.replace(params.toString() ? `/ai-studio/scenarios?${params}` : '/ai-studio/scenarios');
  };

  const selectedLead = leads.find((lead) => lead.id === selectedLeadId) || null;
  const eligibleFloorPlans = selectedLead?.floorPlans || detail?.lead.floorPlans || [];
  const floorPlanPreviewUrl = detail?.workflow.floorPlanPreviewUrl || '';
  const sourceFloorPlanId = detail?.workflow.sourceFloorPlan?.id || detail?.workflow.sourceFloorPlanId || '';
  const sourceFloorPlanName = detail?.workflow.sourceFloorPlan?.name || '正式户型';
  const selectedBatch = latestBatch(task);
  const model = bootstrap?.models.find((item) => item.id === modelProfileId);
  const maxUserRefs = workbenchMaxUserReferenceImages(model?.maxReferenceImages || 0);
  const availableAspectRatios = model?.aspectRatiosByResolutionTier?.[resolutionTier] || model?.aspectRatios || [];
  const unitPrice = model?.prices.find((price) => price.resolutionTier === resolutionTier)?.credits || 0;
  const estimatedCredits = unitPrice * count;
  const hasEnabledPrice = unitPrice > 0;
  const conversationBatches = useMemo(() => {
    const real = task ? [...task.batches].sort((left, right) => left.sequence - right.sequence) : [];
    const claimed = new Set(real.flatMap((batch) => batch.generations.map((generation) => generation.id)));
    const legacy = (detail?.generations || [])
      .filter((generation) => !claimed.has(generation.id))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .map((generation, index) => ({
        id: `legacy-${generation.id}`,
        sequence: index + 1,
        prompt: generation.input?.userMessage || generation.input?.customPrompt || '历史出图',
        referenceAssetIds: [],
        modelProfileId: '',
        modelProfileSnapshot: { id: '', key: '', name: '', description: '', sourceModelSourceIds: [], sourceType: 'grs_catalog', adapterType: 'grs', remoteModel: '', family: 'gpt-image-2', catalogVersion: '', supportsReferenceImages: false, maxReferenceImages: 0, aspectRatios: [], aspectRatiosByResolutionTier: {}, sizes: [], qualities: [], resolutionTiers: [], supportsCustomSize: false, defaults: { aspectRatio: '1:1', size: '1K', quality: 'medium', resolutionTier: '1K' }, isDefault: false, prices: [] } as CreationModelProfile,
        parameterSnapshot: { aspectRatio: '1:1' },
        requestedCount: 1,
        status: (generation.status === 'succeeded' ? 'succeeded' : generation.status === 'failed' ? 'failed' : 'processing') as CreationBatch['status'],
        creditsEstimate: 0,
        createdAt: generation.createdAt,
        generations: [{
          id: generation.id,
          status: generation.status as CreationGeneration['status'],
          imageUrl: generation.output?.imageUrl,
          error: generation.errorMessage || undefined,
          retryCount: 0,
          createdAt: generation.createdAt,
        }],
      } satisfies CreationBatch));
    return [...legacy.map((batch, index) => ({ ...batch, sequence: index + 1 })), ...real.map((batch, index) => ({ ...batch, sequence: legacy.length + index + 1 }))];
  }, [detail?.generations, task]);
  const hasTaskStage = conversationBatches.length > 0;
  const currentBatchRetryable = Boolean(selectedBatch && (selectedBatch.status === 'failed' || selectedBatch.status === 'partial'));
  const selectedBatchTier = selectedBatch ? batchResolutionTier(selectedBatch) : '1K';
  const composerChangedFromSelectedBatch = Boolean(selectedBatch && (
    prompt !== selectedBatch.prompt
    || negativePrompt !== (selectedBatch.negativePrompt || '')
    || modelProfileId !== selectedBatch.modelProfileId
    || aspectRatio !== (selectedBatch.parameterSnapshot.aspectRatio || '1:1')
    || resolutionTier !== selectedBatchTier
    || count !== selectedBatch.requestedCount
    || assets.map((asset) => asset.id).join(',') !== userReferenceIds(selectedBatch).join(',')
  ));
  const shouldRetryCurrentBatch = Boolean(currentBatchRetryable && !composerChangedFromSelectedBatch && selectedBatch && !String(selectedBatch.id).startsWith('legacy-'));
  const currentBatchActive = selectedBatch?.status === 'pending' || selectedBatch?.status === 'processing';
  const failedGenerationCount = selectedBatch?.generations.filter((generation) => generation.status === 'failed').length || 0;
  const actionEstimatedCredits = shouldRetryCurrentBatch ? unitPrice * failedGenerationCount : estimatedCredits;

  useEffect(() => {
    const viewport = conversationViewportRef.current;
    const latestRound = viewport?.lastElementChild as HTMLElement | null;
    if (viewport && latestRound) viewport.scrollTop = Math.max(0, latestRound.offsetTop - 12);
  }, [selectedWorkflowId, conversationBatches.length]);

  const applyModelDefaults = (profile?: CreationModelProfile) => {
    if (!profile) return;
    setAspectRatio(profile.defaults.aspectRatio);
    setResolutionTier(profile.defaults.resolutionTier);
    setCustomWidth(1024);
    setCustomHeight(1024);
    setAssets((current) => current.slice(0, workbenchMaxUserReferenceImages(profile.maxReferenceImages)));
  };

  const applyBatchToComposer = (batch: CreationBatch) => {
    if (String(batch.id).startsWith('legacy-')) {
      setPrompt(batch.prompt);
      return;
    }
    setPrompt(batch.prompt);
    setNegativePrompt(batch.negativePrompt || '');
    setModelProfileId(batch.modelProfileId);
    setAspectRatio(batch.parameterSnapshot.aspectRatio || '1:1');
    setResolutionTier(batchResolutionTier(batch));
    setCustomWidth(batch.parameterSnapshot.width || 1024);
    setCustomHeight(batch.parameterSnapshot.height || 1024);
    setCount(batch.requestedCount || 1);
    setSelectedTemplate(batch.parameterSnapshot.templateId ? { id: batch.parameterSnapshot.templateId } as TemplateDetail : null);
    setAssets(userReferenceIds(batch).map((id) => ({ id, previewUrl: `/api/ai/assets/${id}/image` })));
  };

  const uploadReferenceFiles = async (files: File[], successMessage = '已添加参考图') => {
    if (!files.length || !model) return false;
    const slots = Math.max(0, maxUserRefs - assets.length);
    if (!model.supportsReferenceImages || !slots) {
      notify.warning(`当前模型最多支持 ${maxUserRefs} 张参考图（户型控制图会自动占用 1 张）`);
      return false;
    }
    setUploading(true);
    try {
      const uploaded = await Promise.all(files.slice(0, slots).map(async (file) => {
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

  const reuseGeneration = async (generation: CreationGeneration) => {
    if (!generation.imageUrl) return;
    try {
      const response = await fetch(generation.imageUrl);
      if (!response.ok) throw new Error('无法读取生成结果');
      const blob = await response.blob();
      await uploadReferenceFiles([new File([blob], `ai-workbench-${generation.id}.png`, { type: blob.type || 'image/png' })], '已基于此图继续');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '引用生成结果失败');
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
      notify.success('提示词已优化');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '提示词优化失败');
    } finally {
      setAssisting(false);
    }
  };

  const submitGeneration = async (sourceBatch?: CreationBatch) => {
    if (!selectedWorkflowId) return notify.warning('请先选择或新建方案对话');
    const draft = sourceBatch && !String(sourceBatch.id).startsWith('legacy-') ? {
      prompt: sourceBatch.prompt,
      negativePrompt: sourceBatch.negativePrompt || '',
      referenceAssetIds: userReferenceIds(sourceBatch),
      modelProfileId: sourceBatch.modelProfileId,
      aspectRatio: sourceBatch.parameterSnapshot.aspectRatio || '1:1',
      resolutionTier: batchResolutionTier(sourceBatch),
      width: sourceBatch.parameterSnapshot.width || 1024,
      height: sourceBatch.parameterSnapshot.height || 1024,
      templateId: sourceBatch.parameterSnapshot.templateId,
      count: sourceBatch.requestedCount || 1,
    } : {
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
    if (!draft.prompt.trim()) return notify.warning('请输入提示词');
    if (!draft.modelProfileId) return notify.warning('请选择模型');
    if (!draftUnitPrice) return notify.warning('当前模型分辨率尚未开放');
    if (!bootstrap?.provider.actionEnabled) return notify.error('当前企业未开放 AI 创作');
    if ((bootstrap.account.availableBalance || 0) < draftUnitPrice * draft.count) {
      return notify.error(`AI 点数不足，本次需要 ${draftUnitPrice * draft.count} 点`);
    }
    setGenerating(true);
    const loadingId = notify.loading('正在提交生成任务');
    try {
      let taskId = task?.id;
      if (!taskId) {
        const created = await readJson(await fetch('/api/ai/creation/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: detail?.workflow.title || draft.prompt.trim().slice(0, 32),
            prompt: draft.prompt,
            referenceAssetIds: draft.referenceAssetIds,
            modelProfileId: draft.modelProfileId,
          }),
        }));
        taskId = created.data.id;
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
          workflowId: selectedWorkflowId,
        }),
      }));
      setTask(generated.data.task);
      setBootstrap((current) => current ? { ...current, account: generated.data.account } : current);
      await Promise.all([loadConversation(selectedWorkflowId, true), loadWorkflows(selectedLeadId), loadLeads(), loadBootstrap()]);
      notify.success('生成任务已提交', { id: loadingId });
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '生成任务提交失败', { id: loadingId });
    } finally {
      setGenerating(false);
    }
  };

  const retryCurrentBatch = async () => {
    if (!task || !selectedBatch || String(selectedBatch.id).startsWith('legacy-')) return;
    setRetrying(true);
    const loadingId = notify.loading('正在重试当前轮');
    try {
      const payload = await readJson(await fetch(`/api/ai/creation/tasks/${task.id}/batches/${selectedBatch.id}/retry`, { method: 'POST' }));
      setTask(payload.data.task);
      setBootstrap((current) => current ? { ...current, account: payload.data.account } : current);
      notify.success('已重试当前轮失败项', { id: loadingId });
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '当前轮重试失败', { id: loadingId });
      await loadConversation(selectedWorkflowId, true);
    } finally {
      setRetrying(false);
    }
  };

  const openCreate = () => {
    if (!selectedLead) return notify.error('请先选择客户线索');
    if (!eligibleFloorPlans.length) return notify.error('该线索还没有合格的正式户型，请先完成量房');
    setCreateTitle(selectedLead.workflowCount ? `方案 ${(selectedLead.workflowCount || 0) + 1}` : '方案 1');
    setCreateFloorPlanId(eligibleFloorPlans[0]?.id || '');
    setCreateOpen(true);
  };

  const createConversation = async () => {
    if (!selectedLeadId || !createFloorPlanId) return;
    setCreating(true);
    try {
      const result = await readJson(await fetch('/api/ai/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: selectedLeadId, title: createTitle.trim() || '方案 1', sourceFloorPlanId: createFloorPlanId }),
      }));
      const workflowId = result.data?.id || result.data?.workflow?.id;
      setCreateOpen(false);
      await loadWorkflows(selectedLeadId);
      await loadLeads();
      if (workflowId) {
        setSelectedWorkflowId(workflowId);
        syncQuery(selectedLeadId, workflowId);
      }
      notify.success('已新建方案对话');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '新建对话失败');
    } finally {
      setCreating(false);
    }
  };

  const renameConversation = async (title: string) => {
    if (!selectedWorkflowId) return;
    try {
      await readJson(await fetch(`/api/ai/workflows/${selectedWorkflowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rename', title }),
      }));
      await Promise.all([loadConversation(selectedWorkflowId, true), loadWorkflows(selectedLeadId)]);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '重命名失败');
    }
  };

  const sendScheme = async () => {
    if (!selectedLeadId || !selectedWorkflowId) return;
    setSendingScheme(true);
    try {
      await readJson(await fetch(`/api/leads/${selectedLeadId}/ai-scheme-publications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: selectedWorkflowId,
          title: sendTitle.trim() || detail?.workflow.title,
          generationIds: selectedImageIds,
        }),
      }));
      notify.success('方案已发送给客户');
      setSendOpen(false);
      setSelectedImageIds([]);
      await loadConversation(selectedWorkflowId, true);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '发送方案失败');
    } finally {
      setSendingScheme(false);
    }
  };

  const retryBootstrap = () => {
    setBootstrapError(null);
    void Promise.all([loadBootstrap(), loadLeads()]).catch((error) => {
      setBootstrapError(error instanceof Error ? error.message : '加载 AI 工作台失败');
    });
  };

  if (!bootstrap) {
    if (bootstrapError) {
      const message = bootstrapError === 'Please select an enterprise first'
        ? '请先在后台选择企业，再打开 AI 工作台。'
        : bootstrapError === 'Unauthorized'
          ? '登录状态已失效，请重新登录后再试。'
          : bootstrapError;
      return (
        <div className={cn('flex h-screen items-center justify-center px-6', t.page)}>
          <div role="alert" className={cn('w-full max-w-md rounded-2xl border p-6 shadow-2xl', t.panel)}>
            <div className="mb-3 flex items-center gap-3">
              <div className={cn('flex size-9 items-center justify-center rounded-full', dark ? 'bg-[#7047ff]/15 text-[#9b82ff]' : 'bg-[#e8f6ea] text-[#16a34a]')}><Sparkles className="size-4" /></div>
              <h1 className="text-base font-semibold">AI 工作台暂不可用</h1>
            </div>
            <p className={cn('text-sm leading-6', t.muted)}>{message}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button type="button" onClick={retryBootstrap} className={cn('inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium text-white', t.generate)}><RefreshCw className="size-4" />重试</button>
              <Link href="/" className={cn('inline-flex h-9 items-center rounded-lg border px-4 text-sm', dark ? 'border-white/10 text-[#d7d7dc] hover:bg-white/5' : 'border-[#e5e9e5] hover:bg-[#f3faf4]')}>返回管理后台</Link>
            </div>
          </div>
        </div>
      );
    }
    return <div className={cn('flex h-screen items-center justify-center text-sm', t.page, t.muted)}><Loader2 className={cn('mr-2 size-5 animate-spin', t.accent)} />加载 AI 工作台</div>;
  }

  return (
    <div className={cn('fixed inset-0 flex h-screen min-h-[720px] min-w-0 flex-col overflow-hidden font-sans lg:min-w-[1024px]', t.page)}>
      <header className={cn('relative z-40 flex h-[68px] min-w-0 items-center justify-between border-b px-3', t.header)}>
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/" className="flex items-center gap-2" title="返回管理后台">
            <NextImage src="/brand-logo.png" alt="" aria-hidden="true" width={28} height={28} className="shrink-0 rounded-md" />
            <span className="hidden text-[15px] font-semibold sm:inline">家客来</span>
          </Link>
          <span className={cn('h-6 w-px', dark ? 'bg-white/20' : 'bg-[#e5e9e5]')} />
          <h1 className="truncate text-base font-medium sm:text-lg">AI 工作台</h1>
        </div>
        <div className="flex items-center gap-2">
          {detail?.publishedScheme ? (
            <span className={cn('hidden rounded-full px-3 py-1 text-xs sm:inline', t.badge)}>已发给客户 · {detail.publishedScheme.generationIds.length} 张</span>
          ) : null}
          <Button
            size="sm"
            disabled={!selectedImageIds.length}
            onClick={() => {
              if (!selectedImageIds.length) return notify.error('请先勾选要发给客户的效果图');
              setSendTitle(detail?.publishedScheme?.title || detail?.workflow.title || '设计方案');
              setSendOpen(true);
            }}
            className={cn('hidden sm:inline-flex', dark ? 'bg-[#7047ff] text-white hover:bg-[#6034ee]' : 'bg-[#16a34a] text-white hover:bg-[#15803d]')}
          >
            <Send className="size-4" />发送给客户{selectedImageIds.length ? `（${selectedImageIds.length}）` : ''}
          </Button>
          <button type="button" title={dark ? '切换日间主题' : '切换夜间主题'} onClick={() => persistTheme(dark ? 'light' : 'dark')} className={cn('flex size-9 items-center justify-center rounded-full border', t.iconBtn)}>
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <div className={cn('flex h-9 items-center gap-2 rounded-full border px-3 text-xs', t.iconBtn)} title="可用 AI 点数">
            <Coins className={cn('size-4', t.accent)} />
            <strong className="font-semibold">{bootstrap.account.availableBalance}</strong>
          </div>
          <Link href="/ai-studio/create" target="_blank" rel="noopener noreferrer" title="打开 AI 创作台" className={cn('flex size-9 items-center justify-center rounded-full border', t.iconBtn)}><Sparkles className="size-4" /></Link>
          <Link href="/" title="返回管理后台" className={cn('flex size-9 items-center justify-center rounded-full border', t.iconBtn)}><CircleUserRound className="size-5" /></Link>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className={cn('flex w-[260px] shrink-0 flex-col border-r', t.panel)}>
          <div className={cn('border-b p-3', dark ? 'border-white/10' : 'border-[#e5e9e5]')}>
            <div className="relative">
              <Search className={cn('absolute left-3 top-1/2 size-4 -translate-y-1/2', t.muted)} />
              <Input value={leadSearch} onChange={(event) => setLeadSearch(event.target.value)} placeholder="搜索客户或小区" className={cn('h-9 pl-9', t.input)} />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {leadsLoading ? <div className={cn('p-4 text-sm', t.muted)}>正在加载线索…</div> : null}
            {!leadsLoading && !leads.length ? <div className={cn('p-8 text-center text-sm', t.muted)}>暂无客户线索</div> : null}
            {leads.map((lead) => (
              <button
                key={lead.id}
                type="button"
                onClick={() => { setSelectedLeadId(lead.id); setSelectedWorkflowId(''); syncQuery(lead.id); }}
                className={cn('mb-2 w-full rounded-lg border p-3 text-left', selectedLeadId === lead.id ? t.selected : cn('border', t.card))}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{lead.name}</span>
                  {lead.floorPlans?.length
                    ? <span className={cn('rounded-full border px-2 py-0.5 text-[11px]', dark ? 'border-[#7047ff]/50 text-[#b8a8ff]' : 'border-emerald-500 text-emerald-700')}>可设计</span>
                    : <span className={cn('rounded-full border px-2 py-0.5 text-[11px]', t.muted)}>待量房</span>}
                </div>
                <div className={cn('mt-1 text-xs', t.muted)}>{lead.communityName || '未登记小区'} · {lead.workflowCount || 0} 个方案</div>
              </button>
            ))}
          </div>
        </section>

        <section className={cn('flex w-[220px] shrink-0 flex-col border-r', t.panel)}>
          <div className={cn('flex items-center justify-between gap-2 border-b p-3', dark ? 'border-white/10' : 'border-[#e5e9e5]')}>
            <span className="font-medium">方案对话</span>
            <button type="button" onClick={openCreate} disabled={!selectedLeadId} className={cn('flex h-8 items-center gap-1 rounded-md border px-2 text-xs disabled:opacity-40', dark ? 'border-[#7047ff]/40 text-[#d7d7dc] hover:bg-white/5' : 'border-[#16a34a]/40 hover:bg-[#f3faf4]')}><Plus className="size-3.5" />新建</button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {!selectedLeadId ? <div className={cn('p-8 text-center text-sm', t.muted)}>请先选择客户</div> : null}
            {selectedLeadId && workflowsLoading ? <div className={cn('p-4 text-sm', t.muted)}>正在加载对话…</div> : null}
            {selectedLeadId && !workflowsLoading && !workflows.length ? <div className={cn('p-8 text-center text-sm', t.muted)}>还没有方案对话</div> : null}
            {workflows.map((workflow) => (
              <button
                key={workflow.id}
                type="button"
                onClick={() => { setSelectedWorkflowId(workflow.id); syncQuery(selectedLeadId, workflow.id); }}
                className={cn('mb-2 w-full rounded-lg border p-3 text-left', selectedWorkflowId === workflow.id ? t.selected : cn('border', t.card))}
              >
                <div className="font-medium">{workflow.title}</div>
                <div className={cn('mt-1 text-xs', t.muted)}>{workflow.generationCount || 0} 轮出图</div>
              </button>
            ))}
          </div>
        </section>

        <main className="relative min-w-0 flex-1 overflow-hidden">
          {!selectedWorkflowId ? (
            <div className={cn('flex h-full items-center justify-center text-sm', t.muted)}>选择或新建一个方案对话开始出图</div>
          ) : (
            <>
              <div className="absolute left-4 right-4 top-3 z-20 flex items-center gap-3">
                {floorPlanPreviewUrl ? (
                  <button
                    type="button"
                    title="查看客户户型对照图"
                    onClick={() => setFloorPlanOpen(true)}
                    className={cn('size-11 shrink-0 overflow-hidden rounded-md border bg-black', dark ? 'border-white/15 hover:border-[#7047ff]/70' : 'border-[#e5e9e5] hover:border-[#16a34a]')}
                  >
                    <img src={floorPlanPreviewUrl} alt="客户户型对照图" className="h-full w-full object-contain" />
                  </button>
                ) : null}
                <Input
                  key={detail?.workflow.id || selectedWorkflowId}
                  defaultValue={detail?.workflow.title}
                  onBlur={(event) => {
                    const next = event.target.value.trim();
                    if (next && next !== detail?.workflow.title) void renameConversation(next);
                  }}
                  className={cn('max-w-xs font-medium', t.input)}
                />
                {sourceFloorPlanId ? (
                  <Link
                    href={`/floorplans/${sourceFloorPlanId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn('hidden shrink-0 items-center gap-1 text-xs sm:inline-flex', t.muted, dark ? 'hover:text-white' : 'hover:text-[#166534]')}
                  >
                    <ExternalLink className="size-3.5" />打开正式户型
                  </Link>
                ) : null}
              </div>
              {hasTaskStage ? (
                <section aria-label="生成结果" className="absolute inset-x-4 bottom-[250px] top-[58px] overflow-hidden rounded-xl">
                  <div ref={conversationViewportRef} className="scrollbar-hide absolute inset-0 flex flex-col gap-4 overflow-y-auto p-1 pr-2">
                    {conversationBatches.map((batch) => {
                      const isLatest = batch.id === selectedBatch?.id;
                      const generations = batch.generations.length ? batch.generations : Array.from({ length: batch.requestedCount || 1 }, () => undefined);
                      return (
                        <article key={batch.id} className={cn('shrink-0 rounded-xl border p-3', isLatest ? t.round : t.roundIdle)}>
                          <div className="mb-3 flex items-start gap-3">
                            <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium', t.badge)}>第 {batch.sequence} 轮</span>
                            <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-5">{batch.prompt}</p>
                            <time className={cn('shrink-0 text-[11px]', t.muted)} dateTime={batch.createdAt}>{formatDateTime(batch.createdAt)}</time>
                          </div>
                          <div className="scrollbar-hide flex gap-3 overflow-x-auto pb-1">
                            {generations.map((generation, index) => (
                              <GenerationTile
                                key={generation?.id || `pending-${batch.id}-${index}`}
                                generation={generation}
                                batchStatus={batch.status}
                                selected={Boolean(generation && selectedImageIds.includes(generation.id))}
                                dark={dark}
                                onPreview={(generation) => { setCompareFloorPlan(true); setPreviewGeneration(generation); }}
                                onReuse={(item) => { void reuseGeneration(item); }}
                                onEdit={setEditorGeneration}
                                onToggle={(item, checked) => setSelectedImageIds((current) => checked ? [...current.filter((id) => id !== item.id), item.id] : current.filter((id) => id !== item.id))}
                              />
                            ))}
                          </div>
                          {!String(batch.id).startsWith('legacy-') ? (
                            <div className="mt-3 flex h-[30px] items-center gap-2">
                              <button type="button" onClick={() => { applyBatchToComposer(batch); setPromptExpanded(true); }} className={cn('flex h-[30px] items-center gap-1.5 rounded-md px-3 text-xs', dark ? 'bg-[#2a2b31] text-[#d5d5da] hover:bg-[#34353c]' : 'bg-[#eef3ee] hover:bg-[#e2ebe2]')}><Pencil className="size-3.5" />重新编辑</button>
                              <button
                                type="button"
                                disabled={generating || retrying || batch.status === 'pending' || batch.status === 'processing'}
                                onClick={() => {
                                  if (isLatest && (batch.status === 'failed' || batch.status === 'partial')) {
                                    void retryCurrentBatch();
                                    return;
                                  }
                                  applyBatchToComposer(batch);
                                  void submitGeneration(batch);
                                }}
                                className={cn('flex h-[30px] items-center gap-1.5 rounded-md px-3 text-xs disabled:opacity-50', dark ? 'bg-[#2a2b31] text-[#d5d5da] hover:bg-[#34353c]' : 'bg-[#eef3ee] hover:bg-[#e2ebe2]')}
                              >
                                {generating || retrying ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                                {isLatest && (batch.status === 'failed' || batch.status === 'partial') ? '重试本轮' : '再次生成'}
                              </button>
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                </section>
              ) : (
                <div className={cn('pointer-events-none absolute left-1/2 top-[96px] z-10 hidden h-[245px] w-[calc(100%-32px)] max-w-[1098px] -translate-x-1/2 sm:block', dark && 'bg-[url("/ai-studio/creation-hero.png")] bg-[length:100%_100%] bg-center bg-no-repeat')}>
                  {!dark ? (
                    <div className="flex h-full flex-col items-center justify-center text-center">
                      <h2 className="text-2xl font-semibold">今天想为这位客户出什么方案？</h2>
                      <p className={cn('mt-3 text-sm', t.muted)}>左上角可对照客户户型。出图时控制图会自动带入。选择模型、模板或直接描述空间、光线与材质。</p>
                    </div>
                  ) : <h2 className="sr-only">今天想为这位客户出什么方案？</h2>}
                </div>
              )}

              <section
                style={dark ? { backgroundImage: "url('/ai-studio/creation-dialog-frame.png')" } : undefined}
                className={cn(
                  'absolute left-4 right-4 z-20 grid w-auto grid-rows-[minmax(140px,1fr)_auto] gap-3 overflow-visible px-4 pb-4 pt-5 sm:left-1/2 sm:right-auto sm:w-[calc(100%-48px)] sm:max-w-[1080px] sm:-translate-x-1/2 lg:h-[212px] lg:min-h-0 lg:grid-rows-[122px_48px]',
                  hasTaskStage ? 'bottom-[18px] top-auto' : 'top-[320px] min-h-[350px] lg:top-[365px] lg:h-[251px] lg:grid-rows-[161px_48px]',
                  dark ? 'bg-[#1b1c20]/95 bg-[length:100%_100%] bg-center bg-no-repeat' : 'rounded-2xl border border-[#e5e9e5] bg-white shadow-sm'
                )}
              >
                <button type="button" onClick={() => fileInputRef.current?.click()} aria-label="上传参考图片" className={cn('absolute -top-14 left-0 flex size-12 items-center justify-center rounded-full lg:-left-[60px] lg:top-0', dark ? 'bg-white/10 text-white hover:bg-white/15' : 'bg-[#e8f6ea] text-[#166534] hover:bg-[#d8f0dc]')}><Pencil className="size-5" /></button>
                <div className={cn('absolute -top-[30px] right-[30px] flex items-center gap-1.5 text-sm', t.muted)}>
                  <span className={cn('flex size-5 items-center justify-center rounded-full text-[10px] font-semibold text-white', dark ? 'bg-[#7047ff]' : 'bg-[#16a34a]')}>AI</span>
                  预计消耗 <strong className={dark ? 'text-[#f0d567]' : 'text-[#166534]'}>{actionEstimatedCredits}</strong> 点
                </div>
                <div className="grid min-h-0 grid-cols-[64px_minmax(0,1fr)] gap-3 sm:grid-cols-[84px_minmax(0,1fr)]">
                  <div
                    className="relative flex h-[98px] items-center justify-center overflow-visible"
                    onMouseEnter={() => setReferenceStackExpanded(true)}
                    onMouseLeave={() => setReferenceStackExpanded(false)}
                  >
                    {assets.length ? (
                      <div className="relative h-[86px] w-[71px] overflow-visible">
                        {assets.map((asset, index) => {
                          const offsetX = referenceStackExpanded ? index * 65 : index * 4;
                          return (
                            <div
                              key={asset.id}
                              className="absolute left-0 top-1.5 h-[78px] w-[61px] overflow-hidden rounded-md border border-[#8b72ff]/80 bg-[#222226] shadow-[0_6px_14px_rgba(0,0,0,0.28)]"
                              style={{ transform: `translate3d(${offsetX}px, 0, 0)`, zIndex: index + 1 }}
                            >
                              <img src={asset.previewUrl} alt={`参考图 ${index + 1}`} className="h-full w-full object-cover" />
                              <button type="button" aria-label={`删除第 ${index + 1} 张参考图`} className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-[#414148] text-white" onClick={() => setAssets((current) => current.filter((item) => item.id !== asset.id))}><X className="size-3" /></button>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <button type="button" aria-label="上传参考图" disabled={uploading || !maxUserRefs} onClick={() => fileInputRef.current?.click()} className={cn('flex h-[86px] w-[71px] -rotate-[12deg] items-center justify-center rounded-md border-2 disabled:opacity-40', dark ? 'border-[#7047ff] bg-[#222226] text-white' : 'border-[#16a34a] bg-[#f3faf4] text-[#166534]')}>{uploading ? <Loader2 className="size-5 animate-spin" /> : <Plus className="size-6" />}</button>
                    )}
                    <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" multiple className="hidden" onChange={(event) => { if (event.target.files) void uploadReferenceFiles(Array.from(event.target.files)); event.target.value = ''; }} />
                  </div>
                  <div className="relative min-h-0 pt-0.5">
                    {selectedTemplate ? <div className={cn('mb-1 flex items-center gap-2 text-[11px]', dark ? 'text-[#9f8cff]' : 'text-[#166534]')}><PanelsTopLeft className="size-3" /><span className="truncate">{selectedTemplate.name || '已选择提示词模板'}</span><button type="button" onClick={() => setSelectedTemplate(null)} title="取消模板"><X className="size-3" /></button></div> : null}
                    <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={model?.description || '描述空间、风格、材质、光线与构图，或从提示词模板中选择'} className={cn('scrollbar-hide h-full min-h-0 resize-none border-0 bg-transparent p-0 text-base leading-6 shadow-none focus-visible:ring-0', dark ? 'text-[#b3b3b3] placeholder:text-[#77777e]' : 'text-[#171717] placeholder:text-[#8aa08a]')} />
                  </div>
                </div>
                <div aria-label="对话框操作" className="absolute right-3 top-3 flex h-10 items-center gap-2 lg:-right-[60px] lg:bottom-0 lg:top-auto lg:h-[86px] lg:w-12 lg:flex-col">
                  <button type="button" disabled={assisting || !prompt.trim()} onClick={() => void assistPrompt()} title="优化提示词" className={cn('flex size-[30px] items-center justify-center rounded-full disabled:opacity-40', t.muted)}>{assisting ? <Loader2 className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}</button>
                  <button type="button" onClick={() => setPromptExpanded(true)} title="全屏编辑提示词" className={cn('flex size-[30px] items-center justify-center rounded-full', t.muted)}><Maximize2 className="size-4" /></button>
                </div>
                <div className="grid min-w-0 grid-cols-2 items-center gap-2 overflow-visible sm:flex sm:flex-wrap lg:flex-nowrap">
                  <Select value={modelProfileId} onValueChange={(value) => { setModelProfileId(value); applyModelDefaults(bootstrap.models.find((item) => item.id === value)); }}>
                    <SelectTrigger className={cn('col-span-2 h-10 w-full shrink-0 rounded-lg px-3 text-sm sm:w-[186px]', t.selectTrigger)}><Bot className={cn('size-4', t.accent)} /><SelectValue placeholder="选择模型" /></SelectTrigger>
                    <SelectContent className={t.selectContent}><SelectGroup>{bootstrap.models.map((item) => <SelectItem key={item.id} value={item.id} className={t.selectItem}>{item.name}</SelectItem>)}</SelectGroup></SelectContent>
                  </Select>
                  <Select value={String(count)} onValueChange={(value) => setCount(Number(value))}>
                    <SelectTrigger className={cn('h-10 w-full shrink-0 rounded-lg px-3 text-sm sm:w-[104px]', t.selectTrigger)}><Images className="size-4" /><SelectValue /></SelectTrigger>
                    <SelectContent className={t.selectContent}><SelectGroup>{[1, 2, 3, 4].map((value) => <SelectItem key={value} value={String(value)} className={t.selectItem}>{value}张</SelectItem>)}</SelectGroup></SelectContent>
                  </Select>
                  {resolutionTier !== 'CUSTOM' ? (
                    <Select value={aspectRatio} onValueChange={setAspectRatio}>
                      <SelectTrigger className={cn('h-10 w-full shrink-0 rounded-lg px-3 text-sm sm:w-[128px]', t.selectTrigger)}><Crop className="size-4" /><SelectValue /></SelectTrigger>
                      <SelectContent className={t.selectContent}><SelectGroup>{availableAspectRatios.map((item) => <SelectItem key={item} value={item} className={t.selectItem}>{item === 'auto' ? '自动比例' : item}</SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                  ) : null}
                  <Select value={resolutionTier} onValueChange={(value) => {
                    const nextTier = value as typeof resolutionTier;
                    const nextRatios = model?.aspectRatiosByResolutionTier?.[nextTier] || model?.aspectRatios || [];
                    setResolutionTier(nextTier);
                    if (nextTier !== 'CUSTOM' && !nextRatios.includes(aspectRatio)) {
                      setAspectRatio(nextRatios.includes(model?.defaults.aspectRatio || '') ? model?.defaults.aspectRatio || nextRatios[0] : nextRatios[0]);
                    }
                  }}>
                    <SelectTrigger className={cn('h-10 w-full shrink-0 rounded-lg px-3 text-sm sm:w-[116px]', t.selectTrigger)}><Maximize2 className="size-4" /><SelectValue /></SelectTrigger>
                    <SelectContent className={t.selectContent}><SelectGroup>{(model?.resolutionTiers || []).map((item) => <SelectItem key={item} value={item} className={t.selectItem}>{item === 'CUSTOM' ? '自定义' : item}</SelectItem>)}</SelectGroup></SelectContent>
                  </Select>
                  {resolutionTier === 'CUSTOM' && model?.supportsCustomSize ? (
                    <div className={cn('col-span-2 flex h-10 items-center justify-center gap-1 rounded-lg border px-2', t.selectTrigger)}>
                      <Input aria-label="自定义宽度" type="number" min={16} max={3840} step={16} value={customWidth} onChange={(event) => setCustomWidth(Number(event.target.value))} className="h-8 w-[76px] border-0 bg-transparent px-1 text-center text-sm shadow-none focus-visible:ring-0" />
                      <span className={cn('text-xs', t.muted)}>x</span>
                      <Input aria-label="自定义高度" type="number" min={16} max={3840} step={16} value={customHeight} onChange={(event) => setCustomHeight(Number(event.target.value))} className="h-8 w-[76px] border-0 bg-transparent px-1 text-center text-sm shadow-none focus-visible:ring-0" />
                    </div>
                  ) : null}
                  <button type="button" onClick={() => setTemplateOpen(true)} className={cn('flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-lg border px-3 text-sm sm:w-[124px]', t.selectTrigger)}><PanelsTopLeft className="size-4" />提示词模板</button>
                  <button
                    type="button"
                    disabled={generating || retrying || currentBatchActive || !prompt.trim() || !modelProfileId || !hasEnabledPrice}
                    onClick={shouldRetryCurrentBatch ? () => { void retryCurrentBatch(); } : () => { void submitGeneration(); }}
                    className={cn('col-span-2 ml-0 flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-xl px-3 text-base text-white hover:brightness-110 disabled:cursor-not-allowed disabled:bg-[#6b6b6b] disabled:bg-none disabled:opacity-100 sm:ml-auto sm:w-[152px]', t.generate)}
                  >
                    {generating || retrying || currentBatchActive ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    {retrying ? '重试中' : currentBatchActive ? '生成中' : shouldRetryCurrentBatch ? '重试本轮' : hasTaskStage ? '开始新一轮' : '开始生图'}
                  </button>
                </div>
              </section>
            </>
          )}
        </main>
      </div>

      <TemplateLibraryDialog open={templateOpen} onOpenChange={setTemplateOpen} selectedTemplateId={selectedTemplate?.id} onSelect={applyTemplate} />
      <ImageEditorDialog imageUrl={editorGeneration?.imageUrl} open={Boolean(editorGeneration)} onOpenChange={(open) => !open && setEditorGeneration(null)} onUse={async (file, extraPrompt) => {
        const added = await uploadReferenceFiles([file], '已使用标注图片');
        if (added && extraPrompt) setPrompt((current) => current.trim() ? `${current.trim()}\n${extraPrompt}` : extraPrompt);
      }} />

      <Dialog open={promptExpanded} onOpenChange={setPromptExpanded}>
        <DialogContent className={cn('max-w-3xl sm:rounded-xl', dark ? 'border-white/15 bg-[#1b1c20] text-white' : 'border-[#e5e9e5] bg-white')}>
          <DialogHeader><DialogTitle className="text-base">编辑提示词</DialogTitle><DialogDescription className="sr-only">编辑本次生成使用的正向和负向提示词。</DialogDescription></DialogHeader>
          <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} className={cn('min-h-64 resize-none leading-6', dark ? 'border-white/10 bg-[#222328] text-white' : 'border-[#e5e9e5]')} />
          <div><label className={cn('mb-2 block text-xs', t.muted)}>不希望出现的内容（可选）</label><Textarea value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} className={cn('min-h-24 resize-none', dark ? 'border-white/10 bg-[#222328] text-white' : 'border-[#e5e9e5]')} /></div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => { setPrompt(''); setNegativePrompt(''); }}>清空</Button><Button className={cn('text-white', dark ? 'bg-[#7047ff] hover:bg-[#6034ee]' : 'bg-[#16a34a] hover:bg-[#15803d]')} onClick={() => setPromptExpanded(false)}>完成</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(previewGeneration)} onOpenChange={(open) => { if (!open) setPreviewGeneration(null); }}>
        <DialogContent className={cn('grid h-[90vh] max-w-[92vw] grid-rows-[auto_minmax(0,1fr)] gap-3 p-3 sm:rounded-xl', dark ? 'border-white/10 bg-[#111216] text-white' : 'border-[#e5e9e5] bg-white')}>
          <DialogHeader className="flex flex-row items-center justify-between space-y-0 pr-10">
            <div>
              <DialogTitle className="text-base">{compareFloorPlan && floorPlanPreviewUrl ? '户型对照' : '生成结果预览'}</DialogTitle>
              <DialogDescription className="sr-only">对照客户户型与 AI 效果图，或单独查看生成结果。</DialogDescription>
            </div>
            {floorPlanPreviewUrl ? (
              <button
                type="button"
                onClick={() => setCompareFloorPlan((current) => !current)}
                className={cn('inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs', t.iconBtn)}
              >
                <Columns2 className="size-3.5" />
                {compareFloorPlan ? '只看效果图' : '对照户型'}
              </button>
            ) : null}
          </DialogHeader>
          <div className={cn('min-h-0', compareFloorPlan && floorPlanPreviewUrl ? 'grid grid-cols-2 gap-3' : 'flex items-center justify-center')}>
            {compareFloorPlan && floorPlanPreviewUrl ? (
              <figure className={cn('flex min-h-0 flex-col overflow-hidden rounded-lg border', dark ? 'border-white/10 bg-black' : 'border-[#e5e9e5] bg-black')}>
                <figcaption className={cn('shrink-0 px-3 py-2 text-xs', t.muted)}>客户户型 · {sourceFloorPlanName}</figcaption>
                <img src={floorPlanPreviewUrl} alt="客户户型对照图" className="min-h-0 w-full flex-1 object-contain" />
              </figure>
            ) : null}
            <figure className={cn('flex min-h-0 flex-col overflow-hidden', compareFloorPlan && floorPlanPreviewUrl ? cn('rounded-lg border', dark ? 'border-white/10 bg-black/40' : 'border-[#e5e9e5] bg-[#f6f8f6]') : '')}>
              {compareFloorPlan && floorPlanPreviewUrl ? <figcaption className={cn('shrink-0 px-3 py-2 text-xs', t.muted)}>AI 效果图</figcaption> : null}
              {previewGeneration?.imageUrl ? <img src={previewGeneration.imageUrl} alt="生成结果大图" className="min-h-0 w-full flex-1 object-contain" /> : null}
            </figure>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={floorPlanOpen} onOpenChange={setFloorPlanOpen}>
        <DialogContent className={cn('grid h-[90vh] max-w-[92vw] grid-rows-[auto_minmax(0,1fr)] gap-3 p-3 sm:rounded-xl', dark ? 'border-white/10 bg-[#111216] text-white' : 'border-[#e5e9e5] bg-white')}>
          <DialogHeader className="flex flex-row items-center justify-between space-y-0 pr-10">
            <div>
              <DialogTitle className="text-base">客户户型 · {sourceFloorPlanName}</DialogTitle>
              <DialogDescription className="sr-only">查看当前方案绑定的正式量房控制图，便于对照 AI 效果图结构。</DialogDescription>
            </div>
            {sourceFloorPlanId ? (
              <Link href={`/floorplans/${sourceFloorPlanId}`} target="_blank" rel="noopener noreferrer" className={cn('inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs', t.iconBtn)}>
                <ExternalLink className="size-3.5" />打开正式户型
              </Link>
            ) : null}
          </DialogHeader>
          <div className="flex min-h-0 items-center justify-center overflow-hidden rounded-lg bg-black">
            {floorPlanPreviewUrl ? <img src={floorPlanPreviewUrl} alt="客户户型对照图大图" className="max-h-full max-w-full object-contain" /> : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className={cn('max-w-md sm:rounded-xl', dark ? 'border-white/15 bg-[#1b1c20] text-white' : 'border-[#e5e9e5] bg-white')}>
          <DialogHeader><DialogTitle className="text-base">新建方案对话</DialogTitle><DialogDescription className="sr-only">为当前客户新建一个命名方案对话并关联合格正式户型。</DialogDescription></DialogHeader>
          <label className={cn('text-xs', t.muted)}>方案名称</label>
          <Input value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} placeholder="例如 灯光设计" className={t.input} />
          <label className={cn('text-xs', t.muted)}>关联正式户型</label>
          <Select value={createFloorPlanId} onValueChange={setCreateFloorPlanId}>
            <SelectTrigger className={t.selectTrigger}><SelectValue placeholder="选择户型" /></SelectTrigger>
            <SelectContent className={t.selectContent}>{eligibleFloorPlans.map((plan) => <SelectItem key={plan.id} value={plan.id} className={t.selectItem}>{plan.name || '正式户型'}</SelectItem>)}</SelectContent>
          </Select>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button disabled={creating || !createFloorPlanId} className={cn('text-white', dark ? 'bg-[#7047ff] hover:bg-[#6034ee]' : 'bg-[#16a34a] hover:bg-[#15803d]')} onClick={() => void createConversation()}>{creating ? '创建中…' : '创建'}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent className={cn('max-w-md sm:rounded-xl', dark ? 'border-white/15 bg-[#1b1c20] text-white' : 'border-[#e5e9e5] bg-white')}>
          <DialogHeader><DialogTitle className="text-base">发送给客户</DialogTitle><DialogDescription>客户将在小程序项目里看到这一套方案，共 {selectedImageIds.length} 张效果图。</DialogDescription></DialogHeader>
          <Input value={sendTitle} onChange={(event) => setSendTitle(event.target.value)} placeholder="方案名称，例如 灯光设计" className={t.input} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSendOpen(false)}>取消</Button>
            <Button disabled={sendingScheme} className={cn('text-white', dark ? 'bg-[#7047ff] hover:bg-[#6034ee]' : 'bg-[#16a34a] hover:bg-[#15803d]')} onClick={() => void sendScheme()}>{sendingScheme ? '发送中…' : '确认发送'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
