/* eslint-disable @next/next/no-img-element -- Authenticated media routes and generated image URLs are dynamic. */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NextImage from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Bot,
  Check,
  Coins,
  Columns2,
  Copy,
  Crop,
  Download,
  ExternalLink,
  FileImage,
  Home,
  Images,
  Loader2,
  Maximize2,
  Minus,
  Moon,
  PanelsTopLeft,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  Send,
  Sparkles,
  Sun,
  WandSparkles,
  X,
  Trash2,
} from 'lucide-react';
import { Button, ConfigProvider, Input, Modal, Select } from 'antd';
import { notify } from '@/components/admin/operation-feedback';
import { studioDarkAntdTheme, studioLightAntdTheme } from '@/components/admin/studio-antd-theme';
import { usePagePolling } from '@/hooks/usePagePolling';
import {
  AI_PAGE_IDLE_MS,
  AI_WORKBENCH_POLL_INTERVAL_MS,
} from '@/lib/page-activity';
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
  pickDefaultCreationModel,
  readStoredWorkbenchTheme,
  WORKBENCH_THEME_STORAGE_KEY,
  WORKBENCH_WHOLE_FLOOR_SCOPE_KEY,
  workbenchComposerControlPreviewUrl,
  workbenchMaxUserReferenceImages,
  type WorkbenchTheme,
} from '@/lib/ai/workbench-studio';
import {
  mergeTemplateReferenceAsset,
  planPromptTemplateReferenceAttach,
  promptTemplateCoverClonePath,
  promptTemplatePreviewSrc,
} from '@/lib/ai/prompt-template-reference';
import { cn } from '@/lib/utils';

type BootstrapData = {
  account: { balance: number; frozenBalance: number; availableBalance: number };
  price: { credits: number; label: string };
  provider: { actionEnabled: boolean; supportsGenerate: boolean; supportsEdit: boolean; defaultRemoteModel?: string };
  models: CreationModelProfile[];
};

type FloorPlanOption = { id: string; name?: string; status?: string };
type ClosedRoomOption = {
  roomId: string;
  roomName: string;
  roomSize: string;
  openingCount?: number;
};
type LeadSummary = {
  id: string;
  name: string;
  communityName?: string;
  floorPlans: FloorPlanOption[];
  workflowCount?: number;
};
type WorkflowSummary = { id: string; title: string; generationCount?: number; publishedCount?: number };
type WorkflowDetail = {
  workflow: WorkflowSummary & {
    sourceFloorPlanId?: string;
    floorPlanPreviewUrl?: string;
    sourceFloorPlan?: {
      id: string;
      name?: string;
      previewVersion?: string;
      rooms?: ClosedRoomOption[];
      closedRoomCount?: number;
    } | null;
  };
  lead: { id: string; name: string; communityName?: string; floorPlans: FloorPlanOption[] };
  generations: Array<{
    id: string;
    status: string;
    published?: boolean;
    input?: { userMessage?: string; customPrompt?: string };
    output?: { imageUrl?: string };
    errorMessage?: string | null;
    createdAt: string;
  }>;
  publishedScheme?: { title: string; publishedAt?: string; generationIds: string[]; finalized?: boolean } | null;
};
type TemplateDetail = PromptTemplate & { parameterTemplate?: { parameters?: Record<string, unknown> } };
type WorkbenchRenderMode = 'whole_floor_plan' | 'single_room_photo' | 'soft_furnishing';
type LeadSitePhotoOption = {
  id: string;
  assetId: string;
  previewUrl: string;
  spaceTag?: string | null;
  spaceTagLabel: string;
  width?: number | null;
  height?: number | null;
  createdAt: string;
};

function normalizeWorkbenchRenderMode(value?: string): WorkbenchRenderMode {
  return value === 'single_room_photo' ? 'single_room_photo' : 'whole_floor_plan';
}

const darkSelectPopupClassName = '[&_.ant-select-item]:!text-[#f5f5f5] [&_.ant-select-item-option-active]:!bg-white/10 [&_.ant-select-item-option-selected]:!bg-white/[0.08] [&_.ant-select-item-option-selected]:!text-white';
const lightSelectPopupClassName = '[&_.ant-select-item]:!text-[#171717] [&_.ant-select-item-option-active]:!bg-[#f3faf4] [&_.ant-select-item-option-selected]:!bg-[#e8f6ea] [&_.ant-select-item-option-selected]:!text-[#166534]';
const darkIconButtonClassName = '!border-0 !bg-transparent !text-[#e5e5ea] hover:!bg-white/10 hover:!text-white';
const lightIconButtonClassName = '!border-0 !bg-transparent !text-[#171717] hover:!bg-black/[0.06] hover:!text-[#166534]';

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

function batchScopeSelection(batch: CreationBatch) {
  const scope = batch.parameterSnapshot.targetScope;
  const roomId = String(batch.parameterSnapshot.roomId || '').trim();
  if (scope === 'single_room' && roomId) return roomId;
  return WORKBENCH_WHOLE_FLOOR_SCOPE_KEY;
}

