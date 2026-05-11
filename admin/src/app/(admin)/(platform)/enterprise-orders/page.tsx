'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export default function EnterpriseOrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [records, setRecords] = useState<any[]>([]);
  const [packages, setPackages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ 
    recordId: '', 
    packageId: '', 
    packageName: '', 
    amount: '', 
    status: 'draft', 
    remark: '' 
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [ordersRes, recordsRes, packagesRes] = await Promise.all([
        fetch('/api/enterprise-orders'),
        fetch('/api/promotion-records'),
        fetch('/api/admin/packages?status=active')
      ]);
      const ordersData = await ordersRes.json();
      const recordsData = await recordsRes.json();
      const packagesData = await packagesRes.json();
      if (ordersData.success) setOrders(ordersData.data || []);
      if (recordsData.success) setRecords(recordsData.data || []);
      if (packagesData.success) setPackages(packagesData.data || []);
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
      setForm({ recordId: '', packageId: '', packageName: '', amount: '', status: 'draft', remark: '' });
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

  const activateEnterprise = async (order: any) => {
    if (!confirm(`确定要为 ${order.enterpriseNameSnapshot} 开通正式账号吗？\n系统将自动创建企业并分配管理员账号。`)) return;

    try {
      const res = await fetch('/api/admin/enterprises/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          recordId: order.recordId?._id || order.recordId,
          orderId: order._id 
        }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`开通成功！\n企业：${data.data.enterpriseName}\n管理员账号：${data.data.adminUsername}\n初始密码：${data.data.tempPassword}\n请通知客户尽快登录并修改密码。`);
        fetchData();
      } else {
        alert(data.error || '开通失败');
      }
    } catch (error) {
      alert('网络请求失败');
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
          <Button className="rounded-full bg-black hover:bg-zinc-800 h-11 px-6" onClick={() => setOpen(true)}>
            <Plus size={16} className="mr-2" />
            新建订单
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="animate-spin text-zinc-300" size={32} />
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
                    <TableCell>
                      <div className="font-medium">{order.enterpriseNameSnapshot}</div>
                      {order.enterpriseId && (
                        <div className="text-[10px] text-green-600 font-mono flex items-center gap-1">
                          <CheckCircle2 size={10} />
                          已开通 (ID: {String(order.enterpriseId).slice(-6)})
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{order.packageName}</TableCell>
                    <TableCell className="font-mono">¥{Number(order.amount || 0).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant={order.status === 'paid' ? 'default' : 'secondary'} className="rounded-full px-3">
                        {order.status === 'paid' ? '已支付' : 
                         order.status === 'signed' ? '已签约' :
                         order.status === 'draft' ? '草稿' : order.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-zinc-500 text-sm">{new Date(order.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-3">
                        {!order.enterpriseId && order.status === 'paid' && (
                          <Button 
                            size="sm" 
                            variant="outline" 
                            className="h-8 rounded-full border-zinc-200"
                            onClick={() => activateEnterprise(order)}
                          >
                            开通账号
                          </Button>
                        )}
                        <Select
                          value={order.status}
                          onValueChange={(val) => updateStatus(order._id, val)}
                        >
                          <SelectTrigger className="h-8 w-[100px] text-xs rounded-full bg-zinc-50 border-none shadow-none">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="draft">草稿</SelectItem>
                            <SelectItem value="signed">已签约</SelectItem>
                            <SelectItem value="paid">已支付</SelectItem>
                            <SelectItem value="cancelled">已取消</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {orders.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-48 text-center text-muted-foreground">
                      暂无订单记录
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-[425px] rounded-3xl border shadow-2xl">
            <DialogHeader>
              <DialogTitle>新建成交订单</DialogTitle>
            </DialogHeader>
            <div className="space-y-6 py-4">
              <div className="space-y-2">
                <Label>企业报备</Label>
                <Select
                  value={form.recordId}
                  onValueChange={(val) => setForm((prev) => ({ ...prev, recordId: val }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择企业报备" />
                  </SelectTrigger>
                  <SelectContent>
                    {records.map((record) => (
                      <SelectItem key={record._id} value={record._id}>
                        {record.enterpriseName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>成交套餐</Label>
                <Select
                  value={form.packageId}
                  onValueChange={(val) => {
                    const pkg = packages.find(p => p._id === val);
                    setForm((prev) => ({ 
                      ...prev, 
                      packageId: val,
                      packageName: pkg?.name || '',
                      amount: pkg ? String(pkg.price) : prev.amount
                    }));
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择成交套餐" />
                  </SelectTrigger>
                  <SelectContent>
                    {packages.map((pkg) => (
                      <SelectItem key={pkg._id} value={pkg._id}>
                        {pkg.name} (¥{pkg.price})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>成交金额 (元)</Label>
                <Input
                  value={form.amount}
                  onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                  placeholder="成交金额"
                  type="number"
                />
              </div>

              <div className="space-y-2">
                <Label>订单状态</Label>
                <Select
                  value={form.status}
                  onValueChange={(val) => setForm((prev) => ({ ...prev, status: val }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">草稿</SelectItem>
                    <SelectItem value="signed">已签约</SelectItem>
                    <SelectItem value="paid">已支付</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>备注</Label>
                <Textarea
                  value={form.remark}
                  onChange={(e) => setForm((prev) => ({ ...prev, remark: e.target.value }))}
                  placeholder="备注信息..."
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button 
                className="w-full rounded-xl bg-black hover:bg-zinc-800 h-11" 
                onClick={createOrder} 
                disabled={!form.recordId || !form.packageName || !form.amount}
              >
                保存订单
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
