'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageContainer } from '@ant-design/pro-components';
import { Alert, Button, Card, Checkbox, Col, Divider, Empty, Form, Image, Input, InputNumber, Modal, Result, Row, Select, Skeleton, Space, Tabs, Tag, Typography, Upload } from 'antd';
import { ArrowLeftOutlined, ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { notify } from '@/components/admin/operation-feedback';
import type { WorkContent, WorkImage } from '@/lib/portfolio/contracts';
import { STYLE_OPTIONS } from '@/lib/portfolio/options';
import { CITY_OPTIONS, cityNameFor, districtOptions } from '@/lib/portfolio/regions';
import { CommunityPicker } from './community-picker';
import { PortfolioMutations, assetUrl, errorText, portfolioRequest, statusLabels, type WorkDetail, type Author } from './client';

function inputDate(value: string | null) { if (!value) return ''; const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function imageFile(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); }); }
export function WorkEditor({ workId }: { workId: string }) {
  const router = useRouter(), [form] = Form.useForm<WorkContent>();
  const [detail, setDetail] = useState<WorkDetail | null>(null), [authors, setAuthors] = useState<Author[]>([]), [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(''), [binding, setBinding] = useState(false), [group, setGroup] = useState('render');
  const [returnOpen, setReturnOpen] = useState(false), [note, setNote] = useState('');
  const mutations = useRef(new PortfolioMutations());
  const values = Form.useWatch([], { form, preserve: true }) as WorkContent | undefined, images = values?.images || [];
  const city = Form.useWatch('cityCode', form) || '', cityName = Form.useWatch('cityName', form) || '';
  const editable = Boolean(detail && ['draft', 'returned'].includes(detail.head.status));
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [next, staff] = await Promise.all([portfolioRequest<WorkDetail>('works/' + workId), portfolioRequest<{ items: Author[] }>('authors')]);
      setDetail(next); setAuthors(staff.items); form.setFieldsValue({ ...next.head.content, rightsUntil: inputDate(next.head.content.rightsUntil) });
    } catch (e) { setError(errorText(e)); } finally { setLoading(false); }
  }, [form, workId]);
  useEffect(() => { void load(); }, [load]);
  const operate = async (action: string) => {
    if (!detail || busy || binding) return; setBusy(action);
    try {
      let version = detail.work.version;
      if (action === 'save' || action === 'submit') {
        const raw = form.getFieldsValue(true), content = { ...raw, district: raw.district || '', area: raw.area ?? null, rightsUntil: raw.rightsUntil ? new Date(raw.rightsUntil).toISOString() : null };
        const saved = await mutations.current.write<{ version: number }>('works/' + workId, { expectedVersion: version, content }, 'PATCH'); version = saved.version;
        setDetail(old => old && ({ ...old, work: { ...old.work, version } }));
      }
      if (action !== 'save') await mutations.current.write('works/' + workId + '/' + action, { expectedVersion: version, ...(action === 'return' ? { note } : {}) });
      notify.success(({ save: '草稿已保存', submit: '已提交企业审核', publish: '作品已发布', return: '已退回修改', withdraw: '作品已下架', draft: '已创建新草稿' } as Record<string, string>)[action]);
      setReturnOpen(false); setNote(''); await load();
    } catch (e) { notify.error('操作失败', { description: errorText(e) }); } finally { setBusy(''); }
  };
  const updateImages = (next: WorkImage[]) => {
    form.setFieldValue('images', next);
    if (!next.some(i => i.assetId === form.getFieldValue('coverAssetId'))) form.setFieldValue('coverAssetId', next[0]?.assetId || null);
  };
  const move = (assetId: string, direction: number) => { const next = [...images], index = next.findIndex(i => i.assetId === assetId), target = index + direction; if (target >= 0 && target < next.length) { [next[index], next[target]] = [next[target], next[index]]; updateImages(next); } };
  if (loading && !detail) return <PageContainer title="编辑作品"><Skeleton active /></PageContainer>;
  if (!detail) return <Result status="error" title={error || '读取作品失败'} extra={<Button onClick={() => void load()}>重试</Button>} />;
  const author = authors.find(a => String(a.id) === detail.work.author_id);
  const label = detail.work.withdrawn ? 'withdrawn' : detail.head.status;
  return <PageContainer title="编辑作品" subTitle="保存草稿后可退出重进；提交后由企业管理员核对许可并审核。"
    breadcrumb={{ items: [{ title: '案例发布管理', href: '/case-publishing' }, { title: '编辑作品' }] }}
    extra={<Space><Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/case-publishing')}>返回列表</Button>
      {editable && <><Button disabled={!!busy || binding} loading={busy === 'save'} onClick={() => void operate('save')}>保存草稿</Button><Button type="primary" disabled={!!busy || binding} loading={busy === 'submit'} onClick={() => void operate('submit')}>提交审核</Button></>}
      {detail.head.status === 'published' && <Button type="primary" loading={busy === 'draft'} disabled={!!busy} onClick={() => void operate('draft')}>修改为新草稿</Button>}
    </Space>}>
    {error && <Alert type="error" message={error} action={<Button onClick={() => void load()}>重试读取</Button>} style={{ marginBottom: 16 }} />}
    {detail.head.review_note && <Alert type="warning" showIcon message="审核退回" description={detail.head.review_note} style={{ marginBottom: 16 }} />}
    {detail.work.published_version_id && detail.head.status !== 'published' && !detail.work.withdrawn && <Alert type="info" showIcon message="正在编辑新版本，原公开版本继续有效；新版本审核通过后替换。" style={{ marginBottom: 16 }} />}
    <Row gutter={[20, 20]} align="top"><Col xs={24} xl={17}>
      <Form form={form} layout="vertical" disabled={!editable || !!busy || binding} onValuesChange={changed => { if ('cityCode' in changed) form.setFieldsValue({ cityName: cityNameFor(changed.cityCode || ''), district: '', communityId: null }); }}>
        <Card title="基本信息" extra={<Tag color={label === 'submitted' ? 'gold' : label === 'published' ? 'green' : 'default'}>{statusLabels[label]}</Tag>}>
          <Typography.Paragraph type="secondary">{detail.work.kind === 'enterprise_reference' ? '企业授权参考 · 保留原始作者及出处，不计入设计师原创作品集' : `作者：${author?.display_name || '当前作者不可用'} · ${author?.professional_title || '设计师'}（${values?.authorRole || '请注明主创或合作角色'}）`}</Typography.Paragraph>
          <Form.Item name="title" label="作品名称"><Input maxLength={50} showCount /></Form.Item>
          <Row gutter={16}><Col xs={24} md={12}><Form.Item name="primaryStyle" label="主风格（1个）"><Select options={STYLE_OPTIONS.map(value => ({ value, label: value }))} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="secondaryStyles" label="辅助风格（最多2个）"><Select mode="tags" maxCount={2} options={STYLE_OPTIONS.filter(v => v !== values?.primaryStyle).map(value => ({ value, label: value }))} /></Form.Item></Col></Row>
          <Row gutter={16}><Col xs={24} md={12}><Form.Item name="cityCode" label="所在城市"><Select showSearch optionFilterProp="label" allowClear options={CITY_OPTIONS} placeholder="搜索并选择城市" /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="district" label="区县"><Select showSearch optionFilterProp="label" allowClear options={districtOptions(city)} placeholder="选择区县（可选）" /></Form.Item></Col></Row>
          <Form.Item name="communityId" label="所在小区（可选）"><CommunityPicker cityCode={city} cityName={cityName} disabled={!editable || !!busy} onBusy={setBinding} /></Form.Item>
          <Row gutter={16}><Col xs={12}><Form.Item name="area" label="面积"><InputNumber min={1} max={100000} addonAfter="m²" style={{ width: '100%' }} /></Form.Item></Col><Col xs={12}><Form.Item name="rooms" label="室厅信息"><Input maxLength={30} placeholder="如：三室两厅" /></Form.Item></Col></Row>
          <Form.Item name="authorRole" label="主创 / 合作角色"><Input maxLength={100} placeholder="如：主创设计；合作作品请注明本人负责部分" /></Form.Item>
          <Form.Item name="description" label="作品亮点"><Input.TextArea rows={3} maxLength={400} showCount /></Form.Item>
        </Card>
        <Card title="作品图片" style={{ marginTop: 20 }}>
          <Tabs activeKey={group} onChange={setGroup} items={['render', 'photo'].map(kind => ({ key: kind, label: `${kind === 'render' ? '效果图' : '实拍图'} ${images.filter(i => i.kind === kind).length}` }))} />
          <Row gutter={[12, 16]}>
            {images.filter(i => i.kind === group).map(item => <Col key={item.assetId} xs={24} sm={12} lg={8}>
              <Image src={assetUrl(workId, item.assetId)} alt={item.caption || (item.kind === 'render' ? '效果图' : '实拍图')} width="100%" style={{ aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 8 }} />
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                <Checkbox checked={values?.coverAssetId === item.assetId} onChange={() => form.setFieldValue('coverAssetId', item.assetId)}>设为封面</Checkbox>
                <Checkbox checked={item.kind === 'render' ? item.aiGenerated : item.showroom} onChange={e => updateImages(images.map(i => i.assetId === item.assetId ? { ...i, [item.kind === 'render' ? 'aiGenerated' : 'showroom']: e.target.checked } : i))}>{item.kind === 'render' ? 'AI生成效果图' : '样板间实拍'}</Checkbox>
                <Input value={item.caption} maxLength={100} placeholder="图片说明（可选）" onChange={e => updateImages(images.map(i => i.assetId === item.assetId ? { ...i, caption: e.target.value } : i))} />
                <Space><Button size="small" aria-label="上移图片" icon={<ArrowUpOutlined />} onClick={() => move(item.assetId, -1)} /><Button size="small" aria-label="下移图片" icon={<ArrowDownOutlined />} onClick={() => move(item.assetId, 1)} /><Button size="small" danger icon={<DeleteOutlined />} onClick={() => updateImages(images.filter(i => i.assetId !== item.assetId))}>移除</Button></Space>
              </Space>
            </Col>)}
            {editable && <Col xs={24} sm={12} lg={8}><Upload accept="image/jpeg,image/png" showUploadList={false} disabled={!!busy || images.length >= 20} beforeUpload={async file => {
              if (!detail || busy) return false;
              if (file.size > 4 * 1024 * 1024 || !['image/png', 'image/jpeg'].includes(file.type)) { notify.error('上传失败', { description: '请选择4MB以内的PNG/JPEG图片。' }); return false; }
              setBusy('upload');
              try {
                const result = await mutations.current.write<{ assetId: string }>('works/' + workId + '/assets', { expectedVersion: detail.work.version, imageBase64: await imageFile(file) });
                const current = (form.getFieldValue('images') || []) as WorkImage[];
                if (!current.some(i => i.assetId === result.assetId)) updateImages([...current, { assetId: result.assetId, kind: group as WorkImage['kind'], aiGenerated: false, showroom: false, caption: '' }]);
                notify.success('图片已处理', { description: '请保存草稿以保留图片分组和封面。' });
              } catch (e) { notify.error('图片处理失败', { description: errorText(e) }); } finally { setBusy(''); }
              return false;
            }}><Button block icon={<PlusOutlined />} loading={busy === 'upload'} style={{ height: 120 }}>{busy === 'upload' ? '正在处理图片' : '上传图片'}</Button></Upload></Col>}
          </Row>
          {!images.length && !editable && <Empty description="暂无图片" />}
          <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>最多20张，按当前顺序展示。效果图与实拍必须分开；AI生成图不得标为实拍。</Typography.Paragraph>
        </Card>
        <Card title="图片使用许可" style={{ marginTop: 20 }}>
          <Form.Item name="source" label="原始作者与出处"><Input.TextArea rows={2} maxLength={500} placeholder="原创/合作作者、原始文件或出处链接" /></Form.Item>
          <Form.Item name="authorization" label="全部图片的授权凭据" extra="需覆盖本作品全部图片及所选公开范围；不同授权请分别列明。凭据仅供内部审核。"><Input.TextArea rows={2} maxLength={500} /></Form.Item>
          <Form.Item name="rightsUntil" label="许可到期时间（可选）"><Input type="datetime-local" /></Form.Item>
          <Space wrap><Form.Item name="showOnProfile" valuePropName="checked"><Checkbox disabled={detail.work.kind === 'enterprise_reference' || !editable}>设计师主页</Checkbox></Form.Item><Form.Item name="recommendable" valuePropName="checked"><Checkbox>小K推荐</Checkbox></Form.Item></Space>
        </Card>
      </Form>
    </Col><Col xs={24} xl={7}>
      <Card title="公开内容预览">
        {values?.coverAssetId ? <Image src={assetUrl(workId, values.coverAssetId)} alt="作品封面" width="100%" style={{ aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 8 }} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请上传并选择封面" />}
        <Typography.Title level={4}>{values?.title || '作品名称'}</Typography.Title><Typography.Paragraph>{values?.description || '作品亮点将在这里展示'}</Typography.Paragraph>
        <Space wrap><Tag>{values?.primaryStyle || '待选风格'}</Tag>{values?.area && <Tag>{values.area}m²</Tag>}{values?.rooms && <Tag>{values.rooms}</Tag>}</Space>
        <Divider /><Typography.Paragraph type="secondary">公开内容不包含业主姓名、门牌和授权凭据。请在上传前核对图片及说明中的私人信息。</Typography.Paragraph>
        <Typography.Text type="secondary">本页为后台审核预览，客户主页与小K作品推荐入口仍待接入。</Typography.Text>
      </Card>
      {detail.manager && <Card title="发布检查" style={{ marginTop: 20 }}>
        <Space direction="vertical" style={{ width: '100%' }}><Typography.Text>图片：效果图 {images.filter(i => i.kind === 'render').length} · 实拍图 {images.filter(i => i.kind === 'photo').length}</Typography.Text>
          <Typography.Text>许可凭据：{values?.authorization ? '已填写，需人工核对' : '待补充'}</Typography.Text><Typography.Text>小区：{values?.communityId ? '已选择标准记录' : '暂未绑定（不阻塞发布）'}</Typography.Text>
          {detail.head.status === 'submitted' && <><Button type="primary" block loading={busy === 'publish'} disabled={!!busy} onClick={() => void operate('publish')}>核对并发布</Button><Button block disabled={!!busy} onClick={() => setReturnOpen(true)}>退回修改</Button></>}
          {!!detail.work.published_version_id && !detail.work.withdrawn && <Button danger block disabled={!!busy} onClick={() => Modal.confirm({ title: '下架当前作品？', content: '当前公开版本将失效，草稿和审核记录保留。', onOk: () => operate('withdraw') })}>下架作品</Button>}
        </Space>
      </Card>}
      <Card title="审核流程" style={{ marginTop: 20 }}><Typography.Paragraph>草稿 → 企业审核 → 发布</Typography.Paragraph><Space direction="vertical">{detail.versions.map(v => <Typography.Text key={v.id}>V{v.number} · {statusLabels[v.status]}{String(v.id) === detail.work.published_version_id ? ' · 当前公开版本' : ''}</Typography.Text>)}</Space></Card>
    </Col></Row>
    <Modal open={returnOpen} title="退回修改" confirmLoading={busy === 'return'} onCancel={() => setReturnOpen(false)} onOk={() => void operate('return')} okButtonProps={{ disabled: !note.trim() }}><Input.TextArea value={note} onChange={e => setNote(e.target.value)} maxLength={500} rows={4} placeholder="请明确需要补充或修改的内容" /></Modal>
  </PageContainer>;
}
