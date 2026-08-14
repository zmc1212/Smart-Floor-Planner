'use client';

import React, { useState, useEffect, memo } from 'react';
import NextImage from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  Shield,
  Users, 
  Map, 
  Smartphone, 
  ClipboardList, 
  Coins,
  Sparkles, 
  UserSquare2, 
  UserCog, 
  Building2, 
  LogOut, 
  ChevronLeft, 
  Menu,
  ChevronRight,
  Ruler,
  Settings,
  Search,
  Cable,
  HardDrive,
  Image,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetTitle,
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
import { useBrowserNotification } from '@/hooks/useBrowserNotification';
import { isAdminRouteActive } from '@/config/admin-routes';

// --- Types ---
interface MenuItem {
  key: string;
  permissionKey?: string;
  label: string;
  icon: React.ElementType;
  href: string;
  newTab?: boolean;
  children?: MenuItem[];
}

interface MenuCategory {
  title: string;
  items: MenuItem[];
}

interface SidebarAdmin {
  role?: string;
  displayName?: string;
  username?: string;
  enterpriseId?: { name?: string };
  effectivePermissions?: string[];
}

interface SidebarEnterprise {
  _id: string;
  name: string;
}

// --- Static Config (hoisted outside component) ---
const MENU_CONFIG: Record<string, MenuCategory[]> = {
  platform: [
    {
      title: '平台管理中心',
      items: [
        { key: 'enterprises', label: '企业管理', icon: Building2, href: '/enterprises' },
        { key: 'ai-providers', label: 'AI 供应商', icon: Cable, href: '/ai-providers' },
        { key: 'ai-models', permissionKey: 'ai-providers', label: '生图模型', icon: Image, href: '/ai-models' },
        { key: 'media-storage', label: '媒体存储', icon: HardDrive, href: '/media-storage' },
        { key: 'ai-credit-prices', label: 'AI 点数价格', icon: Coins, href: '/ai-credit-prices' },
        { key: 'roles', label: '角色权限管理', icon: Shield, href: '/roles' },
        { key: 'admins', label: '系统管理', icon: UserCog, href: '/admins' },
        { key: 'users', label: '用户审计', icon: Users, href: '/users' },
      ]
    },
    {
      title: 'B2B 运营转化',
      items: [
        { key: 'promotion-records', label: '企业报备', icon: Building2, href: '/promotion-records' },
        { key: 'packages', label: '套餐管理', icon: ClipboardList, href: '/packages' },
        { key: 'workflow-logs', label: '通知记录', icon: ClipboardList, href: '/workflow-logs' },
        { key: 'enterprise-orders', label: '成交订单', icon: ClipboardList, href: '/enterprise-orders' },
        { key: 'commissions', label: '提成结算中心', icon: Coins, href: '/commissions' },
      ]
    }
  ],
  merchant: [
    {
      title: '运营工作台',
      items: [
        { key: 'dashboard', label: '业务概览', icon: LayoutDashboard, href: '/' },
        { key: 'leads', label: '线索转化', icon: ClipboardList, href: '/leads' },
      ]
    },
    {
      title: '户型图库',
      items: [
        { key: 'floorplans', label: '户型图库', icon: Map, href: '/floorplans' },
        { key: 'kujiale-floorplans', label: '酷家乐搜索', icon: Search, href: '/floorplans/kujiale' },
        { key: 'measurements', label: '量房记录', icon: Ruler, href: '/measurements' },
      ]
    },
    {
      title: 'AI 辅助设计',
      items: [
        { key: 'ai-create', permissionKey: 'ai-scenarios', label: 'AI 创作台', icon: Sparkles, href: '/ai-studio/create', newTab: true },
        { key: 'ai-scenarios', label: 'AI 设计', icon: Sparkles, href: '/ai-studio/scenarios' },
        { key: 'inspirations', label: '灵感方案', icon: Sparkles, href: '/inspirations' },
        { key: 'ai-presets', label: 'AI 预设配置', icon: Settings, href: '/ai-presets' },
      ]
    },
    {
      title: '团队资产管理',
      items: [
        { key: 'staff', label: '员工管理', icon: UserSquare2, href: '/staff' },
        { key: 'acquisition-commissions', label: '获客提成', icon: Coins, href: '/acquisition-commissions' },
        { key: 'devices', label: '设备管理', icon: Smartphone, href: '/devices' },
      ]
    }
  ]
};

