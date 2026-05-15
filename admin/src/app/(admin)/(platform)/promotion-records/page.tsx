'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Save } from 'lucide-react';
import { notify } from '@/components/ui/operation-feedback';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const stageLabels: Record<string, string> = {
  reported: '已报备',
  contacted: '已联系',
  measuring: '量房中',
  designing: '设计中',
  quoted: '已报价',
  paid: '已成交',
  closed_lost: '已失单',
};

const ownershipLabels: Record<string, string> = {
  unassigned: '待分配',
  auto_locked: '系统锁定',
  manually_locked: '人工锁定',
  conflict_pending: '冲突待核',
};

const roleLabels: Record<string, string> = {
  none: '无',
  salesperson: '渠道地推',
  measurer: '量房员',
  designer: '设计师',
  enterprise_admin: '企业负责人',
  admin: '平台负责人',
  super_admin: '平台负责人',
};

const viewOptions = [
  { key: 'all', label: '全部' },
  { key: 'followup', label: '待跟进' },
  { key: 'assignMeasure', label: '待分配量房' },
  { key: 'assignDesign', label: '待分配设计' },
  { key: 'overdue', label: '已超时' },
  { key: 'pool', label: '线索池' },
  { key: 'pendingClaims', label: '待审批认领' },
];

type AdminUserOption = {
  _id: string;
  role?: string;
  displayName?: string;
  username?: string;
};

type PromotionRecord = {
  _id: string;
  enterpriseName?: string;
  creditCode?: string;
  contactPerson?: string;
  phone?: string;
  businessStage?: string;
  ownershipStatus?: string;
  pendingActionRole?: string;
  poolStatus?: string;
  nextFollowUpAt?: string;
  protectionExpiresAt?: string;
  lastActivityAt?: string;
  promoterId?: {
    _id?: string;
    displayName?: string;
    username?: string;
    role?: string;
  } | string;
  claimRequest?: {
    status?: string;
    requestedAt?: string;
    reviewedAt?: string;
    rejectReason?: string;
    requestedBy?: {
      _id?: string;
      displayName?: string;
      username?: string;
      role?: string;
    } | string;
    reviewedBy?: {
      _id?: string;
      displayName?: string;
      username?: string;
      role?: string;
    } | string;
  };
  followUpRecords?: Array<{
    content?: string;
    type?: string;
    operator?: string;
    operatorRole?: string;
    createdAt?: string;
    metadata?: Record<string, unknown>;
    operatorId?: {
      _id?: string;
      displayName?: string;
      username?: string;
      role?: string;
    } | string;
  }>;
  measureTask?: {
    status?: string;
    dueAt?: string;
    assignedTo?: { _id?: string; displayName?: string; username?: string };
  };
  designTask?: {
    status?: string;
    dueAt?: string;
    assignedTo?: { _id?: string; displayName?: string; username?: string };
  };
};

type PromotionConfig = {
  protectionPeriodDays: number;
  protectionExtendDays: number;
  maxProtectionExtends: number;
  poolClaimRequiresApproval: boolean;
};

type PromotionConfigForm = {
  protectionPeriodDays: string;
  protectionExtendDays: string;
  maxProtectionExtends: string;
  poolClaimRequiresApproval: boolean;
};

function buildConfigForm(config: PromotionConfig): PromotionConfigForm {
  return {
    protectionPeriodDays: String(config.protectionPeriodDays),
    protectionExtendDays: String(config.protectionExtendDays),
    maxProtectionExtends: String(config.maxProtectionExtends),
    poolClaimRequiresApproval: config.poolClaimRequiresApproval,
  };
}

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value?: string | null) {
  const date = parseDate(value);
  if (!date) return '-';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getPrimaryDueAt(record: PromotionRecord) {
  return record.nextFollowUpAt || record.measureTask?.dueAt || record.designTask?.dueAt || null;
}

function getDisplayName(
  value?:
    | string
    | {
        _id?: string;
        displayName?: string;
        username?: string;
      }
    | null
) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.displayName || value.username || '';
}

