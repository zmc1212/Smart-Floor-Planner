'use client';

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  Image as ImageIcon,
  Loader2,
  Map,
  Palette,
  Plus,
  Search,
  Sofa,
  Sparkles,
  Upload,
  Users,
  WandSparkles,
} from 'lucide-react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { Drawer, Flex, Modal, Steps, Typography } from 'antd';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { notify } from '@/components/ui/operation-feedback';
import { useFetch } from '@/hooks/useFetch';
import { cn } from '@/lib/utils';
import {
  ADVANCED_WORKFLOW_TOOLS,
  MAIN_WORKFLOW_STAGES,
  getWorkflowStageDefinition,
  type AiWorkflowSourceAssetRole,
  type AiWorkflowStageKey,
} from '@/lib/ai/workflow-stages';
import {
  useAiWorkflowRunner,
  type WorkflowRunnerDetail,
} from '@/components/ai-studio/workflow-runner';
import { AiDesignerLegacyPage } from '../designer/page';
import { AiFloorPlanLegacyPage } from '../floor-plan/page';
import { AiFurnishingLegacyPage } from '../furnishing/page';
import { AiSoftFurnishingLegacyPage } from '../soft-furnishing/page';
import { AiToolFrame } from '@/components/ai-studio/ai-tool-frame';

type WorkbenchView = 'workflows' | 'quick' | 'assistant';
type WorkflowFilter = 'all' | 'not_started' | 'review' | 'processing' | 'failed' | 'ready';

interface DesignAction {
  key: string;
  label: string;
  shortDescription: string;
  resultBoundary: string;
  stageKey?: AiWorkflowStageKey;
  credits: number;
  enabled: boolean;
  disabledReason?: string;
}

interface DesignCapabilities {
  account: { balance: number; frozenBalance: number; availableBalance: number };
  provider: { available: boolean; supportsEdit: boolean; supportsGenerate: boolean };
  actions: DesignAction[];
}

interface WorkflowGeneration {
  id: string;
  stageKey?: AiWorkflowStageKey;
  stageLabel?: string;
  channel?: 'admin' | 'miniprogram';
  status: 'created' | 'pending' | 'processing' | 'succeeded' | 'failed';
  isSelectedBaseline: boolean;
  nextRecommendedStage?: AiWorkflowStageKey;
  output?: { imageUrl?: string; promptUsed?: string };
  errorMessage?: string;
  createdAt: string;
}

interface LeadSummary {
  id: string;
  name: string;
  phone: string;
  communityName?: string;
  status: string;
  stylePreference?: string;
  floorPlans: Array<{ id: string; name?: string; status?: string; createdAt?: string }>;
  workflowCount?: number;
}

interface WorkflowSummary {
  id: string;
  leadId: string;
  title: string;
  workflowLabel?: string;
  isPrimary: boolean;
  sourceImage?: string;
  sourceFloorPlanId?: string;
  sourceAssetRole: AiWorkflowSourceAssetRole;
  currentStageKey: AiWorkflowStageKey;
  currentStageLabel?: string;
  selectedGenerationId?: string;
  generationCount: number;
  latestGeneration?: WorkflowGeneration;
  selectedGeneration?: WorkflowGeneration;
  lead?: Omit<LeadSummary, 'floorPlans'>;
  stageState?: {
    completedStages: string[];
    recommendedNextAction?: { stageKey?: AiWorkflowStageKey; stageLabel?: string; reason?: string };
  };
  updatedAt: string;
}

interface WorkflowDetail {
  workflow: WorkflowSummary;
  lead: LeadSummary;
  generations: WorkflowGeneration[];
}

const FILTERS: Array<{ key: WorkflowFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'not_started', label: '待开始' },
  { key: 'review', label: '待选稿' },
  { key: 'processing', label: '处理中' },
  { key: 'failed', label: '生成失败' },
  { key: 'ready', label: '可深化' },
];

const QUICK_TOOLS = [
  { key: 'floor_plan_style', label: '户型表现', description: '彩平、CAD、3D 与手绘户型表现。', icon: Map },
  { key: 'furnishing_render', label: '快速风格设计', description: '从正式户型快速生成装修风格图。', icon: Palette },
  { key: 'soft_furnishing_render', label: '快速软装改造', description: '上传现场图，快速优化软装表达。', icon: Sofa },
] as const;

function formatTime(value?: string) {
  if (!value) return '--';
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function workflowState(workflow: WorkflowSummary): WorkflowFilter {
  const latest = workflow.latestGeneration;
  if (!latest || workflow.generationCount === 0) return 'not_started';
  if (['created', 'pending', 'processing'].includes(latest.status)) return 'processing';
  if (latest.status === 'failed') return 'failed';
  if (
    latest.status === 'succeeded' &&
    ['base_render', 'soft_furnishing'].includes(latest.stageKey || '') &&
    !latest.isSelectedBaseline &&
    workflow.selectedGenerationId !== latest.id
  ) return 'review';
  return 'ready';
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function readJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return { success: false, error: '服务响应异常' };
  }
}

function AiScenariosPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const confirmAction = useConfirmDialog();
  const requestedView = searchParams.get('view');
  const initialView: WorkbenchView = requestedView === 'quick' || requestedView === 'assistant' ? requestedView : 'workflows';
  const requestedAction = searchParams.get('action');
  const initialLeadId = searchParams.get('leadId') || '';
  const initialWorkflowId = searchParams.get('workflowId') || '';

  const [view, setView] = useState<WorkbenchView>(initialView);
  const [quickAction, setQuickAction] = useState(requestedAction || '');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<WorkflowFilter>('all');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(initialWorkflowId);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardLeadId, setWizardLeadId] = useState(initialLeadId);
  const [sourceMode, setSourceMode] = useState<'floor_plan' | 'upload'>('floor_plan');
  const [sourceFloorPlanId, setSourceFloorPlanId] = useState('');
  const [sourceImage, setSourceImage] = useState('');
  const [goalStage, setGoalStage] = useState<AiWorkflowStageKey>('base_render');
  const [creating, setCreating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const workflowsUrl = `/api/ai/workflows?limit=50${search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ''}`;
  const { data: workflowsData, mutate: mutateWorkflows, isLoading: workflowsLoading } = useFetch<WorkflowSummary[]>(workflowsUrl);
  const { data: leadsData, isLoading: leadsLoading, mutate: mutateLeads } = useFetch<LeadSummary[]>('/api/ai/workflow-leads?limit=100');
  const { data: capabilities, mutate: mutateCapabilities } = useFetch<DesignCapabilities>('/api/ai/design-capabilities');
  const {
    data: workflowDetail,
    mutate: mutateWorkflowDetail,
    isLoading: detailLoading,
  } = useFetch<WorkflowDetail>(selectedWorkflowId ? `/api/ai/workflows/${selectedWorkflowId}` : null);

  const workflows = useMemo(() => {
    const items = workflowsData || [];
    return filter === 'all' ? items : items.filter((item) => workflowState(item) === filter);
  }, [filter, workflowsData]);
  const leads = leadsData || [];
  const selectedWizardLead = leads.find((lead) => lead.id === wizardLeadId);
  const workflow = workflowDetail?.workflow;
  const generations = useMemo(() => workflowDetail?.generations || [], [workflowDetail?.generations]);
  const selectedGeneration = generations.find((item) => item.isSelectedBaseline || item.id === workflow?.selectedGenerationId);
  const latestSucceeded = generations.find((item) => item.status === 'succeeded' && item.output?.imageUrl);
  const heroGeneration = selectedGeneration || latestSucceeded;
  const scenarioPrice = capabilities?.actions.find((action) => action.key === goalStage)?.credits || 0;
  const activeGenerationIds = useMemo(
    () => generations
      .filter((generation) => ['created', 'pending', 'processing'].includes(generation.status))
      .map((generation) => generation.id),
    [generations]
  );

  useEffect(() => {
    if (initialLeadId && !initialWorkflowId && workflowsData?.length) {
      const match = workflowsData.find((item) => item.leadId === initialLeadId);
      if (match) setSelectedWorkflowId(match.id);
      else {
        setWizardLeadId(initialLeadId);
        setWizardOpen(true);
      }
    }
  }, [initialLeadId, initialWorkflowId, workflowsData]);

  useEffect(() => {
    if (!selectedWizardLead) return;
    if (selectedWizardLead.floorPlans.length === 1) {
      setSourceMode('floor_plan');
      setSourceFloorPlanId(selectedWizardLead.floorPlans[0].id);
    } else if (!selectedWizardLead.floorPlans.some((plan) => plan.id === sourceFloorPlanId)) {
      setSourceFloorPlanId('');
    }
  }, [selectedWizardLead, sourceFloorPlanId]);

  useEffect(() => {
    if (!selectedWorkflowId || !activeGenerationIds.length) return;
    let cancelled = false;
    const poll = async () => {
      await Promise.all(activeGenerationIds.map((id) => fetch(`/api/ai/status/${id}`).catch(() => null)));
      if (!cancelled) await Promise.all([mutateWorkflowDetail(), mutateWorkflows(), mutateCapabilities()]);
    };
    const timer = window.setInterval(poll, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeGenerationIds, mutateCapabilities, mutateWorkflowDetail, mutateWorkflows, selectedWorkflowId]);

  const workflowRunner = useAiWorkflowRunner({
    workflowId: selectedWorkflowId,
    workflowDetail: workflowDetail as WorkflowRunnerDetail | null,
    fetchDetail: false,
    onAfterAction: async () => {
      await Promise.all([mutateWorkflowDetail(), mutateWorkflows(), mutateCapabilities()]);
    },
    showSuccessNotification: true,
  });

  const setWorkbenchView = (nextView: WorkbenchView) => {
    setView(nextView);
    setQuickAction('');
    router.replace(`/ai-studio/scenarios${nextView === 'workflows' ? '' : `?view=${nextView}`}`);
  };

  const selectWorkflow = (id: string) => {
    setSelectedWorkflowId(id);
    router.replace(`/ai-studio/scenarios?workflowId=${id}`);
  };

  const startWizard = (leadId?: string) => {
    setWizardStep(1);
    setWizardLeadId(leadId || '');
    setSourceMode('floor_plan');
    setSourceFloorPlanId('');
    setSourceImage('');
    setGoalStage('base_render');
    setWizardOpen(true);
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file?.type.startsWith('image/')) {
      notify.error('请选择图片文件');
      return;
    }
    try {
      setSourceImage(await readFileAsDataUrl(file));
    } catch {
      notify.error('读取图片失败');
    }
  };

  const createAndRun = async () => {
    if (!selectedWizardLead) return notify.error('请先选择客户');
    if (sourceMode === 'floor_plan' && !sourceFloorPlanId) return notify.error('请选择正式户型');
    if (sourceMode === 'upload' && !sourceImage) return notify.error('请上传来源图');
    const action = capabilities?.actions.find((item) => item.key === goalStage);
    if (!action?.enabled) return notify.error(action?.disabledReason || '当前目标暂不可用');
    const confirmed = await confirmAction({
      title: `确认${action.label}？`,
      description: `将为${selectedWizardLead.name}创建客户方案并执行首个动作，预计使用 ${action.credits} 点。首个成功版本会自动采用，之后重新生成只作为候选。`,
      confirmText: '创建并开始生成',
    });
    if (!confirmed) return;

    setCreating(true);
    let createdId = '';
    try {
      const createRes = await fetch('/api/ai/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: selectedWizardLead.id,
          sourceFloorPlanId: sourceMode === 'floor_plan' ? sourceFloorPlanId : undefined,
          sourceImage: sourceMode === 'upload' ? sourceImage : undefined,
          sourceAssetRole: sourceMode === 'floor_plan' ? 'floor_plan' : 'rough_sketch',
        }),
      });
      const created = await readJson(createRes);
      if (!createRes.ok || !created.success) throw new Error(created.error || '创建方案失败');
      createdId = created.data.id;
      setSelectedWorkflowId(createdId);
      setWizardOpen(false);
      router.replace(`/ai-studio/scenarios?workflowId=${createdId}`);
      await Promise.all([mutateWorkflows(), mutateLeads()]);

      const runRes = await fetch(`/api/ai/workflows/${createdId}/run-stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stageKey: goalStage, confirmed: true }),
      });
      const run = await readJson(runRes);
      if (!runRes.ok || !run.success) throw new Error(run.error || '首轮生成失败');
      await Promise.all([mutateWorkflowDetail(), mutateWorkflows(), mutateCapabilities()]);
      const runStatus = run.data?.generations?.[0]?.status;
      if (['created', 'pending', 'processing'].includes(runStatus)) notify.info('方案已创建，首轮成果正在后台生成');
      else notify.success('方案已创建，首轮成果已生成');
    } catch (error) {
      if (createdId) notify.error(`方案已保留，${error instanceof Error ? error.message : '首轮生成失败'}，可进入方案重试`);
      else notify.fromAlert(error);
    } finally {
      setCreating(false);
    }
  };

  const runStage = async (stageKey: AiWorkflowStageKey) => {
    const runnerAction = workflowRunner.actions.find((item) => item.stageKey === stageKey);
    if (!runnerAction) return;
    if (runnerAction.status === 'blocked') return notify.info(runnerAction.disabledReason || '当前步骤暂不可用');
    const action = capabilities?.actions.find((item) => item.stageKey === stageKey);
    const confirmed = await confirmAction({
      title: `确认${action?.label || runnerAction.label}？`,
      description: `将使用当前方案素材生成新版本，预计使用 ${action?.credits || 0} 点。已有定稿时，新结果不会自动覆盖。`,
      confirmText: '开始生成',
    });
    if (confirmed) await workflowRunner.runAction(runnerAction);
  };

  const selectBaseline = async (generation: WorkflowGeneration) => {
    if (!workflow) return;
    const confirmed = await confirmAction({
      title: '采用这个版本？',
      description: '后续软装、提案和灯光都会以这张图为准。',
      confirmText: '采用此版本',
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/ai/workflows/${workflow.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'select-generation',
          generationId: generation.id,
          nextStageKey: generation.nextRecommendedStage,
        }),
      });
      const json = await readJson(res);
      if (!res.ok || !json.success) throw new Error(json.error || '选择版本失败');
      await Promise.all([mutateWorkflowDetail(), mutateWorkflows()]);
      notify.success('已设为当前方案');
    } catch (error) {
      notify.fromAlert(error);
    }
  };

  if (view === 'assistant') {
    return (
      <div>
        <WorkbenchTabs view={view} onChange={setWorkbenchView} />
        <AiDesignerLegacyPage />
      </div>
    );
  }

  if (view === 'quick') {
    const tool = QUICK_TOOLS.find((item) => item.key === quickAction);
    if (tool) {
      return (
        <div>
          <div className="px-5 pt-6 sm:px-7">
            <Button variant="ghost" onClick={() => setQuickAction('')} className="rounded-xl">
              <ArrowLeft size={16} className="mr-2" />返回快速工具
            </Button>
          </div>
          {quickAction === 'floor_plan_style' ? <AiFloorPlanLegacyPage /> : null}
          {quickAction === 'furnishing_render' ? <AiFurnishingLegacyPage /> : null}
          {quickAction === 'soft_furnishing_render' ? <AiSoftFurnishingLegacyPage /> : null}
        </div>
      );
    }
    return (
      <AiToolFrame title="AI 快速工具" description="针对单次沟通任务直接生成图像，不会创建或修改客户方案。" icon={WandSparkles}>
        <div className="mb-7"><WorkbenchTabs view={view} onChange={setWorkbenchView} /></div>
        <div className="grid divide-y divide-border rounded-lg border bg-card md:grid-cols-3 md:divide-x md:divide-y-0">
          {QUICK_TOOLS.map((item, index) => {
            const Icon = item.icon;
            return (
              <button key={item.key} type="button" onClick={() => setQuickAction(item.key)} className="group flex min-h-56 flex-col p-5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
                <div className="flex items-center justify-between">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon size={18} /></div>
                  <span className="text-xs font-medium tabular-nums text-muted-foreground">0{index + 1}</span>
                </div>
                <div className="mt-8 text-lg font-semibold">{item.label}</div>
                <div className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</div>
                <div className="mt-auto flex items-center gap-1 pt-6 text-sm font-medium text-primary">打开工具 <ArrowRight size={15} /></div>
              </button>
            );
          })}
        </div>
      </AiToolFrame>
    );
  }

  return (
    <PhotoProvider>
      <main className="space-y-6 px-5 py-6 sm:px-7 sm:py-8">
        <WorkbenchTabs view={view} onChange={setWorkbenchView} />

        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Badge className="border-none bg-emerald-100 text-emerald-700">AI 设计工作台</Badge>
            <h1 className="mt-3 text-3xl font-black tracking-tight">从客户素材到可沟通方案</h1>
            <p className="mt-2 text-sm text-muted-foreground">选择想得到的成果，系统会自动承接正确素材和当前定稿。</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-2xl border bg-card px-4 py-3 text-sm">
              <span className="text-muted-foreground">可用点数</span>
              <span className="ml-2 font-black text-emerald-700">{capabilities?.account.availableBalance ?? '--'}</span>
            </div>
            <Button onClick={() => startWizard()} className="rounded-2xl bg-zinc-950 text-white hover:bg-zinc-800"><Plus size={16} className="mr-2" />开始新设计</Button>
          </div>
        </div>

        {!selectedWorkflowId ? (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <section className="space-y-4">
              <div className="rounded-3xl border bg-card p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                  <div className="relative flex-1">
                    <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索客户、手机号或小区" className="h-11 rounded-2xl pl-10" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {FILTERS.map((item) => (
                      <button key={item.key} type="button" onClick={() => setFilter(item.key)} className={cn('rounded-full px-3 py-2 text-xs font-bold transition', filter === item.key ? 'bg-zinc-950 text-white' : 'bg-muted text-muted-foreground hover:text-foreground')}>
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {workflowsLoading ? (
                <div className="flex min-h-80 items-center justify-center rounded-3xl border bg-card text-sm text-muted-foreground"><Loader2 size={16} className="mr-2 animate-spin" />正在加载客户方案...</div>
              ) : workflows.length ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {workflows.map((item) => {
                    const state = workflowState(item);
                    const preview = item.selectedGeneration?.output?.imageUrl || item.latestGeneration?.output?.imageUrl || item.sourceImage;
                    return (
                      <button key={item.id} type="button" onClick={() => selectWorkflow(item.id)} className="group overflow-hidden rounded-3xl border bg-card text-left shadow-sm transition hover:border-zinc-300 hover:shadow-md">
                        <div className="grid min-h-48 grid-cols-[148px_minmax(0,1fr)]">
                          <div className="bg-muted">
                            {preview ? <img src={preview} alt={item.title} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-muted-foreground"><ImageIcon size={24} /></div>}
                          </div>
                          <div className="flex min-w-0 flex-col p-5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="truncate font-black">{item.title}</div>
                              <StateBadge state={state} />
                            </div>
                            <div className="mt-2 text-sm text-muted-foreground">{item.lead?.communityName || item.lead?.phone || '已关联客户'}</div>
                            <div className="mt-5 rounded-2xl bg-muted/60 p-3 text-xs">
                              <div className="font-bold">下一步：{item.stageState?.recommendedNextAction?.stageLabel || item.currentStageLabel || '查看方案'}</div>
                              <div className="mt-1 text-muted-foreground">{item.generationCount} 个版本 · {formatTime(item.updatedAt)}</div>
                            </div>
                            <div className="mt-auto pt-4 text-sm font-bold text-emerald-700">继续设计 <ArrowRight size={14} className="ml-1 inline" /></div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-3xl border border-dashed bg-card px-8 py-20 text-center">
                  <Users size={30} className="mx-auto text-emerald-600" />
                  <h2 className="mt-4 text-xl font-black">还没有匹配的客户方案</h2>
                  <p className="mt-2 text-sm text-muted-foreground">从客户和素材开始，选择本次想获得的成果。</p>
                  <Button onClick={() => startWizard()} className="mt-6 rounded-2xl"><Plus size={16} className="mr-2" />开始新设计</Button>
                </div>
              )}
            </section>

            <aside className="space-y-4">
              <div className="rounded-3xl border bg-card p-6 shadow-sm">
                <div className="text-sm font-black">现在可以做什么</div>
                <div className="mt-4 space-y-3 text-sm text-muted-foreground">
                  <p>• 新客户：直接生成风格方向或空间效果。</p>
                  <p>• 已有方案：采用候选版本后继续软装和提案。</p>
                  <p>• 现场小程序成果：会自动出现在同一客户方案中。</p>
                </div>
              </div>
            </aside>
          </div>
        ) : (
          <div className="space-y-5">
            <Button variant="ghost" className="rounded-xl px-0 hover:bg-transparent" onClick={() => { setSelectedWorkflowId(''); router.replace('/ai-studio/scenarios'); }}><ArrowLeft size={16} className="mr-2" />返回客户方案</Button>
            {detailLoading || !workflowDetail || !workflow ? (
              <div className="flex min-h-[55vh] items-center justify-center rounded-3xl border bg-card text-sm text-muted-foreground"><Loader2 size={18} className="mr-2 animate-spin" />正在读取方案...</div>
            ) : (
              <>
                <div className="rounded-3xl border bg-card p-5 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-2xl font-black">{workflow.title}</h2>
                        <Badge variant="outline">{workflowDetail.lead.name}</Badge>
                        {heroGeneration?.channel === 'miniprogram' ? <Badge className="border-none bg-emerald-100 text-emerald-700">来自小程序</Badge> : null}
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">{workflowDetail.lead.communityName || workflowDetail.lead.phone} · {workflow.sourceFloorPlanId ? '正式户型' : '上传来源图'}</p>
                    </div>
                    <Button variant="outline" className="rounded-2xl" onClick={() => setTimelineOpen(true)}><Clock3 size={16} className="mr-2" />全部时间线</Button>
                  </div>
                  <div className="mt-5 grid grid-cols-5 gap-2">
                    {MAIN_WORKFLOW_STAGES.map((stage, index) => {
                      const completed = generations.some((generation) => generation.stageKey === stage.key && generation.status === 'succeeded');
                      const current = workflow.currentStageKey === stage.key;
                      return (
                        <div key={stage.key} className={cn('rounded-2xl px-3 py-3 text-center text-xs font-bold', current ? 'bg-zinc-950 text-white' : completed ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground')}>
                          <div>{completed ? <Check size={14} className="mx-auto mb-1" /> : index + 1}</div>
                          <div className="truncate">{stage.name}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
                  <section className="space-y-5">
                    <div className="overflow-hidden rounded-3xl border bg-card shadow-sm">
                      <div className="flex items-center justify-between border-b px-6 py-4">
                        <div>
                          <div className="font-black">当前方案</div>
                          <div className="mt-1 text-xs text-muted-foreground">{selectedGeneration ? '已采用的版本，后续深化以此为准' : '还没有采用版本'}</div>
                        </div>
                        {selectedGeneration ? <Badge className="border-none bg-emerald-100 text-emerald-700">当前定稿</Badge> : null}
                      </div>
                      {heroGeneration?.output?.imageUrl ? (
                        <PhotoView src={heroGeneration.output.imageUrl}>
                          <img src={heroGeneration.output.imageUrl} alt="当前方案" className="h-[520px] w-full cursor-zoom-in object-cover" />
                        </PhotoView>
                      ) : (
                        <div className="flex h-[420px] flex-col items-center justify-center bg-muted/40 text-center text-sm text-muted-foreground"><ImageIcon size={28} className="mb-3" />还没有生成成果，从右侧的推荐动作开始。</div>
                      )}
                    </div>

                    {generations.filter((item) => item.status === 'succeeded' && item.output?.imageUrl).length > 0 ? (
                      <div className="rounded-3xl border bg-card p-5 shadow-sm">
                        <div className="font-black">版本候选</div>
                        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          {generations.filter((item) => item.status === 'succeeded' && item.output?.imageUrl).map((generation) => (
                            <div key={generation.id} className={cn('overflow-hidden rounded-2xl border', generation.isSelectedBaseline && 'border-emerald-500 ring-1 ring-emerald-500')}>
                              <PhotoView src={generation.output!.imageUrl!}><img src={generation.output!.imageUrl} alt={generation.stageLabel} className="h-40 w-full cursor-zoom-in object-cover" /></PhotoView>
                              <div className="p-3">
                                <div className="flex items-center justify-between gap-2"><span className="text-sm font-bold">{generation.stageLabel || getWorkflowStageDefinition(generation.stageKey)?.name}</span><span className="text-[11px] text-muted-foreground">{generation.channel === 'miniprogram' ? '小程序' : '后台'}</span></div>
                                <div className="mt-3 flex items-center justify-between">
                                  <span className="text-xs text-muted-foreground">{formatTime(generation.createdAt)}</span>
                                  {generation.isSelectedBaseline ? <Badge className="border-none bg-emerald-100 text-emerald-700">已采用</Badge> : ['base_render', 'soft_furnishing'].includes(generation.stageKey || '') ? <Button size="sm" variant="outline" className="h-8 rounded-xl" onClick={() => selectBaseline(generation)}>采用</Button> : null}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </section>

                  <aside className="space-y-4">
                    <div className="rounded-3xl border bg-card p-6 shadow-sm">
                      <div className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">推荐下一步</div>
                      <div className="mt-3 text-xl font-black">{getWorkflowStageDefinition(workflow.currentStageKey)?.name || '继续完善方案'}</div>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{getWorkflowStageDefinition(workflow.currentStageKey)?.description}</p>
                      <Button className="mt-5 w-full rounded-2xl bg-zinc-950 text-white hover:bg-zinc-800" disabled={workflowRunner.isRunning} onClick={() => runStage(workflow.currentStageKey)}>
                        {workflowRunner.runningStageKey === workflow.currentStageKey ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Sparkles size={16} className="mr-2" />}
                        {getWorkflowStageDefinition(workflow.currentStageKey)?.actionLabel || '执行下一步'}
                      </Button>
                      <div className="mt-3 text-center text-xs text-muted-foreground">预计 {capabilities?.actions.find((item) => item.stageKey === workflow.currentStageKey)?.credits || 0} 点 · 生成前再次确认</div>
                    </div>

                    <div className="rounded-3xl border bg-card p-5 shadow-sm">
                      <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setAdvancedOpen((open) => !open)}>
                        <div><div className="font-black">更多设计工具</div><div className="mt-1 text-xs text-muted-foreground">仅在需要时使用</div></div>
                        <ChevronDown size={17} className={cn('transition', advancedOpen && 'rotate-180')} />
                      </button>
                      {advancedOpen ? (
                        <div className="mt-4 space-y-2">
                          {ADVANCED_WORKFLOW_TOOLS.map((tool) => {
                            const action = workflowRunner.actions.find((item) => item.stageKey === tool.key);
                            return <Button key={tool.key} variant="outline" className="h-auto w-full justify-start rounded-2xl px-4 py-3 text-left" disabled={!action || action.status === 'blocked' || workflowRunner.isRunning} onClick={() => runStage(tool.key)}><span><span className="block font-bold">{tool.name}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{action?.disabledReason || tool.outputHint}</span></span></Button>;
                          })}
                        </div>
                      ) : null}
                    </div>
                  </aside>
                </div>
              </>
            )}
          </div>
        )}

        <Modal
          open={wizardOpen}
          title="开始新设计"
          width={760}
          destroyOnHidden
          footer={null}
          onCancel={() => setWizardOpen(false)}
        >
          <div className="max-h-[72vh] overflow-y-auto pr-1">
            <div className="mb-5">
              <Typography.Text type="secondary">第 {wizardStep} / 3 步 · {wizardStep === 1 ? '选择客户' : wizardStep === 2 ? '准备素材' : '选择想要的成果'}</Typography.Text>
            </div>
            <Steps
              className="mb-6"
              current={wizardStep - 1}
              size="small"
              items={[{ title: '选择客户' }, { title: '准备素材' }, { title: '选择成果' }]}
            />

            {wizardStep === 1 ? (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => { setWizardOpen(false); setWorkbenchView('quick'); }}
                  className="flex w-full items-center justify-between rounded-2xl border border-dashed p-4 text-left hover:bg-muted/50"
                >
                  <span><span className="block font-bold">无客户，作为临时任务</span><span className="mt-1 block text-xs text-muted-foreground">进入快速工具，成果不会自动归入客户方案。</span></span>
                  <ArrowRight size={18} className="text-muted-foreground" />
                </button>
                {leadsLoading ? <div className="py-12 text-center text-sm text-muted-foreground">正在加载客户...</div> : leads.map((lead) => (
                  <button key={lead.id} type="button" onClick={() => setWizardLeadId(lead.id)} className={cn('flex w-full items-center justify-between rounded-2xl border p-4 text-left', wizardLeadId === lead.id ? 'border-zinc-950 bg-zinc-950 text-white' : 'hover:bg-muted/50')}>
                    <span><span className="block font-bold">{lead.name}</span><span className={cn('mt-1 block text-xs', wizardLeadId === lead.id ? 'text-zinc-300' : 'text-muted-foreground')}>{lead.communityName || lead.phone} · {lead.floorPlans.length} 份户型</span></span>
                    {wizardLeadId === lead.id ? <Check size={18} /> : null}
                  </button>
                ))}
              </div>
            ) : null}

            {wizardStep === 2 ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <button type="button" onClick={() => setSourceMode('floor_plan')} className={cn('rounded-2xl border p-4 text-left', sourceMode === 'floor_plan' && 'border-zinc-950 bg-zinc-950 text-white')}><div className="font-bold">使用正式户型</div><div className={cn('mt-1 text-xs', sourceMode === 'floor_plan' ? 'text-zinc-300' : 'text-muted-foreground')}>仅显示已完成的 v4 户型，并带入控制图、尺寸和门窗。</div></button>
                  <button type="button" onClick={() => setSourceMode('upload')} className={cn('rounded-2xl border p-4 text-left', sourceMode === 'upload' && 'border-zinc-950 bg-zinc-950 text-white')}><div className="font-bold">上传现场或参考图</div><div className={cn('mt-1 text-xs', sourceMode === 'upload' ? 'text-zinc-300' : 'text-muted-foreground')}>适合还没有正式户型的客户。</div></button>
                </div>
                {sourceMode === 'floor_plan' ? (
                  <div className="space-y-2">
                    {selectedWizardLead?.floorPlans.length ? selectedWizardLead.floorPlans.map((plan) => <button key={plan.id} type="button" onClick={() => setSourceFloorPlanId(plan.id)} className={cn('flex w-full items-center justify-between rounded-2xl border p-4 text-left', sourceFloorPlanId === plan.id && 'border-emerald-500 bg-emerald-50')}><span><span className="block font-bold">{plan.name || '未命名户型'}</span><span className="mt-1 block text-xs text-muted-foreground">{plan.createdAt ? formatTime(plan.createdAt) : '已关联客户'}</span></span>{sourceFloorPlanId === plan.id ? <Check size={18} className="text-emerald-700" /> : null}</button>) : <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">当前客户没有已完成的 v4 正式户型，请完成量房或改为上传图片。</div>}
                  </div>
                ) : (
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="flex min-h-56 w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed bg-muted/30">
                    {sourceImage ? <img src={sourceImage} alt="来源图" className="h-64 w-full object-contain" /> : <span className="text-center text-sm text-muted-foreground"><Upload size={24} className="mx-auto mb-3" />点击上传一张图片</span>}
                  </button>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
              </div>
            ) : null}

            {wizardStep === 3 ? (
              <div className="space-y-4">
                {(['direction', 'base_render'] as AiWorkflowStageKey[]).map((stageKey) => {
                  const action = capabilities?.actions.find((item) => item.key === stageKey);
                  return <button key={stageKey} type="button" disabled={!action?.enabled} onClick={() => setGoalStage(stageKey)} className={cn('w-full rounded-2xl border p-5 text-left', goalStage === stageKey ? 'border-zinc-950 bg-zinc-950 text-white' : 'hover:bg-muted/50', !action?.enabled && 'cursor-not-allowed opacity-50')}><div className="flex items-start justify-between gap-4"><span><span className="block font-black">{action?.label || getWorkflowStageDefinition(stageKey)?.name}</span><span className={cn('mt-2 block text-sm leading-6', goalStage === stageKey ? 'text-zinc-300' : 'text-muted-foreground')}>{action?.shortDescription}</span><span className={cn('mt-2 block text-xs', goalStage === stageKey ? 'text-zinc-400' : 'text-muted-foreground')}>{action?.resultBoundary}</span></span><Badge variant={goalStage === stageKey ? 'secondary' : 'outline'}>{action?.credits || 0} 点</Badge></div></button>;
                })}
                <div className="rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">首个成功版本会自动成为当前方案；之后重新生成只会增加候选，不会覆盖已认可版本。</div>
              </div>
            ) : null}

            <Flex justify={wizardStep > 1 ? 'space-between' : 'flex-end'} align="center" gap={8} wrap="wrap" className="mt-6">
              {wizardStep > 1 ? <Button variant="outline" className="rounded-2xl" onClick={() => setWizardStep((step) => step - 1)}>上一步</Button> : null}
              {wizardStep < 3 ? <Button className="rounded-2xl" disabled={wizardStep === 1 ? !wizardLeadId : sourceMode === 'floor_plan' ? !sourceFloorPlanId : !sourceImage} onClick={() => setWizardStep((step) => step + 1)}>下一步</Button> : <Button className="rounded-2xl bg-zinc-950 text-white" disabled={creating || scenarioPrice > (capabilities?.account.availableBalance || 0)} onClick={createAndRun}>{creating ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Sparkles size={16} className="mr-2" />}创建并开始 · {scenarioPrice} 点</Button>}
            </Flex>
          </div>
        </Modal>

        <Drawer
          open={timelineOpen}
          title="方案时间线"
          width={520}
          destroyOnHidden
          onClose={() => setTimelineOpen(false)}
        >
          <Typography.Paragraph type="secondary" className="!mt-0">
            查看后台和小程序产生的全部版本、失败原因和当前定稿。
          </Typography.Paragraph>
            <div className="mt-6 space-y-4">
              {generations.map((generation) => <div key={generation.id} className="rounded-2xl border p-4"><div className="flex items-start justify-between gap-3"><div><div className="font-bold">{generation.stageLabel || getWorkflowStageDefinition(generation.stageKey)?.name || '未命名步骤'}</div><div className="mt-1 text-xs text-muted-foreground">{formatTime(generation.createdAt)} · {generation.channel === 'miniprogram' ? '小程序' : '后台'}</div></div><StateBadge state={generation.status === 'failed' ? 'failed' : ['created', 'pending', 'processing'].includes(generation.status) ? 'processing' : generation.isSelectedBaseline ? 'ready' : 'review'} /></div>{generation.output?.imageUrl ? <PhotoView src={generation.output.imageUrl}><img src={generation.output.imageUrl} alt="版本成果" className="mt-4 h-52 w-full cursor-zoom-in rounded-2xl object-cover" /></PhotoView> : <div className="mt-4 rounded-2xl bg-muted p-5 text-sm text-muted-foreground">{generation.errorMessage || '正在等待生成结果'}</div>}</div>)}
            </div>
        </Drawer>
        {workflowRunner.cropDialog}
      </main>
    </PhotoProvider>
  );
}

function WorkbenchTabs({ view, onChange }: { view: WorkbenchView; onChange: (view: WorkbenchView) => void }) {
  return (
    <div aria-label="AI 设计工作区" className="inline-flex rounded-lg border bg-muted/40 p-1" role="group">
      {([{ key: 'workflows', label: '客户方案' }, { key: 'quick', label: '快速工具' }, { key: 'assistant', label: 'AI 助手' }] as Array<{ key: WorkbenchView; label: string }>).map((item) => (
        <button
          aria-pressed={view === item.key}
          className={cn('rounded-md px-4 py-2 text-sm font-semibold transition', view === item.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
          id={`ai-workbench-tab-${item.key}`}
          key={item.key}
          onClick={() => onChange(item.key)}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function StateBadge({ state }: { state: WorkflowFilter }) {
  const config: Record<WorkflowFilter, { label: string; className: string }> = {
    all: { label: '全部', className: 'bg-muted text-muted-foreground' },
    not_started: { label: '待开始', className: 'bg-amber-100 text-amber-700' },
    review: { label: '待选稿', className: 'bg-blue-100 text-blue-700' },
    processing: { label: '处理中', className: 'bg-violet-100 text-violet-700' },
    failed: { label: '生成失败', className: 'bg-red-100 text-red-700' },
    ready: { label: '可深化', className: 'bg-emerald-100 text-emerald-700' },
  };
  return <Badge className={cn('shrink-0 border-none', config[state].className)}>{config[state].label}</Badge>;
}

export default function AiScenariosPage() {
  return <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">正在加载 AI 设计工作台...</div>}><AiScenariosPageContent /></Suspense>;
}
