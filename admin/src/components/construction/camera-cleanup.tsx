'use client';
import { useEffect, useState } from 'react';
import { Alert, Button, Empty, Modal, Space, Table, Tag } from 'antd';
import { constructionRequest } from './client';
import { cleanupSize, cleanupTime, recordingCleanupFailures, recordingCleanupLabels, type RecordingCleanupItem, type RecordingCleanupPage } from '@/lib/construction/camera-cleanup-contract';

export function CameraCleanup({ projectId, bindingId, name }: { projectId: string; bindingId: string; name: string }) {
  const [open, setOpen] = useState(false), [items, setItems] = useState<RecordingCleanupItem[]>([]);
  const [cursor, setCursor] = useState<string>(), [nextCursor, setNextCursor] = useState<string | null>(null);
  const [revision, setRevision] = useState(0), [loading, setLoading] = useState(false), [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const query = cursor ? '?beforeId=' + encodeURIComponent(cursor) : '';
    void constructionRequest<RecordingCleanupPage>('video-cleanup/projects/' + projectId + '/bindings/' + bindingId + query, { signal: controller.signal })
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
    <Button disabled={!bindingId} onClick={() => { refresh(); setOpen(true); }}>清理记录</Button>
    <Modal title={'录像清理记录 · ' + name} open={open} width={760} onCancel={() => setOpen(false)} footer={<Button onClick={() => setOpen(false)}>关闭</Button>} styles={{ body: { maxHeight: 'calc(100dvh - 260px)', overflowY: 'auto' } }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert type="info" showIcon message="显示已保存的清理状态；失败由后台自动重试。刷新只读取记录，不重新检查或删除文件。" />
        <Space><Button loading={loading} onClick={refresh}>刷新记录</Button></Space>
        {failed && <Alert type="error" showIcon message="清理记录读取失败" action={<Button size="small" onClick={() => { setFailed(false); setLoading(true); setRevision(value => value + 1); }}>重试</Button>} />}
        <Table<RecordingCleanupItem> size="small" rowKey="id" dataSource={items} loading={loading} pagination={false} scroll={{ x: 700 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无清理记录" /> }} columns={[
          { title: '录像时间（北京时间）', width: 180, render: (_, item) => <>{cleanupTime(item.startedAt)}<br />至 {cleanupTime(item.endedAt)}</> },
          { title: '登记大小', dataIndex: 'bytes', width: 100, render: (value: string) => cleanupSize(value) },
          { title: '状态', width: 110, render: (_, item) => <Tag color={item.failure ? 'error' : item.state === 'deleted' ? 'green' : undefined}>{item.failure ? '失败待重试' : recordingCleanupLabels[item.state]}</Tag> },
          { title: '清理结果', render: (_, item) => item.failure ? recordingCleanupFailures[item.failure] : item.state === 'deleted' ? '完成时间：' + cleanupTime(item.deletedAt) : item.state === 'missing' ? '已登记为文件缺失；本次未重新检查物理文件' : '等待后台确认清理结果' },
        ]} />
        {nextCursor && <Button disabled={loading || failed} onClick={() => { setFailed(false); setLoading(true); setCursor(nextCursor); }}>加载更早记录</Button>}
      </Space>
    </Modal>
  </>;
}
