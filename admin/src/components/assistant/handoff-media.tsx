'use client';

import { useState } from 'react';
import { Button, Image, Space, Typography } from 'antd';

export type HandoffImageSource = { id: string; width: number; height: number };

export function HandoffImage({ conversationId, image }: { conversationId: string; image: HandoffImageSource }) {
  const [failed, setFailed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  if (failed) return <Space>
    <Typography.Text type="secondary">图片读取失败</Typography.Text>
    <Button type="link" size="small" onClick={() => setFailed(false)}>重试</Button>
  </Space>;

  const { id, width, height } = image;
  const thumbnailWidth = Math.max(1, Math.round(Math.min(width, 240, width * 220 / height)));

  return <Image
    alt="客户授权参考图片"
    src={`/api/assistant/handoffs/${conversationId}/media/${id}`}
    width={thumbnailWidth}
    loading="lazy"
    wrapperStyle={{ maxWidth: '100%' }}
    style={{ aspectRatio: `${width} / ${height}`, objectFit: 'contain' }}
    role="button"
    tabIndex={0}
    aria-label="查看客户图片大图"
    onKeyDown={event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setPreviewOpen(true);
      }
    }}
    onError={() => {
      setPreviewOpen(false);
      setFailed(true);
    }}
    preview={{ visible: previewOpen, onVisibleChange: setPreviewOpen }}
  />;
}