// --- Extracted Memoized NavItem ---
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
      target={item.newTab ? '_blank' : undefined}
      rel={item.newTab ? 'noopener noreferrer' : undefined}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-200 group relative",
        isActive 
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      )}
      title={collapsed ? item.label : undefined}
    >
      {React.createElement(item.icon, { size: 18, className: cn("shrink-0 text-current opacity-80", isActive && "opacity-100") })}
      {!collapsed && (
        <span className="text-[14px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">
          {item.label}
        </span>
      )}
      {isActive && !collapsed && (
        <div className="absolute right-2 h-1.5 w-1.5 rounded-full bg-primary" />
      )}
    </Link>
  );
});

interface SidebarContentProps {
  collapsed: boolean;
  admin: SidebarAdmin | null;
  enterprises: SidebarEnterprise[];
  globalTenantId: string;
  handleTenantChange: (val: string) => void;
  handleLogout: () => void;
  pathname: string;
  hasMenuPermission: (key: string) => boolean;
}

const SidebarContent = memo(function SidebarContent({ 
  collapsed, 
  admin, 
  enterprises, 
  globalTenantId, 
  handleTenantChange, 
  handleLogout, 
  pathname,
  hasMenuPermission 
}: SidebarContentProps) {
  return (
    <div className="flex h-full flex-col border-r border-border bg-card text-foreground">
      {/* Header */}
      <div className={cn("h-16 flex items-center border-b border-border px-6 shrink-0", collapsed && "justify-center px-0")}>
        {!collapsed ? (
          <div className="flex w-full min-w-0 items-center gap-3">
            <div className="flex shrink-0 items-center gap-2">
              <NextImage
                src="/brand-logo.png"
                alt=""
                aria-hidden="true"
                width={28}
                height={28}
                className="shrink-0 rounded-lg"
              />
              <h1 className="text-sm font-semibold text-foreground">家客来</h1>
            </div>
            {(admin?.role === 'super_admin' || admin?.role === 'admin') && (
              <div className="min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
                <Select value={globalTenantId} onValueChange={handleTenantChange}>
                  <SelectTrigger className="h-8 w-full min-w-0 border-input bg-muted text-[11px] font-medium text-muted-foreground shadow-none transition-colors hover:text-foreground focus:ring-0">
                    <SelectValue placeholder="全局企业视图" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-border bg-popover text-popover-foreground shadow-lg">
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
          <NextImage
            src="/brand-logo.png"
            alt="家客来"
            width={32}
            height={32}
            className="rounded-lg"
          />
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-9 overflow-y-auto px-3 py-6 scrollbar-hide" aria-label="主导航">
        {/* Render Platform Menus */}
        {(admin?.role === 'super_admin' || admin?.role === 'admin' || admin?.role === 'salesperson') && MENU_CONFIG.platform.map((category) => {
          const visibleItems = category.items.filter(item => hasMenuPermission(item.permissionKey || item.key));
          if (visibleItems.length === 0) return null;

          return (
            <div key={category.title} className="space-y-3">
              {!collapsed && (
                <h2 className="px-3 text-[11px] font-bold text-muted-foreground">
                  {category.title}
                </h2>
              )}
              <div className="space-y-1">
                {visibleItems.map(item => (
                  <NavItem 
                    key={item.key} 
                    item={item} 
                    collapsed={collapsed}
                    isActive={isAdminRouteActive(pathname, item.href)}
                    hasPermission={hasMenuPermission(item.permissionKey || item.key)}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {/* Render Merchant Menus */}
        {MENU_CONFIG.merchant.map((category) => {
          const visibleItems = category.items.filter(item => hasMenuPermission(item.permissionKey || item.key));
          if (visibleItems.length === 0) return null;

          return (
            <div key={category.title} className="space-y-3">
              {!collapsed && (
                <h2 className="px-3 text-[11px] font-bold text-muted-foreground">
                  {category.title}
                </h2>
              )}
              <div className="space-y-1">
                {visibleItems.map(item => (
                  <NavItem 
                    key={item.key} 
                    item={item} 
                    collapsed={collapsed}
                    isActive={isAdminRouteActive(pathname, item.href)}
                    hasPermission={hasMenuPermission(item.permissionKey || item.key)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Footer Profile */}
      <div className="mt-auto space-y-2 border-t border-border bg-card p-3">
        <div className={cn(
          "flex items-center gap-3 rounded-lg border border-border bg-muted p-2",
          collapsed && "justify-center border-none bg-transparent p-1.5"
        )}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            {admin?.displayName ? admin.displayName[0] : (admin?.username ? admin.username[0].toUpperCase() : '?')}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold truncate leading-none mb-1">
                {admin?.displayName || admin?.username || 'Loading...'}
              </p>
              <div className="flex flex-col gap-0.5">
                <p className="text-[10px] font-bold text-muted-foreground">
                  {admin?.role === 'super_admin' ? '系统管理员' : 
                   admin?.role === 'enterprise_admin' ? '企业负责人' : 
                   admin?.role === 'salesperson' ? '渠道地推' :
                   admin?.role === 'measurer' ? '测量员' :
                   admin?.role === 'designer' ? '设计师' : '职员'}
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
            "group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive",
            collapsed && "justify-center px-0"
          )}
        >
          <LogOut size={16} className="shrink-0" />
          {!collapsed && <span className="text-[13px] font-medium">退出系统</span>}
        </button>
      </div>
    </div>
  );
});

export default function Sidebar() {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [enterprises, setEnterprises] = useState<SidebarEnterprise[]>([]);
  const [globalTenantId, setGlobalTenantId] = useState<string>('all');

  const { user: admin } = useCurrentUser();
  useBrowserNotification();

  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    const cookies = document.cookie.split('; ');
    const tenantCookie = cookies.find(row => row.startsWith('global_tenant_id='));
    const frame = window.requestAnimationFrame(() => {
      if (saved !== null) setIsCollapsed(saved === 'true');
      if (tenantCookie) setGlobalTenantId(tenantCookie.split('=')[1]);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

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
    document.cookie = `global_tenant_id=${value}; path=/; max-age=86400`;
    window.location.reload();
  };

  const toggleCollapse = () => {
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
        window.location.href = '/login';
      }
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const hasMenuPermission = (key: string) => {
    if (!admin) return true;
    if (key === 'media-storage') return admin.role === 'super_admin' || admin.role === 'admin';
    if (['ai-credit-prices', 'ai-presets', 'ai-providers'].includes(key) && (admin.role === 'super_admin' || admin.role === 'admin')) return true;
    if (admin.effectivePermissions?.includes(key)) return true;
    if (key === 'kujiale-floorplans' && admin.effectivePermissions?.includes('floorplans')) return true;
    if (
      key === 'ai-scenarios' &&
      ['ai-designer', 'ai-floorplan', 'ai-furnishing', 'ai-soft-furnishing']
        .some((permission) => admin.effectivePermissions?.includes(permission))
    ) return true;
    return false;
  };

  return (
    <>
      {/* Desktop Sidebar Container */}
      <aside 
        className={cn(
          "hidden md:flex flex-col h-screen sticky top-0 transition-all duration-300 ease-in-out shrink-0",
          isCollapsed ? "w-20" : "w-64"
        )}
      >
        <SidebarContent 
          collapsed={isCollapsed} 
          admin={admin}
          enterprises={enterprises}
          globalTenantId={globalTenantId}
          handleTenantChange={handleTenantChange}
          handleLogout={handleLogout}
          pathname={pathname}
          hasMenuPermission={hasMenuPermission}
        />
        
        {/* Collapse Toggle Button */}
        <button
          onClick={toggleCollapse}
          aria-label={isCollapsed ? '展开导航' : '收起导航'}
          title={isCollapsed ? '展开导航' : '收起导航'}
          className="absolute -right-3 top-20 z-50 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </aside>

      {/* Mobile Menu Trigger */}
      <div className="fixed top-0 left-0 right-0 z-40 flex h-14 items-center justify-between border-b border-border bg-card px-4 md:hidden">
        <div className="flex items-center gap-2">
          <NextImage src="/brand-logo.png" alt="" aria-hidden="true" width={28} height={28} className="rounded-lg" />
          <h1 className="text-sm font-bold">家客来</h1>
        </div>
        <Sheet>
          <SheetTrigger aria-label="打开导航菜单" className={cn(buttonVariants({ variant: "ghost", size: "icon-lg" }), "h-10 w-10 md:hidden")}>
            <Menu size={20} />
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-72 border-none">
            <SheetTitle className="sr-only">管理导航</SheetTitle>
            <SidebarContent 
              collapsed={false} 
              admin={admin}
              enterprises={enterprises}
              globalTenantId={globalTenantId}
              handleTenantChange={handleTenantChange}
              handleLogout={handleLogout}
              pathname={pathname}
              hasMenuPermission={hasMenuPermission}
            />
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
