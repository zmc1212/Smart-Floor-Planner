'use client';

import React, { useState, useEffect } from 'react';
import { Loader2, Plus, Building2, User, Phone, Mail, Copy, Check, MoreHorizontal } from "lucide-react";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export default function EnterprisesPage() {
  const [enterprises, setEnterprises] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEnt, setSelectedEnt] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEnt, setEditingEnt] = useState<any>(null);
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    contactPerson: { name: '', phone: '', email: '' },
    logo: '',
    branding: { primaryColor: '#171717', accentColor: '#0070f3' }
  });
  const [copyFeedback, setCopyFeedback] = useState(false);

  const fetchEnterprises = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/enterprises');
      const data = await res.json();
      if (data.success) {
        setEnterprises(data.data);
        if (selectedEnt) {
          const updated = data.data.find((e: any) => e._id === selectedEnt._id);
          if (updated) setSelectedEnt(updated);
        }
      }
    } catch (err) {
      console.error('Failed to fetch enterprises:', err);
    } finally {
      setLoading(false);
    }
  };

  const copyInvitationLink = () => {
    const link = `${window.location.origin}/register`;
    navigator.clipboard.writeText(link).then(() => {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    });
  };

  useEffect(() => {
    fetchEnterprises();
  }, []);

  const openModal = (ent: any = null) => {
    if (ent) {
      setEditingEnt(ent);
      setFormData({
        name: ent.name || '',
        code: ent.code || '',
        contactPerson: {
          name: ent.contactPerson?.name || '',
          phone: ent.contactPerson?.phone || '',
          email: ent.contactPerson?.email || ''
        },
        logo: ent.logo || '',
        branding: {
          primaryColor: ent.branding?.primaryColor || '#171717',
          accentColor: ent.branding?.accentColor || '#0070f3'
        }
      });
    } else {
      setEditingEnt(null);
      setFormData({
        name: '',
        code: '',
        contactPerson: { name: '', phone: '', email: '' },
        logo: '',
        branding: { primaryColor: '#171717', accentColor: '#0070f3' }
      });
    }
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const url = editingEnt ? `/api/admin/enterprises/${editingEnt._id}` : '/api/admin/enterprises';
      const method = editingEnt ? 'PATCH' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert(editingEnt ? '修改成功' : '创建成功');
        setIsModalOpen(false);
        fetchEnterprises();
      } else {
        alert(data.error || '保存失败');
      }
    } catch (err) {
      console.error('Failed to save enterprise:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/admin/enterprises/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert('操作成功');
        await fetchEnterprises();
        setSelectedEnt(null);
      } else {
        alert(data.error || '操作失败');
      }
    } catch (err) {
      console.error('Failed to update enterprise status:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteEnterprise = async (id: string) => {
    if (!confirm('确定要删除该企业吗？此操作不可逆。')) return;
    try {
      const res = await fetch(`/api/admin/enterprises/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setSelectedEnt(null);
        fetchEnterprises();
      }
    } catch (err) {
      console.error('Failed to delete enterprise:', err);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending_approval':
        return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100/80 border-none">待审核</Badge>;
      case 'active':
        return <Badge variant="secondary" className="bg-green-100 text-green-800 hover:bg-green-100/80 border-none">已启用</Badge>;
      case 'disabled':
        return <Badge variant="outline" className="text-gray-500 border-gray-200">已禁用</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-white text-[#171717] font-sans">
      <main className="max-w-7xl mx-auto px-6 py-16">
        <div className="mb-12 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <h2 className="text-[32px] font-semibold tracking-[-1.5px] leading-tight">
              企业管理 (租户)
            </h2>
            {!loading && (
              <span className="bg-[#f5f5f5] text-[#666] px-3 py-1 rounded-full text-[14px] font-medium">
                共 {enterprises.length} 家
              </span>
            )}
          </div>
          <div className="flex gap-4">
            <Button 
              variant="outline"
              onClick={copyInvitationLink}
              className="rounded-full flex items-center gap-2"
            >
               {copyFeedback ? <Check size={16} /> : <Copy size={16} />}
               {copyFeedback ? '已复制链接' : '复制邀请链接'}
            </Button>
            <Button 
              onClick={() => openModal()}
              className="rounded-full flex items-center gap-2"
            >
               <Plus size={16} />
               手动添加企业
            </Button>
          </div>
        </div>

        {loading && (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="animate-spin mb-4" size={32} />
            <p className="text-sm">正在获取企业数据...</p>
          </div>
        )}

        {!loading && (
          <div className="border rounded-2xl overflow-hidden shadow-sm">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-[30%]">机构名称</TableHead>
                  <TableHead>代码/编号</TableHead>
                  <TableHead>联系人</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>模式</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enterprises.map((ent: any) => (
                  <TableRow key={ent._id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-muted rounded-lg flex items-center justify-center">
                          <Building2 size={16} className="text-muted-foreground" />
                        </div>
                        <span className="font-semibold">{ent.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{ent.code}</TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{ent.contactPerson?.name}</div>
                      <div className="text-[11px] text-muted-foreground">{ent.contactPerson?.phone}</div>
                    </TableCell>
                    <TableCell>{getStatusBadge(ent.status)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {ent.registrationMode === 'self_service' ? '自助注册' : '后台录入'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => setSelectedEnt(ent)}
                          className="h-8 text-[13px]"
                        >
                          详情 & 审核
                        </Button>
                        <Button 
                          variant="ghost"
                          size="sm"
                          onClick={() => openModal(ent)}
                          className="h-8 text-[13px] text-blue-600 hover:text-blue-700"
                        >
                          编辑
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {enterprises.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      暂无企业数据
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Enterprise Detail Modal */}
        <Dialog open={!!selectedEnt} onOpenChange={(open) => !open && setSelectedEnt(null)}>
          <DialogContent className="max-w-2xl p-0 overflow-hidden rounded-3xl border-none shadow-2xl">
            {selectedEnt && (
              <div className="animate-in fade-in duration-300">
                <DialogHeader className="p-8 pb-6 border-b bg-muted/20">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-background rounded-2xl flex items-center justify-center shadow-sm border">
                      <Building2 size={24} className="text-muted-foreground" />
                    </div>
                    <div className="text-left">
                      <DialogTitle className="text-2xl font-bold">{selectedEnt.name}</DialogTitle>
                      <DialogDescription>
                        注册时间: {new Date(selectedEnt.createdAt).toLocaleString()}
                      </DialogDescription>
                    </div>
                  </div>
                </DialogHeader>

                <div className="p-8 space-y-8">
                  <div className="grid grid-cols-2 gap-8 text-sm">
                    <div className="space-y-4">
                      <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">机构信息</h4>
                      <div className="space-y-3">
                        <div className="flex justify-between border-b border-muted pb-2">
                          <span className="text-muted-foreground">统一社会代码</span>
                          <span className="font-mono font-medium">{selectedEnt.code}</span>
                        </div>
                        <div className="flex justify-between border-b border-muted pb-2">
                          <span className="text-muted-foreground">入驻模式</span>
                          <span className="font-medium">{selectedEnt.registrationMode === 'self_service' ? '自助申请' : '手动邀约'}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">当前状态</span>
                          {getStatusBadge(selectedEnt.status)}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">联系人信息</h4>
                      <div className="space-y-3">
                        <div className="flex items-center gap-3 p-2 bg-muted/30 rounded-lg">
                          <User size={16} className="text-muted-foreground" />
                          <span className="font-medium">{selectedEnt.contactPerson?.name}</span>
                        </div>
                        <div className="flex items-center gap-3 p-2 bg-muted/30 rounded-lg">
                          <Phone size={16} className="text-muted-foreground" />
                          <span className="font-medium">{selectedEnt.contactPerson?.phone}</span>
                        </div>
                        {selectedEnt.contactPerson?.email && (
                          <div className="flex items-center gap-3 p-2 bg-muted/30 rounded-lg">
                            <Mail size={16} className="text-muted-foreground" />
                            <span className="font-medium truncate">{selectedEnt.contactPerson?.email}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <DialogFooter className="pt-8 border-t flex flex-row items-center justify-between sm:justify-between w-full">
                    <Button 
                      variant="ghost"
                      onClick={() => deleteEnterprise(selectedEnt._id)}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      删除企业
                    </Button>
                    
                    <div className="flex gap-3">
                      {selectedEnt.status === 'pending_approval' && (
                        <Button 
                           onClick={() => updateStatus(selectedEnt._id, 'active')}
                           disabled={isSubmitting}
                           className="bg-green-600 hover:bg-green-700 text-white"
                        >
                          {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : '审核通过并启用'}
                        </Button>
                      )}
                      {selectedEnt.status === 'active' && (
                        <Button 
                          variant="outline"
                          onClick={() => updateStatus(selectedEnt._id, 'disabled')}
                          disabled={isSubmitting}
                          className="border-orange-200 text-orange-600 hover:bg-orange-50"
                        >
                          禁用账户
                        </Button>
                      )}
                      {selectedEnt.status === 'disabled' && (
                         <Button 
                          onClick={() => updateStatus(selectedEnt._id, 'active')}
                          disabled={isSubmitting}
                        >
                          重新启用
                        </Button>
                      )}
                    </div>
                  </DialogFooter>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Create/Edit Modal */}
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="max-w-lg p-0 overflow-hidden rounded-3xl shadow-2xl">
            <form onSubmit={handleSave}>
              <DialogHeader className="p-8 pb-6 border-b">
                <DialogTitle className="text-2xl font-bold">{editingEnt ? '编辑企业' : '手动添加企业'}</DialogTitle>
                <DialogDescription>
                  请填写企业的基本信息和联系人资料
                </DialogDescription>
              </DialogHeader>

              <div className="p-8 space-y-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="ent-name">企业名称</Label>
                    <Input 
                      id="ent-name"
                      required
                      value={formData.name}
                      onChange={e => setFormData({...formData, name: e.target.value})}
                      placeholder="例如：向总测绘技术有限公司"
                      className="h-10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ent-code">统一社会信用代码</Label>
                    <Input 
                      id="ent-code"
                      required
                      value={formData.code}
                      onChange={e => setFormData({...formData, code: e.target.value})}
                      className="h-10 font-mono"
                      placeholder="18位社会信用代码"
                    />
                  </div>
                </div>

                <div className="pt-4 space-y-4 border-t">
                  <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">品牌定制 (Whitelabel)</h4>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="ent-logo">企业 Logo URL</Label>
                      <Input 
                        id="ent-logo"
                        value={formData.logo}
                        onChange={e => setFormData({...formData, logo: e.target.value})}
                        placeholder="https://example.com/logo.png"
                        className="h-10"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="primary-color">标准色 (Primary)</Label>
                        <div className="flex gap-2">
                          <div className="w-10 h-10 rounded-lg border shrink-0" style={{ backgroundColor: formData.branding.primaryColor }}></div>
                          <Input 
                            id="primary-color"
                            value={formData.branding.primaryColor}
                            onChange={e => setFormData({...formData, branding: {...formData.branding, primaryColor: e.target.value}})}
                            placeholder="#171717"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="accent-color">点缀色 (Accent)</Label>
                        <div className="flex gap-2">
                          <div className="w-10 h-10 rounded-lg border shrink-0" style={{ backgroundColor: formData.branding.accentColor }}></div>
                          <Input 
                            id="accent-color"
                            value={formData.branding.accentColor}
                            onChange={e => setFormData({...formData, branding: {...formData.branding, accentColor: e.target.value}})}
                            placeholder="#0070f3"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-4 space-y-4 border-t">
                  <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">联系人资料</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="contact-name">姓名</Label>
                      <Input 
                        id="contact-name"
                        required
                        value={formData.contactPerson.name}
                        onChange={e => setFormData({...formData, contactPerson: {...formData.contactPerson, name: e.target.value}})}
                        placeholder="负责人姓名"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="contact-phone">电话</Label>
                      <Input 
                        id="contact-phone"
                        required
                        value={formData.contactPerson.phone}
                        onChange={e => setFormData({...formData, contactPerson: {...formData.contactPerson, phone: e.target.value}})}
                        placeholder="联系电话"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contact-email">电子邮箱 (可选)</Label>
                    <Input 
                      id="contact-email"
                      type="email"
                      value={formData.contactPerson.email}
                      onChange={e => setFormData({...formData, contactPerson: {...formData.contactPerson, email: e.target.value}})}
                      placeholder="email@example.com"
                    />
                  </div>
                </div>
              </div>

              <DialogFooter className="p-8 pt-4 bg-muted/30">
                <Button 
                  type="button"
                  variant="outline"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 rounded-xl h-11"
                >
                  取消
                </Button>
                <Button 
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 rounded-xl h-11 shadow-lg shadow-primary/10"
                >
                  {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : '确认保存'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
