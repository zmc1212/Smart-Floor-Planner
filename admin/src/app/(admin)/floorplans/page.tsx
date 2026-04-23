'use client';

import React, { useState, useEffect } from 'react';
import Link from "next/link";
import { Map, Loader2, ArrowLeft, Search, Calendar, Layers, User, Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function FloorPlansPage() {
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
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

  const fetchPlans = async (search = '') => {
    setLoading(true);
    try {
      let url = '/api/floorplans?';
      if (search) url += `search=${encodeURIComponent(search)}&`;
      
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        setPlans(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch floorplans:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCurrentUser();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchPlans(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  return (
    <div className="min-h-screen bg-white text-[#171717] font-sans">
      <main className="max-w-7xl mx-auto px-6 py-12">

        <div className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-1">
            <h2 className="text-[32px] font-bold tracking-tight">
              户型图资产库
            </h2>
            <div className="flex flex-col gap-3">
              <p className="text-muted-foreground text-sm flex items-center gap-2">
                 查看所有终端用户通过小程序现场测绘生成的原始数据
              </p>
              
              {/* Enterprise Selector removed, now handled globally in Sidebar */}
            </div>
          </div>
          
          <div className="flex items-center gap-4 bg-muted/30 p-1.5 rounded-2xl border border-muted w-full md:w-[400px]">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
              <Input 
                 value={searchTerm} 
                 onChange={e => setSearchTerm(e.target.value)} 
                 placeholder="输入户型或小区关键词查询..."
                 className="h-10 pl-10 bg-background border-none shadow-none rounded-xl"
              />
            </div>
            {!loading && (
              <div className="text-[11px] font-bold text-muted-foreground px-3 shrink-0">
                {plans.length} 份资产
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 text-muted-foreground">
            <Loader2 className="animate-spin mb-4" size={48} />
            <p className="text-sm font-medium">正在拉取加密户型数据...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {plans.map((plan: any) => (
              <Link 
                href={`/floorplans/${plan._id}`} 
                key={plan._id} 
                className="group bg-white p-8 rounded-[32px] border border-muted hover:border-primary/50 hover:shadow-2xl hover:shadow-primary/5 transition-all duration-300 relative overflow-hidden flex flex-col h-full"
              >
                <div className="flex justify-between items-start mb-8">
                  <div className="flex items-center gap-4">
                    <div className="bg-muted w-14 h-14 rounded-[20px] flex items-center justify-center text-muted-foreground group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-500 shadow-inner">
                      <Map size={24} />
                    </div>
                    <div className="overflow-hidden">
                      <h3 className="text-[18px] font-bold text-foreground group-hover:text-primary transition-colors truncate mb-1">{plan.name || '未命名项目'}</h3>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                         <User size={12} />
                         <span className="truncate">{plan.creator?.nickname || '匿名贡献者'}</span>
                      </div>
                    </div>
                  </div>
                  <Badge variant="secondary" className={cn(
                    "px-3 py-1 font-bold text-[10px] uppercase tracking-wider border-none",
                    plan.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'
                  )}>
                    {plan.status === 'completed' ? '已收录' : '测绘中'}
                  </Badge>
                </div>
                
                <div className="space-y-4 mb-8 flex-1">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-muted/30 p-4 rounded-2xl">
                       <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-50 mb-1">测绘深度</p>
                       <div className="flex items-center gap-2 font-bold text-sm">
                          <Layers size={14} className="text-primary/40" />
                          <span>{plan.layoutData?.length || 0} 个空间节点</span>
                       </div>
                    </div>
                    <div className="bg-muted/30 p-4 rounded-2xl">
                       <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-50 mb-1">存档日期</p>
                       <div className="flex items-center gap-2 font-bold text-sm">
                          <Calendar size={14} className="text-primary/40" />
                          <span>{plan.createdAt ? new Date(plan.createdAt).toLocaleDateString() : '-'}</span>
                       </div>
                    </div>
                  </div>
                </div>

                <div className="pt-6 border-t border-muted/50 flex items-center justify-between">
                  <span className="text-[13px] font-bold text-muted-foreground group-hover:text-primary transition-colors flex items-center gap-1">
                    进入测绘实验室 <ArrowLeft size={16} className="rotate-180" />
                  </span>
                  <div className="w-8 h-8 rounded-full border border-muted flex items-center justify-center text-muted-foreground group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary transition-all">
                     <ArrowLeft size={16} className="rotate-180" />
                  </div>
                </div>
              </Link>
            ))}
            
            {plans.length === 0 && (
              <div className="col-span-full py-32 text-center text-muted-foreground bg-muted/20 rounded-[40px] border-4 border-dashed border-muted/50">
                <div className="bg-muted w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                   <Map size={32} className="opacity-20" />
                </div>
                <h3 className="text-xl font-bold text-foreground mb-1">未发现匹配的户型资产</h3>
                <p>尝试简化您的关键词，或刷新页面重新拉取</p>
                {searchTerm && (
                  <Button 
                    variant="link"
                    onClick={() => setSearchTerm('')}
                    className="mt-4 font-bold text-primary"
                  >
                    重置所有筛选器
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
