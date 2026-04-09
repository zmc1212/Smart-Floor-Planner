'use client';
import { useState } from 'react';
import { Users, Map, Ruler, Settings, ChevronDown, ChevronUp } from "lucide-react";
import Link from 'next/link';

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
        <StatCard title="总用户数" value={initialUsers.length.toString()} icon={<Users size={20} />} trend="系统真实统计" />
        <StatCard title="图纸总数" value={initialPlans.length.toString()} icon={<Map size={20} />} trend="所有保存的户型" />
        <StatCard title="测量次数" value="--" icon={<Ruler size={20} />} trend="暂未统计" />
        <StatCard title="活跃设备" value="--" icon={<Settings size={20} />} trend="暂未接入硬件上报" />
      </div>

      <div className="mt-12 bg-white rounded-lg shadow-[0px_0px_0px_1px_rgba(0,0,0,0.08),0px_2px_2px_rgba(0,0,0,0.04)] ring-1 ring-[#fafafa] overflow-hidden">
        <div className="p-6 border-b border-[rgba(0,0,0,0.08)] flex justify-between items-center bg-[#fafafa]">
          <h3 className="text-[20px] font-semibold tracking-[-0.8px] text-[#171717]">用户档案与户型管理</h3>
        </div>
        
        <div className="divide-y divide-[rgba(0,0,0,0.08)]">
          {initialUsers.length === 0 ? (
             <div className="p-8 text-center text-[#666]">暂无注册用户</div>
          ) : (
            initialUsers.map(user => {
              const userPlans = initialPlans.filter(p => p.creator === user._id);
              const isExpanded = expandedUser === user._id;

              return (
                <div key={user._id} className="group flex flex-col transition-colors">
                  <div 
                    className="p-6 flex items-center justify-between cursor-pointer hover:bg-[#fcfcfc]"
                    onClick={() => toggleUser(user._id)}
                  >
                    <div className="flex items-center gap-4">
                      {user.avatar ? (
                        <img src={user.avatar} alt="avatar" className="w-12 h-12 rounded-full border border-[rgba(0,0,0,0.1)] object-cover" />
                      ) : (
                        <div className="bg-[#f5f5f5] w-12 h-12 rounded-full flex items-center justify-center text-[#666]">
                          <Users size={20} />
                        </div>
                      )}
                      <div>
                        <h4 className="text-[16px] font-semibold text-[#171717]">{user.nickname || '未命名用户'}</h4>
                        <div className="flex gap-4 mt-1 text-[13px] text-[#666]">
                          <span>小区: {user.communityName || '未设置'}</span>
                          <span>关联图纸: {userPlans.length} 份</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-[#808080]">
                      <span className="hidden lg:inline text-[12px] font-mono bg-[#f5f5f5] px-2 py-1 rounded text-[#888]">
                        OpenID: {user.openid || 'unknown'}
                      </span>
                      <Link 
                        href={`/users/${user.openid}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[13px] font-medium bg-[#171717] text-white px-4 py-1.5 rounded-[6px] hover:bg-black transition-all flex items-center gap-2"
                      >
                        <Map size={14} />
                        查看户型图
                      </Link>
                      <div className="ml-2">
                        {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="bg-[#fcfcfc] px-6 py-4 border-t border-[rgba(0,0,0,0.04)] shadow-inner">
                      <h5 className="text-[14px] font-medium text-[#171717] mb-4">该用户保存的户型图</h5>
                      {userPlans.length === 0 ? (
                        <p className="text-[13px] text-[#999] mb-2">该用户暂未保存任何图纸。</p>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {userPlans.map(plan => (
                            <Link href={`/floorplans/${plan._id}`} key={plan._id} className="bg-white p-4 rounded-md border border-[rgba(0,0,0,0.08)] hover:border-[#171717] hover:shadow-md transition-all block group/card">
                              <div className="flex justify-between items-start mb-2">
                                <span className="text-[14px] font-semibold text-[#171717] group-hover/card:text-[#000]">{plan.name}</span>
                                <span className="text-[11px] bg-[#d1fae5] text-[#10b981] px-2 py-0.5 rounded-full">{plan.status === 'completed' ? '已完成' : '草稿'}</span>
                              </div>
                              <div className="text-[12px] text-[#666] mb-3">
                                创建于: {new Date(plan.createdAt).toLocaleString()}
                              </div>
                              <div className="bg-[#fafafa] text-[#808080] text-[11px] p-2 rounded border border-[rgba(0,0,0,0.04)] font-mono truncate">
                                {plan.layoutData ? `包含 ${plan.layoutData.length} 个房间数据块` : '无节点数据'}
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

function StatCard({ title, value, icon, trend }: { title: string; value: string; icon: React.ReactNode; trend: string }) {
  return (
    <div className="bg-white rounded-lg p-6 flex flex-col justify-between shadow-[0px_0px_0px_1px_rgba(0,0,0,0.08),0px_2px_2px_rgba(0,0,0,0.04)] relative overflow-hidden group hover:shadow-[0px_0px_0px_1px_rgba(0,0,0,0.08),0px_4px_8px_rgba(0,0,0,0.04)] transition-all">
      <div className="absolute inset-0 ring-1 ring-inset ring-[#fafafa] pointer-events-none rounded-lg z-10" />
      <div className="flex justify-between items-start mb-4 relative z-20">
        <h3 className="text-[14px] font-medium text-[#666666]">{title}</h3>
        <div className="text-[#171717] opacity-60 group-hover:opacity-100 transition-opacity">{icon}</div>
      </div>
      <div className="relative z-20">
        <p className="text-[32px] font-semibold tracking-[-1.28px] text-[#171717] leading-none mb-2">{value}</p>
        <p className="text-[12px] text-[#808080]">{trend}</p>
      </div>
    </div>
  );
}
