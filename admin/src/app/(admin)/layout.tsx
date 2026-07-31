import Sidebar from "@/components/Sidebar";
import { FetchInterceptor } from "@/components/FetchInterceptor";
import { AdminAntdProvider } from "@/components/admin/antd-provider";

/**
 * Admin Layout — 保持为 Server Component。
 * Sidebar 自带 'use client'，不需要 Layout 级别客户端化。
 * 
 * @see react-best-practices: server-serialization
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-zinc-50/50">
      <FetchInterceptor />
      {/* Permanent sidebar on desktop, drawer on mobile is handled inside Sidebar component */}
      <Sidebar />
      
      {/* Main Content Area */}
      <AdminAntdProvider>
        <main className="flex-1 flex min-w-0 flex-col">
          <div className="mt-14 flex-1 overflow-y-auto md:mt-0">
            {children}
          </div>
        </main>
      </AdminAntdProvider>
    </div>
  );
}
