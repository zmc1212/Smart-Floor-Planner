'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PageContainer,
  ProTable,
  type ActionType,
  type ProColumns,
} from '@ant-design/pro-components';
import {
  Button,
  Descriptions,
  Drawer,
  Empty,
  Flex,
  Input,
  Select,
  Space,
  Steps,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import { useRouter } from 'next/navigation';
import { ClipboardCheck, Eye, FilePenLine, LayoutTemplate, MessageSquare, Plus, Trash2, Users } from 'lucide-react';
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
  promoterId?: StaffReference | string | null;
  assignedTo?: StaffReference | string | null;
  floorPlanIds?: FloorPlan[];
  primaryFloorPlanId?: FloorPlan | string | null;
  followUpRecords?: FollowUpRecord[];
  createdAt?: string;
};

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
  { label: '已获客', value: 'acquired' },
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
  if (status === 'acquired') return 'green';
  if (status === 'measuring') return 'green';
  if (['measured', 'assigned', 'designing', 'quoting'].includes(status)) return 'blue';
  if (status === 'converted') return 'orange';
  if (status === 'closed') return 'default';
  return 'cyan';
}

function getStaffName(
  value: StaffReference | string | null | undefined,
  staffMembers: StaffReference[]
) {
  if (!value) return '';
  if (typeof value === 'object') return value.displayName || value.username || '';
  const member = staffMembers.find((item) => item._id === value);
  return member?.displayName || member?.username || '';
}

function getReferenceId(value: StaffReference | string | null | undefined) {
  if (!value) return '';
  return typeof value === 'string' ? value : value._id;
}

