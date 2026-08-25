'use client';

/*
 * THESIS: Make every open lead a time-bound, auditable opportunity instead of a hidden queue.
 * OWN-WORLD: Existing Admin Pro workbench, restrained green status accents, compact operating tables.
 * STORY: Designers scan masked demand and claim; managers watch outcomes and intervene only when needed.
 * FIRST VIEWPORT: Pool health, personal capacity, refresh state, and the first claimable rows are immediately visible.
 * FORM: A live operations table with one primary action per row; seed-free extension of the approved Admin system.
 */

import { useCallback, useEffect, useState } from 'react';
import { PageContainer, ProTable, type ProColumns } from '@ant-design/pro-components';
import { Alert, Button, Flex, Modal, Select, Space, Statistic, Tag, Typography } from 'antd';
import { Clock3, RefreshCw, Settings2, Trophy } from 'lucide-react';
import { notify } from '@/components/admin/operation-feedback';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePagePolling } from '@/hooks/usePagePolling';
import {
  LEAD_POOL_CLOCK_INTERVAL_MS,
  LEAD_POOL_IDLE_MS,
  LEAD_POOL_POLL_INTERVAL_MS,
} from '@/lib/page-activity';

type PoolLead = {
  id: string;
  claimWindowId: string;
  status: string;
  canClaim: boolean;
  expiresAt: string;
  remainingSeconds: number;
  city?: string | null;
  communityArea?: string | null;
  area?: number | null;
  stylePreference?: string | null;
  sourceLabel?: string | null;
  claimedByStaffId?: string | null;
  assignmentGroup?: string | null;
  resolutionReason?: string | null;
};

type PoolPayload = {
  success: boolean;
  error?: string;
  serverNow: string;
  data: PoolLead[];
  capacity?: { current: number; limit: number; available: boolean } | null;
  settings?: { claimEnabled: boolean; claimDurationSeconds: number } | null;
};

type StaffOption = { id: string; displayName?: string; username?: string; phone?: string | null };

const STATUS_LABELS: Record<string, string> = {
  open: '待抢单', claimed: '已抢单', auto_assigned: '已自动派单', manually_assigned: '已人工指派',
  assignment_pending: '待重试', cancelled: '已取消',
};

function countdown(expiresAt: string, now: number) {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
}

