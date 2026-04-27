'use client';

import React, { useState, useEffect, memo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { 
  LayoutDashboard, 
  Users, 
  Map, 
  Smartphone, 
  ClipboardList, 
  Sparkles, 
  UserSquare2, 
  UserCog, 
  Building2, 
  LogOut, 
  ChevronLeft, 
  Menu,
  ChevronRight,
  PenTool,
  Palette,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCurrentUser } from '@/hooks/useCurrentUser';

// --- Types ---
interface MenuItem {
  key: string;
  label: string;
  icon: React.ElementType;
  href: string;
  children?: MenuItem[];
}

interface MenuCategory {
  title: string;
  items: MenuItem[];
}

// --- Static Config (hoisted outside component) ---
// @see react-best-practices: rendering-hoist-jsx
const MENU_CONFIG: Record<string, MenuCategory[]> = {
  platform: [
    {
      title: '平台管理',
      items: [
        { key: 'enterprises', label: '企业管理', icon: Building2, href: '/enterprises' },
        { key: 'admins', label: '系统管理', icon: UserCog, href: '/admins' },
        { key: 'users', label: '用户审计', icon: Users, href: '/users' },
      ]
    }
  ],
  merchant: [
    {
      title: '运营工作台',
      items: [
        { key: 'dashboard', label: '概览', icon: LayoutDashboard, href: '/' },
        { key: 'leads', label: '线索转化', icon: ClipboardList, href: '/leads' },
      ]
    },
    {
      title: '户型与灵感',
      items: [
        { key: 'floorplans', label: '户型图库', icon: Map, href: '/floorplans' },
      ]
    },
    {
      title: 'AI 工作台',
      items: [
        { key: 'ai-floorplan', label: 'AI 室内平面', icon: PenTool, href: '/ai-studio/floor-plan' },
        { key: 'ai-furnishing', label: 'AI 软装设计', icon: Palette, href: '/ai-studio/furnishing' },
        { key: 'inspirations', label: '灵感方案', icon: Sparkles, href: '/inspirations' },
      ]
    },
    {
      title: '团队与资产',
      items: [
        { key: 'staff', label: '员工管理', icon: UserSquare2, href: '/staff' },
        { key: 'devices', label: '设备管理', icon: Smartphone, href: '/devices' },
      ]
    }
  ]
};

// --- Extracted Memoized NavItem ---
// @see react-best-practices: rerender-memo
const NavItem = memo(function NavItem({ 
  item, 
  collapsed, 
  isActive, 
  hasPermission 
}: { 
  item: MenuItem; 
  collapsed: boolean; 
  isActive: boolean;
  hasPermission: boolean;
}) {
  if (!hasPermission) return null;

  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 group relative",
        isActive 
          ? "bg-white/10 text-white shadow-sm" 
          : "text-zinc-400 hover:text-zinc-100 hover:bg-white/5"
      )}
      title={collapsed ? item.label : undefined}
    >
      {React.createElement(item.icon as any, { size: 20, className: cn("shrink-0", isActive ? "text-white" : "group-hover:text-gray-900") })}
      {!collapsed && (
        <span className="text-[14px] font-medium tracking-tight whitespace-nowrap overflow-hidden text-ellipsis">
          {item.label}
        </span>
      )}
      {isActive && !collapsed && (
        <div className="absolute right-2 w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
      )}
    </Link>
  );
});

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [enterprises, setEnterprises] = useState<any[]>([]);
  const [globalTenantId, setGlobalTenantId] = useState<string>('all');

  // @see react-best-practices: client-swr-dedup
  const { user: admin } = useCurrentUser();

  useEffect(() => {
    // Load collapse state from local storage
    // @see react-best-practices: rerender-lazy-state-init (minor: localStorage read)
    const saved = localStorage.getItem('sidebar-collapsed');
    if (saved !== null) setIsCollapsed(saved === 'true');
      
    // Load initial global tenant id from cookie
    const cookies = document.cookie.split('; ');
    const tenantCookie = cookies.find(row => row.startsWith('global_tenant_id='));
    if (tenantCookie) {
      setGlobalTenantId(tenantCookie.split('=')[1]);
    }
  }, []);

  // Fetch enterprises only when admin is a super_admin (parallel with user fetch via SWR)
  useEffect(() => {
    if (admin && (admin.role === 'super_admin' || admin.role === 'admin')) {
      fetch('/api/admin/enterprises')
        .then(res => res.json())
        .then(data => {
          if (data.success) setEnterprises(data.data);
        })
        .catch(err => console.error('Enterprises fetch error:', err));
    }
  }, [admin]);

  const handleTenantChange = (value: string) => {
    setGlobalTenantId(value);
    document.cookie = `global_tenant_id=${value}; path=/; max-age=86400`; // 1 day
    router.refresh();
  };

  const toggleCollapse = () => {
    // @see react-best-practices: rerender-functional-setstate
    setIsCollapsed(prev => {
      const newState = !prev;
      localStorage.setItem('sidebar-collapsed', String(newState));
      return newState;
    });
  };

  const handleLogout = async () => {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (res.ok) {
        router.push('/login');
        router.refresh();
      }
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const SidebarContent = ({ collapsed }: { collapsed: boolean }) => (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-100 border-r border-zinc-800">
      {/* Header */}
      <div className={cn("h-16 flex items-center px-6 border-b border-zinc-800 shrink-0", collapsed && "px-0 justify-center")}>
        {!collapsed ? (
          <div className="flex flex-col">
            <h1 className="text-[15px] font-bold tracking-[-0.5px] uppercase">
              Smart Floor <span className="text-zinc-500">Planner</span>
            </h1>
            {(admin?.role === 'super_admin' || admin?.role === 'admin') && (
              <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                <Select value={globalTenantId} onValueChange={handleTenantChange}>
                  <SelectTrigger className="h-7 min-w-[180px] bg-zinc-900 border-zinc-800 text-xs font-medium focus:ring-0 shadow-none text-zinc-300">
                    <SelectValue placeholder="全局企业视图" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-zinc-800 bg-zinc-950 text-zinc-300 shadow-2xl">
                    <SelectItem value="all" className="rounded-lg text-xs font-bold text-primary">-- 所有企业 --</SelectItem>
                    {enterprises.map(ent => (
                      <SelectItem key={ent._id} value={ent._id} className="rounded-lg text-xs">
                        {ent.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        ) : (
          <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-zinc-950 font-black text-sm">
            S
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-6 px-3 space-y-8 scrollbar-hide">
        {/* Render Platform Menus - Only for super_admin/admin */}
        {(admin?.role === 'super_admin' || admin?.role === 'admin') && MENU_CONFIG.platform.map((category) => {
          const visibleItems = category.items.filter(item => !admin || admin.effectivePermissions?.includes(item.key));
          if (visibleItems.length === 0) return null;

          return (
            <div key={category.title} className="space-y-2 border-l-2 border-primary/20 ml-1">
              {!collapsed && (
                <h2 className="px-3 text-[10px] font-bold text-primary uppercase tracking-[0.1em] mb-2 opacity-70">
                  {category.title}
                </h2>
              )}
              <div className="space-y-1">
                {visibleItems.map(item => (
                  <NavItem 
                    key={item.key} 
                    item={item} 
                    collapsed={collapsed}
                    isActive={pathname === item.href}
                    hasPermission={!admin || admin.effectivePermissions?.includes(item.key)}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {/* Render Merchant Menus */}
        {MENU_CONFIG.merchant.map((category) => {
          const visibleItems = category.items.filter(item => !admin || admin.effectivePermissions?.includes(item.key));
          if (visibleItems.length === 0) return null;

          return (
            <div key={category.title} className="space-y-2">
              {!collapsed && (
                <h2 className="px-3 text-[10px] font-bold text-zinc-500 uppercase tracking-[0.1em] mb-2">
                  {category.title}
                </h2>
              )}
              <div className="space-y-1">
                {visibleItems.map(item => (
                  <NavItem 
                    key={item.key} 
                    item={item} 
                    collapsed={collapsed}
                    isActive={pathname === item.href}
                    hasPermission={!admin || admin.effectivePermissions?.includes(item.key)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer Profile */}
      <div className="mt-auto border-t border-zinc-800 p-3 space-y-2">
        <div className={cn(
          "flex items-center gap-3 p-2 rounded-xl bg-zinc-900/50 border border-zinc-800/50",
          collapsed && "justify-center p-1.5 border-none bg-transparent"
        )}>
          <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-zinc-950 font-bold shrink-0">
            {admin?.displayName ? admin.displayName[0] : (admin?.username ? admin.username[0].toUpperCase() : '?')}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold truncate leading-none mb-1">
                {admin?.displayName || admin?.username || 'Loading...'}
              </p>
              <div className="flex flex-col gap-0.5">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">
                  {admin?.role === 'super_admin' ? 'System Root' : (admin?.role === 'enterprise_admin' ? 'Manager' : 'Staff')}
                </p>
                {admin?.enterpriseId?.name && (
                  <p className="text-[9px] text-primary font-bold truncate opacity-80">
                    @{admin.enterpriseId.name}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
        
        <button 
          onClick={handleLogout}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2 text-zinc-500 hover:text-red-400 hover:bg-red-400/5 rounded-lg transition-colors group",
            collapsed && "justify-center px-0"
          )}
        >
          <LogOut size={18} className="shrink-0" />
          {!collapsed && <span className="text-[13px] font-medium">退出系统</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar Container */}
      <aside 
        className={cn(
          "hidden md:flex flex-col h-screen sticky top-0 transition-all duration-300 ease-in-out shrink-0",
          isCollapsed ? "w-20" : "w-64"
        )}
      >
        <SidebarContent collapsed={isCollapsed} />
        
        {/* Collapse Toggle Button */}
        <button
          onClick={toggleCollapse}
          className="absolute -right-3 top-20 w-6 h-6 bg-zinc-800 border border-zinc-700 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-700 transition-all z-50 shadow-lg"
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </aside>

      {/* Mobile Menu Trigger (Sticky Header on Mobile) */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-white border-b px-4 flex items-center justify-between z-40">
        <h1 className="text-sm font-bold tracking-tight">QUANTUM PLANNER</h1>
        <Sheet>
          <SheetTrigger className={cn(buttonVariants({ variant: "ghost", size: "icon-lg" }), "h-10 w-10 md:hidden")}>
            <Menu size={20} />
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-72 border-none">
            <SidebarContent collapsed={false} />
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
