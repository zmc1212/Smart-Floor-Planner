'use client';

import { ConfigProvider } from 'antd';

export function AdminAntdProvider({ children }: { children: React.ReactNode }) {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#16a34a',
          colorInfo: '#16a34a',
          colorSuccess: '#16a34a',
          colorBgLayout: '#f6f8f6',
          colorBgContainer: '#ffffff',
          colorBorderSecondary: '#e5e9e5',
          borderRadius: 6,
          fontFamily: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", "Helvetica Neue", Arial, sans-serif',
        },
        components: {
          Table: { headerBg: '#f6f8f6', headerColor: '#526052', rowHoverBg: '#f3faf4' },
          Card: { headerBg: '#ffffff' },
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}
