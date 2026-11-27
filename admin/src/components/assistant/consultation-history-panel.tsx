'use client';

import { useEffect, useState } from 'react';
import { ProTable, type ProColumns } from '@ant-design/pro-components';
import { Alert, Button, DatePicker, Descriptions, Drawer, Form, Input, List, Select, Skeleton, Space, Tag, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import type { ConsultationDetail, ConsultationPage, ConsultationReception, ConsultationRecord } from '@/lib/assistant/core/consultation-history';
import { assistantError, assistantRequest, formatTime, statusLabels } from './client';

const receptionLabels: Record<ConsultationReception, string> = {
  ai: '未转人工', waiting: '待接管', active: '真人接续中', ended: '接续结束', cancelled: '接续已取消',
};
const authors: Record<string, string> = { user: '客户原话', assistant: '小K', admin: '真人回复', system: '服务提示' };
type Filters = { customer?: string; reception?: ConsultationReception; dates?: [Dayjs, Dayjs] };
type ListRequest = { query: string; cursor?: NonNullable<ConsultationPage['nextCursor']> };

function customerLabel(record: ConsultationRecord) {
  return record.customerName || `客户 #${record.customerId}`;
}

function ConsultationDrawer({ record, onClose }: { record: ConsultationRecord; onClose: () => void }) {
  const [detail, setDetail] = useState<ConsultationDetail>();
  const [request, setRequest] = useState<{ beforeSeq?: string }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const path = `consultations/${record.id}${request.beforeSeq ? `?beforeSeq=${request.beforeSeq}` : ''}`;
    void assistantRequest<ConsultationDetail>(path, { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return;
      setDetail(previous => ({ ...data, messages: request.beforeSeq && previous ? [...data.messages, ...previous.messages] : data.messages }));
    }).catch(cause => {
      if (controller.signal.aborted) return;
      setDetail(undefined);
      setError(assistantError(cause));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [record.id, request]);

  const load = (beforeSeq?: string) => {
    setLoading(true);
    setError('');
    setRequest({ beforeSeq });
  };
  return <Drawer open title={record.title} width="min(720px, 100vw)" onClose={onClose}>
    {error && <Alert type="error" showIcon message={error} action={<Button onClick={() => load()}>重新加载</Button>} />}
    {loading && !detail && <Skeleton active />}
    {detail && <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Descriptions column={1} items={[
        { key: 'customer', label: '客户', children: customerLabel(detail.record) },
        { key: 'reception', label: '接待状态', children: receptionLabels[detail.record.reception] },
        { key: 'activity', label: '最近活动', children: formatTime(detail.record.updatedAt) },
      ]} />
      {detail.nextCursor && <Button loading={loading} onClick={() => load(detail.nextCursor!)}>加载更早的消息</Button>}
      <List rowKey="id" dataSource={detail.messages} locale={{ emptyText: '暂无对话消息' }} renderItem={message => <List.Item>
        <Space direction="vertical" style={{ maxWidth: '100%' }}>
          <Space wrap><Tag>{authors[message.authorKind] || '消息'}</Tag><Typography.Text type="secondary">{formatTime(message.createdAt)}</Typography.Text></Space>
          <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message.text}</Typography.Paragraph>
        </Space>
      </List.Item>} />
    </Space>}
  </Drawer>;
}

export function ConsultationHistoryPanel() {
  const [form] = Form.useForm<Filters>();
  const [request, setRequest] = useState<ListRequest>({ query: '' });
  const [items, setItems] = useState<ConsultationRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<ConsultationPage['nextCursor']>(null);
  const [selected, setSelected] = useState<ConsultationRecord>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams(request.query);
    if (request.cursor) {
      query.set('beforeAt', request.cursor.at);
      query.set('beforeId', request.cursor.id);
    }
    void assistantRequest<ConsultationPage>(`consultations?${query}`, { signal: controller.signal }).then(page => {
      if (controller.signal.aborted) return;
      setItems(previous => request.cursor ? [...previous, ...page.items] : page.items);
      setNextCursor(page.nextCursor);
    }).catch(cause => {
      if (controller.signal.aborted) return;
      setItems([]);
      setNextCursor(null);
      setError(assistantError(cause));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [request]);

  const load = (next: ListRequest) => {
    setLoading(true);
    setError('');
    setRequest(next);
  };
  const search = (values: Filters) => {
    const query = new URLSearchParams();
    if (values.customer?.trim()) query.set('customer', values.customer.trim());
    if (values.reception) query.set('reception', values.reception);
    if (values.dates?.[0] && values.dates[1]) {
      query.set('from', values.dates[0].startOf('day').toISOString());
      query.set('to', values.dates[1].add(1, 'day').startOf('day').toISOString());
    }
    setItems([]);
    setNextCursor(null);
    load({ query: query.toString() });
  };

  const columns: ProColumns<ConsultationRecord>[] = [
    { title: '咨询', dataIndex: 'title', ellipsis: true },
    { title: '客户', width: 180, render: (_, row) => customerLabel(row) },
    { title: '接待状态', width: 135, render: (_, row) => <Tag color={row.reception === 'waiting' ? 'gold' : row.reception === 'active' ? 'green' : 'default'}>{receptionLabels[row.reception]}</Tag> },
    { title: '会话状态', width: 112, render: (_, row) => statusLabels[row.status] },
    { title: '最近活动', width: 180, render: (_, row) => formatTime(row.updatedAt) },
    { title: '操作', width: 115, valueType: 'option', render: (_, row) => <Button type="link" onClick={() => setSelected(row)}>查看对话</Button> },
  ];
  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <Form form={form} layout="inline" onFinish={search}>
      <Space wrap>
        <Form.Item name="customer" label="客户"><Input allowClear maxLength={80} placeholder="客户昵称或编号" /></Form.Item>
        <Form.Item name="reception" label="接待状态"><Select allowClear placeholder="全部状态" style={{ width: 142 }}
          options={Object.entries(receptionLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
        <Form.Item name="dates" label="最近活动"><DatePicker.RangePicker /></Form.Item>
        <Button htmlType="submit" type="primary" loading={loading}>查询</Button>
        <Button onClick={() => { form.resetFields(); search({}); }}>重置</Button>
      </Space>
    </Form>
    {error && <Alert showIcon type="error" message={error} action={<Button onClick={() => load({ query: request.query })}>重新加载</Button>} />}
    <ProTable<ConsultationRecord> rowKey="id" columns={columns} dataSource={items} loading={loading} search={false}
      options={false} pagination={false} scroll={{ x: 850 }} locale={{ emptyText: error ? '咨询记录暂未读取成功' : '暂无符合条件的咨询' }} />
    {nextCursor && <Button loading={loading} onClick={() => load({ query: request.query, cursor: nextCursor })}>加载更多咨询</Button>}
    {selected && <ConsultationDrawer key={selected.id} record={selected} onClose={() => setSelected(undefined)} />}
  </Space>;
}
