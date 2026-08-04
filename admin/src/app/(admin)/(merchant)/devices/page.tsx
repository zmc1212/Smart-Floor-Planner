'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button as AntButton, Space } from 'antd';
import { Building2, Cpu, Pencil, Plus, RefreshCw, Search, Trash2, UserRound, X } from 'lucide-react';
import { notify } from '@/components/ui/operation-feedback';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type Reference = {
  _id: string;
  name?: string;
  displayName?: string;
  username?: string;
  role?: string;
  enterpriseId?: string | Reference;
};

type DeviceStatus = 'unassigned' | 'assigned' | 'maintenance' | 'lost';

type Device = {
  _id: string;
  code: string;
  description?: string | null;
  status: DeviceStatus;
  enterpriseId?: string | Reference | null;
  assignedUserId?: string | Reference | null;
  createdAt?: string;
};

type DeviceDraft = {
  code: string;
  description: string;
  enterpriseId: string;
  assignedUserId: string;
  status: DeviceStatus;
};

type CurrentUser = {
  role?: string;
  enterpriseId?: string | Reference | null;
};

const STATUS_OPTIONS: Array<{ value: DeviceStatus; label: string }> = [
  { value: 'unassigned', label: '闲置' },
  { value: 'assigned', label: '已绑定' },
  { value: 'maintenance', label: '维护中' },
  { value: 'lost', label: '遗失' },
];

const STATUS_STYLES: Record<DeviceStatus, string> = {
  unassigned: 'bg-muted text-muted-foreground',
  assigned: 'bg-primary/10 text-primary',
  maintenance: 'bg-amber-100 text-amber-800',
  lost: 'bg-destructive/10 text-destructive',
};

function getReferenceId(value?: string | Reference | null) {
  if (!value) return '';
  return typeof value === 'string' ? value : value._id;
}

function getReferenceName(value?: string | Reference | null) {
  if (!value || typeof value === 'string') return '';
  return value.displayName || value.username || value.name || '';
}

function getRoleLabel(role?: string) {
  const labels: Record<string, string> = {
    designer: '设计师',
    salesperson: '渠道地推',
    measurer: '量房师',
    enterprise_admin: '企业管理员',
  };
  return labels[role || ''] || role || '员工';
}

function getStatusLabel(status: DeviceStatus) {
  return STATUS_OPTIONS.find((item) => item.value === status)?.label || status;
}

function formatCreatedAt(value?: string) {
  return value ? new Date(value).toLocaleDateString('zh-CN') : '-';
}

function toDeviceDraft(device: Device): DeviceDraft {
  return {
    code: device.code,
    description: device.description || '',
    enterpriseId: getReferenceId(device.enterpriseId),
    assignedUserId: getReferenceId(device.assignedUserId),
    status: device.status,
  };
}

