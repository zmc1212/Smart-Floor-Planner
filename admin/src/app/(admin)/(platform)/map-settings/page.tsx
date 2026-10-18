'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Checkbox, Col, DatePicker, Descriptions, Form, Input, InputNumber, Result, Row, Select, Space, Switch, Tag, Typography } from 'antd';
import { PageContainer } from '@ant-design/pro-components';
import dayjs, { type Dayjs } from 'dayjs';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { notify } from '@/components/admin/operation-feedback';
import { CITY_OPTIONS } from '@/lib/portfolio/regions';
import { MAP_PROVIDERS, isMapProviderKey, type MapProviderKey, type MapConfigDto, type MapRights } from '@/lib/map-services/contracts';

type FormValues = {
  enabled: boolean; activeProvider: string; dailyLimit: number;
  apiKey?: string; signingKey?: string; clearSigningKey?: boolean; clearApiKey?: boolean;
  rights: Omit<MapRights, 'validUntil'> & { validUntil?: Dayjs | null };
};
async function request<T>(path = '', body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch('/api/platform/map-config' + path, {
    method: body === undefined ? 'GET' : method, cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || '地图服务配置请求失败');
  return result.data as T;
}
export default function MapSettingsPage() {
  const { user } = useCurrentUser();
  const canManage = ['super_admin', 'admin'].includes(user?.role || '');
  const [form] = Form.useForm<FormValues>();
  const [data, setData] = useState<MapConfigDto | null>(null);
  const [providerKey, setProviderKey] = useState<MapProviderKey>('amap');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(''), [dirty, setDirty] = useState(false), [loadError, setLoadError] = useState('');
  const [testCity, setTestCity] = useState('420500'), [testQuery, setTestQuery] = useState('花园');
  const adopt = useCallback((config: MapConfigDto, selected: MapProviderKey = isMapProviderKey(config.activeProvider) ? config.activeProvider : 'amap') => {
    const provider = config.providerConfigs[selected]; setProviderKey(selected);
    setData(config); setDirty(false);
    form.setFieldsValue({ enabled: config.enabled, activeProvider: config.activeProvider, dailyLimit: config.dailyLimit,
      apiKey: '', signingKey: '', clearSigningKey: false, clearApiKey: false,
      rights: { ...provider.rights, validUntil: provider.rights.validUntil ? dayjs(provider.rights.validUntil) : null },
    });
  }, [form]);
  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try { adopt(await request<MapConfigDto>()); }
    catch (error) { setLoadError(error instanceof Error ? error.message : '读取地图配置失败'); }
    finally { setLoading(false); }
  }, [adopt]);
  useEffect(() => { if (canManage) void load(); }, [canManage, load]);
  const save = async (values: FormValues) => {
    if (!data) return; setBusy('save');
    try {
      const config = await request<MapConfigDto>('', { ...values, expectedVersion: data.version,
        providerKey,
        rights: { ...values.rights, validUntil: values.rights.validUntil?.toISOString() || '' },
      }, 'PATCH');
      adopt(config, providerKey); notify.success('地图服务配置已保存', { description: '新查询立即采用已保存配置，无需重启服务。' });
    } catch (error) { notify.error('保存失败', { description: error instanceof Error ? error.message : '请稍后重试' }); }
    finally { setBusy(''); }
  };
  const importExisting = async () => {
    if (!data) return; setBusy('import');
    try { adopt(await request<MapConfigDto>('/import', { expectedVersion: data.version })); notify.success('现有 Key 已导入', { description: '后续可直接在本页维护，Key 不会明文回显。' }); }
    catch (error) { notify.error('导入失败', { description: error instanceof Error ? error.message : '请稍后重试' }); }
    finally { setBusy(''); }
  };
  const testConnection = async () => {
    if (!data) return; setBusy('test');
    try {
      const result = await request<NonNullable<MapConfigDto['lastTest']>>('/test', { expectedVersion: data.version, cityCode: testCity, query: testQuery, providerKey });
      setData(current => current ? { ...current, lastTest: current.activeProvider === providerKey ? result : current.lastTest,
        providerConfigs: { ...current.providerConfigs, [providerKey]: { ...current.providerConfigs[providerKey], lastTest: result } },
      } : current);
      if (result.ok) notify.success('连接测试通过', { description: result.message });
      else notify.error('连接测试失败', { description: result.message });
    } catch (error) { notify.error('连接测试失败', { description: error instanceof Error ? error.message : '请稍后重试' }); }
    finally { setBusy(''); }
  };
  if (user && !canManage) return <Result status="403" title="无权访问" subTitle="仅平台管理员可以管理地图服务。" />;
  if (loadError) return <PageContainer title="地图服务配置"><Result status="error" title="读取配置失败" subTitle={loadError} extra={<Button onClick={() => void load()}>重试</Button>} /></PageContainer>;
  const selected = data?.providerConfigs[providerKey], providerName = MAP_PROVIDERS.find(p => p.key === providerKey)?.label || providerKey;
  return <PageContainer title="地图服务配置" subTitle="统一管理小区检索使用的地图供应商与服务凭据"
    extra={<Button disabled={Boolean(busy) || loading || !canManage} onClick={() => void load()}>重新读取</Button>}>
    <Row gutter={[20, 20]}>
      <Col xs={24} xl={16}>
        <Card title="服务与凭据" className="admin-panel-card" loading={loading}>
          <Form form={form} layout="vertical" disabled={Boolean(busy) || !data} onValuesChange={() => setDirty(true)} onFinish={save}>
            <Form.Item name="activeProvider" label="默认检索供应商" rules={[{ required: true }]} extra="保存后新查询使用此供应商。请先在下方保存相应凭据并测试连接；调用失败不会自动切换。">
              <Select options={MAP_PROVIDERS.map(p => ({ value: p.key, label: p.implemented ? p.label : `${p.label}（待接入）`, disabled: !p.implemented }))} />
            </Form.Item>
            <Form.Item name="enabled" label="启用小区搜索" valuePropName="checked" extra="关闭后保留已保存的凭据，暂停新的外部小区查询。"><Switch checkedChildren="开启" unCheckedChildren="关闭" /></Form.Item>
            <Form.Item label="维护供应商凭据" extra={dirty ? '请先保存当前修改，再切换维护其他供应商。' : '各供应商的 Key、授权及测试结果分别保存；维护备用服务不会自动改变默认供应商。'}>
              <Select aria-label="维护供应商凭据" value={providerKey} disabled={dirty || Boolean(busy) || !data} options={MAP_PROVIDERS.map(p => ({ value: p.key, label: p.label }))} onChange={key => {
                if (!data) return; const p = data.providerConfigs[key as MapProviderKey]; setProviderKey(key as MapProviderKey);
                form.setFieldsValue({ apiKey: '', signingKey: '', clearApiKey: false, clearSigningKey: false,
                  rights: { ...p.rights, validUntil: p.rights.validUntil ? dayjs(p.rights.validUntil) : null },
                });
              }} />
            </Form.Item>
            <Form.Item name="apiKey" label={`${providerName} · 服务 Key`} extra={selected?.hasApiKey ? `已保存 ${selected.apiKeyMasked}；留空保留，填写后替换。` : providerKey === 'amap' ? '请使用高德控制台服务平台为「Web 服务」的 Key。' : '请使用已开通地名搜索 V2.0 权限的天地图服务 Key；天地图真实账户联调待完成。'}>
              <Input.Password maxLength={512} autoComplete="new-password" placeholder={selected?.hasApiKey ? '留空保留现有 Key' : '填写当前供应商的服务 Key'} />
            </Form.Item>
            {selected?.hasApiKey && <Form.Item name="clearApiKey" valuePropName="checked"><Checkbox>清除{providerName}已保存的 Key（使用中的供应商需先关闭搜索）</Checkbox></Form.Item>}
            {providerKey === 'amap' && data?.canImportEnvironment && !selected?.hasApiKey && <Form.Item><Button disabled={dirty} loading={busy === 'import'} onClick={() => void importExisting()}>导入当前服务已有的高德 Key</Button></Form.Item>}
            {providerKey === 'amap' && <Form.Item name="signingKey" label="请求签名密钥（可选）" extra={selected?.hasSigningKey ? `已保存 ${selected.signingKeyMasked}，留空保留。` : '仅在高德账户已启用请求签名时填写。'}><Input.Password maxLength={512} autoComplete="new-password" placeholder="留空保留现有设置" /></Form.Item>}
            {providerKey === 'amap' && selected?.hasSigningKey && <Form.Item name="clearSigningKey" valuePropName="checked"><Checkbox>清除已保存的签名密钥</Checkbox></Form.Item>}
            <Form.Item name="dailyLimit" label="每日小区查询上限" rules={[{ required: true }]} extra="业务查询的应用保护上限，范围 1–10000；连接测试另限每分钟 3 次、每日 30 次。实际可用额度取决于供应商账户。"><InputNumber min={1} max={10000} precision={0} addonAfter="次 / 天" /></Form.Item>
            <Card size="small" title="小区信息使用授权（选填）" style={{ marginBottom: 20 }}>
              <Typography.Paragraph type="secondary">以下为{providerName}在本系统的可选授权备注，不是 Key 页面上的参数。未填写或记录已到期均不影响启用搜索、小区绑定及已有作品展示；可直接使用已保存的 Key 开启搜索，并通过连接测试检查服务是否可用。</Typography.Paragraph>
              <Form.Item name={['rights', 'commercialConfirmed']} valuePropName="checked"><Checkbox>已核实本应用的商业使用权益</Checkbox></Form.Item>
              <Form.Item name={['rights', 'bindingConfirmed']} valuePropName="checked"><Checkbox>已核实保存最小小区绑定信息的权益</Checkbox></Form.Item>
              <Form.Item name={['rights', 'reference']} label="授权依据（选填）"><Input.TextArea maxLength={500} rows={2} placeholder="如有，可记录许可书、合同、订单或工单" /></Form.Item>
              <Form.Item name={['rights', 'validUntil']} label="授权有效期（选填）"><DatePicker showTime format="YYYY-MM-DD HH:mm" placeholder="如有，可记录实际到期时间" /></Form.Item>
            </Card>
            <Space wrap><Button type="primary" htmlType="submit" loading={busy === 'save'}>保存并生效</Button>{dirty && <Tag color="gold">有未保存的修改</Tag>}</Space>
          </Form>
        </Card>
      </Col>
      <Col xs={24} xl={8}>
        <Space direction="vertical" size={20} style={{ width: '100%' }}>
          <Card title="当前服务状态" className="admin-panel-card" loading={loading}>
            {data && <Space direction="vertical" style={{ width: '100%' }} size={16}>
              <Tag color={data.available ? 'green' : 'default'}>{data.available ? '小区搜索已启用' : '小区搜索未启用'}</Tag>
              {data.unavailableReason && <Alert showIcon type="info" message={data.unavailableReason} />}
              <Descriptions size="small" column={1} items={[
                { key: 'provider', label: '当前供应商', children: MAP_PROVIDERS.find(p => p.key === data.activeProvider)?.label || data.activeProvider },
                { key: 'key', label: '凭据', children: data.hasApiKey ? data.apiKeyMasked : '尚未配置' },
                { key: 'limit', label: '每日上限', children: `${data.dailyLimit} 次` },
              ]} />
            </Space>}
          </Card>
          <Card title={`${providerName} · 连接测试`} className="admin-panel-card" loading={loading}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Typography.Text type="secondary">使用已保存的配置查询指定城市，仅返回连通性结果，不保存候选小区。连接成功与小区信息使用授权分别显示。</Typography.Text>
              <div><Typography.Paragraph>测试城市</Typography.Paragraph><Select aria-label="测试城市" showSearch optionFilterProp="label" style={{ width: '100%' }} options={CITY_OPTIONS} value={testCity} disabled={Boolean(busy)} onChange={setTestCity} /></div>
              <div><Typography.Paragraph>小区关键词</Typography.Paragraph><Input aria-label="小区关键词" maxLength={50} value={testQuery} disabled={Boolean(busy)} onChange={e => setTestQuery(e.target.value)} /></div>
              <Button block loading={busy === 'test'} disabled={!selected?.hasApiKey || dirty || Boolean(busy) || [...testQuery.trim()].length < 2} onClick={() => void testConnection()}>测试已保存的{providerName}配置</Button>
              {dirty && <Typography.Text type="secondary">请先保存修改，再测试当前配置。</Typography.Text>}
              {selected?.lastTest && <Alert showIcon type={selected.lastTest.ok ? 'success' : 'error'} message={selected.lastTest.message} description={`${dayjs(selected.lastTest.at).format('YYYY-MM-DD HH:mm:ss')} · ${selected.lastTest.elapsedMs} ms`} />}
            </Space>
          </Card>
          <Card title="供应商支持" size="small"><Space direction="vertical">{MAP_PROVIDERS.map(p => <div key={p.key}><Typography.Text strong>{p.label} </Typography.Text><Tag color={p.implemented ? 'green' : 'default'}>{p.implemented ? '已接入' : '待接入'}</Tag><Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>{p.description}</Typography.Paragraph></div>)}</Space></Card>
        </Space>
      </Col>
    </Row>
  </PageContainer>;
}
