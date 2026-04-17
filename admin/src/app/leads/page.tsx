'use client';

import React, { useState, useEffect } from 'react';
import Navbar from "@/components/Navbar";
import { Loader2, Phone, CheckCircle, Clock } from "lucide-react";

export default function LeadsPage() {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLeads = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/leads');
      const data = await res.json();
      if (data.success) {
        setLeads(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch leads:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeads();
  }, []);

  const updateStatus = async (id: string, status: string) => {
    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      const data = await res.json();
      if (data.success) {
        fetchLeads(); // refresh
      }
    } catch (err) {
      console.error('Failed to update lead status:', err);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'new':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"><Clock size={12} /> 新线索</span>;
      case 'contacted':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800"><Phone size={12} /> 已联系</span>;
      case 'converted':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800"><CheckCircle size={12} /> 已转化</span>;
      case 'closed':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">已关闭</span>;
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
              客资线索
            </h2>
            {!loading && (
              <span className="bg-[#f5f5f5] text-[#666] px-3 py-1 rounded-full text-[14px] font-medium">
                共 {leads.length} 条线索
              </span>
            )}
          </div>
        </div>

        {loading && (
          <div className="flex flex-col items-center justify-center py-24 text-[#808080]">
            <Loader2 className="animate-spin mb-4" size={32} />
            <p className="text-[14px]">正在获取线索数据...</p>
          </div>
        )}

        {!loading && (
          <div className="bg-white rounded-lg shadow-[0px_0px_0px_1px_rgba(0,0,0,0.08),0px_2px_2px_rgba(0,0,0,0.04)] ring-1 ring-[#fafafa] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#fafafa] border-b border-[rgba(0,0,0,0.08)]">
                    <th className="p-4 text-[14px] font-semibold text-[#171717]">客户姓名</th>
                    <th className="p-4 text-[14px] font-semibold text-[#171717]">联系电话</th>
                    <th className="p-4 text-[14px] font-semibold text-[#171717]">意向面积</th>
                    <th className="p-4 text-[14px] font-semibold text-[#171717]">偏好风格</th>
                    <th className="p-4 text-[14px] font-semibold text-[#171717]">状态</th>
                    <th className="p-4 text-[14px] font-semibold text-[#171717]">提交时间</th>
                    <th className="p-4 text-[14px] font-semibold text-[#171717]">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(0,0,0,0.08)]">
                  {leads.map((lead: any) => (
                    <tr key={lead._id} className="hover:bg-[#fcfcfc] transition-colors">
                      <td className="p-4 text-[14px] font-medium text-[#171717]">{lead.name}</td>
                      <td className="p-4 text-[13px] text-[#666] font-mono">{lead.phone}</td>
                      <td className="p-4 text-[13px] text-[#666]">{lead.area ? `${lead.area} ㎡` : '-'}</td>
                      <td className="p-4 text-[13px] text-[#666]">{lead.stylePreference || '-'}</td>
                      <td className="p-4 text-[13px]">{getStatusBadge(lead.status)}</td>
                      <td className="p-4 text-[13px] text-[#666]">
                        {new Date(lead.createdAt).toLocaleString()}
                      </td>
                      <td className="p-4 flex gap-2">
                        {lead.status === 'new' && (
                          <button onClick={() => updateStatus(lead._id, 'contacted')} className="text-xs text-blue-600 hover:underline">
                            标为已联系
                          </button>
                        )}
                        {(lead.status === 'new' || lead.status === 'contacted') && (
                          <button onClick={() => updateStatus(lead._id, 'converted')} className="text-xs text-green-600 hover:underline">
                            标为已转化
                          </button>
                        )}
                        {lead.status !== 'closed' && lead.status !== 'converted' && (
                          <button onClick={() => updateStatus(lead._id, 'closed')} className="text-xs text-gray-500 hover:underline">
                            关闭
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {leads.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-12 text-center text-[#666] text-[14px]">
                        暂无线索数据
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
