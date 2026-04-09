import Link from "next/link";
import { LayoutDashboard, Users, Map, Ruler, Settings } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-white text-[#171717] font-sans selection:bg-[#ebebeb]">
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b-[1px] border-[rgba(0,0,0,0.08)]">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <h1 className="text-[16px] font-semibold tracking-[-0.32px]">
              fastMeasure Admin
            </h1>
            <nav className="hidden md:flex gap-6">
              <Link href="#" className="text-[14px] font-medium text-[#171717]">
                Overview
              </Link>
              <Link href="#" className="text-[14px] font-medium text-[#666666] hover:text-[#171717] transition-colors">
                Floor Plans
              </Link>
              <Link href="#" className="text-[14px] font-medium text-[#666666] hover:text-[#171717] transition-colors">
                Measurements
              </Link>
              <Link href="#" className="text-[14px] font-medium text-[#666666] hover:text-[#171717] transition-colors">
                Users
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <button className="text-[14px] font-medium text-[#4d4d4d] hover:text-[#171717] transition-colors">
              Feedback
            </button>
            <div className="h-8 w-8 rounded-full bg-[#171717] text-white flex items-center justify-center text-[12px] font-semibold">
              A
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-16">
        <div className="mb-12">
          <h2 className="text-[40px] font-semibold tracking-[-2.4px] leading-tight mb-4">
            Dashboard
          </h2>
          <p className="text-[20px] text-[#4d4d4d] font-normal leading-relaxed">
            Manage your fastMeasure data, users, and floor plans.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard title="Total Users" value="1,248" icon={<Users size={20} />} trend="+12% this week" />
          <StatCard title="Floor Plans" value="432" icon={<Map size={20} />} trend="+5% this week" />
          <StatCard title="Measurements" value="8,901" icon={<Ruler size={20} />} trend="+24% this week" />
          <StatCard title="Active Devices" value="54" icon={<Settings size={20} />} trend="Stable" />
        </div>

        <div className="mt-12 bg-white rounded-lg p-6 shadow-[0px_0px_0px_1px_rgba(0,0,0,0.08),0px_2px_2px_rgba(0,0,0,0.04)] ring-1 ring-[rgba(250,250,250,1)] inset-0">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-[24px] font-semibold tracking-[-0.96px]">Recent Activity</h3>
            <button className="text-[14px] font-medium bg-[#171717] text-white rounded-[6px] px-4 py-2 hover:bg-[#000000] transition-colors">
              View All
            </button>
          </div>
          <div className="divide-y divide-[rgba(0,0,0,0.08)]">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="py-4 flex justify-between items-center group">
                <div className="flex items-center gap-4">
                  <div className="bg-[#f5f5f5] w-10 h-10 rounded-full flex items-center justify-center text-[#666] group-hover:bg-[#171717] group-hover:text-white transition-colors">
                    <Map size={16} />
                  </div>
                  <div>
                    <h4 className="text-[14px] font-medium text-[#171717]">Floor Plan Created</h4>
                    <p className="text-[14px] text-[#666666]">User 1024 completed "Living Room Setup"</p>
                  </div>
                </div>
                <span className="text-[12px] text-[#808080] font-mono">2h ago</span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
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
