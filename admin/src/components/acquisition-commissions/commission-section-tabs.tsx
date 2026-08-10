'use client';

import { Tabs } from 'antd';
import { useRouter } from 'next/navigation';

type CommissionSectionTabsProps = {
  activeKey: 'records' | 'settings';
};

const items = [
  { key: 'records', label: '结算记录' },
  { key: 'settings', label: '提成规则' },
];

export function CommissionSectionTabs({ activeKey }: CommissionSectionTabsProps) {
  const router = useRouter();

  return (
    <Tabs
      activeKey={activeKey}
      items={items}
      onChange={(key) => router.push(key === 'settings' ? '/acquisition-commissions/settings' : '/acquisition-commissions')}
    />
  );
}
