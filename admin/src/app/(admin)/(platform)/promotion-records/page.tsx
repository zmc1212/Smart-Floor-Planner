'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const stageLabels: Record<string, string> = {
  reported: '已报备',
  contacted: '已联系',
  measuring: '测量中',
  designing: '设计中',
  quoted: '已报价',
  paid: '已成交',
  closed_lost: '已失效',
};

const ownershipLabels: Record<string, string> = {
  unassigned: '待分配',
  auto_locked: '系统锁定',
  manually_locked: '人工锁定',
  conflict_pending: '冲突待核',
};

const taskStatusLabels: Record<string, string> = {
  unassigned: '待分配',
  pending: '待处理',
  accepted: '已接受',
  in_progress: '进行中',
  submitted: '已提交',
  completed: '已完成',
  rejected: '已拒绝',
};

const roleLabels: Record<string, string> = {
  none: '无',
  salesperson: '渠道地推',
  measurer: '测量员',
  designer: '设计师',
  enterprise_admin: '企业负责人',
};

const viewOptions = [
  { key: 'all', label: '全部' },
  { key: 'followup', label: '待跟进' },
  { key: 'assignMeasure', label: '待分配测量' },
  { key: 'assignDesign', label: '待分配设计' },
  { key: 'overdue', label: '已超时' },
  { key: 'pool', label: '公海池' },
];

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

function getPrimaryDueAt(record: any) {
  return record.nextFollowUpAt || record.measureTask?.dueAt || record.designTask?.dueAt || null;
}

function isOverdue(record: any) {
  const dueAt = parseDate(getPrimaryDueAt(record));
  return !!dueAt && dueAt.getTime() < Date.now();
}

function matchesView(record: any, view: string) {
  if (view === 'all') return true;
  if (view === 'followup') return record.pendingActionRole === 'salesperson';
  if (view === 'assignMeasure') return record.businessStage === 'measuring' && record.measureTask?.status === 'unassigned';
  if (view === 'assignDesign') return record.measureTask?.status === 'submitted' && record.designTask?.status === 'unassigned';
  if (view === 'overdue') return isOverdue(record);
  if (view === 'pool') return record.poolStatus === 'in_pool';
  return true;
}

