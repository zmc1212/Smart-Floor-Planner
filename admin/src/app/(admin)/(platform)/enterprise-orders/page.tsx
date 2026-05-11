'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function EnterpriseOrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ recordId: '', packageName: '', amount: '', status: 'draft', remark: '' });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [ordersRes, recordsRes] = await Promise.all([fetch('/api/enterprise-orders'), fetch('/api/promotion-records')]);
      const ordersData = await ordersRes.json();
      const recordsData = await recordsRes.json();
      if (ordersData.success) setOrders(ordersData.data || []);
      if (recordsData.success) setRecords(recordsData.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const createOrder = async () => {
    const res = await fetch('/api/enterprise-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        amount: Number(form.amount),
      }),
    });
    const data = await res.json();
    if (data.success) {
      setOpen(false);
      setForm({ recordId: '', packageName: '', amount: '', status: 'draft', remark: '' });
      fetchData();
    } else {
      alert(data.error || '创建失败');
    }
  };

  const updateStatus = async (id: string, status: string) => {
    const res = await fetch(`/api/enterprise-orders/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (data.success) {
      fetchData();
    } else {
      alert(data.error || '更新失败');
    }
  };

  return (
    <div className="min-h-screen bg-white text-[#171717] font-sans">
      <main className="max-w-7xl mx-auto px-6 py-12 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[32px] font-semibold tracking-tight">成交订单管理</h2>
            <p className="mt-2 text-sm text-muted-foreground">后台手工登记企业成交，付款后自动生成提成记录。</p>
          </div>
          <Button className="rounded-xl" onClick={() => setOpen(true)}>
            <Plus size={16} className="mr-2" />
            新建订单
          </Button>
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
                  <TableHead>套餐</TableHead>
                  <TableHead>金额</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order._id}>
                    <TableCell>{order.enterpriseNameSnapshot}</TableCell>
                    <TableCell>{order.packageName}</TableCell>
                    <TableCell>¥{Number(order.amount || 0).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{order.status}</Badge>
                    </TableCell>
                    <TableCell>{new Date(order.createdAt).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <select
                        className="h-9 rounded-lg border border-zinc-200 px-2 text-sm"
                        value={order.status}
                        onChange={(e) => updateStatus(order._id, e.target.value)}
                      >
                        <option value="draft">draft</option>
                        <option value="signed">signed</option>
                        <option value="paid">paid</option>
                        <option value="cancelled">cancelled</option>
                      </select>
                    </TableCell>
                  </TableRow>
                ))}
                {orders.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      暂无订单
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>新建成交订单</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <select
                className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm"
                value={form.recordId}
                onChange={(e) => setForm((prev) => ({ ...prev, recordId: e.target.value }))}
              >
                <option value="">选择企业报备</option>
                {records.map((record) => (
                  <option key={record._id} value={record._id}>
                    {record.enterpriseName}
                  </option>
                ))}
              </select>
              <Input
                value={form.packageName}
                onChange={(e) => setForm((prev) => ({ ...prev, packageName: e.target.value }))}
                placeholder="套餐名称"
              />
              <Input
                value={form.amount}
                onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                placeholder="成交金额"
                type="number"
              />
              <select
                className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-sm"
                value={form.status}
                onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
              >
                <option value="draft">draft</option>
                <option value="signed">signed</option>
                <option value="paid">paid</option>
              </select>
              <textarea
                className="min-h-24 w-full rounded-xl border border-zinc-200 p-3 text-sm"
                value={form.remark}
                onChange={(e) => setForm((prev) => ({ ...prev, remark: e.target.value }))}
                placeholder="备注"
              />
              <Button className="w-full rounded-xl" onClick={createOrder} disabled={!form.recordId || !form.packageName || !form.amount}>
                保存订单
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
