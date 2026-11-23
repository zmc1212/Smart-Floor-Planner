'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import { stageDefinitions, type StageId } from '@/lib/xiaok-v1/stages';
import type { EnterpriseStageAgent, StageAgentSettings, StageSuggestedQuestion, StageWorkflowOption } from '@/lib/xiaok-v1/stage-workflow-settings';
import { notify } from '@/components/admin/operation-feedback';
import { assistantError, assistantRequest } from './client';

interface Fields {
  stageId: StageId; name: string; description: string; enabled: boolean; templates: string[]; defaultWorkflowId?: string; suggestedQuestions: StageSuggestedQuestion[];
}
const versionKey = (ref: StageWorkflowOption) => ref.definitionId + '@' + ref.revision;
const stageName = (stageId: StageId) => stageDefinitions.find(stage => stage.stageId === stageId)?.name;

export function StageAgentManager({ canPublish }: { canPublish: boolean }) {
  const [settings, setSettings] = useState<StageAgentSettings>();
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<EnterpriseStageAgent | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<Fields>();
  const selected: string[] = Form.useWatch('templates', form) ?? [];

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void assistantRequest<StageAgentSettings>('stage-agents', { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setSettings(result); setError(''); } })
      .catch(e => { if (!controller.signal.aborted) setError(assistantError(e)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);

  const availableStages = settings?.agents.filter(agent => !agent.version) ?? [];
  const templates = settings?.templates ?? [];
  const open = (agent: EnterpriseStageAgent) => {
    setEditing(agent);
    form.setFieldsValue({ stageId: agent.stageId, name: agent.name, description: agent.description,
      enabled: agent.version ? agent.enabled : true, templates: agent.workflows.map(versionKey),
      defaultWorkflowId: agent.defaultWorkflowId ?? undefined, suggestedQuestions: agent.suggestedQuestions });
  };
  const save = async (fields: Fields) => {
    if (!settings || !editing || saving) return;
    const chosen = (fields.templates ?? []).map(key => templates.find(ref => versionKey(ref) === key)
      ?? editing.workflows.find(ref => versionKey(ref) === key));
    if (chosen.some(ref => !ref)) { notify.error('模板列表已更新，请重新读取'); return; }
    setSaving(true);
    try {
      const row = await assistantRequest<EnterpriseStageAgent>('stage-agents', {
        method: editing.version ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedEnterpriseId: settings.enterpriseId, expectedVersion: editing.version,
          stageId: fields.stageId, name: fields.name, description: fields.description, enabled: fields.enabled,
          defaultWorkflowId: fields.defaultWorkflowId ?? null, suggestedQuestions: fields.suggestedQuestions ?? [], workflows: chosen.map(ref => ({
            definitionId: ref!.definitionId, revision: ref!.revision, digest: ref!.digest,
          })) }),
      });
      setSettings(current => current && { ...current, agents: current.agents.map(agent => agent.stageId === row.stageId ? row : agent) });
      setEditing(null);
      notify.success(editing.version ? '阶段 Agent 已保存' : '阶段 Agent 已创建');
    } catch (e) { notify.error('保存失败', { description: assistantError(e) }); }
    finally { setSaving(false); }
  };

  const options = [...templates, ...(editing?.workflows ?? []).filter(ref => !templates.some(item => versionKey(item) === versionKey(ref)))];
  const chosenOptions = options.filter(ref => selected.includes(versionKey(ref)));
  return <Space direction="vertical" size={20} style={{ width: '100%' }}>
    <Space wrap>
      <Button type="primary" disabled={loading || !availableStages.length} onClick={() => open(availableStages[0]!)}>新建阶段 Agent</Button>
      {canPublish && <Button href="/native-workflow">管理工作流模板</Button>}
      <Button onClick={() => setRevision(value => value + 1)} loading={loading}>刷新</Button>
    </Space>
    {error && <Alert showIcon type="error" message={error} />}
    {settings && !templates.length && <Alert showIcon type="info" message="尚无已发布的阶段工作流模板"
      description={canPublish ? '在「管理工作流模板」中创建并发布阶段模板，即可分配给多个 Agent。' : '平台管理员发布阶段模板后，即可在此选用。'} />}
    <Table<EnterpriseStageAgent> rowKey="stageId" size="middle" pagination={false} loading={loading} dataSource={settings?.agents}
      scroll={{ x: 700 }} columns={[
        { title: '装修阶段', width: 100, render: (_, row) => stageName(row.stageId) },
        { title: 'Agent', dataIndex: 'name' },
        { title: '绑定工作流', render: (_, row) => row.workflows.length ? <Space wrap size={[4, 4]}>{row.workflows.map(ref =>
          <Tag key={ref.definitionId}>{ref.name} v{ref.revision}{ref.definitionId === row.defaultWorkflowId ? ' · 默认' : ''}</Tag>)}</Space> : '—' },
        { title: '状态', width: 100, render: (_, row) => row.version
          ? <Tag color={row.enabled ? 'green' : 'default'}>{row.enabled ? '已启用' : '已停用'}</Tag> : <Typography.Text type="secondary">系统默认</Typography.Text> },
        { title: '操作', width: 82, render: (_, row) => <Button type="link" onClick={() => open(row)}>{row.version ? '编辑' : '创建'}</Button> },
      ]} />
    <Modal title={editing?.version ? '编辑阶段 Agent' : '新建阶段 Agent'} open={!!editing} forceRender
      okText="保存" cancelText="取消" confirmLoading={saving}
      onCancel={() => { if (!saving) setEditing(null); }} onOk={() => form.submit()}>
      <Form form={form} layout="vertical" onFinish={save} disabled={saving}>
        <Form.Item name="stageId" label="装修阶段" rules={[{ required: true }]}>
          <Select disabled={!!editing?.version} options={(editing?.version ? [editing] : availableStages).map(agent =>
            ({ label: stageName(agent.stageId), value: agent.stageId }))}
            onChange={value => { const next = availableStages.find(agent => agent.stageId === value); if (next) open(next); }} />
        </Form.Item>
        <Form.Item name="name" label="Agent 名称" rules={[{ required: true, whitespace: true, max: 60 }]}><Input maxLength={60} /></Form.Item>
        <Form.Item name="description" label="职责说明" rules={[{ required: true, whitespace: true, max: 240 }]}><Input.TextArea rows={2} maxLength={240} /></Form.Item>
        <Form.Item name="templates" label="可调用的工作流">
          <Select mode="multiple" maxCount={12} optionFilterProp="label" placeholder="选择已发布的模板版本"
            options={options.map(ref => ({ value: versionKey(ref), label: ref.name + ' · ' + ref.definitionId + ' v' + ref.revision,
              disabled: chosenOptions.some(item => item.definitionId === ref.definitionId && item.revision !== ref.revision) }))}
            onChange={(keys: string[]) => {
              const picked = options.filter(ref => keys.includes(versionKey(ref)));
              if (!picked.some(ref => ref.definitionId === form.getFieldValue('defaultWorkflowId'))) form.setFieldValue('defaultWorkflowId', picked[0]?.definitionId);
            }} />
        </Form.Item>
        <Form.Item name="defaultWorkflowId" label="阶段问答的默认工作流" rules={[{ required: !!chosenOptions.length }]}>
          <Select disabled={!chosenOptions.length} options={chosenOptions.map(ref => ({ label: ref.name, value: ref.definitionId }))} />
        </Form.Item>
        <Form.List name="suggestedQuestions">
          {(items, { add, remove }) => <Form.Item label="猜你想问" extra="业主工地欢迎页按顺序显示，未配置的卡位使用系统问题。">
            {items.map(({ key, name }) => <div key={key}>
              <Space align="start">
                <Form.Item name={[name, 'title']} rules={[{ required: true, whitespace: true }]}><Input aria-label="问题卡标题" placeholder="卡片标题" maxLength={8} /></Form.Item>
                <Form.Item name={[name, 'helper']} rules={[{ required: true, whitespace: true }]}><Input aria-label="问题卡副标题" placeholder="副标题" maxLength={10} /></Form.Item>
                <Button type="link" onClick={() => remove(name)}>移除</Button>
              </Space>
              <Form.Item name={[name, 'text']} rules={[{ required: true, whitespace: true }]}><Input aria-label="完整问题" placeholder="点击卡片后发送的完整问题" maxLength={200} /></Form.Item>
            </div>)}
            {items.length < 3 && <Button onClick={() => add()}>添加问题</Button>}
          </Form.Item>}
        </Form.List>
        <Form.Item name="enabled" label="启用阶段 Agent" valuePropName="checked"><Switch /></Form.Item>
      </Form>
    </Modal>
  </Space>;
}
