'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Edit, Trash2, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export default function PackagesPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [formData, setFormData] = useState({
    name: '',
    price: '',
    description: '',
    status: 'active'
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/packages');
      const data = await res.json();
      if (data.success) setItems(data.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const method = editingItem ? 'PUT' : 'POST';
    const url = editingItem ? `/api/admin/packages/${editingItem._id}` : '/api/admin/packages';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          price: Number(formData.price)
        }),
      });
      const data = await res.json();
      if (data.success) {
        setOpen(false);
        setEditingItem(null);
        setFormData({ name: '', price: '', description: '', status: 'active' });
        fetchData();
      } else {
        alert(data.error || '保存失败');
      }
    } catch (error) {
      alert('网络错误');
    }
  };

  const handleEdit = (item: any) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      price: String(item.price),
      description: item.description || '',
      status: item.status
    });
    setOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除该套餐吗？')) return;
    try {
      const res = await fetch(`/api/admin/packages/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) fetchData();
    } catch (error) {
      alert('删除失败');
    }
  };

  return (
    <div className="min-h-screen bg-white text-[#171717] font-sans">
      <main className="max-w-7xl mx-auto px-6 py-16 space-y-12">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <h2 className="text-[32px] font-semibold tracking-tight leading-none mb-4">套餐管理</h2>
            <p className="text-muted-foreground">定义和维护企业入驻套餐，供成交订单时选择。</p>
          </div>
          
          <Dialog open={open} onOpenChange={(val) => {
            setOpen(val);
            if (!val) {
              setEditingItem(null);
              setFormData({ name: '', price: '', description: '', status: 'active' });
            }
          }}>
            <DialogTrigger asChild>
              <Button className="rounded-full bg-black hover:bg-zinc-800 h-12 px-6">
                <Plus className="mr-2" size={18} />
                新增套餐
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] rounded-3xl border shadow-2xl">
              <DialogHeader>
                <DialogTitle>{editingItem ? '编辑套餐' : '新增套餐'}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-6 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">套餐名称</Label>
                  <Input 
                    id="name" 
                    value={formData.name} 
                    onChange={(e) => setFormData({...formData, name: e.target.value})} 
                    placeholder="例如：基础版、专业版"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="price">套餐金额 (元)</Label>
                  <Input 
                    id="price" 
                    type="number"
                    value={formData.price} 
                    onChange={(e) => setFormData({...formData, price: e.target.value})} 
                    placeholder="0.00"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">描述信息</Label>
                  <Textarea 
                    id="description" 
                    value={formData.description} 
                    onChange={(e) => setFormData({...formData, description: e.target.value})} 
                    placeholder="关于套餐的简单说明..."
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label>状态</Label>
                  <Select 
                    value={formData.status} 
                    onValueChange={(val) => setFormData({...formData, status: val})}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="选择状态" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">启用</SelectItem>
                      <SelectItem value="disabled">禁用</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button type="submit" className="w-full rounded-xl bg-black hover:bg-zinc-800 h-11">
                    保存套餐
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-32">
            <Loader2 className="animate-spin text-zinc-300" size={32} />
          </div>
        ) : (
          <div className="overflow-hidden rounded-3xl border shadow-sm bg-white">
            <Table>
              <TableHeader className="bg-zinc-50">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[300px]">套餐名称</TableHead>
                  <TableHead>金额</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item._id} className="group transition-colors">
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-semibold text-base">{item.name}</span>
                        <span className="text-xs text-zinc-400 line-clamp-1">{item.description || '暂无描述'}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono font-medium text-lg text-zinc-900">
                      ¥{Number(item.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell>
                      {item.status === 'active' ? (
                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-none px-3 py-1 rounded-full">
                          <CheckCircle size={12} className="mr-1" />
                          已启用
                        </Badge>
                      ) : (
                        <Badge className="bg-zinc-100 text-zinc-500 hover:bg-zinc-100 border-none px-3 py-1 rounded-full">
                          <XCircle size={12} className="mr-1" />
                          已禁用
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-zinc-500 text-sm">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-9 w-9 rounded-full hover:bg-zinc-100"
                          onClick={() => handleEdit(item)}
                        >
                          <Edit size={16} />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-9 w-9 rounded-full hover:bg-zinc-100 text-red-500 hover:text-red-600"
                          onClick={() => handleDelete(item._id)}
                        >
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-48 text-center text-muted-foreground">
                      暂无套餐配置，请点击右上方按钮新增。
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
