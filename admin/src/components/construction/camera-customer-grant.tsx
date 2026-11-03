'use client';
import { useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Modal, Space, Switch } from 'antd';
import { notify } from '@/components/admin/operation-feedback';
import { constructionRequest, errorText } from './client';

export type CameraCustomerGrant = { userId: string; name: string; enabled: boolean; captureEnabled: boolean; ptzEnabled: boolean; version: number };
export function CameraCustomerGrantEditor({ projectId, grant, refresh }: {
  projectId: string; grant: CameraCustomerGrant; refresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [form] = Form.useForm();
  const enabled = Form.useWatch('enabled', form);
  const readCurrent = () => form.setFieldsValue({ ...grant, expectedVersion: grant.version });
  const save = async () => {
    let values;
    try { values = await form.validateFields(); } catch { return; }
    setBusy(true);
    try {
      await constructionRequest('video/projects/' + projectId + '/customer-grant', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
      });
      notify.success('业主视频授权已保存'); setOpen(false); await refresh();
    } catch (error) { notify.error('业主视频授权未保存', { description: errorText(error) }); await refresh(); }
    finally { setBusy(false); }
  };
  return <>
    <Button onClick={() => { readCurrent(); setOpen(true); }}>业主视频授权</Button>
    <Modal title={'业主视频授权 · ' + grant.name} open={open} forceRender confirmLoading={busy}
      onCancel={() => !busy && setOpen(false)} onOk={() => void save()} styles={{ body: { maxHeight: 'calc(100dvh - 260px)', overflowY: 'auto' } }}>
      <Alert type="info" showIcon message="仅授权当前业主查看本工地私有视频"
        description="与项目报告、公开直播授权分别保存。直播与回放一同开放；抓拍、云台须分别授权。更换业主或暂停工地后须重新授权。修改授权后旧入口与旧播放会话失效，业主需重新进入。" />
      <Form name="camera-customer-grant" form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="userId" hidden><Input /></Form.Item><Form.Item name="expectedVersion" hidden><InputNumber /></Form.Item>
        <Form.Item name="enabled" label="允许查看直播与回放" valuePropName="checked"><Switch disabled={busy}
          onChange={value => { if (!value) form.setFieldsValue({ captureEnabled: false, ptzEnabled: false }); }} /></Form.Item>
        <Form.Item name="captureEnabled" label="允许抓拍及查看抓拍记录" valuePropName="checked"><Switch disabled={busy || !enabled} /></Form.Item>
        <Form.Item name="ptzEnabled" label="允许操作已开放的设备云台" valuePropName="checked"><Switch disabled={busy || !enabled} /></Form.Item>
      </Form>
      <Space><Button disabled={busy} onClick={readCurrent}>读取最新授权</Button><span>授权已有变化时，当前输入保留；读取最新授权后再保存。</span></Space>
    </Modal>
  </>;
}
