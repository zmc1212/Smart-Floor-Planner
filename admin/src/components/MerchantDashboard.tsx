'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, ClipboardList, Loader2, Map, Sparkles, Users } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

interface MerchantAdmin {
  displayName: string;
  username: string;
  role: string;
  enterpriseName: string | null;
}

interface DashboardState {
  leadCount: number;
  planCount: number;
  staffCount: number;
  latestLeads: any[];
  automationCards: Array<{ key: string; label: string; value: number }>;
  latestTodos: any[];
  overdueTodos: any[];
}

export default function MerchantDashboard({ admin }: { admin: MerchantAdmin }) {
  const [stats, setStats] = useState<DashboardState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMerchantStats = async () => {
      try {
        const [lRes, pRes, sRes, summaryRes, overdueRes] = await Promise.all([
          fetch('/api/leads'),
          fetch('/api/floorplans'),
          fetch('/api/staff'),
          fetch('/api/workbench/summary'),
          fetch('/api/workbench/todos?view=overdue'),
        ]);
        const lData = await lRes.json();
        const pData = await pRes.json();
        const sData = await sRes.json();
        const summaryData = await summaryRes.json();
        const overdueData = await overdueRes.json();

        setStats({
          leadCount: lData.data?.length || 0,
          planCount: pData.data?.length || 0,
          staffCount: sData.data?.length || 0,
          latestLeads: lData.data?.slice(0, 3) || [],
          automationCards: summaryData.success ? summaryData.data.cards || [] : [],
          latestTodos: summaryData.success ? summaryData.data.latestTodos || [] : [],
          overdueTodos: overdueData.success ? overdueData.data || [] : [],
        });
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchMerchantStats();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary" size={40} />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <StatCard title="待跟进线索" value={String(stats?.leadCount || 0)} icon={<ClipboardList size={20} />} color="bg-blue-500" detail="需要及时响应的意向客户" />
        <StatCard title="本司户型资产" value={String(stats?.planCount || 0)} icon={<Map size={20} />} color="bg-purple-500" detail="设计师创建的数字化户型" />
        <StatCard title="团队成员" value={String(stats?.staffCount || 0)} icon={<Users size={20} />} color="bg-orange-500" detail="当前活跃的设计师、地推与测量员" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-8">
        <section className="space-y-4">
          <div className="flex items-center justify-between px-2">
            <h3 className="text-lg font-bold">协作待办</h3>
            <Link href="/promotion-records" className="text-sm font-bold text-primary flex items-center gap-1 hover:underline">
              前往处理 <ArrowRight size={14} />
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {(stats?.automationCards || []).map((card) => (
              <div key={card.key} className="rounded-3xl border bg-white p-5 shadow-sm">
                <div className="text-[28px] font-black tracking-tight">{card.value}</div>
                <div className="mt-1 text-sm text-muted-foreground">{card.label}</div>
              </div>
            ))}
          </div>

          <div className="rounded-[32px] border bg-white p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold">最近待办</h4>
              <Badge variant="secondary">{stats?.latestTodos.length || 0} 条</Badge>
            </div>
            {(stats?.latestTodos || []).length > 0 ? (
              <div className="space-y-3">
                {stats?.latestTodos.map((todo: any) => (
                  <Link
                    href="/promotion-records"
                    key={todo.key}
                    className="block rounded-2xl border border-zinc-100 p-4 hover:border-primary/30 hover:bg-zinc-50 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="font-semibold text-sm">{todo.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{todo.enterpriseName} / {todo.contactPerson}</div>
                      </div>
                      <Badge variant={todo.overdue ? 'destructive' : 'secondary'}>
                        {todo.overdue ? '已超时' : '处理中'}
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl bg-zinc-50 py-10 text-center text-sm text-muted-foreground">当前没有新的协作待办</div>
            )}
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-[32px] border bg-white p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-500" />
                超时提醒
              </h4>
              <Badge variant="outline">{stats?.overdueTodos.length || 0} 条</Badge>
            </div>
            {(stats?.overdueTodos || []).length > 0 ? (
              <div className="space-y-3">
                {stats?.overdueTodos.slice(0, 4).map((todo: any) => (
                  <Link key={todo.key} href="/promotion-records" className="block rounded-2xl bg-amber-50 p-4 text-sm hover:bg-amber-100 transition-colors">
                    <div className="font-semibold text-amber-900">{todo.title}</div>
                    <div className="mt-1 text-amber-800/80">{todo.enterpriseName}</div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl bg-zinc-50 py-10 text-center text-sm text-muted-foreground">当前没有超时事项</div>
            )}
          </div>

          <div className="bg-gradient-to-br from-zinc-900 to-zinc-800 p-8 rounded-[32px] text-white space-y-6 shadow-2xl relative overflow-hidden group">
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-primary/20 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-1000" />
            <div className="w-12 h-12 bg-primary/20 rounded-2xl flex items-center justify-center">
              <Sparkles className="text-primary" />
            </div>
            <div className="space-y-2">
              <h4 className="text-xl font-bold italic tracking-tight">AI Style Generator</h4>
              <p className="text-sm text-zinc-400 leading-relaxed">一键为您的客户生成全屋 3D 渲染效果图，提升签单成功率。</p>
            </div>
            <Link href="/floorplans" className="w-full h-12 bg-white text-zinc-950 rounded-2xl flex items-center justify-center font-bold text-sm hover:bg-primary hover:text-white transition-all">
              开始生成
            </Link>
          </div>
        </section>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between px-2">
          <h3 className="text-lg font-bold">最近线索流转</h3>
          <Link href="/leads" className="text-sm font-bold text-primary flex items-center gap-1 hover:underline">
            查看全部 <ArrowRight size={14} />
          </Link>
        </div>
        <div className="space-y-3">
          {(stats?.latestLeads || []).map((lead: any) => (
            <div key={lead._id} className="bg-white p-5 rounded-2xl border border-muted shadow-sm hover:shadow-md transition-all flex items-center justify-between group">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center text-muted-foreground font-bold group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                  {lead.name?.[0] || '客'}
                </div>
                <div>
                  <p className="font-bold text-sm leading-none mb-1">{lead.name}</p>
                  <p className="text-xs text-muted-foreground">{lead.phone}</p>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div className="text-right hidden sm:block">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase mb-0.5">意向风格</p>
                  <p className="text-[12px] font-medium">{lead.stylePreference || '未设置'}</p>
                </div>
                <Badge className="bg-muted text-muted-foreground border-none font-bold text-[10px]">
                  {new Date(lead.createdAt).toLocaleDateString()}
                </Badge>
              </div>
            </div>
          ))}
          {(stats?.latestLeads || []).length === 0 && (
            <div className="py-20 text-center bg-muted/10 rounded-3xl border-2 border-dashed border-muted">
              <p className="text-muted-foreground font-medium">暂无最新线索</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  color,
  detail,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  color: string;
  detail: string;
}) {
  return (
    <Card className="rounded-[32px] border-muted shadow-sm hover:shadow-xl transition-all duration-300 group bg-white">
      <CardHeader className="flex flex-row items-center gap-4 p-6 pb-2">
        <div className={`h-12 w-12 rounded-2xl ${color} flex items-center justify-center text-white shadow-lg`}>{icon}</div>
        <h3 className="text-sm font-bold text-muted-foreground">{title}</h3>
      </CardHeader>
      <CardContent className="p-6 pt-2">
        <div className="text-[36px] font-black tracking-tight text-foreground">{value}</div>
        <p className="text-xs text-muted-foreground mt-2 font-medium opacity-60 group-hover:opacity-100 transition-opacity">{detail}</p>
      </CardContent>
    </Card>
  );
}
