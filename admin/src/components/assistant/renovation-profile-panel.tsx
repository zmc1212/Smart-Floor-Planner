'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Skeleton, Typography } from 'antd';
import type { StaffRenovationProfile } from '@/lib/assistant/requirements/renovation-profile';

const sourceLabels = { consultation: '小K从对话整理', message: '客户原话已确认', confirmed: '客户核对后确认' };

export function RenovationProfilePanel({ leadId }: { leadId: string }) {
  const [state, setState] = useState<{ profile: StaffRenovationProfile | null; error?: string }>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let controller = new AbortController();
    async function load() {
      controller.abort();
      controller = new AbortController();
      const { signal } = controller;
      try {
        const response = await fetch('/api/leads/' + encodeURIComponent(leadId) + '/renovation-profile', { cache: 'no-store', signal });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '暂时无法读取装修画像');
        if (!signal.aborted) setState({ profile: result.data });
      } catch (error) {
        if (!signal.aborted) setState({ profile: null, error: error instanceof Error ? error.message : '暂时无法读取装修画像' });
      }
    }
    void load();
    window.addEventListener('focus', load);
    return () => {
      controller.abort();
      window.removeEventListener('focus', load);
    };
  }, [leadId, revision]);

  const fields = state?.profile?.fields ?? [];
  return (
    <Descriptions
      title="装修画像"
      extra={<Button type="link" size="small" onClick={() => setRevision(value => value + 1)}>刷新</Button>}
      bordered
      size="small"
      column={1}
      items={fields.length ? fields.map(field => ({
        key: field.key,
        label: field.label,
        children: <>
          <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{field.value}</div>
          <Typography.Text type="secondary">
            {sourceLabels[field.source]}
            {' · '}{new Date(field.recordedAt).toLocaleDateString('zh-CN')}
          </Typography.Text>
        </>,
      })) : [{
        key: 'status',
        children: !state ? <Skeleton active paragraph={{ rows: 1 }} />
          : state.error ? <Alert type="error" showIcon message={state.error} />
          : <Typography.Text type="secondary">暂无已整理的装修需求</Typography.Text>,
      }]}
    />
  );
}
