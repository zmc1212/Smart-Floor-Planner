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

const viewOptions = [
  { key: 'all', label: '全部' },
  { key: 'followup', label: '待跟进' },
  { key: 'assignMeasure', label: '待分配测量' },
  { key: 'assignDesign', label: '待分配设计' },
  { key: 'overdue', label: '已超时' },
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
      const stageQuery = stageFilter !== 'all' ? `?stage=${stageFilter}` : '';
      const [recordsRes, staffRes] = await Promise.all([fetch(`/api/promotion-records${stageQuery}`), fetch('/api/staff')]);
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
  }, [stageFilter]);

  const filteredRecords = useMemo(() => records.filter((record) => matchesView(record, viewFilter)), [records, viewFilter]);

  const staffOptions = useMemo(
    () => ({
      measurers: staff.filter((item) => item.role === 'measurer'),
      designers: staff.filter((item) => item.role === 'designer'),
      salespeople: staff.filter((item) => item.role === 'salesperson'),
    }),
    [staff]
  );

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
                  <TableHead>归属</TableHead>
                  <TableHead>当前待办</TableHead>
                  <TableHead>截止时间</TableHead>
                  <TableHead>测量 / 设计</TableHead>
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
                        {record.ownershipStatus}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{record.pendingActionRole || 'none'}</div>
                      <div className="text-xs text-muted-foreground">{stageLabels[record.businessStage] || record.businessStage}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{formatDate(getPrimaryDueAt(record))}</div>
                      {isOverdue(record) && <Badge variant="destructive" className="mt-1">已超时</Badge>}
                    </TableCell>
                    <TableCell>
                      <div className="text-xs">测量：{record.measureTask?.status || 'unassigned'}</div>
                      <div className="text-xs text-muted-foreground">设计：{record.designTask?.status || 'unassigned'}</div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => openDetail(record)}>
                        管理
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredRecords.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
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
                    当前阶段：{stageLabels[selected.businessStage] || selected.businessStage} / 归属状态：{selected.ownershipStatus}
                  </DialogDescription>
                </DialogHeader>

                <div className="grid gap-6 p-6 md:grid-cols-2">
                  <section className="space-y-4">
                    <h3 className="font-semibold">基本信息与跟进</h3>
                    <div className="rounded-2xl bg-zinc-50 p-4 text-sm space-y-2">
                      <div>联系人：{selected.contactPerson}</div>
                      <div>电话：{selected.phone}</div>
                      <div>行业：{selected.industry || '-'}</div>
                      <div>地址：{selected.address || '-'}</div>
                      <div>下次跟进：{formatDate(selected.nextFollowUpAt)}</div>
                    </div>

                    <div className="space-y-3">
                      <label className="text-sm font-medium">添加跟进记录</label>
                      <textarea
                        className="min-h-24 w-full rounded-2xl border border-zinc-200 p-3 text-sm"
                        value={followUpNote}
                        onChange={(e) => setFollowUpNote(e.target.value)}
                        placeholder="记录本次跟进内容"
                      />
                      <div className="space-y-2">
                        <label className="text-sm font-medium">下次跟进时间</label>
                        <input
                          type="datetime-local"
                          className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm"
                          value={nextFollowUpAt}
                          onChange={(e) => setNextFollowUpAt(e.target.value)}
                        />
                      </div>
                      <div className="flex gap-3">
                        <Button className="rounded-xl" onClick={() => updateRecord({ followUpNote, nextFollowUpAt })} disabled={!followUpNote.trim() && !nextFollowUpAt}>
                          保存跟进
                        </Button>
                        <Button className="rounded-xl" variant="outline" onClick={() => updateRecord({ followUpCompleted: true, nextFollowUpAt })}>
                          标记本次已跟进
                        </Button>
                      </div>
                    </div>
                  </section>

                  <section className="space-y-4">
                    <h3 className="font-semibold">协作任务</h3>

                    {canManage && (
                      <div className="space-y-4 rounded-2xl border p-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">分配测量员</label>
                          <select className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm" value={assignMeasurer} onChange={(e) => setAssignMeasurer(e.target.value)}>
                            <option value="">未分配</option>
                            {staffOptions.measurers.map((item) => (
                              <option key={item._id} value={item._id}>
                                {item.displayName || item.username}
                              </option>
                            ))}
                          </select>
                          <Button className="rounded-xl" variant="outline" onClick={() => updateRecord({ assignMeasurer })} disabled={!assignMeasurer}>
                            保存测量分配
                          </Button>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium">分配设计师</label>
                          <select className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm" value={assignDesigner} onChange={(e) => setAssignDesigner(e.target.value)}>
                            <option value="">未分配</option>
                            {staffOptions.designers.map((item) => (
                              <option key={item._id} value={item._id}>
                                {item.displayName || item.username}
                              </option>
                            ))}
                          </select>
                          <Button className="rounded-xl" variant="outline" onClick={() => updateRecord({ assignDesigner })} disabled={!assignDesigner}>
                            保存设计分配
                          </Button>
                        </div>

                        {selected.ownershipStatus === 'conflict_pending' && (
                          <div className="space-y-2 border-t pt-4">
                            <label className="text-sm font-medium">冲突归属处理</label>
                            <select className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm" value={selectedPromoter} onChange={(e) => setSelectedPromoter(e.target.value)}>
                              <option value="">选择地推员</option>
                              {staffOptions.salespeople.map((item) => (
                                <option key={item._id} value={item._id}>
                                  {item.displayName || item.username}
                                </option>
                              ))}
                            </select>
                            <Button className="rounded-xl" onClick={() => updateRecord({ ownershipStatus: 'manually_locked', promoterId: selectedPromoter })} disabled={!selectedPromoter}>
                              确认归属
                            </Button>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="rounded-2xl bg-zinc-50 p-4 text-sm space-y-2">
                      <div>当前待办：{selected.pendingActionRole || 'none'}</div>
                      <div>测量状态：{selected.measureTask?.status || 'unassigned'}</div>
                      <div>测量截止：{formatDate(selected.measureTask?.dueAt)}</div>
                      <div>设计状态：{selected.designTask?.status || 'unassigned'}</div>
                      <div>设计截止：{formatDate(selected.designTask?.dueAt)}</div>
                      <div>最近测量结果：{selected.measureTask?.resultSummary || '-'}</div>
                      <div>设计备注：{selected.designTask?.latestNote || '-'}</div>
                    </div>
                  </section>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
