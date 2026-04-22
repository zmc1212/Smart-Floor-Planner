'use client';

import React, { useState, useEffect } from 'react';
import { Users, Map, Activity, Zap, Building2, ShieldCheck, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function PlatformDashboard() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch global stats
    const fetchStats = async () => {
      try {
        const [uRes, pRes, eRes] = await Promise.all([
          fetch('/api/users'),
          fetch('/api/floorplans'),
          fetch('/api/enterprises')
        ]);
        const uData = await uRes.json();
        const pData = await pRes.json();
        const eData = await eRes.json();

        setStats({
          userCount: uData.data?.length || 0,
          planCount: pData.data?.length || 0,
          enterpriseCount: eData.data?.length || 0,
          activeNodes: 1240, // Mock
        });
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary" size={40} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="全网用户" value={stats?.userCount.toString()} icon={<Users size={18} />} trend="+12%" detail="小程序端累计注册" />
        <StatCard title="资产总数" value={stats?.planCount.toString()} icon={<Map size={18} />} trend="+8%" detail="全局户型图纸数据" />
        <StatCard title="入驻企业" value={stats?.enterpriseCount.toString()} icon={<Building2 size={18} />} trend="+2" detail="活跃 B 端租户" />
        <StatCard title="系统节点" value={stats?.activeNodes.toString()} icon={<Zap size={18} />} trend="Stable" detail="实时硬件心跳" />
      </div>

      <div className="bg-zinc-950 text-white p-10 rounded-[32px] border border-zinc-800 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full -mr-32 -mt-32 blur-3xl" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
           <div className="space-y-2">
             <h3 className="text-2xl font-bold flex items-center gap-3">
               <ShieldCheck className="text-primary" /> 平台运维概览
             </h3>
             <p className="text-zinc-400 max-w-md">当前系统运行平稳。所有 B 端租户的接口响应延迟均在 150ms 以内。</p>
           </div>
           <div className="flex gap-4">
             <div className="bg-zinc-900 p-4 rounded-2xl border border-zinc-800 text-center min-w-[120px]">
                <p className="text-[10px] font-bold text-zinc-500 uppercase mb-1">API Health</p>
                <p className="text-xl font-black text-green-500">99.9%</p>
             </div>
             <div className="bg-zinc-900 p-4 rounded-2xl border border-zinc-800 text-center min-w-[120px]">
                <p className="text-[10px] font-bold text-zinc-500 uppercase mb-1">Resource</p>
                <p className="text-xl font-black text-primary">Normal</p>
             </div>
           </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, trend, detail }: { title: string; value: string; icon: React.ReactNode; trend: string; detail: string }) {
  return (
    <Card className="rounded-[28px] border-muted shadow-lg hover:shadow-xl transition-all duration-500 group relative overflow-hidden bg-white">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{title}</h3>
        <div className="h-10 w-10 rounded-2xl bg-muted flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-500">
          {icon}
        </div>
      </CardHeader>
      <CardContent className="p-6 pt-2">
        <div className="text-[32px] font-black tracking-tighter leading-none mb-1 text-foreground">{value}</div>
        <div className="flex items-center gap-2 mt-4 text-[10px] font-bold">
          <Badge className="bg-primary/5 text-primary border-none px-2 h-4">{trend}</Badge>
          <span className="text-muted-foreground opacity-50">{detail}</span>
        </div>
      </CardContent>
    </Card>
  );
}
