'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Trash2, Plus, RefreshCw, Cpu, Search, Edit2, Check, X, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';

interface Device {
  _id: string;
  code: string;
  description: string;
  createdAt: string;
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [updating, setUpdating] = useState(false);

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
    fetchDevices();
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
    if (!confirm('确定删除该设备吗？删除后小程序将无法连接此设备。')) return;
    
    try {
      const res = await fetch(`/api/devices/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setDevices(devices.filter(d => d._id !== id));
      }
    } catch (err) {
      console.error(err);
      alert('删除失败');
    }
  };

  const handleUpdate = async (id: string) => {
    if (!editCode.trim()) return;
    setUpdating(true);
    try {
      const res = await fetch(`/api/devices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: editCode.trim(), description: editDesc.trim() })
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
  };

  const filteredDevices = devices.filter(d => 
    d.code.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (d.description && d.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <div className="p-6 max-w-6xl mx-auto">
        <Link 
          href="/" 
          className="flex items-center gap-1 text-gray-500 hover:text-blue-600 transition-colors mb-6 w-fit"
        >
          <ArrowLeft size={16} />
          <span className="text-sm font-medium">返回首页</span>
        </Link>
        <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cpu className="text-blue-600" />
            设备管理
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            只有在此录入设备编码（MAC地址或蓝牙名称中包含的字符串）的测距仪，小程序才能成功连接。
          </p>
        </div>
        <button 
          onClick={fetchDevices}
          className="p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors"
          title="刷新列表"
        >
          <RefreshCw size={20} className={loading ? 'animate-spin text-gray-400' : 'text-gray-600'} />
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6 flex flex-col md:flex-row gap-4 items-center">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input 
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="搜索设备编码或备注名称..."
            className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
          />
        </div>
        <div className="text-sm text-gray-400">
          共 {filteredDevices.length} 个设备
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6">
        <div className="p-4 bg-gray-50 border-b border-gray-100 font-semibold text-gray-700 flex items-center gap-2">
          <Plus size={18} /> 录入新设备
        </div>
        <form onSubmit={handleAdd} className="p-4 flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1 w-full">
            <label className="block text-xs text-gray-500 mb-1">设备编码 (必填)</label>
            <input 
              type="text" 
              value={newCode}
              onChange={e => setNewCode(e.target.value)}
              placeholder="例如: 1A:2B:3C:4D:5E:6F 或 特定序列号" 
              className="w-full p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              required
            />
          </div>
          <div className="flex-1 w-full">
            <label className="block text-xs text-gray-500 mb-1">备注说明 (可选)</label>
            <input 
              type="text" 
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="例如: 张工的测距仪" 
              className="w-full p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <button 
            type="submit"
            disabled={adding || !newCode.trim()}
            className="w-full md:w-auto px-6 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors h-[38px]"
          >
            {adding ? '添加中...' : '添加设备'}
          </button>
        </form>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading && devices.length === 0 ? (
          <div className="p-8 text-center text-gray-400">加载中...</div>
        ) : devices.length === 0 ? (
          <div className="p-8 text-center text-gray-400">暂无录入的设备，请在上方添加</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-6 py-3 font-medium">设备编码</th>
                  <th className="px-6 py-3 font-medium">备注说明</th>
                  <th className="px-6 py-3 font-medium">录入时间</th>
                  <th className="px-6 py-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredDevices.map(device => (
                  <tr key={device._id} className="hover:bg-gray-50/50">
                    <td className="px-6 py-4 font-mono font-medium text-gray-900">
                      {editingId === device._id ? (
                        <input 
                          type="text"
                          value={editCode}
                          onChange={e => setEditCode(e.target.value)}
                          className="w-full p-1 border border-blue-500 rounded font-mono text-sm"
                          autoFocus
                        />
                      ) : (
                        device.code
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {editingId === device._id ? (
                        <input 
                          type="text"
                          value={editDesc}
                          onChange={e => setEditDesc(e.target.value)}
                          className="w-full p-1 border border-blue-500 rounded text-sm"
                        />
                      ) : (
                        device.description || '-'
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-400">
                      {new Date(device.createdAt).toLocaleString('zh-CN')}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {editingId === device._id ? (
                        <div className="flex justify-end gap-1">
                          <button 
                            onClick={() => handleUpdate(device._id)}
                            disabled={updating}
                            className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                            title="保存"
                          >
                            <Check size={18} />
                          </button>
                          <button 
                            onClick={() => setEditingId(null)}
                            className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors"
                            title="取消"
                          >
                            <X size={18} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <button 
                            onClick={() => startEdit(device)}
                            className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                            title="编辑"
                          >
                            <Edit2 size={18} />
                          </button>
                          <button 
                            onClick={() => handleDelete(device._id)}
                            className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            title="删除"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  </div>
);
}
