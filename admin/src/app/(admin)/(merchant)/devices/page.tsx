'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Trash2, Plus, RefreshCw, Cpu, Search, Edit2, Check, X, Building2, User } from 'lucide-react';
import Link from 'next/link';
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

interface Device {
  _id: string;
  code: string;
  description: string;
  status: string;
  enterpriseId?: any;
  assignedUserId?: any;
  createdAt: string;
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [enterprises, setEnterprises] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  // Enterprise state (for super_admin to map IDs to names)
  const [allEnterprises, setAllEnterprises] = useState<any[]>([]);
  // Edit State
  const [editCode, setEditCode] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editEnterprise, setEditEnterprise] = useState('');
  const [editStaff, setEditStaff] = useState('');
  const [updating, setUpdating] = useState(false);

  const fetchCurrentUser = async () => {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      if (data.success) {
        setCurrentUser(data.data);
      }
    } catch (err) { console.error(err); }
  };

  const fetchEnterprises = async () => {
    try {
      const res = await fetch('/api/admin/enterprises');
      const data = await res.json();
      if (data.success) {
        setAllEnterprises(data.data);
      }
    } catch (err) { console.error(err); }
  };

  const fetchStaff = async () => {
    try {
      const res = await fetch(`/api/staff`);
      const data = await res.json();
      if (data.success) setStaff(data.data);
    } catch (err) { console.error(err); }
  };

  const fetchDevices = async () => {
    setLoading(true);
    try {
      let url = '/api/devices';
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) setDevices(data.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCurrentUser();
  }, []);

  useEffect(() => {
    if (currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'admin')) {
      fetchEnterprises();
    }
  }, [currentUser]);

  useEffect(() => {
    fetchDevices();
    fetchStaff();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode.trim()) return;
    
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          code: newCode.trim(), 
          description: newDesc.trim(),
          enterpriseId: currentUser?.role === 'enterprise_admin' ? (currentUser.enterpriseId?._id || currentUser.enterpriseId) : undefined,
          status: currentUser?.role === 'enterprise_admin' ? 'assigned' : 'unassigned'
        })
      });
      const data = await res.json();
      if (data.success) {
        setNewCode('');
        setNewDesc('');
        setIsAddModalOpen(false);
        fetchDevices();
      } else {
        alert(data.error);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该设备吗？')) return;
    try {
      const res = await fetch(`/api/devices/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setDevices(devices.filter(d => d._id !== id));
      }
    } catch (err) { console.error(err); }
  };

  const handleUpdate = async (id: string) => {
    if (!editCode.trim()) return;
    setUpdating(true);
    try {
      const payload: any = { 
        code: editCode.trim(), 
        description: editDesc.trim(),
        enterpriseId: editEnterprise || null,
        assignedUserId: editStaff || null,
        status: editStaff ? 'assigned' : (editEnterprise ? 'assigned' : 'unassigned')
      };

      const res = await fetch(`/api/devices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        setDevices(devices.map(d => d._id === id ? data.data : d));
        setEditingId(null);
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

  const startEdit = (device: Device) => {
    setEditingId(device._id);
    setEditCode(device.code);
    setEditDesc(device.description || '');
    // Ensure we handle both populated and unpopulated cases correctly by coercing to string
    const entId = typeof device.enterpriseId === 'object' ? device.enterpriseId?._id : device.enterpriseId;
    const staffId = typeof device.assignedUserId === 'object' ? device.assignedUserId?._id : device.assignedUserId;
    
    setEditEnterprise(entId ? String(entId) : '');
    setEditStaff(staffId ? String(staffId) : '');
  };

  const getEnterpriseName = (idOrObj: any) => {
      if (!idOrObj) return null;
      if (typeof idOrObj === 'object' && idOrObj.name) return idOrObj.name;
      
      const id = String(idOrObj);
      const ent = allEnterprises.find(e => String(e._id) === id);
      return ent ? ent.name : null;
  };

  const getStaffName = (idOrObj: any) => {
      if (!idOrObj) return null;
      if (typeof idOrObj === 'object') {
        const name = idOrObj.displayName || idOrObj.username;
        if (name) return name;
      }
      
      const id = String(idOrObj);
      const s = staff.find(x => String(x._id) === id);
      return s ? (s.displayName || s.username) : null;
  };

  const filteredDevices = devices.filter(d => 
    d.code.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (d.description && d.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="min-h-screen bg-white">
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
            <div className="flex items-center gap-4">
                <div className="p-4 bg-primary/10 text-primary rounded-[24px] shadow-inner">
                    <Cpu size={32} strokeWidth={2.5} />
                </div>
                <div>
                   <h1 className="text-[32px] font-bold tracking-tight mb-1">测距仪设备池</h1>
                   <div className="flex flex-col gap-3">
                      <p className="text-muted-foreground text-sm">管理全渠道测距仪资产，进行企业与设计师强绑定</p>
                      
                      {/* Enterprise Selector removed, now handled globally in Sidebar */}
                   </div>
                </div>
            </div>
            
            <div className="flex gap-3">
                <Button 
                   variant="outline" 
                   size="icon" 
                   onClick={() => fetchDevices()} 
                   className="rounded-full h-12 w-12 border-muted"
                >
                    <RefreshCw size={20} className={cn("text-muted-foreground", loading && "animate-spin")} />
                </Button>

                {(currentUser?.role === 'super_admin' || currentUser?.role === 'admin' || currentUser?.role === 'enterprise_admin') && (
                    <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
                        <DialogTrigger asChild>
                            <Button className="rounded-full px-8 h-12 text-base font-semibold shadow-lg shadow-primary/20 flex items-center gap-2">
                                <Plus size={20} /> 录入新库存
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-md p-0 overflow-hidden rounded-[32px] shadow-2xl border-none">
                            <form onSubmit={handleAdd}>
                                <DialogHeader className="p-8 pb-6 border-b bg-muted/20">
                                    <DialogTitle className="text-2xl font-bold">录入新设备</DialogTitle>
                                    <DialogDescription>将新的激光测距仪 MAC 地址录入系统库存</DialogDescription>
                                </DialogHeader>
                                
                                <div className="p-8 space-y-5">
                                    <div className="space-y-2">
                                        <Label htmlFor="device-code" className="text-xs font-bold uppercase tracking-widest text-muted-foreground">设备编码 / MAC (必填)</Label>
                                        <Input 
                                            id="device-code"
                                            required
                                            value={newCode}
                                            onChange={e => setNewCode(e.target.value)}
                                            placeholder="例如: SN-123456"
                                            className="h-12 rounded-2xl bg-muted/30 border-none font-mono text-lg focus-visible:ring-primary"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="device-desc" className="text-xs font-bold uppercase tracking-widest text-muted-foreground">备注名称</Label>
                                        <Input 
                                            id="device-desc"
                                            value={newDesc}
                                            onChange={e => setNewDesc(e.target.value)}
                                            placeholder="例如: 杭州分公司备机"
                                            className="h-12 rounded-2xl bg-muted/30 border-none focus-visible:ring-primary"
                                        />
                                    </div>
                                </div>

                                <DialogFooter className="p-8 pt-4 bg-muted/30 border-t">
                                    <Button type="button" variant="ghost" className="h-12 rounded-2xl px-6 bg-background" onClick={() => setIsAddModalOpen(false)}>取消</Button>
                                    <Button type="submit" disabled={isSubmitting} className="h-12 rounded-2xl px-10 font-bold shadow-lg shadow-primary/10">
                                        {isSubmitting ? "正在录入..." : "确认录入"}
                                    </Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
                )}
            </div>
        </div>

        {/* Filters */}
        <div className="mb-10 flex gap-4 bg-muted/30 p-2 rounded-[24px] border border-muted/50">
            <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                <Input 
                    className="w-full pl-12 h-12 bg-background border-none shadow-none rounded-[20px] focus-visible:ring-2 focus-visible:ring-primary/20 text-base"
                    placeholder="根据编码或备注检索资产..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />
            </div>
        </div>


        <div className="border rounded-[32px] overflow-hidden shadow-sm bg-white">
            <Table>
                <TableHeader className="bg-muted/30">
                    <TableRow className="border-muted/50 hover:bg-transparent">
                        <TableHead className="px-8 py-5 h-auto text-[13px] font-bold text-foreground">设备编码</TableHead>
                        <TableHead className="px-8 py-5 h-auto text-[13px] font-bold text-foreground">归属企业</TableHead>
                        <TableHead className="px-8 py-5 h-auto text-[13px] font-bold text-foreground">持有人 (强绑定)</TableHead>
                        <TableHead className="px-8 py-5 h-auto text-[13px] font-bold text-foreground">状态</TableHead>
                        <TableHead className="px-8 py-5 h-auto text-[13px] font-bold text-right text-foreground">操作</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {filteredDevices.map(device => (
                        <TableRow key={device._id} className="border-muted/50 hover:bg-muted/10 transition-colors">
                            <TableCell className="px-8 py-6">
                                {editingId === device._id ? (
                                    <Input value={editCode} onChange={e => setEditCode(e.target.value)} className="h-9 font-mono border-primary shadow-none" />
                                ) : (
                                    <div className="space-y-1">
                                        <div className="text-[15px] font-mono font-bold leading-none">{device.code}</div>
                                        <div className="text-xs text-muted-foreground">{device.description || '无备注'}</div>
                                    </div>
                                )}
                            </TableCell>
                            <TableCell className="px-8 py-6">
                                {editingId === device._id && (currentUser?.role === 'super_admin' || currentUser?.role === 'admin') ? (
                                    <Select value={editEnterprise || "unassigned"} onValueChange={(val) => setEditEnterprise(val === "unassigned" ? "" : val)}>
                                        <SelectTrigger className="h-9 border-primary shadow-none min-w-[200px]">
                                            <SelectValue placeholder="未分配企业">
                                                {(editEnterprise && editEnterprise !== "unassigned") ? (
                                                    getEnterpriseName(editEnterprise) || <span className="font-mono text-xs text-red-500">{editEnterprise}</span>
                                                ) : "未分配企业"}
                                            </SelectValue>
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="unassigned">未分配企业</SelectItem>
                                            {allEnterprises.map(e => <SelectItem key={e._id} value={String(e._id)}>{e.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                ) : (
                                    <div className="flex items-center gap-2 text-sm text-foreground/80">
                                        <Building2 size={14} className="text-muted-foreground" />
                                        {getEnterpriseName(device.enterpriseId) || <span className="text-muted-foreground italic text-xs">未分配企业</span>}
                                    </div>
                                )}
                            </TableCell>
                            <TableCell className="px-8 py-6">
                                {editingId === device._id ? (
                                    <Select value={editStaff || "unassigned"} onValueChange={(val) => setEditStaff(val === "unassigned" ? "" : val)}>
                                        <SelectTrigger className="h-9 border-primary shadow-none min-w-[200px]">
                                            <SelectValue placeholder="未指派个人">
                                                {(editStaff && editStaff !== "unassigned") ? (
                                                    getStaffName(editStaff) || <span className="font-mono text-xs text-red-500">{editStaff}</span>
                                                ) : "未指派个人"}
                                            </SelectValue>
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="unassigned">未指派个人</SelectItem>
                                            {staff
                                                .filter(s => {
                                                    const sId = String(s._id);
                                                    const currentId = String(editStaff);
                                                    
                                                    // ALWAYS include the currently selected staff member to prevent ID display
                                                    // This ensures that even if they belong to a different enterprise, their name shows up
                                                    if (currentId && sId === currentId) return true;
                                                    
                                                    const sEntId = typeof s.enterpriseId === 'object' ? s.enterpriseId?._id : s.enterpriseId;
                                                    return !editEnterprise || String(sEntId) === String(editEnterprise);
                                                })
                                                .map(s => (
                                                    <SelectItem key={s._id} value={String(s._id)}>
                                                        {s.displayName || s.username} ({getRoleLabelShort(s.role)})
                                                    </SelectItem>
                                                ))
                                            }
                                        </SelectContent>
                                    </Select>
                                ) : (
                                    <div className="flex items-center gap-2 text-sm text-foreground/80">
                                        <User size={14} className="text-muted-foreground" />
                                        {getStaffName(device.assignedUserId) || <span className="text-muted-foreground italic text-xs">未指派人员</span>}
                                    </div>
                                )}
                            </TableCell>
                            <TableCell className="px-8 py-6">
                                {device.status === 'assigned' ? (
                                    <Badge variant="secondary" className="bg-green-100 text-green-700 hover:bg-green-100 border-none px-3 font-bold h-6">已绑定</Badge>
                                ) : (
                                    <Badge variant="secondary" className="bg-muted text-muted-foreground hover:bg-muted border-none px-3 font-bold h-6">闲置中</Badge>
                                )}
                            </TableCell>
                            <TableCell className="px-8 py-6 text-right">
                                {editingId === device._id ? (
                                    <div className="flex justify-end gap-1">
                                        <Button size="icon" variant="ghost" onClick={() => handleUpdate(device._id)} className="text-green-600 hover:text-green-700 hover:bg-green-50"><Check size={20} /></Button>
                                        <Button size="icon" variant="ghost" onClick={() => setEditingId(null)} className="text-muted-foreground"><X size={20} /></Button>
                                    </div>
                                ) : (
                                    <div className="flex justify-end gap-1">
                                        <Button size="icon" variant="ghost" onClick={() => startEdit(device)} className="text-muted-foreground hover:text-foreground"><Edit2 size={16} /></Button>
                                        <Button size="icon" variant="ghost" onClick={() => handleDelete(device._id)} className="text-muted-foreground hover:text-destructive"><Trash2 size={16} /></Button>
                                    </div>
                                )}
                            </TableCell>
                        </TableRow>
                    ))}
                    {filteredDevices.length === 0 && (
                        <TableRow>
                            <TableCell colSpan={5} className="h-48 text-center text-muted-foreground">
                                <div className="flex flex-col items-center justify-center space-y-2">
                                    <Cpu size={32} className="opacity-20" />
                                    <p>未发现符合条件的设备资产</p>
                                </div>
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </div>
      </div>
    </div>
  );
}

function getRoleLabelShort(role: string) {
    if (role === 'designer') return '设';
    if (role === 'salesperson') return '销';
    if (role === 'enterprise_admin') return '管';
    return '';
}
