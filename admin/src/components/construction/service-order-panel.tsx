'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { notify } from '@/components/admin/operation-feedback';
import { constructionRequest, errorText } from './client';

type QuoteLine = { label: string; amountCents: number };
type Repair = { id: string; status: string; issue: string; resolution: string; pointId: string | null; pointName: string | null; openedAt: string | null; closedAt: string | null; version: number };
type Order = {
  id: string; status: string; cameraCount: number; retentionDays: number; serviceDays: number; requestNote: string; version: number;
  quoteVersion: number; confirmedQuoteVersion: number | null; scheduledFor: string | null; installerId: string | null; installerName: string | null;
  acceptedAt: string | null; cancelledAt: string | null; cancelReason: string; createdAt: string | null; canAct: boolean;
  exitedAt: string | null; exitReason: string; depositReturnedCents: number | null; depositDeductedCents: number | null;
  depositNote: string; extensionDays: number; serviceEndsAt: string | null; repairs: Repair[];
  quote: { version: number; totalCents: number | null; depositCents: number | null; note: string; lines: QuoteLine[]; createdAt: string | null } | null;
  points: Array<{ id: string; seq: number; name: string; roomId: string | null; roomName: string | null; positionNote: string; status: string; installedAt: string | null; acceptedAt: string | null }>;
};
type Editor = { kind: 'create' } | { kind: 'quote' | 'schedule' | 'points' | 'cancel' | 'extend' | 'exit' | 'repair' | 'repairs'; order: Order }
  | { kind: 'resolve'; order: Order; repair: Repair };
const statusLabels: Record<string, string> = { pending_quote: '待报价', quoted: '待确认报价', confirmed: '待安排安装', scheduled: '安装验收中', accepted: '服务中', exited: '已退场', cancelled: '已取消' };
const statusColors: Record<string, string> = { pending_quote: 'default', quoted: 'processing', confirmed: 'processing', scheduled: 'warning', accepted: 'success', exited: 'red', cancelled: 'default' };
const pointLabels: Record<string, string> = { pending: '待安装', installed: '已安装', accepted: '已验收' };
const repairLabels: Record<string, string> = { open: '待处理', resolved: '已解决', cancelled: '已取消' };
const repairColors: Record<string, string> = { open: 'warning', resolved: 'success', cancelled: 'default' };
const yuan = (cents: number | null | undefined) => cents === null || cents === undefined ? '—' : '¥' + (cents / 100).toFixed(2);
const when = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—';
const open = (order: Order) => !['accepted', 'exited', 'cancelled'].includes(order.status);
const repairable = (order: Order) => ['scheduled', 'accepted'].includes(order.status);
const replaceable = (order: Order) => ['confirmed', 'scheduled'].includes(order.status) && order.points.every(point => point.status === 'pending');

