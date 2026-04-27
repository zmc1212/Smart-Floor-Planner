'use client';

import useSWR, { SWRConfiguration } from 'swr';

const defaultFetcher = (url: string) => fetch(url).then(res => res.json());

/**
 * 通用 SWR 数据获取钩子。
 * 
 * @param url - API 端点，传 null 可跳过请求
 * @param options - SWR 配置项
 * 
 * @see react-best-practices: client-swr-dedup
 */
export function useFetch<T = unknown>(url: string | null, options?: SWRConfiguration) {
  const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data: T }>(
    url,
    defaultFetcher,
    {
      revalidateOnFocus: false,
      ...options,
    }
  );

  return {
    data: data?.success ? data.data : null,
    isLoading,
    error,
    mutate,
  };
}