function formatDate(value?: string | Date) {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString('zh-CN');
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
  const [staffMembers, setStaffMembers] = useState<StaffReference[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [selectedLeadLoading, setSelectedLeadLoading] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [overview, setOverview] = useState({ total: 0, measuring: 0, assigned: 0, converted: 0 });

  useEffect(() => {
    let cancelled = false;
    async function loadStaff() {
      try {
        const response = await fetch('/api/staff?roles=designer,measurer,enterprise_admin');
        const result = await response.json();
        if (!cancelled && response.ok && result.success) setStaffMembers(result.data || []);
      } catch {
        // Lead records remain readable when optional assignment choices are unavailable.
      }
    }
    void loadStaff();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => {
    leadListRequestRef.current?.abort();
    leadDetailRequestRef.current?.abort();
  }, []);

  const staffOptions = useMemo(() => {
    const currentAssigneeId = getReferenceId(selectedLead?.assignedTo);
    const currentAssigneeOption = currentAssigneeId && !staffMembers.some(
      (member) => member._id === currentAssigneeId
    )
      ? [{
          label: getStaffName(selectedLead?.assignedTo, staffMembers) || currentAssigneeId,
          value: currentAssigneeId,
        }]
      : [];

    return [
      { label: '待指派', value: '__unassigned__' },
      ...currentAssigneeOption,
      ...staffMembers.map((member) => ({
        label: member.displayName || member.username || member._id,
        value: member._id,
      })),
    ];
  }, [selectedLead?.assignedTo, staffMembers]);

  const refreshLeads = useCallback(async () => {
    await actionRef.current?.reload();
  }, []);

  const openLeadDetail = async (lead: Lead) => {
    leadDetailRequestRef.current?.abort();
    const controller = new AbortController();
    leadDetailRequestRef.current = controller;
    setSelectedLead(lead);
    setSelectedLeadLoading(true);
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
    } finally {
      if (!controller.signal.aborted) setSelectedLeadLoading(false);
    }
  };

  const closeLeadDetail = () => {
    leadDetailRequestRef.current?.abort();
    setSelectedLeadLoading(false);
    setSelectedLead(null);
    setNewNote('');
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
      notify.success(updates.assignedTo !== undefined ? '负责人已更新' : '线索信息已更新');
      await refreshLeads();
      if (closeAfterSuccess) closeLeadDetail();
      return true;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '线索更新失败');
      return false;
    }
  };

  const deleteLead = async (lead: Lead) => {
    if (deletingId) return;
    const confirmed = await confirmAction({
      title: '删除线索',
      description: `确定删除线索“${lead.name}”吗？此操作不可撤销。`,
      confirmText: '删除',
      destructive: true,
    });
    if (!confirmed) return;
    setDeletingId(lead._id);
    try {
      const response = await fetch(`/api/leads/${lead._id}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '删除线索失败');
      if (selectedLead?._id === lead._id) closeLeadDetail();
      notify.success('线索已删除');
      await refreshLeads();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '删除线索失败');
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
      render: (_, lead) => getStaffName(lead.promoterId, staffMembers) || '系统录入',
    },
    {
      title: '当前负责人',
      key: 'assignee',
      hideInSearch: true,
      width: 180,
      render: (_, lead) => getStaffName(lead.assignedTo, staffMembers) || '待指派',
    },
    {
      title: '提交日期',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      hideInSearch: true,
      width: 190,
      render: (_, lead) => formatDate(lead.createdAt),
    },
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
          <Button size="small" icon={<FilePenLine size={14} />} onClick={() => router.push(`/ai-studio/scenarios?leadId=${lead._id}`)}>
            {lead.floorPlanIds?.length || lead.followUpRecords?.length ? '查看方案' : '开始方案'}
          </Button>
          <Button size="small" danger disabled={deletingId === lead._id} loading={deletingId === lead._id} icon={<Trash2 size={14} />} onClick={() => void deleteLead(lead)}>
            删除
          </Button>
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
        content="跟进客户状态、指派协作人员，并衔接正式量房与方案设计。"
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
            try {
              const response = await fetch(`/api/leads?${query.toString()}`, { signal: controller.signal });
              const result = await response.json() as LeadListResponse;
              if (!response.ok || !result.success) throw new Error(result.error || '线索列表加载失败');
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

      <Drawer
        open={Boolean(selectedLead)}
        width={640}
        destroyOnHidden
        title={selectedLead ? `${selectedLead.name}的线索详情` : '线索详情'}
        onClose={closeLeadDetail}
        extra={selectedLead ? (
          <Button icon={<FilePenLine size={16} />} onClick={() => router.push(`/ai-studio/scenarios?leadId=${selectedLead._id}`)}>
            {selectedLead.floorPlanIds?.length || selectedLead.followUpRecords?.length ? '查看方案' : '开始方案'}
          </Button>
        ) : null}
      >
        {selectedLead ? (
          <Flex vertical gap={24}>
            <Flex align="center" justify="space-between" gap={16} wrap>
              <Flex vertical gap={4}>
                <Typography.Text type="secondary">{selectedLead.phone || '-'}</Typography.Text>
                <Tag color={getStatusColor(selectedLead.status)}>{getLeadStatusLabel(selectedLead.status)}</Tag>
              </Flex>
              <Select
                className="min-w-44"
                value={getReferenceId(selectedLead.assignedTo) || '__unassigned__'}
                options={staffOptions}
                loading={selectedLeadLoading}
                onChange={(value) => void updateLead(selectedLead._id, { assignedTo: value === '__unassigned__' ? null : value }, true)}
              />
            </Flex>

              <Steps
                size="small"
                current={getLeadWorkflowStep(selectedLead.status)}
                items={LEAD_WORKFLOW_STEPS.map((title) => ({ title }))}
              />

              <Typography.Text type="secondary">
                下一步：{getLeadNextAction(selectedLead.status)}
              </Typography.Text>

            <Descriptions
              bordered
              size="small"
              column={1}
              items={[
                { key: 'community', label: '小区名称', children: selectedLead.communityName || '-' },
                { key: 'promoter', label: '录入人员', children: getStaffName(selectedLead.promoterId, staffMembers) || '系统' },
                { key: 'area', label: '意向面积', children: selectedLead.area ? `${selectedLead.area} m2` : '-' },
                { key: 'style', label: '偏好风格', children: selectedLead.stylePreference || '-' },
                { key: 'source', label: '来源渠道', children: selectedLead.source || '-' },
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
              <Flex gap={8} align="start">
                <Input.TextArea
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  placeholder="记录新的跟进动态"
                  value={newNote}
                  onChange={(event) => setNewNote(event.target.value)}
                />
                <Button type="primary" icon={<Plus size={16} />} loading={isSubmitting} disabled={!newNote.trim()} onClick={() => void addFollowUp()}>
                  添加
                </Button>
              </Flex>
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
                <Typography.Text strong ellipsis={{ tooltip: plan.name || '未命名户型' }}>{plan.name || '未命名户型'}</Typography.Text>
                {primaryFloorPlanId === plan._id ? <Tag color="green">主户型</Tag> : null}
                {isSurveying ? <Tag color="blue">正式量房</Tag> : null}
              </Space>
              <Typography.Text type="secondary" className="text-xs">
                {isSurveying ? `${stats.wallCount} 面墙 · ${stats.spaceCount} 个空间 · ${stats.openingCount} 个门窗` : getFloorPlanSourceLabel(plan.source)}
              </Typography.Text>
            </Flex>
            <Button size="small" href={`/floorplans/${plan._id}`}>查看</Button>
          </Flex>
        );
      }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无关联的实测记录" />}
    </Flex>
  );
}
