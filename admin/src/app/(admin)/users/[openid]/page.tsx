import { notFound } from 'next/navigation';
import Link from 'next/link';
export const dynamic = 'force-dynamic';
import dbConnect from '@/lib/mongodb';
import { User } from '@/models/User';
import { FloorPlan } from '@/models/FloorPlan';
import { Map, Calendar, Home } from 'lucide-react';
import BackButton from '@/components/BackButton';

export default async function UserFloorPlansPage({ params }: { params: Promise<{ openid: string }> }) {
  await dbConnect();
  const { openid } = await params;

  const user = await User.findOne({ openid }).lean();
  if (!user) return notFound();

  const plans = await FloorPlan.find({ creator: user._id }).sort({ createdAt: -1 }).lean();

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <header className="bg-white border-b border-[rgba(0,0,0,0.08)] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <BackButton fallbackPath="/users" />
            <h1 className="text-[16px] font-semibold text-[#171717]">用户户型图导出库</h1>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12">
        {/* User Profile Header */}
        <div className="bg-white rounded-xl p-8 border border-[rgba(0,0,0,0.08)] shadow-sm mb-10 flex items-center gap-8">
          {user.avatar ? (
             <img src={user.avatar as string} className="w-24 h-24 rounded-full border-2 border-white shadow-md object-cover" />
          ) : (
            <div className="w-24 h-24 rounded-full bg-[#f5f5f5] flex items-center justify-center text-[#999]">
               <Map size={40} />
            </div>
          )}
          <div className="flex-1">
            <h2 className="text-[32px] font-bold tracking-[-1.28px] text-[#171717] mb-2">{user.nickname || '未命名用户'}</h2>
            <div className="flex flex-wrap gap-6 text-[#666]">
              <div className="flex items-center gap-2">
                <Home size={16} />
                <span className="text-[14px]">绑定的社区: {user.communityName || '未设置'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Calendar size={16} />
                <span className="text-[14px]">注册日期: {user.createdAt ? new Date(user.createdAt as Date).toLocaleDateString() : '--'}</span>
              </div>
            </div>
          </div>
          <div className="text-right">
             <div className="text-[24px] font-bold text-[#171717]">{plans.length}</div>
             <div className="text-[12px] text-[#999] uppercase tracking-wider">个云端户型</div>
          </div>
        </div>

        <h3 className="text-[18px] font-semibold mb-6 flex items-center gap-2">
           <Map size={20} className="text-[#666]" />
           所有户型记录
        </h3>

        {plans.length === 0 ? (
          <div className="bg-white border border-dashed border-[rgba(0,0,0,0.1)] rounded-xl p-20 text-center">
             <p className="text-[#999] text-[15px]">该用户暂时还没有保存任何户型图数据。</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {plans.map((plan: any) => {
              // Extract rooms from layoutData
              let rooms = [];
              if (Array.isArray(plan.layoutData)) {
                rooms = plan.layoutData;
              } else if (plan.layoutData?.rooms && Array.isArray(plan.layoutData.rooms)) {
                rooms = plan.layoutData.rooms;
              }
              
              // If no rooms found, show the plan as a single item
              if (rooms.length === 0) {
                return (
                  <Link 
                    href={`/floorplans/${plan._id}`} 
                    key={plan._id.toString()}
                    className="bg-white border border-[rgba(0,0,0,0.08)] rounded-xl p-6 hover:border-[#171717] hover:shadow-lg transition-all group"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <h4 className="text-[16px] font-bold text-[#171717] group-hover:text-[#000] truncate max-w-[70%]">{plan.name}</h4>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${plan.status === 'completed' ? 'bg-[#d1fae5] text-[#10b981]' : 'bg-[#fef3c7] text-[#d97706]'}`}>
                        {plan.status === 'completed' ? '已完成' : '草稿'}
                      </span>
                    </div>
                    <div className="space-y-2 mb-6 text-[13px] text-[#666]">
                      <p className="flex justify-between">
                        <span>包含数据节点</span>
                        <span className="font-mono">{plan.layoutData?.length || 0} 个</span>
                      </p>
                      <p className="flex justify-between">
                        <span>最后同步时间</span>
                        <span className="font-mono">{new Date(plan.createdAt).toLocaleString()}</span>
                      </p>
                    </div>
                    <div className="pt-4 border-t border-[rgba(0,0,0,0.04)] flex justify-between items-center text-[12px] text-[#171717] font-medium">
                      <span>查看详情图纸</span>
                      <span className="opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                    </div>
                  </Link>
                );
              }
              
              // Show each room as a separate item
              return rooms.map((room: any) => (
                <Link 
                  href={`/floorplans/${plan._id}?roomId=${room.id}`} 
                  key={`${plan._id}-${room.id}`}
                  className="bg-white border border-[rgba(0,0,0,0.08)] rounded-xl p-6 hover:border-[#171717] hover:shadow-lg transition-all group"
                >
                  <div className="flex justify-between items-start mb-4">
                    <h4 className="text-[16px] font-bold text-[#171717] group-hover:text-[#000] truncate max-w-[70%]">{room.name || '未命名房间'}</h4>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${room.measured ? 'bg-[#d1fae5] text-[#10b981]' : 'bg-[#fef3c7] text-[#d97706]'}`}>
                      {room.measured ? '已测量' : '未测量'}
                    </span>
                  </div>
                  <div className="space-y-2 mb-6 text-[13px] text-[#666]">
                    <p className="flex justify-between">
                      <span>所属户型</span>
                      <span className="font-mono truncate max-w-[50%]">{plan.name}</span>
                    </p>
                    <p className="flex justify-between">
                      <span>最后同步时间</span>
                      <span className="font-mono">{new Date(plan.createdAt).toLocaleString()}</span>
                    </p>
                  </div>
                  <div className="pt-4 border-t border-[rgba(0,0,0,0.04)] flex justify-between items-center text-[12px] text-[#171717] font-medium">
                    <span>查看房间图纸</span>
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                  </div>
                </Link>
              ));
            })}
          </div>
        )}
      </main>
    </div>
  );
}
