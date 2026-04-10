'use client';

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { LogOut, User as UserIcon } from "lucide-react";

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [admin, setAdmin] = useState<any>(null);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.json())
      .then(data => {
        if (data.success) setAdmin(data.data);
      })
      .catch(err => console.error('Auth error:', err));
  }, []);

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

  const getLinkClass = (path: string) => {
    return pathname === path
      ? "text-[14px] font-medium text-[#171717]"
      : "text-[14px] font-medium text-[#666666] hover:text-[#171717] transition-colors";
  };

  const menuItems = [
    { key: 'dashboard', label: '总览', href: '/' },
    { key: 'floorplans', label: '户型图', href: '/floorplans' },
    { key: 'records', label: '测量记录', href: '/records' },
    { key: 'users', label: '用户列表', href: '/users' },
    { key: 'devices', label: '设备管理', href: '/devices' },
    { key: 'admins', label: '管理员', href: '/admins' },
  ];

  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b-[1px] border-[rgba(0,0,0,0.08)]">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <h1 className="text-[16px] font-semibold tracking-[-0.32px]">
            量房大师 管理后台
          </h1>
          <nav className="hidden md:flex gap-6">
            {admin?.effectivePermissions && menuItems.map(item => (
              admin.effectivePermissions.includes(item.key) && (
                <Link key={item.key} href={item.href} className={getLinkClass(item.href)}>
                  {item.label}
                </Link>
              )
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4 relative">
          <button className="hidden sm:block text-[14px] font-medium text-[#4d4d4d] hover:text-[#171717] transition-colors">
            意见反馈
          </button>
          
          <div className="relative">
            <button 
              onClick={() => setShowDropdown(!showDropdown)}
              className="h-8 w-8 rounded-full bg-[#171717] text-white flex items-center justify-center text-[12px] font-semibold hover:ring-4 hover:ring-gray-100 transition-all cursor-pointer overflow-hidden"
            >
              {admin?.displayName ? admin.displayName.substring(0, 1) : admin?.username ? admin.username.substring(0, 1).toUpperCase() : '管'}
            </button>

            {showDropdown && (
              <>
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setShowDropdown(false)}
                />
                <div className="absolute right-0 mt-3 w-56 bg-white rounded-2xl shadow-2xl border border-gray-100 py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="px-4 py-3 border-b border-gray-50 mb-1">
                    <p className="text-sm font-bold text-gray-900 truncate">{admin?.displayName || admin?.username || '管理员'}</p>
                    <p className="text-[11px] text-gray-400 font-medium truncate uppercase tracking-wider mt-0.5">{admin?.role === 'super_admin' ? '超级管理员' : '普通管理员'}</p>
                  </div>
                  
                  <Link 
                    href="/admins" 
                    className="flex items-center gap-2 px-4 py-2.5 text-[13px] text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
                    onClick={() => setShowDropdown(false)}
                  >
                    <UserIcon size={16} />
                    <span>个人信息</span>
                  </Link>

                  <button 
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-[13px] text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <LogOut size={16} />
                    <span>退出登录</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
