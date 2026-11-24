'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Divider, Input, Modal, Popconfirm, QRCode, Space, Tag } from 'antd';
import { notify } from '@/components/admin/operation-feedback';
import type { ChannelView } from '@/lib/assistant/wechat/channels';
import type { StageId } from '@/lib/xiaok-v1/stages';
import { assistantError, assistantRequest, formatTime } from './client';

const path = 'stage-agents/wechat';
const loginLabels: Record<string,string> = {
  wait: '打开微信扫码，并在手机上确认连接。', scanned: '已扫码，等待微信确认。', pin: '请输入微信在手机上显示的验证码。',
  expired: '二维码已过期', already_bound: '微信显示此机器人已绑定', login_invalid: '微信登录已失效',
  disconnected: '已断开', disabled: '阶段已停用',
};
const deliveryErrors: Record<string,string> = {
  wechat_provider_rejected: '微信拒绝了上一条回复。',
  wechat_delivery_unknown: '上一条回复的送达结果未知，已停止重发。',
  wechat_service_unavailable: '收发服务暂不可用，后台将自动重试。',
};

export function StageWechatChannel({ enterprise, stage, enabled }: { enterprise: string; stage: StageId | 'main'; enabled: boolean }) {
  const [channel, setChannel] = useState<ChannelView | null>();
  const [open, setOpen] = useState(false), [pin, setPin] = useState(''), [busy, setBusy] = useState(false);
  const [pinRejected, setPinRejected] = useState(false);
  const [error, setError] = useState(''), [revision, refresh] = useState(0);
  const sequence = useRef(0), action = useRef<AbortController | null>(null);
  const lifecycle = useRef<AbortController | null>(null);
  const post = useCallback((body: object, signal: AbortSignal) => assistantRequest<ChannelView>(path, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enterprise, stage, ...body }),
  }), [enterprise, stage]);
  useEffect(() => () => { action.current?.abort(); }, []);
  const id = channel?.id, status = channel?.status, state = channel?.loginState;
  useEffect(() => {
    const ac = new AbortController(), seq = sequence.current;
    lifecycle.current = ac;
    let timer: ReturnType<typeof setTimeout>;
    const polling = open && status === 'pending' && state !== 'pin' && id;
    async function update() {
      try {
        const next = polling ? await post({ action: 'poll', id }, ac.signal) :
          await assistantRequest<ChannelView | null>(path + '?' + new URLSearchParams({ enterprise, stage }), { signal: ac.signal });
        if (ac.signal.aborted || seq !== sequence.current) return;
        setChannel(next);
        setError('');
        if (polling && next?.status === 'connected') { setOpen(false); notify.success('微信个人号已连接'); }
        timer = setTimeout(() => void update(), polling ? 1200 : 8000);
      } catch (err) {
        if (!ac.signal.aborted && seq === sequence.current) {
          setError(assistantError(err));
          timer = setTimeout(() => void update(), 5000);
        }
      }
    }
    if (!busy) void update();
    return () => { ac.abort(); clearTimeout(timer); };
  }, [busy, enterprise, id, open, post, revision, stage, state, status]);

  async function mutate(kind: 'start' | 'disconnect' | 'poll') {
    if (action.current) return;
    const ac = new AbortController();
    action.current = ac;
    sequence.current++;
    lifecycle.current?.abort();
    setBusy(true); setError(''); setPinRejected(false);
    try {
      const result = await post({ action: kind, ...(kind !== 'start' ? { id } : {}), ...(kind === 'poll' ? { pin } : {}) }, ac.signal);
      if (ac.signal.aborted) return;
      setChannel(result); setPin(''); setOpen(result.status === 'pending');
      if (kind === 'disconnect') notify.success('已断开微信个人号');
      else if (result.status === 'connected') notify.success('微信个人号已连接');
      else if (kind === 'poll' && result.loginState === 'pin') setPinRejected(true);
    } catch (err) {
      if (!ac.signal.aborted) { setError(assistantError(err)); notify.error(assistantError(err)); }
    } finally {
      action.current = null;
      if (!ac.signal.aborted) setBusy(false);
    }
  }
  const connected = status === 'connected', pending = status === 'pending';
  const close = () => { setOpen(false); setPin(''); setPinRejected(false); };
  const issue = error || (channel?.error && deliveryErrors[channel.error]);
  return <>
    <Divider />
    <h3>微信个人号</h3>
    <Space wrap>
      <Tag color={connected ? 'green' : pending ? 'gold' : undefined}>{connected ? '已绑定' : pending ? '待扫码确认' :
        channel === undefined ? '读取中' : loginLabels[state ?? ''] || '未连接'}</Tag>
      {!connected && <Button type="primary" loading={busy} disabled={!enabled || channel === undefined}
        onClick={() => pending ? setOpen(true) : void mutate('start')}>{pending ? '继续扫码' : '扫码连接'}</Button>}
      {(connected || pending) && <Popconfirm title={pending ? '取消本次扫码？' : '断开后将停止收发微信消息，确认断开？'}
        onConfirm={() => mutate('disconnect')}><Button loading={busy}>{pending ? '取消连接' : '断开连接'}</Button></Popconfirm>}
    </Space>
    <p>{stage === 'main' ? '此码用于体验主小K。收取本人报告，请从小程序的工地日报与周报页关联微信。' : '用自己的微信扫码后，在「微信 ClawBot」里与当前阶段的小K文字私聊。发送 /reset 可开启新对话。'}</p>
    {connected && <p>{channel?.lastPollAt ? '上次收信检查 ' + formatTime(channel.lastPollAt) : '等待本企业的小K Worker 接收消息'}
      {channel?.lastReplyAt ? ' · 上次微信接收回复 ' + formatTime(channel.lastReplyAt) : ''}</p>}
    {issue && !open && <Alert type="warning" showIcon message={issue} action={<Button onClick={() => refresh(n => n + 1)}>刷新</Button>} />}
    <Modal title="微信个人号扫码连接" open={open} onCancel={close} footer={<Button onClick={close}>关闭</Button>} destroyOnHidden>
      {pending && channel?.qr && <Space direction="vertical">
        <QRCode value={channel.qr} size={224} />
        <span>{loginLabels[state || 'wait']}</span>
        {state === 'pin' && <Space.Compact>
          <Input aria-label="微信验证码" inputMode="numeric" value={pin} maxLength={12} onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setPinRejected(false); }}
            onPressEnter={() => { if (pin) void mutate('poll'); }} />
          <Button type="primary" disabled={!pin} loading={busy} onClick={() => void mutate('poll')}>确认</Button>
        </Space.Compact>}
      </Space>}
      {status === 'closed' && <Space>{loginLabels[state || 'expired']}<Button onClick={() => void mutate('start')} loading={busy}>重新扫码</Button></Space>}
      {error && <Alert type="warning" showIcon message={error} />}
      {!error && state === 'pin' && pinRejected && <Alert type="warning" showIcon message="请核对手机上的验证码后重新输入。" />}
    </Modal>
  </>;
}
