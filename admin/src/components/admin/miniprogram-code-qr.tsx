'use client';
/* eslint-disable @next/next/no-img-element -- QR codes are transient authenticated Blob URLs. */

import { Button, Flex, Spin, Typography } from 'antd';
import { Download, RefreshCw } from 'lucide-react';

export type MiniProgramCodeQrImage = {
  imageUrl: string;
  imageType: 'image/png' | 'image/jpeg';
};

export function revokeMiniProgramCodeQr(image: MiniProgramCodeQrImage | null | undefined) {
  if (image?.imageUrl) URL.revokeObjectURL(image.imageUrl);
}

export function describeMiniProgramCodeQrError(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : fallback;
  if (/temporarily unavailable|wechat_code_unavailable/i.test(raw)) {
    return '微信小程序码暂时不可用。当前码仍然有效，可稍后重新查看，无需换新。';
  }
  if (/No active|active_code_not_found/i.test(raw)) {
    return '当前没有生效中的码，请先创建。';
  }
  return raw;
}

export async function fetchMiniProgramCodeQr(url: string): Promise<MiniProgramCodeQrImage> {
  const response = await fetch(url, { method: 'POST' });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error || '读取当前二维码失败');
  }
  const image = await response.blob();
  if (image.type !== 'image/png' && image.type !== 'image/jpeg') {
    throw new Error('二维码格式无效');
  }
  return {
    imageType: image.type,
    imageUrl: URL.createObjectURL(image),
  };
}

export function MiniProgramCodeQr(props: {
  alt: string;
  value: MiniProgramCodeQrImage | null;
  loading?: boolean;
  error?: string | null;
  onReload?: () => void;
  onDownload?: () => void;
}) {
  return (
    <Flex vertical align="center" gap={12} className="mt-4 rounded-lg bg-slate-50 p-4">
      {props.loading && !props.value ? <Spin /> : null}
      {props.value ? (
        <img
          src={props.value.imageUrl}
          alt={props.alt}
          className="h-60 w-60 max-w-full rounded bg-white p-2"
        />
      ) : null}
      {props.error ? (
        <Typography.Text type="danger">{props.error}</Typography.Text>
      ) : (
        <Typography.Text type="secondary">
          当前有效二维码可直接查看和下载，不会换新。只有点「换新」才会让旧码失效。
        </Typography.Text>
      )}
      <Flex gap={8} wrap justify="center">
        {props.onReload ? (
          <Button icon={<RefreshCw size={15} />} loading={props.loading} onClick={props.onReload}>
            重新查看
          </Button>
        ) : null}
        {props.value && props.onDownload ? (
          <Button type="primary" icon={<Download size={15} />} onClick={props.onDownload}>
            下载二维码
          </Button>
        ) : null}
      </Flex>
    </Flex>
  );
}
