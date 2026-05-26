'use client';

import { notify } from '@/components/ui/operation-feedback';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';

import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, AlertCircle, Banknote, Filter } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export default function CommissionsPage() {
  const confirmAction = useConfirmDialog();
  const [items, setItems] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const url = `/api/commissions${statusFilter ? `?status=${statusFilter}` : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        setItems(data.data || []);
        setSummary(data.summary || {});
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [statusFilter]);

  const settleCommission = async (id: string) => {
    const confirmed = await confirmAction({
      title: '确认结算',
      description: '确认已完成线下打款并标记为已结算吗？',
      confirmText: '标记已结算',
    });
    if (!confirmed) return;
    
    try {
      const res = await fetch(`/api/commissions/${id}/settle`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        notify.success('提成已标记为已发放');
        fetchData();
      } else {
        notify.fromAlert(data.error || '操作失败');
      }
    } catch (error) {
      notify.fromAlert('网络错误');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid':
        return <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-none">已发放</Badge>;
      case 'pending_settlement':
        return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-none">待结算</Badge>;
      case 'voided':
        return <Badge className="bg-zinc-100 text-zinc-500 hover:bg-zinc-100 border-none">已作废</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-white text-[#171717] font-sans">
      <main className="max-w-7xl mx-auto px-6 py-16 space-y-12">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div>
            <h2 className="text-[32px] font-semibold tracking-tight leading-none mb-4">提成结算中心</h2>
            <p className="text-muted-foreground">管理地推人员的佣金发放，基于成交订单自动核算。</p>
          </div>
          
          <div className="flex items-center gap-2 bg-zinc-50 p-1 rounded-xl border">
            {[
              { label: '全部', value: '' },
              { label: '待结算', value: 'pending_settlement' },
              { label: '已发放', value: 'paid' }
            ].map((tab) => (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-lg transition-all",
                  statusFilter === tab.value 
                    ? "bg-white shadow-sm text-black" 
                    : "text-zinc-500 hover:text-black"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 rounded-3xl border bg-zinc-50/50 space-y-2">
            <div className="flex items-center gap-2 text-zinc-500 text-sm font-medium">
              <AlertCircle size={16} />
              待结算总额
            </div>
            <div className="text-3xl font-bold">
              ¥{Number(summary.pending_settlement?.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
            <div className="text-xs text-zinc-400">{summary.pending_settlement?.count || 0} 笔待处理</div>
          </div>
          <div className="p-6 rounded-3xl border bg-zinc-50/50 space-y-2">
            <div className="flex items-center gap-2 text-zinc-500 text-sm font-medium">
              <CheckCircle2 size={16} className="text-green-600" />
              已发放总额
            </div>
            <div className="text-3xl font-bold">
              ¥{Number(summary.paid?.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
            <div className="text-xs text-zinc-400">{summary.paid?.count || 0} 笔已入账</div>
          </div>
          <div className="p-6 rounded-3xl border bg-black text-white space-y-2">
            <div className="flex items-center gap-2 text-zinc-400 text-sm font-medium">
              <Banknote size={16} />
              累计核算
            </div>
            <div className="text-3xl font-bold">
              ¥{Number((summary.pending_settlement?.amount || 0) + (summary.paid?.amount || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
            <div className="text-xs text-zinc-500">成交转化产生的提成总计</div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-32">
            <Loader2 className="animate-spin text-zinc-300" size={32} />
          </div>
        ) : (
          <div className="overflow-hidden rounded-3xl border shadow-sm">
            <Table>
              <TableHeader className="bg-zinc-50">
                <TableRow className="hover:bg-transparent">
                  <TableHead>地推人员</TableHead>
                  <TableHead>关联企业 / 订单</TableHead>
                  <TableHead>提成金额</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>生成日期</TableHead>
                  <TableHead className="text-right">结算操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item._id} className="group">
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-semibold">{item.promoterId?.displayName || item.promoterId?.username}</span>
                        <span className="text-[11px] text-zinc-400">ID: {String(item.promoterId?._id).slice(-6)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-sm">{item.recordId?.enterpriseName || '未知企业'}</span>
                        <span className="text-[11px] text-zinc-400">{item.orderId?.packageName || '标准套餐'}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono font-medium">¥{Number(item.commissionAmount || 0).toFixed(2)}</TableCell>
                    <TableCell>{getStatusBadge(item.status)}</TableCell>
                    <TableCell className="text-zinc-500 text-sm">{new Date(item.generatedAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      {item.status === 'pending_settlement' ? (
                        <Button 
                          size="sm" 
                          className="rounded-full bg-black hover:bg-zinc-800 h-8 px-4 text-[13px]"
                          onClick={() => settleCommission(item._id)}
                        >
                          确认发放
                        </Button>
                      ) : item.status === 'paid' ? (
                        <div className="text-[12px] text-zinc-400 flex items-center justify-end gap-1">
                          <CheckCircle2 size={12} />
                          {new Date(item.settledAt).toLocaleDateString()} 已结
                        </div>
                      ) : (
                        <span className="text-[12px] text-zinc-300">不可操作</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-48 text-center text-muted-foreground">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Filter className="text-zinc-200" size={32} />
                        <p>没有找到符合条件的提成记录</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </main>
    </div>
  );
}
