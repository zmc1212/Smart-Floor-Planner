'use client';
import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Radio, Skeleton, Space, Typography } from 'antd';
import { notify } from '@/components/admin/operation-feedback';
import { assistantError, assistantRequest } from './client';
import type { AcquisitionConfig } from '@/lib/assistant/acquisition/defaults';
import { defaultAcquisitionConfig } from '@/lib/assistant/acquisition/defaults';

type Snapshot = { version: number; config: AcquisitionConfig };

export function AcquisitionEditor() {
  const [form] = Form.useForm<AcquisitionConfig>();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    void assistantRequest<Snapshot>('acquisition', { signal: abort.signal }).then(value => {
      if (!abort.signal.aborted) { setSnapshot(value); form.setFieldsValue(value.config); setError(''); }
    }).catch(e => { if (!abort.signal.aborted) setError(assistantError(e)); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [form, reload]);

  const save = async (config: AcquisitionConfig) => {
    if (!snapshot || busy) return;
    setBusy(true);
    try {
      const result = await assistantRequest<Snapshot>('acquisition', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: snapshot.version, config })
      });
      setSnapshot(result); setError('');
      notify.success('获客设置已保存', { description: '新的扫码会话会使用本次品牌模式和开场话术；已开始的会话保持原快照。' });
    } catch (e) {
      const message = assistantError(e); setError(message); notify.error('保存失败', { description: message });
    } finally { setBusy(false); }
  };

  if (loading) return <Skeleton active />;
  return <Space direction="vertical" size={20} style={{ width: '100%', maxWidth: 860 }}>
    <Alert
      type="info"
      showIcon
      message="扫码获客入口"
      description="匿名模式不会展示企业名称和 Logo，授权手机号建立服务档案后才按现有规则展示服务企业；品牌模式从落地页开始展示企业品牌。设置只影响新扫码会话。"
    />
    {error && <Alert type="error" message={error} action={<Button disabled={busy} onClick={() => { setLoading(true); setReload(x => x + 1); }}>重新读取配置</Button>} />}
    {snapshot && <Form form={form} layout="vertical" onFinish={save} disabled={busy}>
      <Form.Item name="brandMode" label="品牌展示" rules={[{ required: true }]} extra="员工活动码、推广人服务码共用此设置；二维码本身不携带企业明文。">
        <Radio.Group>
          <Radio.Button value="anonymous">匿名（推荐）</Radio.Button>
          <Radio.Button value="branded">展示企业品牌</Radio.Button>
        </Radio.Group>
      </Form.Item>
      <Form.Item name="opening" label="扫码开场白" rules={[{ required: true, whitespace: true, max: 600 }]} extra="只用于说明服务和小K身份，不承诺价格、优惠、工期或零增项。">
        <Input.TextArea rows={4} maxLength={600} showCount />
      </Form.Item>
      <Form.List name="prompts">{(fields, { add, remove }) => <>
        <Typography.Text strong>客户可以先聊的话题（最多 3 个）</Typography.Text>
        {fields.map(({ key, name }) => <div key={key} style={{ marginTop: 12 }}>
          <Form.Item name={[name, 'title']} label={`话题 ${name + 1}`} rules={[{ required: true, whitespace: true, max: 12 }]}>
            <Input maxLength={12} showCount placeholder="例如：新房装修" />
          </Form.Item>
          <Form.Item name={[name, 'text']} rules={[{ required: true, whitespace: true, max: 80 }]}>
            <Input.TextArea rows={2} maxLength={80} showCount placeholder="客户点击后发送的完整问句" />
          </Form.Item>
          <Button danger type="link" disabled={busy} onClick={() => remove(name)}>删除这个话题</Button>
        </div>)}
        {fields.length < 3 && <Button disabled={busy} onClick={() => add({ title: '', text: '' })}>添加话题</Button>}
      </>}</Form.List>
      <Space style={{ marginTop: 8 }}>
        <Button type="primary" htmlType="submit" loading={busy}>保存获客设置</Button>
        <Button disabled={busy} onClick={() => form.setFieldsValue(defaultAcquisitionConfig)}>恢复默认话术</Button>
        <Typography.Text type="secondary">保存后请用新的小K获客码测试</Typography.Text>
      </Space>
    </Form>}
  </Space>;
}
