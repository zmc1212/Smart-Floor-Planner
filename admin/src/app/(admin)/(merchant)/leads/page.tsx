'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { notify } from '@/components/ui/operation-feedback';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, CheckCircle, Clock, User, MessageSquare, Plus, X } from "lucide-react";
import { Tabs } from "@/components/ui/tabs";
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
import { Pagination } from "@/components/ui/pagination";

export const dynamic = 'force-dynamic';

function getFloorPlanSourceLabel(source?: string) {
  if (source === 'kujiale') return '酷家乐';
  if (source === 'template') return '模板';
  return '手动';
}

function parseLayoutData(layoutData: any) {
  if (!layoutData) return null;
  if (typeof layoutData === 'string') {
    try {
      return JSON.parse(layoutData);
    } catch {
      return null;
    }
  }
  return layoutData;
}

function isFormalSurveyPlan(plan: any) {
  const layoutData = parseLayoutData(plan?.layoutData);
  return Boolean(
    layoutData &&
    typeof layoutData === 'object' &&
    !Array.isArray(layoutData) &&
    layoutData.version === 4 &&
    layoutData.measurementMode === 'surveying' &&
    layoutData.surveyGraph?.kind === 'survey-wall-graph'
  );
}

function getSurveyGraphStats(layoutData: any) {
  const parsed = parseLayoutData(layoutData);
  const draft = parsed?.surveyGraph;
  const floors = Array.isArray(draft?.floors) ? draft.floors : [];
  const activeFloor = floors.find((floor: any) => floor?.id === draft?.activeFloorId) || floors[0] || {};
  return {
    wallCount: Array.isArray(activeFloor.walls) ? activeFloor.walls.length : 0,
    spaceCount: Array.isArray(activeFloor.spaces) ? activeFloor.spaces.filter((space: any) => space?.closed).length : 0,
    openingCount: Array.isArray(activeFloor.openings) ? activeFloor.openings.length : 0,
  };
}

