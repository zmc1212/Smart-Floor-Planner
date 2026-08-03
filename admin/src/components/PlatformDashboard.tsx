'use client';

import { useEffect, useState } from 'react';
import { Card, Col, Row, Skeleton, Statistic } from 'antd';
import { Building2, Map, Users } from 'lucide-react';
import { notify } from '@/components/ui/operation-feedback';

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

  return (
    <Row gutter={[16, 16]}>
      <OverviewCard title="注册用户" value={stats?.userCount || 0} icon={<Users size={18} />} />
      <OverviewCard title="正式户型" value={stats?.planCount || 0} icon={<Map size={18} />} />
      <OverviewCard title="入驻企业" value={stats?.enterpriseCount || 0} icon={<Building2 size={18} />} />
    </Row>
  );
}

function OverviewCard({ title, value, icon }: { title: string; value: number; icon: React.ReactNode }) {
  return <Col xs={24} sm={12} xl={8}><Card className="admin-panel-card" size="small"><Statistic title={title} value={value} prefix={icon} /></Card></Col>;
}
