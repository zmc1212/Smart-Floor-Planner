'use client';
import { useEffect, useState } from 'react';
import { Alert, Button, Image, List, Space } from 'antd';
import { assistantRequest, assistantError } from './client';
type Media = { id: string; kind: string; roomName: string; width: number; height: number; source?: { name: string } };
export function HandoffMedia({ conversationId }: { conversationId: string }) {
  const [items, setItems] = useState<Media[]>([]), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const [image, setImage] = useState(''), [selected, setSelected] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    assistantRequest<{ items: Media[] }>('handoffs/' + conversationId + '/media', { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) { setItems(data.items); setError(''); } })
      .catch(e => { if (!controller.signal.aborted) { setItems([]); setError(assistantError(e)); } });
    return () => controller.abort();
  }, [conversationId, revision]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController(); let objectUrl = '';
    fetch('/api/assistant/handoffs/' + conversationId + '/media/' + selected, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('图片已删除或当前授权已失效，请刷新咨询资料。');
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob); setImage(objectUrl); setError('');
      }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); setImage(''); };
  }, [conversationId, selected]);
  return <Space direction="vertical" style={{ width: '100%' }}>
    {error && <Alert type="error" message={error} />}
    <Button onClick={() => { setSelected(''); setRevision(n => n + 1); }}>刷新授权图片</Button>
    <List dataSource={items} locale={{ emptyText: '暂无可读取的图片资料' }} renderItem={item => <List.Item actions={[
      <Button key="view" onClick={() => setSelected(item.id)}>查看图片</Button>,
    ]}>{item.source ? '正式户型快照：' + item.source.name : item.kind === 'floorplan' ? '户型参考图' : '参考图片'}{item.roomName ? ' · ' + item.roomName : ''}（{item.width} × {item.height}）</List.Item>} />
    {image && <Image alt="客户授权参考图片" src={image} width={240} preview={{ visible: true, onVisibleChange: visible => { if (!visible) setSelected(''); } }} />}
  </Space>;
}
