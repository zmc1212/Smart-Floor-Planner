'use client';

import { useEffect } from 'react';
import { Button, Result } from 'antd';

export default function AdminRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[admin-route-error]', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Result
        status="500"
        title="页面加载失败"
        subTitle="请重试。如果反复出现，请联系平台管理员处理。"
        extra={
          <Button type="primary" onClick={reset}>
            重新加载
          </Button>
        }
      />
    </div>
  );
}
