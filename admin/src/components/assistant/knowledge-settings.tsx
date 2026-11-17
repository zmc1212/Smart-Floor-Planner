'use client';
import { useEffect, useState } from 'react';
import { Alert, Button, Form, Skeleton, Space, Switch } from 'antd';
import { notify } from '@/components/admin/operation-feedback';
import { assistantError, assistantRequest } from './client';

type SettingValues = { enterpriseKnowledgeEnabled: boolean; imageInput: boolean };
type Settings = SettingValues & {
  enterpriseId: string;
  version: number;
  imageInputModel: string | null;
  canEnableImageInput: boolean;
  initializesImageAgent: boolean;
};
export function KnowledgeSettings() {
  const [form] = Form.useForm<SettingValues>();
  const [saved, setSaved] = useState<Settings>();
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true);
    void assistantRequest<Settings>('settings', { signal: abort.signal }).then(value => {
      if (!abort.signal.aborted) { setSaved(value); setError(''); }
    }).catch(e => { if (!abort.signal.aborted) setError(assistantError(e)); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [reload]);
  useEffect(() => {
    if (saved && !loading) form.setFieldsValue(saved);
  }, [form, saved, loading]);
  const save = async (value: SettingValues) => {
    if (!saved || busy) return;
    const knowledgeChanged = value.enterpriseKnowledgeEnabled !== saved.enterpriseKnowledgeEnabled;
    const imageChanged = value.imageInput !== saved.imageInput;
    if (!knowledgeChanged && !imageChanged) return;
    setBusy(true);
    try {
      const result = await assistantRequest<Settings>('settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: saved.version, expectedEnterpriseId: saved.enterpriseId,
          ...(knowledgeChanged ? { enterpriseKnowledgeEnabled: value.enterpriseKnowledgeEnabled } : {}),
          ...(imageChanged ? { imageInput: value.imageInput } : {}) }) });
      setSaved(result); setError(''); notify.success('小K设置已保存');
    } catch (e) { const message = assistantError(e); setError(message); notify.error('保存失败', { description: message }); }
    finally { setBusy(false); }
  };
  if (loading) return <Skeleton active />;
  return <Space direction="vertical" size={20} style={{ width: '100%', maxWidth: 860 }}>
    {error && <Alert type="error" message={error} action={<Button disabled={busy} onClick={() => setReload(x => x + 1)}>重新读取配置</Button>} />}
    {saved && <Form form={form} layout="vertical" onFinish={save} disabled={busy || !!error}>
      <Form.Item name="enterpriseKnowledgeEnabled" label="结合企业知识库" valuePropName="checked"
        extra="默认关闭：小K使用模型通用知识，按需联网；施工进度仍取获权业务记录。开启后使用已发布且获权的企业资料，当前结合知识库的回答质量仍在开发中。切换会停止旧模式下尚未完成的回答。"><Switch /></Form.Item>
      <Form.Item name="imageInput" label="小K聊天识图" valuePropName="checked" extra={<>
        开启后，小K会使用对话模型读取本企业客户在聊天中发送的图片。
        {saved.imageInputModel && <> 模型为 {saved.imageInputModel}。</>}
        {saved.initializesImageAgent && <> 首次开启会用此模型初始化本企业的小K对话。</>}
        {!saved.canEnableImageInput && <> 当前小K或模型配置无法启用识图。</>}
      </>}><Switch disabled={busy || !!error || (!saved.canEnableImageInput && !saved.imageInput)} /></Form.Item>
      <Button type="primary" htmlType="submit" loading={busy}>保存设置</Button>
    </Form>}
  </Space>;
}
