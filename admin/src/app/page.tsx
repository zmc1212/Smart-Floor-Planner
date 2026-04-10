import Link from "next/link";
export const dynamic = "force-dynamic";
import dbConnect from "@/lib/mongodb";
import { User } from "@/models/User";
import { FloorPlan } from "@/models/FloorPlan";
import UserDashboard from "@/components/UserDashboard";
import Navbar from "@/components/Navbar";

export default async function Home() {
  // Fetch real data on the server
  await dbConnect();
  
  // Lean queries for performance, since we only need to pass them to a client component
  const users = await User.find({}).sort({ createdAt: -1 }).lean();
  const plans = await FloorPlan.find({}).sort({ createdAt: -1 }).lean();

  // Convert ObjectIds/Dates to strings for pure JSON serialization to Client Components
  const serializedUsers = users.map((u: any) => ({
    _id: u._id.toString(),
    openid: u.openid,
    nickname: u.nickname,
    avatar: u.avatar,
    communityName: u.communityName,
    createdAt: u.createdAt?.toISOString(),
  }));

  const serializedPlans = plans.map((p: any) => ({
    _id: p._id.toString(),
    name: p.name,
    creator: p.creator.toString(),
    layoutData: p.layoutData,
    status: p.status,
    createdAt: p.createdAt?.toISOString(),
  }));

  return (
    <div className="min-h-screen bg-white text-[#171717] font-sans selection:bg-[#ebebeb]">
      <Navbar />

      <main className="max-w-7xl mx-auto px-6 py-16">
        <div className="mb-12">
          <h2 className="text-[40px] font-semibold tracking-[-2.4px] leading-tight mb-4">
            数据大盘
          </h2>
          <p className="text-[20px] text-[#4d4d4d] font-normal leading-relaxed">
            随时管理量房大师的用户、户型与数据状态。
          </p>
        </div>

        {/* Client Component handling state */}
        <UserDashboard initialUsers={serializedUsers} initialPlans={serializedPlans} />

      </main>
    </div>
  );
}
