'use client';

import Sidebar from "@/components/Sidebar";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-zinc-50/50">
      {/* Permanent sidebar on desktop, drawer on mobile is handled inside Sidebar component */}
      <Sidebar />
      
      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 mt-14 md:mt-0 overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
