'use client';

import React, { useState, useEffect } from 'react';
import Navbar from "@/components/Navbar";
import { Loader2, CheckCircle, Clock, X, Building2, User, Phone, Mail } from "lucide-react";

export default function EnterprisesPage() {
  const [enterprises, setEnterprises] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEnt, setSelectedEnt] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  useEffect(() => {
    fetchEnterprises();
  }, []);

  const updateStatus = async (id: string, status: string) => {
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/admin/enterprises/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      const data = await res.json();
      if (data.success) {
        fetchEnterprises();
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
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800"><Clock size={12} /> 待审核</span>;
      case 'active':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800"><CheckCircle size={12} /> 已启用</span>;
      case 'disabled':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">已禁用</span>;
      default:
        return <span>{status}</span>;
    }
  };

  return (
    <div className="min-h-screen bg-white text-[#171717] font-sans">
      <Navbar />
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
          <button className="px-6 py-2.5 bg-[#171717] text-white rounded-full text-[14px] font-medium hover:bg-black transition-all flex items-center gap-2">
             手动添加企业
          </button>
        </div>

        {loading && (
          <div className="flex flex-col items-center justify-center py-24 text-[#808080]">
            <Loader2 className="animate-spin mb-4" size={32} />
            <p className="text-[14px]">正在获取企业数据...</p>
          </div>
        )}

        {!loading && (
          <div className="bg-white rounded-2xl shadow-[0px_0px_0px_1px_rgba(0,0,0,0.08),0px_2px_2px_rgba(0,0,0,0.04)] ring-1 ring-[#fafafa] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#fafafa] border-b border-[rgba(0,0,0,0.08)]">
                    <th className="p-4 text-[13px] font-bold text-[#171717]">机构名称</th>
                    <th className="p-4 text-[13px] font-bold text-[#171717]">社会代码/编号</th>
                    <th className="p-4 text-[13px] font-bold text-[#171717]">联系人</th>
                    <th className="p-4 text-[13px] font-bold text-[#171717]">状态</th>
                    <th className="p-4 text-[13px] font-bold text-[#171717]">入驻模式</th>
                    <th className="p-4 text-[13px] font-bold text-[#171717]">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(0,0,0,0.08)]">
                  {enterprises.map((ent: any) => (
                    <tr key={ent._id} className="hover:bg-[#fcfcfc] transition-colors">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center">
                            <Building2 size={16} className="text-gray-400" />
                          </div>
                          <div className="text-[14px] font-semibold text-[#171717]">{ent.name}</div>
                        </div>
                      </td>
                      <td className="p-4 text-[13px] text-[#666] font-mono">{ent.code}</td>
                      <td className="p-4">
                        <div className="text-[13px] text-[#171717]">{ent.contactPerson?.name}</div>
                        <div className="text-[11px] text-[#999]">{ent.contactPerson?.phone}</div>
                      </td>
                      <td className="p-4">{getStatusBadge(ent.status)}</td>
                      <td className="p-4 text-[12px] text-[#666]">
                        {ent.registrationMode === 'self_service' ? '自助注册' : '后台录入'}
                      </td>
                      <td className="p-4">
                        <button 
                          onClick={() => setSelectedEnt(ent)}
                          className="text-[13px] font-medium text-[#171717] hover:underline"
                        >
                          详情 & 审核
                        </button>
                      </td>
                    </tr>
                  ))}
                  {enterprises.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-12 text-center text-gray-400 text-sm">暂无企业数据</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Enterprise Detail Modal */}
        {selectedEnt && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSelectedEnt(null)} />
            <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
              <div className="p-8 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center">
                    <Building2 size={24} className="text-gray-400" />
                  </div>
                  <div>
                    <h3 className="text-[20px] font-bold">{selectedEnt.name}</h3>
                    <div className="text-[13px] text-gray-400">注册时间: {new Date(selectedEnt.createdAt).toLocaleString()}</div>
                  </div>
                </div>
                <button onClick={() => setSelectedEnt(null)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                  <X size={20} />
                </button>
              </div>

              <div className="p-8 space-y-8">
                <div className="grid grid-cols-2 gap-8 text-[14px]">
                  <div className="space-y-4">
                    <h4 className="text-[12px] font-bold text-gray-400 uppercase tracking-widest">机构信息</h4>
                    <div className="space-y-3">
                      <div className="flex justify-between border-b border-gray-50 pb-2">
                        <span className="text-gray-500">统一社会代码</span>
                        <span className="font-mono">{selectedEnt.code}</span>
                      </div>
                      <div className="flex justify-between border-b border-gray-50 pb-2">
                        <span className="text-gray-500">入驻模式</span>
                        <span>{selectedEnt.registrationMode === 'self_service' ? '自助申请' : '手动邀约'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">当前状态</span>
                        {getStatusBadge(selectedEnt.status)}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="text-[12px] font-bold text-gray-400 uppercase tracking-widest">联系人信息</h4>
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <User size={16} className="text-gray-300" />
                        <span>{selectedEnt.contactPerson?.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <Phone size={16} className="text-gray-300" />
                        <span>{selectedEnt.contactPerson?.phone}</span>
                      </div>
                      {selectedEnt.contactPerson?.email && (
                        <div className="flex items-center gap-3">
                          <Mail size={16} className="text-gray-300" />
                          <span>{selectedEnt.contactPerson?.email}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="pt-8 border-t border-gray-100 flex items-center justify-between gap-4">
                  <button 
                    onClick={() => deleteEnterprise(selectedEnt._id)}
                    className="px-6 py-2.5 text-red-600 font-medium hover:bg-red-50 rounded-xl transition-colors"
                  >
                    删除企业
                  </button>
                  
                  <div className="flex gap-3">
                    {selectedEnt.status === 'pending_approval' && (
                      <button 
                         onClick={() => updateStatus(selectedEnt._id, 'active')}
                         disabled={isSubmitting}
                         className="px-8 py-2.5 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 disabled:opacity-50 transition-all"
                      >
                        审核通过并启用
                      </button>
                    )}
                    {selectedEnt.status === 'active' && (
                      <button 
                        onClick={() => updateStatus(selectedEnt._id, 'disabled')}
                        disabled={isSubmitting}
                        className="px-8 py-2.5 bg-orange-500 text-white font-semibold rounded-xl hover:bg-orange-600 disabled:opacity-50 transition-all"
                      >
                        禁用账户
                      </button>
                    )}
                    {selectedEnt.status === 'disabled' && (
                       <button 
                        onClick={() => updateStatus(selectedEnt._id, 'active')}
                        disabled={isSubmitting}
                        className="px-8 py-2.5 bg-[#171717] text-white font-semibold rounded-xl hover:bg-black disabled:opacity-50 transition-all"
                      >
                        重新启用
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
