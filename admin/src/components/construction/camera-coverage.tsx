'use client';
import { useEffect, useState } from 'react';
import { Alert, Button, DatePicker, Descriptions, Empty, Modal, Space, Table, Tag } from 'antd';
import dayjs from 'dayjs';
import { constructionRequest } from './client';
import { coverageDuration, type RecordingCoverage } from '@/lib/construction/recording-coverage';

const today = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const time = (value: string) => new Date(value).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
export function CameraCoverage({ projectId, bindingId, name }: { projectId: string; bindingId: string; name: string }) {
  const [open, setOpen] = useState(false), [day, setDay] = useState(today), [revision, setRevision] = useState(0);
  const [data, setData] = useState<RecordingCoverage>(), [loading, setLoading] = useState(false), [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void constructionRequest<RecordingCoverage>('video-coverage/projects/' + projectId + '/bindings/' + bindingId + '?day=' + encodeURIComponent(day), { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, projectId, bindingId, day, revision]);
  const refresh = () => { setData(undefined); setFailed(false); setLoading(true); setRevision(value => value + 1); };
  const rows = data ? [
    ...data.ranges.map(item => ({ ...item, kind: 'recorded' as const })),
    ...data.gaps.map(item => ({ ...item, segments: null, kind: 'gap' as const })),
  ].sort((a, b) => a.from.localeCompare(b.from)) : [];
  return <>
    <Button disabled={!bindingId} onClick={() => { setDay(today()); refresh(); setOpen(true); }}>录像覆盖</Button>
    <Modal title={'录像覆盖 · ' + name} open={open} width={760} onCancel={() => setOpen(false)} footer={<Button onClick={() => setOpen(false)}>关闭</Button>} styles={{ body: { maxHeight: 'calc(100dvh - 260px)', overflowY: 'auto' } }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert type="info" showIcon message="按北京时间查看已封存且仍在保留期内的入库录像。" description="区间使用视频源时间；跨午夜片段按所选日期截取。仅列区间之间未覆盖的时段，不判断停机原因。正在录制和尚未入库的部分未计入，日期两端不推断缺口；实际播放请进入工地视频核对。" />
        <Space wrap><DatePicker aria-label="录像日期" allowClear={false} value={dayjs(day)} onChange={value => { if (value) { setDay(value.format('YYYY-MM-DD')); refresh(); } }} /><Button loading={loading} onClick={refresh}>刷新覆盖</Button></Space>
        {failed && <Alert type="error" showIcon message="录像覆盖读取失败" action={<Button size="small" onClick={refresh}>重试</Button>} />}
        {data?.truncated && <Alert type="warning" showIcon message={'当日录像超过 ' + data.limit + ' 段，仅展示前 ' + data.limit + ' 段的部分统计，不能据此判断完整覆盖。'} />}
        {data && <Descriptions size="small" column={1} items={[
          { key: 'count', label: data.truncated ? '部分入库统计' : '入库统计', children: data.segments + ' 段录像，合并为 ' + data.ranges.length + ' 个区间' },
          { key: 'duration', label: '已覆盖时长', children: coverageDuration(data.coveredMilliseconds) },
          { key: 'gap', label: '区间之间未覆盖', children: coverageDuration(data.gapMilliseconds) },
        ]} />}
        <Table key={day + '/' + revision} size="small" rowKey={item => item.kind + item.from} dataSource={rows} loading={loading} pagination={{ pageSize: 20, showSizeChanger: false, hideOnSinglePage: true }} scroll={{ x: 650 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={failed ? '暂无法核对录像覆盖' : '所选日期暂无符合条件的入库录像'} /> }} columns={[
          { title: '区间', width: 130, render: (_, item) => <Tag color={item.kind === 'recorded' ? 'green' : 'warning'}>{item.kind === 'recorded' ? '已入库覆盖' : '区间未覆盖'}</Tag> },
          { title: '开始', dataIndex: 'from', width: 120, render: time }, { title: '结束', dataIndex: 'to', width: 120, render: time },
          { title: '时长', dataIndex: 'milliseconds', width: 185, render: coverageDuration },
          { title: '录像段数', dataIndex: 'segments', width: 95, render: value => value ?? '—' },
        ]} />
      </Space>
    </Modal>
  </>;
}
