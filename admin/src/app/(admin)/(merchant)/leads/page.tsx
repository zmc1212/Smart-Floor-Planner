'use client';

import React, { useState, useEffect } from 'react';
export const dynamic = 'force-dynamic';
import { Loader2, Phone, CheckCircle, Clock, User, MessageSquare, Plus, X, Search, Filter, Check, Share2 } from "lucide-react";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Building2 } from "lucide-react";

export default function LeadsPage() {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [newNote, setNewNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [staffMembers, setStaffMembers] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);

  // No local enterprise state needed, handled globally by auth + cookie

  const fetchCurrentUser = async () => {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      if (data.success) {
        setCurrentUser(data.data);
      }
    } catch (err) {
      console.error('Auth error:', err);
    }
  };

  // Helper to get staff display name from ID or Object
  const getStaffName = (idOrObj: any) => {
    if (!idOrObj) return null;
    
    // If it's already a populated object with the name, return it immediately
    if (typeof idOrObj === 'object') {
      const name = idOrObj.displayName || idOrObj.username;
      if (name) return name;
    }

    const targetId = String(typeof idOrObj === 'object' ? idOrObj._id : idOrObj);
    const s = staffMembers.find(member => String(member._id) === targetId);
    
    if (s) return s.displayName || s.username;
    
    // Diagnostic log if ID exists but not found in list
    if (targetId && staffMembers.length > 0 && targetId !== "unassigned") {
      console.warn(`[Leads] Staff ID not found in staffMembers list: ${targetId}`);
    }
    return null;
  };

  const getStatusLabel = (status: string) => {
    const statusMap: Record<string, string> = {
      'new': '新线索 (待处理)',
      'contacted': '已联系 (沟通中)',
      'measuring': '量房中 (上门测量)',
      'designing': '设计中 (方案制作)',
      'quoting': '报价中 (预结算)',
      'converted': '已转化 (签单成功)',
      'closed': '已关闭 (暂时流失)'
    };
    return statusMap[status] || status;
  };

  const [isSyncing, setIsSyncing] = useState<string | null>(null);
  const [syncSuccess, setSyncSuccess] = useState<string | null>(null);

  const handleSyncToWeCom = async (lead: any) => {
    if (!lead.wecomGroupId) {
      alert('该线索尚未关联企微群，请确保地推环节已正确录入并拉群。');
      return;
    }

    setIsSyncing(lead._id);
    try {
      const res = await fetch(`/api/leads/${lead._id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `【线索同步】系统为您推送了最新的客户需求：${lead.name}（${lead.communityName || '未知小区'}），请及时跟进。`
        })
      });
      const data = await res.json();
      if (data.success) {
        setSyncSuccess(lead._id);
        setTimeout(() => setSyncSuccess(null), 3000);
      } else {
        alert('同步失败: ' + (data.error || '接口异常'));
      }
    } catch (err) {
      console.error(err);
      alert('网络异常，无法同步至企微');
    } finally {
      setIsSyncing(null);
    }
  };

  const fetchLeads = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/leads`);
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

  const fetchStaff = async () => {
    try {
      const res = await fetch(`/api/staff`);
      const data = await res.json();
      if (data.success) {
        setStaffMembers(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch staff:', err);
    }
  };

  useEffect(() => {
    fetchCurrentUser();
  }, []);

  useEffect(() => {
    fetchLeads();
    fetchStaff();
  }, []);

  const updateLead = async (id: string, updates: any) => {
    // Optimistic update for the selected lead to make UI snappy
    if (selectedLead && id === selectedLead._id) {
      setSelectedLead({ ...selectedLead, ...updates });
    }

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
        return <Badge variant="secondary" className="bg-white text-blue-600 shadow-[0_0_0_1px_rgba(59,130,246,0.1)] hover:bg-blue-50/50 border-none font-medium px-2 py-0.5">新线索</Badge>;
      case 'contacted':
        return <Badge variant="secondary" className="bg-white text-amber-600 shadow-[0_0_0_1px_rgba(245,158,11,0.1)] hover:bg-amber-50/50 border-none font-medium px-2 py-0.5">已联系</Badge>;
      case 'measuring':
        return <Badge variant="secondary" className="bg-white text-purple-600 shadow-[0_0_0_1px_rgba(147,51,234,0.1)] hover:bg-purple-50/50 border-none font-medium px-2 py-0.5">量房中</Badge>;
      case 'designing':
        return <Badge variant="secondary" className="bg-white text-indigo-600 shadow-[0_0_0_1px_rgba(79,70,229,0.1)] hover:bg-indigo-50/50 border-none font-medium px-2 py-0.5">方案设计</Badge>;
      case 'quoting':
        return <Badge variant="secondary" className="bg-white text-orange-600 shadow-[0_0_0_1px_rgba(249,115,22,0.1)] hover:bg-orange-50/50 border-none font-medium px-2 py-0.5">报价中</Badge>;
      case 'converted':
        return <Badge variant="secondary" className="bg-[#171717] text-white hover:bg-[#171717]/90 border-none font-medium px-2 py-0.5">已转化</Badge>;
      case 'closed':
        return <Badge variant="outline" className="text-neutral-400 shadow-[0_0_0_1px_rgba(0,0,0,0.06)] border-none px-2 py-0.5 font-medium">已关闭</Badge>;
      default:
        return <Badge variant="outline" className="shadow-[0_0_0_1px_rgba(0,0,0,0.08)] border-none">{status}</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-white text-[#171717] font-sans">
      <main className="max-w-7xl mx-auto px-6 py-16">
        <div className="mb-12 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <h2 className="text-[32px] font-semibold tracking-[-1.5px] leading-tight">
              客资线索管理 CRM
            </h2>
            {!loading && (
              <span className="bg-[#fafafa] text-[#666] px-2.5 py-0.5 rounded-md text-[13px] font-medium shadow-[0_0_0_1px_rgba(0,0,0,0.08)]">
                {leads.length}
              </span>
            )}
          </div>

          {/* Enterprise Selector removed, now handled globally in Sidebar */}

          {leads.length === 0 && !loading && (
            <div className="bg-neutral-50 shadow-[0_0_0_1px_rgba(0,0,0,0.06)] p-4 rounded-xl text-sm text-neutral-600">
              提示：如果您是设计师或业务员，您只能看到正式指派给您的线索。只有企业负责人（Admin/Owner）可以看到全部新线索。
            </div>
          )}
        </div>

        {loading && (
          <div className="flex flex-col items-center justify-center py-24 text-[#808080]">
            <Loader2 className="animate-spin mb-4" size={32} />
            <p className="text-[14px]">正在获取线索数据...</p>
          </div>
        )}

        {!loading && (
          <div className="rounded-2xl overflow-hidden shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_2px_4px_rgba(0,0,0,0.02)]">
            <Table>
              <TableHeader className="bg-[#fafafa]">
                <TableRow className="hover:bg-transparent border-b shadow-[0_1px_0_0_rgba(0,0,0,0.04)]">
                  <TableHead className="w-[200px] text-[12px] font-medium text-neutral-500 py-4 px-6">客户姓名/小区</TableHead>
                  <TableHead className="text-[12px] font-medium text-neutral-500 py-4">联系电话</TableHead>
                  <TableHead className="text-[12px] font-medium text-neutral-500 py-4">渠道人员</TableHead>
                  <TableHead className="text-[12px] font-medium text-neutral-500 py-4">当前负责人</TableHead>
                  <TableHead className="text-[12px] font-medium text-neutral-500 py-4">业务状态</TableHead>
                  <TableHead className="text-[12px] font-medium text-neutral-500 py-4">提交日期</TableHead>
                  <TableHead className="text-right text-[12px] font-medium text-neutral-500 py-4 px-6">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead: any) => (
                  <TableRow key={lead._id} className="group hover:bg-neutral-50/50 transition-colors border-none shadow-[0_1px_0_0_rgba(0,0,0,0.04)]">
                    <TableCell className="py-5 px-6">
                      <div className="font-semibold text-[14px] text-neutral-900 leading-tight">{lead.name}</div>
                      <div className="text-[11px] font-medium text-neutral-400 mt-1 uppercase tracking-tight">{lead.communityName || '未记录小区'}</div>
                    </TableCell>
                    <TableCell className="font-mono text-[13px] text-neutral-600">{lead.phone}</TableCell>
                    <TableCell>
                       <div className="flex items-center gap-1.5 text-[13px] text-neutral-600">
                         <span className="opacity-40"><User size={12} /></span>
                         {getStaffName(lead.promoterId) || "系统录入"}
                       </div>
                    </TableCell>
                    <TableCell>
                       {lead.assignedTo ? (
                         <div className="flex items-center gap-1.5 text-[13px] text-neutral-900 font-medium">
                           <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                           {getStaffName(lead.assignedTo) || "未知人员"}
                         </div>
                       ) : (
                         <span className="text-[12px] text-neutral-400 italic">待指派</span>
                       )}
                    </TableCell>
                    <TableCell className="py-5">{getStatusBadge(lead.status)}</TableCell>
                    <TableCell className="text-[12px] text-neutral-400 font-medium">
                      {new Date(lead.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right py-5 px-6">
                      <div className="flex items-center justify-end gap-3">
                        <Button 
                          size="icon"
                          variant="ghost"
                          disabled={isSyncing === lead._id || !lead.wecomGroupId}
                          onClick={() => handleSyncToWeCom(lead)}
                          className={cn(
                            "h-8 w-8 rounded-lg transition-all duration-200",
                            syncSuccess === lead._id 
                              ? "bg-green-500 text-white hover:bg-green-600 shadow-lg shadow-green-500/20" 
                              : "text-neutral-400 hover:text-blue-600 hover:bg-blue-50/50"
                          )}
                        >
                          {isSyncing === lead._id ? <Loader2 size={14} className="animate-spin" /> : (syncSuccess === lead._id ? <Check size={14} /> : <Share2 size={14} />)}
                        </Button>
                        <Button 
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedLead(lead)}
                          className="h-8 text-[12px] rounded-lg font-medium text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100/80 shadow-[0_0_0_1px_rgba(0,0,0,0.06)] hover:shadow-[0_0_0_1px_rgba(0,0,0,0.1)] px-3"
                        >
                          管理
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {leads.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="h-48 text-center text-neutral-400 text-[13px]">
                      <div className="flex flex-col items-center gap-2">
                        <div className="w-10 h-10 rounded-full bg-neutral-50 flex items-center justify-center mb-2 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
                          <Clock size={16} className="opacity-20" />
                        </div>
                        暂无客资线索
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Lead Detail Sheet */}
        <Sheet open={!!selectedLead} onOpenChange={(open) => !open && setSelectedLead(null)}>
          <SheetContent className="sm:max-w-md p-0 overflow-hidden border-none shadow-2xl flex flex-col">
            {selectedLead && (
              <div className="flex flex-col h-full bg-white animate-in slide-in-from-right duration-500">
                <SheetHeader className="p-8 pb-6 bg-white shadow-[0_1px_0_0_rgba(0,0,0,0.04)]">
                  <div className="flex items-center gap-5">
                    <div className="w-14 h-14 bg-neutral-900 text-white rounded-2xl flex items-center justify-center text-xl font-bold shadow-xl shadow-neutral-200">
                      {selectedLead.name[0]}
                    </div>
                    <div className="text-left">
                      <SheetTitle className="text-2xl font-bold tracking-tight text-neutral-900">{selectedLead.name}</SheetTitle>
                      <SheetDescription className="font-mono text-[13px] text-neutral-400 mt-0.5">
                        {selectedLead.phone}
                      </SheetDescription>
                    </div>
                  </div>
                </SheetHeader>

                <div className="flex-1 overflow-y-auto p-8 space-y-10 scrollbar-hide">
                  {/* Status & Assignment */}
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2.5">
                      <label className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider ml-1">业务状态</label>
                      <Select 
                        value={selectedLead.status}
                        onValueChange={(val) => val && updateLead(selectedLead._id, { status: val })}
                      >
                        <SelectTrigger className="w-full h-11 rounded-xl bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.08)] border-none hover:shadow-[0_0_0_1px_rgba(0,0,0,0.12)] transition-shadow px-4">
                          <SelectValue>
                            <span className="text-[14px] font-medium">{getStatusLabel(selectedLead.status)}</span>
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="rounded-xl shadow-2xl border-none p-1">
                          <SelectItem value="new" className="rounded-lg">新线索 (待处理)</SelectItem>
                          <SelectItem value="contacted" className="rounded-lg">已联系 (沟通中)</SelectItem>
                          <SelectItem value="measuring" className="rounded-lg">量房中 (上门测量)</SelectItem>
                          <SelectItem value="designing" className="rounded-lg">设计中 (方案制作)</SelectItem>
                          <SelectItem value="quoting" className="rounded-lg">报价中 (预结算)</SelectItem>
                          <SelectItem value="converted" className="rounded-lg">已转化 (签单成功)</SelectItem>
                          <SelectItem value="closed" className="rounded-lg">已关闭 (暂时流失)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2.5">
                      <label className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider ml-1">当前负责人</label>
                      <Select 
                        value={selectedLead.assignedTo?._id || selectedLead.assignedTo || "unassigned"}
                        onValueChange={(val) => updateLead(selectedLead._id, { assignedTo: val === "unassigned" ? null : val })}
                      >
                        <SelectTrigger className="w-full h-11 rounded-xl bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.08)] border-none hover:shadow-[0_0_0_1px_rgba(0,0,0,0.12)] transition-shadow px-4">
                          <SelectValue placeholder="待指派">
                            <span className="text-[14px] font-medium">{getStaffName(selectedLead.assignedTo) || "待指派"}</span>
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="rounded-xl shadow-2xl border-none p-1">
                          <SelectItem value="unassigned" className="rounded-lg">待指派</SelectItem>
                          {staffMembers.map(s => (
                            <SelectItem key={s._id} value={s._id} className="rounded-lg">
                              {s.displayName || s.username}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Details */}
                  <div className="bg-neutral-50 rounded-2xl p-6 shadow-[0_0_0_1px_rgba(0,0,0,0.06)] space-y-4">
                    <div className="flex justify-between items-center text-[13px]">
                      <span className="text-neutral-400 font-medium">小区名称</span>
                      <span className="font-semibold text-neutral-900">{selectedLead.communityName || '-'}</span>
                    </div>
                    <div className="flex justify-between items-center text-[13px]">
                      <span className="text-neutral-400 font-medium">录入人员</span>
                      <span className="font-semibold text-neutral-900 flex items-center gap-1.5">
                        <span className="opacity-40"><User size={12} /></span>
                        {getStaffName(selectedLead.promoterId) || '系统'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[13px]">
                      <span className="text-neutral-400 font-medium">企微群聊</span>
                      <span className={cn(
                        "text-[10px] px-2 py-0.5 rounded-md font-bold shadow-[0_0_0_1px_rgba(0,0,0,0.06)]",
                        selectedLead.wecomGroupId ? "bg-green-50 text-green-600 shadow-green-100" : "bg-white text-neutral-400"
                      )}>
                        {selectedLead.wecomGroupId ? '已关联群聊' : '未关联群聊'}
                      </span>
                    </div>
                    <div className="h-px bg-neutral-200/50 my-2"></div>
                    <div className="flex justify-between items-center text-[13px]">
                      <span className="text-neutral-400 font-medium">意向面积</span>
                      <span className="font-semibold text-neutral-900">{selectedLead.area || '-'} ㎡</span>
                    </div>
                    <div className="flex justify-between items-center text-[13px]">
                      <span className="text-neutral-400 font-medium">偏好风格</span>
                      <span className="font-semibold text-neutral-900">{selectedLead.stylePreference || '-'}</span>
                    </div>
                    <div className="flex justify-between items-center text-[13px]">
                      <span className="text-neutral-400 font-medium">来源渠道</span>
                      <span className="font-medium text-[11px] bg-white px-2 py-0.5 rounded-md shadow-[0_0_0_1px_rgba(0,0,0,0.08)] text-neutral-600">{selectedLead.source}</span>
                    </div>
                  </div>

                  {/* Related Floor Plans */}
                  <RelatedFloorPlans floorPlans={selectedLead.floorPlanIds || []} />

                  {/* Follow up records */}
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[14px] font-bold tracking-tight text-neutral-900">
                        <MessageSquare size={16} className="text-neutral-400" /> 
                        跟进日志 
                      </div>
                      <span className="text-[11px] font-medium text-neutral-400 bg-neutral-50 px-2 py-0.5 rounded-md shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
                        {selectedLead.followUpRecords?.length || 0} 条记录
                      </span>
                    </div>
                    
                    <div className="space-y-6">
                      <div className="flex gap-2">
                        <Input 
                          placeholder="记录新的跟进动态..."
                          value={newNote}
                          onChange={(e) => setNewNote(e.target.value)}
                          className="h-11 rounded-xl bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.08)] border-none focus-visible:ring-2 focus-visible:ring-neutral-100 placeholder:text-neutral-300 text-[14px]"
                        />
                        <Button 
                          size="icon"
                          onClick={addFollowUp}
                          disabled={isSubmitting || !newNote.trim()}
                          className="h-11 w-11 shrink-0 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white shadow-lg shadow-neutral-200 transition-all active:scale-95"
                        >
                          <Plus size={18} />
                        </Button>
                      </div>
 
                      <div className="space-y-6 mt-8 relative before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-px before:bg-neutral-100">
                        {selectedLead.followUpRecords?.slice().reverse().map((record: any, idx: number) => (
                          <div key={idx} className="flex gap-5 relative">
                            <div className="mt-1.5 w-[15px] h-[15px] rounded-full bg-white shadow-[0_0_0_2px_#fff,0_0_0_3.5px_#f5f5f5] shrink-0 relative z-10 flex items-center justify-center">
                              <div className="w-1.5 h-1.5 rounded-full bg-neutral-400" />
                            </div>
                            <div className="flex-1 -mt-1 bg-neutral-50/50 p-4 rounded-2xl shadow-[0_0_0_1px_rgba(0,0,0,0.04)]">
                              <div className="text-[14px] text-neutral-800 leading-relaxed font-medium">{record.content}</div>
                              <div className="text-[11px] text-neutral-400 mt-3 flex items-center justify-between">
                                <div className="flex items-center gap-1.5 font-medium">
                                  <span className="opacity-40"><User size={10} /></span> 
                                  {record.operator} 
                                </div>
                                <div className="font-mono opacity-60">
                                  {new Date(record.createdAt).toLocaleString()}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                        {!selectedLead.followUpRecords?.length && (
                          <div className="text-center py-12 text-neutral-300 text-[12px] italic border border-dashed rounded-2xl border-neutral-100">暂无跟进记录</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </SheetContent>
        </Sheet>
      </main>
    </div>
  );
}

function RelatedFloorPlans({ floorPlans }: { floorPlans: any[] }) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-[14px] font-bold tracking-tight text-neutral-900">
        <Clock size={16} className="text-neutral-400" /> 
        实测户型档案 
        <span className="text-[11px] font-medium text-neutral-400 bg-neutral-50 px-2 py-0.5 rounded-md shadow-[0_0_0_1px_rgba(0,0,0,0.06)] ml-1">
          {floorPlans.length}
        </span>
      </div>
      
      <div className="grid grid-cols-1 gap-3">
        {floorPlans.length > 0 ? (
          floorPlans.map((plan) => (
            <div key={plan._id} className="flex items-center justify-between p-4 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.08)] rounded-xl hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] transition-all cursor-pointer group"
                 onClick={() => window.location.href = `/floorplans/${plan._id}`}>
              <div className="flex flex-col gap-1">
                <span className="text-[14px] font-semibold text-neutral-900 group-hover:text-blue-600 transition-colors">{plan.name}</span>
                <span className="text-[11px] text-neutral-400 font-medium flex items-center gap-1">
                  <Clock size={10} /> 测量于 {new Date(plan.createdAt).toLocaleDateString()}
                </span>
              </div>
              <Button size="sm" variant="ghost" className="h-8 text-[12px] rounded-lg bg-neutral-50 group-hover:bg-neutral-900 group-hover:text-white transition-all font-medium">查看详情</Button>
            </div>
          ))
        ) : (
          <div className="text-center py-8 text-neutral-300 text-[12px] border border-dashed rounded-2xl border-neutral-100 font-medium">
            暂无关联的实测记录
          </div>
        )}
      </div>
    </div>
  );
}

