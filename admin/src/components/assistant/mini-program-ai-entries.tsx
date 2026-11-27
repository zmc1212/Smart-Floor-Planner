'use client';

import { useEffect, useState } from 'react';
import { Button, Card, Space, Switch, Typography } from 'antd';
import { notify } from '@/components/admin/operation-feedback';

const endpoint = '/api/platform/miniprogram-ai-entries';

export function MiniProgramAiEntriesCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch(endpoint, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.success || typeof result.data?.enabled !== 'boolean') {
        throw new Error(result.error || '读取小程序 AI 入口设置失败');
      }
      setEnabled(result.data.enabled);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '读取小程序 AI 入口设置失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function save(next: boolean) {
    setSaving(true);
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      const result = await response.json();
      if (!response.ok || !result.success || typeof result.data?.enabled !== 'boolean') {
        throw new Error(result.error || '保存小程序 AI 入口设置失败');
      }
      setEnabled(result.data.enabled);
      notify.success(result.data.enabled ? '小程序 AI 入口已开启' : '小程序 AI 入口已关闭');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存小程序 AI 入口设置失败');
    } finally {
      setSaving(false);
    }
  }

  return <Card title="小程序 AI 入口" className="admin-panel-card mb-4" loading={loading}>
    <Space direction="vertical" size={12}>
      <Typography.Text>同时显示小K Agent 和 AI 设计</Typography.Text>
      <Typography.Text type="secondary">适用于所有企业和访客。小程序重新进入前台后读取设置。</Typography.Text>
      {enabled === null
        ? <Button onClick={() => void load()}>重新读取</Button>
        : <Switch checked={enabled} loading={saving} disabled={saving} onChange={(next) => void save(next)}
            checkedChildren="开启" unCheckedChildren="关闭" aria-label="显示小K Agent 和 AI 设计" />}
    </Space>
  </Card>;
}