export default function LeadsPage() {
  const confirmAction = useConfirmDialog();
  const router = useRouter();
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [selectedLeadLoading, setSelectedLeadLoading] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [staffMembers, setStaffMembers] = useState<any[]>([]);
  const [activeStatus, setActiveStatus] = useState('all');
  const [pagination, setPagination] = useState<any>({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0
  });

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
      'new': '新线索',
      'measuring': '量房中',
      'measured': '量房完成',
      'assigned': '已指派设计师',
      'converted': '已转化 (签单)',
      'closed': '已关闭'
    };
    return statusMap[status] || status;
  };

  const fetchLeads = async (page = pagination.page) => {
    setLoading(true);
    try {
      let url = `/api/leads?page=${page}&limit=${pagination.limit}`;
      if (activeStatus && activeStatus !== 'all') {
        url += `&status=${activeStatus}`;
      }
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        setLeads(data.data);
        if (data.pagination) {
          setPagination(data.pagination);
        }
        if (selectedLead) {
          const updated = data.data.find((l: any) => l._id === selectedLead._id);
          if (updated) {
            setSelectedLead((current: any) => current ? {
              ...current,
              ...updated,
              floorPlanIds: current.floorPlanIds || updated.floorPlanIds,
              primaryFloorPlanId: current.primaryFloorPlanId || updated.primaryFloorPlanId,
            } : updated);
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch leads:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    fetchLeads(newPage);
  };

  const openLeadDetail = async (lead: any) => {
    setSelectedLead(lead);
    setSelectedLeadLoading(true);
    try {
      const res = await fetch(`/api/leads/${lead._id}`);
      const data = await res.json();
      if (data.success) {
        setSelectedLead(data.data);
      } else {
        notify.error('线索详情加载失败', { description: data.error || '请稍后重试' });
      }
    } catch (err) {
      console.error('Failed to fetch lead detail:', err);
      notify.error('线索详情加载失败', { description: '请检查网络或刷新重试' });
    } finally {
      setSelectedLeadLoading(false);
    }
  };

  const fetchStaff = async () => {
    try {
      // Only fetch staff with roles that can be assigned to leads
      const res = await fetch(`/api/staff?roles=designer,measurer,enterprise_admin`);
      const data = await res.json();
      if (data.success) {
        setStaffMembers(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch staff:', err);
    }
  };

  // @see react-best-practices: async-parallel — 并行化初始请求
  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchStaff();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchLeads(1); // Reset to page 1 when status changes
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStatus]);

  const updateLead = async (id: string, updates: any) => {
    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      const data = await res.json();
      if (data.success) {
        notify.success("操作成功", {
          description: updates.assignedTo ? "已成功指派负责人" : "线索信息已同步",
        });
        
        // Update the selected lead with the server-calculated fields (like status)
        if (selectedLead && id === selectedLead._id) {
          setSelectedLead(data.data);
          // If it was an assignment, close the sheet after a short delay
          if (updates.assignedTo) {
            setTimeout(() => setSelectedLead(null), 800);
          }
        }
        fetchLeads();
      } else {
        notify.error("操作失败", { description: data.error });
      }
    } catch (err) {
      console.error('Failed to update lead:', err);
      notify.error("系统错误", { description: "请检查网络或刷新重试" });
    }
  };

  const deleteLead = async (id: string) => {
    const confirmed = await confirmAction({
      title: '删除线索',
      description: '确定要删除该线索吗？此操作不可撤销。',
      confirmText: '删除',
      destructive: true,
    });
    if (!confirmed) return;
    
    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        notify.success("线索已删除");
        fetchLeads();
      } else {
        notify.error("删除失败", { description: data.error });
      }
    } catch (err) {
      console.error('Failed to delete lead:', err);
      notify.error("系统错误");
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
        return <Badge variant="secondary" className="border-0 bg-sky-50 px-2 py-0.5 font-medium text-sky-700 hover:bg-sky-100">新线索</Badge>;
      case 'measuring':
        return <Badge variant="secondary" className="border-0 bg-primary/10 px-2 py-0.5 font-medium text-primary hover:bg-primary/15">量房中</Badge>;
      case 'measured':
        return <Badge variant="secondary" className="border-0 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 hover:bg-emerald-100">量房完成</Badge>;
      case 'assigned':
        return <Badge variant="secondary" className="border-0 bg-blue-50 px-2 py-0.5 font-medium text-blue-700 hover:bg-blue-100">已指派设计师</Badge>;
      case 'converted':
        return <Badge variant="secondary" className="border-0 bg-amber-50 px-2 py-0.5 font-medium text-amber-700 hover:bg-amber-100">已转化</Badge>;
      case 'closed':
        return <Badge variant="secondary" className="border-0 bg-muted px-2 py-0.5 font-medium text-muted-foreground">已关闭</Badge>;
      default:
        return <Badge variant="outline" className="border-border text-muted-foreground">{status}</Badge>;
    }
  };

  return (
    <div className="admin-page-frame">
      <main className="w-full">
        <div className="mb-8 flex flex-col justify-between gap-5 border-b border-border pb-6 md:flex-row md:items-center">
          <div className="flex items-center gap-4">
            <h2 className="text-2xl font-semibold leading-tight text-foreground">
              客资线索管理 CRM
            </h2>
            {!loading && (
              <span className="rounded-md bg-muted px-2.5 py-1 text-sm font-medium text-muted-foreground">
                {pagination.total}
              </span>
            )}
          </div>

          {/* Enterprise Selector removed, now handled globally in Sidebar */}

          {leads.length === 0 && !loading && activeStatus === 'all' && (
            <div className="rounded-xl bg-primary/5 p-4 text-sm text-muted-foreground">
              提示：如果您是设计师或业务员，您只能看到正式指派给您的线索。只有企业负责人（Admin/Owner）可以看到全部新线索。
            </div>
          )}
        </div>

        {/* Status Tabs */}
        <div className="mb-6 overflow-x-auto pb-1">
          <Tabs
            activeTab={activeStatus}
            onChange={setActiveStatus}
            className="w-max"
            tabs={[
              { id: 'all', label: '全部' },
              { id: 'new', label: '新线索' },
              { id: 'measuring', label: '量房中' },
              { id: 'measured', label: '量房完成' },
              { id: 'assigned', label: '已指派' },
              { id: 'converted', label: '已转化' },
              { id: 'closed', label: '已关闭' }
            ]}
          />
        </div>

        {loading && (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="animate-spin mb-4" size={32} />
            <p className="text-sm">正在获取线索数据...</p>
          </div>
        )}

        {!loading && (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <Table className="min-w-[840px]">
              <TableHeader className="bg-muted/60">
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="w-[200px] px-5 py-4 text-xs font-semibold text-muted-foreground">客户姓名/小区</TableHead>
                  <TableHead className="py-4 text-xs font-semibold text-muted-foreground">联系电话</TableHead>
                  <TableHead className="hidden py-4 text-xs font-semibold text-muted-foreground lg:table-cell">渠道人员</TableHead>
                  <TableHead className="py-4 text-xs font-semibold text-muted-foreground">当前负责人</TableHead>
                  <TableHead className="py-4 text-xs font-semibold text-muted-foreground">业务状态</TableHead>
                  <TableHead className="hidden py-4 text-xs font-semibold text-muted-foreground xl:table-cell">提交日期</TableHead>
                  <TableHead className="px-5 py-4 text-right text-xs font-semibold text-muted-foreground">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead: any) => (
                  <TableRow key={lead._id} className="group border-border transition-colors hover:bg-primary/5">
                    <TableCell className="px-5 py-4">
                      <div className="text-sm font-semibold leading-tight text-foreground">{lead.name}</div>
                      <div className="mt-1 text-xs font-medium text-muted-foreground">{lead.communityName || '未记录小区'}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{lead.phone}</TableCell>
                    <TableCell className="hidden lg:table-cell">
                       <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                         <span className="opacity-50"><User size={12} /></span>
                         {getStaffName(lead.promoterId) || "系统录入"}
                       </div>
                    </TableCell>
                    <TableCell>
                       {lead.assignedTo ? (
                         <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                           <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                           {getStaffName(lead.assignedTo) || "未知人员"}
                         </div>
                       ) : (
                         <span className="text-xs text-muted-foreground">待指派</span>
                       )}
                    </TableCell>
                    <TableCell className="py-4">{getStatusBadge(lead.status)}</TableCell>
                    <TableCell className="hidden text-xs font-medium text-muted-foreground xl:table-cell">
                      {new Date(lead.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => router.push(`/ai-studio/scenarios?leadId=${lead._id}`)}
                          className="h-8 rounded-lg px-3 text-xs font-medium text-amber-700 hover:bg-amber-50 hover:text-amber-900"
                        >
                          {lead.floorPlanIds?.length || lead.followUpRecords?.length ? '查看方案' : '开始方案'}
                        </Button>
                        <Button 
                          size="icon"
                          variant="ghost"
                          aria-label={`删除线索 ${lead.name}`}
                          title="删除线索"
                          onClick={() => deleteLead(lead._id)}
                          className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <X size={14} />
                        </Button>
                        <Button 
                          size="sm"
                          variant="ghost"
                          onClick={() => openLeadDetail(lead)}
                          className="h-8 rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          管理
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {leads.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="h-48 text-center text-sm text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <Clock size={16} />
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

        {!loading && leads.length > 0 && (
          <Pagination
            total={pagination.total}
            page={pagination.page}
            limit={pagination.limit}
            totalPages={pagination.totalPages}
            onChange={handlePageChange}
          />
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
                  <div className="mt-5 flex gap-3">
                    <Button
                      className="rounded-xl bg-neutral-900 text-white hover:bg-neutral-800"
                      onClick={() => {
                        setSelectedLead(null);
                        router.push(`/ai-studio/scenarios?leadId=${selectedLead._id}`);
                      }}
                    >
                      {selectedLead.floorPlanIds?.length || selectedLead.followUpRecords?.length ? '查看方案' : '开始方案'}
                    </Button>
                  </div>
                </SheetHeader>

                <div className="flex-1 overflow-y-auto p-8 space-y-10 scrollbar-hide">
                  {/* Workflow Progress */}
                  <WorkflowProgress status={selectedLead.status} />

                  {/* Status & Assignment */}
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2.5">
                      <label className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider ml-1">业务状态</label>
                      <Select 
                        value={selectedLead.status}
                        disabled
                      >
                        <SelectTrigger className="w-full h-11 rounded-xl bg-neutral-50/50 shadow-[0_0_0_1px_rgba(0,0,0,0.06)] border-none px-4 opacity-100 cursor-default">
                          <SelectValue>
                            <span className="text-[14px] font-medium">{getStatusLabel(selectedLead.status)}</span>
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="rounded-xl shadow-2xl border-none p-1">
                          <SelectItem value={selectedLead.status} className="rounded-lg">{getStatusLabel(selectedLead.status)}</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] text-neutral-400 mt-1 px-1 italic">* 状态由业务流程自动更新</p>
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

                  {selectedLeadLoading && (
                    <div className="flex items-center gap-2 rounded-2xl bg-neutral-50 px-4 py-3 text-[12px] font-medium text-neutral-500 shadow-[0_0_0_1px_rgba(0,0,0,0.04)]">
                      <Loader2 size={14} className="animate-spin" />
                      正在加载小程序测绘数据...
                    </div>
                  )}

                  {/* Related Floor Plans */}
                  <RelatedFloorPlans
                    floorPlans={selectedLead.floorPlanIds || []}
                    primaryFloorPlanId={selectedLead.primaryFloorPlanId?._id || selectedLead.primaryFloorPlanId}
                  />

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

function WorkflowProgress({ status }: { status: string }) {
  const steps = [
    { key: 'new', label: '新线索' },
    { key: 'measuring', label: '量房中' },
    { key: 'measured', label: '量房完成' },
    { key: 'assigned', label: '方案设计' }, // "已指派设计师" context
    { key: 'converted', label: '已转化' }
  ];

  const currentIdx = steps.findIndex(s => s.key === status);
  const isClosed = status === 'closed';

  if (isClosed) {
    return (
      <div className="bg-neutral-50 rounded-2xl p-6 border border-dashed border-neutral-200 text-center">
        <span className="text-[13px] font-medium text-neutral-400">线索已关闭</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <label className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider">业务流程进度</label>
        <span className="text-[11px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">
          {currentIdx + 1} / {steps.length}
        </span>
      </div>
      
      <div className="relative flex justify-between">
        {/* Connection Line */}
        <div className="absolute top-[15px] left-0 right-0 h-[2px] bg-neutral-100 z-0 mx-6" />
        <div 
          className="absolute top-[15px] left-0 h-[2px] bg-blue-500 z-0 mx-6 transition-all duration-1000 ease-in-out" 
          style={{ width: `${Math.max(0, (currentIdx / (steps.length - 1)) * 100)}%`, marginLeft: '24px', marginRight: '24px' }}
        />

        {steps.map((step, idx) => {
          const isCompleted = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          return (
            <div key={step.key} className="relative z-10 flex flex-col items-center gap-2 group">
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300",
                isCompleted ? "bg-blue-500 text-white shadow-lg shadow-blue-100" :
                isCurrent ? "bg-white border-2 border-blue-500 text-blue-600 shadow-xl shadow-blue-50" :
                "bg-white border-2 border-neutral-100 text-neutral-300"
              )}>
                {isCompleted ? <CheckCircle size={16} /> : <span className="text-[12px] font-bold">{idx + 1}</span>}
              </div>
              <span className={cn(
                "text-[11px] font-bold transition-colors",
                isCurrent ? "text-neutral-900" : "text-neutral-400"
              )}>
                {step.label}
              </span>
              
              {isCurrent && (
                <div className="absolute -top-1 w-1 h-1 bg-blue-500 rounded-full animate-ping" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RelatedFloorPlans({ floorPlans, primaryFloorPlanId }: { floorPlans: any[]; primaryFloorPlanId?: string }) {
  const sortedFloorPlans = [...floorPlans].sort((a, b) => {
    if (primaryFloorPlanId && String(a._id) === String(primaryFloorPlanId)) return -1;
    if (primaryFloorPlanId && String(b._id) === String(primaryFloorPlanId)) return 1;
    return 0;
  });

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
        {sortedFloorPlans.length > 0 ? (
          sortedFloorPlans.map((plan) => {
            const isSurveying = isFormalSurveyPlan(plan);
            const stats = getSurveyGraphStats(plan.layoutData);
            return (
            <div key={plan._id} className="flex items-center justify-between p-4 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.08)] rounded-xl hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] transition-all cursor-pointer group"
                 onClick={() => window.location.href = `/floorplans/${plan._id}`}>
              <div className="flex flex-col gap-1">
                <span className="text-[14px] font-semibold text-neutral-900 group-hover:text-blue-600 transition-colors flex items-center gap-2">
                  {plan.name}
                  {primaryFloorPlanId && String(plan._id) === String(primaryFloorPlanId) && (
                    <Badge variant="secondary" className="bg-green-50 text-green-700 border-none">主户型</Badge>
                  )}
                  {isSurveying && (
                    <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-none">正式量房</Badge>
                  )}
                </span>
                <span className="text-[11px] text-neutral-400 font-medium flex items-center gap-1">
                  <Clock size={10} /> 测量于 {new Date(plan.createdAt).toLocaleDateString()}
                </span>
                <span className="text-[11px] text-blue-600 font-bold">
                  {isSurveying ? '正式量房' : getFloorPlanSourceLabel(plan.source)}
                  {plan.externalSource?.layoutLabel ? ` · ${plan.externalSource.layoutLabel}` : ''}
                </span>
                {isSurveying && (
                  <span className="text-[11px] font-medium text-neutral-500">
                    {stats.wallCount} 面墙 · {stats.spaceCount} 个空间 · {stats.openingCount} 个门窗
                  </span>
                )}
              </div>
              <Button size="sm" variant="ghost" className="h-8 text-[12px] rounded-lg bg-neutral-50 group-hover:bg-neutral-900 group-hover:text-white transition-all font-medium">查看详情</Button>
            </div>
            );
          })
        ) : (
          <div className="text-center py-8 text-neutral-300 text-[12px] border border-dashed rounded-2xl border-neutral-100 font-medium">
            暂无关联的实测记录
          </div>
        )}
      </div>
    </div>
  );
}

