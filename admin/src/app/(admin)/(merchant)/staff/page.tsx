'use client';

import React, { useEffect, useState } from 'react';
import { Loader2, Pencil, Plus, Shield, Smartphone, Trash2, User as UserIcon } from 'lucide-react';
import { DepartmentTree } from '@/components/DepartmentTree';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const DEFAULT_FORM = {
  username: '',
  password: '',
  displayName: '',
  phone: '',
  role: 'designer',
  enterpriseId: '',
  departmentId: '',
  promoterIds: [] as string[],
  wecomUserId: '',
};

export default function StaffPage() {
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { user: currentUser } = useCurrentUser();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [departments, setDepartments] = useState<any[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
  const [isDeptModalOpen, setIsDeptModalOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<any>(null);
  const [deptFormData, setDeptFormData] = useState({ name: '', parentId: '' as string | null });
  const [formData, setFormData] = useState(DEFAULT_FORM);

  const fetchDepartments = async () => {
    try {
      const res = await fetch('/api/departments');
      const data = await res.json();
      if (data.success) {
        setDepartments(data.data || []);
      }
    } catch (error) {
      console.error('Failed to fetch departments:', error);
    }
  };

  const fetchStaff = async (deptId: string | null = selectedDeptId) => {
    setLoading(true);
    try {
      let url = '/api/staff';
      if (deptId) {
        url += `?departmentId=${deptId}`;
      }

      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        setStaff(data.data || []);
      }
    } catch (error) {
      console.error('Failed to fetch staff:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    Promise.all([fetchDepartments(), fetchStaff(selectedDeptId)]);
  }, []);

  useEffect(() => {
    fetchStaff(selectedDeptId);
  }, [selectedDeptId]);

  const resetForm = () => {
    setFormData({
      ...DEFAULT_FORM,
      departmentId: selectedDeptId || '',
    });
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
      password: '',
      displayName: member.displayName || '',
      phone: member.phone || '',
      role: member.role,
      enterpriseId: member.enterpriseId || '',
      departmentId:
        typeof member.departmentId === 'object' && member.departmentId
          ? member.departmentId._id
          : (member.departmentId || ''),
      promoterIds: member.promoterIds || [],
      wecomUserId: member.wecomUserId || '',
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
      if (!data.success) {
        alert(data.error || '删除失败');
        return;
      }
      await fetchStaff();
    } catch (error: any) {
      alert(`删除失败: ${error.message}`);
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
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.error || '保存失败');
        return;
      }
      setIsModalOpen(false);
      resetForm();
      await fetchStaff();
    } catch (error: any) {
      alert(`保存失败: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeptSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = editingDept ? `/api/departments/${editingDept._id}` : '/api/departments';
    const method = editingDept ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deptFormData),
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.error || '操作失败');
        return;
      }
      setIsDeptModalOpen(false);
      await fetchDepartments();
    } catch (error: any) {
      alert(`操作失败: ${error.message}`);
    }
  };

  const handleDeleteDept = async (id: string) => {
    if (!confirm('确定要删除该部门吗？')) return;
    try {
      const res = await fetch(`/api/departments/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) {
        alert(data.error || '删除失败');
        return;
      }
      await fetchDepartments();
      if (selectedDeptId === id) {
        setSelectedDeptId(null);
      }
    } catch (error: any) {
      alert(`删除失败: ${error.message}`);
    }
  };

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = {
      enterprise_admin: '企业负责人',
      designer: '设计师',
      measurer: '测量员',
      salesperson: '地推员',
    };
    return labels[role] || role;
  };

  const renderDeptForm = () => (
    <form onSubmit={handleDeptSubmit}>
      <DialogHeader className="border-b bg-muted/20 p-8 pb-6">
        <DialogTitle className="text-2xl font-bold">{editingDept ? '编辑部门' : '新增部门'}</DialogTitle>
        <DialogDescription>调整组织结构后，员工可继续按部门筛选查看。</DialogDescription>
      </DialogHeader>
      <div className="space-y-6 p-8">
        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">部门名称</Label>
          <Input
            required
            className="h-12 rounded-2xl border-none bg-muted/30"
            value={deptFormData.name}
            onChange={(e) => setDeptFormData({ ...deptFormData, name: e.target.value })}
            placeholder="例如：华中测量组"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">上级部门</Label>
          <Select
            value={deptFormData.parentId || 'root'}
            onValueChange={(value) => setDeptFormData({ ...deptFormData, parentId: value === 'root' ? null : value })}
          >
            <SelectTrigger className="h-12 rounded-2xl border-none bg-muted/30">
              <SelectValue placeholder="顶级部门" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="root">顶级部门</SelectItem>
              {departments
                .filter((dept) => dept._id !== editingDept?._id)
                .map((dept) => (
                  <SelectItem key={dept._id} value={dept._id}>
                    {dept.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter className="border-t bg-muted/30 p-8 pt-4">
        <Button type="button" variant="ghost" onClick={() => setIsDeptModalOpen(false)}>
          取消
        </Button>
        <Button type="submit">确认保存</Button>
      </DialogFooter>
    </form>
  );

  const renderStaffForm = () => (
    <form onSubmit={handleSubmit}>
      <DialogHeader className="border-b bg-muted/20 p-8 pb-6">
        <DialogTitle className="text-2xl font-bold">{isEditMode ? '编辑员工信息' : '录入新员工'}</DialogTitle>
        <DialogDescription>配置员工登录账号、角色与企业微信提醒接收信息。</DialogDescription>
      </DialogHeader>

      <div className="max-h-[60vh] space-y-5 overflow-y-auto p-8">
        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">登录账号</Label>
          <Input
            required
            className="h-12 rounded-2xl border-none bg-muted/30"
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
            placeholder="例如：designer_zhang"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            {isEditMode ? '重置密码（留空则不修改）' : '登录密码'}
          </Label>
          <Input
            required={!isEditMode}
            type="password"
            className="h-12 rounded-2xl border-none bg-muted/30"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            placeholder="不少于 6 位"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">姓名/昵称</Label>
          <Input
            required
            className="h-12 rounded-2xl border-none bg-muted/30"
            value={formData.displayName}
            onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
            placeholder="显示名称"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">联系电话</Label>
          <Input
            className="h-12 rounded-2xl border-none bg-muted/30"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            placeholder="11 位手机号"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">企业微信提醒接收 ID</Label>
          <Input
            className="h-12 rounded-2xl border-none bg-muted/30 font-mono"
            value={formData.wecomUserId}
            onChange={(e) => setFormData({ ...formData, wecomUserId: e.target.value })}
            placeholder="WeCom UserID"
          />
          <p className="text-xs text-muted-foreground">用于接收企业微信催办消息，不填写时系统只保留站内待办。</p>
        </div>
        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">所属部门</Label>
          <Select
            value={formData.departmentId || 'none'}
            onValueChange={(value) => setFormData({ ...formData, departmentId: value === 'none' ? '' : value })}
          >
            <SelectTrigger className="h-12 rounded-2xl border-none bg-muted/30">
              <SelectValue placeholder="不指定部门" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">不指定部门</SelectItem>
              {departments.map((dept) => (
                <SelectItem key={dept._id} value={dept._id}>
                  {dept.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">岗位角色</Label>
          <Select value={formData.role} onValueChange={(value) => setFormData({ ...formData, role: value })}>
            <SelectTrigger className="h-12 rounded-2xl border-none bg-muted/30">
              <SelectValue placeholder="选择角色" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="designer">设计师</SelectItem>
              <SelectItem value="measurer">测量员</SelectItem>
              <SelectItem value="salesperson">地推员</SelectItem>
              {currentUser?.role === 'super_admin' && <SelectItem value="enterprise_admin">企业负责人</SelectItem>}
            </SelectContent>
          </Select>
        </div>

        {formData.role === 'designer' && (
          <div className="space-y-3 pt-2">
            <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">关联地推员</Label>
            <div className="grid max-h-[160px] grid-cols-2 gap-2 overflow-y-auto rounded-2xl bg-muted/20 p-2">
              {staff.filter((item) => item.role === 'salesperson').map((promoter) => (
                <div
                  key={promoter._id}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-xl border-2 p-3 transition-all',
                    formData.promoterIds.includes(promoter._id)
                      ? 'border-primary bg-primary/10 shadow-sm'
                      : 'border-transparent bg-white hover:border-muted-foreground/20'
                  )}
                  onClick={() => {
                    const nextIds = [...formData.promoterIds];
                    const index = nextIds.indexOf(promoter._id);
                    if (index > -1) {
                      nextIds.splice(index, 1);
                    } else {
                      nextIds.push(promoter._id);
                    }
                    setFormData((prev) => ({ ...prev, promoterIds: nextIds }));
                  }}
                >
                  <div
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-lg text-[10px] font-bold',
                      formData.promoterIds.includes(promoter._id)
                        ? 'bg-primary text-white'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {promoter.displayName?.[0] || promoter.username?.[0]?.toUpperCase()}
                  </div>
                  <span className="truncate text-sm font-medium">{promoter.displayName || promoter.username}</span>
                </div>
              ))}
              {staff.filter((item) => item.role === 'salesperson').length === 0 && (
                <div className="col-span-full py-6 text-center text-xs italic text-muted-foreground">
                  暂无地推员，请先创建地推角色员工。
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <DialogFooter className="border-t bg-muted/30 p-8 pt-4">
        <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>
          取消
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? '提交中...' : isEditMode ? '保存修改' : '确认创建'}
        </Button>
      </DialogFooter>
    </form>
  );

  return (
    <div className="min-h-screen bg-white font-sans text-[#171717]">
      <main className="mx-auto max-w-[1600px] px-6 py-12">
        <div className="mb-12 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <h2 className="flex items-center gap-3 text-[32px] font-bold tracking-tight">
              员工管理
              {selectedDeptId && (
                <Badge variant="outline" className="rounded-full border-primary/20 bg-primary/5 px-3 text-sm font-medium text-primary">
                  {departments.find((dept) => dept._id === selectedDeptId)?.name}
                </Badge>
              )}
            </h2>
            <p className="text-sm text-muted-foreground">管理地推员、测量员、设计师与企业负责人，并补齐企业微信催办接收信息。</p>
          </div>

          <div className="flex items-center gap-4">
            {!loading && (
              <Badge variant="secondary" className="h-auto rounded-full border-none bg-muted px-4 py-1.5 font-bold text-muted-foreground">
                {staff.length} 个成员账号
              </Badge>
            )}
            {(currentUser?.role === 'super_admin' || currentUser?.role === 'enterprise_admin' || currentUser?.role === 'admin') && (
              <div className="flex items-center gap-3">
                <Dialog open={isDeptModalOpen} onOpenChange={setIsDeptModalOpen}>
                  <DialogContent className="max-w-md overflow-hidden rounded-[32px] border-none p-0 shadow-2xl">
                    {renderDeptForm()}
                  </DialogContent>
                </Dialog>

                <Dialog open={isModalOpen && !isEditMode} onOpenChange={(open) => !open && setIsModalOpen(false)}>
                  <DialogTrigger asChild>
                    <Button onClick={handleOpenCreateModal} className="h-11 rounded-full px-6 font-bold shadow-lg shadow-primary/20">
                      <Plus size={18} className="mr-2" /> 新增员工
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md overflow-hidden rounded-[32px] border-none p-0 shadow-2xl">
                    {renderStaffForm()}
                  </DialogContent>
                </Dialog>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-8 lg:flex-row">
          <aside className="w-full shrink-0 space-y-6 lg:w-72">
            <div className="rounded-[32px] border border-muted/50 bg-muted/20 p-6">
              <div className="mb-6 flex items-center justify-between px-1">
                <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">部门结构</h3>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full text-primary hover:bg-primary/10"
                  onClick={() => {
                    setEditingDept(null);
                    setDeptFormData({ name: '', parentId: null });
                    setIsDeptModalOpen(true);
                  }}
                >
                  <Plus size={16} />
                </Button>
              </div>
              <DepartmentTree
                departments={departments}
                selectedId={selectedDeptId}
                onSelect={setSelectedDeptId}
                onAdd={(parentId) => {
                  setEditingDept(null);
                  setDeptFormData({ name: '', parentId });
                  setIsDeptModalOpen(true);
                }}
                onEdit={(dept) => {
                  setEditingDept(dept);
                  setDeptFormData({ name: dept.name, parentId: dept.parentId || null });
                  setIsDeptModalOpen(true);
                }}
                onDelete={handleDeleteDept}
              />
            </div>

            <div className="rounded-[32px] border border-blue-100/50 bg-blue-50/50 p-6">
              <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-blue-700">配置建议</h4>
              <p className="text-[13px] leading-relaxed text-blue-600/80">
                企业微信催办要生效，除了企业级 CorpID / AgentID / Secret 外，每位相关员工也需要填写企业微信提醒接收 ID。
              </p>
            </div>
          </aside>

          <div className="min-w-0 flex-1">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-32 text-muted-foreground">
                <Loader2 className="mb-4 animate-spin" size={48} />
                <p className="text-sm font-medium">正在同步团队数据...</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
                {staff.map((member: any) => (
                  <div
                    key={member._id}
                    className="group relative rounded-[32px] border border-muted bg-white p-8 transition-all duration-300 hover:border-primary/50 hover:shadow-2xl hover:shadow-primary/5"
                  >
                    <div className="mb-8 flex items-start justify-between">
                      <div className="flex h-14 w-14 items-center justify-center rounded-[20px] bg-muted text-xl font-bold text-muted-foreground shadow-inner transition-all duration-500 group-hover:bg-primary group-hover:text-primary-foreground">
                        {member.displayName?.[0] || member.username[0].toUpperCase()}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <Badge
                          className={cn(
                            'border-none px-3 py-1 text-[10px] font-bold uppercase tracking-wider',
                            member.role === 'enterprise_admin'
                              ? 'bg-purple-100 text-purple-700'
                              : member.role === 'designer'
                                ? 'bg-blue-100 text-blue-700'
                                : member.role === 'measurer'
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-green-100 text-green-700'
                          )}
                        >
                          {getRoleLabel(member.role)}
                        </Badge>
                        {member.departmentId && (
                          <span className="text-[10px] font-medium text-muted-foreground">
                            {typeof member.departmentId === 'object'
                              ? member.departmentId.name
                              : departments.find((dept) => String(dept._id) === String(member.departmentId))?.name}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mb-8 space-y-1">
                      <h3 className="text-[20px] font-bold leading-none text-foreground">{member.displayName || member.username}</h3>
                      <p className="text-sm font-medium text-muted-foreground">@{member.username}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4 border-t border-muted/50 pt-6">
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold uppercase opacity-50 text-muted-foreground">联系电话</p>
                        <div className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                          <Smartphone size={14} className="text-muted-foreground" />
                          <span>{member.phone || '未填写'}</span>
                        </div>
                      </div>
                      <div className="space-y-1 text-right">
                        <p className="text-[10px] font-bold uppercase opacity-50 text-muted-foreground">企微提醒</p>
                        <div className="flex items-center justify-end gap-2 text-[13px] font-medium">
                          <Shield size={14} className={member.wecomUserId ? 'text-green-500' : 'text-muted-foreground/30'} />
                          <span className={cn(member.wecomUserId ? 'text-green-600' : 'text-muted-foreground')}>
                            {member.wecomUserId ? '已配置接收 ID' : '未配置'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="absolute right-4 top-4 flex gap-1 opacity-0 transition-all group-hover:opacity-100">
                      {(currentUser?.role === 'super_admin' || currentUser?.role === 'enterprise_admin' || (currentUser?.role === 'admin' && member.role !== 'super_admin')) && (
                        <>
                          <Dialog open={isModalOpen && isEditMode && editingId === member._id} onOpenChange={(open) => !open && setIsModalOpen(false)}>
                            <DialogTrigger asChild>
                              <Button
                                size="icon"
                                variant="secondary"
                                onClick={() => handleEditClick(member)}
                                className="h-10 w-10 rounded-full border border-muted bg-white text-muted-foreground shadow-xl transition-all hover:scale-110 hover:text-foreground"
                              >
                                <Pencil size={14} />
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-md overflow-hidden rounded-[32px] border-none p-0 shadow-2xl">
                              {renderStaffForm()}
                            </DialogContent>
                          </Dialog>
                          <Button
                            size="icon"
                            variant="secondary"
                            onClick={() => handleDelete(member._id)}
                            className="h-10 w-10 rounded-full border border-muted bg-white text-muted-foreground shadow-xl transition-all hover:scale-110 hover:text-destructive"
                          >
                            <Trash2 size={14} />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}

                {staff.length === 0 && (
                  <div className="col-span-full rounded-[40px] border-4 border-dashed border-muted/50 bg-muted/20 py-32 text-center text-muted-foreground">
                    <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-muted">
                      <UserIcon size={32} className="opacity-20" />
                    </div>
                    <h3 className="mb-1 text-xl font-bold text-foreground">当前筛选范围内暂无员工</h3>
                    <p>可以新增员工，或调整部门筛选条件。</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
