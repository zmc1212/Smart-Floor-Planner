import { headers } from 'next/headers';
import Sidebar from "@/components/Sidebar";
import { FetchInterceptor } from "@/components/FetchInterceptor";
import { AdminAntdProvider } from "@/components/admin/antd-provider";

function isCreationStudioPath(pathname: string) {
  return pathname === '/ai-studio/create'
    || pathname.startsWith('/ai-studio/create/')
    || pathname === '/ai-studio/scenarios'
    || pathname.startsWith('/ai-studio/scenarios/');
}

/**
 * Admin Layout — 保持为 Server Component。
 * Sidebar 自带 'use client'，不需要 Layout 级别客户端化。
 *
 * `/ai-studio/create` 与工作台共用 `/ai-studio` 前缀，必须放在同一路由组里，
 * 否则 Turbopack 只会注册其中一棵树，工作台会 404。创作台仍走无侧栏全屏壳。
 *
 * @see react-best-practices: server-serialization
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = (await headers()).get('x-admin-pathname') || '';
  if (isCreationStudioPath(pathname)) {
    return (
      <AdminAntdProvider>
        <div className="min-h-screen bg-zinc-100">
          <FetchInterceptor />
          {children}
        </div>
      </AdminAntdProvider>
    );
  }

  return (
    <AdminAntdProvider>
      <div className="flex min-h-screen bg-zinc-50/50">
        <FetchInterceptor />
        {/* Permanent sidebar on desktop, drawer on mobile is handled inside Sidebar component */}
        <Sidebar />

        {/* Main Content Area */}
        <main className="flex-1 flex min-w-0 flex-col">
          <div className="mt-14 flex-1 overflow-y-auto md:mt-0">
            {children}
          </div>
        </main>
      </div>
    </AdminAntdProvider>
  );
}
