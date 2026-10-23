'use client';
import { useEffect, useState } from 'react';
import { Alert, Button, Empty, Modal, Space, Table, Tag } from 'antd';
import { constructionRequest } from './client';
import { recordingActivityDetail, recordingActivityLabels, type RecordingActivity, type RecordingActivityPage } from '@/lib/construction/camera-activity-contract';

export function CameraActivity({ projectId, bindingId, name }: { projectId: string; bindingId: string; name: string }) {
  const [open, setOpen] = useState(false), [items, setItems] = useState<RecordingActivity[]>([]);
  const [cursor, setCursor] = useState<string>(), [nextCursor, setNextCursor] = useState<string | null>(null);
  const [revision, setRevision] = useState(0), [loading, setLoading] = useState(false), [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const query = cursor ? '?beforeId=' + encodeURIComponent(cursor) : '';
    void constructionRequest<RecordingActivityPage>('video-activity/projects/' + projectId + '/bindings/' + bindingId + query, { signal: controller.signal })
      .then(page => {
        if (controller.signal.aborted) return;
        setItems(previous => cursor ? [...previous, ...page.items] : page.items); setNextCursor(page.nextCursor);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, projectId, bindingId, cursor, revision]);
  const refresh = () => { setCursor(undefined); setItems([]); setNextCursor(null); setFailed(false); setLoading(true); setRevision(value => value + 1); };
  return <>
    <Button disabled={!bindingId} onClick={() => { refresh(); setOpen(true); }}>运行记录</Button>
    <Modal title={'录像运行记录 · ' + name} open={open} width={760} onCancel={() => setOpen(false)} footer={<Button onClick={() => setOpen(false)}>关闭</Button>} styles={{ body: { maxHeight: 'calc(100dvh - 260px)', overflowY: 'auto' } }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert type="info" showIcon message="存储事件记录当时的保护判断；实际录制状态请查看当前摄像头状态。" />
        <Space><Button loading={loading} onClick={refresh}>刷新记录</Button></Space>
        {failed && <Alert type="error" showIcon message="运行记录读取失败" action={<Button size="small" onClick={() => { setFailed(false); setLoading(true); setRevision(value => value + 1); }}>重试</Button>} />}
        <Table<RecordingActivity> size="small" rowKey="id" dataSource={items} loading={loading} pagination={false} scroll={{ x: 650 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无运行记录" /> }} columns={[
          { title: '时间', dataIndex: 'createdAt', width: 170, render: value => new Date(value).toLocaleString('zh-CN', { hour12: false }) },
          { title: '事件', dataIndex: 'event', width: 145, render: (value: RecordingActivity['event']) => recordingActivityLabels[value] },
          { title: '来源', dataIndex: 'actor', width: 80, render: (value: RecordingActivity['actor']) => <Tag>{value === 'admin' ? '管理操作' : value === 'system' ? '系统' : '未记录'}</Tag> },
          { title: '记录内容', render: (_, item) => recordingActivityDetail(item) },
        ]} />
        {nextCursor && <Button disabled={loading || failed} onClick={() => { setFailed(false); setLoading(true); setCursor(nextCursor); }}>加载更早记录</Button>}
      </Space>
    </Modal>
  </>;
}
