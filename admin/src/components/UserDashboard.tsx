'use client';
import { useState } from 'react';
import { Users, Map, Ruler, Settings, ChevronDown, ChevronUp, ExternalLink, Calendar, Activity, Zap } from "lucide-react";
import Link from 'next/link';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function UserDashboard({ initialUsers, initialPlans }: { initialUsers: any[], initialPlans: any[] }) {
  const [expandedUser, setExpandedUser] = useState<string | null>(null);

  const toggleUser = (id: string) => {
    if (expandedUser === id) {
      setExpandedUser(null);
    } else {
      setExpandedUser(id);
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="累计用户" value={initialUsers.length.toString()} icon={<Users size={18} />} trend="+12% 较上周" detail="活跃微信生态用户" />
        <StatCard title="核心资产" value={initialPlans.length.toString()} icon={<Map size={18} />} trend="+8% 较上周" detail="保存的原始户型图数据" />
        <StatCard title="测绘效率" value="18m" icon={<Zap size={18} />} trend="平均耗时" detail="单套户型平均测绘时间" />
        <StatCard title="节点交互" value="1.2k" icon={<Activity size={18} />} trend="实时活跃" detail="当前硬件连接数与心跳" />
      </div>

      <div className="mt-12 bg-white rounded-[32px] border border-muted shadow-2xl shadow-primary/5 overflow-hidden">
        <div className="p-8 border-b border-muted flex justify-between items-center bg-muted/20">
          <div className="space-y-1">
            <h3 className="text-xl font-bold tracking-tight text-foreground">用户画像与数字化资产</h3>
            <p className="text-xs text-muted-foreground font-medium">穿透式查看终端用户的户型分布与状态</p>
          </div>
        </div>
        
        <div className="divide-y divide-muted/50">
          {initialUsers.length === 0 ? (
             <div className="p-16 text-center text-muted-foreground bg-muted/10 font-medium">
                暂无注册用户档案
             </div>
          ) : (
            initialUsers.map(user => {
              const userPlans = initialPlans.filter(p => p.creator === user._id);
              const isExpanded = expandedUser === user._id;

              return (
                <div key={user._id} className="group flex flex-col transition-all duration-300">
                  <div 
                    className="p-8 flex items-center justify-between cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => toggleUser(user._id)}
                  >
                    <div className="flex items-center gap-6">
                      <div className="relative">
                        {user.avatar ? (
                          <img src={user.avatar} alt="avatar" className="w-14 h-14 rounded-full border-2 border-white shadow-lg object-cover" />
                        ) : (
                          <div className="bg-muted w-14 h-14 rounded-full flex items-center justify-center text-muted-foreground shadow-inner">
                            <Users size={24} />
                          </div>
                        )}
                        <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 border-2 border-white rounded-full shadow-sm" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-3">
                          <h4 className="text-[17px] font-bold text-foreground leading-none">{user.nickname || '匿名房东'}</h4>
                          <Badge variant="outline" className="text-[10px] font-bold py-0 h-4 border-muted text-muted-foreground">微信用户</Badge>
                        </div>
                        <div className="flex gap-4 text-[13px] text-muted-foreground font-medium">
                          <span className="flex items-center gap-1">社区: <span className="text-foreground">{user.communityName || '未标明'}</span></span>
                          <span className="flex items-center gap-1">图纸: <span className="text-primary font-bold">{userPlans.length}</span></span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="hidden lg:flex flex-col items-end">
                        <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest opacity-50 mb-1">唯一身份标识</span>
                        <code className="text-[12px] bg-muted px-3 py-1 rounded-full text-muted-foreground font-mono">
                          {user.openid?.substring(0, 12)}...
                        </code>
                      </div>
                      <div className="flex items-center gap-3">
                        <Link 
                          href={`/users/${user.openid}`}
                          onClick={(e) => e.stopPropagation()}
                          className="h-10 px-5 bg-foreground text-background text-[13px] font-bold rounded-full hover:bg-primary hover:text-primary-foreground transition-all flex items-center gap-2 shadow-lg shadow-primary/5"
                        >
                          <Map size={14} />
                          管理户型
                        </Link>
                        <div className="p-2 text-muted-foreground/40 group-hover:text-foreground transition-colors">
                          {isExpanded ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
                        </div>
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="bg-muted/20 px-8 py-8 border-t border-muted/50 animate-in slide-in-from-top-2 duration-300">
                      <div className="flex items-center justify-between mb-8">
                        <h5 className="text-sm font-bold text-foreground flex items-center gap-2">
                           <Activity size={16} className="text-primary" />
                           关联数字资产 ({userPlans.length})
                        </h5>
                        <Button variant="link" className="text-xs font-bold text-muted-foreground p-0 h-auto">
                           全部导出为 JSON
                        </Button>
                      </div>
                      
                      {userPlans.length === 0 ? (
                        <div className="bg-white/50 p-8 rounded-[24px] border border-dashed border-muted text-center">
                           <p className="text-sm text-muted-foreground font-medium">该用户目前没有测绘记录</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                          {userPlans.map(plan => (
                            <Link href={`/floorplans/${plan._id}`} key={plan._id} className="relative bg-white p-6 rounded-[24px] border border-muted hover:border-primary/50 hover:shadow-xl transition-all block group/card overflow-hidden">
                              <div className="absolute top-0 left-0 w-1 h-full bg-primary/20 opacity-0 group-hover/card:opacity-100 transition-opacity" />
                              <div className="flex justify-between items-start mb-4">
                                <span className="text-sm font-bold text-foreground group-hover/card:text-primary transition-colors truncate pr-2">{plan.name}</span>
                                <Badge className={cn(
                                  "text-[9px] font-black px-1.5 py-0 rounded-[4px]",
                                  plan.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'
                                )}>
                                  {plan.status === 'completed' ? 'DONE' : 'WIP'}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-4 font-medium">
                                <Calendar size={12} />
                                {new Date(plan.createdAt).toLocaleDateString()}
                              </div>
                              <div className="bg-muted/30 p-2.5 rounded-xl border border-muted/20 font-mono text-[10px] text-muted-foreground/60 truncate group-hover/card:text-foreground transition-colors">
                                {plan.layoutData ? `${plan.layoutData.length}个节点 | 查看实时拓扑` : '无节点数据'}
                              </div>
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}

function StatCard({ title, value, icon, trend, detail }: { title: string; value: string; icon: React.ReactNode; trend: string; detail: string }) {
  return (
    <Card className="rounded-[28px] border-muted shadow-2xl shadow-primary/5 hover:shadow-primary/10 transition-all duration-500 group relative overflow-hidden bg-white">
      <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-700" />
      <CardHeader className="flex flex-row items-center justify-between space-y-0 p-6 pb-2 relative z-10">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground opacity-70 group-hover:opacity-100 transition-opacity">
          {title}
        </h3>
        <div className="h-10 w-10 rounded-2xl bg-muted/50 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-500 shadow-inner">
          {icon}
        </div>
      </CardHeader>
      <CardContent className="p-6 pt-2 relative z-10">
        <div className="text-[36px] font-black tracking-tighter leading-none mb-1 text-foreground group-hover:text-primary transition-colors">
          {value}
        </div>
        <div className="flex items-center gap-2 mt-4">
          <Badge variant="secondary" className="bg-primary/5 text-primary border-none text-[10px] font-black px-2 py-0 h-4">
             {trend}
          </Badge>
          <span className="text-[10px] text-muted-foreground font-bold truncate opacity-50">
             {detail}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
