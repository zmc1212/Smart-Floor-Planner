'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Checkbox, Empty, Flex, Input, Modal, Select, Spin, Tag, Typography } from 'antd';
import { Loader2, Plus, Send } from 'lucide-react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import AiQuotaBar from '@/components/ai-studio/AiQuotaBar';
import { notify } from '@/components/ui/operation-feedback';
import { useFetch } from '@/hooks/useFetch';
import { cn } from '@/lib/utils';

type FloorPlanOption = {
  id: string;
  name?: string;
  status?: string;
};

type LeadSummary = {
  id: string;
  name: string;
  phone?: string;
  communityName?: string;
  status?: string;
  floorPlans: FloorPlanOption[];
  workflowCount?: number;
  latestWorkflowTitle?: string;
};

type Generation = {
  id: string;
  status: string;
  stageKey?: string | null;
  parentGenerationId?: string;
  input?: { userMessage?: string; customPrompt?: string };
  output?: { imageUrl?: string; promptUsed?: string };
  errorMessage?: string | null;
  createdAt: string;
};

type WorkflowSummary = {
  id: string;
  title: string;
  updatedAt: string;
  generationCount?: number;
  latestGeneration?: Generation;
};

type WorkflowDetail = {
  workflow: WorkflowSummary & {
    sourceFloorPlanId?: string;
    selectedGenerationId?: string;
  };
  lead: {
    id: string;
    name: string;
    communityName?: string;
    floorPlans: FloorPlanOption[];
  };
  generations: Generation[];
  publishedScheme?: {
    title: string;
    publishedAt?: string;
    generationIds: string[];
  } | null;
};

type DesignCapabilities = {
  account: { balance: number; frozenBalance: number; availableBalance: number };
};

function generationImage(generation: Generation) {
  return typeof generation.output?.imageUrl === 'string' ? generation.output.imageUrl : '';
}

function isBusy(generation: Generation) {
  return ['created', 'pending', 'processing'].includes(generation.status);
}

function AiWorkbenchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialLeadId = searchParams.get('leadId') || '';
  const initialWorkflowId = searchParams.get('workflowId') || '';

  const [leadSearch, setLeadSearch] = useState('');
  const [selectedLeadId, setSelectedLeadId] = useState(initialLeadId);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(initialWorkflowId);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createFloorPlanId, setCreateFloorPlanId] = useState('');
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState('');
  const [sendingTurn, setSendingTurn] = useState(false);
  const [baselineId, setBaselineId] = useState('');
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendTitle, setSendTitle] = useState('');
  const [sendingScheme, setSendingScheme] = useState(false);

  const leadsUrl = `/api/ai/workflow-leads?limit=100${leadSearch.trim() ? `&search=${encodeURIComponent(leadSearch.trim())}` : ''}`;
  const { data: leadsData, isLoading: leadsLoading, mutate: mutateLeads } = useFetch<LeadSummary[]>(leadsUrl);
  const { data: capabilities, mutate: mutateCapabilities } = useFetch<DesignCapabilities>('/api/ai/design-capabilities');
  const { data: workflowsData, mutate: mutateWorkflows, isLoading: workflowsLoading } = useFetch<WorkflowSummary[]>(
    selectedLeadId ? `/api/ai/workflows?leadId=${encodeURIComponent(selectedLeadId)}&limit=50` : null
  );
  const {
    data: detail,
    mutate: mutateDetail,
    isLoading: detailLoading,
  } = useFetch<WorkflowDetail>(selectedWorkflowId ? `/api/ai/workflows/${selectedWorkflowId}` : null, {
    refreshInterval: (payload) => {
      const generations = payload && typeof payload === 'object' && 'data' in payload
        ? (payload as { data?: WorkflowDetail }).data?.generations || []
        : [];
      return generations.some(isBusy) ? 2500 : 0;
    },
  });

  const leads = useMemo(() => {
    const items = [...(leadsData || [])];
    items.sort((left, right) => Number(Boolean(right.floorPlans?.length)) - Number(Boolean(left.floorPlans?.length)));
    return items;
  }, [leadsData]);
  const selectedLead = leads.find((lead) => lead.id === selectedLeadId) || null;
  const workflows = useMemo(() => workflowsData || [], [workflowsData]);
  const generations = useMemo(
    () => [...(detail?.generations || [])].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)),
    [detail?.generations]
  );
  const succeededImages = generations.filter((generation) => generation.status === 'succeeded' && generationImage(generation));
  const eligibleFloorPlans = selectedLead?.floorPlans || detail?.lead.floorPlans || [];

  useEffect(() => {
    if (!selectedLeadId && initialLeadId) setSelectedLeadId(initialLeadId);
  }, [initialLeadId, selectedLeadId]);

  useEffect(() => {
    if (selectedWorkflowId || !workflows.length) return;
    const preferred = initialWorkflowId && workflows.some((item) => item.id === initialWorkflowId)
      ? initialWorkflowId
      : workflows[0]?.id;
    if (preferred) setSelectedWorkflowId(preferred);
  }, [initialWorkflowId, selectedWorkflowId, workflows]);

  useEffect(() => {
    const lastSucceeded = [...succeededImages].reverse()[0];
    if (!baselineId && lastSucceeded) setBaselineId(lastSucceeded.id);
    if (baselineId && !succeededImages.some((item) => item.id === baselineId) && lastSucceeded) {
      setBaselineId(lastSucceeded.id);
    }
  }, [baselineId, succeededImages]);

  useEffect(() => {
    setSelectedImageIds([]);
    setBaselineId('');
    setMessage('');
  }, [selectedWorkflowId]);

  const syncQuery = (leadId: string, workflowId?: string) => {
    const params = new URLSearchParams();
    if (leadId) params.set('leadId', leadId);
    if (workflowId) params.set('workflowId', workflowId);
    router.replace(params.toString() ? `/ai-studio/scenarios?${params}` : '/ai-studio/scenarios');
  };

  const selectLead = (leadId: string) => {
    setSelectedLeadId(leadId);
    setSelectedWorkflowId('');
    syncQuery(leadId);
  };

  const selectWorkflow = (workflowId: string) => {
    setSelectedWorkflowId(workflowId);
    syncQuery(selectedLeadId, workflowId);
  };

  const openCreate = () => {
    if (!selectedLead) {
      notify.error('请先选择客户线索');
      return;
    }
    if (!eligibleFloorPlans.length) {
      notify.error('该线索还没有合格的正式户型，请先完成量房');
      return;
    }
    setCreateTitle(selectedLead.workflowCount ? `方案 ${(selectedLead.workflowCount || 0) + 1}` : '方案 1');
    setCreateFloorPlanId(eligibleFloorPlans[0]?.id || '');
    setCreateOpen(true);
  };

  const createConversation = async () => {
    if (!selectedLeadId || !createFloorPlanId) return;
    setCreating(true);
    try {
      const response = await fetch('/api/ai/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: selectedLeadId,
          title: createTitle.trim() || '方案 1',
          sourceFloorPlanId: createFloorPlanId,
          sourceAssetRole: 'floor_plan',
          currentStageKey: 'conversation',
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '创建方案对话失败');
      const workflowId = result.data?.id as string;
      notify.success('已创建方案对话');
      setCreateOpen(false);
      await Promise.all([mutateLeads(), mutateWorkflows()]);
      if (workflowId) {
        setSelectedWorkflowId(workflowId);
        syncQuery(selectedLeadId, workflowId);
      }
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '创建方案对话失败');
    } finally {
      setCreating(false);
    }
  };

  const renameConversation = async (title: string) => {
    if (!selectedWorkflowId || !title.trim()) return;
    try {
      const response = await fetch(`/api/ai/workflows/${selectedWorkflowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rename', title: title.trim() }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '重命名失败');
      notify.success('方案名称已更新');
      await Promise.all([mutateWorkflows(), mutateDetail()]);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '重命名失败');
    }
  };

  const sendTurn = async () => {
    if (!selectedWorkflowId || !message.trim()) return;
    setSendingTurn(true);
    try {
      const response = await fetch(`/api/ai/workflows/${selectedWorkflowId}/chat-turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message.trim(),
          baselineGenerationId: baselineId || undefined,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '出图失败');
      setMessage('');
      await Promise.all([mutateDetail(), mutateCapabilities(), mutateWorkflows()]);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '出图失败');
    } finally {
      setSendingTurn(false);
    }
  };

  const openSend = () => {
    if (!selectedImageIds.length) {
      notify.error('请先勾选要发给客户的效果图');
      return;
    }
    setSendTitle(detail?.publishedScheme?.title || detail?.workflow.title || '设计方案');
    setSendOpen(true);
  };

  const sendScheme = async () => {
    if (!selectedLeadId || !selectedWorkflowId) return;
    setSendingScheme(true);
    try {
      const response = await fetch(`/api/leads/${selectedLeadId}/ai-scheme-publications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: selectedWorkflowId,
          title: sendTitle.trim() || detail?.workflow.title,
          generationIds: selectedImageIds,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '发送方案失败');
      notify.success('方案已发送给客户');
      setSendOpen(false);
      setSelectedImageIds([]);
      await mutateDetail();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '发送方案失败');
    } finally {
      setSendingScheme(false);
    }
  };

  const toggleSelectedImage = (generationId: string, checked: boolean) => {
    setSelectedImageIds((current) => checked
      ? [...current.filter((id) => id !== generationId), generationId]
      : current.filter((id) => id !== generationId));
  };

  return (
    <div className="flex h-[calc(100vh-64px)] min-h-[640px] flex-col gap-3 p-4">
      <Flex align="center" justify="space-between" gap={12} wrap>
        <div>
          <Typography.Title level={4} className="!mb-1">AI 工作台</Typography.Title>
          <Typography.Text type="secondary">选择客户线索，关联合格正式户型，在一个对话里多轮出图后发给客户。</Typography.Text>
        </div>
        <AiQuotaBar quota={capabilities?.account || null} />
      </Flex>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[260px_240px_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col rounded-xl border bg-card">
          <div className="border-b p-3">
            <Input.Search allowClear placeholder="搜索客户或小区" value={leadSearch} onChange={(event) => setLeadSearch(event.target.value)} />
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {leadsLoading ? <div className="p-4 text-sm text-muted-foreground">正在加载线索…</div> : null}
            {!leadsLoading && !leads.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无客户线索" /> : null}
            {leads.map((lead) => (
              <button
                key={lead.id}
                type="button"
                onClick={() => selectLead(lead.id)}
                className={cn('mb-2 w-full rounded-lg border p-3 text-left', selectedLeadId === lead.id ? 'border-emerald-500 bg-emerald-50' : 'border-border bg-background')}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{lead.name}</span>
                  {lead.floorPlans?.length ? <Tag color="green">可设计</Tag> : <Tag>待量房</Tag>}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{lead.communityName || '未登记小区'} · {lead.workflowCount || 0} 个方案</div>
              </button>
            ))}
          </div>
        </section>

        <section className="flex min-h-0 flex-col rounded-xl border bg-card">
          <div className="flex items-center justify-between gap-2 border-b p-3">
            <Typography.Text strong>方案对话</Typography.Text>
            <Button size="small" icon={<Plus size={14} />} onClick={openCreate} disabled={!selectedLeadId}>新建</Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {!selectedLeadId ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先选择客户" /> : null}
            {selectedLeadId && workflowsLoading ? <div className="p-4 text-sm text-muted-foreground">正在加载对话…</div> : null}
            {selectedLeadId && !workflowsLoading && !workflows.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有方案对话" /> : null}
            {workflows.map((workflow) => (
              <button
                key={workflow.id}
                type="button"
                onClick={() => selectWorkflow(workflow.id)}
                className={cn('mb-2 w-full rounded-lg border p-3 text-left', selectedWorkflowId === workflow.id ? 'border-emerald-500 bg-emerald-50' : 'border-border bg-background')}
              >
                <div className="font-medium">{workflow.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">{workflow.generationCount || 0} 轮出图</div>
              </button>
            ))}
          </div>
        </section>

        <section className="flex min-h-0 flex-col rounded-xl border bg-card">
          {!selectedWorkflowId ? (
            <div className="flex flex-1 items-center justify-center p-8"><Empty description="选择或新建一个方案对话开始出图" /></div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 border-b p-3">
                <Input
                  key={detail?.workflow.id || selectedWorkflowId}
                  defaultValue={detail?.workflow.title}
                  onBlur={(event) => {
                    const next = event.target.value.trim();
                    if (next && next !== detail?.workflow.title) void renameConversation(next);
                  }}
                  className="max-w-sm font-medium"
                />
                <Flex gap={8} wrap>
                  {detail?.publishedScheme ? <Tag color="green">已发给客户 · {detail.publishedScheme.generationIds.length} 张</Tag> : <Tag>仅内部可见</Tag>}
                  <Button type="primary" icon={<Send size={14} />} onClick={openSend} disabled={!succeededImages.length}>
                    发送给客户{selectedImageIds.length ? `（${selectedImageIds.length}）` : ''}
                  </Button>
                </Flex>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-4">
                {detailLoading && !detail ? <div className="flex justify-center py-12"><Spin /></div> : null}
                <PhotoProvider>
                  <div className="flex flex-col gap-4">
                    {generations.map((generation) => {
                      const imageUrl = generationImage(generation);
                      const userMessage = generation.input?.userMessage || generation.input?.customPrompt || '本轮出图';
                      return (
                        <div key={generation.id} className="rounded-xl border bg-muted/20 p-3">
                          <div className="mb-2 text-sm">{userMessage}</div>
                          {isBusy(generation) ? (
                            <div className="flex h-40 items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
                              <Loader2 className="mr-2 animate-spin" size={16} />正在出图…
                            </div>
                          ) : null}
                          {generation.status === 'failed' ? (
                            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{generation.errorMessage || '本轮出图失败，请调整描述后重试'}</div>
                          ) : null}
                          {imageUrl ? (
                            <div className="space-y-2">
                              <PhotoView src={imageUrl}>
                                <img src={imageUrl} alt={userMessage} className="max-h-80 w-full cursor-zoom-in rounded-lg object-contain bg-black/5" />
                              </PhotoView>
                              <Flex gap={12} wrap>
                                <Checkbox checked={selectedImageIds.includes(generation.id)} onChange={(event) => toggleSelectedImage(generation.id, event.target.checked)}>发给客户</Checkbox>
                                <Button size="small" type={baselineId === generation.id ? 'primary' : 'default'} onClick={() => setBaselineId(generation.id)}>
                                  {baselineId === generation.id ? '下一轮将基于此图' : '基于此图继续'}
                                </Button>
                              </Flex>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                    {!generations.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="用一句话描述本轮设计，例如「客厅暖光」" /> : null}
                  </div>
                </PhotoProvider>
              </div>
              <div className="border-t p-3">
                <Flex gap={8}>
                  <Input.TextArea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder={baselineId ? '基于选中效果图继续改，例如「再暗一点」' : '描述本轮设计，例如「客厅暖色灯光，保留户型结构」'}
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    onPressEnter={(event) => {
                      if (!event.shiftKey) {
                        event.preventDefault();
                        void sendTurn();
                      }
                    }}
                  />
                  <Button type="primary" loading={sendingTurn} onClick={() => void sendTurn()} disabled={!message.trim()}>出图</Button>
                </Flex>
              </div>
            </>
          )}
        </section>
      </div>

      <Modal title="新建方案对话" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => void createConversation()} confirmLoading={creating} okText="创建">
        <Flex vertical gap={12} className="pt-2">
          <div>
            <Typography.Text type="secondary">方案名称</Typography.Text>
            <Input className="mt-1" value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} placeholder="例如 灯光设计" />
          </div>
          <div>
            <Typography.Text type="secondary">关联正式户型</Typography.Text>
            <Select
              className="mt-1 w-full"
              value={createFloorPlanId || undefined}
              onChange={setCreateFloorPlanId}
              options={eligibleFloorPlans.map((plan) => ({ value: plan.id, label: plan.name || '正式户型' }))}
            />
          </div>
        </Flex>
      </Modal>

      <Modal title="发送给客户" open={sendOpen} onCancel={() => setSendOpen(false)} onOk={() => void sendScheme()} confirmLoading={sendingScheme} okText="确认发送">
        <Flex vertical gap={12} className="pt-2">
          <Typography.Text type="secondary">客户将在小程序项目里看到这一套方案，共 {selectedImageIds.length} 张效果图。</Typography.Text>
          <Input value={sendTitle} onChange={(event) => setSendTitle(event.target.value)} placeholder="方案名称，例如 灯光设计" />
        </Flex>
      </Modal>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">正在加载 AI 工作台...</div>}>
      <AiWorkbenchPage />
    </Suspense>
  );
}
