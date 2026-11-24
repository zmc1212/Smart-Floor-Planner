'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Skeleton, Space, Switch } from 'antd';
import { notify } from '@/components/admin/operation-feedback';
import type { PublicSiteGuide } from '@/lib/construction/public-guide';
import { assistantError, assistantRequest } from './client';

type Snapshot = { version: number; config: PublicSiteGuide };
const endpoint = 'guidance?scene=public-site';

export function PublicSiteGuideEditor() {
  const [form] = Form.useForm<PublicSiteGuide>();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    void assistantRequest<Snapshot>(endpoint, { signal: abort.signal }).then(value => {
      if (abort.signal.aborted) return;
      setSnapshot(value);
      form.setFieldsValue(value.config);
      setError('');
    }).catch(e => {
      if (!abort.signal.aborted) setError(assistantError(e));
    }).finally(() => {
      if (!abort.signal.aborted) setLoading(false);
    });
    return () => abort.abort();
  }, [form, reload]);

  async function save(config: PublicSiteGuide) {
    if (!snapshot || saving) return;
    setSaving(true);
    try {
      const result = await assistantRequest<Snapshot>(endpoint, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: snapshot.version, config }),
      });
      setSnapshot(result);
      form.setFieldsValue(result.config);
      setError('');
      notify.success('围观引导已保存');
    } catch (e) {
      const detail = assistantError(e);
      setError(detail);
      notify.error('保存失败', { description: detail });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Skeleton active />;
  return <Space direction="vertical" size={20} style={{ width: '100%', maxWidth: 860 }}>
    {error && <Alert type="error" showIcon message={error} action={<Button disabled={saving} onClick={() => {
      setLoading(true);
      setReload(value => value + 1);
    }}>重新读取配置</Button>} />}
    {snapshot && <Form form={form} layout="vertical" onFinish={save} disabled={saving}>
      <Form.Item name="enabled" label="启用围观引导" valuePropName="checked"
        extra="关闭后，访客仍可从「问小K」进入自己的咨询。">
        <Switch />
      </Form.Item>
      <Form.Item name="opening" label="首问" extra="直播页和会话使用同一句话。可用 {stage} 插入已公开施工阶段，{site} 插入已公开工地名。请以一个问号结尾。"
        rules={[{ required: true, whitespace: true, max: 96 }]}>
        <Input maxLength={96} showCount />
      </Form.Item>
      <Form.Item name="followUpFocus" label="追问方向" extra="小K先回答访客，再从这里选一个有帮助且尚未回答的细节追问。"
        rules={[{ required: true, whitespace: true, max: 100 }]}>
        <Input maxLength={100} showCount />
      </Form.Item>
      <Form.Item name="closing" label="随便看看时的收尾" extra="访客表示只想看看时，小K参考这句话结束引导。"
        rules={[{ required: true, whitespace: true, max: 80 }]}>
        <Input maxLength={80} showCount />
      </Form.Item>
      <Button type="primary" htmlType="submit" loading={saving}>保存围观引导</Button>
    </Form>}
  </Space>;
}
