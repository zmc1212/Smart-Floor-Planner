'use client';

import React, { useState, useEffect } from 'react';
import Navbar from "@/components/Navbar";
import { Loader2, Phone, CheckCircle, Clock, User, MessageSquare, Plus, X } from "lucide-react";

export default function LeadsPage() {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [newNote, setNewNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const designers = ['张工 (主创)', '李工 (资深)', '王工 (经理)', '赵工 (顾问)'];

  const fetchLeads = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/leads');
      const data = await res.json();
      if (data.success) {
        setLeads(data.data);
        if (selectedLead) {
          const updated = data.data.find((l: any) => l._id === selectedLead._id);
          if (updated) setSelectedLead(updated);
        }
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

  const updateLead = async (id: string, updates: any) => {
    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      const data = await res.json();
      if (data.success) {
        fetchLeads();
      }
    } catch (err) {
      console.error('Failed to update lead:', err);
    }
  };

  const addFollowUp = async () => {
    if (!newNote.trim() || !selectedLead) return;
    setIsSubmitting(true);
    try {
      const records = [...(selectedLead.followUpRecords || []), {
        content: newNote,
        operator: '管理员',
        createdAt: new Date()
      }];
      
      const res = await fetch(`/api/leads/${selectedLead._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ followUpRecords: records })
      });
      const data = await res.json();
      if (data.success) {
        setNewNote('');
        fetchLeads();
      }
    } catch (err) {
      console.error('Failed to add follow-up:', err);
    } finally {
      setIsSubmitting(false);
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
              客资线索管理 CRM
            </h2>
            {!loading && (
              <span className="bg-[#f5f5f5] text-[#666] px-3 py-1 rounded-full text-[14px] font-medium">
                共 {leads.length} 条
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
                    <th className="p-4 text-[13px] font-semibold text-[#171717]">客户姓名</th>
                    <th className="p-4 text-[13px] font-semibold text-[#171717]">联系电话</th>
                    <th className="p-4 text-[13px] font-semibold text-[#171717]">指派设计师</th>
                    <th className="p-4 text-[13px] font-semibold text-[#171717]">状态</th>
                    <th className="p-4 text-[13px] font-semibold text-[#171717]">提交时间</th>
                    <th className="p-4 text-[13px] font-semibold text-[#171717]">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(0,0,0,0.08)]">
                  {leads.map((lead: any) => (
                    <tr key={lead._id} className="hover:bg-[#fcfcfc] transition-colors">
                      <td className="p-4">
                        <div className="text-[14px] font-medium text-[#171717]">{lead.name}</div>
                        <div className="text-[11px] text-gray-400 mt-1">{lead.source}</div>
                      </td>
                      <td className="p-4 text-[13px] text-[#666] font-mono">{lead.phone}</td>
                      <td className="p-4">
                         {lead.assignedTo ? (
                           <div className="flex items-center gap-1.5 text-[13px] text-gray-600">
                             <User size={14} className="text-gray-400" /> {lead.assignedTo}
                           </div>
                         ) : (
                           <span className="text-[12px] text-gray-300">未指派</span>
                         )}
                      </td>
                      <td className="p-4 text-[13px]">{getStatusBadge(lead.status)}</td>
                      <td className="p-4 text-[13px] text-[#666]">
                        {new Date(lead.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-4 text-right">
                        <button 
                          onClick={() => setSelectedLead(lead)}
                          className="px-4 py-1.5 bg-[#171717] text-white rounded-full text-[12px] font-medium hover:bg-black"
                        >
                          管理详情
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Lead Detail Modal */}
        {selectedLead && (
          <div className="fixed inset-0 z-[100] flex items-center justify-end">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSelectedLead(null)} />
            <div className="relative w-full max-w-lg h-full bg-white shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-300">
              <div className="p-8 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center text-xl font-bold">
                    {selectedLead.name[0]}
                  </div>
                  <div>
                    <h3 className="text-xl font-bold">{selectedLead.name}</h3>
                    <div className="text-sm text-gray-400">{selectedLead.phone}</div>
                  </div>
                </div>
                <button onClick={() => setSelectedLead(null)} className="p-2 hover:bg-gray-100 rounded-full"><X size={20} /></button>
              </div>

              <div className="p-8 space-y-8">
                {/* Status & Assignment */}
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[12px] font-semibold text-gray-400 uppercase tracking-wider">业务状态</label>
                    <select 
                      className="w-full p-2.5 bg-gray-50 border border-gray-100 rounded-xl text-[14px] outline-none"
                      value={selectedLead.status}
                      onChange={(e) => updateLead(selectedLead._id, { status: e.target.value })}
                    >
                      <option value="new">新线索</option>
                      <option value="contacted">已联系</option>
                      <option value="converted">已转化 (成单)</option>
                      <option value="closed">已关闭 (流失)</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[12px] font-semibold text-gray-400 uppercase tracking-wider">指派设计师</label>
                    <select 
                      className="w-full p-2.5 bg-gray-50 border border-gray-100 rounded-xl text-[14px] outline-none"
                      value={selectedLead.assignedTo || ''}
                      onChange={(e) => updateLead(selectedLead._id, { assignedTo: e.target.value })}
                    >
                      <option value="">待指派</option>
                      {designers.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                </div>

                {/* Details */}
                <div className="bg-gray-50 rounded-2xl p-6 space-y-4">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500">意向面积</span>
                    <span className="font-medium">{selectedLead.area || '-'} ㎡</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500">偏好风格</span>
                    <span className="font-medium">{selectedLead.stylePreference || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500">来源渠道</span>
                    <span className="font-medium">{selectedLead.source}</span>
                  </div>
                </div>

                {/* Follow up records */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
                    <MessageSquare size={16} /> 跟进记录
                  </div>
                  
                  <div className="space-y-4">
                    <div className="flex gap-3">
                      <input 
                        className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-black/5"
                        placeholder="添加一条更进记录..."
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                      />
                      <button 
                        onClick={addFollowUp}
                        disabled={isSubmitting || !newNote.trim()}
                        className="p-2.5 bg-[#171717] text-white rounded-xl hover:bg-black disabled:opacity-50"
                      >
                        <Plus size={20} />
                      </button>
                    </div>

                    <div className="space-y-4 mt-6">
                      {selectedLead.followUpRecords?.slice().reverse().map((record: any, idx: number) => (
                        <div key={idx} className="flex gap-3">
                          <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                          <div>
                            <div className="text-[13px] text-gray-800 leading-relaxed">{record.content}</div>
                            <div className="text-[11px] text-gray-400 mt-1">
                              {record.operator} · {new Date(record.createdAt).toLocaleString()}
                            </div>
                          </div>
                        </div>
                      ))}
                      {!selectedLead.followUpRecords?.length && (
                        <div className="text-center py-8 text-gray-300 text-sm">暂无跟进记录</div>
                      )}
                    </div>
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
