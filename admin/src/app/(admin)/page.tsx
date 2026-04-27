import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Loader2 } from "lucide-react";
import { getSessionUser } from "@/lib/session";
import PlatformDashboard from "@/components/PlatformDashboard";
import MerchantDashboard from "@/components/MerchantDashboard";

export const dynamic = "force-dynamic";

/**
 * 首页 — 使用 React.cache() 会话去重 + RSC 最小化序列化。
 * 
 * @see react-best-practices: server-cache-react, server-serialization, async-suspense-boundaries
 */
export default async function Home() {
  const user = await getSessionUser();

  if (!user) {
    redirect('/login');
  }

  const isPlatformAdmin = user.role === 'super_admin' || user.role === 'admin';

  return (
    <div className="min-h-screen bg-white text-[#171717] font-sans selection:bg-[#ebebeb]">
      <main className="max-w-7xl mx-auto px-6 py-12">
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-4">
             <div className="w-10 h-10 bg-primary rounded-2xl flex items-center justify-center text-primary-foreground font-black">
                {isPlatformAdmin ? 'P' : 'M'}
             </div>
             <h2 className="text-[32px] font-bold tracking-tight">
                {isPlatformAdmin ? '平台管理中心' : '企业工作台'}
             </h2>
          </div>
          <p className="text-[18px] text-muted-foreground font-medium">
            {isPlatformAdmin 
              ? '全局数据洞察与租户管理' 
              : `欢迎回来，${user.displayName}。这里是 ${user.enterpriseName || '个人'} 工作台。`}
          </p>
        </div>

        <Suspense fallback={
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-primary" size={40} />
          </div>
        }>
          {isPlatformAdmin ? (
            <PlatformDashboard />
          ) : (
            <MerchantDashboard admin={{
              displayName: user.displayName,
              username: user.username,
              role: user.role,
              enterpriseName: user.enterpriseName,
            }} />
          )}
        </Suspense>
      </main>
    </div>
  );
}
