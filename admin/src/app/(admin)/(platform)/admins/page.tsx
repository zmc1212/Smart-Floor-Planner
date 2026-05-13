'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Shield, Search, Plus, RefreshCw, Edit2, Trash2, Check, X,
  KeyRound, Ban, CheckCircle, Lock, UserCog
} from 'lucide-react';
import Link from 'next/link';
import { Tabs } from "@/components/ui/tabs";
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
import { cn } from "@/lib/utils";

interface AdminUser {
  _id: string;
  username: string;
  displayName: string;
  role: 'super_admin' | 'admin' | 'viewer' | 'enterprise_admin' | 'salesperson' | 'designer' | 'measurer';
  enterpriseId?: string;
  menuPermissions: string[];
  effectivePermissions: string[];
  phone?: string;
  status: 'active' | 'disabled';
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: '超级管理员',
  admin: '平台管理员',
  viewer: '只读审计员',
  enterprise_admin: '企业负责人',
  salesperson: '渠道地推',
  designer: '设计师',
  measurer: '测量员',
};

const getRoleBadge = (role: string) => {
  switch (role) {
    case 'super_admin':
      return <Badge variant="secondary" className="bg-purple-100 text-purple-700 border-none">超级管理员</Badge>;
    case 'admin':
      return <Badge variant="secondary" className="bg-blue-100 text-blue-800 border-none">平台管理员</Badge>;
    case 'viewer':
      return <Badge variant="outline" className="text-gray-500 border-gray-200">审计员</Badge>;
    case 'enterprise_admin':
      return <Badge variant="secondary" className="bg-amber-100 text-amber-700 border-none">企业负责人</Badge>;
    case 'salesperson':
      return <Badge variant="secondary" className="bg-green-100 text-green-700 border-none">渠道地推</Badge>;
    case 'designer':
      return <Badge variant="secondary" className="bg-pink-100 text-pink-700 border-none">设计师</Badge>;
    case 'measurer':
      return <Badge variant="secondary" className="bg-indigo-100 text-indigo-700 border-none">测量员</Badge>;
    default:
      return <Badge variant="outline">{role}</Badge>;
  }
};


