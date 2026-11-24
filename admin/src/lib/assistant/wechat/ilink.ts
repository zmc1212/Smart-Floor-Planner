import { createHash, randomBytes } from 'node:crypto';
import { fail } from '../contracts';

// The wire version follows Tencent/openclaw-weixin's v3 protocol.
export const weixinOrigin = 'https://ilinkai.weixin.qq.com';
const appHeaders = { 'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': String(3 << 16) };
const baseInfo = { channel_version: '3.0.0/xiaok-1', bot_agent: 'XiaoK/1.0' };

export function weixinApiOrigin(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { return fail('wechat_protocol_error', 502); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' ||
      url.search || url.hash || !/^[\w-]+\.weixin\.qq\.com$/i.test(url.hostname)) fail('wechat_protocol_error', 502);
  return url.origin;
}

async function request(origin: string, path: string, body?: object, token?: string, timeout = 12000) {
  const headers: Record<string,string> = { ...appHeaders };
  if (body) Object.assign(headers, {
    'Content-Type': 'application/json', AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': Buffer.from(String(randomBytes(4).readUInt32BE())).toString('base64'),
  });
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await fetch(weixinApiOrigin(origin) + '/ilink/bot/' + path, {
    method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
    headers, signal: AbortSignal.timeout(timeout), redirect: 'error', cache: 'no-store',
  });
  if (response.status === 401 || response.status === 403) fail('wechat_login_invalid', 409);
  if (!response.ok) fail('wechat_service_unavailable', 502);
  // iLink message IDs can exceed Number.MAX_SAFE_INTEGER. Keep their wire representation.
  const value = JSON.parse(await response.text(), (key: string, parsed: unknown, ctx?: { source?: string }) =>
    (key === 'message_id' || key === 'seq') && typeof parsed === 'number'
      ? ctx?.source ?? (Number.isSafeInteger(parsed) ? String(parsed) : null) : parsed);
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('wechat_protocol_error', 502);
  if (value.ret === -14 || value.errcode === -14) fail('wechat_login_invalid', 409);
  if (value.ret || value.errcode) fail('wechat_provider_rejected', 502);
  return value;
}

export type WeixinLogin = { code: string; display: string };
export type LoginResult =
  | { state: 'wait' | 'scanned' | 'pin' | 'expired' | 'already_bound' }
  | { state: 'redirect'; origin: string }
  | { state: 'confirmed'; origin: string; token: string; bot: string; peer: string };
export type WeixinInbound = { key: string; context: string; text: string | null };
export type WeixinAccount = { origin: string; token: string; bot: string; peer: string };

function nonempty(v: unknown): v is string { return typeof v === 'string' && v.length > 0; }
function inbound(raw: unknown, account: WeixinAccount): WeixinInbound | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (m.message_type !== 1 || m.group_id || m.delete_time_ms || m.message_state === 1 ||
      m.from_user_id !== account.peer || (m.to_user_id && m.to_user_id !== account.bot) ||
      !nonempty(m.context_token) || !Array.isArray(m.item_list)) return null;
  const id = nonempty(m.message_id) && m.message_id !== '0' ? 'msg:' + m.message_id : nonempty(m.client_id)
    ? 'client:' + m.client_id : nonempty(m.seq) && m.seq !== '0' ? 'seq:' + m.seq : null;
  if (!nonempty(id)) return null;
  const text = m.item_list.length && m.item_list.every(item => item?.type === 1 && nonempty(item.text_item?.text))
    ? m.item_list.map(item => item.text_item.text).join('\n').trim() || null : null;
  return { key: createHash('sha256').update(id).digest('hex'), context: m.context_token, text };
}

export const weixinClient = {
  async login(): Promise<WeixinLogin> {
    const value = await request(weixinOrigin, 'get_bot_qrcode?bot_type=3', { local_token_list: [] });
    if (!nonempty(value.qrcode) || !nonempty(value.qrcode_img_content)) fail('wechat_protocol_error', 502);
    return { code: value.qrcode, display: value.qrcode_img_content };
  },
  async status(origin: string, code: string, pin?: string): Promise<LoginResult> {
    const query = new URLSearchParams({ qrcode: code });
    if (pin) query.set('verify_code', pin);
    let value;
    try { value = await request(origin, 'get_qrcode_status?' + query, undefined, undefined, 20000); }
    catch (err) { if (err instanceof Error && err.name === 'TimeoutError') return { state: 'wait' }; throw err; }
    if (value.status === 'confirmed') {
      if (![value.bot_token, value.ilink_bot_id, value.ilink_user_id].every(nonempty)) fail('wechat_protocol_error', 502);
      return { state: 'confirmed', origin: weixinApiOrigin(value.baseurl || origin),
        token: value.bot_token, bot: value.ilink_bot_id, peer: value.ilink_user_id };
    }
    if (typeof value.status === 'string' && value.status.includes('need_verifycode')) return { state: 'pin' };
    if (value.status === 'scaned_but_redirect' && nonempty(value.redirect_host))
      return { state: 'redirect', origin: weixinApiOrigin('https://' + value.redirect_host) };
    if (value.status === 'scaned') return { state: 'scanned' };
    if (value.status === 'expired' || value.status === 'verify_code_blocked') return { state: 'expired' };
    if (value.status === 'binded_redirect') return { state: 'already_bound' };
    if (value.status !== 'wait') fail('wechat_protocol_error', 502);
    return { state: 'wait' };
  },
  async updates(account: WeixinAccount, cursor: string) {
    let value;
    try { value = await request(account.origin, 'getupdates', { get_updates_buf: cursor, base_info: baseInfo }, account.token, 38000); }
    catch (err) { if (err instanceof Error && err.name === 'TimeoutError') return { cursor, messages: [] }; throw err; }
    if (value.msgs !== undefined && !Array.isArray(value.msgs)) fail('wechat_protocol_error', 502);
    const messages: WeixinInbound[] = (value.msgs ?? []).map((m: unknown) => inbound(m, account)).filter(Boolean);
    return { cursor: nonempty(value.get_updates_buf) ? value.get_updates_buf : cursor, messages };
  },
  async reply(account: WeixinAccount, context: string, clientId: string, text: string) {
    const result = await request(account.origin, 'sendmessage', { base_info: baseInfo, msg: {
      from_user_id: '', to_user_id: account.peer, client_id: clientId, message_type: 2, message_state: 2,
      context_token: context, item_list: [{ type: 1, text_item: { text } }],
    } }, account.token, 8500);
    if (result.ret !== 0) fail('wechat_delivery_unknown', 502);
  },
};
