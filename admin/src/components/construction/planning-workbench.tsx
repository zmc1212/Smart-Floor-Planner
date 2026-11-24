'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { Alert, Button, Checkbox, DatePicker, Drawer, Form, Input, Modal, Radio, Select, Space, Switch, Tabs, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { PublicationWorkbench } from './publication-workbench';
import { CameraPanel } from './camera-panel';
import { ServiceOrderPanel } from './service-order-panel';
import { milestoneCompletionDate, SchedulePanel, type ScheduleEditorKind } from './schedule-panel';
import { notify } from '@/components/admin/operation-feedback';
import type { MilestoneChange } from '@/lib/construction/schedule-milestones';
import { constructionRequest, ConstructionRequestError, errorText, labels, followUpFieldLabels, type ConstructionLead, type Detail, type Milestone, type Pending, type Project, type Staff, type Stage, type StageSettings } from './client';

const options = (keys: string[]) => keys.map(value => ({ value, label: labels[value] }));
type ScheduleEditor = { kind: ScheduleEditorKind; version: number; milestone?: Milestone };
type Editor = { kind: 'create' | 'project' | 'member' | 'room' | 'stages' | 'contact' | 'progress' | 'schedule';
  stage?: Stage; roomId?: string; schedule?: ScheduleEditor };
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
  const [formKey, setFormKey] = useState(0), [initial, setInitial] = useState<Record<string, unknown>>({});
  const [form] = Form.useForm(); const storageKey = 'construction:pending:' + identity;
  const alive = useRef(true), generation = useRef(0), creationEntry = useRef('');
  // Form.List rows mount from initialValues and can re-register before their item
  // values stick; re-apply the defaults once the modal has settled.
  useEffect(() => {
    if (!editor || !Object.keys(initial).length) return;
    const timer = setTimeout(() => { if (!form.isFieldsTouched()) form.setFieldsValue(initial); }, 400);
    return () => clearTimeout(timer);
  }, [editor, form, initial]);
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
          setSourceLead(lead); setInitial({ leadId: lead.id, name: `${lead.community_name || lead.name || '客户'}施工项目`.slice(0, 80) }); setFormKey(key => key + 1);
          setEditor({ kind: 'create' }); creationEntry.current = '';
          const url = new URL(window.location.href); url.searchParams.delete('leadId');
          window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
        }
      }
    } catch (e) { if (alive.current && g === generation.current) { setError(errorText(e)); setDetail(null); setItems([]); } }
    finally { if (alive.current && g === generation.current) setLoading(false); }
  }, []);
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
      const result = await constructionRequest<{ id: string; version: number; scope?: string; scheduleId?: string }>(operation.path, { method: operation.method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operation.key }, body: JSON.stringify(operation.body) });
      if (operation.path.endsWith('/schedule') && (result.scope !== 'schedule' || !result.scheduleId || result.id !== operation.path.split('/')[1])) {
        throw new ConstructionRequestError(true, '排期回执缺少操作标识，请核对同一次操作。');
      }
      if (!result.id || !Number.isInteger(result.version)) throw new ConstructionRequestError(true, '回执缺少操作标识，请核对同一次操作。');
      if (!alive.current) return;
      sessionStorage.removeItem(storageKey); setPending(null); setEditor(null);
      notify.success(result.scope === 'schedule' ? '施工计划已保存' : '施工资料已保存');
      const pid = result.scope === 'stages' ? selected : result.id;
      setSelected(pid); await load(pid);
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof ConstructionRequestError && !e.uncertain) { sessionStorage.removeItem(storageKey); setPending(null); }
      notify.error('操作未完成', { description: errorText(e) });
      if (operation.path.endsWith('/schedule') && e instanceof ConstructionRequestError && !e.uncertain) {
        if ([401, 403, 404].includes(e.statusCode ?? 0)) setEditor(null);
        if (e.statusCode === 409 || [401, 403, 404].includes(e.statusCode ?? 0)) await load(selected);
      }
    } finally { if (alive.current) setBusy(false); }
  };
  const open = (kind: Editor['kind'], stage?: Stage) => {
    if (kind === 'create') setSourceLead(null);
    setInitial(
      kind === 'stages' ? { stages: settings.stages }
      : kind === 'project' && detail ? { name: detail.project.name, status: detail.project.status, customerAccess: detail.project.customer_access }
      : kind === 'progress' && detail ? { stageKey: detail.project.current_stage_key || detail.stages[0]?.key, note: detail.project.progress_note, sendReminder: false }
      : kind === 'contact' && stage && detail ? (() => { const members = detail.assignments.filter(s => s.stage_key === stage.key); return { staffIds: members.map(m => m.admin_id), primaryStaffId: members.find(m => m.is_primary)?.admin_id || null }; })()
      : kind === 'member' ? { role: 'worker', active: true, workLabel: '' }
      : {},
    );
    setFormKey(key => key + 1);
    setEditor({ kind, stage });
  };
  const schedule = editor?.schedule;
  const currentMilestone = detail?.progress?.management?.milestones.find(row => row.key === schedule?.milestone?.key);
  const scheduleStale = !!schedule && schedule.version !== detail?.progress?.version;
  const openSchedule = (kind: ScheduleEditorKind, milestone?: Milestone) => {
    if (!detail?.progress?.management || (!detail.manage && kind !== 'view')) return;
    setInitial({
      outcome: 'ongoing',
      estimate: milestone?.estimate ? [dayjs(milestone.estimate.start), dayjs(milestone.estimate.end)] : undefined,
      date: milestone?.agreedDate ? dayjs(milestone.agreedDate) : undefined,
      note: milestone?.note || '',
    });
    setFormKey(key => key + 1);
    setEditor({ kind: 'schedule', schedule: { kind, milestone, version: detail.progress.version } });
  };
  const submit = async () => {
    if (!editor || pending) return;
    try {
      const values = await form.validateFields(), kind = editor.kind;
      let body: Record<string, unknown>, path = 'projects', method = 'POST';
      if (kind === 'stages') { path = 'stages'; method = 'PATCH'; body = { expectedVersion: settings.version, stages: values.stages }; }
      else if (kind === 'create') body = { leadId: values.leadId, managerId: values.managerId, name: values.name, rooms: String(values.rooms || '').split(/\n/).map(s => s.trim()).filter(Boolean) };
      else if (kind === 'schedule') {
        if (schedule?.kind === 'view') { setEditor(null); return; }
        if (!detail?.manage || detail.project.status !== 'active' || !schedule || scheduleStale) return;
        const key = schedule.milestone?.key;
        let change: MilestoneChange;
        if (schedule.kind === 'template') change = { kind: 'template' };
        else if (!key) return;
        else if (schedule.kind === 'agreement') change = { kind: 'agreement', key, date: values.date.format('YYYY-MM-DD'), reason: values.reason || '', confirmedOffline: true };
        else change = { kind: 'followup', key, outcome: values.outcome, note: values.note || '',
          estimate: values.estimate ? { start: values.estimate[0].format('YYYY-MM-DD'), end: values.estimate[1].format('YYYY-MM-DD') } : null };
        path += '/' + detail.project.id + '/schedule';
        body = { expectedVersion: schedule.version, change };
      }
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
          {detail.progress && <SchedulePanel progress={detail.progress} disabled={disabled || !detail.manage || detail.project.status !== 'active'} open={openSchedule} />}
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
            { title: '操作', valueType: 'option', render: (_, m) => detail.manage && m.active && (detail.owner || m.role !== 'manager') && <Button type="link" disabled={disabled} onClick={() => { setInitial({ adminId: m.admin_id, role: m.role, active: false, workLabel: m.work_label }); setFormKey(key => key + 1); setEditor({ kind: 'member' }); }}>移出项目</Button> },
          ]} />
          <ProTable<Detail['rooms'][number]> rowKey="id" dataSource={detail.rooms} search={false} options={false} pagination={false} headerTitle="项目房间" toolBarRender={() => detail.manage ? [<Button key="room" disabled={disabled} onClick={() => open('room')}>添加房间</Button>] : []} columns={[{ title: '房间', dataIndex: 'name' }, { title: '操作', valueType: 'option', render: (_, r) => detail.manage && <Button type="link" disabled={disabled} onClick={() => { setInitial({ name: r.name }); setFormKey(key => key + 1); setEditor({ kind: 'room', roomId: r.id }); }}>修改名称</Button> }]} />
        </Space> },
        { key: 'public', label: '公开材料', children: <PublicationWorkbench key={identity+':'+selected} identity={identity} projectId={selected}/> },
        { key: 'service', label: '托管服务', children: <ServiceOrderPanel key={identity+':'+selected} projectId={selected} owner={detail.owner} rooms={detail.rooms} members={detail.members} /> },
        { key: 'video', label: '工地视频', children: <CameraPanel key={identity+':'+selected} projectId={selected} /> },
      ]} />}
    </Drawer>
    <Modal zIndex={1200} title={editor ? ({ create: '建立施工项目', project: '项目设置', member: '设置项目成员', room: '项目房间', stages: '配置施工节点', contact: `${editor.stage?.name} · 联系管家电话`, progress: '更新实际施工节点',
      schedule: schedule?.kind === 'template' ? '套用阶段模板' : schedule?.kind === 'agreement' ? (schedule.milestone?.agreedDate ? '登记改期' : '登记约定日期') : schedule?.kind === 'view' ? '节点进展' : '跟进节点' }[editor.kind]) : ''} width={editor?.kind === 'stages' ? 760 : 520} styles={{ body: { maxHeight: '65vh', overflowY: 'auto' } }} open={!!editor} onCancel={() => { if (!busy) setEditor(null); }} onOk={() => void submit()} confirmLoading={busy} okButtonProps={{ disabled: !!pending || scheduleStale && schedule?.kind !== 'view' || (!!schedule && schedule.kind !== 'view' && (!detail?.manage || detail.project.status !== 'active')) }} okText={schedule?.kind === 'template' ? '套用模板' : schedule?.kind === 'view' ? '关闭' : schedule?.kind === 'agreement' ? '登记已确认日期' : schedule ? '保存跟进' : '保存'} forceRender>
      {schedule && pending && <Alert showIcon type="warning" message="上次提交结果待核对" action={<Button loading={busy} onClick={() => void send(pending)}>核对上次提交</Button>} />}
      {scheduleStale && schedule?.kind !== 'view' && <Alert showIcon type="warning" style={{ marginBottom: 16 }} message={currentMilestone ? '当前计划 · ' + currentMilestone.timeText : '施工计划已有更新'}
        action={detail?.manage && detail.progress?.management && (schedule?.kind === 'template' || currentMilestone?.valid && !currentMilestone.completedAt) && <Button disabled={busy || !!pending} onClick={() => {
          form.setFieldValue('confirmedOffline', false);
          setEditor({ kind: 'schedule', schedule: { kind: schedule!.kind, milestone: currentMilestone, version: detail.progress.version } });
        }}>已核对最新计划</Button>} />}
      <Form key={formKey} form={form} layout="vertical" disabled={disabled} preserve={false} initialValues={initial}
        onValuesChange={values => { if (schedule?.kind === 'agreement' && Object.hasOwn(values, 'date')) form.setFieldValue('confirmedOffline', false); }}>
        {schedule?.kind === 'template' && <Space direction="vertical">
          <Typography.Text strong>标准整装</Typography.Text>
          {detail?.progress?.management?.template.map(row => <Typography.Text key={row.key}>{row.name}</Typography.Text>)}
        </Space>}
        {schedule?.kind === 'view' && schedule.milestone && <Space direction="vertical">
          <Typography.Text strong>{schedule.milestone.name}</Typography.Text>
          <Typography.Text>{schedule.milestone.completedAt ? '完成于 ' + milestoneCompletionDate(schedule.milestone.completedAt) : schedule.milestone.label}</Typography.Text>
          {schedule.milestone.note && <Typography.Text>{schedule.milestone.note}</Typography.Text>}
        </Space>}
        {schedule?.kind === 'followup' && schedule.milestone && <>
          <Typography.Paragraph strong>{schedule.milestone.name} · {schedule.milestone.timeText}</Typography.Paragraph>
          {!!schedule.milestone.overdueDays && <Alert type="warning" showIcon message={`超出预计 ${schedule.milestone.overdueDays} 天 · 待核实`} style={{ marginBottom: 16 }} />}
          <Form.Item name="outcome" label="现场情况" extra={schedule.milestone.canConfirmCompletion ? undefined : '已完成需有真实阶段记录，请先核对实际节点。'}>
            <Radio.Group options={[{ label: '已完成', value: 'completed', disabled: !schedule.milestone.canConfirmCompletion }, { label: '仍在施工', value: 'ongoing' }]} optionType="button" />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.outcome !== b.outcome}>
            {({ getFieldValue }) => getFieldValue('outcome') !== 'completed' && <Form.Item name="estimate" label="新的预计完成时间">
              <DatePicker.RangePicker style={{ width: '100%' }} />
            </Form.Item>}
          </Form.Item>
          <Form.Item name="note" label="说明（选填）"><Input.TextArea maxLength={500} rows={2} /></Form.Item>
        </>}
        {schedule?.kind === 'agreement' && schedule.milestone && <>
          <Typography.Paragraph strong>{schedule.milestone.name}</Typography.Paragraph>
          <Typography.Paragraph>原约定 · {schedule.milestone.agreedDate || '尚未登记'}</Typography.Paragraph>
          <Form.Item name="date" label="双方确认的日期" rules={[{ required: true, message: '请选择日期' }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="reason" label={schedule.milestone.agreedDate ? '改期原因' : '说明（选填）'} rules={[{ required: !!schedule.milestone.agreedDate, whitespace: true, message: '请填写改期原因' }]}>
            <Input.TextArea maxLength={500} rows={2} />
          </Form.Item>
          <Form.Item name="confirmedOffline" valuePropName="checked" rules={[{ validator: (_, value) => value === true ? Promise.resolve() : Promise.reject(new Error('请先与业主线下确认日期')) }]}>
            <Checkbox>已与业主线下确认该日期</Checkbox>
          </Form.Item>
        </>}
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
              <Typography.Text strong>必须到场审核的工序</Typography.Text>
              <Form.List name={[field.name, 'inspectionCheckpoints']}>{(checkpoints, { add: addCheckpoint, remove: removeCheckpoint }) => <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 16 }}>
                {checkpoints.map(checkpoint => <Space key={checkpoint.key} align="baseline">
                  <Form.Item name={[checkpoint.name, 'key']} hidden><Input /></Form.Item>
                  <Form.Item name={[checkpoint.name, 'name']} rules={[{ required: true, whitespace: true, message: '填写工序名称' }]}>
                    <Input aria-label="必须到场的工序名称" placeholder="工序名称" maxLength={60} />
                  </Form.Item>
                  <Button size="small" danger disabled={disabled} onClick={() => removeCheckpoint(checkpoint.name)}>移除</Button>
                </Space>)}
                <Button size="small" disabled={disabled || checkpoints.length >= 15} onClick={() => addCheckpoint({ key: 'inspection-' + crypto.randomUUID(), name: '' })}>添加必到工序</Button>
              </Space>}</Form.List>
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
