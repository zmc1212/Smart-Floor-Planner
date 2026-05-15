'use client';

import { notify } from '@/components/ui/operation-feedback';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, PlayCircle, RefreshCw, ShieldAlert } from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type LogStatus = 'sent' | 'failed' | 'skipped';

const STATUS_META: Record<LogStatus, { label: string; className: string }> = {
  sent: { label: '已发送', className: 'bg-green-100 text-green-700 hover:bg-green-100' },
  failed: { label: '发送失败', className: 'bg-red-100 text-red-700 hover:bg-red-100' },
  skipped: { label: '已跳过', className: 'bg-amber-100 text-amber-700 hover:bg-amber-100' },
};

const TYPE_LABELS: Record<string, string> = {
  follow_up_created: '新跟进提醒',
  follow_up_overdue: '跟进超时',
  conflict_pending: '报备冲突',
  measure_assigned: '测量派单',
  measure_overdue: '测量超时',
  measure_submitted: '测量完成',
  design_assigned: '设计派单',
  design_overdue: '设计超时',
  design_completed: '设计完成',
  record_closed: '流程关闭',
};

export default function WorkflowLogsPage() {
  const { user } = useCurrentUser();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | LogStatus>('all');
  const [scanRunning, setScanRunning] = useState(false);
  const [stats, setStats] = useState({ sent: 0, failed: 0, skipped: 0 });
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });

  const canRunScan = user?.role === 'super_admin' || user?.role === 'admin';

  const fetchLogs = async (status = statusFilter, page = pagination.page) => {
    setLoading(true);
    try {
      let url = `/api/workflow-notification-logs?page=${page}&limit=${pagination.limit}`;
      if (status !== 'all') {
        url += `&status=${status}`;
      }
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        setLogs(data.data || []);
        if (data.pagination) {
          setPagination(data.pagination);
        }
        if (data.stats) {
          setStats(data.stats);
        }
      }
    } catch (error) {
      console.error('Failed to fetch workflow logs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs(statusFilter, 1);
  }, [statusFilter]);

  const handleRunScan = async () => {
    setScanRunning(true);
    try {
      const res = await fetch('/api/automation/reminders/run', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        notify.fromAlert(data.error || '提醒扫描执行失败');
        return;
      }
      notify.fromAlert(`提醒扫描已执行，处理 ${data.data?.processed || 0} 条记录`);
      await fetchLogs(statusFilter, 1);
    } catch (error) {
      console.error('Failed to run reminder scan:', error);
      notify.fromAlert('提醒扫描执行失败');
    } finally {
      setScanRunning(false);
    }
  };

  const getStatusBadge = (status: LogStatus) => {
    const meta = STATUS_META[status];
    return (
      <Badge variant="secondary" className={meta.className}>
        {meta.label}
      </Badge>
    );
  };

  return (
    <div className="min-h-screen bg-white font-sans text-[#171717]">
      <main className="mx-auto max-w-7xl space-y-8 px-6 py-16">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <h2 className="text-[32px] font-semibold leading-tight tracking-[-1.5px]">通知记录</h2>
            <p className="text-sm text-muted-foreground">
              查看系统自动发送的站内提醒与小程序订阅消息结果。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant={statusFilter === 'all' ? 'default' : 'outline'} onClick={() => setStatusFilter('all')}>
              全部
            </Button>
            <Button type="button" variant={statusFilter === 'sent' ? 'default' : 'outline'} onClick={() => setStatusFilter('sent')}>
              已发送
            </Button>
            <Button type="button" variant={statusFilter === 'skipped' ? 'default' : 'outline'} onClick={() => setStatusFilter('skipped')}>
              已跳过
            </Button>
            <Button type="button" variant={statusFilter === 'failed' ? 'default' : 'outline'} onClick={() => setStatusFilter('failed')}>
              发送失败
            </Button>
            <Button type="button" variant="outline" onClick={() => fetchLogs(statusFilter, 1)} disabled={loading}>
              <RefreshCw size={16} className="mr-2" />
              刷新
            </Button>
            {canRunScan && (
              <Button type="button" onClick={handleRunScan} disabled={scanRunning}>
                {scanRunning ? <Loader2 size={16} className="mr-2 animate-spin" /> : <PlayCircle size={16} className="mr-2" />}
                立即执行一次提醒扫描
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3 text-green-700">
              <CheckCircle2 size={18} />
              <span className="text-sm font-semibold">已发送</span>
            </div>
            <div className="mt-3 text-3xl font-black">{stats.sent}</div>
          </div>
          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3 text-amber-700">
              <AlertTriangle size={18} />
              <span className="text-sm font-semibold">已跳过</span>
            </div>
            <div className="mt-3 text-3xl font-black">{stats.skipped}</div>
          </div>
          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3 text-red-700">
              <ShieldAlert size={18} />
              <span className="text-sm font-semibold">发送失败</span>
            </div>
            <div className="mt-3 text-3xl font-black">{stats.failed}</div>
          </div>
        </div>

        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead>通知时间</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>企业 / 报备</TableHead>
                <TableHead>接收者</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="w-[300px]">消息内容</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    <Loader2 size={18} className="mx-auto mb-3 animate-spin" />
                    正在加载提醒日志...
                  </TableCell>
                </TableRow>
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    当前没有提醒日志
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow key={log._id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(log.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-medium">
                      {TYPE_LABELS[log.notificationType] || log.notificationType}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{log.recordId?.enterpriseName || '未关联企业'}</div>
                      <div className="text-xs text-muted-foreground">{log.recordId?.contactPerson || '无联系人'}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{log.recipientRole}</div>
                      <div className="text-xs text-muted-foreground">{log.recipientStaffId?.displayName || '系统角色待办'}</div>
                    </TableCell>
                    <TableCell>{getStatusBadge(log.status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {log.errorMessage || log.message || log.metadata?.reason || '-'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {!loading && logs.length > 0 && (
          <Pagination
            total={pagination.total}
            page={pagination.page}
            limit={pagination.limit}
            totalPages={pagination.totalPages}
            onChange={(newPage) => fetchLogs(statusFilter, newPage)}
          />
        )}
      </main>
    </div>
  );
}
