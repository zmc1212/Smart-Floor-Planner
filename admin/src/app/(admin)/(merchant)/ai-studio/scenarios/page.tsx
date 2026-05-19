'use client';

import { notify } from '@/components/ui/operation-feedback';
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowRight,
  CheckCircle,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  FolderPlus,
  Image as ImageIcon,
  Layers3,
  Loader2,
  PlayCircle,
  Phone,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import AiQuotaBar from '@/components/ai-studio/AiQuotaBar';
import RechargeDialog from '@/components/ai-studio/RechargeDialog';
import ImageCropperDialog from '@/components/ai-studio/ImageCropperDialog';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { useFetch } from '@/hooks/useFetch';
import {
  ADVANCED_WORKFLOW_TOOLS,
  MAIN_WORKFLOW_STAGES,
  type AiWorkflowSourceAssetRole,
  type AiWorkflowStageKey,
  getWorkflowStageDefinition,
} from '@/lib/ai/workflow-stages';
import {
  AI_WORKFLOW_DEMO_CASES,
  getAiWorkflowDemoCaseById,
  type AiWorkflowDemoCase,
  type AiWorkflowDemoGeneration,
} from '@/lib/ai/workflow-demo';

interface AiPreset {
  _id: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  previewClassName: string;
  enabled: boolean;
  sortOrder: number;
  workflowCategory?: 'main' | 'advanced';
  workflowStage?: AiWorkflowStageKey;
  sourceAssetRole?: AiWorkflowSourceAssetRole;
  nextRecommendedStage?: AiWorkflowStageKey;
  image?: {
    mode: string;
  };
}

interface AiQuotaData {
  tier: string;
  usedCount: number;
  monthlyLimit: number;
  bonusCredits: number;
  remaining: number;
  balance?: number;
  currency?: string;
  keyStatus?: string;
  allowedModels?: string[];
  lastSyncedAt?: string;
}

interface WorkflowGeneration {
  id: string;
  leadId?: string;
  workflowId?: string;
  parentGenerationId?: string;
  type: string;
  stageKey?: AiWorkflowStageKey;
  stageLabel?: string;
  sourceAssetRole?: AiWorkflowSourceAssetRole;
  isSelectedBaseline: boolean;
  nextRecommendedStage?: AiWorkflowStageKey;
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  input?: {
    customPrompt?: string;
    styleReferenceImage?: string;
  };
  output?: {
    imageUrl?: string;
    promptUsed?: string;
  };
  errorMessage?: string;
  createdAt: string;
}

interface WorkflowSummary {
  id: string;
  leadId?: string;
  title: string;
  workflowLabel?: string;
  isPrimary: boolean;
  status: 'active' | 'archived';
  sourceImage?: string;
  sourceFloorPlanId?: string;
  sourceAssetRole: AiWorkflowSourceAssetRole;
  currentStageKey: AiWorkflowStageKey;
  currentStageLabel?: string;
  selectedGenerationId?: string;
  lastGenerationId?: string;
  createdAt: string;
  updatedAt: string;
  generationCount: number;
  latestGeneration?: WorkflowGeneration;
}

interface WorkflowLeadFloorPlan {
  id: string;
  name?: string;
  layoutData?: unknown;
  createdAt?: string;
  status?: string;
}

interface WorkflowLeadSummary {
  id: string;
  name: string;
  phone: string;
  status: string;
  stylePreference?: string;
  communityName?: string;
  floorPlans: WorkflowLeadFloorPlan[];
  workflowCount: number;
  latestWorkflowId?: string;
  latestWorkflowTitle?: string;
  latestWorkflowUpdatedAt?: string;
  followUpCount: number;
}

interface WorkflowDetail {
  workflow: WorkflowSummary;
  lead: WorkflowLeadSummary;
  generations: WorkflowGeneration[];
}

interface FloorPlanRoom {
  id?: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  polygon?: Array<{ x: number; y: number }>;
  polygonClosed?: boolean;
  openings?: Array<{
    id: string;
    type: 'DOOR' | 'WINDOW';
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  }>;
}

const SOURCE_ROLE_OPTIONS: Array<{
  value: AiWorkflowSourceAssetRole;
  label: string;
  hint: string;
}> = [
  { value: 'rough_sketch', label: '手稿 / 毛坯图', hint: '适合选风格、出首轮方向。' },
  { value: 'floor_plan', label: '户型图 / 量房图', hint: '优先复用当前线索下的户型素材。' },
  { value: 'concept_element', label: '概念元素图', hint: '适合高级提案工具。' },
];

function formatTime(value?: string) {
  if (!value) return '--';
  return new Date(value).toLocaleString('zh-CN');
}

function getGenerationPrompt(generation?: WorkflowGeneration | null) {
  return generation?.output?.promptUsed || generation?.input?.customPrompt || '';
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function compressImageFile(file: File) {
  const dataUrl = await readFileAsDataUrl(file);

  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      const maxSide = 1600;
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        resolve(dataUrl);
        return;
      }

      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.84));
    };
    image.onerror = reject;
    image.src = dataUrl;
  });
}

async function readJsonResponse(res: Response) {
  try {
    return await res.json();
  } catch {
    return { success: false, error: '服务响应异常' };
  }
}

function getRoomsFromLayoutData(layoutData?: unknown): FloorPlanRoom[] {
  if (!layoutData) return [];
  if (Array.isArray(layoutData)) return layoutData as FloorPlanRoom[];
  if (
    typeof layoutData === 'object' &&
    layoutData !== null &&
    'rooms' in layoutData &&
    Array.isArray((layoutData as { rooms?: FloorPlanRoom[] }).rooms)
  ) {
    return (layoutData as { rooms?: FloorPlanRoom[] }).rooms || [];
  }
  return [];
}

