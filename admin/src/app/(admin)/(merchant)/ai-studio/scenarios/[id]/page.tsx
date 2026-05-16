'use client';

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Clock, Copy, ExternalLink, Loader2, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { notify } from '@/components/ui/operation-feedback';
import { useFetch } from '@/hooks/useFetch';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { getWorkflowStageDefinition, type AiWorkflowStageKey } from '@/lib/ai/workflow-stages';

interface WorkflowGeneration {
  id: string;
  stageKey?: AiWorkflowStageKey;
  stageLabel?: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  isSelectedBaseline: boolean;
  input?: {
    customPrompt?: string;
  };
  output?: { imageUrl?: string; promptUsed?: string };
  errorMessage?: string;
  createdAt: string;
}

interface WorkflowSummary {
  id: string;
  title: string;
  sourceImage?: string;
  sourceAssetRole?: string;
  currentStageKey: AiWorkflowStageKey;
  currentStageLabel?: string;
  generationCount: number;
  updatedAt: string;
}

interface WorkflowLeadSummary {
  id: string;
  name: string;
  phone: string;
  status: string;
  stylePreference?: string;
  communityName?: string;
  floorPlans: Array<{ id: string; name?: string }>;
  followUpCount: number;
}

interface WorkflowDetail {
  workflow: WorkflowSummary;
  lead: WorkflowLeadSummary;
  generations: WorkflowGeneration[];
}

function formatTime(value?: string) {
  if (!value) return '--';
  return new Date(value).toLocaleString('zh-CN');
}

function getGenerationPrompt(generation?: WorkflowGeneration | null) {
  return generation?.output?.promptUsed || generation?.input?.customPrompt || '';
}

export default function ScenarioDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const { data, isLoading } = useFetch<WorkflowDetail>(id ? `/api/ai/workflows/${id}` : null);

  if (isLoading && !data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <Loader2 className="animate-spin text-amber-500" size={40} />
        <p className="font-medium text-muted-foreground">正在加载方案会话详情...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-lg font-bold">未找到对应的方案会话</p>
        <Button variant="outline" onClick={() => router.push('/ai-studio/scenarios')}>
          返回工作流
        </Button>
      </div>
    );
  }

  const { workflow, lead, generations } = data;

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
      <div className="min-h-screen bg-[linear-gradient(180deg,#fffdf7_0%,#ffffff_46%,#fcfcfc_100%)] text-[#171717]">
        <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-4">
            <Button variant="ghost" className="rounded-xl px-0 hover:bg-transparent" onClick={() => router.push(`/ai-studio/scenarios?leadId=${lead.id}`)}>
              <ArrowLeft size={16} className="mr-2" />
              返回该线索工作流
            </Button>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-3xl font-black tracking-tight">{workflow.title}</h1>
                <Badge className="rounded-full border-none bg-amber-100 text-amber-700">
                  {workflow.currentStageLabel || getWorkflowStageDefinition(workflow.currentStageKey)?.name}
                </Badge>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                当前方案会话绑定到客户线索 {lead.name}，所有产物、定稿和时间线都会跟随这条线索沉淀。
              </p>
            </div>
          </div>

          <div className="grid gap-3 rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm sm:grid-cols-2">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">客户</div>
              <div className="mt-2 font-bold">{lead.name}</div>
              <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                <Phone size={14} />
                {lead.phone}
              </div>
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">线索摘要</div>
              <div className="mt-2 text-sm font-medium">
                {lead.communityName || '未登记小区'} · {lead.stylePreference || '待沟通风格'}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {lead.floorPlans.length} 份户型素材 · {lead.followUpCount} 条跟进记录
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
          <section className="space-y-4">
            {workflow.sourceImage ? (
              <div className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
                <div className="border-b border-zinc-100 px-6 py-4">
                  <div className="flex items-center gap-2 text-sm font-bold">起点素材</div>
                </div>
                <div className="grid gap-4 p-6 lg:grid-cols-[320px_minmax(0,1fr)]">
                  <PhotoView src={workflow.sourceImage}>
                    <img
                      src={workflow.sourceImage}
                      alt="方案来源素材"
                      className="h-56 w-full cursor-zoom-in rounded-[24px] object-cover"
                    />
                  </PhotoView>
                  <div className="space-y-3">
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground">
                        来源角色
                      </div>
                      <div className="mt-2 text-sm font-medium">{workflow.sourceAssetRole || '-'}</div>
                    </div>
                    <div className="text-sm leading-6 text-muted-foreground">
                      这张图是当前方案会话的最初来源图。后续生成步骤都围绕这张毛坯图或参考图继续推进。
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {generations.length === 0 ? (
              <div className="rounded-[28px] border border-dashed border-zinc-300 bg-white px-8 py-20 text-center shadow-sm">
                这个方案会话还没有产物。
              </div>
            ) : (
              generations.map((generation) => (
                <div key={generation.id} className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-6 py-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-black">
                          {generation.stageLabel ||
                            getWorkflowStageDefinition(generation.stageKey)?.name ||
                            '未命名步骤'}
                        </h2>
                        {generation.isSelectedBaseline ? (
                          <Badge className="rounded-full border-none bg-emerald-100 text-emerald-700">
                            当前定稿
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">{formatTime(generation.createdAt)}</div>
                    </div>

                    {generation.output?.imageUrl ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          className="rounded-2xl"
                          onClick={() => handleCopyPrompt(generation)}
                        >
                          <Copy size={14} className="mr-2" />
                          复制提示词
                        </Button>
                        <Button
                          variant="outline"
                          className="rounded-2xl"
                          onClick={() => window.open(generation.output?.imageUrl, '_blank')}
                        >
                          <ExternalLink size={14} className="mr-2" />
                          查看原图
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  <div className="p-6">
                    {generation.output?.imageUrl ? (
                      <PhotoView src={generation.output.imageUrl}>
                        <img
                          src={generation.output.imageUrl}
                          alt={generation.stageLabel || generation.stageKey || '步骤产物'}
                          className="h-[420px] w-full cursor-zoom-in rounded-[24px] object-cover"
                        />
                      </PhotoView>
                    ) : (
                      <div className="rounded-[24px] border border-dashed border-zinc-200 bg-zinc-50 px-6 py-16 text-center text-sm text-muted-foreground">
                        {generation.errorMessage || '该步骤暂未返回图片。'}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </section>

          <aside className="space-y-4">
            <div className="rounded-[28px] border border-zinc-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-bold">
                <Clock size={16} className="text-muted-foreground" /> 会话信息
              </div>
              <div className="mt-5 space-y-4 text-sm">
                <div className="rounded-2xl bg-zinc-50 p-4">
                  <div className="text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground">当前阶段</div>
                  <div className="mt-2 font-bold">{workflow.currentStageLabel || getWorkflowStageDefinition(workflow.currentStageKey)?.name}</div>
                </div>
                <div className="rounded-2xl bg-zinc-50 p-4">
                  <div className="text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground">产物数量</div>
                  <div className="mt-2 font-bold">{workflow.generationCount}</div>
                </div>
                <div className="rounded-2xl bg-zinc-50 p-4">
                  <div className="text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground">最近更新</div>
                  <div className="mt-2 font-bold">{formatTime(workflow.updatedAt)}</div>
                </div>
              </div>
            </div>
          </aside>
        </div>
       </main>
     </div>
    </PhotoProvider>
  );
}