function getTimelineTypeLabel(type?: string) {
  const labels: Record<string, string> = {
    report_created: '创建报备',
    note: '备注',
    follow_up: '跟进记录',
    ownership_assigned: '指派地推',
    pool_released: '释放公海',
    pool_auto_released: '系统释放',
    pool_claimed: '认领成功',
    pool_claim_requested: '申请认领',
    pool_claim_approved: '认领通过',
    pool_claim_rejected: '认领驳回',
    pool_assigned: '公海分配',
  };
  return type ? labels[type] || type : '操作记录';
}

function isOverdue(record: PromotionRecord) {
  const dueAt = parseDate(getPrimaryDueAt(record));
  return !!dueAt && dueAt.getTime() < Date.now();
}

function matchesView(record: PromotionRecord, view: string) {
  if (view === 'all') return true;
  if (view === 'followup') return record.pendingActionRole === 'salesperson';
  if (view === 'assignMeasure') return record.businessStage === 'measuring' && record.measureTask?.status === 'unassigned';
  if (view === 'assignDesign') return record.measureTask?.status === 'submitted' && record.designTask?.status === 'unassigned';
  if (view === 'overdue') return isOverdue(record);
  if (view === 'pool') return record.poolStatus === 'in_pool';
  if (view === 'pendingClaims') return record.poolStatus === 'claimed' && record.claimRequest?.status === 'pending';
  return true;
}

