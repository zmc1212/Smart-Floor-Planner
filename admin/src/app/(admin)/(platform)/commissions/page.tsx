'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function CommissionsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/commission-records');
      const data = await res.json();
      if (data.success) setItems(data.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const updateStatus = async (id: string, status: 'paid' | 'voided') => {
    const res = await fetch(`/api/commission-records/${id}`, {
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
        <div>
          <h2 className="text-[32px] font-semibold tracking-tight">提成结算管理</h2>
          <p className="mt-2 text-sm text-muted-foreground">付款成功后自动生成提成记录，在这里完成结算标记。</p>
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
                  <TableHead>地推员</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>金额</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>生成时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item._id}>
                    <TableCell>{item.promoterId?.displayName || item.promoterId?.username || '-'}</TableCell>
                    <TableCell>{item.commissionType}</TableCell>
                    <TableCell>¥{Number(item.commissionAmount || 0).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{item.status}</Badge>
                    </TableCell>
                    <TableCell>{new Date(item.generatedAt).toLocaleString()}</TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button size="sm" variant="outline" onClick={() => updateStatus(item._id, 'paid')} disabled={item.status === 'paid'}>
                        标记已打款
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => updateStatus(item._id, 'voided')} disabled={item.status === 'voided'}>
                        作废
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      暂无提成记录
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