function batchScopeLabel(batch: CreationBatch) {
  const label = String(batch.parameterSnapshot.targetLabel || '').trim();
  if (label) return label;
  return batch.parameterSnapshot.targetScope === 'single_room' ? '单房间' : '完整户型';
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
  onDelete,
}: {
  generation?: CreationGeneration;
  batchStatus?: CreationBatch['status'];
  selected: boolean;
  dark: boolean;
  onPreview: (generation: CreationGeneration) => void;
  onReuse: (generation: CreationGeneration) => void;
  onEdit: (generation: CreationGeneration) => void;
  onToggle: (generation: CreationGeneration, selected: boolean) => void;
  onDelete?: (generation: CreationGeneration) => void;
}) {
  const tileClass = dark ? 'bg-[#2a2b31]' : 'bg-[#eef3ee]';
  const iconButtonClass = dark ? darkIconButtonClassName : lightIconButtonClassName;
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
      {generation.published ? (
        <span className="absolute right-2 top-2 rounded-md bg-[#16a34a] px-2 py-1 text-[11px] font-medium text-white shadow-sm">已发送</span>
      ) : (
        <label className={cn('absolute bottom-2 left-2 flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium', dark ? 'bg-[#202126]/95 text-white' : 'bg-white/95 text-[#166534]')}>
          <input
            type="checkbox"
            checked={selected}
            onChange={(event) => onToggle(generation, event.target.checked)}
          />
          发给客户
        </label>
      )}
      <div className={cn('absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-1 rounded-lg p-1.5 opacity-0 shadow-xl backdrop-blur transition group-hover:opacity-100 group-focus-within:opacity-100', dark ? 'bg-[#202126]/95 text-[#e5e5ea]' : 'bg-white/95 text-[#171717]')}>
        <Button size="small" type="text" className={iconButtonClass} href={generation.imageUrl} download={`ai-workbench-${generation.id}.png`} title="下载" icon={<Download size={14} />} />
        <Button size="small" type="text" className={iconButtonClass} onClick={() => onReuse(generation)} title="基于此图继续" icon={<Copy size={14} />} />
        <Button size="small" type="text" className={iconButtonClass} onClick={() => onEdit(generation)} title="编辑" icon={<Pencil size={14} />} />
        {onDelete ? <Button size="small" type="text" className={iconButtonClass} onClick={() => onDelete(generation)} title="删除轮次" icon={<Trash2 size={14} />} /> : null}
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
  const [renderMode, setRenderMode] = useState<WorkbenchRenderMode>('whole_floor_plan');
  const [scopeSelection, setScopeSelection] = useState(WORKBENCH_WHOLE_FLOOR_SCOPE_KEY);
  const [assets, setAssets] = useState<CreationAsset[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateDetail | null>(null);
  const [templateAssetId, setTemplateAssetId] = useState('');
  const [templateOpen, setTemplateOpen] = useState(false);
  const [sitePhotoOpen, setSitePhotoOpen] = useState(false);
  const [sitePhotos, setSitePhotos] = useState<LeadSitePhotoOption[]>([]);
  const [sitePhotosLoading, setSitePhotosLoading] = useState(false);
  const [sitePhotosError, setSitePhotosError] = useState('');
  const [selectedSitePhotoAssetIds, setSelectedSitePhotoAssetIds] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [assisting, setAssisting] = useState(false);
  const [previewGeneration, setPreviewGeneration] = useState<CreationGeneration | null>(null);
  const [floorPlanOpen, setFloorPlanOpen] = useState(false);
  const [compareFloorPlan, setCompareFloorPlan] = useState(true);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewRotation, setPreviewRotation] = useState(0);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const [editorGeneration, setEditorGeneration] = useState<CreationGeneration | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createFloorPlanId, setCreateFloorPlanId] = useState('');
  const [creating, setCreating] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendTitle, setSendTitle] = useState('');
  const [sendingScheme, setSendingScheme] = useState(false);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizingScheme, setFinalizingScheme] = useState(false);
  const [deletingGeneration, setDeletingGeneration] = useState(false);
  const [deletingWorkflowId, setDeletingWorkflowId] = useState<string | null>(null);
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
    input: dark ? '!border-white/10 !bg-white/[0.06] !text-white placeholder:!text-[#77777e]' : '!border-[#e5e9e5] !bg-white !text-[#171717] placeholder:!text-[#8aa08a]',
    iconBtn: dark ? 'border-white/10 bg-white/[0.04] text-[#b3b3b3] hover:text-white' : 'border-[#e5e9e5] bg-white text-[#526052] hover:text-[#166534]',
    ghostBtn: dark ? '!border-white/10 !bg-white/[0.04] !text-[#b3b3b3] hover:!border-white/25 hover:!text-white' : '!border-[#e5e9e5] !bg-white !text-[#526052] hover:!border-[#16a34a] hover:!text-[#166534]',
    primaryBtn: dark ? '!border-none !bg-[#7047ff] !text-white hover:!bg-[#6034ee] disabled:!opacity-50' : '!border-none !bg-[#16a34a] !text-white hover:!bg-[#15803d] disabled:!opacity-50',
    selectBox: dark ? 'border-[#37373b] bg-[#222226] text-[#f5f5f5]' : 'border-[#e5e9e5] bg-white text-[#171717]',
    selectTrigger: dark ? '[&_.ant-select-selector]:!rounded-lg [&_.ant-select-selector]:!border-[#37373b] [&_.ant-select-selector]:!bg-[#222226] [&_.ant-select-selection-item]:!text-[#f5f5f5] [&_.ant-select-selection-placeholder]:!text-[#77777e] [&_.ant-select-arrow]:!text-[#f5f5f5]' : '[&_.ant-select-selector]:!rounded-lg [&_.ant-select-selector]:!border-[#e5e9e5] [&_.ant-select-selector]:!bg-white [&_.ant-select-selection-item]:!text-[#171717] [&_.ant-select-selection-placeholder]:!text-[#8aa08a] [&_.ant-select-arrow]:!text-[#8aa08a]',
    selectPopup: dark ? cn('border border-white/10 bg-[#18191d] text-white', darkSelectPopupClassName) : cn('border border-[#e5e9e5] bg-white text-[#171717]', lightSelectPopupClassName),
    modal: dark
      ? '[&_.ant-modal-content]:!border [&_.ant-modal-content]:!border-white/15 [&_.ant-modal-content]:!bg-[#1b1c20] [&_.ant-modal-content]:!text-white [&_.ant-modal-header]:!bg-transparent [&_.ant-modal-title]:!text-white [&_.ant-modal-close]:!text-[#b3b3b3] [&_.ant-modal-footer]:!border-0'
      : '[&_.ant-modal-content]:!border [&_.ant-modal-content]:!border-[#e5e9e5] [&_.ant-modal-content]:!bg-white [&_.ant-modal-content]:!text-[#171717] [&_.ant-modal-header]:!bg-transparent [&_.ant-modal-title]:!text-[#171717] [&_.ant-modal-footer]:!border-0',
    mediaModal: dark
      ? '[&_.ant-modal-content]:!border [&_.ant-modal-content]:!border-white/10 [&_.ant-modal-content]:!bg-[#111216] [&_.ant-modal-content]:!text-white [&_.ant-modal-header]:!bg-transparent [&_.ant-modal-title]:!text-white [&_.ant-modal-close]:!text-[#b3b3b3]'
      : '[&_.ant-modal-content]:!border [&_.ant-modal-content]:!border-[#e5e9e5] [&_.ant-modal-content]:!bg-white [&_.ant-modal-content]:!text-[#171717] [&_.ant-modal-header]:!bg-transparent [&_.ant-modal-title]:!text-[#171717]',
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
    setModelProfileId((current) => current || pickDefaultCreationModel(
      payload.data.models as CreationModelProfile[] | undefined,
      payload.data.provider?.defaultRemoteModel,
    )?.id || '');
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
    setTemplateAssetId('');
    setSitePhotoOpen(false);
    setSitePhotos([]);
    setSelectedSitePhotoAssetIds([]);
    setScopeSelection(WORKBENCH_WHOLE_FLOOR_SCOPE_KEY);
    setRenderMode('whole_floor_plan');
    setFloorPlanOpen(false);
    setPreviewGeneration(null);
  }, [loadConversation, selectedWorkflowId]);

  const hasProcessing = Boolean(
    task?.batches.some((batch) => batch.status === 'processing' || batch.status === 'pending')
    || detail?.generations.some((generation) => ['created', 'pending', 'processing'].includes(generation.status))
  );
  usePagePolling(() => {
    if (!selectedWorkflowId) return;
    return loadConversation(selectedWorkflowId, true);
  }, {
    enabled: hasProcessing && Boolean(selectedWorkflowId),
    intervalMs: AI_WORKBENCH_POLL_INTERVAL_MS,
    idleMs: AI_PAGE_IDLE_MS,
  });

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
  const floorPlanPreviewVersion = detail?.workflow.sourceFloorPlan?.previewVersion || '';
  const hasBoundFloorPlan = Boolean(sourceFloorPlanId);
  const sourceFloorPlanName = detail?.workflow.sourceFloorPlan?.name || '正式户型';
  const closedRooms = useMemo(
    () => detail?.workflow.sourceFloorPlan?.rooms || [],
    [detail?.workflow.sourceFloorPlan?.rooms],
  );
  const closedRoomCount = detail?.workflow.sourceFloorPlan?.closedRoomCount
    ?? closedRooms.length;
  const scopeOptions = useMemo(() => ([
    {
      value: WORKBENCH_WHOLE_FLOOR_SCOPE_KEY,
      label: `完整户型 · ${closedRoomCount} 个闭合空间`,
      title: '完整户型',
    },
    ...closedRooms.map((room) => ({
      value: room.roomId,
      label: `${room.roomName} · ${room.roomSize}`,
      title: room.roomName,
    })),
  ]), [closedRoomCount, closedRooms]);
  const targetScope = scopeSelection === WORKBENCH_WHOLE_FLOOR_SCOPE_KEY ? 'whole_floor_plan' : 'single_room';
  const selectedRoomId = targetScope === 'single_room' ? scopeSelection : '';
  const selectedRoom = closedRooms.find((room) => room.roomId === selectedRoomId);
  const attachFloorPlanControl = hasBoundFloorPlan && renderMode === 'whole_floor_plan';
  const controlPreviewUrl = attachFloorPlanControl && sourceFloorPlanId
    ? workbenchComposerControlPreviewUrl(selectedWorkflowId, scopeSelection, floorPlanPreviewVersion)
    : '';
  const controlPreviewAlt = targetScope === 'single_room'
    ? `${selectedRoom?.roomName || '房间'}控制图`
    : '完整户型控制图';

  useEffect(() => {
    if (!closedRooms.length) {
      setScopeSelection(WORKBENCH_WHOLE_FLOOR_SCOPE_KEY);
      return;
    }
    setScopeSelection((current) => (
      current === WORKBENCH_WHOLE_FLOOR_SCOPE_KEY || closedRooms.some((room) => room.roomId === current)
        ? current
        : WORKBENCH_WHOLE_FLOOR_SCOPE_KEY
    ));
  }, [closedRooms, selectedWorkflowId]);

  const selectedBatch = latestBatch(task);
  const model = bootstrap?.models.find((item) => item.id === modelProfileId);
  const handleRenderModeChange = (value: WorkbenchRenderMode) => {
    setRenderMode(value);
    const nextAttachControl = hasBoundFloorPlan && value === 'whole_floor_plan';
    if (model) {
      setAssets((current) => current.slice(0, workbenchMaxUserReferenceImages(model.maxReferenceImages || 0, nextAttachControl)));
    }
  };
  const maxUserRefs = workbenchMaxUserReferenceImages(model?.maxReferenceImages || 0, attachFloorPlanControl);
  const sitePhotoLibraryAssetIds = new Set(sitePhotos.map((item) => item.assetId));
  const sitePhotoSelectionLimit = Math.max(0, maxUserRefs - assets.filter((asset) => !sitePhotoLibraryAssetIds.has(asset.id)).length);
  const availableAspectRatios = model?.aspectRatiosByResolutionTier?.[resolutionTier] || model?.aspectRatios || [];
  const unitPrice = model?.prices.find((price) => price.resolutionTier === resolutionTier)?.credits || 0;
  const estimatedCredits = unitPrice * count;
  const hasEnabledPrice = unitPrice > 0;
  const conversationBatches = useMemo(() => {
    const publishedByGenerationId = new Map((detail?.generations || []).map((generation) => [
      generation.id,
      Boolean(generation.published),
    ]));
    const real = task ? [...task.batches].sort((left, right) => left.sequence - right.sequence) : [];
    const claimed = new Set(real.flatMap((batch) => batch.generations.map((generation) => generation.id)));
    const patchedReal = real.map((batch) => ({
      ...batch,
      generations: batch.generations.map((generation) => ({
        ...generation,
        published: publishedByGenerationId.has(generation.id) ? publishedByGenerationId.get(generation.id) : false,
      })),
    }));
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
        parameterSnapshot: { aspectRatio: '1:1' } as CreationBatch['parameterSnapshot'],
        requestedCount: 1,
        status: (generation.status === 'succeeded' ? 'succeeded' : generation.status === 'failed' ? 'failed' : 'processing') as CreationBatch['status'],
        creditsEstimate: 0,
        createdAt: generation.createdAt,
        generations: [{
          id: generation.id,
          status: generation.status as CreationGeneration['status'],
          imageUrl: generation.output?.imageUrl,
          published: Boolean(generation.published),
          error: generation.errorMessage || undefined,
          retryCount: 0,
          createdAt: generation.createdAt,
        }],
      } satisfies CreationBatch));
    return [...legacy.map((batch, index) => ({ ...batch, sequence: index + 1 })), ...patchedReal.map((batch, index) => ({ ...batch, sequence: legacy.length + index + 1 }))];
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
    || renderMode !== (selectedBatch.parameterSnapshot.renderMode || 'whole_floor_plan')
    || scopeSelection !== batchScopeSelection(selectedBatch)
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
    setAssets((current) => current.slice(0, workbenchMaxUserReferenceImages(profile.maxReferenceImages, attachFloorPlanControl)));
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
    setRenderMode(normalizeWorkbenchRenderMode(batch.parameterSnapshot.renderMode));
    setSelectedTemplate(batch.parameterSnapshot.templateId ? { id: batch.parameterSnapshot.templateId } as TemplateDetail : null);
    setScopeSelection(batchScopeSelection(batch));
    const nextReferenceIds = userReferenceIds(batch);
    const nextStyleAssetId = batch.parameterSnapshot.styleReferenceAssetId
      || (batch.parameterSnapshot.hasStyleReference ? nextReferenceIds[0] || '' : '');
    const nextSitePhotoIds = new Set(batch.parameterSnapshot.sitePhotoAssetIds
      || (batch.parameterSnapshot.hasSitePhoto ? nextReferenceIds.filter((id) => id !== nextStyleAssetId) : []));
    setAssets(nextReferenceIds.map((id) => ({
      id,
      previewUrl: `/api/ai/assets/${id}/image`,
      role: id === nextStyleAssetId ? 'style_reference' : nextSitePhotoIds.has(id) ? 'site_photo' : 'additional_reference',
    })));
    setTemplateAssetId(nextStyleAssetId);
  };

  const uploadReferenceFiles = async (
    files: File[],
    successMessage = '已添加参考图',
    role: CreationAsset['role'] = 'site_photo',
  ) => {
    if (!files.length || !model) return false;
    const slots = Math.max(0, maxUserRefs - assets.length);
    if (!model.supportsReferenceImages || !slots) {
      notify.warning(attachFloorPlanControl
        ? `当前模型最多支持 ${maxUserRefs} 张参考图（户型控制图会自动占用 1 张）`
        : `当前模型最多支持 ${maxUserRefs} 张参考图`);
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
      setAssets((current) => [...current, ...uploaded.map((asset) => ({ ...asset, role }))]);
      notify.success(`${successMessage}（${uploaded.length} 张）`);
      return true;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '参考图上传失败');
      return false;
    } finally {
      setUploading(false);
    }
  };

  const loadLeadSitePhotos = async () => {
    if (!selectedLeadId) return;
    setSitePhotosLoading(true);
    setSitePhotosError('');
    try {
      const payload = await readJson(await fetch(`/api/ai/workflow-leads/${selectedLeadId}/site-photos`));
      const items = (payload.data?.items || []) as LeadSitePhotoOption[];
      setSitePhotos(items);
      const libraryAssetIds = new Set(items.map((item) => item.assetId));
      setSelectedSitePhotoAssetIds(assets.filter((asset) => libraryAssetIds.has(asset.id)).map((asset) => asset.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取客户现场图失败';
      setSitePhotosError(message);
      notify.error(message);
    } finally {
      setSitePhotosLoading(false);
    }
  };

  const openLeadSitePhotos = () => {
    if (!selectedLeadId) return notify.warning('请先选择客户线索');
    if (!model?.supportsReferenceImages || !maxUserRefs) return notify.warning('当前模型不支持参考图');
    setSitePhotoOpen(true);
    void loadLeadSitePhotos();
  };

  const toggleLeadSitePhoto = (assetId: string) => {
    const libraryAssetIds = new Set(sitePhotos.map((item) => item.assetId));
    const fixedAssetCount = assets.filter((asset) => !libraryAssetIds.has(asset.id)).length;
    const selectableCount = Math.max(0, maxUserRefs - fixedAssetCount);
    setSelectedSitePhotoAssetIds((current) => {
      if (current.includes(assetId)) return current.filter((id) => id !== assetId);
      if (current.length >= selectableCount) {
        notify.warning(`当前还可选择 ${selectableCount} 张客户现场图`);
        return current;
      }
      return [...current, assetId];
    });
  };

  const applyLeadSitePhotos = () => {
    const libraryAssetIds = new Set(sitePhotos.map((item) => item.assetId));
    const kept = assets.filter((asset) => !libraryAssetIds.has(asset.id));
    const selected = selectedSitePhotoAssetIds
      .map((assetId) => sitePhotos.find((item) => item.assetId === assetId))
      .filter((item): item is LeadSitePhotoOption => Boolean(item))
      .map((item) => ({ id: item.assetId, previewUrl: item.previewUrl, width: item.width || undefined, height: item.height || undefined, role: 'site_photo' as const }));
    setAssets([...kept, ...selected].slice(0, maxUserRefs));
    setSitePhotoOpen(false);
    notify.success(selected.length ? `已选用 ${selected.length} 张客户现场图` : '已清除客户现场图选择');
  };

  const reuseGeneration = async (generation: CreationGeneration) => {
    if (!generation.imageUrl || !model) return;
    const slots = Math.max(0, maxUserRefs - assets.length);
    if (!model.supportsReferenceImages || !slots) {
      notify.warning(attachFloorPlanControl
        ? `当前模型最多支持 ${maxUserRefs} 张参考图（户型控制图会自动占用 1 张）`
        : `当前模型最多支持 ${maxUserRefs} 张参考图`);
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
      setAssets((current) => current.some((item) => item.id === asset.id) ? current : [...current, { ...asset, role: 'additional_reference' }]);
      notify.success('已基于此图继续（1 张）');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '引用生成结果失败');
    } finally {
      setUploading(false);
    }
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
    const nextMaxUserRefs = nextModel?.supportsReferenceImages
      ? workbenchMaxUserReferenceImages(nextModel.maxReferenceImages || 0, attachFloorPlanControl)
      : 0;
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
          ? (hasBoundFloorPlan
            ? '当前模型无法再带入模板参考图（户型控制图会自动占用 1 张）'
            : '当前模型无法再带入模板参考图')
          : '参考图已满，已应用模板文案但未带入封面');
        return;
      }
      notify.success(`已应用模板：${template.name}`);
      return;
    }
    setUploading(true);
    try {
      const payload = await readJson(await fetch(promptTemplateCoverClonePath(template.id), { method: 'POST' }));
      const uploaded = { ...(payload.data as CreationAsset), role: 'style_reference' as const };
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
      notify.success('提示词已优化');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '提示词优化失败');
    } finally {
      setAssisting(false);
    }
  };

  const submitGeneration = async (sourceBatch?: CreationBatch) => {
    if (!selectedWorkflowId) return notify.warning('请先选择或新建方案对话');
    const sourceReferenceIds = sourceBatch ? userReferenceIds(sourceBatch) : [];
    const sourceStyleAssetId = sourceBatch?.parameterSnapshot.styleReferenceAssetId
      || (sourceBatch?.parameterSnapshot.hasStyleReference ? sourceReferenceIds[0] || '' : '');
    const sourceSitePhotoAssetIds = sourceBatch?.parameterSnapshot.sitePhotoAssetIds
      || (sourceBatch?.parameterSnapshot.hasSitePhoto ? sourceReferenceIds.filter((id) => id !== sourceStyleAssetId) : []);
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
      renderMode: normalizeWorkbenchRenderMode(sourceBatch.parameterSnapshot.renderMode),
      hasStyleReference: sourceBatch.parameterSnapshot.hasStyleReference ?? Boolean(sourceBatch.parameterSnapshot.templateId),
      hasSitePhoto: sourceSitePhotoAssetIds.length > 0,
      styleReferenceAssetId: sourceStyleAssetId,
      sitePhotoAssetIds: sourceSitePhotoAssetIds,
      targetScope: sourceBatch.parameterSnapshot.targetScope === 'single_room' ? 'single_room' as const : 'whole_floor_plan' as const,
      roomId: sourceBatch.parameterSnapshot.targetScope === 'single_room'
        ? String(sourceBatch.parameterSnapshot.roomId || '')
        : '',
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
      renderMode,
      hasStyleReference: Boolean(templateAssetId),
      hasSitePhoto: assets.some((asset) => asset.role === 'site_photo'),
      styleReferenceAssetId: templateAssetId,
      sitePhotoAssetIds: assets.filter((asset) => asset.role === 'site_photo').map((asset) => asset.id),
      targetScope,
      roomId: selectedRoomId,
    };
    const draftModel = bootstrap?.models.find((item) => item.id === draft.modelProfileId);
    const draftUnitPrice = draftModel?.prices.find((price) => price.resolutionTier === draft.resolutionTier)?.credits || 0;
    if (!draft.prompt.trim()) return notify.warning('请输入提示词');
    if (!draft.modelProfileId) return notify.warning('请选择模型');
    if (draft.renderMode === 'single_room_photo' && !draft.sitePhotoAssetIds.length) {
      return notify.warning(draft.styleReferenceAssetId
        ? '当前只有模板封面图，还需从客户现场图选择或从电脑上传至少一张现场照片'
        : '单间现场模式请从客户现场图选择或从电脑上传至少一张现场照片');
    }
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
          renderMode: draft.renderMode,
          hasStyleReference: draft.hasStyleReference,
          hasSitePhoto: draft.hasSitePhoto,
          styleReferenceAssetId: draft.styleReferenceAssetId || undefined,
          sitePhotoAssetIds: draft.sitePhotoAssetIds,
          workflowId: selectedWorkflowId,
          ...(hasBoundFloorPlan && draft.renderMode === 'whole_floor_plan' ? {
            targetScope: draft.targetScope,
            roomId: draft.roomId || undefined,
          } : {}),
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
    setCreateTitle(selectedLead.workflowCount ? `方案 ${(selectedLead.workflowCount || 0) + 1}` : '方案 1');
    setCreateFloorPlanId(eligibleFloorPlans[0]?.id || '');
    setCreateOpen(true);
  };

  const createConversation = async () => {
    if (!selectedLeadId) return;
    if (eligibleFloorPlans.length && !createFloorPlanId) return;
    setCreating(true);
    try {
      const result = await readJson(await fetch('/api/ai/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: selectedLeadId,
          title: createTitle.trim() || '方案 1',
          ...(createFloorPlanId
            ? { sourceFloorPlanId: createFloorPlanId }
            : { sourceAssetRole: 'rough_sketch' }),
        }),
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
          title: detail?.publishedScheme
            ? (detail.workflow.title?.trim() || '设计方案')
            : (sendTitle.trim() || detail?.workflow.title),
          generationIds: selectedImageIds,
        }),
      }));
      notify.success(detail?.publishedScheme ? '方案已更新到客户' : '方案已发送给客户');
      setSendOpen(false);
      setSelectedImageIds([]);
      await loadConversation(selectedWorkflowId, true);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '发送方案失败');
    } finally {
      setSendingScheme(false);
    }
  };

  const finalizeScheme = async () => {
    if (!selectedLeadId || !selectedWorkflowId) return;
    setFinalizingScheme(true);
    try {
      await readJson(await fetch(
        `/api/leads/${selectedLeadId}/ai-scheme-publications/${selectedWorkflowId}/finalize`,
        { method: 'POST' },
      ));
      notify.success('已设为定稿');
      setFinalizeOpen(false);
      await loadConversation(selectedWorkflowId, true);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '定稿失败');
    } finally {
      setFinalizingScheme(false);
    }
  };

  const deleteGeneration = async (generation: CreationGeneration) => {
    if (!selectedWorkflowId || !selectedLeadId) return;
    if (deletingGeneration) return;
    if (!window.confirm('确定删除该轮次？已删除的图片将从客户方案中移除，并无法在该方案里继续确认。')) return;

    setDeletingGeneration(true);
    try {
      await readJson(await fetch(`/api/ai/workflows/${selectedWorkflowId}/generations/${generation.id}`, { method: 'DELETE' }));
      notify.success('已删除轮次');
      setSelectedImageIds([]);
      await Promise.all([
        loadConversation(selectedWorkflowId, true),
        loadWorkflows(selectedLeadId),
      ]);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '删除轮次失败');
    } finally {
      setDeletingGeneration(false);
    }
  };

  const deleteWorkflow = async (workflowId: string) => {
    if (!selectedLeadId) return;
    if (deletingWorkflowId) return;
    if (!window.confirm('确定删除该方案？删除后客户侧已确认图片将移除，且该方案无法继续编辑。')) return;

    setDeletingWorkflowId(workflowId);
    try {
      await readJson(await fetch(`/api/ai/workflows/${workflowId}`, { method: 'DELETE' }));
      notify.success('方案已删除');

      if (selectedWorkflowId === workflowId) {
        setSelectedWorkflowId('');
        syncQuery(selectedLeadId, '');
      }
      await loadWorkflows(selectedLeadId);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '删除方案失败');
    } finally {
      setDeletingWorkflowId(null);
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
    <ConfigProvider theme={dark ? studioDarkAntdTheme : studioLightAntdTheme}>
      <div className={cn('fixed inset-0 flex h-screen min-h-[720px] min-w-0 flex-col overflow-hidden font-sans lg:min-w-[1024px]', t.page)}>
      <header className={cn('relative z-40 flex h-[68px] min-w-0 items-center justify-between border-b px-3', t.header)}>
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/" className="flex items-center gap-2" title="家客来">
            <NextImage src="/brand-logo.png" alt="" aria-hidden="true" width={28} height={28} className="shrink-0 rounded-md" />
            <span className="hidden text-[15px] font-semibold sm:inline">家客来</span>
          </Link>
          <span className={cn('h-6 w-px', dark ? 'bg-white/20' : 'bg-[#e5e9e5]')} />
          <h1 className="truncate text-base font-medium sm:text-lg">AI 工作台</h1>
        </div>
        <div className="flex items-center gap-2">
          {detail?.publishedScheme ? (
            <span className={cn('hidden rounded-full px-3 py-1 text-xs sm:inline', t.badge)}>
              {detail.publishedScheme.finalized ? '已定稿' : '已发给客户'} · {detail.publishedScheme.generationIds.length} 张
            </span>
          ) : null}
          {detail?.publishedScheme && !detail.publishedScheme.finalized ? (
            <Button
              size="small"
              onClick={() => setFinalizeOpen(true)}
              className={cn('hidden sm:inline-flex', t.iconBtn)}
            >
              设为定稿
            </Button>
          ) : null}
          <Button
            size="small"
            type="primary"
            disabled={!selectedImageIds.length}
            onClick={() => {
              if (!selectedImageIds.length) return notify.error('请先勾选要发给客户的效果图');
              if (!detail?.publishedScheme) {
                setSendTitle(detail?.workflow.title || '设计方案');
              }
              setSendOpen(true);
            }}
            className={cn(
              'hidden sm:inline-flex disabled:!opacity-100',
              dark
                ? '!bg-[#7047ff] hover:!bg-[#6034ee] disabled:!border-transparent disabled:!bg-[#2a2b31] disabled:!text-[#8d8d94]'
                : '!bg-[#16a34a] hover:!bg-[#15803d] disabled:!border-transparent disabled:!bg-[#e8eee8] disabled:!text-[#8aa08a]',
            )}
            icon={<Send className="size-4" />}
          >
            {detail?.publishedScheme ? '更新客户方案' : '发送给客户'}{selectedImageIds.length ? `（${selectedImageIds.length}）` : ''}
          </Button>
          <button type="button" title={dark ? '切换日间主题' : '切换夜间主题'} onClick={() => persistTheme(dark ? 'light' : 'dark')} className={cn('flex size-9 items-center justify-center rounded-full border', t.iconBtn)}>
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <div className={cn('flex h-9 items-center gap-2 rounded-full border px-3 text-xs', t.iconBtn)} title="可用 AI 点数">
            <Coins className={cn('size-4', t.accent)} />
            <strong className="font-semibold">{bootstrap.account.availableBalance}</strong>
          </div>
          <Link href="/ai-studio/create" target="_blank" rel="noopener noreferrer" title="打开 AI 创作台" className={cn('flex size-9 items-center justify-center rounded-full border', t.iconBtn)}><Sparkles className="size-4" /></Link>
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
              <div
                key={workflow.id}
                onClick={() => { setSelectedWorkflowId(workflow.id); syncQuery(selectedLeadId, workflow.id); }}
                className={cn('mb-2 w-full rounded-lg border p-3 text-left', selectedWorkflowId === workflow.id ? t.selected : cn('border', t.card))}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{workflow.title}</div>
                    <div className={cn('mt-1 text-xs', t.muted)}>
                      {workflow.publishedCount ? `已确认 ${workflow.publishedCount} 张` : `${workflow.generationCount || 0} 轮出图`}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteWorkflow(workflow.id);
                    }}
                    disabled={deletingWorkflowId === workflow.id}
                    title="删除方案"
                    className={cn('inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px]', dark ? 'border-white/10 text-[#d5d5da] hover:bg-white/5' : 'border-[#e5e9e5] text-[#8e9e94] hover:bg-[#f3faf4]')}
                  >
                    <Trash2 className="size-3.5" />
                    删除
                  </button>
                </div>
              </div>
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
                            <div className="min-w-0 flex-1">
                              <p className="whitespace-pre-wrap text-sm leading-5">{batch.prompt}</p>
                              {!String(batch.id).startsWith('legacy-') && batch.parameterSnapshot.targetScope ? (
                                <p className={cn('mt-1 text-[11px]', t.muted)}>
                                  应用到：{batchScopeLabel(batch)}
                                  {batch.parameterSnapshot.targetScope === 'single_room' ? ' · 单房间' : ' · 整屋方案'}
                                </p>
                              ) : null}
                              {!String(batch.id).startsWith('legacy-') && batch.parameterSnapshot.renderMode === 'single_room_photo' ? (
                                <p className={cn('mt-1 text-[11px]', t.muted)}>出图模式：单间现场 · 现场图决定镜头</p>
                              ) : null}
                            </div>
                            <time className={cn('shrink-0 text-[11px]', t.muted)} dateTime={batch.createdAt}>{formatDateTime(batch.createdAt)}</time>
                          </div>
                          <div className="scrollbar-hide flex gap-3 overflow-x-auto pb-1">
                            {generations.map((generation, index) => (
                              <GenerationTile
                                key={generation?.id || `pending-${batch.id}-${index}`}
                                generation={generation}
                                batchStatus={batch.status}
                                selected={Boolean(generation && !generation.published && selectedImageIds.includes(generation.id))}
                                dark={dark}
                                onPreview={(generation) => { setCompareFloorPlan(true); setPreviewGeneration(generation); setPreviewZoom(1); setPreviewRotation(0); setPreviewFullscreen(false); }}
                                onReuse={(item) => { void reuseGeneration(item); }}
                                onEdit={setEditorGeneration}
                                onToggle={(item, checked) => {
                                  if (!checked || !item.published) {
                                    setSelectedImageIds((current) => checked ? [...current.filter((id) => id !== item.id), item.id] : current.filter((id) => id !== item.id));
                                  }
                                }}
                                onDelete={(generation) => void deleteGeneration(generation)}
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
                      <p className={cn('mt-3 text-sm', t.muted)}>{hasBoundFloorPlan
                        ? '左上角可对照客户户型。出图前先选择完整户型或单房间；控制图会按作用域自动带入。选择模型、模板或直接描述空间、光线与材质。'
                        : '当前方案未绑定正式户型。上传现场照或户型图照片作为参考，选择模型、模板或直接描述空间、光线与材质即可出图。'}</p>
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
                <div className="grid h-full min-h-0 grid-cols-[64px_minmax(0,1fr)] gap-3 sm:grid-cols-[84px_minmax(0,1fr)]">
                  <div
                    className="relative flex h-[98px] items-center justify-center overflow-visible"
                    onMouseEnter={() => setReferenceStackExpanded(true)}
                    onMouseLeave={() => setReferenceStackExpanded(false)}
                  >
                    {controlPreviewUrl || assets.length ? (
                      <div className="relative h-[86px] w-[71px] overflow-visible">
                        {controlPreviewUrl ? (
                          <div
                            className={cn('absolute left-0 top-1.5 h-[78px] w-[61px] overflow-hidden rounded-md border bg-black shadow-[0_6px_14px_rgba(0,0,0,0.28)]', dark ? 'border-[#8b72ff]/80' : 'border-[#16a34a]/80')}
                            style={{ zIndex: 0 }}
                          >
                            <img key={controlPreviewUrl} src={controlPreviewUrl} alt={controlPreviewAlt} className="h-full w-full object-contain" />
                            <span className="absolute inset-x-0 bottom-0 bg-black/65 px-1 py-0.5 text-center text-[10px] leading-3 text-white">户型结构</span>
                          </div>
                        ) : null}
                        {assets.map((asset, index) => {
                          const stackIndex = index + (controlPreviewUrl ? 1 : 0);
                          const offsetX = referenceStackExpanded ? stackIndex * 65 : stackIndex * 4;
                          return (
                            <div
                              key={asset.id}
                              className="absolute left-0 top-1.5 h-[78px] w-[61px] overflow-hidden rounded-md border border-[#8b72ff]/80 bg-[#222226] shadow-[0_6px_14px_rgba(0,0,0,0.28)]"
                              style={{ transform: `translate3d(${offsetX}px, 0, 0)`, zIndex: stackIndex + 1 }}
                            >
                              <img src={asset.previewUrl} alt={asset.role === 'style_reference' || asset.id === templateAssetId ? '模板封面风格参考' : asset.role === 'site_photo' ? '现场图镜头参考' : `补充参考图 ${index + 1}`} className="h-full w-full object-cover" />
                              <span className="absolute inset-x-0 bottom-0 truncate bg-black/65 px-1 py-0.5 text-center text-[10px] leading-3 text-white">
                                {asset.role === 'style_reference' || asset.id === templateAssetId ? '风格图' : asset.role === 'site_photo' ? '现场图' : '补充参考'}
                              </span>
                              <button type="button" aria-label={`删除第 ${index + 1} 张参考图`} className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-[#414148] text-white" onClick={() => {
                                if (asset.id === templateAssetId) setTemplateAssetId('');
                                setAssets((current) => current.filter((item) => item.id !== asset.id));
                              }}><X className="size-3" /></button>
                            </div>
                          );
                        })}
                        {maxUserRefs > assets.length ? (
                          <button
                            type="button"
                            aria-label="上传参考图"
                            disabled={uploading}
                            onClick={() => fileInputRef.current?.click()}
                            className={cn('absolute -bottom-1 -right-1 z-20 flex size-6 items-center justify-center rounded-full text-white disabled:opacity-40', dark ? 'bg-[#7047ff]' : 'bg-[#16a34a]')}
                          >
                            {uploading ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3.5" />}
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <button type="button" aria-label="上传参考图" disabled={uploading || !maxUserRefs} onClick={() => fileInputRef.current?.click()} className={cn('flex h-[86px] w-[71px] -rotate-[12deg] items-center justify-center rounded-md border-2 disabled:opacity-40', dark ? 'border-[#7047ff] bg-[#222226] text-white' : 'border-[#16a34a] bg-[#f3faf4] text-[#166534]')}>{uploading ? <Loader2 className="size-5 animate-spin" /> : <Plus className="size-6" />}</button>
                    )}
                    <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" multiple className="hidden" onChange={(event) => { if (event.target.files) void uploadReferenceFiles(Array.from(event.target.files)); event.target.value = ''; }} />
                  </div>
                  <div className="relative flex h-full min-h-0 flex-col pt-0.5 [&_.ant-input]:!h-full [&_.ant-input]:!min-h-0 [&_textarea]:!h-full [&_textarea]:!min-h-0">
                    {selectedTemplate || renderMode === 'single_room_photo' ? (
                      <div className="mb-1 flex min-w-0 shrink-0 items-center gap-2 text-[11px]">
                        {selectedTemplate ? (
                          <div className={cn('flex min-w-0 items-center gap-2', dark ? 'text-[#9f8cff]' : 'text-[#166534]')}>
                            <PanelsTopLeft className="size-3 shrink-0" />
                            <span className="truncate">{selectedTemplate.name || '已选择提示词模板'}</span>
                            <button type="button" onClick={() => {
                              setSelectedTemplate(null);
                              if (templateAssetId) {
                                setAssets((current) => current.filter((item) => item.id !== templateAssetId));
                                setTemplateAssetId('');
                              }
                            }} title="取消模板"><X className="size-3" /></button>
                          </div>
                        ) : null}
                        {renderMode === 'single_room_photo' ? (
                          <button
                            type="button"
                            onClick={openLeadSitePhotos}
                            className={cn('ml-auto flex shrink-0 items-center gap-1 rounded-md px-2 py-1 font-medium', dark ? 'bg-white/[0.07] text-[#d7d7dc] hover:bg-white/10 hover:text-white' : 'bg-[#e8f6ea] text-[#166534] hover:bg-[#d8f0dc]')}
                          >
                            <Images className="size-3" />客户现场图
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    <Input.TextArea
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      autoSize={false}
                      placeholder={model?.description || '描述空间、风格、材质、光线与构图，或从提示词模板中选择'}
                      className={cn(
                        'scrollbar-hide !h-full min-h-0 flex-1 resize-none !border-0 !bg-transparent p-0 text-base leading-6 !shadow-none focus:!shadow-none',
                        dark ? '!text-[#b3b3b3] placeholder:!text-[#77777e]' : '!text-[#171717] placeholder:!text-[#8aa08a]',
                      )}
                      styles={{ textarea: { height: '100%', minHeight: 0 } }}
                    />
                  </div>
                </div>
                <div aria-label="对话框操作" className="absolute right-3 top-3 flex h-10 items-center gap-2 lg:-right-[60px] lg:bottom-0 lg:top-auto lg:h-[86px] lg:w-12 lg:flex-col">
                  <button type="button" disabled={assisting || !prompt.trim()} onClick={() => void assistPrompt()} title="优化提示词" className={cn('flex size-[30px] items-center justify-center rounded-full disabled:opacity-40', t.muted)}>{assisting ? <Loader2 className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}</button>
                  <button type="button" onClick={() => setPromptExpanded(true)} title="全屏编辑提示词" className={cn('flex size-[30px] items-center justify-center rounded-full', t.muted)}><Maximize2 className="size-4" /></button>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2 lg:flex-nowrap">
                  <Select
                    value={renderMode}
                    onChange={(value) => handleRenderModeChange(value as WorkbenchRenderMode)}
                    aria-label="出图模式"
                    optionLabelProp="label"
                    className={cn('h-10 min-w-0 flex-1 basis-[150px] sm:max-w-[190px]', t.selectTrigger)}
                    classNames={{ popup: { root: t.selectPopup } }}
                    options={[
                      { value: 'whole_floor_plan', label: '整屋户型', title: '整屋户型', desc: '锁定户型结构' },
                      { value: 'single_room_photo', label: '单间现场', title: '单间现场', desc: '现场图决定镜头' },
                    ].map((item) => ({ ...item, label: <span className="flex items-center gap-1.5"><Home className={cn('size-4', t.accent)} />{item.label}</span> }))}
                    suffixIcon={<Columns2 className={cn('size-4', t.accent)} />}
                  />
                  <span className={cn('hidden shrink-0 text-[11px] leading-4 xl:inline', t.muted)}>
                    {renderMode === 'single_room_photo' ? '现场图优先，不上传户型控制图' : '户型控制图锁定空间结构'}
                  </span>
                  {hasBoundFloorPlan && renderMode === 'whole_floor_plan' ? (
                  <Select
                    value={scopeSelection}
                    onChange={setScopeSelection}
                    placeholder="应用到哪里"
                    aria-label="应用到哪里"
                    optionLabelProp="title"
                    className={cn('h-10 min-w-0 flex-1 basis-[132px] sm:max-w-[168px]', t.selectTrigger)}
                    classNames={{ popup: { root: t.selectPopup } }}
                    options={scopeOptions}
                    suffixIcon={<Home className={cn('size-4', t.accent)} />}
                    popupRender={(menu) => (
                      <div>
                        {menu}
                        <div className={cn('border-t px-3 py-2 text-[11px] leading-4', dark ? 'border-white/10 text-[#8d8d94]' : 'border-[#e5e9e5] text-[#526052]')}>
                          只应用到当前选择，不自动为其他房间生成、不额外扣点。
                        </div>
                      </div>
                    )}
                  />
                  ) : null}
                  <Select
                    value={modelProfileId || undefined}
                    onChange={(value) => { setModelProfileId(value); applyModelDefaults(bootstrap.models.find((item) => item.id === value)); }}
                    placeholder="选择模型"
                    className={cn('h-10 min-w-0 flex-1 basis-[132px] sm:max-w-[168px]', t.selectTrigger)}
                    classNames={{ popup: { root: t.selectPopup } }}
                    options={bootstrap.models.map((item) => ({ value: item.id, label: item.name }))}
                    suffixIcon={<Bot className={cn('size-4', t.accent)} />}
                  />
                  <Select
                    value={String(count)}
                    onChange={(value) => setCount(Number(value))}
                    className={cn('h-10 w-[88px] shrink-0', t.selectTrigger)}
                    classNames={{ popup: { root: t.selectPopup } }}
                    options={[1, 2, 3, 4].map((value) => ({ value: String(value), label: `${value}张` }))}
                    suffixIcon={<Images className="size-4" />}
                  />
                  {resolutionTier !== 'CUSTOM' ? (
                    <Select
                      value={aspectRatio}
                      onChange={setAspectRatio}
                      className={cn('h-10 w-[88px] shrink-0', t.selectTrigger)}
                      classNames={{ popup: { root: t.selectPopup } }}
                      options={availableAspectRatios.map((item) => ({ value: item, label: item === 'auto' ? '自动比例' : item }))}
                      suffixIcon={<Crop className="size-4" />}
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
                    className={cn('h-10 w-[88px] shrink-0', t.selectTrigger)}
                    classNames={{ popup: { root: t.selectPopup } }}
                    options={(model?.resolutionTiers || []).map((item) => ({ value: item, label: item === 'CUSTOM' ? '自定义' : item }))}
                    suffixIcon={<Maximize2 className="size-4" />}
                  />
                  {resolutionTier === 'CUSTOM' && model?.supportsCustomSize ? (
                    <div className={cn('col-span-2 flex h-10 items-center justify-center gap-1 rounded-lg border px-2', t.selectBox)}>
                      <Input aria-label="自定义宽度" type="number" min={16} max={3840} step={16} value={customWidth} onChange={(event) => setCustomWidth(Number(event.target.value))} className="h-8 w-[76px] border-0 bg-transparent px-1 text-center text-sm shadow-none focus-visible:ring-0" />
                      <span className={cn('text-xs', t.muted)}>x</span>
                      <Input aria-label="自定义高度" type="number" min={16} max={3840} step={16} value={customHeight} onChange={(event) => setCustomHeight(Number(event.target.value))} className="h-8 w-[76px] border-0 bg-transparent px-1 text-center text-sm shadow-none focus-visible:ring-0" />
                    </div>
                  ) : null}
                  <button type="button" onClick={() => setTemplateOpen(true)} className={cn('flex h-10 min-w-0 flex-1 basis-[108px] items-center justify-center gap-1.5 rounded-lg border px-2 text-sm sm:max-w-[124px]', t.selectBox)}><PanelsTopLeft className="size-4 shrink-0" />提示词模板</button>
                  <button
                    type="button"
                    disabled={generating || retrying || currentBatchActive || !prompt.trim() || !modelProfileId || !hasEnabledPrice}
                    onClick={shouldRetryCurrentBatch ? () => { void retryCurrentBatch(); } : () => { void submitGeneration(); }}
                    className={cn('ml-0 flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-xl px-3 text-base text-white hover:brightness-110 disabled:cursor-not-allowed disabled:bg-[#6b6b6b] disabled:bg-none disabled:opacity-100 sm:ml-auto sm:w-[136px]', t.generate)}
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
      <Modal
        open={sitePhotoOpen}
        onCancel={() => setSitePhotoOpen(false)}
        title="选择客户现场图"
        width={820}
        className={t.modal}
        footer={(
          <div className="flex items-center justify-between gap-4">
            <span className={cn('text-xs', t.muted)}>
              已选 {selectedSitePhotoAssetIds.length}/{sitePhotoSelectionLimit} 张 · 现场图将决定生成视角
            </span>
            <div className="flex gap-2">
              <Button onClick={() => setSitePhotoOpen(false)}>取消</Button>
              <Button type="primary" className={t.primaryBtn} disabled={sitePhotosLoading || Boolean(sitePhotosError)} onClick={applyLeadSitePhotos}>
                使用所选现场图
              </Button>
            </div>
          </div>
        )}
      >
        <p className={cn('mb-4 text-sm leading-6', t.muted)}>
          来自当前客户档案。单间现场模式不会上传户型控制图，所选现场图负责镜头位置、方向、透视和构图。
        </p>
        {sitePhotosLoading ? (
          <div className={cn('flex h-52 items-center justify-center gap-2 rounded-xl', dark ? 'bg-white/[0.04] text-[#b3b3b3]' : 'bg-[#f6f8f6] text-[#526052]')}>
            <Loader2 className="size-5 animate-spin" />正在读取客户现场图
          </div>
        ) : sitePhotosError ? (
          <div className={cn('flex h-52 flex-col items-center justify-center gap-3 rounded-xl px-6 text-center', dark ? 'bg-red-500/10 text-red-200' : 'bg-red-50 text-red-700')}>
            <span>{sitePhotosError}</span>
            <Button onClick={() => void loadLeadSitePhotos()}>重新加载</Button>
          </div>
        ) : sitePhotos.length ? (
          <div className="grid max-h-[480px] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
            {sitePhotos.map((photo) => {
              const selected = selectedSitePhotoAssetIds.includes(photo.assetId);
              const disabled = !selected && selectedSitePhotoAssetIds.length >= sitePhotoSelectionLimit;
              return (
                <button
                  key={photo.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => toggleLeadSitePhoto(photo.assetId)}
                  className={cn(
                    'group relative overflow-hidden rounded-xl border text-left transition disabled:cursor-not-allowed disabled:opacity-45',
                    selected
                      ? dark ? 'border-[#8b72ff] bg-[#7047ff]/10' : 'border-[#16a34a] bg-[#e8f6ea]'
                      : dark ? 'border-white/10 bg-white/[0.035] hover:border-white/25' : 'border-[#e5e9e5] bg-white hover:border-[#9bd4a5]',
                  )}
                >
                  <div className={cn('aspect-[4/3] overflow-hidden', dark ? 'bg-[#111216]' : 'bg-[#eef3ee]')}>
                    <img src={photo.previewUrl} alt={`${photo.spaceTagLabel}现场图`} loading="lazy" className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]" />
                  </div>
                  <div className="flex min-w-0 items-center justify-between gap-2 px-3 py-2.5">
                    <span className="truncate text-sm font-medium">{photo.spaceTagLabel}</span>
                    {photo.width && photo.height ? <span className={cn('shrink-0 text-[10px]', t.muted)}>{photo.width}×{photo.height}</span> : null}
                  </div>
                  {selected ? (
                    <span className={cn('absolute right-2 top-2 flex size-6 items-center justify-center rounded-full text-white shadow-sm', dark ? 'bg-[#7047ff]' : 'bg-[#16a34a]')}>
                      <Check className="size-4" />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : (
          <div className={cn('flex h-52 flex-col items-center justify-center rounded-xl px-6 text-center', dark ? 'bg-white/[0.04]' : 'bg-[#f6f8f6]')}>
            <Images className={cn('mb-3 size-7', t.muted)} />
            <p className="text-sm font-medium">该客户还没有房屋现场图</p>
            <p className={cn('mt-1 text-xs', t.muted)}>可先使用工作台左侧上传按钮临时添加参考图。</p>
          </div>
        )}
      </Modal>
      <ImageEditorDialog imageUrl={editorGeneration?.imageUrl} open={Boolean(editorGeneration)} onOpenChange={(open) => !open && setEditorGeneration(null)} onUse={async (file, extraPrompt) => {
        const added = await uploadReferenceFiles([file], '已使用标注图片', 'additional_reference');
        if (added && extraPrompt) setPrompt((current) => current.trim() ? `${current.trim()}\n${extraPrompt}` : extraPrompt);
      }} />

      <Modal
        open={promptExpanded}
        onCancel={() => setPromptExpanded(false)}
        title="编辑提示词"
        width={768}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => { setPrompt(''); setNegativePrompt(''); }}>清空</Button>
            <Button type="primary" className={cn(dark ? '!bg-[#7047ff] hover:!bg-[#6034ee]' : '!bg-[#16a34a] hover:!bg-[#15803d]')} onClick={() => setPromptExpanded(false)}>完成</Button>
          </div>
        }
        className={dark ? '[&_.ant-modal-content]:bg-[#1b1c20] [&_.ant-modal-content]:text-white [&_.ant-modal-header]:bg-[#1b1c20] [&_.ant-modal-title]:text-white [&_.ant-modal-close]:text-white' : undefined}
      >
        <span className="sr-only">编辑本次生成使用的正向和负向提示词。</span>
        <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} className={cn('min-h-64 resize-none leading-6', dark ? 'border-white/10 bg-[#222328] text-white' : 'border-[#e5e9e5]')} />
        <div className="mt-4"><label className={cn('mb-2 block text-xs', t.muted)}>不希望出现的内容（可选）</label><Input.TextArea value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} className={cn('min-h-24 resize-none', dark ? 'border-white/10 bg-[#222328] text-white' : 'border-[#e5e9e5]')} /></div>
      </Modal>

      <Modal
        open={Boolean(previewGeneration)}
        onCancel={() => { setPreviewGeneration(null); setPreviewZoom(1); setPreviewRotation(0); setPreviewFullscreen(false); }}
        title={compareFloorPlan && floorPlanPreviewUrl ? '户型对照' : '生成结果预览'}
        footer={null}
        width={previewFullscreen ? '100vw' : '92vw'}
        style={previewFullscreen ? { top: 0, maxWidth: '100vw', paddingBottom: 0, margin: 0 } : { top: 24 }}
        styles={{
          body: { height: previewFullscreen ? 'calc(100dvh - 110px)' : 'calc(90vh - 110px)', padding: 12 },
          content: previewFullscreen ? { borderRadius: 0, height: '100dvh' } : undefined,
        }}
        className={cn(
          previewFullscreen ? '[&_.ant-modal]:!max-w-none [&_.ant-modal]:!w-full [&_.ant-modal]:!m-0 [&_.ant-modal]:!p-0' : undefined,
          dark ? '[&_.ant-modal-content]:bg-[#111216] [&_.ant-modal-content]:text-white [&_.ant-modal-header]:bg-[#111216] [&_.ant-modal-title]:text-white [&_.ant-modal-close]:text-white' : undefined,
        )}
      >
        <span className="sr-only">对照客户户型与 AI 效果图，或单独查看生成结果。</span>
        <div className="mb-3 flex items-center justify-end">
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
        </div>
        <div className={cn('h-full min-h-0', compareFloorPlan && floorPlanPreviewUrl ? 'grid grid-cols-2 gap-3' : 'flex items-center justify-center')}>
          {compareFloorPlan && floorPlanPreviewUrl ? (
            <figure className={cn('flex min-h-0 flex-col overflow-hidden rounded-lg border', dark ? 'border-white/10 bg-black' : 'border-[#e5e9e5] bg-black')}>
              <figcaption className={cn('shrink-0 px-3 py-2 text-xs', t.muted)}>客户户型 · {sourceFloorPlanName}</figcaption>
              <img src={floorPlanPreviewUrl} alt="客户户型对照图" className="min-h-0 w-full flex-1 object-contain" />
            </figure>
          ) : null}
          <figure className={cn('relative flex h-full min-h-0 w-full flex-col overflow-hidden', compareFloorPlan && floorPlanPreviewUrl ? cn('rounded-lg border', dark ? 'border-white/10 bg-black/40' : 'border-[#e5e9e5] bg-[#f6f8f6]') : cn('rounded-lg', dark ? 'bg-black/30' : 'bg-[#f6f8f6]'))}>
            {compareFloorPlan && floorPlanPreviewUrl ? <figcaption className={cn('shrink-0 px-3 py-2 text-xs', t.muted)}>AI 效果图</figcaption> : null}
            <div className="relative min-h-0 flex-1 overflow-hidden">
              {previewGeneration?.imageUrl ? <img src={previewGeneration.imageUrl} alt="生成结果大图" className="absolute inset-0 h-full w-full origin-center object-contain transition-transform duration-200" style={{ transform: `scale(${previewZoom}) rotate(${previewRotation}deg)` }} /> : null}
              {!compareFloorPlan || !floorPlanPreviewUrl ? (
                <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-white/10 bg-black/70 p-1.5 text-white shadow-xl backdrop-blur">
                  <Button size="small" type="text" className="text-white" title="放大图片" onClick={() => setPreviewZoom((value) => Math.min(3, value + 0.2))} icon={<Plus size={14} />} />
                  <Button size="small" type="text" className="text-white" title="缩小图片" onClick={() => setPreviewZoom((value) => Math.max(0.4, value - 0.2))} icon={<Minus size={14} />} />
                  <Button size="small" type="text" className="text-white" title="恢复原始比例" onClick={() => { setPreviewZoom(1); setPreviewRotation(0); }}>1:1</Button>
                  <Button size="small" type="text" className="text-white" title="顺时针旋转图片" onClick={() => setPreviewRotation((value) => value + 90)} icon={<RotateCw size={14} />} />
                  <Button size="small" type="text" className="text-white" title="全屏预览" onClick={() => setPreviewFullscreen((value) => !value)} icon={<Maximize2 size={14} />} />
                  {previewGeneration?.imageUrl ? <Button size="small" type="text" className="text-white" href={previewGeneration.imageUrl} download={`ai-workbench-${previewGeneration.id}.png`} title="下载图片" icon={<Download size={14} />} /> : null}
                </div>
              ) : null}
            </div>
          </figure>
        </div>
      </Modal>

      <Modal
        open={floorPlanOpen}
        onCancel={() => setFloorPlanOpen(false)}
        title={`客户户型 · ${sourceFloorPlanName}`}
        footer={null}
        width="92vw"
        style={{ top: 24 }}
        styles={{ body: { height: 'calc(90vh - 110px)', padding: 12 } }}
        className={dark ? '[&_.ant-modal-content]:bg-[#111216] [&_.ant-modal-content]:text-white [&_.ant-modal-header]:bg-[#111216] [&_.ant-modal-title]:text-white [&_.ant-modal-close]:text-white' : undefined}
      >
        <span className="sr-only">查看当前方案绑定的正式量房控制图，便于对照 AI 效果图结构。</span>
        <div className="mb-3 flex justify-end">
          {sourceFloorPlanId ? (
            <Link href={`/floorplans/${sourceFloorPlanId}`} target="_blank" rel="noopener noreferrer" className={cn('inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs', t.iconBtn)}>
              <ExternalLink className="size-3.5" />打开正式户型
            </Link>
          ) : null}
        </div>
        <div className="flex h-[calc(90vh-160px)] min-h-0 items-center justify-center overflow-hidden rounded-lg bg-black">
          {floorPlanPreviewUrl ? <img src={floorPlanPreviewUrl} alt="客户户型对照图大图" className="max-h-full max-w-full object-contain" /> : null}
        </div>
      </Modal>

      <Modal
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        title="新建方案对话"
        footer={
          <div className="flex justify-end gap-2">
            <Button className={t.iconBtn} onClick={() => setCreateOpen(false)}>取消</Button>
            <Button type="primary" disabled={creating || Boolean(eligibleFloorPlans.length && !createFloorPlanId)} className={cn(dark ? '!bg-[#7047ff] hover:!bg-[#6034ee]' : '!bg-[#16a34a] hover:!bg-[#15803d]')} onClick={() => void createConversation()}>{creating ? '创建中…' : '创建'}</Button>
          </div>
        }
        className={dark ? '[&_.ant-modal-content]:bg-[#1b1c20] [&_.ant-modal-content]:text-white [&_.ant-modal-header]:bg-[#1b1c20] [&_.ant-modal-title]:text-white [&_.ant-modal-close]:text-white' : undefined}
      >
        <span className="sr-only">为当前客户新建一个命名方案对话。未量房时以拍照参考图出图，已量房时关联合格正式户型。</span>
        <label className={cn('mb-1 block text-xs', t.muted)}>方案名称</label>
        <Input value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} placeholder="例如 灯光设计" className={t.input} />
        {eligibleFloorPlans.length ? (
          <>
            <label className={cn('mb-1 mt-4 block text-xs', t.muted)}>关联正式户型</label>
            <Select
              value={createFloorPlanId || undefined}
              onChange={setCreateFloorPlanId}
              placeholder="选择户型"
              className={cn('w-full', t.selectTrigger)}
              classNames={{ popup: { root: t.selectPopup } }}
              options={eligibleFloorPlans.map((plan) => ({ value: plan.id, label: plan.name || '正式户型' }))}
            />
          </>
        ) : (
          <p className={cn('mt-4 text-sm', t.muted)}>当前线索尚未完成量房。将按拍照方案出图，可上传现场照或户型图照片作为参考。</p>
        )}
      </Modal>

      <Modal
        open={finalizeOpen}
        onCancel={() => setFinalizeOpen(false)}
        title="设为定稿"
        footer={
          <div className="flex justify-end gap-2">
            <Button className={t.iconBtn} onClick={() => setFinalizeOpen(false)}>取消</Button>
            <Button
              type="primary"
              disabled={finalizingScheme}
              className={cn(dark ? '!bg-[#7047ff] hover:!bg-[#6034ee]' : '!bg-[#16a34a] hover:!bg-[#15803d]')}
              onClick={() => void finalizeScheme()}
            >
              {finalizingScheme ? '定稿中…' : '确认定稿'}
            </Button>
          </div>
        }
        className={dark ? '[&_.ant-modal-content]:bg-[#1b1c20] [&_.ant-modal-content]:text-white [&_.ant-modal-header]:bg-[#1b1c20] [&_.ant-modal-title]:text-white [&_.ant-modal-close]:text-white' : undefined}
      >
        <p className={cn('text-sm', t.muted)}>
          客户档案与方案册将优先展示「{detail?.publishedScheme?.title || detail?.workflow.title || '当前方案'}」。定稿后仍可继续出图和更新方案，直到您改指定稿或撤回该套方案。
        </p>
      </Modal>

      <Modal
        open={sendOpen}
        onCancel={() => setSendOpen(false)}
        title={detail?.publishedScheme ? '更新客户方案' : '发送给客户'}
        footer={
          <div className="flex justify-end gap-2">
            <Button className={t.iconBtn} onClick={() => setSendOpen(false)}>取消</Button>
            <Button
              type="primary"
              disabled={sendingScheme}
              className={cn(dark ? '!bg-[#7047ff] hover:!bg-[#6034ee]' : '!bg-[#16a34a] hover:!bg-[#15803d]')}
              onClick={() => void sendScheme()}
            >
              {sendingScheme ? '发送中…' : detail?.publishedScheme ? '确认更新' : '确认发送'}
            </Button>
          </div>
        }
        className={dark ? '[&_.ant-modal-content]:bg-[#1b1c20] [&_.ant-modal-content]:text-white [&_.ant-modal-header]:bg-[#1b1c20] [&_.ant-modal-title]:text-white [&_.ant-modal-close]:text-white' : undefined}
      >
        <p className={cn('mb-4 text-sm', t.muted)}>
          {detail?.publishedScheme
            ? `已确认且未选中的图保持不变，将加入/更新本次勾选的 ${selectedImageIds.length} 张效果图。`
            : `客户将在小程序项目里看到这一套方案，共 ${selectedImageIds.length} 张效果图。`}
        </p>
        {detail?.publishedScheme ? (
          <p className={cn('rounded-md border px-3 py-2 text-sm', dark ? 'border-white/10 bg-white/5' : 'border-[#e5e9e5] bg-[#f7faf7]')}>
            方案名称：<span className="font-medium">{detail.workflow.title}</span>
            <span className={cn('mt-1 block text-xs', t.muted)}>与顶部方案名称一致，如需修改请先在顶部重命名。</span>
          </p>
        ) : (
          <>
            <label className={cn('mb-1 block text-xs', t.muted)}>方案名称</label>
            <Input value={sendTitle} onChange={(event) => setSendTitle(event.target.value)} placeholder="方案名称，例如 灯光设计" className={t.input} />
          </>
        )}
      </Modal>
    </div>
    </ConfigProvider>
  );
}
