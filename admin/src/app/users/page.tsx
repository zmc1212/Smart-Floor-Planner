'use client';

import React, { useState, useEffect } from 'react';
import Navbar from "@/components/Navbar";
import { Users, Loader2, ArrowLeft, Search, Building, Phone } from "lucide-react";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import Link from 'next/link';

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchUsers = async (search = '') => {
    setLoading(true);
    try {
      const url = search ? `/api/users?search=${encodeURIComponent(search)}` : '/api/users';
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        setUsers(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchUsers(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  return (
    <div className="min-h-screen bg-white text-[#171717] font-sans">
      <Navbar />
      <main className="max-w-7xl mx-auto px-6 py-12">
        <Link
          href="/"
          className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors mb-8 w-fit"
        >
          <ArrowLeft size={16} />
          <span className="text-sm font-medium">返回首页</span>
        </Link>

        <div className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <h2 className="text-[32px] font-bold tracking-tight mb-2">
              终端用户池
            </h2>
            <p className="text-muted-foreground text-sm flex items-center gap-2">
              <Users size={14} className="text-primary" /> 微信小程序注册的普通个人用户
            </p>
          </div>

          <div className="flex items-center gap-4 bg-muted/30 p-1.5 rounded-2xl border border-muted w-full md:w-[400px]">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
              <Input 
                 value={searchTerm} 
                 onChange={e => setSearchTerm(e.target.value)} 
                 placeholder="搜索昵称、手机号或小区..."
                 className="h-10 pl-10 bg-background border-none shadow-none rounded-xl"
              />
            </div>
            <div className="text-[11px] font-bold text-muted-foreground px-3 shrink-0">
               {users.length} 名活跃用户
            </div>
          </div>
        </div>

        {loading && users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-muted-foreground">
            <Loader2 className="animate-spin mb-4 opacity-20" size={48} />
            <p className="text-sm font-medium">正在深度检索系统用户数据...</p>
          </div>
        ) : (
          <div className="border rounded-[24px] overflow-hidden shadow-sm bg-white">
            <Table>
                <TableHeader className="bg-muted/50 border-b">
                  <TableRow className="hover:bg-transparent border-muted/50">
                    <th className="px-8 py-4 text-[13px] font-bold text-foreground">用户信息</th>
                    <th className="px-8 py-4 text-[13px] font-bold text-foreground">联系方式</th>
                    <th className="px-8 py-4 text-[13px] font-bold text-foreground">所属小区</th>
                    <th className="px-8 py-4 text-[13px] font-bold text-foreground">资产统计</th>
                    <th className="px-8 py-4 text-[13px] font-bold text-foreground">加入时间</th>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user: any) => (
                    <TableRow key={user._id} className="border-muted/50 hover:bg-muted/10 transition-colors">
                      <TableCell className="px-8 py-5">
                        <div className="flex items-center gap-4">
                          {user.avatar ? (
                            <img src={user.avatar} alt="avatar" className="w-12 h-12 rounded-[14px] border border-muted object-cover shadow-sm" />
                          ) : (
                            <div className="bg-muted w-12 h-12 rounded-[14px] flex items-center justify-center text-muted-foreground border border-dashed border-muted-foreground/30">
                              <Users size={20} />
                            </div>
                          )}
                          <div className="flex flex-col space-y-0.5">
                            <span className="text-[15px] font-bold text-foreground">{user.nickname || '微信用户'}</span>
                            <span className="text-[10px] text-muted-foreground font-mono bg-muted/50 px-1.5 py-0.5 rounded w-fit">{user.openid?.substring(0, 16)}...</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-8 py-5">
                         <div className="flex items-center gap-2 text-sm">
                           <Phone size={14} className="text-muted-foreground/60" />
                           {user.phone || <span className="opacity-20">-</span>}
                         </div>
                      </TableCell>
                      <TableCell className="px-8 py-5">
                         <div className="flex items-center gap-2 text-sm">
                           <Building size={14} className="text-muted-foreground/60" />
                           {user.communityName || <span className="opacity-20">暂未填写</span>}
                         </div>
                      </TableCell>
                      <TableCell className="px-8 py-5">
                         <Badge variant="secondary" className="bg-primary/5 text-primary border-none font-bold">
                            {user.planCount || 0} 个户型方案
                         </Badge>
                      </TableCell>
                      <TableCell className="px-8 py-5 text-[13px] text-muted-foreground">
                        {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              
              {users.length === 0 && !loading && (
                <div className="py-24 text-center">
                   <div className="bg-muted/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Users size={32} className="text-muted-foreground/30" />
                   </div>
                   <h3 className="text-lg font-bold text-foreground">未检索到任何用户</h3>
                   <p className="text-sm text-muted-foreground">您的检索词可能过于严苛，请尝试更换关键词</p>
                </div>
              )}
          </div>
        )}
      </main>
    </div>
  );
}