export function ServiceOrderPanel({ projectId, owner, rooms, members }: {
  projectId: string; owner: boolean; rooms: Array<{ id: string; name: string }>;
  members: Array<{ admin_id: string; display_name: string; role: string; active: boolean; staff_status: string }>;
}) {
  const [items, setItems] = useState<Order[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [editor, setEditor] = useState<Editor | null>(null);
  const [formKey, setFormKey] = useState(0), [initial, setInitial] = useState<Record<string, unknown>>({});
  const [form] = Form.useForm(); const alive = useRef(true), requestSequence = useRef(0);
  const root = 'projects/' + projectId + '/service-orders';
  // Form.List rows mount from initialValues and can re-register before their item
  // values stick; re-apply the defaults once the modal has settled.
  useEffect(() => {
    if (!editor || !Object.keys(initial).length) return;
    const timer = setTimeout(() => { if (!form.isFieldsTouched()) form.setFieldsValue(initial); }, 400);
    return () => clearTimeout(timer);
  }, [editor, form, initial]);
  const load = useCallback(async () => {
    const sequence = ++requestSequence.current; setLoading(true);
    try {
      const state = await constructionRequest<{ items: Order[] }>(root);
      if (!alive.current || sequence !== requestSequence.current) return null;
      setItems(state.items); setError(''); return state.items;
    } catch (e) { if (alive.current && sequence === requestSequence.current) { setError(errorText(e)); setItems([]); } return null; }
    finally { if (alive.current && sequence === requestSequence.current) setLoading(false); }
  }, [root]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);
  const trackPoints = (latest: Order[] | null, points?: Order) => {
    if (!points || !latest) return;
    const fresh = latest.find(order => order.id === points.id);
    setEditor(fresh?.status === 'scheduled' ? { kind: 'points', order: fresh } : null);
  };
  const write = async (path: string, data: unknown, success: string, points?: Order) => {
    setBusy(true);
    try {
      await constructionRequest(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(data) });
      if (!alive.current) return;
      notify.success(success);
      const latest = await load();
      if (!alive.current) return;
      if (points) trackPoints(latest, points); else setEditor(null);
    } catch (e) { if (alive.current) { notify.error('托管订单操作未完成', { description: errorText(e) }); trackPoints(await load(), points); } }
    finally { if (alive.current) setBusy(false); }
  };
  const start = (next: Editor) => {
    setInitial(
      next.kind === 'create' ? { cameraCount: 5, retentionDays: 3, serviceDays: 90, note: '' }
      : next.kind === 'quote' ? { lines: [{ label: '云工地视频托管服务', amount: 0 }], deposit: 0, note: '' }
      : next.kind === 'schedule' ? { points: [{ name: '点位 1', positionNote: '' }] }
      : next.kind === 'cancel' ? { reason: '' }
      : next.kind === 'extend' ? { days: 30, note: '' }
      : next.kind === 'exit' ? { reason: '', returned: 0, deducted: 0, note: '' }
      : next.kind === 'repair' ? { issue: '' }
      : next.kind === 'resolve' ? { resolution: '' }
      : {},
    );
    setFormKey(key => key + 1);
    setEditor(next);
  };
  const submit = async () => {
    if (!editor) return;
    try {
      const values = await form.validateFields();
      if (editor.kind === 'create') return void await write(root, { cameraCount: Number(values.cameraCount), retentionDays: Number(values.retentionDays), serviceDays: Number(values.serviceDays), note: values.note || '' }, '托管订单已建立');
      const order = editor.order, base = root + '/' + order.id;
      if (editor.kind === 'quote') {
        const lines = (values.lines as Array<{ label: string; amount: number }>).map(line => ({ label: line.label, amountCents: Math.round(Number(line.amount || 0) * 100) }));
        return void await write(base + '/quote', { expectedVersion: order.version, lines, depositCents: Math.round(Number(values.deposit || 0) * 100), note: values.note || '' }, '报价已记录为第 ' + (order.quoteVersion + 1) + ' 版');
      }
      if (editor.kind === 'schedule') {
        const points = (values.points as Array<{ name: string; roomId?: string; positionNote?: string }>).map(point => ({ name: point.name, roomId: point.roomId || null, positionNote: point.positionNote || '' }));
        return void await write(base + '/schedule', { expectedVersion: order.version, scheduledFor: values.scheduledFor.toISOString(), installerId: values.installerId, points }, '安装安排与点位已记录');
      }
      if (editor.kind === 'cancel') return void await write(base + '/cancel', { expectedVersion: order.version, reason: values.reason }, '托管订单已取消');
      if (editor.kind === 'extend') return void await write(base + '/extend', { expectedVersion: order.version, days: Number(values.days), note: values.note || '' }, '服务期已延期');
      if (editor.kind === 'exit') return void await write(base + '/exit', {
        expectedVersion: order.version, reason: values.reason,
        depositReturnedCents: Math.round(Number(values.returned || 0) * 100), depositDeductedCents: Math.round(Number(values.deducted || 0) * 100),
        depositNote: values.note || '',
      }, '退场与押金处置已记录');
      if (editor.kind === 'repair') return void await write(base + '/repairs', { pointId: values.pointId || null, issue: values.issue }, '报修已登记');
      if (editor.kind === 'resolve') return void await write(base + '/repairs/' + editor.repair.id,
        { expectedVersion: editor.repair.version, action: 'resolve', resolution: values.resolution }, '报修已登记解决');
    } catch (e) { if (e instanceof Error && 'errorFields' in e) return; notify.error('请核对提交内容', { description: errorText(e) }); }
  };
  const act = async (order: Order, pointId: string, action: 'install' | 'accept') => {
    await write(root + '/' + order.id + '/points/' + pointId, { expectedVersion: order.version, action }, action === 'install' ? '点位已登记安装' : '点位已验收', order);
  };
  const installers = members.filter(member => member.active && member.staff_status === 'active' && member.role === 'manager');
  const openOrder = items.find(open);
  return <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    <Alert type="info" showIcon message="云工地视频托管订单" description="收费在线下完成：系统只记录订单、报价版本和安装点位验收，不收款、不退款，也不代表已经收到款项。摄像头路数、录像保留天数、服务期与金额以记录的版本为准。" />
    {error && <Alert type="error" showIcon message={error} action={<Button onClick={() => void load()}>重新读取</Button>} />}
    <Space wrap>
      <Button onClick={() => void load()} disabled={busy}>刷新</Button>
      {owner && !openOrder && <Button type="primary" disabled={busy || loading} onClick={() => start({ kind: 'create' })}>发起托管订单</Button>}
    </Space>
    <Table<Order> rowKey="id" size="small" loading={loading} dataSource={items} pagination={false} locale={{ emptyText: '尚未建立托管订单' }} columns={[
      { title: '订单', render: (_, order) => <Space direction="vertical" size={0}><Typography.Text>#{order.id}</Typography.Text><Typography.Text type="secondary">{when(order.createdAt)}</Typography.Text></Space> },
      { title: '状态', render: (_, order) => <Tag color={statusColors[order.status]}>{statusLabels[order.status] || order.status}</Tag> },
      { title: '服务内容', render: (_, order) => <Space direction="vertical" size={0}>
        <Typography.Text>{order.cameraCount} 路摄像头 · 录像保留 {order.retentionDays} 天 · 服务期 {order.serviceDays} 天</Typography.Text>
        {order.serviceEndsAt ? <Typography.Text type="secondary">服务期至 {when(order.serviceEndsAt)}{order.extensionDays > 0 ? '（已延期 ' + order.extensionDays + ' 天）' : ''}</Typography.Text> : null}
        {order.requestNote ? <Typography.Text type="secondary">{order.requestNote}</Typography.Text> : null}
      </Space> },
      { title: '报价', render: (_, order) => order.quote ? <Space direction="vertical" size={0}>
        <Typography.Text>第 {order.quote.version} 版 · 合计 {yuan(order.quote.totalCents)} · 押金 {yuan(order.quote.depositCents)}</Typography.Text>
        <Typography.Text type="secondary">{order.confirmedQuoteVersion === order.quote.version ? '负责人已确认这一版' : '尚未确认这一版'}</Typography.Text>
      </Space> : <Typography.Text type="secondary">尚未录入报价</Typography.Text> },
      { title: '安装与验收', render: (_, order) => order.status === 'cancelled' ? <Typography.Text type="secondary">已取消：{order.cancelReason}</Typography.Text>
        : order.exitedAt ? <Space direction="vertical" size={0}>
          <Typography.Text>退场于 {when(order.exitedAt)}</Typography.Text>
          <Typography.Text type="secondary">原因：{order.exitReason}</Typography.Text>
          <Typography.Text type="secondary">押金记录：退回 {yuan(order.depositReturnedCents)} · 扣减 {yuan(order.depositDeductedCents)}{order.depositNote ? ' · ' + order.depositNote : ''}</Typography.Text>
        </Space>
        : order.scheduledFor ? <Space direction="vertical" size={0}>
          <Typography.Text>{when(order.scheduledFor)}{order.installerName ? ' · ' + order.installerName : ''}</Typography.Text>
          <Typography.Text type="secondary">已验收 {order.points.filter(point => point.status === 'accepted').length}/{order.points.length} 个点位</Typography.Text>
        </Space> : <Typography.Text type="secondary">尚未安排安装</Typography.Text> },
      { title: '售后', render: (_, order) => order.repairs.length === 0 ? <Typography.Text type="secondary">无报修</Typography.Text>
        : <Button type="link" size="small" disabled={busy} onClick={() => start({ kind: 'repairs', order })}>
          报修 {order.repairs.filter(repair => repair.status === 'open').length} 待处理 / 共 {order.repairs.length} 条
        </Button> },
      { title: '操作', render: (_, order) => <Space wrap size={4}>
        {owner && ['pending_quote', 'quoted', 'confirmed'].includes(order.status) && <Button type="link" size="small" disabled={busy} onClick={() => start({ kind: 'quote', order })}>{order.quote ? '录入新报价' : '录入报价'}</Button>}
        {owner && order.status === 'quoted' && <Popconfirm title={'确认第 ' + order.quoteVersion + ' 版报价？'} description={'合计 ' + yuan(order.quote?.totalCents) + '，押金 ' + yuan(order.quote?.depositCents) + '。确认后只能通过新报价版本修改。'} okText="确认" cancelText="再看看" onConfirm={() => void write(root + '/' + order.id + '/confirm', { expectedVersion: order.version, quoteVersion: order.quoteVersion }, '已确认第 ' + order.quoteVersion + ' 版报价')}>
          <Button type="link" size="small" disabled={busy}>确认报价</Button></Popconfirm>}
        {owner && replaceable(order) && <Button type="link" size="small" disabled={busy} onClick={() => start({ kind: 'schedule', order })}>{order.status === 'scheduled' ? '调整安装安排' : '安排安装'}</Button>}
        {order.canAct && order.status === 'scheduled' && <Button type="link" size="small" disabled={busy} onClick={() => start({ kind: 'points', order })}>点位验收</Button>}
        {(owner || order.canAct) && repairable(order) && <Button type="link" size="small" disabled={busy} onClick={() => start({ kind: 'repair', order })}>登记报修</Button>}
        {owner && order.status === 'accepted' && <Button type="link" size="small" disabled={busy} onClick={() => start({ kind: 'extend', order })}>延期</Button>}
        {owner && order.status === 'accepted' && <Button type="link" size="small" danger disabled={busy} onClick={() => start({ kind: 'exit', order })}>办理退场</Button>}
        {owner && open(order) && <Button type="link" size="small" danger disabled={busy} onClick={() => start({ kind: 'cancel', order })}>取消订单</Button>}
      </Space> },
    ]} />
    <Modal title={{ create: '发起托管订单', quote: '录入报价', schedule: '安排安装与点位', points: '点位安装与验收', cancel: '取消托管订单',
      extend: '延期托管服务', exit: '办理退场与押金处置', repair: '登记报修', repairs: '售后记录', resolve: '登记报修解决' }[editor?.kind || 'create']} open={!!editor}
      width={editor?.kind === 'schedule' || editor?.kind === 'points' || editor?.kind === 'repairs' ? 720 : 520} styles={{ body: { maxHeight: '65vh', overflowY: 'auto' } }}
      onCancel={() => { if (!busy) setEditor(null); }} onOk={() => void submit()} confirmLoading={busy} footer={editor?.kind === 'repairs' ? null : undefined}
      okText={editor?.kind === 'cancel' ? '确认取消订单' : editor?.kind === 'exit' ? '确认退场' : editor?.kind === 'resolve' ? '登记解决' : '保存'}
      okButtonProps={{ disabled: busy, danger: editor?.kind === 'cancel' || editor?.kind === 'exit' }} forceRender>
      <Form key={formKey} form={form} layout="vertical" disabled={busy} preserve={false} initialValues={initial}>
        {editor?.kind === 'create' && <>
          <Form.Item name="cameraCount" label="摄像头路数" rules={[{ required: true }]}><InputNumber min={1} max={8} precision={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="retentionDays" label="录像保留天数" rules={[{ required: true }]}><InputNumber min={1} max={30} precision={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="serviceDays" label="服务期（天，从安装验收通过起算）" rules={[{ required: true }]}><InputNumber min={1} max={3650} precision={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="note" label="需求说明（可选）"><Input.TextArea rows={2} maxLength={200} /></Form.Item>
        </>}
        {editor?.kind === 'quote' && <>
          <Alert type="info" showIcon message="新报价是一个独立版本；确认新版本前，旧版本的确认自动失效。" style={{ marginBottom: 16 }} />
          <Form.List name="lines">{(fields, { add, remove }) => <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {fields.map((field, i) => <Space key={field.key} align="baseline" wrap>
              <Form.Item name={[field.name, 'label']} label={i === 0 ? '收费项目' : undefined} rules={[{ required: true, whitespace: true }]}><Input maxLength={40} placeholder="如：云工地视频托管服务" /></Form.Item>
              <Form.Item name={[field.name, 'amount']} label={i === 0 ? '金额（元）' : undefined} rules={[{ required: true }]}><InputNumber min={0} max={1000000000} precision={2} addonBefore="¥" /></Form.Item>
              <Button size="small" danger disabled={fields.length <= 1} onClick={() => remove(field.name)}>移除</Button>
            </Space>)}
            <Button size="small" disabled={fields.length >= 10} onClick={() => add({ label: '', amount: 0 })}>增加收费项目</Button>
          </Space>}</Form.List>
          <Form.Item name="deposit" label="押金（元，可选）" rules={[{ required: true }]}><InputNumber min={0} max={1000000000} precision={2} addonBefore="¥" style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="note" label="报价说明（可选）"><Input.TextArea rows={2} maxLength={500} /></Form.Item>
        </>}
        {editor?.kind === 'schedule' && <>
          {installers.length === 0 && <Alert type="warning" showIcon message="本项目尚无项目经理。请先在“成员与房间”中设置项目经理，再安排安装。" style={{ marginBottom: 16 }} />}
          <Form.Item name="scheduledFor" label="安装日期" rules={[{ required: true, message: '请选择安装日期' }]}><DatePicker showTime style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="installerId" label="安装负责人（本工程地项目经理）" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={installers.map(member => ({ value: member.admin_id, label: member.display_name }))} /></Form.Item>
          <Form.List name="points">{(fields, { add, remove }) => <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {fields.map((field, i) => <Space key={field.key} align="baseline" wrap>
              <Form.Item name={[field.name, 'name']} label={i === 0 ? '安装点位' : undefined} rules={[{ required: true, whitespace: true }]}><Input maxLength={40} placeholder="如：客厅东墙" /></Form.Item>
              <Form.Item name={[field.name, 'roomId']} label={i === 0 ? '对应房间（可选）' : undefined}><Select allowClear style={{ width: 160 }} options={rooms.map(room => ({ value: room.id, label: room.name }))} /></Form.Item>
              <Form.Item name={[field.name, 'positionNote']} label={i === 0 ? '位置说明（可选）' : undefined}><Input maxLength={200} /></Form.Item>
              <Button size="small" danger disabled={fields.length <= 1} onClick={() => remove(field.name)}>移除</Button>
            </Space>)}
            <Button size="small" disabled={fields.length >= 8} onClick={() => add({ name: '点位 ' + (fields.length + 1), roomId: undefined, positionNote: '' })}>增加点位</Button>
          </Space>}</Form.List>
        </>}
        {editor?.kind === 'points' && editor.order && <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert type="warning" showIcon message="点位须先登记安装，才能验收；全部点位验收通过后订单自动完成，服务期从验收通过起算。" />
          {editor.order.points.map(point => <Space key={point.id} wrap>
            <Typography.Text strong>{point.seq}. {point.name}</Typography.Text>
            <Typography.Text type="secondary">{point.roomName || '未关联房间'}{point.positionNote ? ' · ' + point.positionNote : ''}</Typography.Text>
            <Tag>{pointLabels[point.status] || point.status}</Tag>
            {point.status === 'pending' && <Button size="small" disabled={busy} onClick={() => void act(editor.order, point.id, 'install')}>登记已安装</Button>}
            {point.status === 'installed' && <Button size="small" type="primary" disabled={busy} onClick={() => void act(editor.order, point.id, 'accept')}>验收通过</Button>}
            {point.status === 'accepted' && <Typography.Text type="secondary">验收于 {when(point.acceptedAt)}</Typography.Text>}
          </Space>)}
        </Space>}
        {editor?.kind === 'cancel' && <>
          <Alert type="warning" showIcon message="取消后订单保留为历史记录，已登记的点位证据不删除；之后可重新发起新订单。" style={{ marginBottom: 16 }} />
          <Form.Item name="reason" label="取消原因" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={2} maxLength={200} /></Form.Item>
        </>}
        {editor?.kind === 'extend' && <>
          <Alert type="info" showIcon message="服务期从全部点位验收通过起算；延期只记录新的服务天数，费用与结算在线下另行确认。" style={{ marginBottom: 16 }} />
          <Form.Item name="days" label="延长天数" rules={[{ required: true }]}><InputNumber min={1} max={3650} precision={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="note" label="延期说明（可选）"><Input.TextArea rows={2} maxLength={200} /></Form.Item>
        </>}
        {editor?.kind === 'exit' && <>
          <Alert type="warning" showIcon message="退场前须先在“工地视频”Tab解除全部摄像头绑定并停止录像，并关闭所有未解决的报修。押金只在系统记录退回与扣减，线下结算，系统不收款、不退款。" style={{ marginBottom: 16 }} />
          {editor.order.quote?.depositCents ? <Alert type="info" showIcon message={'已确认报价押金：' + yuan(editor.order.quote.depositCents) + '。'} style={{ marginBottom: 16 }} /> : null}
          <Form.Item name="reason" label="退场原因" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={2} maxLength={200} /></Form.Item>
          <Form.Item name="returned" label="押金退回（元，线下完成）" rules={[{ required: true }]}><InputNumber min={0} max={1000000000} precision={2} addonBefore="¥" style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="deducted" label="押金扣减（元，线下完成）" rules={[{ required: true }]}><InputNumber min={0} max={1000000000} precision={2} addonBefore="¥" style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="note" label="押金处置说明（可选）"><Input.TextArea rows={2} maxLength={200} /></Form.Item>
        </>}
        {editor?.kind === 'repair' && <>
          <Alert type="info" showIcon message="报修只记录在本订单的售后历史；处理进展与结果由负责人或安装负责人登记。" style={{ marginBottom: 16 }} />
          <Form.Item name="pointId" label="关联点位（可选）"><Select allowClear options={editor.order.points.map(point => ({ value: point.id, label: point.seq + '. ' + point.name }))} /></Form.Item>
          <Form.Item name="issue" label="故障或问题描述" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={3} maxLength={500} /></Form.Item>
        </>}
        {editor?.kind === 'resolve' && <>
          <Typography.Paragraph type="secondary">{editor.repair.issue}</Typography.Paragraph>
          <Form.Item name="resolution" label="处理结果" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={3} maxLength={200} /></Form.Item>
        </>}
        {editor?.kind === 'repairs' && <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {editor.order.repairs.length === 0 && <Alert type="info" showIcon message="暂无报修记录" />}
          {editor.order.repairs.map(repair => <Space key={repair.id} wrap>
            <Tag color={repairColors[repair.status]}>{repairLabels[repair.status] || repair.status}</Tag>
            <Typography.Text>{repair.issue}</Typography.Text>
            <Typography.Text type="secondary">{repair.pointName ? '点位：' + repair.pointName + ' · ' : ''}{when(repair.openedAt)}{repair.closedAt ? ' · 关闭于 ' + when(repair.closedAt) : ''}</Typography.Text>
            {repair.resolution ? <Typography.Text type="secondary">处理结果：{repair.resolution}</Typography.Text> : null}
            {repair.status === 'open' && (owner || editor.order.canAct) && <Button size="small" type="primary" disabled={busy} onClick={() => start({ kind: 'resolve', order: editor.order, repair })}>登记解决</Button>}
            {repair.status === 'open' && owner && <Popconfirm title="取消这条报修？" okText="取消报修" cancelText="返回" onConfirm={() => void write(root + '/' + editor.order.id + '/repairs/' + repair.id, { expectedVersion: repair.version, action: 'cancel', resolution: '' }, '报修已取消')}><Button size="small" disabled={busy}>取消</Button></Popconfirm>}
          </Space>)}
        </Space>}
      </Form>
    </Modal>
  </Space>;
}
