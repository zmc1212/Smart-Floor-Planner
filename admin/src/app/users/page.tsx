import dbConnect from "@/lib/mongodb";
import { User } from "@/models/User";
import { FloorPlan } from "@/models/FloorPlan";
import Navbar from "@/components/Navbar";
import { Users } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  await dbConnect();
  const users = await User.find({}).sort({ createdAt: -1 }).lean();
  const plans = await FloorPlan.find({}).lean();

  return (
    <div className="min-h-screen bg-white text-[#171717] font-sans">
      <Navbar />
      <main className="max-w-7xl mx-auto px-6 py-16">
        <div className="mb-12 flex items-center gap-4">
          <h2 className="text-[32px] font-semibold tracking-[-1.5px] leading-tight">
            用户列表
          </h2>
          <span className="bg-[#f5f5f5] text-[#666] px-3 py-1 rounded-full text-[14px] font-medium">
            共 {users.length} 名用户
          </span>
        </div>

        <div className="bg-white rounded-lg shadow-[0px_0px_0px_1px_rgba(0,0,0,0.08),0px_2px_2px_rgba(0,0,0,0.04)] ring-1 ring-[#fafafa] overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#fafafa] border-b border-[rgba(0,0,0,0.08)]">
                <th className="p-4 text-[14px] font-semibold text-[#171717]">用户</th>
                <th className="p-4 text-[14px] font-semibold text-[#171717]">手机号</th>
                <th className="p-4 text-[14px] font-semibold text-[#171717]">OpenID</th>
                <th className="p-4 text-[14px] font-semibold text-[#171717]">小区名称</th>
                <th className="p-4 text-[14px] font-semibold text-[#171717]">户型图数量</th>
                <th className="p-4 text-[14px] font-semibold text-[#171717]">注册时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(0,0,0,0.08)]">
              {users.map((user: any) => {
                const userPlansCount = plans.filter((p: any) => p.creator.toString() === user._id.toString()).length;
                return (
                  <tr key={user._id.toString()} className="hover:bg-[#fcfcfc] transition-colors">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        {user.avatar ? (
                          <img src={user.avatar} alt="avatar" className="w-10 h-10 rounded-full border border-[rgba(0,0,0,0.1)] object-cover" />
                        ) : (
                          <div className="bg-[#f5f5f5] w-10 h-10 rounded-full flex items-center justify-center text-[#666]">
                            <Users size={18} />
                          </div>
                        )}
                        <span className="text-[14px] font-medium text-[#171717]">{user.nickname || '未命名用户'}</span>
                      </div>
                    </td>
                    <td className="p-4 text-[13px] text-[#666]">{user.phone || '-'}</td>
                    <td className="p-4 text-[13px] text-[#666] font-mono">{user.openid}</td>
                    <td className="p-4 text-[13px] text-[#666]">{user.communityName || '-'}</td>
                    <td className="p-4 text-[13px] text-[#666]">{userPlansCount} 份</td>
                    <td className="p-4 text-[13px] text-[#666]">
                      {user.createdAt ? new Date(user.createdAt).toLocaleString() : '-'}
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-[#666] text-[14px]">
                    暂无注册用户
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