export default function DevicesPage() {
  const confirmAction = useConfirmDialog();
  const { user: rawCurrentUser } = useCurrentUser();
  const currentUser = rawCurrentUser as CurrentUser | null;
  const [devices, setDevices] = useState<Device[]>([]);
  const [staff, setStaff] = useState<Reference[]>([]);
  const [enterprises, setEnterprises] = useState<Reference[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [createDraft, setCreateDraft] = useState({ code: '', description: '' });
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [editDraft, setEditDraft] = useState<DeviceDraft | null>(null);

  const canManage = currentUser?.role === 'super_admin' || currentUser?.role === 'admin' || currentUser?.role === 'enterprise_admin';
  const canChangeEnterprise = currentUser?.role === 'super_admin' || currentUser?.role === 'admin';

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch('/api/devices');
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '设备列表加载失败');
      setDevices(result.data || []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '设备列表加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStaff = useCallback(async () => {
    try {
      const [staffResponse, promoterResponse] = await Promise.all([
        fetch('/api/staff?limit=50'),
        fetch('/api/staff?scope=unassigned-promoters&limit=50'),
      ]);
      const [staffResult, promoterResult] = await Promise.all([
        staffResponse.json(),
        promoterResponse.json(),
      ]);
      const staffById = new Map(
        [
          ...(staffResponse.ok && staffResult.success ? staffResult.data || [] : []),
          ...(promoterResponse.ok && promoterResult.success ? promoterResult.data || [] : []),
        ]
          .map((member: Reference) => [member._id, member])
      );
      setStaff(Array.from(staffById.values()));
    } catch {
      // The device list remains usable when the optional staff filter cannot load.
    }
  }, []);

  const fetchEnterprises = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/enterprises');
      const result = await response.json();
      if (response.ok && result.success) setEnterprises(result.data || []);
    } catch {
      // Enterprise choices are only available to platform administrators.
    }
  }, []);

  useEffect(() => {
    void Promise.all([fetchDevices(), fetchStaff()]);
  }, [fetchDevices, fetchStaff]);

  useEffect(() => {
    if (canChangeEnterprise) void fetchEnterprises();
  }, [canChangeEnterprise, fetchEnterprises]);

  const visibleStaff = useMemo(() => {
    if (!editDraft?.enterpriseId) return staff;
    return staff.filter((member) => {
      const memberId = member._id;
      if (memberId === editDraft.assignedUserId) return true;
      return getReferenceId(member.enterpriseId) === editDraft.enterpriseId;
    });
  }, [editDraft?.assignedUserId, editDraft?.enterpriseId, staff]);

  const filteredDevices = useMemo(() => {
    const keyword = searchTerm.trim().toLocaleLowerCase();
    if (!keyword) return devices;
    return devices.filter((device) => [device.code, device.description]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()
      .includes(keyword));
  }, [devices, searchTerm]);

  const openEditDialog = (device: Device) => {
    setEditingDevice(device);
    setEditDraft(toDeviceDraft(device));
    setEditOpen(true);
  };

  const closeEditDialog = (open: boolean) => {
    setEditOpen(open);
    if (!open) {
      setEditingDevice(null);
      setEditDraft(null);
    }
  };

  const createDevice = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!createDraft.code.trim()) return;
    setCreating(true);
    try {
      const response = await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: createDraft.code.trim(),
          description: createDraft.description.trim(),
          enterpriseId: currentUser?.role === 'enterprise_admin' ? getReferenceId(currentUser.enterpriseId) : undefined,
          status: currentUser?.role === 'enterprise_admin' ? 'assigned' : 'unassigned',
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '设备录入失败');
      setCreateDraft({ code: '', description: '' });
      setCreateOpen(false);
      await fetchDevices();
      notify.success('设备已录入');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '设备录入失败');
    } finally {
      setCreating(false);
    }
  };

  const updateDevice = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingDevice || !editDraft?.code.trim()) return;
    setUpdating(true);
    try {
      const response = await fetch(`/api/devices/${editingDevice._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: editDraft.code.trim(),
          description: editDraft.description.trim(),
          enterpriseId: canChangeEnterprise ? editDraft.enterpriseId || null : undefined,
          assignedUserId: editDraft.assignedUserId || null,
          status: editDraft.status,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '设备更新失败');
      setDevices((current) => current.map((device) => device._id === editingDevice._id ? result.data : device));
      closeEditDialog(false);
      notify.success('设备已更新');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '设备更新失败');
    } finally {
      setUpdating(false);
    }
  };

  const deleteDevice = async (device: Device) => {
    const confirmed = await confirmAction({
      title: '删除设备',
      description: `确定删除设备 ${device.code} 吗？删除后无法恢复。`,
      confirmText: '删除',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      const response = await fetch(`/api/devices/${device._id}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '删除失败');
      setDevices((current) => current.filter((item) => item._id !== device._id));
      notify.success('设备已删除');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '删除失败');
    }
  };

  return (
    <div className="admin-page-frame">
      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-foreground">
            <Cpu className="text-primary" size={20} />
            <h1 className="text-2xl font-semibold">测距仪设备池</h1>
          </div>
          <p className="text-sm text-muted-foreground">维护设备资产、企业归属、员工绑定与运行状态。</p>
        </div>
        <div className="flex items-center gap-2">
          <Button aria-label="刷新设备列表" disabled={loading} size="icon" title="刷新设备列表" variant="outline" onClick={() => void fetchDevices()}>
            <RefreshCw className={loading ? 'animate-spin' : ''} size={16} />
          </Button>
          {canManage ? <Button onClick={() => setCreateOpen(true)}><Plus size={16} />录入设备</Button> : null}
        </div>
      </header>

      <section aria-label="设备资产列表" className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <Input aria-label="搜索设备" className="pr-9 pl-9" placeholder="搜索设备编码或备注" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} />
            {searchTerm ? (
              <Button aria-label="清除设备搜索" className="absolute right-1 top-1/2 -translate-y-1/2" size="icon-sm" title="清除搜索" variant="ghost" onClick={() => setSearchTerm('')}>
                <X size={14} />
              </Button>
            ) : null}
          </div>
          <Badge variant="secondary">{filteredDevices.length} 台设备</Badge>
        </div>

        {loadError ? (
          <div className="flex min-h-56 flex-col items-center justify-center gap-3 px-6 text-center">
            <Cpu className="text-destructive" size={28} />
            <div>
              <p className="font-medium">无法加载设备资产</p>
              <p className="mt-1 text-sm text-muted-foreground">{loadError}</p>
            </div>
            <Button variant="outline" onClick={() => void fetchDevices()}>重试</Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/20">
                <TableRow>
                  <TableHead>设备编码</TableHead>
                  <TableHead>归属企业</TableHead>
                  <TableHead>持有人</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>录入时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDevices.map((device) => (
                  <TableRow key={device._id}>
                    <TableCell>
                      <div className="font-mono font-medium">{device.code}</div>
                      <div className="mt-0.5 max-w-56 truncate text-xs text-muted-foreground">{device.description || '无备注'}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-36 items-center gap-2">
                        <Building2 className="text-muted-foreground" size={15} />
                        <span>{getReferenceName(device.enterpriseId) || '未分配企业'}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-36 items-center gap-2">
                        <UserRound className="text-muted-foreground" size={15} />
                        <span>{getReferenceName(device.assignedUserId) || '未指派人员'}</span>
                      </div>
                    </TableCell>
                    <TableCell><Badge className={STATUS_STYLES[device.status]} variant="secondary">{getStatusLabel(device.status)}</Badge></TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatCreatedAt(device.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      {canManage ? (
                        <Space size={8}>
                          <AntButton aria-label={`编辑设备 ${device.code}`} icon={<Pencil size={14} />} size="small" onClick={() => openEditDialog(device)}>编辑</AntButton>
                          <AntButton aria-label={`删除设备 ${device.code}`} danger icon={<Trash2 size={14} />} size="small" onClick={() => void deleteDevice(device)}>删除</AntButton>
                        </Space>
                      ) : '-'}
                    </TableCell>
                  </TableRow>
                ))}
                {loading && filteredDevices.length === 0 ? <TableRow><TableCell className="h-56 text-center text-muted-foreground" colSpan={6}>正在加载设备资产...</TableCell></TableRow> : null}
                {!loading && filteredDevices.length === 0 ? <TableRow><TableCell className="h-56 text-center text-muted-foreground" colSpan={6}>未发现符合条件的设备资产</TableCell></TableRow> : null}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <form onSubmit={createDevice}>
            <DialogHeader>
              <DialogTitle>录入设备</DialogTitle>
              <DialogDescription>录入新的激光测距仪资产。企业管理员录入的设备会归属当前企业。</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-5">
              <div className="space-y-2">
                <Label htmlFor="new-device-code">设备编码 / MAC</Label>
                <Input id="new-device-code" required className="font-mono" placeholder="例如：SN-123456" value={createDraft.code} onChange={(event) => setCreateDraft((current) => ({ ...current, code: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-device-description">备注</Label>
                <Input id="new-device-description" placeholder="例如：杭州分公司备机" value={createDraft.description} onChange={(event) => setCreateDraft((current) => ({ ...current, description: event.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
              <Button disabled={creating} type="submit">{creating ? '正在录入...' : '确认录入'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={closeEditDialog}>
        <DialogContent>
          <form onSubmit={updateDevice}>
            <DialogHeader>
              <DialogTitle>编辑设备</DialogTitle>
              <DialogDescription>设备绑定会在保存时校验企业与员工的归属关系。</DialogDescription>
            </DialogHeader>
            {editDraft ? (
              <div className="space-y-4 py-5">
                <div className="space-y-2">
                  <Label htmlFor="edit-device-code">设备编码 / MAC</Label>
                  <Input id="edit-device-code" required className="font-mono" value={editDraft.code} onChange={(event) => setEditDraft((current) => current ? { ...current, code: event.target.value } : current)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-device-description">备注</Label>
                  <Input id="edit-device-description" value={editDraft.description} onChange={(event) => setEditDraft((current) => current ? { ...current, description: event.target.value } : current)} />
                </div>
                {canChangeEnterprise ? (
                  <div className="space-y-2">
                    <Label>归属企业</Label>
                    <Select value={editDraft.enterpriseId || 'unassigned'} onValueChange={(value) => setEditDraft((current) => {
                      if (!current) return current;
                      const enterpriseId = value === 'unassigned' ? '' : value;
                      return {
                        ...current,
                        enterpriseId,
                        assignedUserId: '',
                        status: !enterpriseId && current.status === 'assigned' ? 'unassigned' : current.status,
                      };
                    })}>
                      <SelectTrigger><SelectValue placeholder="未分配企业" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">未分配企业</SelectItem>
                        {enterprises.map((enterprise) => <SelectItem key={enterprise._id} value={enterprise._id}>{enterprise.name || enterprise._id}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <div className="space-y-2">
                  <Label>持有人</Label>
                  <Select value={editDraft.assignedUserId || 'unassigned'} onValueChange={(value) => setEditDraft((current) => {
                    if (!current) return current;
                    const assignedUserId = value === 'unassigned' ? '' : value;
                    return {
                      ...current,
                      assignedUserId,
                      status: assignedUserId && current.status === 'unassigned' ? 'assigned' : current.status,
                    };
                  })}>
                    <SelectTrigger><SelectValue placeholder="未指派人员" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">未指派人员</SelectItem>
                      {visibleStaff.map((member) => <SelectItem key={member._id} value={member._id}>{getReferenceName(member)}（{getRoleLabel(member.role)}）</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>状态</Label>
                  <Select value={editDraft.status} onValueChange={(value) => setEditDraft((current) => current ? { ...current, status: value as DeviceStatus } : current)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUS_OPTIONS.map((status) => <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => closeEditDialog(false)}>取消</Button>
              <Button disabled={updating} type="submit">{updating ? '正在保存...' : '保存更改'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
