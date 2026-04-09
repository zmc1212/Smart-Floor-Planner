'use client';

import React, { useState, useEffect } from 'react';
import { Trash2, Plus, RefreshCw, Cpu } from 'lucide-react';

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

  return (
    <div className="p-6 max-w-6xl mx-auto">
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
                {devices.map(device => (
                  <tr key={device._id} className="hover:bg-gray-50/50">
                    <td className="px-6 py-4 font-mono font-medium text-gray-900">{device.code}</td>
                    <td className="px-6 py-4 text-gray-600">{device.description || '-'}</td>
                    <td className="px-6 py-4 text-gray-400">
                      {new Date(device.createdAt).toLocaleString('zh-CN')}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button 
                        onClick={() => handleDelete(device._id)}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="删除"
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
