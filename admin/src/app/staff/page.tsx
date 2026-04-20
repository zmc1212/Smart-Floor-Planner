'use client';

import React, { useState, useEffect } from 'react';
import Navbar from "@/components/Navbar";
import { Loader2, User as UserIcon, Plus, X, Shield, Pencil, Trash2, Smartphone, ArrowLeft, Mail } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import Link from 'next/link';

export default function StaffPage() {
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    displayName: '',
    phone: '',
    role: 'designer',
    enterpriseId: ''
  });

  const fetchCurrentUser = async () => {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      if (data.success) setCurrentUser(data.data);
    } catch (err) {
      console.error('Auth error:', err);
    }
  };

  const fetchStaff = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/staff');
      const data = await res.json();
      if (data.success) {
        setStaff(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch staff:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCurrentUser();
    fetchStaff();
  }, []);

  const resetForm = () => {
    setFormData({ username: '', password: '', displayName: '', phone: '', role: 'designer', enterpriseId: '' });
    setIsEditMode(false);
    setEditingId(null);
  };

  const handleOpenCreateModal = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const handleEditClick = (member: any) => {
    setFormData({
      username: member.username,
      password: '', // Password field blank for editing unless changing
      displayName: member.displayName || '',
      phone: member.phone || '',
      role: member.role,
      enterpriseId: member.enterpriseId || ''
    });
    setEditingId(member._id);
    setIsEditMode(true);
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除该员工账号吗？此操作不可撤销。')) return;
    
    try {
      const res = await fetch(`/api/staff/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        fetchStaff();
      } else {
        alert(data.error);
      }
    } catch (err: any) {
      alert('删除失败: ' + err.message);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    const url = isEditMode ? `/api/staff/${editingId}` : '/api/staff';
    const method = isEditMode ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      if (data.success) {
        setIsModalOpen(false);
        resetForm();
        fetchStaff();
      } else {
        alert(data.error);
      }
    } catch (err: any) {
      alert((isEditMode ? '保存失败: ' : '创建失败: ') + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getRoleLabel = (role: string) => {
    const labels: any = {
      enterprise_admin: '公司负责人',
      designer: '设计师',
      salesperson: '销售顾问',
      super_admin: '超级管理员'
    };
    return labels[role] || role;
  };

  const renderStaffForm = () => (
    <form onSubmit={handleSubmit}>
      <DialogHeader className="p-8 pb-6 border-b bg-muted/20">
        <DialogTitle className="text-2xl font-bold">{isEditMode ? '编辑员工信息' : '录入新员工'}</DialogTitle>
        <DialogDescription>
           配置员工的登录账号与协作权限
        </DialogDescription>
      </DialogHeader>

      <div className="p-8 space-y-5 max-h-[60vh] overflow-y-auto">
        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">登录账号</Label>
          <Input 
            required
            disabled={isEditMode}
            className="h-12 rounded-2xl bg-muted/30 border-none focus-visible:ring-primary font-medium"
            placeholder="例如: designer_zhang"
            value={formData.username}
            onChange={(e) => setFormData({...formData, username: e.target.value})}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{isEditMode ? '重置密码 (留空则不修改)' : '登录密码'}</Label>
          <Input 
            required={!isEditMode}
            type="password"
            className="h-12 rounded-2xl bg-muted/30 border-none focus-visible:ring-primary"
            placeholder="不少于6位"
            value={formData.password}
            onChange={(e) => setFormData({...formData, password: e.target.value})}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">姓名/昵称</Label>
          <Input 
            required
            className="h-12 rounded-2xl bg-muted/30 border-none focus-visible:ring-primary"
            placeholder="显示名称"
            value={formData.displayName}
            onChange={(e) => setFormData({...formData, displayName: e.target.value})}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">联系电话</Label>
          <Input 
            className="h-12 rounded-2xl bg-muted/30 border-none focus-visible:ring-primary"
            placeholder="11位手机号"
            value={formData.phone}
            onChange={(e) => setFormData({...formData, phone: e.target.value})}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">岗位角色</Label>
          <Select 
            value={formData.role} 
            onValueChange={(val) => val && setFormData({...formData, role: val})}
          >
            <SelectTrigger className="h-12 rounded-2xl bg-muted/30 border-none focus-visible:ring-primary">
              <SelectValue placeholder="选择角色">
                {getRoleLabel(formData.role)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="designer">设计师</SelectItem>
              <SelectItem value="salesperson">销售顾问</SelectItem>
              {currentUser?.role === 'super_admin' && <SelectItem value="enterprise_admin">公司负责人</SelectItem>}
            </SelectContent>
          </Select>
        </div>
      </div>

      <DialogFooter className="p-8 pt-4 bg-muted/30 border-t">
        <Button 
          type="button" 
          variant="ghost" 
          className="h-12 rounded-2xl px-6 bg-background hover:bg-muted" 
          onClick={() => setIsModalOpen(false)}
        >
          取消
        </Button>
        <Button 
          type="submit" 
          disabled={isSubmitting} 
          className="h-12 rounded-2xl px-10 font-bold shadow-lg shadow-primary/10"
        >
          {isSubmitting ? '同步中...' : (isEditMode ? '保存修改' : '确认创建')}
        </Button>
      </DialogFooter>
    </form>
  );

  return (
    <div className="min-h-screen bg-white text-[#171717] font-sans">
      <Navbar />
      <main className="max-w-7xl mx-auto px-6 py-12">
        <Link
          href="/"
          className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors mb-8 w-fit"
        >
          <ArrowLeft size={16} />
          <span className="text-sm font-medium">返回首页</span>
        </Link>

        <div className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-1">
            <h2 className="text-[32px] font-bold tracking-tight">
              员工与账号管理
            </h2>
            <p className="text-muted-foreground text-sm flex items-center gap-2">
               管理您的企业直属员工，分配系统访问权限
            </p>
          </div>
          
          <div className="flex items-center gap-4">
            {!loading && (
              <Badge variant="secondary" className="bg-muted text-muted-foreground border-none font-bold px-4 py-1.5 h-auto rounded-full">
                {staff.length} 个成员账户
              </Badge>
            )}
            {(currentUser?.role === 'super_admin' || currentUser?.role === 'enterprise_admin' || currentUser?.role === 'admin') && (
              <Dialog open={isModalOpen && !isEditMode} onOpenChange={(open) => !open && setIsModalOpen(false)}>
                <DialogTrigger asChild>
                  <Button onClick={handleOpenCreateModal} className="h-11 rounded-full px-6 font-bold shadow-lg shadow-primary/20">
                    <Plus size={18} className="mr-2" /> 新增员工
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md p-0 overflow-hidden rounded-[32px] shadow-2xl border-none">
                  {renderStaffForm()}
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 text-muted-foreground">
            <Loader2 className="animate-spin mb-4" size={48} />
            <p className="text-sm font-medium">同步团队数据中...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {staff.map((member: any) => (
              <div key={member._id} className="group relative bg-white p-8 rounded-[32px] border border-muted hover:border-primary/50 hover:shadow-2xl hover:shadow-primary/5 transition-all duration-300">
                <div className="flex items-start justify-between mb-8">
                  <div className="w-14 h-14 bg-muted rounded-[20px] flex items-center justify-center text-xl font-bold text-muted-foreground group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-500 shadow-inner">
                    {member.displayName?.[0] || member.username[0].toUpperCase()}
                  </div>
                  <Badge className={cn(
                    "px-3 py-1 font-bold text-[10px] uppercase tracking-wider border-none",
                    member.role === 'enterprise_admin' ? 'bg-purple-100 text-purple-700' : 
                    member.role === 'designer' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                  )}>
                    {getRoleLabel(member.role)}
                  </Badge>
                </div>

                <div className="space-y-1 mb-8">
                  <h3 className="text-[20px] font-bold text-foreground leading-none">{member.displayName || member.username}</h3>
                  <p className="text-sm text-muted-foreground font-medium">@{member.username}</p>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-6 border-t border-muted/50">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-50">联系电话</p>
                    <div className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                       <Smartphone size={14} className="text-muted-foreground" />
                       <span>{member.phone || '未填写'}</span>
                    </div>
                  </div>
                  <div className="space-y-1 text-right">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-50">微信状态</p>
                    <div className="flex items-center justify-end gap-2 text-[13px] font-medium">
                       <Shield size={14} className={member.openid ? "text-green-500" : "text-muted-foreground/30"} />
                       <span className={cn(member.openid ? "text-green-600" : "text-muted-foreground")}>{member.openid ? '已关联' : '未绑定'}</span>
                    </div>
                  </div>
                </div>

                <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-all flex gap-1">
                   {(currentUser?.role === 'super_admin' || currentUser?.role === 'enterprise_admin' || (currentUser?.role === 'admin' && member.role !== 'super_admin')) && (
                     <>
                       <Dialog open={isModalOpen && isEditMode && editingId === member._id} onOpenChange={(open) => !open && setIsModalOpen(false)}>
                         <DialogTrigger asChild>
                           <Button 
                             size="icon" 
                             variant="secondary"
                             onClick={() => handleEditClick(member)}
                             className="h-10 w-10 bg-white shadow-xl rounded-full text-muted-foreground hover:text-foreground hover:scale-110 transition-all border border-muted"
                           >
                             <Pencil size={14}/>
                           </Button>
                         </DialogTrigger>
                         <DialogContent className="max-w-md p-0 overflow-hidden rounded-[32px] shadow-2xl border-none">
                           {renderStaffForm()}
                         </DialogContent>
                       </Dialog>
                       <Button 
                         size="icon"
                         variant="secondary"
                         onClick={() => handleDelete(member._id)}
                         className="h-10 w-10 bg-white shadow-xl rounded-full text-muted-foreground hover:text-destructive hover:scale-110 transition-all border border-muted"
                       >
                        <Trash2 size={14}/>
                       </Button>
                     </>
                   )}
                </div>
              </div>
            ))}
            {staff.length === 0 && (
              <div className="col-span-full py-32 text-center text-muted-foreground bg-muted/20 rounded-[40px] border-4 border-dashed border-muted/50">
                <div className="bg-muted w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                   <UserIcon size={32} className="opacity-20" />
                </div>
                <h3 className="text-xl font-bold text-foreground mb-1">您的团队目前空空如也</h3>
                <p>点击右上角按钮，邀请您的第一位成员加入系统</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
