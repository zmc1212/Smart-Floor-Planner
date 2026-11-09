'use client';

import { CopyOutlined, PhoneOutlined, UploadOutlined } from '@ant-design/icons';
import { Button, Card, Checkbox, Divider, Flex, Image, Input, Space, Switch, Typography, Upload } from 'antd';
import { notify } from '@/components/admin/operation-feedback';
import type { Author, ProfileContact } from './client';

type StagedQr = { imageBase64: string; mimeType: string };
export type ContactDraft = ProfileContact & { stagedQr?: StagedQr | null; consent: boolean; dirty: boolean };
export function contactDraft(saved?: ProfileContact): ContactDraft {
  return { wechatId: '', phone: '', publishWechat: false, publishPhone: false, allowInApp: true,
    qrAvailable: false, ...saved, consent: false, dirty: false };
}

export function PortfolioPortrait({ portrait, fallback, size, preview = false }: {
  portrait?: string; fallback: string; size: number; preview?: boolean;
}) {
  return <Image src={portrait || fallback} fallback={fallback} preview={preview && Boolean(portrait)} width={size} height={size}
    alt="设计师头像" style={{ objectFit: 'cover', borderRadius: '50%' }} />;
}

type Props = {
  value: ContactDraft; change: (patch: Partial<ContactDraft>) => void; author?: Author;
  portrait?: string; fallbackPortrait: string; qrUrl?: string; city?: string; isSelf: boolean; disabled: boolean;
  readImage: (file: File) => Promise<string>;
};

export function ProfileContactEditor({ value, change, author, portrait, fallbackPortrait, qrUrl, city, isSelf, disabled, readImage }: Props) {
  const hasQr = value.stagedQr === undefined ? value.qrAvailable : Boolean(value.stagedQr);
  const qr = value.stagedQr ? `data:${value.stagedQr.mimeType};base64,${value.stagedQr.imageBase64}` : hasQr ? qrUrl : undefined;
  const publicWechat = value.publishWechat && Boolean(value.wechatId.trim() || hasQr);
  const publicPhone = value.publishPhone && Boolean(value.phone.trim());
  const hasPublicChannel = publicWechat || publicPhone;
  const update = (patch: Partial<ContactDraft>) => change({ ...patch, consent: false, dirty: true });
  const stageQr = async (file: File) => {
    if (file.size > 4 * 1024 * 1024 || !['image/png', 'image/jpeg'].includes(file.type)) {
      notify.error('二维码无法读取', { description: '请选择 4MB 以内的 PNG 或 JPEG。' });
      return false;
    }
    try { update({ stagedQr: { imageBase64: await readImage(file), mimeType: file.type } }); }
    catch { notify.error('二维码无法读取', { description: '请重新选择图片。' }); }
    return false;
  };

  return <Flex vertical gap={14}>
    <Typography.Text type="secondary">选择展示给客户的工作联系方式。</Typography.Text>
    <Flex justify="space-between" align="center">
      <Typography.Text strong>工作微信</Typography.Text>
      <Space><Switch aria-label="公开工作微信" checked={value.publishWechat} disabled={disabled} onChange={publishWechat => update({ publishWechat })} />在小程序公开</Space>
    </Flex>
    <label>微信号<Input value={value.wechatId} maxLength={64} disabled={disabled} onChange={event => update({ wechatId: event.target.value })} /></label>
    <Flex align="center" gap={12} wrap>
      <Typography.Text>微信二维码</Typography.Text>
      {qr && <Image src={qr} alt="工作微信二维码" width={76} height={76} style={{ objectFit: 'contain' }} />}
      <Upload accept="image/png,image/jpeg" disabled={disabled} showUploadList={false} beforeUpload={stageQr}>
        <Button icon={<UploadOutlined />} disabled={disabled}>上传二维码</Button>
      </Upload>
      {hasQr && <Button type="link" disabled={disabled} onClick={() => update({ stagedQr: null })}>移除二维码</Button>}
    </Flex>
    <Typography.Text type="secondary">微信号与二维码须对应设计师的工作账号。</Typography.Text>
    <Divider style={{ margin: 0 }} />
    <Flex justify="space-between" align="center">
      <Typography.Text strong>工作电话</Typography.Text>
      <Space><Switch aria-label="公开工作电话" checked={value.publishPhone} disabled={disabled} onChange={publishPhone => update({ publishPhone })} />在小程序公开</Space>
    </Flex>
    <label>电话号码<Input type="tel" value={value.phone} maxLength={30} disabled={disabled} onChange={event => update({ phone: event.target.value })} /></label>
    <Typography.Text type="secondary">客户只能看到在此维护并授权公开的工作电话。</Typography.Text>
    <Divider style={{ margin: 0 }} />
    <Flex justify="space-between" align="center">
      <Typography.Text strong>站内咨询</Typography.Text>
      <Space><Switch aria-label="保留站内申请入口" checked={!hasPublicChannel || value.allowInApp} disabled={disabled || !hasPublicChannel}
        onChange={allowInApp => change({ allowInApp, dirty: true })} />保留站内申请入口</Space>
    </Flex>
    <Card size="small" type="inner" title="小程序名片预览">
      <Space align="start">
        <PortfolioPortrait size={44} portrait={portrait} fallback={fallbackPortrait} />
        <Flex vertical><Typography.Text strong>{author?.display_name}</Typography.Text>
          <Typography.Text type="secondary">{[author?.professionalTitle, author?.enterprise_name, city].filter(Boolean).join(' · ')}</Typography.Text></Flex>
      </Space>
      <Divider style={{ margin: '12px 0' }} />
      <Flex vertical gap={6}>
        {publicWechat && <Space><CopyOutlined />微信 {value.wechatId.trim() || '微信二维码'}</Space>}
        {publicPhone && <Space><PhoneOutlined />电话 {value.phone.trim().replace(/[\s()-]/g, '')}</Space>}
        {!hasPublicChannel && <Typography.Text type="secondary">暂未公开联系方式</Typography.Text>}
        {(!hasPublicChannel || value.allowInApp) && <Typography.Text type="secondary">可发起站内申请</Typography.Text>}
      </Flex>
    </Card>
    <Checkbox checked={value.consent} disabled={disabled} onChange={event => change({ consent: event.target.checked, dirty: true })}>
      {isSelf ? '我同意公开以上工作联系方式。' : '我确认设计师已授权公开以上工作联系方式。'}
    </Checkbox>
  </Flex>;
}
