'use client';

import useSWR, { SWRConfiguration } from 'swr';

const defaultFetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP error! status: ${res.status}`);
  }
  const contentType = res.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    const text = await res.text();
    console.error('Expected JSON, got:', text.substring(0, 100));
    throw new Error('Received non-JSON response from server');
  }
  return res.json();
};

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
