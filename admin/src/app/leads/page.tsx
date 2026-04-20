'use client';

import React, { useState, useEffect } from 'react';
export const dynamic = 'force-dynamic';
import Navbar from "@/components/Navbar";
import { Loader2, Phone, CheckCircle, Clock, User, MessageSquare, Plus, X, Search, Filter } from "lucide-react";
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

export default function LeadsPage() {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [newNote, setNewNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [staffMembers, setStaffMembers] = useState<any[]>([]);

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

  const fetchStaff = async () => {
    try {
      const res = await fetch('/api/staff');
      const data = await res.json();
      if (data.success) {
        setStaffMembers(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch staff:', err);
    }
  };

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
        return <Badge variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-100/80 border-none">新线索</Badge>;
      case 'contacted':
        return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100/80 border-none">已联系</Badge>;
      case 'measuring':
        return <Badge variant="secondary" className="bg-purple-100 text-purple-800 hover:bg-purple-100/80 border-none">量房中</Badge>;
      case 'designing':
        return <Badge variant="secondary" className="bg-indigo-100 text-indigo-800 hover:bg-indigo-100/80 border-none">方案设计</Badge>;
      case 'quoting':
        return <Badge variant="secondary" className="bg-orange-100 text-orange-800 hover:bg-orange-100/80 border-none">报价中</Badge>;
      case 'converted':
        return <Badge variant="secondary" className="bg-green-100 text-green-800 hover:bg-green-100/80 border-none">已转化</Badge>;
      case 'closed':
        return <Badge variant="outline" className="text-gray-500 border-gray-200">已关闭</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
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
          {leads.length === 0 && !loading && (
            <div className="bg-yellow-50 border border-yellow-100 p-4 rounded-xl text-sm text-yellow-800">
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
          <div className="border rounded-2xl overflow-hidden shadow-sm">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-[200px]">客户姓名</TableHead>
                  <TableHead>联系电话</TableHead>
                  <TableHead>指派设计师</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>提交时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead: any) => (
                  <TableRow key={lead._id}>
                    <TableCell>
                      <div className="font-semibold text-sm">{lead.name}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{lead.source}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{lead.phone}</TableCell>
                    <TableCell className="py-4">
                       {lead.assignedTo ? (
                         <div className="flex items-center gap-1.5 text-xs">
                           <User size={12} className="text-muted-foreground" /> 
                           {getStaffName(lead.assignedTo) || (typeof lead.assignedTo === 'string' ? <span className="font-mono text-[10px] text-muted-foreground">{lead.assignedTo}</span> : "未知人员")}
                         </div>
                       ) : (
                         <span className="text-[11px] text-muted-foreground italic">未指派</span>
                       )}
                    </TableCell>
                    <TableCell>{getStatusBadge(lead.status)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(lead.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button 
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedLead(lead)}
                        className="h-8 text-xs rounded-full font-bold"
                      >
                        管理详情
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {leads.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      暂无客资线索
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Lead Detail Sheet */}
        <Sheet open={!!selectedLead} onOpenChange={(open) => !open && setSelectedLead(null)}>
          <SheetContent className="sm:max-w-md p-0 overflow-hidden border-none shadow-2xl">
            {selectedLead && (
              <div className="flex flex-col h-full bg-background animate-in slide-in-from-right duration-500">
                <SheetHeader className="p-8 pb-6 border-b bg-muted/20">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-background rounded-full flex items-center justify-center text-xl font-bold border shadow-sm">
                      {selectedLead.name[0]}
                    </div>
                    <div className="text-left">
                      <SheetTitle className="text-2xl font-bold">{selectedLead.name}</SheetTitle>
                      <SheetDescription className="font-mono text-xs">
                        {selectedLead.phone}
                      </SheetDescription>
                    </div>
                  </div>
                </SheetHeader>

                <div className="flex-1 overflow-y-auto p-8 space-y-8 scrollbar-none">
                  {/* Status & Assignment */}
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">业务状态</label>
                      <Select 
                        value={selectedLead.status}
                        onValueChange={(val) => val && updateLead(selectedLead._id, { status: val })}
                      >
                        <SelectTrigger className="w-full h-10 rounded-xl bg-muted/50 border-none shadow-none focus:ring-1 focus:ring-primary/20">
                          <SelectValue>
                            {getStatusLabel(selectedLead.status)}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="new">新线索 (待处理)</SelectItem>
                          <SelectItem value="contacted">已联系 (沟通中)</SelectItem>
                          <SelectItem value="measuring">量房中 (上门测量)</SelectItem>
                          <SelectItem value="designing">设计中 (方案制作)</SelectItem>
                          <SelectItem value="quoting">报价中 (预结算)</SelectItem>
                          <SelectItem value="converted">已转化 (签单成功)</SelectItem>
                          <SelectItem value="closed">已关闭 (暂时流失)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-3">
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">指派设计师</label>
                      <Select 
                        value={selectedLead.assignedTo?._id || selectedLead.assignedTo || "unassigned"}
                        onValueChange={(val) => updateLead(selectedLead._id, { assignedTo: val === "unassigned" ? null : val })}
                      >
                        <SelectTrigger className="w-full h-10 rounded-xl bg-muted/50 border-none shadow-none focus:ring-1 focus:ring-primary/20">
                          <SelectValue placeholder="待指派">
                            {getStaffName(selectedLead.assignedTo) || (selectedLead.assignedTo ? <span className="font-mono text-xs text-red-500">{typeof selectedLead.assignedTo === 'object' ? selectedLead.assignedTo._id : selectedLead.assignedTo}</span> : "待指派")}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned">待指派</SelectItem>
                          {staffMembers.map(s => (
                            <SelectItem key={s._id} value={s._id}>
                              {s.displayName || s.username}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {selectedLead.assignedAt && (
                        <div className="text-[10px] text-muted-foreground mt-1">
                          指派时间: {new Date(selectedLead.assignedAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Details */}
                  <div className="bg-muted/30 rounded-3xl p-6 border space-y-4">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">意向面积</span>
                      <span className="font-semibold">{selectedLead.area || '-'} ㎡</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">偏好风格</span>
                      <span className="font-semibold">{selectedLead.stylePreference || '-'}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">来源渠道</span>
                      <span className="font-semibold text-xs bg-background px-2 py-0.5 rounded-full border">{selectedLead.source}</span>
                    </div>
                  </div>

                  {/* Related Floor Plans */}
                  <RelatedFloorPlans phone={selectedLead.phone} />

                  {/* Follow up records */}
                  <div className="space-y-6">
                    <div className="flex items-center gap-2 text-sm font-bold tracking-tight">
                      <MessageSquare size={16} className="text-primary" /> 
                      跟进记录 
                      <Badge variant="outline" className="ml-1 px-1.5 h-4 text-[10px]">{selectedLead.followUpRecords?.length || 0}</Badge>
                    </div>
                    
                    <div className="space-y-4">
                      <div className="flex gap-2">
                        <Input 
                          placeholder="添加一条更进记录..."
                          value={newNote}
                          onChange={(e) => setNewNote(e.target.value)}
                          className="h-10 rounded-xl bg-muted/50 border-none focus-visible:ring-1"
                        />
                        <Button 
                          size="icon"
                          onClick={addFollowUp}
                          disabled={isSubmitting || !newNote.trim()}
                          className="h-10 w-10 shrink-0 rounded-xl"
                        >
                          <Plus size={18} />
                        </Button>
                      </div>

                      <div className="space-y-6 mt-8 relative before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-px before:bg-muted">
                        {selectedLead.followUpRecords?.slice().reverse().map((record: any, idx: number) => (
                          <div key={idx} className="flex gap-4 relative">
                            <div className="mt-1.5 w-3.5 h-3.5 rounded-full bg-background border-2 border-primary shrink-0 relative z-10" />
                            <div className="flex-1 -mt-0.5">
                              <div className="text-[13px] font-medium leading-relaxed">{record.content}</div>
                              <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2">
                                <User size={10} /> {record.operator} 
                                <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                                {new Date(record.createdAt).toLocaleString()}
                              </div>
                            </div>
                          </div>
                        ))}
                        {!selectedLead.followUpRecords?.length && (
                          <div className="text-center py-12 text-muted-foreground text-xs italic">暂无跟进记录</div>
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

function RelatedFloorPlans({ phone }: { phone: string }) {
  const [floorPlans, setFloorPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRelatedPlans = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/floorplans?phone=${phone}`);
        const data = await res.json();
        if (data.success) {
          setFloorPlans(data.data);
        }
      } catch (err) {
        console.error('Failed to fetch related plans:', err);
      } finally {
        setLoading(false);
      }
    };
    if (phone) fetchRelatedPlans();
  }, [phone]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-bold tracking-tight">
        <Clock size={16} className="text-primary" /> 
        关联实测记录 
        <Badge variant="outline" className="ml-1 px-1.5 h-4 text-[10px]">{floorPlans.length}</Badge>
      </div>
      
      <div className="space-y-2">
        {loading ? (
          <div className="text-xs text-muted-foreground animate-pulse">正在加载实测数据...</div>
        ) : floorPlans.length > 0 ? (
          floorPlans.map((plan) => (
            <div key={plan._id} className="flex items-center justify-between p-3 bg-muted/20 border rounded-xl hover:bg-muted/30 transition-colors cursor-pointer group"
                 onClick={() => window.location.href = `/floorplans?id=${plan._id}`}>
              <div className="flex flex-col">
                <span className="text-sm font-medium">{plan.name}</span>
                <span className="text-[10px] text-muted-foreground">测量日期: {new Date(plan.createdAt).toLocaleDateString()}</span>
              </div>
              <Button size="sm" variant="ghost" className="h-7 text-[11px] group-hover:bg-background">查看</Button>
            </div>
          ))
        ) : (
          <div className="text-center py-6 text-muted-foreground text-[11px] border border-dashed rounded-xl">
            暂无实测记录
          </div>
        )}
      </div>
    </div>
  );
}
