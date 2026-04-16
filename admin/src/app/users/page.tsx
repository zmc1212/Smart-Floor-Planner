'use client';

import React, { useState, useEffect } from 'react';
import Navbar from "@/components/Navbar";
import SearchInput from "@/components/SearchInput";
import { Users, Loader2 } from "lucide-react";

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
      <main className="max-w-7xl mx-auto px-6 py-16">
        <div className="mb-12 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <h2 className="text-[32px] font-semibold tracking-[-1.5px] leading-tight">
              用户列表
            </h2>
            {!loading && (
              <span className="bg-[#f5f5f5] text-[#666] px-3 py-1 rounded-full text-[14px] font-medium">
                共 {users.length} 名用户
              </span>
            )}
          </div>

          <SearchInput 
            value={searchTerm} 
            onChange={setSearchTerm} 
            placeholder="搜索昵称、手机号或小区..."
            className="w-full md:w-80"
          />
        </div>

        {loading && (
          <div className="flex flex-col items-center justify-center py-24 text-[#808080]">
            <Loader2 className="animate-spin mb-4" size={32} />
            <p className="text-[14px]">正在获取用户数据...</p>
          </div>
        )}

        {!loading && (
          <div className="bg-white rounded-lg shadow-[0px_0px_0px_1px_rgba(0,0,0,0.08),0px_2px_2px_rgba(0,0,0,0.04)] ring-1 ring-[#fafafa] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#fafafa] border-b border-[rgba(0,0,0,0.08)]">
                    <th className="p-4 text-[14px] font-semibold text-[#171717]">用户</th>
                    <th className="p-4 text-[14px] font-semibold text-[#171717]">手机号</th>
                    <th className="p-4 text-[14px] font-semibold text-[#171717]">小区名称</th>
                    <th className="p-4 text-[14px] font-semibold text-[#171717]">户型图数量</th>
                    <th className="p-4 text-[14px] font-semibold text-[#171717]">注册时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(0,0,0,0.08)]">
                  {users.map((user: any) => (
                    <tr key={user._id} className="hover:bg-[#fcfcfc] transition-colors">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          {user.avatar ? (
                            <img src={user.avatar} alt="avatar" className="w-10 h-10 rounded-full border border-[rgba(0,0,0,0.1)] object-cover" />
                          ) : (
                            <div className="bg-[#f5f5f5] w-10 h-10 rounded-full flex items-center justify-center text-[#666]">
                              <Users size={18} />
                            </div>
                          )}
                          <div className="flex flex-col">
                            <span className="text-[14px] font-medium text-[#171717]">{user.nickname || '未命名用户'}</span>
                            <span className="text-[11px] text-[#999] font-mono">{user.openid}</span>
                          </div>
                        </div>
                      </td>
                      <td className="p-4 text-[13px] text-[#666]">{user.phone || '-'}</td>
                      <td className="p-4 text-[13px] text-[#666]">{user.communityName || '-'}</td>
                      <td className="p-4 text-[13px] text-[#666] font-medium">{user.planCount || 0} 份</td>
                      <td className="p-4 text-[13px] text-[#666]">
                        {user.createdAt ? new Date(user.createdAt).toLocaleString() : '-'}
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-12 text-center text-[#666] text-[14px]">
                        暂无匹配的用户数据
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
