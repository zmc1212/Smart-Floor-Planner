'use client';

import useSWR from 'swr';
import {
  fetchCurrentUserJson,
  parseCurrentUserResponse,
  shouldRetryCurrentUserError,
} from '@/lib/current-user';

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
  const { data, error, isLoading, mutate } = useSWR(
    '/api/auth/me',
    fetchCurrentUserJson,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000, // 1 分钟内去重
      shouldRetryOnError: shouldRetryCurrentUserError,
    }
  );

  return {
    user: parseCurrentUserResponse(data),
    isLoading,
    error,
    mutate,
  };
}
