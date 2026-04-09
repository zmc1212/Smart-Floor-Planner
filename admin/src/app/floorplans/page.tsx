import Link from "next/link";
import dbConnect from "@/lib/mongodb";
import { FloorPlan } from "@/models/FloorPlan";
import { User } from "@/models/User";
import Navbar from "@/components/Navbar";
import { Map } from "lucide-react";

export default async function FloorPlansPage() {
  await dbConnect();
  
  // Populate the creator to show who owns the plan
  const plans = await FloorPlan.find({}).populate({ path: 'creator', model: User }).sort({ createdAt: -1 }).lean();

  return (
    <div className="min-h-screen bg-white text-[#171717] font-sans">
      <Navbar />
      <main className="max-w-7xl mx-auto px-6 py-16">
        <div className="mb-12 flex items-center gap-4">
          <h2 className="text-[32px] font-semibold tracking-[-1.5px] leading-tight">
            户型图列表
          </h2>
          <span className="bg-[#f5f5f5] text-[#666] px-3 py-1 rounded-full text-[14px] font-medium">
            共 {plans.length} 份图纸
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {plans.map((plan: any) => (
            <Link 
              href={`/floorplans/${plan._id.toString()}`} 
              key={plan._id.toString()} 
              className="bg-white p-6 rounded-xl border border-[rgba(0,0,0,0.08)] hover:border-[#171717] hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] transition-all block group"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="bg-[#f5f5f5] w-10 h-10 rounded-md flex items-center justify-center text-[#171717]">
                    <Map size={20} />
                  </div>
                  <div>
                    <h3 className="text-[16px] font-semibold text-[#171717] group-hover:text-[#000]">{plan.name}</h3>
                    <p className="text-[12px] text-[#808080]">
                      {plan.creator?.nickname || '未知用户'}
                    </p>
                  </div>
                </div>
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${plan.status === 'completed' ? 'bg-[#d1fae5] text-[#10b981]' : 'bg-[#f3f4f6] text-[#6b7280]'}`}>
                  {plan.status === 'completed' ? '已完成' : '草稿'}
                </span>
              </div>
              
              <div className="space-y-2 mb-4">
                <div className="text-[13px] flex justify-between">
                  <span className="text-[#808080]">房间数量</span>
                  <span className="text-[#171717] font-medium">{plan.layoutData?.length || 0}</span>
                </div>
                <div className="text-[13px] flex justify-between">
                  <span className="text-[#808080]">创建时间</span>
                  <span className="text-[#171717]">{plan.createdAt ? new Date(plan.createdAt).toLocaleDateString() : '-'}</span>
                </div>
              </div>

              <div className="pt-4 border-t border-[rgba(0,0,0,0.04)] flex justify-end">
                <span className="text-[13px] font-medium text-[#171717] group-hover:underline">
                  查看详情 &rarr;
                </span>
              </div>
            </Link>
          ))}
          
          {plans.length === 0 && (
            <div className="col-span-full py-12 text-center text-[#666]">
              暂无任何户型图数据
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
