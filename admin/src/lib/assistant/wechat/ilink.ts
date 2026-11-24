import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { fail } from '../contracts';

// The wire version follows Tencent/openclaw-weixin's v3 protocol.
export const weixinOrigin = 'https://ilinkai.weixin.qq.com';
const appHeaders = { 'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': String(3 << 16) };
const baseInfo = { channel_version: '3.0.0/xiaok-1', bot_agent: 'XiaoK/1.0' };
const weixinCdn = 'https://novac2c.cdn.weixin.qq.com/c2c';

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
export type WeixinImageItem = { type: 2; image_item: { media: {
  encrypt_query_param: string; aes_key: string; encrypt_type: 1;
}; mid_size: number } };

async function sendItem(account: WeixinAccount, context: string, clientId: string, item: WeixinImageItem | { type: 1; text_item: { text: string } }) {
  const result = await request(account.origin, 'sendmessage', { base_info: baseInfo, msg: {
    from_user_id: '', to_user_id: account.peer, client_id: clientId, message_type: 2, message_state: 2,
    context_token: context, item_list: [item],
  } }, account.token, 8500);
  // iLink may omit a zero ret in its JSON acknowledgement.
  if (result.ret !== undefined && result.ret !== 0) fail('wechat_delivery_unknown', 502);
}

function uploadUrl(full: unknown, param: unknown, filekey: string) {
  if (!nonempty(full)) {
    if (!nonempty(param)) return fail('wechat_protocol_error', 502);
    return `${weixinCdn}/upload?encrypted_query_param=${encodeURIComponent(param)}&filekey=${filekey}`;
  }
  let url: URL;
  try { url = new URL(full); } catch { return fail('wechat_protocol_error', 502); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      !url.hostname.endsWith('.cdn.weixin.qq.com')) return fail('wechat_protocol_error', 502);
  return url.href;
}

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
    await sendItem(account, context, clientId, { type: 1, text_item: { text } });
  },
  async uploadImage(account: WeixinAccount, image: Buffer): Promise<WeixinImageItem> {
    // Prepare encrypted CDN media before the final send/permission transaction.
    const filekey = randomBytes(16).toString('hex');
    const key = randomBytes(16);
    const aeskey = key.toString('hex');
    const cipher = createCipheriv('aes-128-ecb', key, null);
    const encrypted = Buffer.concat([cipher.update(image), cipher.final()]);
    const value = await request(account.origin, 'getuploadurl', {
      filekey, media_type: 1, to_user_id: account.peer, rawsize: image.length,
      rawfilemd5: createHash('md5').update(image).digest('hex'), filesize: encrypted.length,
      no_need_thumb: true, aeskey, base_info: baseInfo,
    }, account.token, 8500);
    const response = await fetch(uploadUrl(value.upload_full_url, value.upload_param, filekey), {
      method: 'POST', body: new Uint8Array(encrypted), headers: { 'Content-Type': 'application/octet-stream' },
      signal: AbortSignal.timeout(8500), redirect: 'error', cache: 'no-store',
    });
    const reference = response.headers.get('x-encrypted-param');
    await response.body?.cancel().catch(() => undefined);
    if (response.status !== 200 || !reference) return fail('wechat_protocol_error', 502);
    return { type: 2, image_item: { media: { encrypt_query_param: reference,
      aes_key: Buffer.from(aeskey, 'utf8').toString('base64'), encrypt_type: 1 }, mid_size: encrypted.length } };
  },
  async replyImage(account: WeixinAccount, context: string, clientId: string, item: WeixinImageItem) {
    await sendItem(account, context, clientId, item);
  },
};

export type WeixinDeliveryClient = Pick<typeof weixinClient, 'updates' | 'reply'> &
  Partial<Pick<typeof weixinClient, 'uploadImage' | 'replyImage'>>;
