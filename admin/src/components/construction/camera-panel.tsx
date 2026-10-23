'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tag } from 'antd';
import { notify } from '@/components/admin/operation-feedback';
import { constructionRequest, errorText } from './client';
type Camera = { id: string; binding_id?: string; name: string; version: number; project_id?: string; ptz_enabled: boolean;recording_enabled?:boolean;retention_days?:number;recording_version?:number;recording_state?:string;recording_error?:string };
export function CameraPanel({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<Camera[]>([]), [inventory, setInventory] = useState<Camera[]>([]);
  const [manage, setManage] = useState(false), [configure, setConfigure] = useState(false), [platform, setPlatform] = useState(false), [chosen, setChosen] = useState<string>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [registering, setRegistering] = useState(false);
  const [loading, setLoading] = useState(true);
  const [recordingCamera,setRecordingCamera]=useState<Camera>(),[retentionLimit,setRetentionLimit]=useState(7);
  const [recordingForm]=Form.useForm();
  const [form] = Form.useForm(); const alive = useRef(true);
  const root = 'video/projects/' + projectId;
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const state = await constructionRequest<{ items: Camera[]; canManage: boolean; canConfigure: boolean;maxRetentionDays:number }>(root + '/cameras');
      const available = state.canManage ? await constructionRequest<{ items: Camera[]; canRegister: boolean }>(root + '/inventory') : { items: [], canRegister: false };
      if (!alive.current) return;
      setItems(state.items); setManage(state.canManage); setConfigure(state.canConfigure); setInventory(available.items); setPlatform(available.canRegister); setError('');
      setRetentionLimit(state.maxRetentionDays);
    } catch (e) { if (alive.current) { setError(errorText(e)); setItems([]); setInventory([]); } }
    finally { if (alive.current) setLoading(false); }
  }, [root]);
  useEffect(() => { alive.current = true;setRecordingCamera(undefined); void load(); return () => { alive.current = false; }; }, [load]);
  useEffect(()=>{if(!items.some(c=>c.recording_state==='pending'))return;const timer=setTimeout(()=>void load(),3000);return()=>clearTimeout(timer);},[items,load]);
  const write = async (path: string, data: unknown, success: string) => {
    setBusy(true);
    try {
      await constructionRequest(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (!alive.current) return; notify.success(success); setRegistering(false);setRecordingCamera(undefined); setChosen(undefined); await load();
    } catch (e) { if (alive.current) { notify.error('摄像头操作未完成', { description: errorText(e) }); await load(); } }
    finally { if (alive.current) setBusy(false); }
  };
  const preview = async () => {
    const target = window.open('about:blank', '_blank'); if (!target) { notify.error('浏览器阻止了播放窗口，请允许弹出窗口后重试'); return; }
    target.opener = null; setBusy(true);
    try {
      const result = await constructionRequest<{ url: string }>(root + '/entry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!alive.current) { target.close(); return; } target.location.href = result.url;
    } catch (e) { target.close(); notify.error('暂时无法打开直播', { description: errorText(e) }); }
    finally { if (alive.current) setBusy(false); }
  };
  return <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    <Alert type="info" showIcon message="私有工地视频" description="当前工地的有效成员可查看直播。负责人和项目经理可抓拍及操作已验证支持云台的设备。" />
    {error && <Alert type="error" showIcon message={error} action={<Button onClick={() => void load()}>重新读取</Button>} />}
    <Space wrap><Button type="primary" disabled={busy || !items.length} onClick={() => void preview()}>打开工地视频</Button><Button disabled={busy} onClick={() => void load()}>刷新</Button>{platform && <Button disabled={busy} onClick={() => { form.resetFields(); setRegistering(true); }}>分配 WVP 摄像头</Button>}</Space>
    {manage && <Space wrap><Select aria-label="待绑定摄像头" placeholder="选择本企业尚未绑定的摄像头" value={chosen} style={{ minWidth: 260 }} disabled={busy} onChange={setChosen} options={inventory.filter(c => !c.project_id).map(c => ({ value: c.id, label: c.name }))} /><Button disabled={busy || !chosen} onClick={() => { const c = inventory.find(c => c.id === chosen); if (c) void write(root + '/binding', { cameraId: c.id, expectedVersion: c.version, bind: true }, '摄像头已绑定'); }}>绑定到当前工地</Button></Space>}
    <Table<Camera> rowKey="id" pagination={false} loading={loading} dataSource={items} locale={{ emptyText: <Empty description="当前工地尚未绑定摄像头" /> }} columns={[
      { title: '摄像头', dataIndex: 'name' }, { title: '云台', render: (_, c) => <Space><Tag>{c.ptz_enabled ? '已开放' : '未开放'}</Tag>{configure && <Popconfirm title={c.ptz_enabled ? '关闭云台控制？' : '为已验证支持方向控制的设备开放云台？'} onConfirm={() => write(root+'/configure',{cameraId:c.id,expectedVersion:c.version,ptzEnabled:!c.ptz_enabled},'云台控制设置已保存')}><Button size="small" disabled={busy}>{c.ptz_enabled ? '关闭' : '开放'}</Button></Popconfirm>}</Space> },
      {title:'云端录像',render:(_,c)=><Space direction="vertical" size="small"><Tag color={c.recording_state==='recording'?'green':c.recording_state==='error'?'error':undefined}>{({recording:'正在录制',pending:'正在应用设置',stopped:'已停止',error:'录制异常'} as Record<string,string>)[c.recording_state||'']||'未开启'}</Tag><span>保留 {c.retention_days||3} 天</span>{c.recording_error&&<span>{errorText({code:c.recording_error})}</span>}{configure&&<Button size="small" disabled={busy} onClick={()=>{recordingForm.setFieldsValue({enabled:!!c.recording_enabled,retentionDays:c.retention_days||3});setRecordingCamera(c);}}>录制设置</Button>}</Space>},
      ...(manage ? [{ title: '操作', render: (_: unknown, c: Camera) => <Popconfirm title="解绑此摄像头？" description="请先停止录制。当前直播会话将失效，已有抓拍及有效期内录像仍保留在本工地。" onConfirm={() => write(root + '/binding', { cameraId: c.id, expectedVersion: c.version, bind: false }, '摄像头已解绑')}><Button danger disabled={busy}>解绑</Button></Popconfirm> }] : []),
    ]} />
    <Modal title="分配 WVP 摄像头到当前企业" open={registering} confirmLoading={busy} onCancel={() => !busy && setRegistering(false)} onOk={() => void form.validateFields().then(values => write('video/register', values, '摄像头已分配到当前企业')).catch(() => {})}>
      <Form form={form} layout="vertical"><Form.Item name="name" label="名称" rules={[{ required: true, max: 80 }]}><Input maxLength={80} /></Form.Item><Form.Item name="deviceId" label="WVP 设备编号" rules={[{ required: true, pattern: /^\d{20}$/ }]}><Input maxLength={20} /></Form.Item><Form.Item name="channelId" label="视频通道编号" rules={[{ required: true, pattern: /^\d{20}$/ }]}><Input maxLength={20} /></Form.Item></Form>
    </Modal>
    <Modal title={'云端录像 · '+(recordingCamera?.name||'')} open={!!recordingCamera} confirmLoading={busy} onCancel={()=>!busy&&setRecordingCamera(undefined)} onOk={()=>void recordingForm.validateFields().then(values=>recordingCamera&&write(root+'/recording',{bindingId:recordingCamera.binding_id,expectedVersion:recordingCamera.recording_version||0,...values},'录像策略已保存，正在核对实际录制状态')).catch(()=>{})}>
      <Alert type="info" showIcon message="连续上传到服务器" description="适用于有线宽带工地。启用后无人观看也持续上传视频；4G 工地请保持关闭，SD 卡回放尚未可用。" />
      <Form form={recordingForm} layout="vertical" style={{marginTop:16}}><Form.Item name="enabled" label="连续云端录像" valuePropName="checked"><Switch /></Form.Item><Form.Item name="retentionDays" label="保留天数" rules={[{required:true,type:'number',min:1,max:retentionLimit}]} extra={'默认 3 天；当前节点最多 '+retentionLimit+' 天。缩短保留时间后，过期录像将不可播放并进入清理；延长不能恢复已删除录像。'}><InputNumber min={1} max={retentionLimit} precision={0} /></Form.Item></Form>
    </Modal>
  </Space>;
}
