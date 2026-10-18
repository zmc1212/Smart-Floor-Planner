'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { Alert, Button, Drawer, Form, Input, Modal, Select, Space, Switch, Tabs, Tag, Typography } from 'antd';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { PublicationWorkbench } from './publication-workbench';
import { notify } from '@/components/admin/operation-feedback';
import { constructionRequest, ConstructionRequestError, errorText, labels, followUpFieldLabels, type ConstructionLead, type Detail, type Pending, type Project, type Staff, type Stage, type StageSettings } from './client';

const options = (keys: string[]) => keys.map(value => ({ value, label: labels[value] }));
type Editor = { kind: 'create' | 'project' | 'member' | 'room' | 'stages' | 'contact' | 'progress'; stage?: Stage; roomId?: string };
export function PlanningWorkbench() {
  const { user, isLoading } = useCurrentUser();
  const identity = user?._id ? `${user._id}:${user.enterpriseId?._id || 'unselected'}` : '';
  return <PageContainer title="施工项目与节点"><Alert type="info" showIcon message="配置施工节点、到场提醒和现场注意事项；经理更新实际节点后，小K提醒客户，联系管家直接拨打本阶段施工人员电话。" style={{ marginBottom: 20 }} />
    {!isLoading && identity && <Workbench key={identity} identity={identity} />}
  </PageContainer>;
}
function Workbench({ identity }: { identity: string }) {
  const [items, setItems] = useState<Project[]>([]), [detail, setDetail] = useState<Detail | null>(null), [selected, setSelected] = useState('');
  const [catalog, setCatalog] = useState<{ owner: boolean; leads: ConstructionLead[]; staff: Staff[] }>({ owner: false, leads: [], staff: [] });
  const [sourceLead, setSourceLead] = useState<ConstructionLead | null>(null);
  const [settings, setSettings] = useState<StageSettings>({ stages: [], version: 1, owner: false });
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [editor, setEditor] = useState<Editor | null>(null), [pending, setPending] = useState<Pending | null>(null);
  const [form] = Form.useForm(); const storageKey = 'construction:pending:' + identity;
  const alive = useRef(true), generation = useRef(0), creationEntry = useRef('');
  const load = useCallback(async (pid = '') => {
    const g = ++generation.current; setLoading(true); setError('');
    try {
      const entryLeadId = creationEntry.current;
      const [list, opts, stageSettings, view, lead] = await Promise.all([
        constructionRequest<{ items: Project[] }>('projects'), constructionRequest<typeof catalog>('options'), constructionRequest<StageSettings>('stages'),
        pid ? constructionRequest<Detail>('projects/' + pid) : Promise.resolve(null),
        entryLeadId ? constructionRequest<ConstructionLead>('leads/' + encodeURIComponent(entryLeadId)) : Promise.resolve(null),
      ]);
      if (alive.current && g === generation.current) {
        setItems(list.items); setCatalog(lead ? { ...opts, leads: [lead, ...opts.leads.filter(l => l.id !== lead.id)] } : opts); setSettings(stageSettings); setDetail(view);
        if (lead) {
          if (lead.id !== entryLeadId || !opts.owner) throw new ConstructionRequestError(false, '客户信息已变化，请返回客户线索重新发起。');
          setSourceLead(lead); form.resetFields();
          form.setFieldsValue({ leadId: lead.id, name: `${lead.community_name || lead.name || '客户'}施工项目`.slice(0, 80) });
          setEditor({ kind: 'create' }); creationEntry.current = '';
          const url = new URL(window.location.href); url.searchParams.delete('leadId');
          window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
        }
      }
    } catch (e) { if (alive.current && g === generation.current) { setError(errorText(e)); setDetail(null); setItems([]); } }
    finally { if (alive.current && g === generation.current) setLoading(false); }
  }, [form]);
  useEffect(() => {
    alive.current = true;
    let hasPending = false;
    try { const value = sessionStorage.getItem(storageKey); if (value) { setPending(JSON.parse(value)); hasPending = true; } } catch { /* Server state remains available through Refresh. */ }
    // Reconcile an earlier write before opening another project's create form.
    creationEntry.current = hasPending ? '' : new URLSearchParams(window.location.search).get('leadId') || '';
    void load();
    const requestGeneration = generation;
    return () => { alive.current = false; requestGeneration.current++; };
  }, [load, storageKey]);
  const send = async (operation: Pending) => {
    setBusy(true);
    try {
      const result = await constructionRequest<{ id: string; version: number; scope?: string }>(operation.path, { method: operation.method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operation.key }, body: JSON.stringify(operation.body) });
      if (!result.id || !Number.isInteger(result.version)) throw new ConstructionRequestError(true, '回执缺少操作标识，请核对同一次操作。');
      if (!alive.current) return;
      sessionStorage.removeItem(storageKey); setPending(null); setEditor(null); notify.success('施工资料已保存');
      const pid = result.scope === 'stages' ? selected : result.id;
      setSelected(pid); await load(pid);
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof ConstructionRequestError && !e.uncertain) { sessionStorage.removeItem(storageKey); setPending(null); }
      notify.error('操作未完成', { description: errorText(e) });
    } finally { if (alive.current) setBusy(false); }
  };
  const open = (kind: Editor['kind'], stage?: Stage) => {
    form.resetFields();
    if (kind === 'create') setSourceLead(null);
    if (kind === 'stages') form.setFieldsValue({ stages: settings.stages });
    if (kind === 'project' && detail) form.setFieldsValue({ name: detail.project.name, status: detail.project.status, customerAccess: detail.project.customer_access });
    if (kind === 'progress' && detail) form.setFieldsValue({ stageKey: detail.project.current_stage_key || detail.stages[0]?.key, note: detail.project.progress_note, sendReminder: false });
    if (kind === 'contact' && stage && detail) { const members = detail.assignments.filter(s => s.stage_key === stage.key); form.setFieldsValue({ staffIds: members.map(m => m.admin_id), primaryStaffId: members.find(m => m.is_primary)?.admin_id || null }); }
    if (kind === 'member') form.setFieldsValue({ role: 'worker', active: true, workLabel: '' });
    setEditor({ kind, stage });
  };
  const submit = async () => {
    if (!editor || pending) return;
    try {
      const values = await form.validateFields(), kind = editor.kind;
      let body: Record<string, unknown>, path = 'projects', method = 'POST';
      if (kind === 'stages') { path = 'stages'; method = 'PATCH'; body = { expectedVersion: settings.version, stages: values.stages }; }
      else if (kind === 'create') body = { leadId: values.leadId, managerId: values.managerId, name: values.name, rooms: String(values.rooms || '').split(/\n/).map(s => s.trim()).filter(Boolean) };
      else {
        if (!detail) return;
        path += '/' + detail.project.id; body = { expectedVersion: detail.project.version };
        if (kind === 'project') { method = 'PATCH'; Object.assign(body, { name: values.name, status: values.status, customerAccess: values.customerAccess }); }
        else {
          path += '/' + kind;
          if (kind === 'member') Object.assign(body, { adminId: values.adminId, role: values.role, active: values.active, workLabel: values.workLabel || '' });
          if (kind === 'room') Object.assign(body, { name: values.name, ...(editor.roomId ? { roomId: editor.roomId } : {}) });
          if (kind === 'contact') Object.assign(body, { stageKey: editor.stage!.key, staffIds: values.staffIds || [], primaryStaffId: values.primaryStaffId || null });
          if (kind === 'progress') Object.assign(body, { stageKey: values.stageKey, note: values.note || '', sendReminder: !!values.sendReminder });
        }
      }
      const operation = { path, method, body, key: crypto.randomUUID() };
      sessionStorage.setItem(storageKey, JSON.stringify(operation)); setPending(operation); await send(operation);
    } catch (e) { if (e instanceof Error) notify.error('请核对提交内容', { description: errorText(e) }); }
  };
  const disabled = busy || !!pending || loading;
  const staffOptions = (detail?.staff || catalog.staff).map(s => ({ value: String(s.id), label: `${s.display_name || '未填写姓名'}（${s.id}）` }));
  return <Space direction="vertical" size={20} style={{ width: '100%' }}>
    {pending && <Alert type="warning" showIcon message="上次提交结果待核对" description="将使用原请求核对同一次操作；核对前请勿重复创建或改动请求内容。" action={<Button loading={busy} onClick={() => void send(pending)}>核对上次提交</Button>} />}
    {error && <Alert type="error" showIcon message={error} action={<Button onClick={() => void load(selected)}>重新读取</Button>} />}
    <ProTable<Project> rowKey="id" search={false} options={false} loading={loading} dataSource={items} pagination={{ pageSize: 10 }}
      headerTitle="施工项目" toolBarRender={() => [<Button key="refresh" disabled={busy} onClick={() => void load(selected)}>刷新</Button>, ...(catalog.owner ? [<Button key="stages" disabled={disabled} onClick={() => open('stages')}>配置施工节点</Button>, <Button key="create" type="primary" disabled={disabled} onClick={() => open('create')}>建立项目</Button>] : [])]}
      columns={[
        { title: '项目', dataIndex: 'name' }, { title: '服务档案', dataIndex: 'lead_id' }, { title: '状态', render: (_, p) => <Tag>{labels[p.status]}</Tag> },
        { title: '实际节点', render: (_, p) => settings.stages.find(s => s.key === p.current_stage_key)?.name || '尚未标记' },
        { title: '客户可查看', render: (_, p) => p.customer_access ? '是' : '已收回' },
        { title: '操作', valueType: 'option', render: (_, p) => <Button type="link" disabled={busy} onClick={() => { setSelected(p.id); setDetail(null); void load(p.id); }}>查看项目</Button> },
      ]} />
    <Drawer title={detail?.project.name || '施工项目'} open={!!selected} width={960} onClose={() => { setSelected(''); setDetail(null); setLoading(false); generation.current++; }} loading={loading} extra={detail?.manage && <Button disabled={disabled} onClick={() => open('project')}>项目设置</Button>}>
      {detail && <Tabs destroyOnHidden items={[
        { key: 'stages', label: '节点与到场提醒', children: <Space direction="vertical" size={20} style={{ width: '100%' }}>
          <Alert type="info" showIcon message={'当前实际节点：' + (detail.stages.find(s => s.key === detail.project.current_stage_key)?.name || '尚未标记')} description={detail.project.progress_note || '由项目经理据现场实际进度更新。'} action={detail.manage && <Button disabled={disabled || detail.project.status !== 'active'} onClick={() => open('progress')}>更新实际节点</Button>} />
          <ProTable<Stage> rowKey="key" dataSource={detail.stages} search={false} options={false} pagination={false} headerTitle="施工节点与本项目联系人" columns={[
            { title: '节点', render: (_, s, i) => `${i+1}. ${s.name}` }, { title: '到场提醒', render: (_, s) => s.visitReminder ? '开启' : '关闭' },
            { title: '提醒内容 / 现场重点', render: (_, s) => <Space direction="vertical" size={4}><Typography.Text>{s.visitReason || '—'}</Typography.Text><Typography.Text type="secondary" style={{ whiteSpace: 'pre-wrap' }}>{s.watchPoints}</Typography.Text></Space> },
            { title: '分工 / 主要联系人', render: (_, s) => { const assigned = detail.assignments.filter(a => a.stage_key === s.key); return assigned.length ? assigned.map(a => `${a.display_name}${a.staff_status !== 'active' ? '（已停用）' : a.is_primary ? '（主要联系人）' : ''}`).join('、') : '待分配员工'; } },
            { title: '操作', valueType: 'option', render: (_, s) => detail.manage && <Button type="link" disabled={disabled} onClick={() => open('contact', s)}>分配阶段员工</Button> },
          ]} />
        </Space> },
        { key: 'team', label: '成员与房间', children: <Space direction="vertical" size={20} style={{ width: '100%' }}>
          <Alert type="info" showIcon message="项目成员仅获得本项目施工资料权限；不授予客户私聊、客户电话、线索归属或分佣权限。房间名称不写正式量房墙图。" />
          <ProTable<Detail['members'][number]> rowKey="admin_id" dataSource={detail.members} search={false} options={false} pagination={false} headerTitle="项目成员" toolBarRender={() => detail.manage ? [<Button key="member" disabled={disabled} onClick={() => open('member')}>设置成员</Button>] : []} columns={[
            { title: '员工', dataIndex: 'display_name' }, { title: '项目角色', render: (_, m) => labels[m.role] }, { title: '工地分工', dataIndex: 'work_label' }, { title: '状态', render: (_, m) => m.active && m.staff_status === 'active' ? '有效' : '已停用 / 移出' },
            { title: '操作', valueType: 'option', render: (_, m) => detail.manage && m.active && (detail.owner || m.role !== 'manager') && <Button type="link" disabled={disabled} onClick={() => { form.resetFields(); form.setFieldsValue({ adminId: m.admin_id, role: m.role, active: false, workLabel: m.work_label }); setEditor({ kind: 'member' }); }}>移出项目</Button> },
          ]} />
          <ProTable<Detail['rooms'][number]> rowKey="id" dataSource={detail.rooms} search={false} options={false} pagination={false} headerTitle="项目房间" toolBarRender={() => detail.manage ? [<Button key="room" disabled={disabled} onClick={() => open('room')}>添加房间</Button>] : []} columns={[{ title: '房间', dataIndex: 'name' }, { title: '操作', valueType: 'option', render: (_, r) => detail.manage && <Button type="link" disabled={disabled} onClick={() => { form.resetFields(); form.setFieldsValue({ name: r.name }); setEditor({ kind: 'room', roomId: r.id }); }}>修改名称</Button> }]} />
        </Space> },
        { key: 'public', label: '公开材料', children: <PublicationWorkbench key={identity+':'+selected} identity={identity} projectId={selected}/> },
      ]} />}
    </Drawer>
    <Modal title={editor ? ({ create: '建立施工项目', project: '项目设置', member: '设置项目成员', room: '项目房间', stages: '配置施工节点', contact: `${editor.stage?.name} · 联系管家电话`, progress: '更新实际施工节点' }[editor.kind]) : ''} width={editor?.kind === 'stages' ? 760 : 520} styles={{ body: { maxHeight: '65vh', overflowY: 'auto' } }} open={!!editor} onCancel={() => { if (!busy) setEditor(null); }} onOk={() => void submit()} confirmLoading={busy} okButtonProps={{ disabled: !!pending }} okText="保存" destroyOnHidden>
      <Form form={form} layout="vertical" disabled={disabled} preserve={false}>
        {editor?.kind === 'stages' && <>
          <Alert type="info" showIcon message="默认10个节点，可增删、调整名称和顺序。开启到场提醒须填写原因与现场重点。需求补问独立配置，实际进入节点时最多问一个缺项，已有或问过的需求不重复问；客户可稍后再聊。" style={{ marginBottom: 20 }} />
          <Form.List name="stages">{(fields, { add, remove, move }) => <Space direction="vertical" size={20} style={{ width: '100%' }}>
            {fields.map((field, i) => <div key={field.key}>
              <Space><Typography.Text strong>节点 {i+1}</Typography.Text><Button size="small" disabled={disabled || i === 0} onClick={() => move(i, i-1)}>上移</Button><Button size="small" disabled={disabled || i === fields.length-1} onClick={() => move(i, i+1)}>下移</Button><Button size="small" danger disabled={disabled || fields.length <= 1} onClick={() => remove(field.name)}>删除</Button></Space>
              <Form.Item name={[field.name, 'key']} hidden><Input /></Form.Item>
              <Form.Item name={[field.name, 'name']} label="节点名称" rules={[{ required: true, whitespace: true }]}><Input maxLength={30} /></Form.Item>
              <Form.Item name={[field.name, 'visitReminder']} label="小K主动提醒客户到场" valuePropName="checked"><Switch /></Form.Item>
              <Form.Item name={[field.name, 'visitReason']} label="到场提醒内容"><Input.TextArea maxLength={500} rows={2} /></Form.Item>
              <Form.Item name={[field.name, 'watchPoints']} label="到现场重点看什么"><Input.TextArea maxLength={2000} rows={3} /></Form.Item>
              <Typography.Text strong>需求补问（可选，按顺序选择一个缺项）</Typography.Text>
              <Form.List name={[field.name, 'followUps']}>{(prompts, { add: addPrompt, remove: removePrompt }) => <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {prompts.map(prompt => <div key={prompt.key}>
                  <Form.Item name={[prompt.name, 'field']} label="需求类型" rules={[{ required: true }]}><Select options={Object.entries(followUpFieldLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
                  <Form.Item name={[prompt.name, 'room']} label="房间名称" extra="房间需求须填准确房间名，并在问题中写出；全屋预算、时间、房屋与成员需求留空。"><Input maxLength={40} /></Form.Item>
                  <Form.Item name={[prompt.name, 'question']} label="向客户补问的话" rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={300} rows={2} /></Form.Item>
                  <Button size="small" danger onClick={() => removePrompt(prompt.name)}>移除补问</Button>
                </div>)}
                <Button size="small" disabled={disabled || prompts.length >= 3} onClick={() => addPrompt({ field: 'devices', room: '', question: '' })}>增加候选补问</Button>
              </Space>}</Form.List>
            </div>)}
            <Button disabled={disabled || fields.length >= 30} onClick={() => add({ key: 'stage-' + crypto.randomUUID(), name: '', visitReminder: false, visitReason: '', watchPoints: '' })}>增加节点</Button>
          </Space>}</Form.List>
        </>}
        {editor?.kind === 'create' && <>
          <Form.Item name="leadId" label="客户服务档案" extra={sourceLead ? '已从客户线索带入当前客户。' : undefined} rules={[{ required: true }]}><Select disabled={disabled || !!sourceLead} showSearch optionFilterProp="label" options={catalog.leads.map(l => ({ value: String(l.id), label: `${l.name || '客户'} · ${l.community_name || '服务档案'}（${l.id}）` }))} /></Form.Item>
          <Form.Item name="managerId" label="项目经理（本企业员工）" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={staffOptions} /></Form.Item>
          <Form.Item name="rooms" label="项目房间（可选，每行一个）"><Input.TextArea rows={3} maxLength={1500} /></Form.Item>
        </>}
        {editor && ['create','project','room'].includes(editor.kind) && <Form.Item name="name" label={editor.kind === 'room' ? '房间名称' : '项目名称'} rules={[{ required: true, whitespace: true }]}><Input maxLength={editor.kind === 'room' ? 50 : 80} /></Form.Item>}
        {editor?.kind === 'project' && <>
          <Form.Item name="status" label="项目状态" rules={[{ required: true }]}><Select options={options(['active','paused','archived'])} /></Form.Item>
          <Form.Item name="customerAccess" label="客户可查看节点并联系施工人员" valuePropName="checked" extra="收回后历史施工消息和电话入口失效；恢复或重新发送需据实际进度确认。"><Switch disabled={!detail?.owner} /></Form.Item>
        </>}
        {editor?.kind === 'progress' && <>
          <Form.Item name="stageKey" label="当前实际节点" rules={[{ required: true }]}><Select options={detail?.stages.map(s => ({ value: s.key, label: s.name }))} /></Form.Item>
          <Form.Item name="note" label="现场补充说明（客户可见）"><Input.TextArea maxLength={1000} rows={3} /></Form.Item>
          <Form.Item name="sendReminder" label="再次发送本节点到场提醒" valuePropName="checked" extra="切换到开启提醒的节点会自动提醒；普通重复保存不会重发。仅需再次提醒时开启此项。"><Switch /></Form.Item>
        </>}
        {editor?.kind === 'contact' && <>
          <Form.Item name="staffIds" label="本阶段负责员工" extra="只选本工地在职成员；清空即撤销本阶段分工。"><Select mode="multiple" options={detail?.members.filter(m => m.active && m.staff_status === 'active').map(m => ({ value: m.admin_id, label: m.display_name }))} /></Form.Item>
          <Form.Item noStyle shouldUpdate={(a,b) => a.staffIds !== b.staffIds}>{({ getFieldValue }) => <Form.Item name="primaryStaffId" label="对业主公开的主要联系人" extra="一人时自动带入；多人时明确指定。电话从当前有效员工资料读取，不在项目重复填写。"><Select allowClear options={detail?.members.filter(m => (getFieldValue('staffIds') || []).includes(m.admin_id)).map(m => ({ value: m.admin_id, label: m.display_name }))} /></Form.Item>}</Form.Item>
        </>}
        {editor?.kind === 'member' && <>
          <Form.Item name="adminId" label="本企业员工" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={staffOptions} /></Form.Item>
          <Form.Item name="role" label="项目角色" rules={[{ required: true }]}><Select options={options(detail?.owner ? ['manager','designer','worker','observer'] : ['designer','worker','observer'])} /></Form.Item>
          <Form.Item name="workLabel" label="工地分工"><Input maxLength={50} placeholder="如水电施工、油漆施工" /></Form.Item>
          <Form.Item name="active" label="保留本项目访问" valuePropName="checked"><Switch /></Form.Item>
        </>}
      </Form>
    </Modal>
  </Space>;
}
