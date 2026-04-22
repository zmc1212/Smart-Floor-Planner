import { cookies } from "next/headers";
import * as jose from 'jose';
import dbConnect from "@/lib/mongodb";
import { AdminUser } from "@/models/AdminUser";
import PlatformDashboard from "@/components/PlatformDashboard";
import MerchantDashboard from "@/components/MerchantDashboard";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  await dbConnect();
  
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token')?.value;

  if (!token) {
    redirect('/login');
  }

  const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback_secret_random_123');
  const { payload } = await jose.jwtVerify(token, secret);
  
  const admin = await AdminUser.findById(payload.id).populate('enterpriseId');
  if (!admin) {
    redirect('/login');
  }

  const isPlatformAdmin = admin.role === 'super_admin' || admin.role === 'admin';

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
              : `欢迎回来，${admin.displayName || admin.username}。这里是 ${admin.enterpriseId?.name || '个人'} 工作台。`}
          </p>
        </div>

        {isPlatformAdmin ? (
          <PlatformDashboard />
        ) : (
          <MerchantDashboard admin={JSON.parse(JSON.stringify(admin))} />
        )}
      </main>
    </div>
  );
}
