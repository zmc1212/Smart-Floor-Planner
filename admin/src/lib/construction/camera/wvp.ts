import { createHash } from 'node:crypto';
import { fail } from '@/lib/assistant/contracts';

type Json = Record<string, unknown>;
export type CameraChannel = { deviceId: string; channelId: string; name: string; online: boolean; ptzType: number };
export type CameraStream = { app: string; stream: string };
export type PtzCommand = 'left' | 'right' | 'up' | 'down' | 'stop';
export const gbId = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{20}$/.test(value)) fail('camera_invalid_channel', 422);
  return value;
};
export function mediaPart(value: unknown) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(value)) fail('camera_invalid_stream', 502);
  return value;
}
function base(value: string) {
  const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw Error('Invalid camera service origin');
  return u.origin;
}
export class WvpClient {
  private token = '';
  private loginPending?: Promise<string>;
  readonly origin: string;
  readonly mediaOrigin: string;
  constructor(private readonly config: { origin: string; mediaOrigin: string; username: string; password: string }, private readonly transport: typeof fetch = fetch) {
    this.origin = base(config.origin); this.mediaOrigin = base(config.mediaOrigin);
  }
  private async raw(path: string, params: Record<string, string> = {}, authenticated = true, timeout = 15000) {
    const url = new URL(path, this.origin); url.search = new URLSearchParams(params).toString();
    let response: Response;
    try { response = await this.transport(url, { headers: authenticated ? { 'access-token': await this.login() } : {}, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(timeout) }); }
    catch { fail('camera_service_unavailable', 503); }
    if (response.status === 401) { this.token = ''; fail('camera_service_auth_failed', 503); }
    if (!response.ok) fail('camera_service_unavailable', 503);
    const body = await response.text();
    if (body.length > 2 * 1024 * 1024) fail('camera_invalid_response', 502);
    if (!body.trim()) return null;
    let data: unknown;
    try { data = JSON.parse(body); } catch { return body; }
    if (data && typeof data === 'object' && 'code' in data) {
      const envelope = data as Json;
      if (Number(envelope.code) !== 0) fail('camera_operation_failed', 502);
      return envelope.data ?? null;
    }
    return data;
  }
  private async login(): Promise<string> {
    if (this.token) return this.token;
    if (!this.loginPending) this.loginPending = (async () => {
      const r = await this.raw('/api/user/login', { username: this.config.username, password: createHash('md5').update(this.config.password).digest('hex') }, false) as Json;
      if (typeof r?.accessToken !== 'string' || !r.accessToken) fail('camera_service_auth_failed', 503);
      return this.token = r.accessToken;
    })().finally(() => { this.loginPending = undefined; });
    return this.loginPending;
  }
  async channels(deviceId: string): Promise<CameraChannel[]> {
    gbId(deviceId);
    const result = await this.raw(`/api/device/query/devices/${deviceId}/channels`, { page: '1', count: '1000' }) as Json;
    if (!Array.isArray(result?.list)) fail('camera_invalid_response', 502);
    return result.list.filter((c: Json) => typeof c.deviceId === 'string' && /^\d{20}$/.test(c.deviceId)).map((c: Json) => ({
      deviceId, channelId: String(c.deviceId), name: String(c.name || c.deviceId), online: c.status === 'ON' || c.status === 1,
      ptzType: Number(c.ptzType || 0),
    }));
  }
  async play(deviceId: string, channelId: string): Promise<CameraStream> {
    const result = await this.raw(`/api/play/start/${gbId(deviceId)}/${gbId(channelId)}`) as Json;
    return { app: mediaPart(result?.app), stream: mediaPart(result?.stream) };
  }
  // Shared streams are never stopped on an individual viewer's exit. WVP/ZLM
  // retains its own no-reader/recording lifecycle; the gateway closes that viewer.
  async ptz(deviceId: string, channelId: string, command: PtzCommand) {
    if (!['left', 'right', 'up', 'down', 'stop'].includes(command)) fail('camera_invalid_command', 422);
    await this.raw(`/api/front-end/ptz/${gbId(deviceId)}/${gbId(channelId)}`, { command, horizonSpeed: '32', verticalSpeed: '32', zoomSpeed: '0' }, true, 800);
  }
  async snapshot(deviceId: string, channelId: string): Promise<Buffer> {
    const result = await this.raw('/api/play/snap', { deviceId: gbId(deviceId), channelId: gbId(channelId) });
    // This pinned WVP returns a filesystem path. Its HTTP reader uses an exact
    // device/channel + mark, not a public /snap static directory.
    const original = typeof result === 'string' ? result : String((result as Json)?.url || '');
    const mark = new RegExp(`^(?:/opt/wvp)?/snap/${deviceId}_${channelId}_(\\d{14})\\.jpg$`).exec(original)?.[1];
    if (!mark) fail('camera_invalid_snapshot', 502);
    const url = new URL(`/api/device/query/snap/${deviceId}/${channelId}`, this.origin); url.searchParams.set('mark', mark);
    let response: Response;
    try { response = await this.transport(url, { headers: { 'access-token': await this.login() }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) }); }
    catch { fail('camera_snapshot_failed', 503); }
    if (!response.ok || !response.body) fail('camera_snapshot_failed', 502);
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) { size += chunk.length; if (size > 4194304) fail('camera_snapshot_too_large', 502); chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
}
let singleton: WvpClient | undefined;
export function cameraWvp() {
  if (!singleton) {
    const { CAMERA_WVP_ORIGIN, CAMERA_MEDIA_ORIGIN, CAMERA_WVP_USERNAME, CAMERA_WVP_PASSWORD } = process.env;
    if (!CAMERA_WVP_ORIGIN || !CAMERA_MEDIA_ORIGIN || !CAMERA_WVP_USERNAME || !CAMERA_WVP_PASSWORD) fail('camera_not_configured', 503);
    singleton = new WvpClient({ origin: CAMERA_WVP_ORIGIN, mediaOrigin: CAMERA_MEDIA_ORIGIN, username: CAMERA_WVP_USERNAME, password: CAMERA_WVP_PASSWORD });
  }
  return singleton;
}
