'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Select, Space, Typography } from 'antd';
import { notify } from '@/components/admin/operation-feedback';
import { PortfolioMutations, errorText, portfolioRequest, type Community } from './client';

type Candidate = { poiId: string; providerKey: string; name: string; cityCode: string; cityName: string; district: string; address: string; token: string };
export function CommunityPicker({ cityCode, cityName, value, onChange, disabled, onBusy }: {
  cityCode: string; cityName: string; value?: string | null; onChange?: (value: string | null) => void; disabled?: boolean; onBusy?: (busy: boolean) => void;
}) {
  const [query, setQuery] = useState(''), [options, setOptions] = useState<Community[]>([]), [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false), [notice, setNotice] = useState(''), [requestOpen, setRequestOpen] = useState(false), [sending, setSending] = useState(false);
  const [form] = Form.useForm(); const mutations = useRef(new PortfolioMutations()), pageKey = useRef(''), generation = useRef(0);
  useEffect(() => { pageKey.current = crypto.randomUUID(); }, []);
  useEffect(() => {
    const seq = ++generation.current, controller = new AbortController();
    setCandidates([]); setNotice('');
    if (!/^[1-9]\d{3}00$/.test(cityCode)) { setOptions([]); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const local = await portfolioRequest<{ items: Community[] }>(`communities?${new URLSearchParams({ cityCode, query, ...(value ? { communityId: value } : {}) })}`, { signal: controller.signal });
        if (generation.current !== seq) return; setOptions(local.items);
        if ([...query.trim()].length >= 2 && !disabled) {
          try {
            const remote = await portfolioRequest<{ items: Candidate[] }>(`communities/search?${new URLSearchParams({ cityCode, query, pageKey: pageKey.current })}`, { signal: controller.signal });
            if (generation.current === seq) { setCandidates(remote.items); if (!remote.items.length && !local.items.length) setNotice('未找到可用小区，可切换城市、申请核验补录，或暂不绑定。'); }
          } catch (error) { if (!controller.signal.aborted && generation.current === seq) setNotice(errorText(error)); }
        }
      } catch (error) { if (!controller.signal.aborted && generation.current === seq) setNotice(errorText(error)); }
      finally { if (generation.current === seq) setLoading(false); }
    }, query ? 500 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [cityCode, query, disabled, value]);
  const choices = [
    ...options.map(c => ({ value: String(c.id), label: `${c.name} · ${c.district}${c.address ? ' · ' + c.address : ''}` })),
    ...candidates.map(c => ({ value: `remote:${c.providerKey}:${c.poiId}`, label: `${c.name} · ${c.district} · ${c.address}`, candidate: c })),
  ];
  // A persisted selection may be outside the current search window; resolve its label from the bounded local list.
  if (value && !choices.some(o => o.value === value)) choices.push({ value, label: '已绑定小区（更换前请搜索核对）' });
  return <Space direction="vertical" style={{ width: '100%' }}>
    <Select showSearch allowClear disabled={disabled || sending || !cityCode} value={value || undefined} loading={loading || sending} filterOption={false}
      placeholder="输入至少2字，搜索并选择具体小区/分期（可暂不绑定）" options={choices} onSearch={setQuery}
      notFoundContent={loading ? '查询中…' : '暂无匹配，可申请核验补录'} style={{ width: '100%' }}
      onChange={async selected => {
        setLoading(false);
        if (!selected) { onChange?.(null); return; }
        const seq = ++generation.current;
        if (!selected.startsWith('remote:')) { onChange?.(selected); return; }
        const candidate = candidates.find(c => `remote:${c.providerKey}:${c.poiId}` === selected); if (!candidate) return;
        setSending(true); onBusy?.(true);
        try {
          const community = await mutations.current.write<Community>('communities/bind', { token: candidate.token, pageKey: pageKey.current });
          if (seq === generation.current) { setOptions(old => [community, ...old.filter(c => String(c.id) !== String(community.id))]); onChange?.(String(community.id)); setNotice(''); }
        } catch (error) { setNotice(errorText(error)); }
        finally { setSending(false); onBusy?.(false); setLoading(false); }
      }} />
    {notice && <Alert type="info" showIcon message={notice} />}
    {!disabled && <Typography.Text type="secondary">名称相同不代表同一小区或分期。<Button type="link" size="small" disabled={!cityCode} onClick={() => { form.setFieldsValue({ name: query }); setRequestOpen(true); }}>申请核验补录</Button></Typography.Text>}
    <Modal open={requestOpen} title="申请核验小区" confirmLoading={sending} onCancel={() => setRequestOpen(false)} onOk={async () => {
      try {
        const values = await form.validateFields(); setSending(true);
        await mutations.current.write('communities/requests', { content: { cityCode, cityName, ...values } });
        notify.success('已提交核验申请', { description: '当前作品可暂不绑定小区继续保存。' }); setRequestOpen(false); form.resetFields();
      } catch (error) { if (error instanceof Error) notify.error('提交失败', { description: errorText(error) }); } finally { setSending(false); }
    }}>
      <Form form={form} layout="vertical" initialValues={{ district: '', address: '' }}>
        <Form.Item name="name" label="小区及具体分期" rules={[{ required: true, whitespace: true, max: 100 }]}><Input maxLength={100} /></Form.Item>
        <Form.Item name="district" label="区县"><Input maxLength={100} /></Form.Item>
        <Form.Item name="address" label="小区公开地址" extra="请勿填写业主姓名、门牌或私人联系方式。"><Input maxLength={200} /></Form.Item>
      </Form>
    </Modal>
  </Space>;
}