export default function PromotionRecordsPage() {
  const { user } = useCurrentUser();
  const [records, setRecords] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState('all');
  const [viewFilter, setViewFilter] = useState('all');
  const [selected, setSelected] = useState<any | null>(null);
  const [followUpNote, setFollowUpNote] = useState('');
  const [nextFollowUpAt, setNextFollowUpAt] = useState('');
  const [assignMeasurer, setAssignMeasurer] = useState('');
  const [assignDesigner, setAssignDesigner] = useState('');
  const [selectedPromoter, setSelectedPromoter] = useState('');

  const canManage = !!user && ['enterprise_admin', 'admin', 'super_admin'].includes(user.role);

  const fetchData = async () => {
    setLoading(true);
    try {
      const isPool = viewFilter === 'pool';
      const endpoint = isPool ? '/api/promotion-records/pool' : '/api/promotion-records';
      const stageQuery = stageFilter !== 'all' && !isPool ? `?stage=${stageFilter}` : '';
      
      const [recordsRes, staffRes] = await Promise.all([
        fetch(`${endpoint}${stageQuery}`), 
        fetch('/api/staff')
      ]);
      const recordsData = await recordsRes.json();
      const staffData = await staffRes.json();

      if (recordsData.success) setRecords(recordsData.data || []);
      if (staffData.success) setStaff(staffData.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [stageFilter, viewFilter]);

  const filteredRecords = useMemo(() => records.filter((record) => matchesView(record, viewFilter)), [records, viewFilter]);

  const staffOptions = useMemo(
    () => ({
      measurers: staff.filter((item) => item.role === 'measurer'),
      designers: staff.filter((item) => item.role === 'designer'),
      salespeople: staff.filter((item) => item.role === 'salesperson'),
    }),
    [staff]
  );

  const handleClaim = async (recordId: string) => {
    if (!confirm('确定要从公海池认领这条报备记录吗？认领后您将拥有 30 天保护期。')) return;
    try {
      const res = await fetch('/api/promotion-records/pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId }),
      });
      const data = await res.json();
      if (data.success) {
        alert('认领成功！');
        setViewFilter('all');
        await fetchData();
      } else {
        alert(data.error || '认领失败');
      }
    } catch (err) {
      alert('认领请求失败');
    }
  };

  const updateRecord = async (payload: Record<string, unknown>) => {
    if (!selected) return;
    const res = await fetch(`/api/promotion-records/${selected._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) {
      setSelected(data.data);
      setFollowUpNote('');
      setNextFollowUpAt(data.data.nextFollowUpAt ? String(data.data.nextFollowUpAt).slice(0, 16) : '');
      await fetchData();
    } else {
      alert(data.error || '更新失败');
    }
  };

  const openDetail = (record: any) => {
    setSelected(record);
    setAssignMeasurer(record.measureTask?.assignedTo?._id || '');
    setAssignDesigner(record.designTask?.assignedTo?._id || '');
    setSelectedPromoter(record.promoterId?._id || record.promoterId || '');
    setNextFollowUpAt(record.nextFollowUpAt ? String(record.nextFollowUpAt).slice(0, 16) : '');
  };

  return (
    <div className="min-h-screen bg-white text-[#171717] font-sans">
      <main className="max-w-7xl mx-auto px-6 py-12 space-y-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-[32px] font-semibold tracking-tight">企业报备管理</h2>
            <p className="text-sm text-muted-foreground mt-2">统一查看地推报备、协作待办、超时任务和冲突单处理。</p>
          </div>

          <div className="flex items-center gap-3">
            <select className="h-10 rounded-xl border border-zinc-200 px-3 text-sm" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
              <option value="all">全部阶段</option>
              {Object.entries(stageLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select className="h-10 rounded-xl border border-zinc-200 px-3 text-sm" value={viewFilter} onChange={(e) => setViewFilter(e.target.value)}>
              {viewOptions.map((item) => (
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
                  <TableHead>最后跟进</TableHead>
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
                      <div className="text-sm">{record.promoterId?.displayName || record.promoterId?.username || '-'}</div>
                      <Badge variant="secondary" className="mt-1">
                        {ownershipLabels[record.ownershipStatus] || record.ownershipStatus}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20">
                        {stageLabels[record.businessStage] || record.businessStage}
                      </Badge>
                      <div className="text-[10px] text-muted-foreground mt-1">待办角色: {roleLabels[record.pendingActionRole] || record.pendingActionRole || '无'}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{formatDate(getPrimaryDueAt(record))}</div>
                      {isOverdue(record) && <Badge variant="destructive" className="mt-1">待跟进</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      {record.poolStatus === 'in_pool' ? (
                        <Button size="sm" variant="default" className="bg-primary text-white" onClick={() => handleClaim(record._id)}>
                          认领
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => openDetail(record)}>
                          管理
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {filteredRecords.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      暂无匹配的企业报备
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}

        <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
          <DialogContent className="max-w-3xl p-0 overflow-hidden">
            {selected && (
              <div className="space-y-0">
                <DialogHeader className="border-b p-6">
                  <DialogTitle>{selected.enterpriseName}</DialogTitle>
                  <DialogDescription>
                    当前阶段：{stageLabels[selected.businessStage] || selected.businessStage} / 归属状态：{ownershipLabels[selected.ownershipStatus] || selected.ownershipStatus}
                  </DialogDescription>
                </DialogHeader>

                <div className="p-6 space-y-6">
                  <section className="grid gap-6 md:grid-cols-2">
                    <div className="space-y-4">
                      <h3 className="font-semibold text-zinc-900 flex items-center gap-2">
                        <div className="w-1 h-4 bg-primary rounded-full" />
                        企业基本资料
                      </h3>
                      <div className="rounded-2xl bg-zinc-50 p-5 text-sm space-y-3 border border-zinc-100">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">联系人</span>
                          <span className="font-medium">{selected.contactPerson}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">电话</span>
                          <span className="font-medium">{selected.phone}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">信用代码</span>
                          <span className="font-medium">{selected.creditCode || '-'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">行业</span>
                          <span className="font-medium">{selected.industry || '-'}</span>
                        </div>
                        <div className="flex justify-between border-t pt-3 mt-1">
                          <span className="text-muted-foreground">归属地推</span>
                          <span className="font-medium text-primary">{selected.promoterId?.displayName || selected.promoterId?.username || '未分配'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h3 className="font-semibold text-zinc-900 flex items-center gap-2">
                        <div className="w-1 h-4 bg-primary rounded-full" />
                        当前商务进度
                      </h3>
                      <div className="rounded-2xl bg-zinc-50 p-5 text-sm space-y-3 border border-zinc-100">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">业务阶段</span>
                          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">{stageLabels[selected.businessStage] || selected.businessStage}</Badge>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">待办角色</span>
                          <span className="font-medium">{roleLabels[selected.pendingActionRole] || selected.pendingActionRole || '无'}</span>
                        </div>
                        <div className="flex justify-between border-t pt-3 mt-1">
                          <span className="text-muted-foreground">下次跟进</span>
                          <span className="font-medium text-amber-600">{formatDate(selected.nextFollowUpAt)}</span>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="space-y-4 border-t pt-6">
                    <h3 className="font-semibold text-zinc-900">推进商务进度</h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-3">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">跟进记录</label>
                        <textarea
                          className="min-h-24 w-full rounded-2xl border border-zinc-200 p-4 text-sm focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                          value={followUpNote}
                          onChange={(e) => setFollowUpNote(e.target.value)}
                          placeholder="记录本次沟通进展、企业意向等信息..."
                        />
                      </div>
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">计划下次跟进</label>
                          <input
                            type="datetime-local"
                            className="h-12 w-full rounded-xl border border-zinc-200 px-4 text-sm focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                            value={nextFollowUpAt}
                            onChange={(e) => setNextFollowUpAt(e.target.value)}
                          />
                        </div>
                        <div className="flex flex-col gap-2 pt-1">
                          <Button className="h-12 rounded-xl shadow-sm bg-[#171717] hover:bg-zinc-800 transition-all" onClick={() => updateRecord({ followUpNote, nextFollowUpAt })} disabled={!followUpNote.trim() && !nextFollowUpAt}>
                            保存并录入日志
                          </Button>
                          <Button variant="outline" className="h-12 rounded-xl border-zinc-200" onClick={() => updateRecord({ followUpCompleted: true, nextFollowUpAt })}>
                            标记为已完成跟进
                          </Button>
                        </div>
                      </div>
                    </div>
                  </section>

                  {selected.ownershipStatus === 'conflict_pending' && canManage && (
                    <section className="p-4 rounded-2xl bg-amber-50 border border-amber-100 space-y-3">
                      <h4 className="text-sm font-semibold text-amber-900">冲突单归属处理</h4>
                      <div className="flex gap-3">
                        <select className="h-10 flex-1 rounded-xl border border-amber-200 px-3 text-sm" value={selectedPromoter} onChange={(e) => setSelectedPromoter(e.target.value)}>
                          <option value="">选择最终归属地推员</option>
                          {staffOptions.salespeople.map((item) => (
                            <option key={item._id} value={item._id}>
                              {item.displayName || item.username}
                            </option>
                          ))}
                        </select>
                        <Button className="rounded-xl bg-amber-600 hover:bg-amber-700 border-none px-6" onClick={() => updateRecord({ ownershipStatus: 'manually_locked', promoterId: selectedPromoter })} disabled={!selectedPromoter}>
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
      </main>
    </div>
  );
}
