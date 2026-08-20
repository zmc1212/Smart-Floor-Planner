'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Card, Row, Skeleton } from 'antd';
import { ArrowUpRight, Building2, Cable, Coins, Map, Users } from 'lucide-react';
import { notify } from '@/components/admin/operation-feedback';
import OverviewStatCard from '@/components/dashboard/OverviewStatCard';

type PlatformStats = {
  userCount: number;
  planCount: number;
  enterpriseCount: number;
};

type ListResponse = {
  success?: boolean;
  data?: unknown[];
  pagination?: { total?: number };
  error?: string;
};

export default function PlatformDashboard() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [usersResponse, floorPlansResponse, enterprisesResponse] = await Promise.all([
          fetch('/api/users'),
          fetch('/api/floorplans'),
          fetch('/api/admin/enterprises'),
        ]);
        const [users, floorPlans, enterprises] = (await Promise.all([
          usersResponse.json(),
          floorPlansResponse.json(),
          enterprisesResponse.json(),
        ])) as [ListResponse, ListResponse, ListResponse];

        if (!usersResponse.ok || !floorPlansResponse.ok || !enterprisesResponse.ok || !users.success || !floorPlans.success || !enterprises.success) {
          throw new Error(users.error || floorPlans.error || enterprises.error || '读取平台概览失败');
        }

        setStats({
          userCount: users.data?.length || 0,
          planCount: floorPlans.pagination?.total || 0,
          enterpriseCount: enterprises.data?.length || 0,
        });
      } catch (error) {
        notify.error(error instanceof Error ? error.message : '读取平台概览失败');
      } finally {
        setLoading(false);
      }
    };

    void fetchStats();
  }, []);

  if (loading) return <Skeleton active paragraph={{ rows: 3 }} />;

  return <div className="dashboard-stack space-y-6">
    <Row gutter={[16, 16]}>
      <OverviewStatCard title="注册用户" value={stats?.userCount || 0} icon={<Users size={18} />} />
      <OverviewStatCard title="正式户型" value={stats?.planCount || 0} icon={<Map size={18} />} />
      <OverviewStatCard title="入驻企业" value={stats?.enterpriseCount || 0} icon={<Building2 size={18} />} />
    </Row>
    <Card className="admin-panel-card dashboard-workbench-card" size="small" title="管理入口">
      <div className="dashboard-quick-links">
        <DashboardQuickLink href="/enterprises" label="企业管理" description="维护企业资料与服务状态" icon={<Building2 size={18} />} />
        <DashboardQuickLink href="/promotion-records" label="企业报备" description="查看渠道线索与跟进进展" icon={<Users size={18} />} />
        <DashboardQuickLink href="/ai-providers" label="AI 供应商" description="配置模型服务与运行状态" icon={<Cable size={18} />} />
        <DashboardQuickLink href="/ai-credit-prices" label="AI 点数价格" description="管理平台动作的点数规则" icon={<Coins size={18} />} />
      </div>
    </Card>
  </div>;
}

function DashboardQuickLink({ href, label, description, icon }: { href: string; label: string; description: string; icon: ReactNode }) {
  return <Link href={href} className="dashboard-quick-link">
    <span className="dashboard-quick-link-icon" aria-hidden="true">{icon}</span>
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-semibold text-foreground">{label}</span>
      <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
    </span>
    <ArrowUpRight size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
  </Link>;
}
