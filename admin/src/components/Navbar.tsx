'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const pathname = usePathname();

  const getLinkClass = (path: string) => {
    return pathname === path
      ? "text-[14px] font-medium text-[#171717]"
      : "text-[14px] font-medium text-[#666666] hover:text-[#171717] transition-colors";
  };

  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b-[1px] border-[rgba(0,0,0,0.08)]">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <h1 className="text-[16px] font-semibold tracking-[-0.32px]">
            量房大师 管理后台
          </h1>
          <nav className="hidden md:flex gap-6">
            <Link href="/" className={getLinkClass("/")}>
              总览
            </Link>
            <Link href="/floorplans" className={getLinkClass("/floorplans")}>
              户型图
            </Link>
            <Link href="/records" className={getLinkClass("/records")}>
              测量记录
            </Link>
            <Link href="/users" className={getLinkClass("/users")}>
              用户列表
            </Link>
            <Link href="/devices" className={getLinkClass("/devices")}>
              设备管理
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <button className="text-[14px] font-medium text-[#4d4d4d] hover:text-[#171717] transition-colors">
            意见反馈
          </button>
          <div className="h-8 w-8 rounded-full bg-[#171717] text-white flex items-center justify-center text-[12px] font-semibold">
            管
          </div>
        </div>
      </div>
    </header>
  );
}