export default function AdminsPage() {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('all');

  // Add form
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newRole, setNewRole] = useState<string>('admin');
  const [newEnterpriseId, setNewEnterpriseId] = useState<string>('');
  const [enterprises, setEnterprises] = useState<any[]>([]);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editRole, setEditRole] = useState('admin');
  const [editEnterpriseId, setEditEnterpriseId] = useState('');
  const [updating, setUpdating] = useState(false);

  // Password reset
  const [resetPwdId, setResetPwdId] = useState<string | null>(null);
  const [resetPwdValue, setResetPwdValue] = useState('');

  const filteredAdmins = useMemo(() => {
    let result = admins;
    
    // Filter by Tab
    if (activeTab === 'platform') {
      result = result.filter(a => ['super_admin', 'admin', 'viewer'].includes(a.role));
    } else if (activeTab === 'enterprise') {
      result = result.filter(a => ['enterprise_admin', 'designer', 'measurer'].includes(a.role));
    } else if (activeTab === 'salesperson') {
      result = result.filter(a => a.role === 'salesperson');
    }

    if (!searchTerm.trim()) return result;
    
    const lower = searchTerm.toLowerCase();
    return result.filter(
      (a) =>
        a.username.toLowerCase().includes(lower) ||
        a.displayName.toLowerCase().includes(lower) ||
        (a.phone && a.phone.includes(lower))
    );
  }, [admins, searchTerm, activeTab]);

  const fetchAdmins = async () => {
    setLoading(true);
    try {
      const [adminRes, entRes] = await Promise.all([
        fetch('/api/admin-users'),
        fetch('/api/admin/enterprises')
      ]);
      const adminData = await adminRes.json();
      const entData = await entRes.json();
      
      if (adminData.success) setAdmins(adminData.data);
      if (entData.success) setEnterprises(entData.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdmins();
  }, []);

  // ... filtering ...

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword.trim()) return;

    // Validate phone
    const trimmedPhone = newPhone.trim();
    if (!trimmedPhone) {
      alert('请输入联系电话');
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(trimmedPhone)) {
      alert('手机号格式不正确，请输入11位有效手机号');
      return;
    }
    
    if (newRole === 'enterprise_admin' && !newEnterpriseId) {
      alert('请选择所属企业');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/admin-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword,
          displayName: newDisplayName.trim(),
          phone: newPhone.trim(),
          role: newRole,
          enterpriseId: newRole === 'enterprise_admin' ? newEnterpriseId : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setNewUsername('');
        setNewPassword('');
        setNewDisplayName('');
        setNewPhone('');
        setNewRole('admin');
        setNewEnterpriseId('');
        setIsDialogOpen(false);
        fetchAdmins();
      } else {
        alert(data.error || '添加失败');
      }
    } catch (err) {
      console.error(err);
      alert('请求失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string, username: string) => {
    if (!confirm(`确定删除管理员 "${username}" 吗？此操作不可恢复。`)) return;
    try {
      const res = await fetch(`/api/admin-users/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setAdmins(admins.filter((a) => a._id !== id));
      } else {
        alert(data.error || '删除失败');
      }
    } catch (err) {
      console.error(err);
      alert('删除失败');
    }
  };

  const startEdit = (admin: any) => {
    setEditingId(admin._id);
    setEditDisplayName(admin.displayName);
    setEditPhone(admin.phone || '');
    setEditRole(admin.role);
    setEditEnterpriseId(admin.enterpriseId || '');
  };

  const handleUpdate = async () => {
    if (!editingId) return;

    // Validate phone
    const trimmedPhone = editPhone.trim();
    if (!trimmedPhone) {
      alert('请输入联系电话');
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(trimmedPhone)) {
      alert('手机号格式不正确，请输入11位有效手机号');
      return;
    }

    setUpdating(true);
    try {
      const res = await fetch(`/api/admin-users/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: editDisplayName.trim(),
          phone: editPhone.trim(),
          role: editRole,
          enterpriseId: editRole === 'enterprise_admin' ? editEnterpriseId : null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setAdmins(admins.map((a) => (a._id === editingId ? { ...a, ...data.data } : a)));
        setEditingId(null);
        fetchAdmins(); // Refresh to get effectivePermissions
      } else {
        alert(data.error || '更新失败');
      }
    } catch (err) {
      console.error(err);
      alert('网络错误');
    } finally {
      setUpdating(false);
    }
  };

  const handleToggleStatus = async (admin: AdminUser) => {
    const newStatus = admin.status === 'active' ? 'disabled' : 'active';
    const action = newStatus === 'disabled' ? '禁用' : '启用';
    if (!confirm(`确定${action}管理员 "${admin.username}" 吗？`)) return;

    try {
      const res = await fetch(`/api/admin-users/${admin._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (data.success) {
        setAdmins(admins.map((a) => (a._id === admin._id ? { ...a, status: newStatus } : a)));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleResetPassword = async (id: string) => {
    if (!resetPwdValue || resetPwdValue.length < 6) {
      alert('密码长度不能少于6位');
      return;
    }
    try {
      const res = await fetch(`/api/admin-users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: resetPwdValue }),
      });
      const data = await res.json();
      if (data.success) {
        alert('密码已重置');
        setResetPwdId(null);
        setResetPwdValue('');
      } else {
        alert(data.error || '重置失败');
      }
    } catch (err) {
      console.error(err);
      alert('网络错误');
    }
  };


  // --- Render ---

  return (
    <div className="min-h-screen bg-white">
      <div className="p-6 max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
          <div>
            <h1 className="text-[32px] font-bold tracking-tight mb-2">系统权限中心</h1>
            <p className="text-muted-foreground text-sm flex items-center gap-2">
              <Shield size={14} className="text-primary" /> 管理平台运维账号与各模块菜单权限
            </p>
          </div>
          
        {/* Tabs and Action Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <Tabs 
            activeTab={activeTab}
            onChange={setActiveTab}
            tabs={[
              { id: 'all', label: '全部人员' },
              { id: 'platform', label: '平台管理' },
              { id: 'enterprise', label: '企业账号' },
              { id: 'salesperson', label: '渠道地推' },
            ]}
          />

          <div className="flex gap-3">
            <Button 
               variant="outline" 
               size="icon" 
               onClick={fetchAdmins}
               className="rounded-full h-10 w-10 shrink-0"
            >
              <RefreshCw size={18} className={cn(loading && "animate-spin text-muted-foreground")} />
            </Button>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button className="rounded-full px-6 flex items-center gap-2 shadow-lg shadow-primary/10">
                  <Plus size={18} /> 新增管理员
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md p-0 overflow-hidden rounded-3xl shadow-2xl">
                 <form onSubmit={handleAdd}>
                   <DialogHeader className="p-8 pb-6 border-b bg-muted/20">
                     <DialogTitle className="text-2xl font-bold">新增管理员账号</DialogTitle>
                     <DialogDescription>为团队成员创建一个新的后台访问账号</DialogDescription>
                   </DialogHeader>

                   <div className="p-8 space-y-4">
                     <div className="space-y-2">
                       <Label htmlFor="new-user">登录账号 (用户名)</Label>
                       <Input 
                        id="new-user"
                        required 
                        value={newUsername} 
                        onChange={e => setNewUsername(e.target.value)}
                        placeholder="例如: admin_zhang"
                       />
                     </div>
                     <div className="space-y-2">
                       <Label htmlFor="new-pwd">初始密码 (至少6位)</Label>
                       <Input 
                        id="new-pwd"
                        type="password"
                        required 
                        minLength={6}
                        value={newPassword} 
                        onChange={e => setNewPassword(e.target.value)}
                        placeholder="••••••"
                       />
                     </div>
                     <div className="space-y-2">
                       <Label htmlFor="new-name">显示名称</Label>
                       <Input 
                        id="new-name"
                        value={newDisplayName} 
                        onChange={e => setNewDisplayName(e.target.value)}
                        placeholder="例如: 张三"
                       />
                     </div>
                      <div className="space-y-2">
                        <Label htmlFor="new-phone">联系电话 <span className="text-red-500">*</span></Label>
                        <Input 
                         id="new-phone"
                         required
                         value={newPhone} 
                         onChange={e => setNewPhone(e.target.value)}
                         placeholder="例如: 13800138000"
                         pattern="^1[3-9]\d{9}$"
                         maxLength={11}
                         title="请输入11位有效手机号"
                        />
                      </div>
                     <div className="space-y-2">
                       <Label>分配角色</Label>
                        <Select value={newRole} onValueChange={(val) => {
                          val && setNewRole(val);
                          if (val === 'salesperson') setNewEnterpriseId('');
                        }}>
                        <SelectTrigger className="w-full h-10 rounded-xl bg-muted/50 border-none shadow-none">
                          <SelectValue>
                            {ROLE_LABELS[newRole]}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="super_admin">超级管理员</SelectItem>
                          <SelectItem value="admin">平台管理员</SelectItem>
                          <SelectItem value="viewer">只读审计员</SelectItem>
                          <SelectItem value="enterprise_admin">企业负责人</SelectItem>
                          <SelectItem value="salesperson">渠道地推</SelectItem>
                          <SelectItem value="designer">设计师</SelectItem>
                          <SelectItem value="measurer">测量员</SelectItem>
                        </SelectContent>
                      </Select>
                     </div>

                     {['enterprise_admin', 'designer', 'measurer'].includes(newRole) && (
                       <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-300">
                         <Label>关联企业</Label>
                         <Select value={newEnterpriseId} onValueChange={setNewEnterpriseId}>
                           <SelectTrigger className="w-full h-10 rounded-xl bg-amber-50 border-amber-100 shadow-none">
                             <SelectValue placeholder="选择所属装修公司" />
                           </SelectTrigger>
                           <SelectContent>
                             {enterprises.map(ent => (
                               <SelectItem key={ent._id} value={ent._id}>{ent.name}</SelectItem>
                             ))}
                           </SelectContent>
                         </Select>
                       </div>
                     )}

                     {newRole === 'salesperson' && (
                        <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 flex items-start gap-2 animate-in fade-in duration-300">
                          <div className="w-4 h-4 rounded-full bg-blue-500 text-white flex items-center justify-center text-[10px] mt-0.5 shrink-0">!</div>
                          <p className="text-[11px] text-blue-700 leading-normal">
                            渠道地推人员属于平台级账号，无需绑定具体企业。系统将自动为其应用全平台报备权限。
                          </p>
                        </div>
                     )}
                   </div>

                   <DialogFooter className="p-8 pt-4 bg-muted/30">
                     <Button type="button" variant="ghost" onClick={() => setIsDialogOpen(false)} className="bg-background">取消</Button>
                     <Button type="submit" disabled={isSubmitting} className="shadow-lg shadow-primary/10">确认创建</Button>
                   </DialogFooter>
                 </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>
        </div>

        {/* Search Bar */}
        <div className="flex items-center gap-4 mb-8 bg-muted/30 p-2 rounded-2xl border border-muted">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <Input 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜索用户名或显示名称..."
              className="pl-10 h-11 bg-background border-none shadow-none rounded-xl"
            />
          </div>
          <div className="text-xs text-muted-foreground px-4 font-medium shrink-0">
             共 {filteredAdmins.length} 位管理人员
          </div>
        </div>


        <Dialog open={!!resetPwdId} onOpenChange={(open) => !open && setResetPwdId(null)}>
          <DialogContent className="max-w-md rounded-3xl p-0 overflow-hidden shadow-2xl border-none">
            <DialogHeader className="p-8 pb-4 bg-muted/20">
              <div className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center mb-4 border border-amber-200 shadow-sm">
                <KeyRound size={20} className="text-amber-600" />
              </div>
              <DialogTitle className="text-xl font-bold">重置管理员密码</DialogTitle>
              <DialogDescription>
                正在为用户 <span className="font-bold text-foreground">@{admins.find(a => a._id === resetPwdId)?.username}</span> 修改密码
              </DialogDescription>
            </DialogHeader>
            <div className="p-8 space-y-4">
               <div className="space-y-2">
                 <Label>输入新密码 (至少6位)</Label>
                 <Input 
                   type="password"
                   value={resetPwdValue}
                   onChange={e => setResetPwdValue(e.target.value)}
                   placeholder="•••••"
                   className="h-11 rounded-xl"
                   autoFocus
                 />
               </div>
            </div>
            <DialogFooter className="p-8 pt-0">
               <Button variant="ghost" className="flex-1" onClick={() => setResetPwdId(null)}>取消</Button>
               <Button className="flex-1 bg-amber-600 hover:bg-amber-700 text-white" onClick={() => resetPwdId && handleResetPassword(resetPwdId)}>确认重置</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Admin List Table */}
        <div className="border rounded-2xl overflow-hidden shadow-sm">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>登录账号</TableHead>
                <TableHead>显示名称</TableHead>
                <TableHead>联系电话</TableHead>
                <TableHead>系统角色</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAdmins.map((admin) => (
                <React.Fragment key={admin._id}>
                  <TableRow className={cn(admin.status === 'disabled' && "opacity-50", "transition-colors")}>
                    <TableCell className="font-mono font-semibold py-4">
                      <div className="flex items-center gap-2">
                        <UserCog size={14} className="text-muted-foreground" />
                        {admin.username}
                      </div>
                    </TableCell>
                    <TableCell>
                      {editingId === admin._id ? (
                        <Input 
                          value={editDisplayName}
                          onChange={(e) => setEditDisplayName(e.target.value)}
                          className="h-8 max-w-[150px] rounded-lg border-primary"
                          autoFocus
                        />
                      ) : (
                        admin.displayName || '-'
                      )}
                    </TableCell>
                    <TableCell>
                      {editingId === admin._id ? (
                        <Input 
                          value={editPhone}
                          onChange={(e) => setEditPhone(e.target.value)}
                          className="h-8 max-w-[150px] rounded-lg border-primary"
                          pattern="^1[3-9]\d{9}$"
                          maxLength={11}
                        />
                      ) : (
                        admin.phone || '-'
                      )}
                    </TableCell>
                    <TableCell>
                      {editingId === admin._id ? (
                        <div className="space-y-2">
                          <Select value={editRole} onValueChange={(val) => {
                            if (val) {
                              setEditRole(val);
                              if (val === 'salesperson') setEditEnterpriseId('');
                            }
                          }}>
                            <SelectTrigger className="h-8 py-0 rounded-lg border-primary text-xs">
                              <SelectValue>
                                {ROLE_LABELS[editRole]}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="super_admin">超级管理员</SelectItem>
                              <SelectItem value="admin">平台管理员</SelectItem>
                              <SelectItem value="viewer">只读审计员</SelectItem>
                              <SelectItem value="enterprise_admin">企业负责人</SelectItem>
                              <SelectItem value="salesperson">渠道地推</SelectItem>
                              <SelectItem value="designer">设计师</SelectItem>
                              <SelectItem value="measurer">测量员</SelectItem>
                            </SelectContent>
                          </Select>
                          
                          {['enterprise_admin', 'designer', 'measurer'].includes(editRole) && (
                            <Select value={editEnterpriseId} onValueChange={setEditEnterpriseId}>
                              <SelectTrigger className="h-8 py-0 rounded-lg border-amber-200 bg-amber-50 text-xs">
                                <SelectValue placeholder="选择企业" />
                              </SelectTrigger>
                              <SelectContent>
                                {enterprises.map(ent => (
                                  <SelectItem key={ent._id} value={ent._id}>{ent.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}

                          {editRole === 'salesperson' && (
                            <div className="text-[10px] text-blue-600 bg-blue-50 p-1 rounded border border-blue-100">
                              地推人员统一由平台管理
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div>{getRoleBadge(admin.role)}</div>
                          {admin.role === 'salesperson' && admin.enterpriseId && (
                            <div className="text-[9px] text-red-500 bg-red-50 px-1 py-0.5 rounded border border-red-100 w-fit">
                              历史数据: 绑定了企业
                            </div>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {admin.status === 'active' ? (
                        <Badge variant="secondary" className="bg-green-100 text-green-700 hover:bg-green-100/80 border-none px-2 h-5 text-[10px]">正常</Badge>
                      ) : (
                        <Badge variant="destructive" className="bg-red-50 text-red-600 hover:bg-red-50 border-none px-2 h-5 text-[10px]">已禁用</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {editingId === admin._id ? (
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" onClick={handleUpdate} className="text-green-600"><Check size={16} /></Button>
                          <Button size="icon" variant="ghost" onClick={() => setEditingId(null)}><X size={16} /></Button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" onClick={() => startEdit(admin)}><Edit2 size={14} className="text-gray-500" /></Button>
                          <Button size="icon" variant="ghost" onClick={() => setResetPwdId(admin._id)}><KeyRound size={14} className="text-amber-500" /></Button>
                          <Button 
                            size="icon" 
                            variant="ghost" 
                            onClick={() => handleToggleStatus(admin)}
                          >
                            {admin.status === 'active' ? <Ban size={14} className="text-orange-500" /> : <CheckCircle size={14} className="text-green-500" />}
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => handleDelete(admin._id, admin.username)}><Trash2 size={14} className="text-red-500" /></Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>

                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