function DemoWorkflowShowcase({
  demo,
  onClose,
  onCopyPrompt,
}: {
  demo: AiWorkflowDemoCase;
  onClose: () => void;
  onCopyPrompt: (generation?: AiWorkflowDemoGeneration | null) => Promise<void>;
}) {
  const getDemoGenerationForStage = (stageKey: AiWorkflowStageKey) =>
    demo.generations.find((generation) => generation.stageKey === stageKey);

  const sourceTimelineCard = (
    <div key={`${demo.id}-source`} className="rounded-[24px] border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-black">起点素材</div>
            <Badge className="rounded-full border-none bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-700">
              演示毛坯图
            </Badge>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">{formatTime(demo.workflow.createdAt)}</div>
        </div>
      </div>
      <PhotoView src={demo.workflow.sourceImage}>
        <img
          src={demo.workflow.sourceImage}
          alt={`${demo.name} 起点素材`}
          className="mt-4 h-48 w-full cursor-zoom-in rounded-[20px] object-cover"
        />
      </PhotoView>
      <div className="mt-4 text-xs leading-5 text-muted-foreground">
        这张图是演示工作流的起点。后续每一步都围绕同一空间结构继续推进，专门用来展示“顺序式工作流”的关联感。
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-[32px] border border-amber-200 bg-[linear-gradient(135deg,rgba(251,191,36,0.14),rgba(255,255,255,1))] shadow-sm">
        <div className="grid gap-6 p-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-4">
            <Badge className="rounded-full border-none bg-amber-500 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white">
              Demo Workflow
            </Badge>
            <div>
              <h2 className="text-[28px] font-black tracking-tight">{demo.name}</h2>
              <p className="mt-2 text-base font-medium text-zinc-700">{demo.tagline}</p>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{demo.summary}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
                <div className="text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground">演示客户</div>
                <div className="mt-2 text-sm font-bold">{demo.lead.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">{demo.lead.communityName}</div>
              </div>
              <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
                <div className="text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground">当前阶段</div>
                <div className="mt-2 text-sm font-bold">
                  {getWorkflowStageDefinition(demo.workflow.currentStageKey)?.name || demo.workflow.currentStageKey}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{demo.generations.length} 个演示节点</div>
              </div>
              <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
                <div className="text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground">替换提示</div>
                <div className="mt-2 text-sm font-bold">本地图可替换</div>
                <div className="mt-1 text-xs text-muted-foreground">改 `workflow-demo.ts` 即可</div>
              </div>
            </div>
            <div className="rounded-[24px] border border-amber-200 bg-white/90 p-4 text-sm leading-6 text-zinc-700">
              {demo.attraction}
            </div>
            <div className="rounded-[24px] border border-zinc-200 bg-white p-4 text-xs leading-5 text-muted-foreground">
              {demo.replaceHint}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button className="rounded-2xl bg-zinc-950 text-white hover:bg-zinc-800" onClick={onClose}>
                回到真实工作流
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
              <div className="border-b border-zinc-100 px-6 py-4">
                <div className="flex items-center gap-2 text-sm font-bold">
                  <ImageIcon size={16} className="text-muted-foreground" /> 演示起点素材
                </div>
              </div>
              <div className="grid gap-4 p-6 lg:grid-cols-[260px_minmax(0,1fr)]">
                <PhotoView src={demo.workflow.sourceImage}>
                  <img
                    src={demo.workflow.sourceImage}
                    alt={`${demo.name} 来源图`}
                    className="h-52 w-full cursor-zoom-in rounded-[24px] object-cover"
                  />
                </PhotoView>
                <div className="space-y-3">
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground">来源角色</div>
                    <div className="mt-2 text-sm font-medium">{demo.workflow.sourceAssetRole}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground">演示会话</div>
                    <div className="mt-2 text-sm font-medium">{demo.workflow.title}</div>
                  </div>
                  <div className="text-sm leading-6 text-muted-foreground">
                    你后续可以把这张图替换成 gpt-image-1 或 Nano Banana 生成的真实毛坯图，让演示更像正式产品案例。
                  </div>
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
              <div className="border-b border-zinc-100 px-6 py-4">
                <div className="flex items-center gap-2 text-sm font-bold">
                  <Clock size={16} className="text-muted-foreground" /> 演示时间线
                </div>
              </div>
              <div className="max-h-[600px] space-y-4 overflow-y-auto p-4">
                {sourceTimelineCard}
                {demo.generations.map((generation) => (
                  <div key={generation.id} className="rounded-[24px] border border-zinc-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-black">
                            {getWorkflowStageDefinition(generation.stageKey)?.name || generation.stageKey}
                          </div>
                          {generation.isSelectedBaseline ? (
                            <Badge className="rounded-full border-none bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                              当前定稿
                            </Badge>
                          ) : null}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">{formatTime(generation.createdAt)}</div>
                      </div>
                    </div>
                    {generation.output?.imageUrl ? (
                      <PhotoView src={generation.output.imageUrl}>
                        <img
                          src={generation.output.imageUrl}
                          alt={generation.stageKey}
                          className="mt-4 h-48 w-full cursor-zoom-in rounded-[20px] object-cover"
                        />
                      </PhotoView>
                    ) : null}
                    <div className="mt-4 flex flex-wrap gap-3">
                      <Button variant="outline" className="rounded-2xl" onClick={() => onCopyPrompt(generation)}>
                        <Copy size={14} className="mr-2" />
                        复制提示词
                      </Button>
                      {generation.output?.imageUrl ? (
                        <Button
                          variant="ghost"
                          className="rounded-2xl"
                          onClick={() => window.open(generation.output?.imageUrl, '_blank')}
                        >
                          <ExternalLink size={14} className="mr-2" />
                          查看产物
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
            <Sparkles size={18} />
          </div>
          <div>
            <h3 className="text-lg font-black">演示步骤总览</h3>
            <p className="text-sm text-muted-foreground">
              直接把一条完整的演示链路摆在首页，帮助用户一眼看懂每一步的价值。
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {MAIN_WORKFLOW_STAGES.map((stage, index) => {
            const latestGeneration = getDemoGenerationForStage(stage.key);

            return (
              <div key={stage.key} className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
                <div className="grid gap-0 lg:grid-cols-[1.2fr_0.8fr]">
                  <div className="p-6">
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          'flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-black text-white',
                          index === 0 && 'bg-gradient-to-br from-blue-500 to-indigo-600',
                          index === 1 && 'bg-gradient-to-br from-zinc-700 to-slate-500',
                          index === 2 && 'bg-gradient-to-br from-emerald-500 to-teal-500',
                          index === 3 && 'bg-gradient-to-br from-rose-500 to-pink-500',
                          index === 4 && 'bg-gradient-to-br from-amber-500 to-indigo-700'
                        )}
                      >
                        {index + 1}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-lg font-black">{stage.name}</h4>
                          {demo.workflow.currentStageKey === stage.key ? (
                            <Badge className="rounded-full border-none bg-zinc-950 px-2.5 py-1 text-[11px] font-bold text-white">
                              演示推进到这里
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-sm text-muted-foreground">{stage.description}</p>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-3 md:grid-cols-3">
                      <div className="rounded-2xl bg-zinc-50 p-4">
                        <div className="text-xs font-black uppercase tracking-[0.16em] text-zinc-400">选择户型图</div>
                        <div className="mt-2 text-sm font-medium">{stage.inputHint}</div>
                      </div>
                      <div className="rounded-2xl bg-zinc-50 p-4">
                        <div className="text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground">当前产物</div>
                        <div className="mt-2 text-sm font-medium">{latestGeneration ? stage.outputHint : '尚未演示'}</div>
                      </div>
                      <div className="rounded-2xl bg-zinc-50 p-4">
                        <div className="text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground">推荐下一步</div>
                        <div className="mt-2 text-sm font-medium">
                          {stage.nextRecommendedStage
                            ? getWorkflowStageDefinition(stage.nextRecommendedStage)?.name
                            : '流程结束'}
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 flex flex-wrap items-center gap-3">
                      <Button variant="outline" className="rounded-2xl" onClick={() => onCopyPrompt(latestGeneration)}>
                        <Copy size={14} className="mr-2" />
                        复制提示词
                      </Button>
                      {latestGeneration?.output?.imageUrl ? (
                        <Button
                          variant="ghost"
                          className="rounded-2xl"
                          onClick={() => window.open(latestGeneration.output?.imageUrl, '_blank')}
                        >
                          <ExternalLink size={14} className="mr-2" />
                          查看产物
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <div className="border-t border-zinc-100 bg-zinc-50 p-6 lg:border-l lg:border-t-0">
                    {latestGeneration?.output?.imageUrl ? (
                      <div className="space-y-3">
                        <PhotoView src={latestGeneration.output.imageUrl}>
                          <img
                            src={latestGeneration.output.imageUrl}
                            alt={stage.name}
                            className="h-56 w-full cursor-zoom-in rounded-[24px] object-cover shadow-sm"
                          />
                        </PhotoView>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{latestGeneration.isSelectedBaseline ? '当前定稿' : '演示产物'}</span>
                          <span>{formatTime(latestGeneration.createdAt)}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-[24px] border border-dashed border-zinc-200 bg-white text-center text-sm text-muted-foreground">
                        <Layers3 size={20} className="mb-3 text-zinc-400" />
                        <p>这个步骤还没放演示图。</p>
                        <p className="mt-1 max-w-[220px] text-xs leading-5">
                          你后面可以把这一步的本地成图换进来，让整条演示链更完整。
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AiScenariosPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialLeadId = searchParams.get('leadId');
  const initialWorkflowId = searchParams.get('workflowId');
  const initialDemoId = searchParams.get('demo');

  const { data: quota, mutate: mutateQuota, isLoading: quotaLoading } = useFetch<AiQuotaData>('/api/ai/quota');
  const { data: presetsData } = useFetch<AiPreset[]>('/api/ai/presets?type=scenario');
  const { data: leadsData, mutate: mutateLeads, isLoading: leadsLoading } =
    useFetch<WorkflowLeadSummary[]>('/api/ai/workflow-leads?limit=50');

  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(initialLeadId);
  const [selectedDemoId, setSelectedDemoId] = useState<string | null>(initialDemoId);
  const workflowsUrl = selectedLeadId ? `/api/ai/workflows?leadId=${selectedLeadId}&limit=20` : null;
  const {
    data: workflowsData,
    mutate: mutateWorkflows,
    isLoading: workflowsLoading,
  } = useFetch<WorkflowSummary[]>(workflowsUrl);

  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(initialWorkflowId);
  const {
    data: workflowDetail,
    mutate: mutateWorkflowDetail,
    isLoading: workflowDetailLoading,
  } = useFetch<WorkflowDetail>(selectedWorkflowId ? `/api/ai/workflows/${selectedWorkflowId}` : null);

  const [workflowLabel, setWorkflowLabel] = useState('');
  const [sourceMode, setSourceMode] = useState<'floor_plan' | 'upload'>('floor_plan');
  const [sourceFloorPlanId, setSourceFloorPlanId] = useState('');
  const [sourceImage, setSourceImage] = useState('');
  const [sourceAssetRole, setSourceAssetRole] = useState<AiWorkflowSourceAssetRole>('floor_plan');
  const [creatingWorkflow, setCreatingWorkflow] = useState(false);
  const [runningPresetKey, setRunningPresetKey] = useState<string | null>(null);
  const [showRecharge, setShowRecharge] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mockImageInputRef = useRef<HTMLInputElement>(null);
  const [mockingStage, setMockingStage] = useState<AiWorkflowStageKey | null>(null);

  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [cropImageUrl, setCropImageUrl] = useState('');
  const [pendingPreset, setPendingPreset] = useState<AiPreset | null>(null);

  const leads = useMemo(() => leadsData || [], [leadsData]);
  const selectedDemo = useMemo(() => getAiWorkflowDemoCaseById(selectedDemoId), [selectedDemoId]);
  const selectedLead = useMemo(
    () => leads.find((lead) => lead.id === selectedLeadId) || workflowDetail?.lead || null,
    [leads, selectedLeadId, workflowDetail?.lead]
  );
  const workflows = useMemo(
    () => [...(workflowsData || [])].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [workflowsData]
  );
  const presets = useMemo(
    () =>
      [...(presetsData || [])]
        .filter((preset) => preset.enabled)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [presetsData]
  );

  const presetByStage = useMemo(() => {
    const entries = new Map<AiWorkflowStageKey, AiPreset>();
    presets.forEach((preset) => {
      if (preset.workflowStage && preset.workflowCategory === 'main' && !entries.has(preset.workflowStage)) {
        entries.set(preset.workflowStage, preset);
      }
    });
    return entries;
  }, [presets]);

  const advancedPresets = useMemo(
    () => presets.filter((preset) => preset.workflowCategory === 'advanced'),
    [presets]
  );

  useEffect(() => {
    if (initialLeadId) {
      setSelectedLeadId(initialLeadId);
    }
  }, [initialLeadId]);

  useEffect(() => {
    if (initialDemoId) {
      setSelectedDemoId(initialDemoId);
    }
  }, [initialDemoId]);

  useEffect(() => {
    if (initialWorkflowId) {
      setSelectedWorkflowId(initialWorkflowId);
    }
  }, [initialWorkflowId]);

  useEffect(() => {
    if (!selectedLeadId) {
      setSelectedWorkflowId(null);
      return;
    }

    if (!workflows.length) {
      setSelectedWorkflowId(null);
      return;
    }

    if (initialWorkflowId && workflows.some((workflow) => workflow.id === initialWorkflowId)) {
      setSelectedWorkflowId(initialWorkflowId);
      return;
    }

    if (!selectedWorkflowId || !workflows.some((workflow) => workflow.id === selectedWorkflowId)) {
      setSelectedWorkflowId(workflows[0].id);
    }
  }, [initialWorkflowId, selectedLeadId, selectedWorkflowId, workflows]);

  useEffect(() => {
    if (selectedLead?.floorPlans?.length && !sourceFloorPlanId) {
      setSourceFloorPlanId(selectedLead.floorPlans[0].id);
    }
  }, [selectedLead?.floorPlans, sourceFloorPlanId]);

  const selectedWorkflow =
    workflowDetail?.workflow || workflows.find((item) => item.id === selectedWorkflowId) || null;
  const generations = useMemo(() => workflowDetail?.generations || [], [workflowDetail?.generations]);

  const selectedBaseline = useMemo(
    () =>
      generations.find((generation) => generation.isSelectedBaseline) ||
      (selectedWorkflow?.selectedGenerationId
        ? generations.find((generation) => generation.id === selectedWorkflow.selectedGenerationId)
        : undefined),
    [generations, selectedWorkflow?.selectedGenerationId]
  );

  const getLatestGenerationForStage = (stageKey: AiWorkflowStageKey) =>
    generations.find((generation) => generation.stageKey === stageKey);

  const resolveParentGenerationId = (stageKey?: AiWorkflowStageKey) => {
    if (!stageKey) return undefined;
    if (stageKey === 'direction' || stageKey === 'premium_board' || stageKey === 'perspective_upgrade') {
      return undefined;
    }
    if (stageKey === 'base_render') {
      return getLatestGenerationForStage('direction')?.id;
    }
    if (stageKey === 'soft_furnishing') {
      return selectedBaseline?.id || getLatestGenerationForStage('base_render')?.id;
    }
    return (
      selectedBaseline?.id ||
      getLatestGenerationForStage('soft_furnishing')?.id ||
      getLatestGenerationForStage('base_render')?.id
    );
  };

  const canRunStage = (stageKey?: AiWorkflowStageKey, role?: AiWorkflowSourceAssetRole) => {
    if (!selectedWorkflow) {
      return false;
    }

    if (stageKey === 'direction' || stageKey === 'base_render') {
      return Boolean(selectedWorkflow.sourceImage || selectedWorkflow.sourceFloorPlanId);
    }

    if (stageKey === 'premium_board') {
      return Boolean(
        (selectedWorkflow.sourceImage || selectedWorkflow.sourceFloorPlanId) && role === 'concept_element'
      );
    }

    if (stageKey === 'perspective_upgrade') {
      return Boolean(selectedWorkflow.sourceImage || selectedWorkflow.sourceFloorPlanId);
    }

    return Boolean(resolveParentGenerationId(stageKey));
  };

  const handleLeadChange = (leadId: string | null) => {
    setSelectedDemoId(null);
    setSelectedLeadId(leadId);
    setSelectedWorkflowId(null);
    setSourceImage('');
    setSourceFloorPlanId('');
    router.replace(leadId ? `/ai-studio/scenarios?leadId=${leadId}` : '/ai-studio/scenarios');
  };

  const handleDemoChange = (demoId: string | null) => {
    setSelectedDemoId(demoId);
    if (demoId) {
      setSelectedLeadId(null);
      setSelectedWorkflowId(null);
      router.replace(`/ai-studio/scenarios?demo=${demoId}`);
      return;
    }

    router.replace('/ai-studio/scenarios');
  };

  const handleSelectFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      notify.error('图片大小不能超过 10MB');
      return;
    }

    try {
      const compressed = await compressImageFile(file);
      setSourceImage(compressed);
    } catch (error) {
      console.error(error);
      notify.error('图片读取失败，请重试');
    }
  };

  const handleCreateWorkflow = async () => {
    if (!selectedLead) {
      notify.error('请先选择一条客户线索');
      return;
    }

    let payloadSourceImage = sourceImage;
    let payloadSourceFloorPlanId: string | undefined;
    let payloadRole = sourceAssetRole;

    if (sourceMode === 'floor_plan') {
      const floorPlan = selectedLead.floorPlans.find((item) => item.id === sourceFloorPlanId);
      if (!floorPlan) {
        notify.error('请先选择当前线索下的户型图');
        return;
      }

      const rooms = getRoomsFromLayoutData(floorPlan.layoutData);
      if (!rooms.length) {
        notify.error('当前户型缺少 layoutData，无法生成方案来源图');
        return;
      }

      try {
        const { generateBaseMap } = await import('@/lib/canvasExport');
        payloadSourceImage = await generateBaseMap(rooms);
        payloadSourceFloorPlanId = floorPlan.id;
        payloadRole = 'floor_plan';
      } catch (error) {
        console.error(error);
        notify.error('户型图转换失败，请稍后重试');
        return;
      }
    } else if (!payloadSourceImage) {
      notify.error('请上传一张参考图');
      return;
    }

    setCreatingWorkflow(true);
    try {
      const res = await fetch('/api/ai/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: selectedLead.id,
          workflowLabel: workflowLabel.trim() || undefined,
          sourceImage: payloadSourceImage,
          sourceFloorPlanId: payloadSourceFloorPlanId,
          sourceAssetRole: payloadRole,
        }),
      });
      const json = await readJsonResponse(res);

      if (!res.ok || !json.success) {
        notify.fromAlert(json.error || '创建方案会话失败');
        return;
      }

      setWorkflowLabel('');
      setSourceImage('');
      setSourceFloorPlanId(selectedLead.floorPlans[0]?.id || '');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      setSelectedWorkflowId(json.data.id);
      await Promise.all([mutateWorkflows(), mutateWorkflowDetail(), mutateLeads(), mutateQuota()]);
      notify.success('方案会话已创建，并已绑定到当前客户线索');
    } catch (error) {
      console.error(error);
      notify.error('网络异常，请稍后重试');
    } finally {
      setCreatingWorkflow(false);
    }
  };

  const executePresetGeneration = async (preset: AiPreset, styleReferenceImage?: string) => {
    setRunningPresetKey(preset.key);
    const loadingId = notify.loading(`正在执行 ${preset.name}...`);

    try {
      const generateRes = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'scenario',
          style: preset.key,
          mode: preset.image?.mode || 'generation',
          workflowId: selectedWorkflow!.id,
          stageKey: preset.workflowStage,
          parentGenerationId: resolveParentGenerationId(preset.workflowStage),
          sourceAssetRole: preset.sourceAssetRole,
          styleReferenceImage,
        }),
      });
      const generateJson = await readJsonResponse(generateRes);

      if (!generateRes.ok || !generateJson.success) {
        notify.dismiss(loadingId);
        if (generateRes.status === 402) {
          setShowRecharge(true);
        }
        notify.fromAlert(generateJson.error || '场景任务初始化失败');
        return;
      }

      const renderRes = await fetch('/api/ai/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generationId: generateJson.data.id,
          prompt: generateJson.data.prompt,
          negativePrompt: generateJson.data.negativePrompt,
        }),
      });
      const renderJson = await readJsonResponse(renderRes);

      notify.dismiss(loadingId);

      if (!renderRes.ok || !renderJson.success) {
        if (renderRes.status === 402) {
          setShowRecharge(true);
        }
        notify.fromAlert(renderJson.error || '生成失败');
        return;
      }

      await Promise.all([mutateWorkflowDetail(), mutateWorkflows(), mutateLeads(), mutateQuota()]);
      notify.success(`${preset.name} 已完成，并关联到当前客户线索`);
    } catch (error) {
      console.error(error);
      notify.dismiss(loadingId);
      notify.error('网络异常，请稍后重试');
    } finally {
      setRunningPresetKey(null);
    }
  };

  const handleRunPreset = async (preset: AiPreset) => {
    if (!selectedWorkflow) {
      notify.error('请先选择一个方案会话');
      return;
    }

    if (!canRunStage(preset.workflowStage, preset.sourceAssetRole)) {
      notify.info('当前步骤缺少来源产物，请先完成前一阶段或先设为当前定稿');
      return;
    }

    if (preset.workflowStage === 'base_render') {
      const parentGenId = resolveParentGenerationId(preset.workflowStage);
      const parentGen = generations.find(g => g.id === parentGenId);
      if (parentGen && parentGen.stageKey === 'direction' && parentGen.output?.imageUrl) {
        setCropImageUrl(parentGen.output.imageUrl);
        setPendingPreset(preset);
        setCropDialogOpen(true);
        return;
      }
    }

    await executePresetGeneration(preset);
  };

  const handleCropComplete = async (croppedDataUrl: string) => {
    if (!pendingPreset) return;
    await executePresetGeneration(pendingPreset, croppedDataUrl);
    setPendingPreset(null);
  };

  const handleMockImageSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !mockingStage || !selectedWorkflow) {
      setMockingStage(null);
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      notify.error('图片大小不能超过 10MB');
      setMockingStage(null);
      return;
    }

    const loadingId = notify.loading(`正在上传 ${getWorkflowStageDefinition(mockingStage)?.name} 的测试图...`);

    try {
      const compressed = await compressImageFile(file);
      const res = await fetch(`/api/ai/workflows/${selectedWorkflow.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'mock-generation',
          stageKey: mockingStage,
          imageUrl: compressed,
          parentGenerationId: resolveParentGenerationId(mockingStage),
          sourceAssetRole: presetByStage.get(mockingStage)?.sourceAssetRole,
          nextStageKey: presetByStage.get(mockingStage)?.nextRecommendedStage,
        }),
      });
      const json = await readJsonResponse(res);

      notify.dismiss(loadingId);

      if (!res.ok || !json.success) {
        notify.fromAlert(json.error || '上传测试图失败');
        return;
      }

      await Promise.all([mutateWorkflowDetail(), mutateWorkflows()]);
      notify.success('测试图已上传并设为该步骤产物');
    } catch (error) {
      console.error(error);
      notify.dismiss(loadingId);
      notify.error('网络异常，请稍后重试');
    } finally {
      if (mockImageInputRef.current) {
        mockImageInputRef.current.value = '';
      }
      setMockingStage(null);
    }
  };

  const handleSelectBaseline = async (generation: WorkflowGeneration) => {
    if (!selectedWorkflow) return;

    try {
      const res = await fetch(`/api/ai/workflows/${selectedWorkflow.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'select-generation',
          generationId: generation.id,
          nextStageKey: generation.nextRecommendedStage,
        }),
      });
      const json = await readJsonResponse(res);

      if (!res.ok || !json.success) {
        notify.fromAlert(json.error || '设为当前定稿失败');
        return;
      }

      await Promise.all([mutateWorkflowDetail(), mutateWorkflows()]);
      notify.success('已设为当前定稿，可继续进入下一步');
    } catch (error) {
      console.error(error);
      notify.error('网络异常，请稍后重试');
    }
  };

  const handleSetStage = async (stageKey?: AiWorkflowStageKey) => {
    if (!selectedWorkflow || !stageKey) return;

    try {
      const res = await fetch(`/api/ai/workflows/${selectedWorkflow.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set-stage',
          stageKey,
        }),
      });
      const json = await readJsonResponse(res);

      if (!res.ok || !json.success) {
        notify.fromAlert(json.error || '切换步骤失败');
        return;
      }

      await Promise.all([mutateWorkflowDetail(), mutateWorkflows()]);
    } catch (error) {
      console.error(error);
      notify.error('网络异常，请稍后重试');
    }
  };

  const handleCopyPrompt = async (generation?: WorkflowGeneration | null) => {
    const prompt = getGenerationPrompt(generation);
    if (!prompt) {
      notify.info('这一步暂时还没有可复制的提示词');
      return;
    }

    try {
      await navigator.clipboard.writeText(prompt);
      notify.success('提示词已复制到剪贴板');
    } catch (error) {
      console.error(error);
      notify.error('复制失败，请重试');
    }
  };

  return (
    <PhotoProvider>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.12),_transparent_30%),linear-gradient(180deg,#fffdf7_0%,#ffffff_46%,#fcfcfc_100%)] text-[#171717]">
      <main className="mx-auto max-w-[1500px] px-6 py-8">
        <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <Badge className="w-fit rounded-full border-none bg-amber-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-amber-700">
              AI Design Workflow
            </Badge>
            <div>
              <h1 className="text-[30px] font-black tracking-tight">AI 家装签单工作流</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                先选一条分配给设计师的客户线索，再按“选风格 → 出基准方案 → 深化软装 → 生成提案 → 增强签单”顺序推进。
              </p>
            </div>
          </div>
          <div className="lg:max-w-xl lg:flex-1">
            <AiQuotaBar quota={quota} loading={quotaLoading} onRecharge={() => setShowRecharge(true)} />
          </div>
        </div>

        <div className="mb-6 overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-100 px-6 py-4">
            <div className="flex items-center gap-2 text-sm font-bold">
              <PlayCircle size={16} className="text-amber-600" /> 演示工作流
                </div>
              </div><div className="grid gap-4 p-6 lg:grid-cols-2">
            {AI_WORKFLOW_DEMO_CASES.map((demo) => {
              const isActive = selectedDemo?.id === demo.id;
              return (
                <button
                  key={demo.id}
                  type="button"
                  onClick={() => handleDemoChange(demo.id)}
                  className={cn(
                    'overflow-hidden rounded-[28px] border text-left transition',
                    isActive
                      ? 'border-zinc-950 bg-zinc-950 text-white'
                      : 'border-zinc-200 bg-zinc-50 hover:border-zinc-300 hover:bg-white'
                  )}
                >
                  <div className="grid gap-0 md:grid-cols-[220px_minmax(0,1fr)]">
                    <PhotoView src={demo.workflow.sourceImage}>
                      <img
                        src={demo.workflow.sourceImage}
                        alt={demo.name}
                        className="h-full min-h-[180px] w-full cursor-zoom-in object-cover"
                      />
                    </PhotoView>
                    <div className="space-y-3 p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-base font-black">{demo.name}</div>
                        {isActive ? (
                          <Badge className="rounded-full border-none bg-white/15 text-white">演示中</Badge>
                        ) : (
                                  <Badge variant="outline" className="rounded-full bg-zinc-100 font-bold">
                                    主方案
                                  </Badge>
                        )}
                      </div>
                      <div className={cn('text-sm font-medium', isActive ? 'text-zinc-200' : 'text-zinc-700')}>
                        {demo.tagline}
                      </div>
                      <div className={cn('text-sm leading-6', isActive ? 'text-zinc-300' : 'text-muted-foreground')}>
                        {demo.summary}
                      </div>
                      <div className={cn('text-xs leading-5', isActive ? 'text-zinc-400' : 'text-muted-foreground')}>
                        {demo.replaceHint}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {selectedDemo ? (
          <DemoWorkflowShowcase
            demo={selectedDemo}
            onClose={() => handleDemoChange(null)}
            onCopyPrompt={handleCopyPrompt}
          />
        ) : (
          <>

        <div className="mb-6 rounded-[28px] border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">当前客户线索</div>
              <div className="mt-2 flex flex-wrap gap-3">
                {leadsLoading ? (
                  <div className="text-sm text-muted-foreground">
                    <Loader2 className="mr-2 inline animate-spin" size={14} />
                    正在线索中同步可发起方案的客户...
                  </div>
                ) : leads.length === 0 ? (
                  <div className="text-sm text-muted-foreground">暂无可用线索，需要先给当前设计师分配客户线索。</div>
                ) : (
                  leads.map((lead) => (
                    <button
                      key={lead.id}
                      type="button"
                      onClick={() => handleLeadChange(lead.id)}
                      className={cn(
                        'rounded-2xl border px-4 py-3 text-left transition',
                        selectedLeadId === lead.id
                          ? 'border-zinc-950 bg-zinc-950 text-white'
                          : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:border-zinc-300 hover:bg-white'
                      )}
                    >
                      <div className="text-sm font-bold">查看最近产物</div>
                      <div className={cn('mt-1 text-xs', selectedLeadId === lead.id ? 'text-zinc-300' : 'text-muted-foreground')}>
                        {lead.communityName || lead.phone} · {lead.workflowCount} 个方案会话</div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button variant="outline" className="rounded-2xl" onClick={() => router.push('/leads')}>
                返回线索列表
              </Button>
              {selectedLeadId ? (
                <Button variant="ghost" className="rounded-2xl" onClick={() => handleLeadChange(null)}>
                  取消当前线索
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        {!selectedLead ? (
          <div className="rounded-[28px] border border-dashed border-zinc-300 bg-white/80 px-8 py-20 text-center shadow-sm">
            <div className="mx-auto max-w-xl space-y-3">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                <Wand2 size={24} />
              </div>
              <h2 className="text-2xl font-black">先选择一条客户线索，再开始设计工作流</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                工作流不再支持匿名会话。所有方案、时间线和生成记录都会绑定到当前设计师的客户线索上。
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[340px_minmax(0,1fr)_360px]">
            <section className="space-y-5">
              <div className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
                <div className="border-b border-zinc-100 bg-zinc-950 px-6 py-5 text-white">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10">
                      <Phone size={20} />
                    </div>
                    <div>
                      <p className="text-sm font-bold">{selectedLead.name}</p>
                      <p className="text-xs text-zinc-400">
                        {selectedLead.phone} · {selectedLead.communityName || '未登记小区'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 p-6 text-sm">
                  <div className="rounded-2xl bg-zinc-50 p-4">
                    <div className="text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground">客户状态</div>
                    <div className="mt-2 font-bold">{selectedLead.status}</div>
                  </div>
                  <div className="rounded-2xl bg-zinc-50 p-4">
                    <div className="text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground">风格偏好</div>
                    <div className="mt-2 font-bold">{selectedLead.stylePreference || '待沟通'}</div>
                  </div>
                  <div className="rounded-2xl bg-zinc-50 p-4">
                    <div className="text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground">户型素材</div>
                    <div className="mt-2 font-bold">{selectedLead.floorPlans.length} 份</div>
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
                <div className="border-b border-zinc-100 px-6 py-4">
                  <div className="flex items-center gap-2 text-sm font-bold">
                    <FolderPlus size={16} className="text-muted-foreground" /> 新建方案会话
                  </div>
                </div>

                <div className="space-y-4 p-6">
                  <div>
                    <label className="mb-2 block text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">
                      会话标签
                    </label>
                    <input
                      value={workflowLabel}
                      onChange={(event) => setWorkflowLabel(event.target.value)}
                      placeholder="例如：现代首轮 / 奶油备选 / 夜景增强版"
                      className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-400"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">
                      来源方式
                    </label>
                    <div className="grid gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSourceMode('floor_plan');
                          setSourceAssetRole('floor_plan');
                        }}
                        className={cn(
                          'rounded-2xl border px-4 py-3 text-left transition',
                          sourceMode === 'floor_plan'
                            ? 'border-zinc-950 bg-zinc-950 text-white'
                            : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300'
                        )}
                      >
                        <div className="text-sm font-bold">使用当前线索的户型图</div>
                        <div className={cn('mt-1 text-xs', sourceMode === 'floor_plan' ? 'text-zinc-300' : 'text-muted-foreground')}>
                          优先从 Lead.floorPlanIds 继续设计，自动生成工作流来源图。
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSourceMode('upload');
                          setSourceAssetRole('rough_sketch');
                        }}
                        className={cn(
                          'rounded-2xl border px-4 py-3 text-left transition',
                          sourceMode === 'upload'
                            ? 'border-zinc-950 bg-zinc-950 text-white'
                            : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300'
                        )}
                      >
                        <div className="text-sm font-bold">上传线索参考图</div>
                        <div className={cn('mt-1 text-xs', sourceMode === 'upload' ? 'text-zinc-300' : 'text-muted-foreground')}>
                          当线索没有可用户型图时，补一张参考图继续发起方案。
                        </div>
                      </button>
                    </div>
                  </div>

                  {sourceMode === 'floor_plan' ? (
                    <div>
                      <label className="mb-2 block text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">
                        选择户型图
                      </label>
                      <div className="grid gap-2">
                        {selectedLead.floorPlans.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-muted-foreground">
                            当前线索暂无户型图，请切换为上传参考图后再创建方案。
                          </div>
                        ) : (
                          selectedLead.floorPlans.map((plan) => (
                            <button
                              key={plan.id}
                              type="button"
                              onClick={() => setSourceFloorPlanId(plan.id)}
                              className={cn(
                                'rounded-2xl border px-4 py-3 text-left transition',
                                sourceFloorPlanId === plan.id
                                  ? 'border-zinc-950 bg-zinc-950 text-white'
                                  : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300'
                              )}
                            >
                              <div className="text-sm font-bold">{plan.name || '未命名户型图'}</div>
                              <div className={cn('mt-1 text-xs', sourceFloorPlanId === plan.id ? 'text-zinc-300' : 'text-muted-foreground')}>
                                {plan.createdAt ? formatTime(plan.createdAt) : '已关联到当前客户线索'}
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="mb-2 block text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">
                          来源类型
                        </label>
                        <div className="grid gap-2">
                          {SOURCE_ROLE_OPTIONS.filter((item) => item.value !== 'floor_plan').map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => setSourceAssetRole(option.value)}
                              className={cn(
                                'rounded-2xl border px-4 py-3 text-left transition',
                                sourceAssetRole === option.value
                                  ? 'border-zinc-950 bg-zinc-950 text-white'
                                  : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300'
                              )}
                            >
                              <div className="text-sm font-bold">{option.label}</div>
                              <div className={cn('mt-1 text-xs', sourceAssetRole === option.value ? 'text-zinc-300' : 'text-muted-foreground')}>
                                {option.hint}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="mb-2 block text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">
                          上传参考图
                        </label>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleSelectFile}
                        />
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className={cn(
                            'flex w-full items-center justify-center rounded-[24px] border-2 border-dashed px-4 py-6 transition',
                            sourceImage
                              ? 'border-zinc-200 bg-zinc-50'
                              : 'border-zinc-300 bg-zinc-50/80 hover:border-zinc-400 hover:bg-zinc-50'
                          )}
                        >
                          {sourceImage ? (
                            <div className="w-full space-y-3" onClick={(e) => e.stopPropagation()}>
                              <PhotoView src={sourceImage}>
                                <img
                                  src={sourceImage}
                                  alt="线索参考图"
                                  className="h-44 w-full cursor-zoom-in rounded-2xl object-cover"
                                />
                              </PhotoView>
                              <div className="text-xs text-muted-foreground">
                                这张图会作为当前客户线索下方案会话的来源素材。
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-2 text-center text-sm text-muted-foreground">
                              <ImageIcon className="mx-auto" size={20} />
                              <div>点击上传一张参考图</div>
                            </div>
                          )}
                        </button>
                      </div>
                    </>
                  )}

                  <Button
                    onClick={handleCreateWorkflow}
                    disabled={creatingWorkflow || (sourceMode === 'floor_plan' && selectedLead.floorPlans.length === 0)}
                    className="w-full rounded-2xl bg-zinc-950 text-white hover:bg-zinc-800"
                  >
                    {creatingWorkflow ? <Loader2 className="mr-2 animate-spin" size={16} /> : null}
                    创建并绑定到当前线索
                  </Button>
                </div>
              </div>

              <div className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
                <div className="border-b border-zinc-100 px-6 py-4">
                  <div className="flex items-center gap-2 text-sm font-bold">
                    <Layers3 size={16} className="text-muted-foreground" /> 该线索下的方案会话
                  </div>
                </div>
                <div className="space-y-3 p-4">
                  {workflowsLoading ? (
                    <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 p-6 text-sm text-muted-foreground">
                      <Loader2 className="mr-2 inline animate-spin" size={14} />
                      正在加载该线索下的方案会话...
                    </div>
                  ) : workflows.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 p-6 text-sm text-muted-foreground">
                      这条线索还没有方案会话。先用左侧卡片创建第一个方案。
                    </div>
                  ) : (
                    workflows.map((workflow) => (
                      <button
                        key={workflow.id}
                        type="button"
                        onClick={() => {
                          setSelectedWorkflowId(workflow.id);
                          router.replace(`/ai-studio/scenarios?leadId=${selectedLeadId}&workflowId=${workflow.id}`);
                        }}
                        className={cn(
                          'w-full rounded-[24px] border p-4 text-left transition',
                          selectedWorkflowId === workflow.id
                            ? 'border-zinc-950 bg-zinc-950 text-white'
                            : 'border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-zinc-50'
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-black">{workflow.title}</div>
                              {workflow.isPrimary ? (
                                <Badge className="rounded-full border-none bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                                  主方案
                                </Badge>
                              ) : null}
                            </div>
                            <div className={cn('mt-1 text-xs', selectedWorkflowId === workflow.id ? 'text-zinc-300' : 'text-muted-foreground')}>
                              {workflow.generationCount} 个产物 · {workflow.currentStageLabel || '待推进'}
                            </div>
                          </div>
                          <ArrowRight size={14} className={selectedWorkflowId === workflow.id ? 'text-zinc-300' : 'text-zinc-400'} />
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </section>

            <section className="space-y-5">
              {!selectedWorkflow ? (
                <div className="rounded-[28px] border border-dashed border-zinc-300 bg-white px-8 py-20 text-center shadow-sm">
                  <div className="mx-auto max-w-xl space-y-3">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                      <Sparkles size={24} />
                    </div>
                    <h2 className="text-2xl font-black">先进入一个方案会话</h2>
                    <p className="text-sm leading-6 text-muted-foreground">
                      选中左侧某个方案会话后，系统会自动承接这条客户线索下的来源图、定稿图和时间线。
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
                    <div className="border-b border-zinc-100 bg-zinc-950 px-6 py-5 text-white">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold">{selectedWorkflow.title}</p>
                          <p className="text-xs text-zinc-400">
                            绑定线索：{selectedLead.name} · 推荐推进到 {selectedWorkflow.currentStageLabel || '下一步'}
                          </p>
                        </div>
                        <Button variant="outline" className="rounded-2xl" onClick={() => router.push(`/ai-studio/scenarios/${selectedWorkflow.id}`)}>
                          查看详情
                        </Button>
                      </div>
                    </div>

                  <div className="space-y-4 p-6">
                      {(selectedWorkflow.sourceImage || selectedWorkflow.sourceFloorPlanId) && (
                        <div className="overflow-hidden rounded-[28px] border border-zinc-200 bg-zinc-50">
                          <div className="border-b border-zinc-100 px-6 py-4">
                            <div className="flex items-center gap-2 text-sm font-bold">
                              <ImageIcon size={16} className="text-muted-foreground" /> 来源素材
                            </div>
                          </div>
                          <div className="grid gap-4 p-6 lg:grid-cols-[280px_minmax(0,1fr)]">
                            {selectedWorkflow.sourceImage ? (
                              <PhotoView src={selectedWorkflow.sourceImage}>
                                <img
                                  src={selectedWorkflow.sourceImage}
                                  alt="方案来源素材"
                                  className="h-48 w-full cursor-zoom-in rounded-[24px] object-cover shadow-sm"
                                />
                              </PhotoView>
                            ) : (
                              <div className="flex h-48 items-center justify-center rounded-[24px] border border-dashed border-zinc-200 bg-white text-sm text-muted-foreground">
                                当前会话来源于线索户型图
                              </div>
                            )}
                            <div className="space-y-3">
                              <div>
                                <div className="text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground">
                                  来源角色
                                </div>
                                <div className="mt-2 text-sm font-medium">{selectedWorkflow.sourceAssetRole}</div>
                              </div>
                              <div>
                                <div className="text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground">
                                  绑定方式
                                </div>
                                <div className="mt-2 font-bold">{selectedWorkflow.sourceFloorPlanId ? '来自当前客户线索的户型图' : '来自设计师上传的原始参考图'}</div>
                              </div>
                              <div className="text-sm leading-6 text-muted-foreground">
                                这张图是整个方案会话的起点素材。后续每一步都围绕它和上一轮定稿继续生成，避免十个场景彼此割裂。
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {MAIN_WORKFLOW_STAGES.map((stage, index) => {
                        const preset = presetByStage.get(stage.key);
                        const latestGeneration = getLatestGenerationForStage(stage.key);
                        const isCurrentStage = selectedWorkflow.currentStageKey === stage.key;
                        const isRunning = runningPresetKey === preset?.key;

                        return (
                          <div
                            key={stage.key}
                            className={cn(
                              'overflow-hidden rounded-[28px] border bg-white shadow-sm transition',
                              isCurrentStage ? 'border-zinc-950 ring-1 ring-zinc-950' : 'border-zinc-200'
                            )}
                          >
                            <div className="grid gap-0 lg:grid-cols-[1.2fr_0.8fr]">
                              <div className="p-6">
                                <div className="flex items-center gap-3">
                                  <div
                                    className={cn(
                                      'flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-black text-white',
                                      index === 0 && 'bg-gradient-to-br from-blue-500 to-indigo-600',
                                      index === 1 && 'bg-gradient-to-br from-zinc-700 to-slate-500',
                                      index === 2 && 'bg-gradient-to-br from-emerald-500 to-teal-500',
                                      index === 3 && 'bg-gradient-to-br from-rose-500 to-pink-500',
                                      index === 4 && 'bg-gradient-to-br from-amber-500 to-indigo-700'
                                    )}
                                  >
                                    {index + 1}
                                  </div>
                                  <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h4 className="text-lg font-black">{stage.name}</h4>
                                      {isCurrentStage ? (
                                        <Badge className="rounded-full border-none bg-zinc-950 px-2.5 py-1 text-[11px] font-bold text-white">
                                          推荐下一步
                                        </Badge>
                                      ) : null}
                                    </div>
                                    <p className="text-sm text-muted-foreground">{stage.description}</p>
                                  </div>
                                </div>

                                <div className="mt-5 grid gap-3 md:grid-cols-3">
                                  <div className="rounded-2xl bg-zinc-50 p-4">
                                    <div className="text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground">
                                      所需输入
                                    </div>
                                    <div className="mt-2 text-sm font-medium">{stage.inputHint}</div>
                                  </div>
                                  <div className="rounded-2xl bg-zinc-50 p-4">
                                    <div className="text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground">
                                      当前产物
                                    </div>
                                    <div className="mt-2 text-xs font-bold">{latestGeneration?.status === 'succeeded' ? stage.outputHint : '尚未生成'}</div>
                                  </div>
                                  <div className="rounded-2xl bg-zinc-50 p-4">
                                    <div className="text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground">
                                      推荐下一步
                                    </div>
                                    <div className="mt-2 text-xs font-bold">
                                    {stage.nextRecommendedStage
                                        ? getWorkflowStageDefinition(stage.nextRecommendedStage)?.name
                                        : '流程结束'}
                                  </div>
                                  </div>
                                </div>

                                <div className="mt-5 flex flex-wrap items-center gap-3">
                                  <Button
                                    onClick={() => preset && handleRunPreset(preset)}
                                    disabled={!preset || isRunning || !canRunStage(stage.key, preset?.sourceAssetRole)}
                                    className="rounded-2xl bg-zinc-950 px-5 text-white hover:bg-zinc-800"
                                  >
                                    {isRunning ? (
                                      <Loader2 className="mr-2 animate-spin" size={16} />
                                    ) : (
                                      <Sparkles className="mr-2" size={16} />
                                    )}
                                    {latestGeneration?.status === 'succeeded' ? `重新${stage.actionLabel}` : stage.actionLabel}
                                  </Button>

                                  <Button
                                    variant="outline"
                                    className="rounded-2xl"
                                    disabled={!preset || isRunning || !canRunStage(stage.key, preset?.sourceAssetRole)}
                                    onClick={() => {
                                      setMockingStage(stage.key);
                                      mockImageInputRef.current?.click();
                                    }}
                                  >
                                    上传测试图
                                  </Button>

                                  {latestGeneration?.status === 'succeeded' ? (
                                    <>
                                      <Button
                                        variant="outline"
                                        className="rounded-2xl"
                                        onClick={() => latestGeneration.output?.imageUrl && window.open(latestGeneration.output.imageUrl, '_blank')}
                                      >
                                        <ExternalLink size={14} className="mr-2" />
                                        查看产物
                                      </Button>
                                      <Button
                                        variant="outline"
                                        className="rounded-2xl"
                                        onClick={() => handleCopyPrompt(latestGeneration)}
                                      >
                                        <div className="flex items-center gap-2">
                                          <Copy size={12} />
                                          复制提示词
                                        </div>
                                      </Button>
                                      {(stage.key === 'base_render' || stage.key === 'soft_furnishing') && (
                                        <Button
                                          variant="outline"
                                          className="rounded-2xl"
                                          onClick={() => handleSelectBaseline(latestGeneration)}
                                        >
                                          <div className="flex items-center gap-2">
                                            <CheckCircle size={12} />
                                            设为当前定稿
                                          </div>
                                        </Button>
                                      )}
                                    </>
                                  ) : null}
                                </div>
                              </div>

                              <div className="border-t border-zinc-100 bg-zinc-50 p-6 lg:border-l lg:border-t-0">
                                {workflowDetailLoading && selectedWorkflowId === selectedWorkflow.id ? (
                                  <div className="flex h-full min-h-[220px] items-center justify-center text-sm text-muted-foreground">
                                    <Loader2 className="mr-2 animate-spin" size={16} /> 正在同步步骤结果...
                                  </div>
                                ) : latestGeneration?.output?.imageUrl ? (
                                  <div className="space-y-3">
                                    <PhotoView src={latestGeneration.output.imageUrl}>
                                      <img
                                        src={latestGeneration.output.imageUrl}
                                        alt={stage.name}
                                        className="h-56 w-full cursor-zoom-in rounded-[24px] object-cover shadow-sm"
                                      />
                                    </PhotoView>
                                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                                      <span>{latestGeneration.isSelectedBaseline ? '当前定稿' : '演示产物'}</span>
                                      <span>{formatTime(latestGeneration.createdAt)}</span>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-[24px] border border-dashed border-zinc-200 bg-white text-center text-sm text-muted-foreground">
                                    <Layers3 size={20} className="mb-3 text-zinc-400" />
                                    <p>这个步骤还没有产物。</p>
                                    <p className="mt-1 max-w-[220px] text-xs leading-5">
                                      生成后会自动沉淀到当前线索和方案会话里，右侧时间线也会同步记录。
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
                        <Sparkles size={18} />
                      </div>
                      <div>
                        <h3 className="text-lg font-black">高级工具</h3>
                        <p className="text-sm text-muted-foreground">不占主流程位置，但仍然承接当前线索与定稿方案。</p>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      {ADVANCED_WORKFLOW_TOOLS.map((tool) => {
                        const preset = advancedPresets.find((item) => item.workflowStage === tool.key);
                        const latestGeneration = getLatestGenerationForStage(tool.key);
                        const isRunning = runningPresetKey === preset?.key;

                        return (
                          <div key={tool.key} className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm">
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <h4 className="text-base font-black">{tool.name}</h4>
                                <p className="mt-2 text-sm leading-6 text-muted-foreground">{tool.description}</p>
                              </div>
                              <Badge variant="outline" className="rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.14em]">
                                高级
                              </Badge>
                            </div>
                            <div className="py-8 text-center text-sm text-muted-foreground">
                        当前会话还没有产物。先从“选风格”或“出基准方案”开始。
                      </div>
                            <div className="mt-4 text-xs text-muted-foreground">输入：{tool.inputHint}</div>
                            <div className="mt-4 flex flex-wrap gap-3">
                              <Button
                                variant="outline"
                                className="rounded-2xl"
                                disabled={!preset || isRunning || !canRunStage(tool.key, preset?.sourceAssetRole)}
                                onClick={() => preset && handleRunPreset(preset)}
                              >
                                {isRunning ? (
                                  <Loader2 className="mr-2 animate-spin" size={16} />
                                ) : (
                                  <Sparkles className="mr-2" size={16} />
                                )}
                                {preset?.name || tool.actionLabel}
                              </Button>

                              <Button
                                variant="outline"
                                className="rounded-2xl"
                                disabled={!preset || isRunning || !canRunStage(tool.key, preset?.sourceAssetRole)}
                                onClick={() => {
                                  setMockingStage(tool.key);
                                  mockImageInputRef.current?.click();
                                }}
                              >
                                上传测试图
                              </Button>

                              {latestGeneration?.output?.imageUrl ? (
                                <>
                                  <Button
                                    variant="ghost"
                                    className="rounded-2xl"
                                    onClick={() => window.open(latestGeneration.output?.imageUrl, '_blank')}
                                  >
                                    <ExternalLink size={14} className="mr-2" />
                                    查看最近产物
                                  </Button>
                                  <Button
                                    variant="outline"
                                    className="rounded-2xl"
                                    onClick={() => handleCopyPrompt(latestGeneration)}
                                  >
                                    <div className="flex items-center gap-2">
                                      <Copy size={12} />
                                      复制提示词
                                    </div>
                                  </Button>
                                </>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </section>

            <section className="space-y-5">
              <div className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
                <div className="border-b border-zinc-100 px-6 py-4">
                  <div className="flex items-center gap-2 text-sm font-bold">
                    <Clock size={16} className="text-muted-foreground" /> 会话时间线
                  </div>
                </div>

                <div className="max-h-[1320px] space-y-4 overflow-y-auto p-4">
                  {!selectedWorkflow ? (
                    <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 p-6 text-sm text-muted-foreground">
                      选中一个方案会话后，这里会按时间顺序展示每一步产物、状态和推荐下一步。
                    </div>
                  ) : workflowDetailLoading ? (
                    <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
                      <Loader2 className="mr-2 animate-spin" size={16} /> 正在加载时间线...
                    </div>
                  ) : generations.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 p-6 text-sm text-muted-foreground">
                      当前会话还没有产物。先从“选风格”或“出基准方案”开始。
                    </div>
                  ) : (
                    <>
                      {selectedWorkflow.sourceImage ? (
                        <div key="source-image" className="rounded-[24px] border border-zinc-200 bg-white p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-sm font-bold">起点素材</div>
                                <Badge className="rounded-full border-none bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-700">
                                  毛坯图 / 参考图
                                </Badge>
                              </div>
                              <div className="mt-2 text-xs text-muted-foreground">{formatTime(selectedWorkflow.createdAt)}</div>
                            </div>
                          </div>
                          <PhotoView src={selectedWorkflow.sourceImage}>
                            <img
                              src={selectedWorkflow.sourceImage}
                              alt="起点素材"
                              className="mt-4 h-48 w-full cursor-zoom-in rounded-[20px] object-cover"
                            />
                          </PhotoView>
                          <div className="mt-4 text-xs leading-5 text-muted-foreground">
                            当前方案会话从这张来源图开始，后续所有步骤都会承接这条线索下的同一空间结构。
                          </div>
                        </div>
                      ) : null}
                      {generations.map((generation) => (
                      <div key={generation.id} className="rounded-[24px] border border-zinc-200 bg-white p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-black">
                                {generation.stageLabel || getWorkflowStageDefinition(generation.stageKey)?.name || '未命名步骤'}
                              </div>
                              {generation.isSelectedBaseline ? (
                                <Badge className="rounded-full border-none bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                                  当前定稿
                                </Badge>
                              ) : null}
                              {generation.status === 'failed' ? (
                                <Badge className="rounded-full border-none bg-red-100 px-2.5 py-1 text-[11px] font-bold text-red-700">
                                  失败
                                </Badge>
                              ) : generation.status === 'succeeded' ? (
                                <Badge className="rounded-full border-none bg-zinc-100 px-2.5 py-1 text-[11px] font-bold text-zinc-700">
                                  已完成                                </Badge>
                              ) : (
                                <Badge className="rounded-full border-none bg-blue-100 px-2.5 py-1 text-[11px] font-bold text-blue-700">
                                  处理中                                </Badge>
                              )}
                            </div>
                            <div className="mt-2 text-xs text-muted-foreground">{formatTime(generation.createdAt)}</div>
                          </div>
                          {generation.output?.imageUrl ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="rounded-xl"
                              onClick={() => window.open(generation.output?.imageUrl, '_blank')}
                            >
                              <ExternalLink size={14} />
                            </Button>
                          ) : null}
                        </div>

                        {generation.input?.styleReferenceImage && (
                          <div className="mt-4 rounded-[20px] border border-zinc-100 bg-zinc-50 p-3">
                            <div className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground">
                              局部风格参考图
                            </div>
                            <PhotoView src={generation.input.styleReferenceImage}>
                              <img
                                src={generation.input.styleReferenceImage}
                                alt="参考图"
                                className="h-24 w-auto cursor-zoom-in rounded-[12px] object-contain shadow-sm border border-zinc-200 bg-white"
                              />
                            </PhotoView>
                          </div>
                        )}

                        {generation.output?.imageUrl ? (
                          <PhotoView src={generation.output.imageUrl}>
                            <img
                              src={generation.output.imageUrl}
                              alt={generation.stageLabel || generation.stageKey || '步骤产物'}
                              className="mt-4 h-48 w-full cursor-zoom-in rounded-[20px] object-cover"
                            />
                          </PhotoView>
                        ) : (
                          <div className="mt-4 rounded-[20px] border border-dashed border-zinc-200 bg-zinc-50 px-4 py-10 text-center text-sm text-muted-foreground">
                            {generation.errorMessage || '该步骤暂未返回图片。'}
                          </div>
                        )}

                        <div className="mt-4 flex flex-wrap gap-3">
                          {getGenerationPrompt(generation) ? (
                            <Button
                              variant="outline"
                              className="rounded-2xl"
                              onClick={() => handleCopyPrompt(generation)}
                            >
                              <Copy size={14} className="mr-2" />
                              复制提示词
                            </Button>
                          ) : null}
                          {(generation.stageKey === 'base_render' || generation.stageKey === 'soft_furnishing') &&
                          generation.status === 'succeeded' ? (
                            <Button
                              variant="outline"
                              className="rounded-2xl"
                              onClick={() => handleSelectBaseline(generation)}
                            >
                              <CheckCircle2 size={14} className="mr-2" />
                              设为当前定稿
                            </Button>
                          ) : null}

                          {generation.nextRecommendedStage && generation.status === 'succeeded' ? (
                            <Button
                              variant="ghost"
                              className="rounded-2xl text-sm"
                              onClick={() => handleSetStage(generation.nextRecommendedStage)}
                            >
                              推荐进入 {getWorkflowStageDefinition(generation.nextRecommendedStage)?.name}
                              <ArrowRight size={14} className="ml-2" />
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </section>
          </div>
        )}</>
        )}
      </main>

      <RechargeDialog open={showRecharge} onOpenChange={setShowRecharge} />
      <input
        ref={mockImageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleMockImageSelect}
      />
      <ImageCropperDialog 
        open={cropDialogOpen} 
        onOpenChange={setCropDialogOpen} 
        imageUrl={cropImageUrl} 
        onCropComplete={handleCropComplete} 
      />
    </div>
    </PhotoProvider>
  );
}

export default function AiScenariosPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-muted-foreground">正在加载场景数据...</div>}>
      <AiScenariosPageContent />
    </Suspense>
  );
}

