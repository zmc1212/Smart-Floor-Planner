'use client';

import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(res => res.json());

/**
 * SWR-based 当前用户钩子，全局自动去重 + 缓存。
 * 替代各页面中重复的 fetchCurrentUser() 逻辑。
 * 
 * - 1 分钟内去重：多个组件同时挂载只发一次请求
 * - 后台自动刷新：标签页切换回来时静默刷新
 * - 全局共享缓存：Sidebar / Page / Sheet 共享同一份数据
 * 
 * @see react-best-practices: client-swr-dedup
 */
export function useCurrentUser() {
  const { data, error, isLoading, mutate } = useSWR('/api/auth/me', fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60000, // 1 分钟内去重
  });

  return {
    user: data?.success ? data.data : null,
    isLoading,
    error,
    mutate,
  };
}
