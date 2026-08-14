'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useRef, useState, type Key } from 'react';
import {
  PageContainer,
  ProTable,
  type ActionType,
  type ProColumns,
} from '@ant-design/pro-components';
import {
  Button,
  Alert,
  Descriptions,
  Drawer,
  Empty,
  Flex,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Space,
  Steps,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import { useRouter } from 'next/navigation';
import { Archive, BadgeCheck, ClipboardCheck, Eye, FilePenLine, LayoutTemplate, MessageSquare, Plus, RotateCcw, Trash2, Undo2, Users } from 'lucide-react';
import ModuleOverview from '@/components/admin/ModuleOverview';
import { notify } from '@/components/ui/operation-feedback';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { getLeadNextAction, getLeadStatusLabel, getLeadWorkflowStep, LEAD_WORKFLOW_STEPS } from '@/lib/lead-status';

type StaffReference = {
  _id: string;
  displayName?: string;
  username?: string;
  role?: string;
};

type FollowUpRecord = {
  content?: string;
  operator?: string;
  createdAt?: string | Date;
};

type FloorPlan = {
  _id: string;
  name?: string | null;
  display?: {
    projectTitle?: string | null;
    projectSubtitle?: string | null;
  } | null;
  source?: string | null;
  createdAt?: string;
  layoutData?: unknown;
  externalSource?: {
    layoutLabel?: string | null;
  } | null;
};

type Lead = {
  _id: string;
  name: string;
  phone?: string | null;
  communityName?: string | null;
  area?: number | null;
  stylePreference?: string | null;
  source?: string | null;
  status: string;
  acquisitionStatus?: 'pending_confirmation' | 'confirmed';
  acquiredAt?: string | null;
  archivedAt?: string | null;
  archivedBy?: StaffReference | string | null;
  archiveReason?: string | null;
  archiveNote?: string | null;
  acquisitionCommissionStatus?: string | null;
  convertedOn?: string | null;
  convertedAt?: string | null;
  convertedBy?: StaffReference | string | null;
  contractAmount?: number | null;
  conversionNote?: string | null;
  conversionActions?: {
    canMarkConverted: boolean;
    canRevertConversion: boolean;
  };
  promoterId?: StaffReference | string | null;
  assignedTo?: StaffReference | string | null;
  floorPlanIds?: FloorPlan[];
  primaryFloorPlanId?: FloorPlan | string | null;
  followUpRecords?: FollowUpRecord[];
  createdAt?: string;
};

type LifecycleImpact = {
  leadId: string;
  unavailable?: boolean;
  floorPlanCount?: number;
  aiWorkflowCount?: number;
  aiGenerationCount?: number;
  inFlightAiCount?: number;
  followUpCount?: number;
  commissionCount?: number;
  hasAcquisition?: boolean;
  canArchive?: boolean;
  archiveBlockers?: string[];
  canPurge?: boolean;
  purgeBlockers?: string[];
};

type ArchiveBatchFailure = {
  leadId: string;
  name: string;
  status: string;
  reason: string;
};

const ARCHIVE_REASON_OPTIONS = [
  { label: '无意向', value: 'no_intent' },
  { label: '失联', value: 'lost_contact' },
  { label: '无效联系方式', value: 'invalid_contact' },
  { label: '重复线索', value: 'duplicate' },
  { label: '误录', value: 'mistaken_entry' },
  { label: '其他', value: 'other' },
];

const ARCHIVE_REASON_LABELS = Object.fromEntries(
  ARCHIVE_REASON_OPTIONS.map((item) => [item.value, item.label])
);

type LeadListResponse = {
  success: boolean;
  error?: string;
  data?: Lead[];
  pagination?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
};

const STATUS_OPTIONS = [
  { label: '新线索', value: 'new' },
  { label: '量房中', value: 'measuring' },
  { label: '方案设计', value: 'designing' },
  { label: '已签约', value: 'converted' },
  { label: '已关闭', value: 'closed' },
];

const STATUS_LABELS = Object.fromEntries(
  STATUS_OPTIONS.map((item) => [item.value, item.label])
);

function getFloorPlanSourceLabel(source?: string | null) {
  if (source === 'kujiale') return '酷家乐';
  if (source === 'template') return '模板';
  return '手动';
}

function getStatusColor(status: string) {
  if (status === 'measuring') return 'green';
  if (['measured', 'assigned', 'designing', 'quoting'].includes(status)) return 'blue';
  if (status === 'converted') return 'orange';
  if (status === 'closed') return 'default';
  return 'cyan';
}

function getStaffName(
  value: StaffReference | string | null | undefined
) {
  if (!value) return '';
  if (typeof value === 'object') return value.displayName || value.username || '';
  return value;
}

function formatDate(value?: string | Date) {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString('zh-CN');
}

function chinaDateValue() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function formatContractAmount(value?: number | null) {
  if (!value) return '-';
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
  }).format(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseLayoutData(layoutData: unknown): Record<string, unknown> | null {
  if (!layoutData) return null;
  if (typeof layoutData === 'string') {
    try {
      const parsed: unknown = JSON.parse(layoutData);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isRecord(layoutData) ? layoutData : null;
}

function isFormalSurveyPlan(plan: FloorPlan) {
  const layoutData = parseLayoutData(plan.layoutData);
  const surveyGraph = layoutData?.surveyGraph;
  return Boolean(
    layoutData?.version === 4 &&
    layoutData.measurementMode === 'surveying' &&
    isRecord(surveyGraph) &&
    surveyGraph.kind === 'survey-wall-graph'
  );
}

function getSurveyGraphStats(layoutData: unknown) {
  const graph = parseLayoutData(layoutData)?.surveyGraph;
  if (!isRecord(graph)) return { wallCount: 0, spaceCount: 0, openingCount: 0 };
  const floors = Array.isArray(graph.floors) ? graph.floors : [];
  const activeFloor = floors.find((floor) => isRecord(floor) && floor.id === graph.activeFloorId) || floors[0];
  if (!isRecord(activeFloor)) return { wallCount: 0, spaceCount: 0, openingCount: 0 };
  const walls = Array.isArray(activeFloor.walls) ? activeFloor.walls : [];
  const spaces = Array.isArray(activeFloor.spaces) ? activeFloor.spaces : [];
  const openings = Array.isArray(activeFloor.openings) ? activeFloor.openings : [];
  return {
    wallCount: walls.length,
    spaceCount: spaces.filter((space) => isRecord(space) && space.closed === true).length,
    openingCount: openings.length,
  };
}

export default function LeadsPage() {
  const actionRef = useRef<ActionType>(null);
  const leadListRequestRef = useRef<AbortController | null>(null);
  const leadDetailRequestRef = useRef<AbortController | null>(null);
  const confirmAction = useConfirmDialog();
  const router = useRouter();
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [newNote, setNewNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [archiveState, setArchiveState] = useState<'active' | 'archived'>('active');
  const [capabilities, setCapabilities] = useState({ canManageArchive: false, canPurge: false });
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [visibleLeads, setVisibleLeads] = useState<Lead[]>([]);
  const [archiveTargets, setArchiveTargets] = useState<Lead[]>([]);
  const [archiveImpacts, setArchiveImpacts] = useState<LifecycleImpact[]>([]);
  const [archiveReason, setArchiveReason] = useState<string>();
  const [archiveNote, setArchiveNote] = useState('');
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveFailures, setArchiveFailures] = useState<ArchiveBatchFailure[]>([]);
  const [purgeTarget, setPurgeTarget] = useState<Lead | null>(null);
  const [purgeImpact, setPurgeImpact] = useState<LifecycleImpact | null>(null);
  const [purgeConfirmation, setPurgeConfirmation] = useState('');
  const [overview, setOverview] = useState({ total: 0, measuring: 0, assigned: 0, converted: 0 });
  const [conversionOpen, setConversionOpen] = useState(false);
  const [conversionDate, setConversionDate] = useState(chinaDateValue());
  const [conversionAmount, setConversionAmount] = useState<number | null>(null);
  const [conversionNote, setConversionNote] = useState('');
  const [conversionSubmitting, setConversionSubmitting] = useState(false);
  const [revertConversionOpen, setRevertConversionOpen] = useState(false);
  const [revertReason, setRevertReason] = useState('');

  useEffect(() => () => {
    leadListRequestRef.current?.abort();
    leadDetailRequestRef.current?.abort();
  }, []);

  useEffect(() => {
    void fetch('/api/leads/capabilities')
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '读取线索操作权限失败');
        setCapabilities(result.data);
      })
      .catch((error) => notify.error(error instanceof Error ? error.message : '读取线索操作权限失败'));
  }, []);

  useEffect(() => {
    setSelectedRowKeys([]);
    void actionRef.current?.reload();
  }, [archiveState]);

  const refreshLeads = useCallback(async () => {
    await actionRef.current?.reload();
  }, []);

  const openLeadDetail = async (lead: Lead) => {
    leadDetailRequestRef.current?.abort();
    const controller = new AbortController();
    leadDetailRequestRef.current = controller;
    setSelectedLead(lead);
    try {
      const response = await fetch(`/api/leads/${lead._id}`, { signal: controller.signal });
      const result = await response.json();
      if (!controller.signal.aborted && response.ok && result.success) {
        setSelectedLead(result.data);
      } else if (!controller.signal.aborted) {
        notify.error(result.error || '线索详情加载失败');
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        notify.error(error instanceof Error ? error.message : '线索详情加载失败');
      }
    }
  };

  const closeLeadDetail = () => {
    leadDetailRequestRef.current?.abort();
    setSelectedLead(null);
    setNewNote('');
    setConversionOpen(false);
    setRevertConversionOpen(false);
    setRevertReason('');
  };

  const updateLead = async (
    leadId: string,
    updates: Record<string, unknown>,
    closeAfterSuccess = false
  ) => {
    try {
      const response = await fetch(`/api/leads/${leadId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '线索更新失败');
      setSelectedLead(result.data);
      notify.success('线索信息已更新');
      await refreshLeads();
      if (closeAfterSuccess) closeLeadDetail();
      return true;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '线索更新失败');
      return false;
    }
  };

  const openArchive = async (targets: Lead[]) => {
    if (!targets.length || archiveLoading) return;
    if (targets.length > 100) {
      notify.error('每次最多归档 100 条客户线索');
      return;
    }
    setArchiveLoading(true);
    try {
      const response = await fetch('/api/leads/archive-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: targets.map((lead) => lead._id) }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '归档预检失败');
      setArchiveTargets(targets);
      setArchiveImpacts(result.data || []);
      setArchiveReason(undefined);
      setArchiveNote('');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '归档预检失败');
    } finally {
      setArchiveLoading(false);
    }
  };

  const archiveLeads = async () => {
    if (!archiveReason || !archiveTargets.length) return;
    setArchiveLoading(true);
    try {
      const response = await fetch('/api/leads/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: archiveTargets.map((lead) => lead._id),
          reason: archiveReason,
          note: archiveNote,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '归档失败');
      const resultItems = (result.data || []) as Array<{
        leadId: string;
        status: string;
        impact?: LifecycleImpact;
      }>;
      const archivedCount = resultItems.filter((item) => item.status === 'archived').length;
      const failures = resultItems
        .filter((item) => item.status !== 'archived')
        .map((item) => ({
          leadId: item.leadId,
          name: archiveTargets.find((lead) => lead._id === item.leadId)?.name || `线索 ${item.leadId}`,
          status: item.status,
          reason: item.status === 'blocked'
            ? (item.impact?.archiveBlockers || ['存在运行中的 AI 任务']).join('；')
            : item.status === 'already_archived'
              ? '线索已归档，无需重复处理'
              : '无权访问或线索已不存在',
        }));
      const blockedCount = failures.length;
      if (archivedCount) notify.success(`已归档 ${archivedCount} 条客户线索`);
      if (blockedCount) {
        setArchiveFailures(failures);
        notify.error(`${blockedCount} 条线索未处理，已列出具体原因`);
      }
      if (selectedLead && archiveTargets.some((lead) => lead._id === selectedLead._id)) closeLeadDetail();
      setArchiveTargets([]);
      setArchiveImpacts([]);
      setSelectedRowKeys([]);
      await refreshLeads();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '归档失败');
    } finally {
      setArchiveLoading(false);
    }
  };

  const restoreLead = async (lead: Lead) => {
    if (deletingId) return;
    const confirmed = await confirmAction({
      title: '恢复客户线索',
      description: `恢复“${lead.name}”后，将重新出现在业务列表并可继续跟进。`,
      confirmText: '恢复',
    });
    if (!confirmed) return;
    setDeletingId(lead._id);
    try {
      const response = await fetch(`/api/leads/${lead._id}/restore`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '恢复失败');
      if (selectedLead?._id === lead._id) closeLeadDetail();
      notify.success('客户线索已恢复');
      await refreshLeads();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '恢复失败');
    } finally {
      setDeletingId(null);
    }
  };

  const openPurge = async (lead: Lead) => {
    if (deletingId) return;
    setDeletingId(lead._id);
    try {
      const response = await fetch(`/api/leads/${lead._id}/purge-preview`);
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '删除预检失败');
      setPurgeTarget(lead);
      setPurgeImpact(result.data);
      setPurgeConfirmation('');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '删除预检失败');
    } finally {
      setDeletingId(null);
    }
  };

  const purgeLead = async () => {
    if (!purgeTarget || purgeConfirmation !== purgeTarget.name || !purgeImpact?.canPurge) return;
    setDeletingId(purgeTarget._id);
    try {
      const response = await fetch(`/api/leads/${purgeTarget._id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmName: purgeConfirmation }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error([result.error, ...(result.blockers || [])].filter(Boolean).join('：'));
      if (selectedLead?._id === purgeTarget._id) closeLeadDetail();
      setPurgeTarget(null);
      setPurgeImpact(null);
      notify.success('空白客户线索已永久删除');
      await refreshLeads();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '永久删除失败');
    } finally {
      setDeletingId(null);
    }
  };

  const addFollowUp = async () => {
    if (!newNote.trim() || !selectedLead) return;
    setIsSubmitting(true);
    const records = [
      ...(selectedLead.followUpRecords || []),
      { content: newNote.trim(), operator: '管理员', createdAt: new Date().toISOString() },
    ];
    const succeeded = await updateLead(selectedLead._id, { followUpRecords: records });
    if (succeeded) setNewNote('');
    setIsSubmitting(false);
  };

  const openConversion = () => {
    setConversionDate(chinaDateValue());
    setConversionAmount(null);
    setConversionNote('');
    setConversionOpen(true);
  };

  const markConverted = async () => {
    if (!selectedLead || !conversionDate || conversionSubmitting) return;
    setConversionSubmitting(true);
    try {
      const response = await fetch(`/api/leads/${selectedLead._id}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          convertedOn: conversionDate,
          contractAmount: conversionAmount,
          conversionNote,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '标记已签约失败');
      setSelectedLead(result.data);
      setConversionOpen(false);
      notify.success('客户已标记为已签约');
      await refreshLeads();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '标记已签约失败');
    } finally {
      setConversionSubmitting(false);
    }
  };

  const revertConversion = async () => {
    if (!selectedLead || !revertReason.trim() || conversionSubmitting) return;
    setConversionSubmitting(true);
    try {
      const response = await fetch(`/api/leads/${selectedLead._id}/revert-conversion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: revertReason.trim() }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '撤销签约标记失败');
      setSelectedLead(result.data);
      setRevertConversionOpen(false);
      setRevertReason('');
      notify.success('签约标记已撤销');
      await refreshLeads();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '撤销签约标记失败');
    } finally {
      setConversionSubmitting(false);
    }
  };

  const columns: ProColumns<Lead>[] = [
    {
      title: '业务状态',
      dataIndex: 'status',
      valueType: 'select',
      valueEnum: STATUS_LABELS,
      width: 150,
      render: (_, lead) => <Tag color={getStatusColor(lead.status)}>{getLeadStatusLabel(lead.status)}</Tag>,
    },
    {
      title: '获客确认',
      dataIndex: 'acquisitionStatus',
      valueType: 'select',
      valueEnum: {
        pending_confirmation: { text: '待确认' },
        confirmed: { text: '已确认' },
      },
      width: 130,
      render: (_, lead) => (
        <Tag color={lead.acquisitionStatus === 'confirmed' ? 'green' : 'default'}>
          {lead.acquisitionStatus === 'confirmed' ? '已确认' : '待确认'}
        </Tag>
      ),
    },
    {
      title: '客户 / 小区',
      dataIndex: 'name',
      hideInSearch: true,
      width: 250,
      render: (_, lead) => (
        <Flex vertical gap={2}>
          <Typography.Text strong>{lead.name}</Typography.Text>
          <Typography.Text type="secondary" className="text-xs" ellipsis={{ tooltip: lead.communityName || '未记录小区' }}>
            {lead.communityName || '未记录小区'}
          </Typography.Text>
        </Flex>
      ),
    },
    {
      title: '联系电话',
      dataIndex: 'phone',
      hideInSearch: true,
      width: 165,
      render: (phone) => <Typography.Text code>{phone || '-'}</Typography.Text>,
    },
    {
      title: '渠道人员',
      key: 'promoter',
      hideInSearch: true,
      width: 170,
      render: (_, lead) => getStaffName(lead.promoterId) || '系统录入',
    },
    {
      title: '绑定设计师',
      key: 'assignee',
      hideInSearch: true,
      width: 180,
      render: (_, lead) => getStaffName(lead.assignedTo) || '未绑定设计师',
    },
    {
      title: '提交日期',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      hideInSearch: true,
      width: 190,
      render: (_, lead) => formatDate(lead.createdAt),
    },
    ...(archiveState === 'archived' ? [{
      title: '归档信息',
      key: 'archive',
      hideInSearch: true,
      width: 210,
      render: (_: unknown, lead: Lead) => (
        <Flex vertical gap={2}>
          <Typography.Text>{ARCHIVE_REASON_LABELS[lead.archiveReason || ''] || '其他'}</Typography.Text>
          <Typography.Text type="secondary" className="text-xs">{formatDate(lead.archivedAt || undefined)}</Typography.Text>
        </Flex>
      ),
    } satisfies ProColumns<Lead>] : []),
    {
      title: '操作',
      key: 'actions',
      valueType: 'option',
      fixed: 'right',
      width: 285,
      hideInSearch: true,
      render: (_, lead) => (
        <Space size={8}>
          <Button size="small" icon={<Eye size={14} />} onClick={() => void openLeadDetail(lead)}>
            详情
          </Button>
          {archiveState === 'active' ? (
            <>
              <Button size="small" icon={<FilePenLine size={14} />} onClick={() => router.push(`/ai-studio/scenarios?leadId=${lead._id}`)}>
                {lead.floorPlanIds?.length || lead.followUpRecords?.length ? '查看方案' : '开始方案'}
              </Button>
              {capabilities.canManageArchive ? (
                <Button size="small" disabled={archiveLoading} loading={archiveLoading && archiveTargets.some((item) => item._id === lead._id)} icon={<Archive size={14} />} onClick={() => void openArchive([lead])}>
                  归档
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <Button size="small" disabled={Boolean(deletingId)} loading={deletingId === lead._id} icon={<RotateCcw size={14} />} onClick={() => void restoreLead(lead)}>
                恢复
              </Button>
              {capabilities.canPurge ? (
                <Button size="small" danger disabled={Boolean(deletingId)} loading={deletingId === lead._id} icon={<Trash2 size={14} />} onClick={() => void openPurge(lead)}>
                  永久删除
                </Button>
              ) : null}
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="客资线索管理"
        content="跟进客户状态、查看协作归属，并衔接正式量房与方案设计。"
      >
        <ModuleOverview
          ariaLabel="线索概览"
          items={[
            { label: '本页线索', value: overview.total, icon: <Users size={18} /> },
            { label: '本页量房中', value: overview.measuring, icon: <ClipboardCheck size={18} />, tone: 'warning' },
            { label: '本页方案设计', value: overview.assigned, icon: <LayoutTemplate size={18} />, tone: 'success' },
            { label: '本页已签约', value: overview.converted, icon: <ClipboardCheck size={18} />, tone: 'success' },
          ]}
        />
        <ProTable<Lead>
          className="admin-data-table admin-mobile-filter-stack"
          actionRef={actionRef}
          rowKey="_id"
          columns={columns}
          search={{ labelWidth: 'auto', defaultCollapsed: false, span: 12 }}
          options={{ reload: true, density: true, setting: true }}
          toolBarRender={() => [
            capabilities.canManageArchive ? (
              <Segmented
                key="archive-state"
                value={archiveState}
                options={[
                  { label: '在用线索', value: 'active' },
                  { label: '已归档', value: 'archived' },
                ]}
                onChange={(value) => setArchiveState(value as 'active' | 'archived')}
              />
            ) : null,
            archiveState === 'active' && capabilities.canManageArchive ? (
              <Button
                key="batch-archive"
                icon={<Archive size={16} />}
                disabled={!selectedRowKeys.length || archiveLoading}
                loading={archiveLoading}
                onClick={() => void openArchive(visibleLeads.filter((lead) => selectedRowKeys.includes(lead._id)))}
              >
                归档所选（{selectedRowKeys.length}）
              </Button>
            ) : null,
          ].filter(Boolean)}
          rowSelection={archiveState === 'active' && capabilities.canManageArchive ? {
            selectedRowKeys,
            preserveSelectedRowKeys: false,
            onChange: setSelectedRowKeys,
          } : false}
          pagination={{ defaultPageSize: 20, showSizeChanger: true }}
          scroll={{ x: 1240 }}
          request={async (params) => {
            leadListRequestRef.current?.abort();
            const controller = new AbortController();
            leadListRequestRef.current = controller;
            const query = new URLSearchParams({
              page: String(params.current || 1),
              limit: String(params.pageSize || 20),
            });
            if (params.status) query.set('status', String(params.status));
            if (params.acquisitionStatus) query.set('acquisitionStatus', String(params.acquisitionStatus));
            query.set('archiveState', archiveState);
            try {
              const response = await fetch(`/api/leads?${query.toString()}`, { signal: controller.signal });
              const result = await response.json() as LeadListResponse;
              if (!response.ok || !result.success) throw new Error(result.error || '线索列表加载失败');
              setVisibleLeads(result.data || []);
              if (selectedLead) {
                const refreshed = result.data?.find((lead) => lead._id === selectedLead._id);
                if (refreshed) setSelectedLead((current) => current ? { ...current, ...refreshed } : current);
              }
              const nextOverview = {
                total: result.data?.length || 0,
                measuring: (result.data || []).filter((lead) => lead.status === 'measuring').length,
                assigned: (result.data || []).filter((lead) => ['measured', 'assigned', 'designing', 'quoting'].includes(lead.status)).length,
                converted: (result.data || []).filter((lead) => lead.status === 'converted').length,
              };
              setOverview((current) => (
                current.total === nextOverview.total &&
                current.measuring === nextOverview.measuring &&
                current.assigned === nextOverview.assigned &&
                current.converted === nextOverview.converted
                  ? current
                  : nextOverview
              ));
              return {
                data: result.data || [],
                total: result.pagination?.total || 0,
                success: true,
              };
            } catch (error) {
              if (controller.signal.aborted) return { data: [], total: 0, success: false };
              throw error;
            }
          }}
          onRequestError={(error) => notify.error(error instanceof Error ? error.message : '线索列表加载失败')}
        />
      </PageContainer>

      <Modal
        open={archiveTargets.length > 0}
        title={`归档 ${archiveTargets.length} 条客户线索`}
        okText="确认归档"
        cancelText="取消"
        confirmLoading={archiveLoading}
        okButtonProps={{ disabled: !archiveReason || !archiveImpacts.some((impact) => impact.canArchive) }}
        onCancel={() => { if (!archiveLoading) { setArchiveTargets([]); setArchiveImpacts([]); } }}
        onOk={() => void archiveLeads()}
      >
        <Flex vertical gap={16}>
          <Alert
            showIcon
            type={archiveImpacts.some((impact) => (impact.inFlightAiCount || 0) > 0) ? 'warning' : 'info'}
            message="归档不会删除客户资产"
            description={archiveImpacts.some((impact) => (impact.inFlightAiCount || 0) > 0)
              ? '存在运行中的 AI 任务；这些线索会跳过，其余可处理线索仍可归档。'
              : '归档后将从日常线索、小程序和 AI 客户选择中隐藏，户型、方案、提成和历史记录仍会保留。'}
          />
          {archiveImpacts.some((impact) => !impact.canArchive) ? (
            <Flex vertical gap={4}>
              {archiveImpacts.filter((impact) => !impact.canArchive).map((impact) => {
                const lead = archiveTargets.find((item) => item._id === impact.leadId);
                return (
                  <Typography.Text key={impact.leadId} type="secondary">
                    {lead?.name || impact.leadId}：{impact.unavailable ? '无权访问或线索已不存在' : (impact.archiveBlockers || ['当前不可归档']).join('；')}
                  </Typography.Text>
                );
              })}
            </Flex>
          ) : null}
          <Descriptions
            size="small"
            column={2}
            items={[
              { key: 'floorplans', label: '关联户型', children: archiveImpacts.reduce((total, item) => total + (item.floorPlanCount || 0), 0) },
              { key: 'workflows', label: 'AI 方案', children: archiveImpacts.reduce((total, item) => total + (item.aiWorkflowCount || 0), 0) },
              { key: 'generations', label: 'AI 生成', children: archiveImpacts.reduce((total, item) => total + (item.aiGenerationCount || 0), 0) },
              { key: 'followups', label: '跟进记录', children: archiveImpacts.reduce((total, item) => total + (item.followUpCount || 0), 0) },
            ]}
          />
          <Flex vertical gap={6}>
            <Typography.Text strong>归档原因</Typography.Text>
            <Select value={archiveReason} options={ARCHIVE_REASON_OPTIONS} placeholder="请选择归档原因" onChange={setArchiveReason} />
          </Flex>
          <Flex vertical gap={6} className="pb-3">
            <Typography.Text strong>备注（可选）</Typography.Text>
            <Input.TextArea value={archiveNote} maxLength={500} showCount autoSize={{ minRows: 2, maxRows: 4 }} onChange={(event) => setArchiveNote(event.target.value)} />
          </Flex>
        </Flex>
      </Modal>

      <Modal
        open={archiveFailures.length > 0}
        title="未处理的客户线索"
        footer={<Button type="primary" onClick={() => setArchiveFailures([])}>知道了</Button>}
        onCancel={() => setArchiveFailures([])}
      >
        <Flex vertical gap={10}>
          {archiveFailures.map((item) => (
            <Flex key={`${item.leadId}-${item.status}`} vertical gap={2}>
              <Typography.Text strong>{item.name}</Typography.Text>
              <Typography.Text type="secondary">{item.reason}</Typography.Text>
            </Flex>
          ))}
        </Flex>
      </Modal>

      <Modal
        open={Boolean(purgeTarget)}
        title="永久删除空白客户线索"
        okText="永久删除"
        cancelText="取消"
        okButtonProps={{
          danger: true,
          disabled: !purgeTarget || !purgeImpact?.canPurge || purgeConfirmation !== purgeTarget.name,
          loading: Boolean(purgeTarget && deletingId === purgeTarget._id),
        }}
        onCancel={() => { if (!deletingId) { setPurgeTarget(null); setPurgeImpact(null); } }}
        onOk={() => void purgeLead()}
      >
        <Flex vertical gap={16}>
          {purgeImpact?.canPurge ? (
            <Alert showIcon type="error" message="此操作不可恢复" description="该线索未发现户型、AI、获客、提成或跟进记录。永久删除后只保留不含客户隐私的操作审计。" />
          ) : (
            <Alert showIcon type="warning" message="该线索不能永久删除" description={(purgeImpact?.purgeBlockers || []).join('；')} />
          )}
          {purgeTarget && purgeImpact?.canPurge ? (
            <Flex vertical gap={6}>
              <Typography.Text>请输入客户名称 <Typography.Text strong>{purgeTarget.name}</Typography.Text> 确认：</Typography.Text>
              <Input value={purgeConfirmation} onChange={(event) => setPurgeConfirmation(event.target.value)} />
            </Flex>
          ) : null}
        </Flex>
      </Modal>

      <Modal
        open={conversionOpen}
        title="确认客户已签约"
        destroyOnHidden
        footer={(
          <Flex justify="end" gap={8}>
            <Button disabled={conversionSubmitting} onClick={() => setConversionOpen(false)}>取消</Button>
            <Button
              color="green"
              variant="solid"
              icon={<BadgeCheck size={16} />}
              loading={conversionSubmitting}
              disabled={!conversionDate}
              onClick={() => void markConverted()}
            >
              确认已签约
            </Button>
          </Flex>
        )}
        onCancel={() => { if (!conversionSubmitting) setConversionOpen(false); }}
      >
        <Flex vertical gap={16}>
          <Alert
            showIcon
            type="info"
            message={selectedLead ? `${selectedLead.name} · ${selectedLead.communityName || '未填写小区'}` : '客户信息'}
            description={`当前阶段：${selectedLead ? getLeadStatusLabel(selectedLead.status) : '-'}`}
          />
          {selectedLead && !['measured', 'assigned', 'designing', 'quoting'].includes(selectedLead.status) ? (
            <Alert showIcon type="warning" message="本次操作将跳过尚未完成的中间阶段" />
          ) : null}
          <Flex vertical gap={6}>
            <Typography.Text strong>签约日期</Typography.Text>
            <Input
              type="date"
              max={chinaDateValue()}
              value={conversionDate}
              onChange={(event) => setConversionDate(event.target.value)}
            />
          </Flex>
          <Flex vertical gap={6}>
            <Typography.Text strong>签约金额（选填）</Typography.Text>
            <InputNumber
              className="w-full"
              min={0.01}
              max={999999999999.99}
              precision={2}
              controls={false}
              prefix="¥"
              placeholder="用于经营统计，不作为财务结算凭证"
              value={conversionAmount}
              onChange={(value) => setConversionAmount(value)}
            />
          </Flex>
          <Flex vertical gap={6}>
            <Typography.Text strong>签约备注（选填）</Typography.Text>
            <Input.TextArea
              value={conversionNote}
              maxLength={200}
              showCount
              autoSize={{ minRows: 2, maxRows: 4 }}
              placeholder="可记录合同编号或需要交接的事项"
              onChange={(event) => setConversionNote(event.target.value)}
            />
          </Flex>
          <Typography.Text type="secondary">
            仅更新客户业务状态，不会自动生成订单、扣款或结算获客提成。
          </Typography.Text>
        </Flex>
      </Modal>

      <Modal
        open={revertConversionOpen}
        title="撤销签约标记"
        okText="确认撤销"
        cancelText="取消"
        okButtonProps={{
          danger: true,
          loading: conversionSubmitting,
          disabled: !revertReason.trim(),
        }}
        onCancel={() => {
          if (!conversionSubmitting) {
            setRevertConversionOpen(false);
            setRevertReason('');
          }
        }}
        onOk={() => void revertConversion()}
      >
        <Flex vertical gap={12}>
          <Alert
            showIcon
            type="warning"
            message="撤销后将恢复为签约前的业务阶段"
            description="签约审计记录会保留，已记录的签约信息将从当前线索摘要中移除。"
          />
          <Flex vertical gap={6}>
            <Typography.Text strong>撤销原因</Typography.Text>
            <Input.TextArea
              value={revertReason}
              maxLength={200}
              showCount
              autoSize={{ minRows: 3, maxRows: 5 }}
              placeholder="请说明合同未生效或误操作等原因"
              onChange={(event) => setRevertReason(event.target.value)}
            />
          </Flex>
        </Flex>
      </Modal>

      <Drawer
        open={Boolean(selectedLead)}
        width={640}
        destroyOnHidden
        title={selectedLead ? `${selectedLead.name}的线索详情` : '线索详情'}
        onClose={closeLeadDetail}
        extra={selectedLead && !selectedLead.archivedAt ? (
          <Button icon={<FilePenLine size={16} />} onClick={() => router.push(`/ai-studio/scenarios?leadId=${selectedLead._id}`)}>
            {selectedLead.floorPlanIds?.length || selectedLead.followUpRecords?.length ? '查看方案' : '开始方案'}
          </Button>
        ) : null}
      >
        {selectedLead ? (
          <Flex vertical gap={24}>
            {selectedLead.archivedAt ? (
              <Alert
                showIcon
                type="info"
                message="该客户线索已归档"
                description={`${ARCHIVE_REASON_LABELS[selectedLead.archiveReason || ''] || '其他'} · ${formatDate(selectedLead.archivedAt)}${selectedLead.archiveNote ? ` · ${selectedLead.archiveNote}` : ''}`}
              />
            ) : null}
            <Flex align="center" justify="space-between" gap={16} wrap>
              <Flex vertical gap={4}>
                <Typography.Text type="secondary">{selectedLead.phone || '-'}</Typography.Text>
                <Tag color={getStatusColor(selectedLead.status)}>{getLeadStatusLabel(selectedLead.status)}</Tag>
              </Flex>
              <Flex vertical gap={2} className="min-w-44" align="end">
                <Typography.Text type="secondary">创建时绑定设计师</Typography.Text>
                <Typography.Text strong>
                  {getStaffName(selectedLead.assignedTo) || '未绑定设计师'}
                </Typography.Text>
              </Flex>
            </Flex>

              <Steps
                size="small"
                current={getLeadWorkflowStep(selectedLead.status)}
                items={LEAD_WORKFLOW_STEPS.map((title) => ({ title }))}
              />

              <Typography.Text type="secondary">
                下一步：{getLeadNextAction(selectedLead.status)}
              </Typography.Text>

            {selectedLead.conversionActions?.canMarkConverted ? (
              <Flex
                align="center"
                justify="space-between"
                gap={16}
                wrap
                className="rounded-xl bg-emerald-50 p-4"
              >
                <Flex vertical gap={2}>
                  <Typography.Text strong>客户已完成合同签署？</Typography.Text>
                  <Typography.Text type="secondary">
                    确认后进入“已签约”，并记录签约日期与操作人。
                  </Typography.Text>
                </Flex>
                <Button color="green" variant="solid" icon={<BadgeCheck size={16} />} onClick={openConversion}>
                  标记已签约
                </Button>
              </Flex>
            ) : null}

            {selectedLead.status === 'converted' ? (
              <Descriptions
                title="签约记录"
                bordered
                size="small"
                column={1}
                extra={selectedLead.conversionActions?.canRevertConversion ? (
                  <Button
                    type="text"
                    danger
                    size="small"
                    icon={<Undo2 size={14} />}
                    onClick={() => setRevertConversionOpen(true)}
                  >
                    撤销签约标记
                  </Button>
                ) : null}
                items={[
                  { key: 'convertedOn', label: '签约日期', children: selectedLead.convertedOn || '历史数据未记录' },
                  { key: 'convertedBy', label: '标记人', children: getStaffName(selectedLead.convertedBy) || '历史数据未记录' },
                  { key: 'convertedAt', label: '标记时间', children: formatDate(selectedLead.convertedAt || undefined) },
                  { key: 'contractAmount', label: '签约金额', children: formatContractAmount(selectedLead.contractAmount) },
                  ...(selectedLead.conversionNote ? [{ key: 'conversionNote', label: '签约备注', children: selectedLead.conversionNote }] : []),
                ]}
              />
            ) : null}

            <Descriptions
              bordered
              size="small"
              column={1}
              items={[
                { key: 'community', label: '小区名称', children: selectedLead.communityName || '-' },
                { key: 'promoter', label: '录入人员', children: getStaffName(selectedLead.promoterId) || '系统' },
                { key: 'area', label: '意向面积', children: selectedLead.area ? `${selectedLead.area} m2` : '-' },
                { key: 'style', label: '偏好风格', children: selectedLead.stylePreference || '-' },
                { key: 'source', label: '来源渠道', children: selectedLead.source || '-' },
              ]}
            />

            <Descriptions
              title="获客协作"
              bordered
              size="small"
              column={1}
              items={[
                {
                  key: 'acquisitionStatus',
                  label: '微信交接',
                  children: selectedLead.acquisitionStatus === 'confirmed' ? '已确认' : '等待设计师确认',
                },
                {
                  key: 'acquiredAt',
                  label: '确认时间',
                  children: selectedLead.acquisitionStatus === 'confirmed' ? formatDate(selectedLead.acquiredAt || undefined) : '-',
                },
                {
                  key: 'commissionStatus',
                  label: '提成结算',
                  children: selectedLead.acquisitionCommissionStatus === 'paid'
                    ? '已发放'
                    : selectedLead.acquisitionCommissionStatus === 'pending_settlement'
                      ? '待结算'
                      : '尚未生成',
                },
              ]}
            />

            <RelatedFloorPlans
              floorPlans={selectedLead.floorPlanIds || []}
              primaryFloorPlanId={typeof selectedLead.primaryFloorPlanId === 'object' ? selectedLead.primaryFloorPlanId?._id : selectedLead.primaryFloorPlanId || undefined}
            />

            <Flex vertical gap={12}>
              <Flex align="center" gap={8}>
                <MessageSquare size={16} />
                <Typography.Text strong>跟进日志</Typography.Text>
                <Tag>{selectedLead.followUpRecords?.length || 0}</Tag>
              </Flex>
              {!selectedLead.archivedAt ? <Flex gap={8} align="start">
                <Input.TextArea
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  placeholder="记录新的跟进动态"
                  value={newNote}
                  onChange={(event) => setNewNote(event.target.value)}
                />
                <Button type="primary" icon={<Plus size={16} />} loading={isSubmitting} disabled={!newNote.trim()} onClick={() => void addFollowUp()}>
                  添加
                </Button>
              </Flex> : null}
              {selectedLead.followUpRecords?.length ? (
                <Timeline
                  items={[...(selectedLead.followUpRecords || [])].reverse().map((record) => ({
                    children: (
                      <Flex vertical gap={4}>
                        <Typography.Text>{record.content || '-'}</Typography.Text>
                        <Typography.Text type="secondary" className="text-xs">
                          {record.operator || '管理员'} · {formatDate(record.createdAt)}
                        </Typography.Text>
                      </Flex>
                    ),
                  }))}
                />
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无跟进记录" />}
            </Flex>
          </Flex>
        ) : null}
      </Drawer>
    </div>
  );
}

function RelatedFloorPlans({
  floorPlans,
  primaryFloorPlanId,
}: {
  floorPlans: FloorPlan[];
  primaryFloorPlanId?: string;
}) {
  const sortedFloorPlans = [...floorPlans].sort((left, right) => {
    if (primaryFloorPlanId && left._id === primaryFloorPlanId) return -1;
    if (primaryFloorPlanId && right._id === primaryFloorPlanId) return 1;
    return 0;
  });

  return (
    <Flex vertical gap={12}>
      <Flex align="center" justify="space-between">
        <Typography.Text strong>实测户型档案</Typography.Text>
        <Tag>{floorPlans.length}</Tag>
      </Flex>
      {sortedFloorPlans.length ? sortedFloorPlans.map((plan) => {
        const isSurveying = isFormalSurveyPlan(plan);
        const stats = getSurveyGraphStats(plan.layoutData);
        return (
          <Flex key={plan._id} align="center" justify="space-between" gap={16} className="rounded-lg border border-border bg-card p-3">
            <Flex vertical gap={4} className="min-w-0">
              <Space size={6} wrap>
                <Typography.Text strong ellipsis={{ tooltip: plan.display?.projectTitle || plan.name || '未命名户型' }}>{plan.display?.projectTitle || plan.name || '未命名户型'}</Typography.Text>
                {primaryFloorPlanId === plan._id ? <Tag color="green">主户型</Tag> : null}
                {isSurveying ? <Tag color="blue">正式量房</Tag> : null}
              </Space>
              <Typography.Text type="secondary" className="text-xs">
                {isSurveying ? `${plan.display?.projectSubtitle ? `${plan.display.projectSubtitle} · ` : ''}${stats.wallCount} 面墙 · ${stats.spaceCount} 个空间 · ${stats.openingCount} 个门窗` : getFloorPlanSourceLabel(plan.source)}
              </Typography.Text>
            </Flex>
            <Button size="small" href={`/floorplans/${plan._id}`}>查看</Button>
          </Flex>
        );
      }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无关联的实测记录" />}
    </Flex>
  );
}
