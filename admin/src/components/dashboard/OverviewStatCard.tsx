import type { ReactNode } from 'react';
import { Card, Col, Statistic } from 'antd';

type OverviewStatCardProps = {
  title: string;
  value: number;
  icon: ReactNode;
};

export default function OverviewStatCard({ title, value, icon }: OverviewStatCardProps) {
  return (
    <Col xs={24} sm={12} xl={8}>
      <Card className="admin-panel-card admin-overview-stat h-full" size="small">
        <div className="flex items-start gap-4">
          <span className="admin-overview-stat-icon" aria-hidden="true">
            {icon}
          </span>
          <Statistic title={title} value={value} />
        </div>
      </Card>
    </Col>
  );
}