function idempotencyKey(leadId: string) {
  return globalThis.crypto?.randomUUID?.() || `${leadId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function LeadPoolPage() {
  const { user } = useCurrentUser();
  const isManager = ['enterprise_admin', 'admin', 'super_admin'].includes(user?.role || '');
  const [payload, setPayload] = useState<PoolPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [serverOffset, setServerOffset] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [assignLead, setAssignLead] = useState<PoolLead | null>(null);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [designerId, setDesignerId] = useState<string>();
  const [assigning, setAssigning] = useState(false);

  const loadPool = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch('/api/lead-claim-pool', { cache: 'no-store' });
      const result = await response.json() as PoolPayload;
      if (!response.ok || !result.success) throw new Error(result.error || '读取抢单池失败');
      setPayload(result);
      setServerOffset(new Date(result.serverNow).getTime() - Date.now());
    } catch (error) {
      if (!silent) notify.error(error instanceof Error ? error.message : '读取抢单池失败');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPool();
  }, [loadPool]);
  usePagePolling(() => loadPool(true), {
    intervalMs: LEAD_POOL_POLL_INTERVAL_MS,
    idleMs: LEAD_POOL_IDLE_MS,
  });
  usePagePolling(() => { setClock(Date.now()); }, {
    intervalMs: LEAD_POOL_CLOCK_INTERVAL_MS,
    idleMs: LEAD_POOL_IDLE_MS,
  });

  const claim = async (lead: PoolLead) => {
    setClaimingId(lead.id);
    try {
      const response = await fetch(`/api/leads/${lead.id}/claim`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey(lead.id) },
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '抢单失败');
      notify.success('抢单成功，客户完整资料已转入您的线索列表');
      await loadPool(true);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '抢单失败');
      await loadPool(true);
    } finally {
      setClaimingId(null);
    }
  };

  const openAssign = async (lead: PoolLead) => {
    setAssignLead(lead);
    setDesignerId(undefined);
    setStaff([]);
    try {
      const response = await fetch(`/api/leads/${lead.id}/assignable-staff?role=designer`);
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '读取可派设计师失败');
      setStaff(result.data?.items || []);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '读取可派设计师失败');
      setAssignLead(null);
    }
  };

  const confirmAssign = async () => {
    if (!assignLead || !designerId) return;
    setAssigning(true);
    try {
      const response = await fetch(`/api/leads/${assignLead.id}/assign-staff`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ designerId }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '人工指派失败');
      notify.success('已人工指派设计师，抢单窗口同步结束');
      setAssignLead(null);
      await loadPool(true);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '人工指派失败');
    } finally {
      setAssigning(false);
    }
  };

  const currentNow = clock + serverOffset;
  const columns: ProColumns<PoolLead>[] = [
    {
      title: '客户片区', dataIndex: 'communityArea', width: 220,
      render: (_, row) => <Space direction="vertical" size={0}><Typography.Text strong>{row.communityArea || '片区待补充'}</Typography.Text><Typography.Text type="secondary">{row.city || '城市待补充'} · {row.sourceLabel || '未知来源'}</Typography.Text></Space>,
    },
    { title: '需求', search: false, render: (_, row) => [row.area ? `${row.area}㎡` : null, row.stylePreference].filter(Boolean).join(' · ') || '需求待补充' },
    {
      title: '状态', dataIndex: 'status', width: 130, search: false,
      render: (_, row) => <Tag color={row.status === 'open' ? 'green' : row.status === 'assignment_pending' ? 'orange' : 'default'}>{STATUS_LABELS[row.status] || row.status}</Tag>,
    },
    {
      title: '剩余时间', width: 130, search: false,
      render: (_, row) => row.status === 'open'
        ? <Typography.Text type={countdown(row.expiresAt, currentNow) <= 10 ? 'danger' : undefined}>{countdown(row.expiresAt, currentNow)} 秒</Typography.Text>
        : '—',
    },
    ...(isManager ? [{
      title: '派单结果', width: 150, search: false,
      render: (_: unknown, row: PoolLead) => row.assignmentGroup ? <Tag>{row.assignmentGroup === 'high' ? '高绩效组' : '普通组'}</Tag> : row.resolutionReason || '—',
    } as ProColumns<PoolLead>] : []),
    {
      title: '操作', valueType: 'option', width: 180,
      render: (_, row) => isManager
        ? [<Button key="assign" type="link" disabled={!['open', 'assignment_pending'].includes(row.status)} onClick={() => void openAssign(row)}>人工指派</Button>]
        : [<Button key="claim" type="primary" size="small" loading={claimingId === row.id} disabled={!row.canClaim || payload?.capacity?.available === false} onClick={() => void claim(row)}>立即抢单</Button>],
    },
  ];

  return <div className="admin-page-frame">
    <PageContainer breadcrumbRender={false} className="admin-page-container" title="线索抢单池" content={isManager ? '监控抢单窗口、赛马派单结果，并在必要时人工指派。' : '池内仅显示脱敏需求；抢单成功后才可查看客户完整资料。'} extra={<Space><Button icon={<RefreshCw size={16} />} onClick={() => void loadPool()}>刷新</Button>{isManager ? <Button icon={<Settings2 size={16} />} href="/assignment-settings">派单设置</Button> : null}</Space>}>
      <Flex vertical gap={16}>
        {!payload?.settings?.claimEnabled ? <Alert type="info" showIcon message="当前企业未开启抢单" description="新线索会立即进入赛马自动派单；本页保留最近窗口供负责人审计。" /> : null}
        {!isManager && payload?.capacity ? <Flex gap={32} wrap align="center"><Statistic title="本人在手量" value={payload.capacity.current} suffix={`/ ${payload.capacity.limit}`} prefix={<Trophy size={18} />} /><Typography.Text type={payload.capacity.available ? 'secondary' : 'danger'}>{payload.capacity.available ? '容量可用，可参与抢单和自动派单' : '已达容量上限，请先完成或结案现有线索'}</Typography.Text></Flex> : null}
        <ProTable<PoolLead> rowKey="id" loading={loading} dataSource={payload?.data || []} columns={columns} search={false} pagination={{ pageSize: 20 }} options={false} locale={{ emptyText: <Flex vertical align="center" gap={8}><Clock3 size={28} /><Typography.Text type="secondary">当前没有可处理的抢单窗口</Typography.Text></Flex> }} />
      </Flex>
    </PageContainer>
    <Modal title="人工指派设计师" open={Boolean(assignLead)} onCancel={() => setAssignLead(null)} onOk={() => void confirmAssign()} okText="确认指派" confirmLoading={assigning} okButtonProps={{ disabled: !designerId }}>
      <Flex vertical gap={12}><Typography.Text type="secondary">人工指派会立即锁定线索并结束开放中的抢单窗口。</Typography.Text><Select showSearch optionFilterProp="label" placeholder="选择设计师" value={designerId} onChange={setDesignerId} options={staff.map((item) => ({ value: item.id, label: item.displayName || item.username || `员工 ${item.id}` }))} /></Flex>
    </Modal>
  </div>;
}
