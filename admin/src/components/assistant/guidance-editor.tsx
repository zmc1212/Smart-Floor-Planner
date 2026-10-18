'use client';
import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Select, Skeleton, Space, Switch, Typography } from 'antd';
import { notify } from '@/components/admin/operation-feedback';
import { assistantError, assistantRequest } from './client';
import type { Guidance } from '@/lib/assistant/requirements/guidance';
import { defaultGuidance, questionDefinitions, roomQuestionDefinitions } from '@/lib/assistant/requirements/guidance-defaults';
type Snapshot = { version: number; config: Guidance };
const labels = { housing: '房屋情况', household: '居住需求', style: '风格偏好', budget: '预算范围', timeline: '装修时间' };
export function GuidanceEditor() {
  const [form] = Form.useForm<Guidance>();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    void assistantRequest<Snapshot>('guidance', { signal: abort.signal }).then(value => {
      if (!abort.signal.aborted) { setSnapshot(value); form.setFieldsValue(value.config); setError(''); }
    }).catch(e => { if (!abort.signal.aborted) setError(assistantError(e)); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [form, reload]);
  const save = async (config: Guidance) => {
    if (!snapshot || busy) return;
    setBusy(true);
    try {
      const result = await assistantRequest<Snapshot>('guidance', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: snapshot.version, config }) });
      setSnapshot(result); setError(''); notify.success('引导配置已保存', { description: '主动引导开关生效；自定义话术和选项作为兼容配置保留，当前对话优先流程使用已批准的五类提示。' });
    } catch (e) { const message = assistantError(e); setError(message); notify.error('保存失败', { description: message }); }
    finally { setBusy(false); }
  };
  if (loading) return <Skeleton active />;
  return <Space direction="vertical" size={20} style={{ width: '100%', maxWidth: 860 }}>
    <Alert type="info" showIcon message="客户自然聊天，小K自动整理" description="当前流程使用已批准的五类可中断提示，换话题后不自动拉回，客户无需确认摘要。主动引导开关继续生效；下方自定义开场、问题顺序和选项仅保留为兼容配置，暂不应用到当前客户聊天。" />
    {error && <Alert type="error" message={error} action={<Button disabled={busy} onClick={() => { setLoading(true); setReload(x => x + 1); }}>重新读取配置</Button>} />}
    {snapshot && <Form form={form} layout="vertical" onFinish={save} disabled={busy}>
      <Form.Item name="schemaVersion" hidden><Input /></Form.Item>
      {snapshot.config.schemaVersion !== 3 && <Alert type="warning" showIcon message="旧版兼容配置" description="可更新保存的模板结构；不会替换当前客户聊天的五类提示。" action={<Button onClick={() => { const config = { ...defaultGuidance, enabled: form.getFieldValue('enabled') }; form.setFieldsValue(config); setSnapshot({ ...snapshot, config }); }}>更新兼容模板</Button>} />}
      <Form.Item name="enabled" label="启用主动需求引导" valuePropName="checked" extra="关闭后停止主动追问，已有记录和摘要仍可查看；知识问答保持可用。"><Switch /></Form.Item>
      <Form.Item name="opening" label="开场白" rules={[{ required: true, whitespace: true, max: 600 }]}><Input.TextArea rows={3} maxLength={600} showCount /></Form.Item>
      <Form.List name="questions">{(fields, { move }) => <>{fields.map(({ key, name }) => <div key={key}>
        <Form.Item name={[name, 'field']} hidden><Input /></Form.Item>
        <Form.Item name={[name, 'key']} hidden><Input /></Form.Item>
        <Form.Item name={[name, 'text']} label={`${name + 1}. ${[...questionDefinitions, ...roomQuestionDefinitions].find(q => q.key === form.getFieldValue(['questions', name, 'key']))?.label || labels[form.getFieldValue(['questions', name, 'field']) as keyof typeof labels]}`} rules={[{ required: true, whitespace: true, max: 500 }]}><Input.TextArea rows={2} maxLength={500} showCount /></Form.Item>
        {!!snapshot.config.schemaVersion && <Form.Item name={[name, 'options']} label="快捷选择" extra="输入后按回车添加；移除所有选项后仍可输入回答。不要在选项中混入其他题目的信息。" rules={[{ validator: async (_, values: string[] = []) => { if (values.length > 6 || values.some(v => !v.trim() || Array.from(v).length > 30) || new Set(values.map(v => v.trim())).size !== values.length) throw new Error('最多6个不重复选项，每个1–30字'); } }]}><Select mode="tags" open={false} placeholder="输入选项后按回车" /></Form.Item>}
        {snapshot.config.schemaVersion === 3 && <>
          <Form.Item name={[name, 'answerType']} label="回答类型"><Select options={[{ value: 'text', label: '自由输入' }, { value: 'single', label: '单选即发送' }, { value: 'multiple', label: '多选后确认' }]} /></Form.Item>
          <Form.Item name={[name, 'skippable']} label="提供稍后补充选项" valuePropName="checked" extra="关闭只隐藏快捷跳过；客户始终可以提前整理摘要，不构成必填问卷。"><Switch /></Form.Item>
        </>}
        <Space style={{ marginBottom: 20 }}><Button disabled={busy || name === 0} onClick={() => move(name, name - 1)}>上移</Button><Button disabled={busy || name === fields.length - 1} onClick={() => move(name, name + 1)}>下移</Button></Space>
      </div>)}</>}</Form.List>
      <Form.Item name="completion" label="收尾提示" extra="请保留引导客户打开“需求摘要”核对确认的意思，不要写成已经确认。" rules={[{ required: true, whitespace: true, max: 600 }]}><Input.TextArea rows={3} maxLength={600} showCount /></Form.Item>
      <Space><Button type="primary" htmlType="submit" loading={busy}>保存引导话术</Button><Typography.Text type="secondary">保存后请在小程序新建对话测试</Typography.Text></Space>
    </Form>}
  </Space>;
}
