'use client';

import React, { useState, useEffect } from 'react';
import Link from "next/link";
import Navbar from "@/components/Navbar";
import SearchInput from "@/components/SearchInput";
import { Map, Loader2 } from "lucide-react";

export default function FloorPlansPage() {
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchPlans = async (search = '') => {
    setLoading(true);
    try {
      const url = search ? `/api/floorplans?search=${encodeURIComponent(search)}` : '/api/floorplans';
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        setPlans(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch floorplans:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchPlans(searchTerm);
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
              户型图列表
            </h2>
            {!loading && (
              <span className="bg-[#f5f5f5] text-[#666] px-3 py-1 rounded-full text-[14px] font-medium">
                共 {plans.length} 份图纸
              </span>
            )}
          </div>
          
          <SearchInput 
            value={searchTerm} 
            onChange={setSearchTerm} 
            placeholder="搜索户型名称..."
            className="w-full md:w-80"
          />
        </div>

        {loading && (
          <div className="flex flex-col items-center justify-center py-24 text-[#808080]">
            <Loader2 className="animate-spin mb-4" size={32} />
            <p className="text-[14px]">正在获取户型图数据...</p>
          </div>
        )}

        {!loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {plans.map((plan: any) => (
              <Link 
                href={`/floorplans/${plan._id}`} 
                key={plan._id} 
                className="bg-white p-6 rounded-xl border border-[rgba(0,0,0,0.08)] hover:border-[#171717] hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] transition-all block group"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className="bg-[#f5f5f5] w-10 h-10 rounded-md flex items-center justify-center text-[#171717]">
                      <Map size={20} />
                    </div>
                    <div className="overflow-hidden">
                      <h3 className="text-[16px] font-semibold text-[#171717] group-hover:text-[#000] truncate">{plan.name}</h3>
                      <p className="text-[12px] text-[#808080] truncate">
                        {plan.creator?.nickname || '未知用户'}
                      </p>
                    </div>
                  </div>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${plan.status === 'completed' ? 'bg-[#d1fae5] text-[#10b981]' : 'bg-[#f3f4f6] text-[#6b7280]'}`}>
                    {plan.status === 'completed' ? '已完成' : '草稿'}
                  </span>
                </div>
                
                <div className="space-y-2 mb-4">
                  <div className="text-[13px] flex justify-between">
                    <span className="text-[#808080]">房间数量</span>
                    <span className="text-[#171717] font-medium">{plan.layoutData?.length || 0}</span>
                  </div>
                  <div className="text-[13px] flex justify-between">
                    <span className="text-[#808080]">创建时间</span>
                    <span className="text-[#171717]">{plan.createdAt ? new Date(plan.createdAt).toLocaleDateString() : '-'}</span>
                  </div>
                </div>

                <div className="pt-4 border-t border-[rgba(0,0,0,0.04)] flex justify-end">
                  <span className="text-[13px] font-medium text-[#171717] group-hover:underline">
                    查看详情 &rarr;
                  </span>
                </div>
              </Link>
            ))}
            
            {plans.length === 0 && (
              <div className="col-span-full py-24 text-center">
                <p className="text-[#666] text-[16px]">暂无匹配的户型图数据</p>
                {searchTerm && (
                  <button 
                    onClick={() => setSearchTerm('')}
                    className="mt-4 text-[14px] text-[#0a72ef] hover:underline"
                  >
                    清除搜索条件
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
