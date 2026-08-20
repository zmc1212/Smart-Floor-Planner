'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, Col, DatePicker, Flex, Row, Segmented, Skeleton, Space, Statistic, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { notify } from '@/components/admin/operation-feedback';

export type OpsDashboardCard = {
  key: string;
  label: string;
  value: number | string;
  unit?: string;
  detail?: string;
  tone?: string;
};

type PeriodKind = 'week' | 'month' | 'year' | 'custom';

type OpsDashboardPayload = {
  period: {
    kind: PeriodKind;
    label: string;
    from: string | null;
    to: string | null;
    subtitle: string;
  };
  dashboard: OpsDashboardCard[];
};

type ApiResponse = {
  success?: boolean;
  data?: OpsDashboardPayload;
  error?: string;
};

const PERIOD_OPTIONS: Array<{ label: string; value: PeriodKind }> = [
  { label: '本周', value: 'week' },
  { label: '本月', value: 'month' },
  { label: '本年', value: 'year' },
  { label: '自定义', value: 'custom' },
];

function defaultCustomRange(): [Dayjs, Dayjs] {
  return [dayjs().startOf('month'), dayjs()];
}

export default function OpsDashboardPanel() {
  const [periodKind, setPeriodKind] = useState<PeriodKind>('month');
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [payload, setPayload] = useState<OpsDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ period: periodKind });
      if (periodKind === 'custom') {
        const range = customRange || defaultCustomRange();
        params.set('from', range[0].format('YYYY-MM-DD'));
        params.set('to', range[1].format('YYYY-MM-DD'));
      }
      const response = await fetch(`/api/workbench/ops-dashboard?${params.toString()}`);
      const result = (await response.json()) as ApiResponse;
      if (!response.ok || !result.success || !result.data) {
        throw new Error(result.error || '读取经营大盘失败');
      }
      setPayload(result.data);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '读取经营大盘失败');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [periodKind, customRange]);

  useEffect(() => {
    if (periodKind === 'custom' && !customRange) return;
    void load();
  }, [load, periodKind, customRange]);

  const cards = payload?.dashboard || [];
  const topCards = cards.slice(0, 3);
  const bottomCards = cards.slice(3, 5);

  return (
    <Card
      className="admin-panel-card dashboard-workbench-card"
      size="small"
      title={
        <Flex align="baseline" gap={8} wrap>
          <span>经营大盘</span>
          {payload?.period.subtitle ? (
            <Typography.Text type="secondary" className="text-sm font-normal">
              {payload.period.subtitle}
            </Typography.Text>
          ) : null}
        </Flex>
      }
      extra={
        <Typography.Text type="secondary" className="text-xs">
          只读指标 · 不在此改签约状态
        </Typography.Text>
      }
    >
      <Flex vertical gap={16}>
        <Flex justify="space-between" align="center" gap={12} wrap>
          <Segmented
            options={PERIOD_OPTIONS}
            value={periodKind}
            onChange={(value) => {
              const next = value as PeriodKind;
              setPeriodKind(next);
              if (next === 'custom' && !customRange) {
                setCustomRange(defaultCustomRange());
              }
            }}
          />
          {periodKind === 'custom' ? (
            <DatePicker.RangePicker
              value={customRange}
              allowClear={false}
              onChange={(values) => {
                if (!values?.[0] || !values?.[1]) return;
                setCustomRange([values[0], values[1]]);
              }}
            />
          ) : null}
        </Flex>

        {loading && !payload ? (
          <Skeleton active paragraph={{ rows: 3 }} />
        ) : (
          <Space direction="vertical" size={12} className="w-full">
            <Row gutter={[12, 12]}>
              {topCards.map((card) => (
                <Col key={card.key} xs={24} sm={8}>
                  <div className="dashboard-mini-stat h-full">
                    <Statistic
                      title={card.label}
                      value={card.value}
                      suffix={card.unit || undefined}
                      valueStyle={card.key === 'schemeDelivery' || card.key === 'signedCount' || card.key === 'signingRate'
                        ? { color: '#16a34a' }
                        : undefined}
                    />
                    {card.detail ? (
                      <Typography.Text type="secondary" className="mt-2 block text-xs">
                        {card.detail}
                      </Typography.Text>
                    ) : null}
                  </div>
                </Col>
              ))}
            </Row>
            <Row gutter={[12, 12]}>
              {bottomCards.map((card) => (
                <Col key={card.key} xs={24} sm={12}>
                  <div className="dashboard-mini-stat h-full">
                    <Statistic
                      title={card.label}
                      value={card.value}
                      suffix={card.unit || undefined}
                      valueStyle={{ color: '#16a34a' }}
                    />
                    {card.detail ? (
                      <Typography.Text type="secondary" className="mt-2 block text-xs">
                        {card.detail}
                      </Typography.Text>
                    ) : null}
                  </div>
                </Col>
              ))}
            </Row>
          </Space>
        )}
      </Flex>
    </Card>
  );
}