export default function PromotionRecordsPage() {
  const { user } = useCurrentUser();
  const [records, setRecords] = useState<PromotionRecord[]>([]);
  const [staff, setStaff] = useState<AdminUserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState('all');
  const [viewFilter, setViewFilter] = useState('all');
  const [selected, setSelected] = useState<PromotionRecord | null>(null);
  const [followUpNote, setFollowUpNote] = useState('');
  const [nextFollowUpAt, setNextFollowUpAt] = useState('');
  const [selectedPromoter, setSelectedPromoter] = useState('');
  const [assigningPoolRecord, setAssigningPoolRecord] = useState<PromotionRecord | null>(null);
  const [poolPromoterId, setPoolPromoterId] = useState('');
  const [promotionConfig, setPromotionConfig] = useState<PromotionConfig | null>(null);
  const [configForm, setConfigForm] = useState<PromotionConfigForm>({
    protectionPeriodDays: '30',
    protectionExtendDays: '15',
    maxProtectionExtends: '3',
    poolClaimRequiresApproval: false,
  });
  const [configSaving, setConfigSaving] = useState(false);

  const canManage = !!user && ['enterprise_admin', 'admin', 'super_admin'].includes(user.role);
  const canAssignPromoter = !!user && ['admin', 'super_admin'].includes(user.role);
  const canAssignPool = canAssignPromoter;
  const canReleasePool = canAssignPromoter;
  const canClaimPool = user?.role === 'salesperson';

  const fetchPromotionConfig = useCallback(async () => {
    if (!canAssignPromoter) return;
    try {
      const res = await fetch('/api/platform/promotion-config');
      const data = await res.json();
      if (res.ok && data.success) {
        setPromotionConfig(data.data);
        setConfigForm(buildConfigForm(data.data));
      }
    } catch (error) {
      console.error('Failed to fetch promotion config', error);
    }
  }, [canAssignPromoter]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const isPool = viewFilter === 'pool' || viewFilter === 'pendingClaims';
      const endpoint = isPool
        ? `/api/promotion-records/pool?poolStatus=${viewFilter === 'pendingClaims' ? 'claimed' : 'in_pool'}`
        : '/api/promotion-records';
      const stageQuery = stageFilter !== 'all' && !isPool ? `?businessStage=${stageFilter}` : '';

      const [recordsRes, staffRes, adminUsersRes] = await Promise.all([
        fetch(`${endpoint}${stageQuery}`),
        fetch('/api/staff'),
        fetch('/api/admin-users'),
      ]);

      if (recordsRes.ok) {
        const recordsData = await recordsRes.json();
        if (recordsData.success) setRecords(recordsData.data || []);
      }

      const mergedStaff = new Map<string, AdminUserOption>();

      if (staffRes.ok) {
        const staffData = await staffRes.json();
        if (staffData.success) {
          (staffData.data || []).forEach((item: AdminUserOption) => {
            mergedStaff.set(String(item._id), item);
          });
        }
      }

      if (adminUsersRes.ok) {
        const adminUsersData = (await adminUsersRes.json()) as { success?: boolean; data?: AdminUserOption[] };
        if (adminUsersData.success) {
          (adminUsersData.data || []).forEach((item) => {
            if (item.role === 'salesperson') mergedStaff.set(String(item._id), item);
          });
        }
      }

      setStaff(Array.from(mergedStaff.values()));
    } catch (error) {
      console.error('Failed to fetch promotion records page data', error);
    } finally {
      setLoading(false);
    }
  }, [stageFilter, viewFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchPromotionConfig();
  }, [fetchPromotionConfig]);

  const filteredRecords = useMemo(() => records.filter((record) => matchesView(record, viewFilter)), [records, viewFilter]);
  const emptyMessage =
    viewFilter === 'pool'
      ? '线索池暂无可分配或认领线索，只有已入池线索会显示在这里。'
      : viewFilter === 'pendingClaims'
        ? '当前没有待审批的认领申请。'
      : '暂无匹配的企业报备';

  const staffOptions = useMemo(
    () => ({
      salespeople: staff.filter((item) => item.role === 'salesperson'),
    }),
    [staff]
  );

  const handleClaim = async (recordId: string) => {
    const protectionDays = promotionConfig?.protectionPeriodDays ?? 30;
    const claimPrompt = promotionConfig?.poolClaimRequiresApproval
      ? '确定提交这条客户线索的认领申请吗？审批通过后将进入你的保护期。'
      : `确定要认领这条客户线索吗？认领后您将拥有 ${protectionDays} 天保护期。`;
    if (!confirm(claimPrompt)) return;
    try {
      const res = await fetch('/api/promotion-records/pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId }),
      });
      const data = await res.json();
      if (data.success) {
        const isPendingApproval = data.data?.poolStatus === 'claimed' && data.data?.claimRequest?.status === 'pending';
        notify.success(isPendingApproval ? '已提交认领申请' : '认领成功');
        setViewFilter('all');
        await fetchData();
      } else {
        notify.fromAlert(data.error || '认领失败');
      }
    } catch {
      notify.fromAlert('认领请求失败');
    }
  };

  const handleAssignPoolRecord = async () => {
    if (!assigningPoolRecord || !poolPromoterId) return;
    try {
      const res = await fetch('/api/promotion-records/pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'assign',
          recordId: assigningPoolRecord._id,
          promoterId: poolPromoterId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        notify.success('分配成功');
        setAssigningPoolRecord(null);
        setPoolPromoterId('');
        await fetchData();
      } else {
        notify.fromAlert(data.error || '分配失败');
      }
    } catch {
      notify.fromAlert('分配请求失败');
    }
  };

  const handleReleaseToPool = async (recordId: string) => {
    if (!confirm('确定将这条客户线索释放到公海池吗？释放后渠道地推可重新认领。')) return;
    try {
      const res = await fetch('/api/promotion-records/pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'release',
          recordId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        notify.success('已释放到公海池');
        if (selected?._id === recordId) setSelected(data.data);
        await fetchData();
      } else {
        notify.fromAlert(data.error || '释放失败');
      }
    } catch {
      notify.fromAlert('释放请求失败');
    }
  };

  const handleApproveClaim = async (recordId: string) => {
    try {
      const res = await fetch('/api/promotion-records/pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve_claim',
          recordId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        notify.success('认领审批已通过');
        setSelected(data.data);
        await fetchData();
      } else {
        notify.fromAlert(data.error || '审批失败');
      }
    } catch {
      notify.fromAlert('审批请求失败');
    }
  };

  const handleRejectClaim = async (recordId: string) => {
    const reason = window.prompt('请输入驳回原因（可选）', '') || '';
    try {
      const res = await fetch('/api/promotion-records/pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reject_claim',
          recordId,
          reason,
        }),
      });
      const data = await res.json();
      if (data.success) {
        notify.success('认领申请已驳回');
        setSelected(data.data);
        await fetchData();
      } else {
        notify.fromAlert(data.error || '驳回失败');
      }
    } catch {
      notify.fromAlert('驳回请求失败');
    }
  };

  const handleSavePromotionConfig = async () => {
    setConfigSaving(true);
    try {
      const res = await fetch('/api/platform/promotion-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          protectionPeriodDays: Number(configForm.protectionPeriodDays),
          protectionExtendDays: Number(configForm.protectionExtendDays),
          maxProtectionExtends: Number(configForm.maxProtectionExtends),
          poolClaimRequiresApproval: configForm.poolClaimRequiresApproval,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        notify.fromAlert(data.error || '保护期规则保存失败');
        return;
      }
      setPromotionConfig(data.data);
      setConfigForm(buildConfigForm(data.data));
      notify.success('保护期规则已保存');
    } catch {
      notify.fromAlert('保护期规则保存失败');
    } finally {
      setConfigSaving(false);
    }
  };

  const updateRecord = async (
    payload: Record<string, unknown>,
    options?: { closeOnSuccess?: boolean; successMessage?: string }
  ) => {
    if (!selected) return;
    const res = await fetch(`/api/promotion-records/${selected._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) {
      if (options?.closeOnSuccess) {
        setSelected(null);
      } else {
        setSelected(data.data);
      }
      setFollowUpNote('');
      setNextFollowUpAt(data.data.nextFollowUpAt ? String(data.data.nextFollowUpAt).slice(0, 16) : '');
      notify.success(options?.successMessage || '操作成功');
      await fetchData();
    } else {
      notify.fromAlert(data.error || '更新失败');
    }
  };

  const openDetail = async (record: PromotionRecord) => {
    setSelected(record);
    setSelectedPromoter(
      typeof record.promoterId === 'string' ? record.promoterId : record.promoterId?._id || ''
    );
    setNextFollowUpAt(record.nextFollowUpAt ? String(record.nextFollowUpAt).slice(0, 16) : '');
    try {
      const res = await fetch(`/api/promotion-records/${record._id}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setSelected(data.data);
        setSelectedPromoter(
          typeof data.data.promoterId === 'string' ? data.data.promoterId : data.data.promoterId?._id || ''
        );
        setNextFollowUpAt(data.data.nextFollowUpAt ? String(data.data.nextFollowUpAt).slice(0, 16) : '');
      }
    } catch (error) {
      console.error('Failed to fetch promotion record detail', error);
    }
  };

  return (
    <div className="min-h-screen bg-white text-[#171717] font-sans">
      <main className="mx-auto max-w-7xl space-y-8 px-6 py-12">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-[32px] font-semibold tracking-tight">企业报备管理</h2>
            <p className="mt-2 text-sm text-muted-foreground">统一查看地推报备、协作待办、超时任务和线索池分配。</p>
          </div>

          <div className="flex items-center gap-3">
            <select
              className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
            >
              <option value="all">全部阶段</option>
              {Object.entries(stageLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
              value={viewFilter}
              onChange={(e) => setViewFilter(e.target.value)}
            >
              {viewOptions
                .filter((item) => item.key !== 'pendingClaims' || canAssignPromoter)
                .map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
            </select>
            <Button variant="outline" className="rounded-xl" onClick={fetchData}>
              <RefreshCw size={16} className="mr-2" />
              刷新
            </Button>
          </div>
        </div>

        {canAssignPromoter && (
          <section className="rounded-3xl border border-zinc-200 bg-zinc-50/70 p-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-zinc-900">渠道地推保护期规则</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  当前规则会影响新报备、地推认领、公海池重新分配以及跟进后的保护期顺延。
                </p>
                {promotionConfig && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    当前生效: 保护期 {promotionConfig.protectionPeriodDays} 天，单次延长 {promotionConfig.protectionExtendDays} 天，最多延长 {promotionConfig.maxProtectionExtends} 次。
                  </p>
                )}
              </div>
              <Button onClick={handleSavePromotionConfig} disabled={configSaving} className="min-w-36 rounded-xl">
                {configSaving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                保存规则
              </Button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <label className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">保护期天数</span>
                <input
                  type="number"
                  min="1"
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:ring-2 focus:ring-primary/20"
                  value={configForm.protectionPeriodDays}
                  onChange={(e) => setConfigForm((prev) => ({ ...prev, protectionPeriodDays: e.target.value }))}
                />
              </label>
              <label className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">单次延长天数</span>
                <input
                  type="number"
                  min="1"
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:ring-2 focus:ring-primary/20"
                  value={configForm.protectionExtendDays}
                  onChange={(e) => setConfigForm((prev) => ({ ...prev, protectionExtendDays: e.target.value }))}
                />
              </label>
              <label className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">最大延长次数</span>
                <input
                  type="number"
                  min="0"
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:ring-2 focus:ring-primary/20"
                  value={configForm.maxProtectionExtends}
                  onChange={(e) => setConfigForm((prev) => ({ ...prev, maxProtectionExtends: e.target.value }))}
                />
              </label>
              <label className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-white px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-zinc-900">认领后需管理员审批</div>
                  <div className="text-xs text-muted-foreground">开启后，地推认领会先进入待审批状态。</div>
                </div>
                <input
                  type="checkbox"
                  checked={configForm.poolClaimRequiresApproval}
                  onChange={(e) => setConfigForm((prev) => ({ ...prev, poolClaimRequiresApproval: e.target.checked }))}
                  className="h-5 w-5 accent-primary"
                />
              </label>
            </div>
          </section>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="animate-spin" />
          </div>
        ) : (
          <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
            <Table>
              <TableHeader className="bg-zinc-50">
                <TableRow>
                  <TableHead>企业</TableHead>
                  <TableHead>联系人</TableHead>
                  <TableHead>归属地推</TableHead>
                  <TableHead>当前进度</TableHead>
                  <TableHead>最近时点</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecords.map((record) => (
                  <TableRow key={record._id}>
                    <TableCell>
                      <div className="font-semibold">{record.enterpriseName}</div>
                      <div className="text-xs text-muted-foreground">{record.creditCode || '未填信用代码'}</div>
                    </TableCell>
                    <TableCell>
                      <div>{record.contactPerson}</div>
                      <div className="text-xs text-muted-foreground">{record.phone}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {record.poolStatus === 'claimed' && record.claimRequest?.status === 'pending'
                          ? `待审批：${getDisplayName(record.claimRequest.requestedBy) || '未识别申请人'}`
                          : getDisplayName(record.promoterId) || '当前无归属'}
                      </div>
                      <Badge variant="secondary" className="mt-1">
                        {ownershipLabels[record.ownershipStatus || ''] || record.ownershipStatus || '无'}
                      </Badge>
                      {record.poolStatus === 'claimed' && (
                        <Badge variant="outline" className="mt-1 border-amber-200 bg-amber-50 text-amber-700">
                          待审批认领
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary">
                        {stageLabels[record.businessStage || ''] || record.businessStage || '-'}
                      </Badge>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        待办角色: {roleLabels[record.pendingActionRole || ''] || record.pendingActionRole || '无'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{formatDate(getPrimaryDueAt(record))}</div>
                      {isOverdue(record) && (
                        <Badge variant="destructive" className="mt-1">
                          待处理
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {record.poolStatus === 'in_pool' ? (
                        canAssignPool ? (
                          <Button
                            size="sm"
                            variant="default"
                            className="bg-primary text-white"
                            onClick={() => {
                              setAssigningPoolRecord(record);
                              setPoolPromoterId('');
                            }}
                          >
                            分配地推
                          </Button>
                        ) : canClaimPool ? (
                          <Button size="sm" variant="default" className="bg-primary text-white" onClick={() => handleClaim(record._id)}>
                            认领
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => openDetail(record)}>
                            查看
                          </Button>
                        )
                      ) : record.poolStatus === 'claimed' ? (
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => openDetail(record)}>
                            查看详情
                          </Button>
                          {canAssignPromoter && (
                            <>
                              <Button size="sm" variant="default" className="bg-primary text-white" onClick={() => handleApproveClaim(record._id)}>
                                通过认领
                              </Button>
                              <Button size="sm" variant="outline" className="border-zinc-200" onClick={() => handleRejectClaim(record._id)}>
                                驳回
                              </Button>
                            </>
                          )}
                        </div>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => openDetail(record)}>
                            管理
                          </Button>
                          {canReleasePool && !['paid', 'closed_lost'].includes(record.businessStage || '') && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-zinc-200"
                              onClick={() => handleReleaseToPool(record._id)}
                            >
                              释放公海
                            </Button>
                          )}
                          {canAssignPromoter && (
                            <Button size="sm" variant="outline" className="border-zinc-200" onClick={() => openDetail(record)}>
                              指派地推
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {filteredRecords.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      {emptyMessage}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}

        <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
          <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden p-0">
            {selected && (
              <div className="flex max-h-[90vh] flex-col">
                <DialogHeader className="border-b p-6">
                  <DialogTitle>{selected.enterpriseName}</DialogTitle>
                  <DialogDescription>
                    当前阶段：{stageLabels[selected.businessStage || ''] || selected.businessStage} / 归属状态：
                    {ownershipLabels[selected.ownershipStatus || ''] || selected.ownershipStatus}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 overflow-y-auto p-6">
                  <section className="grid gap-6 md:grid-cols-2">
                    <div className="space-y-4">
                      <h3 className="flex items-center gap-2 font-semibold text-zinc-900">
                        <div className="h-4 w-1 rounded-full bg-primary" />
                        企业基础资料
                      </h3>
                      <div className="space-y-3 rounded-2xl border border-zinc-100 bg-zinc-50 p-5 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">联系人</span>
                          <span className="font-medium">{selected.contactPerson || '-'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">电话</span>
                          <span className="font-medium">{selected.phone || '-'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">信用代码</span>
                          <span className="font-medium">{selected.creditCode || '-'}</span>
                        </div>
                        <div className="flex justify-between border-t pt-3">
                          <span className="text-muted-foreground">归属地推</span>
                          <span className="font-medium text-primary">
                            {getDisplayName(selected.promoterId) || '当前无归属'}
                          </span>
                        </div>
                        {selected.claimRequest?.status === 'pending' && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">待审批申请人</span>
                            <span className="font-medium text-amber-700">
                              {getDisplayName(selected.claimRequest.requestedBy) || '未识别申请人'}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h3 className="flex items-center gap-2 font-semibold text-zinc-900">
                        <div className="h-4 w-1 rounded-full bg-primary" />
                        当前业务进度
                      </h3>
                      <div className="space-y-3 rounded-2xl border border-zinc-100 bg-zinc-50 p-5 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">业务阶段</span>
                          <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">
                            {stageLabels[selected.businessStage || ''] || selected.businessStage || '-'}
                          </Badge>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">待办角色</span>
                          <span className="font-medium">{roleLabels[selected.pendingActionRole || ''] || selected.pendingActionRole || '无'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">公海状态</span>
                          <span className="font-medium">
                            {selected.poolStatus === 'protected'
                              ? '保护中'
                              : selected.poolStatus === 'in_pool'
                                ? '公海中'
                                : selected.poolStatus === 'claimed'
                                  ? '待审批认领'
                                  : '-'}
                          </span>
                        </div>
                        <div className="flex justify-between border-t pt-3">
                          <span className="text-muted-foreground">下次跟进</span>
                          <span className="font-medium text-amber-600">{formatDate(selected.nextFollowUpAt)}</span>
                        </div>
                      </div>
                    </div>
                  </section>

                  {selected.poolStatus === 'claimed' && selected.claimRequest?.status === 'pending' && canAssignPromoter && (
                    <section className="space-y-3 rounded-2xl border border-amber-100 bg-amber-50 p-4">
                      <h4 className="text-sm font-semibold text-amber-900">待审批认领申请</h4>
                      <div className="text-sm text-amber-900">
                        申请人：{getDisplayName(selected.claimRequest.requestedBy) || '未识别申请人'}
                      </div>
                      <div className="text-xs text-amber-700">
                        申请时间：{formatDate(selected.claimRequest.requestedAt)}
                      </div>
                      <div className="flex gap-3">
                        <Button className="rounded-xl" onClick={() => handleApproveClaim(selected._id)}>
                          通过认领
                        </Button>
                        <Button
                          variant="outline"
                          className="rounded-xl border-amber-300 bg-white text-amber-800"
                          onClick={() => handleRejectClaim(selected._id)}
                        >
                          驳回申请
                        </Button>
                      </div>
                    </section>
                  )}

                  <section className="space-y-4 border-t pt-6">
                    <h3 className="font-semibold text-zinc-900">推进业务进度</h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-3">
                        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">跟进记录</label>
                        <textarea
                          className="min-h-24 w-full rounded-2xl border border-zinc-200 p-4 text-sm outline-none transition focus:ring-2 focus:ring-primary/20"
                          value={followUpNote}
                          onChange={(e) => setFollowUpNote(e.target.value)}
                          placeholder="记录本次沟通进展、企业意向等信息..."
                        />
                      </div>
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">计划下次跟进</label>
                          <input
                            type="datetime-local"
                            className="h-12 w-full rounded-xl border border-zinc-200 px-4 text-sm outline-none transition focus:ring-2 focus:ring-primary/20"
                            value={nextFollowUpAt}
                            onChange={(e) => setNextFollowUpAt(e.target.value)}
                          />
                        </div>
                        <div className="flex flex-col gap-2 pt-1">
                          <Button
                            className="h-12 rounded-xl bg-[#171717] shadow-sm transition-all hover:bg-zinc-800"
                            onClick={() => updateRecord({ followUpNote, nextFollowUpAt })}
                            disabled={!followUpNote.trim() && !nextFollowUpAt}
                          >
                            保存并录入日志
                          </Button>
                          <Button
                            variant="outline"
                            className="h-12 rounded-xl border-zinc-200"
                            onClick={() => updateRecord({ followUpCompleted: true, nextFollowUpAt })}
                          >
                            标记为已完成跟进
                          </Button>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="space-y-4 border-t pt-6">
                    <h3 className="font-semibold text-zinc-900">操作时间线</h3>
                    <div className="space-y-3">
                      {(selected.followUpRecords || [])
                        .slice()
                        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
                        .map((item, index) => (
                          <div key={`${item.createdAt || 'timeline'}-${index}`} className="rounded-2xl border border-zinc-100 bg-zinc-50 p-4">
                            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="border-zinc-200 bg-white text-zinc-700">
                                  {getTimelineTypeLabel(item.type)}
                                </Badge>
                                <span className="text-sm font-medium text-zinc-900">{item.operator || 'System'}</span>
                              </div>
                              <div className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</div>
                            </div>
                            <div className="mt-2 text-sm text-zinc-700">{item.content || '-'}</div>
                            {item.type === 'pool_claim_rejected' && typeof item.metadata?.rejectReason === 'string' && item.metadata.rejectReason ? (
                              <div className="mt-2 text-xs text-amber-700">驳回原因：{item.metadata.rejectReason}</div>
                            ) : null}
                          </div>
                        ))}
                      {!selected.followUpRecords?.length && (
                        <div className="rounded-2xl border border-dashed border-zinc-200 p-6 text-sm text-muted-foreground">
                          当前还没有操作记录。
                        </div>
                      )}
                    </div>
                  </section>

                  {selected.ownershipStatus !== 'conflict_pending' && canAssignPromoter && (
                    <section className="space-y-3 border-t pt-6">
                      <h3 className="font-semibold text-zinc-900">指派 / 调整渠道地推</h3>
                      <div className="flex gap-3">
                        <Select value={selectedPromoter || undefined} onValueChange={setSelectedPromoter}>
                          <SelectTrigger className="h-10 flex-1 rounded-xl border-zinc-200">
                            <SelectValue placeholder="选择渠道地推" />
                          </SelectTrigger>
                          <SelectContent>
                            {staffOptions.salespeople.map((item) => (
                              <SelectItem key={item._id} value={item._id}>
                                {item.displayName || item.username}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          className="rounded-xl px-6"
                          onClick={() =>
                            updateRecord(
                              { ownershipStatus: 'manually_locked', promoterId: selectedPromoter, resolution: 'manual_assign' },
                              { closeOnSuccess: true, successMessage: '地推指派成功' }
                            )
                          }
                          disabled={!selectedPromoter}
                        >
                          确认指派
                        </Button>
                        {!['paid', 'closed_lost'].includes(selected.businessStage || '') && (
                          <Button
                            variant="outline"
                            className="rounded-xl border-zinc-200 px-6"
                            onClick={() => handleReleaseToPool(selected._id)}
                          >
                            释放到公海池
                          </Button>
                        )}
                      </div>
                    </section>
                  )}

                  {selected.ownershipStatus === 'conflict_pending' && canManage && (
                    <section className="space-y-3 rounded-2xl border border-amber-100 bg-amber-50 p-4">
                      <h4 className="text-sm font-semibold text-amber-900">冲突单归属处理</h4>
                      <div className="flex gap-3">
                        <Select value={selectedPromoter || undefined} onValueChange={setSelectedPromoter}>
                          <SelectTrigger className="h-10 flex-1 rounded-xl border-amber-200 bg-white">
                            <SelectValue placeholder="选择最终归属地推员" />
                          </SelectTrigger>
                          <SelectContent>
                            {staffOptions.salespeople.map((item) => (
                              <SelectItem key={item._id} value={item._id}>
                                {item.displayName || item.username}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          className="rounded-xl border-none bg-amber-600 px-6 hover:bg-amber-700"
                          onClick={() => updateRecord({ ownershipStatus: 'manually_locked', promoterId: selectedPromoter })}
                          disabled={!selectedPromoter}
                        >
                          确认归属
                        </Button>
                      </div>
                    </section>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <Dialog
          open={!!assigningPoolRecord}
          onOpenChange={(open) => {
            if (!open) {
              setAssigningPoolRecord(null);
              setPoolPromoterId('');
            }
          }}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>分配渠道地推</DialogTitle>
              <DialogDescription>
                将 {assigningPoolRecord?.enterpriseName || '该客户'} 从线索池分配给指定地推，分配后会重新进入 {promotionConfig?.protectionPeriodDays ?? 30} 天保护期。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <Select value={poolPromoterId || undefined} onValueChange={setPoolPromoterId}>
                <SelectTrigger className="h-11 w-full rounded-xl border-zinc-200">
                  <SelectValue placeholder="选择渠道地推" />
                </SelectTrigger>
                <SelectContent>
                  {staffOptions.salespeople.map((item) => (
                    <SelectItem key={item._id} value={item._id}>
                      {item.displayName || item.username}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex justify-end gap-3">
                <Button
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => {
                    setAssigningPoolRecord(null);
                    setPoolPromoterId('');
                  }}
                >
                  取消
                </Button>
                <Button className="rounded-xl" onClick={handleAssignPoolRecord} disabled={!poolPromoterId}>
                  确认分配
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
