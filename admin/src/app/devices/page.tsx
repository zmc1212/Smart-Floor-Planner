'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Trash2, Plus, RefreshCw, Cpu, Search, Edit2, Check, X, ArrowLeft, Building2, User } from 'lucide-react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';

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
  const [adding, setAdding] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  
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
      if (data.success) setCurrentUser(data.data);
    } catch (err) { console.error(err); }
  };

  const fetchEnterprises = async () => {
    try {
      const res = await fetch('/api/admin/enterprises');
      const data = await res.json();
      if (data.success) setEnterprises(data.data.filter((e: any) => e.status === 'active'));
    } catch (err) { console.error(err); }
  };

  const fetchStaff = async () => {
    try {
      const res = await fetch('/api/staff');
      const data = await res.json();
      if (data.success) setStaff(data.data);
    } catch (err) { console.error(err); }
  };

  const fetchDevices = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/devices');
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
    fetchDevices();
    fetchEnterprises();
    fetchStaff();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode.trim()) return;
    
    setAdding(true);
    try {
      const res = await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: newCode.trim(), description: newDesc.trim() })
      });
      const data = await res.json();
      if (data.success) {
        setNewCode('');
        setNewDesc('');
        fetchDevices();
      } else {
        alert(data.error || '添加失败');
      }
    } catch (err) {
      console.error(err);
      alert('请求失败');
    } finally {
      setAdding(false);
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
    setEditEnterprise(device.enterpriseId?._id || device.enterpriseId || '');
    setEditStaff(device.assignedUserId?._id || device.assignedUserId || '');
  };

  const getEnterpriseName = (id: any) => {
      if (!id) return '-';
      const entId = typeof id === 'object' ? id._id : id;
      const ent = enterprises.find(e => e._id === entId);
      return ent ? ent.name : '未知企业';
  };

  const getStaffName = (id: any) => {
      if (!id) return '未指派';
      const sId = typeof id === 'object' ? id._id : id;
      const s = staff.find(x => x._id === sId);
      return s ? (s.displayName || s.username) : '未知员工';
  };

  const filteredDevices = devices.filter(d => 
    d.code.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (d.description && d.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
            <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl">
                    <Cpu size={24} />
                </div>
                <h1 className="text-[28px] font-bold tracking-tight">测距仪设备池</h1>
            </div>
            <button onClick={fetchDevices} className="p-2.5 hover:bg-gray-50 rounded-full transition-colors">
                <RefreshCw size={20} className={loading ? 'animate-spin text-gray-400' : 'text-gray-400'} />
            </button>
        </div>

        {/* Filters */}
        <div className="mb-8 flex gap-4">
            <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={18} />
                <input 
                    className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-transparent rounded-2xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500/20 transition-all text-sm"
                    placeholder="按设备编码或备注搜索..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />
            </div>
        </div>

        {/* Add New Device (Super Admin only) */}
        {(currentUser?.role === 'super_admin' || currentUser?.role === 'admin') && (
            <div className="mb-8 p-6 bg-gray-50 rounded-3xl border border-gray-100">
                <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
                    <div className="space-y-1.5">
                        <label className="text-[12px] font-bold text-gray-400 uppercase tracking-wider">设备编码 / MAC</label>
                        <input 
                            required
                            className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/10 text-sm font-mono"
                            placeholder="例如: SN-123456"
                            value={newCode}
                            onChange={e => setNewCode(e.target.value)}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[12px] font-bold text-gray-400 uppercase tracking-wider">备注名称</label>
                        <input 
                            className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/10 text-sm"
                            placeholder="例如: 杭州分公司备机"
                            value={newDesc}
                            onChange={e => setNewDesc(e.target.value)}
                        />
                    </div>
                    <button 
                        type="submit"
                        disabled={adding}
                        className="py-2.5 bg-[#171717] text-white font-bold rounded-xl hover:bg-black disabled:opacity-50 transition-all"
                    >
                        {adding ? '录入中...' : '录入新库存'}
                    </button>
                </form>
            </div>
        )}

        {/* Device Table */}
        <div className="bg-white rounded-3xl shadow-[0px_0px_0px_1px_rgba(0,0,0,0.08)] overflow-hidden">
            <table className="w-full text-left border-collapse">
                <thead>
                    <tr className="bg-[#fafafa] border-b border-[rgba(0,0,0,0.08)]">
                        <th className="px-6 py-4 text-[13px] font-bold">设备编码</th>
                        <th className="px-6 py-4 text-[13px] font-bold">归属企业</th>
                        <th className="px-6 py-4 text-[13px] font-bold">当前持有人 (强绑定)</th>
                        <th className="px-6 py-4 text-[13px] font-bold">状态</th>
                        <th className="px-6 py-4 text-[13px] font-bold text-right">操作</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(0,0,0,0.08)]">
                    {filteredDevices.map(device => (
                        <tr key={device._id} className="hover:bg-gray-50/30 transition-colors">
                            <td className="px-6 py-5">
                                {editingId === device._id ? (
                                    <input value={editCode} onChange={e => setEditCode(e.target.value)} className="w-full p-2 border border-blue-200 rounded-lg text-sm font-mono" />
                                ) : (
                                    <div>
                                        <div className="text-[14px] font-mono font-bold">{device.code}</div>
                                        <div className="text-[11px] text-gray-400 mt-0.5">{device.description || '无备注'}</div>
                                    </div>
                                )}
                            </td>
                            <td className="px-6 py-5">
                                {editingId === device._id && (currentUser?.role === 'super_admin' || currentUser?.role === 'admin') ? (
                                    <select value={editEnterprise} onChange={e => setEditEnterprise(e.target.value)} className="w-full p-2 border border-blue-200 rounded-lg text-sm">
                                        <option value="">未分配企业</option>
                                        {enterprises.map(e => <option key={e._id} value={e._id}>{e.name}</option>)}
                                    </select>
                                ) : (
                                    <div className="flex items-center gap-2 text-[13px] text-gray-600">
                                        <Building2 size={14} className="text-gray-300" />
                                        {getEnterpriseName(device.enterpriseId)}
                                    </div>
                                )}
                            </td>
                            <td className="px-6 py-5">
                                {editingId === device._id ? (
                                    <select value={editStaff} onChange={e => setEditStaff(e.target.value)} className="w-full p-2 border border-blue-200 rounded-lg text-sm">
                                        <option value="">未指派个人</option>
                                        {staff.filter(s => (editEnterprise ? s.enterpriseId === editEnterprise : true)).map(s => (
                                            <option key={s._id} value={s._id}>{s.displayName || s.username} ({getRoleLabelShort(s.role)})</option>
                                        ))}
                                    </select>
                                ) : (
                                    <div className="flex items-center gap-2 text-[13px] text-gray-600">
                                        <User size={14} className="text-gray-300" />
                                        {getStaffName(device.assignedUserId)}
                                    </div>
                                )}
                            </td>
                            <td className="px-6 py-5">
                                <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${
                                    device.status === 'assigned' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'
                                }`}>
                                    {device.status === 'assigned' ? '已绑定' : '闲置中'}
                                </span>
                            </td>
                            <td className="px-6 py-5 text-right">
                                {editingId === device._id ? (
                                    <div className="flex justify-end gap-2">
                                        <button onClick={() => handleUpdate(device._id)} className="p-2 text-green-600 hover:bg-green-50 rounded-xl"><Check size={18} /></button>
                                        <button onClick={() => setEditingId(null)} className="p-2 text-gray-400 hover:bg-gray-50 rounded-xl"><X size={18} /></button>
                                    </div>
                                ) : (
                                    <div className="flex justify-end gap-2">
                                        <button onClick={() => startEdit(device)} className="p-2 text-gray-400 hover:text-[#171717] hover:bg-gray-100 rounded-xl transition-all"><Edit2 size={18} /></button>
                                        <button onClick={() => handleDelete(device._id)} className="p-2 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"><Trash2 size={18} /></button>
                                    </div>
                                )}
                            </td>
                        </tr>
                    ))}
                    {filteredDevices.length === 0 && (
                        <tr><td colSpan={5} className="p-12 text-center text-gray-400 text-sm">暂无匹配设备</td></tr>
                    )}
                </tbody>
            </table>
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
