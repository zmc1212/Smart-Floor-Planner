import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fail } from '@/lib/assistant/contracts';
import { gbId } from './wvp';

export type SdClockSource = { source: Date; serialHash: string };
export type SdClockReader = (device: string, channel: string) => Promise<SdClockSource>;
export async function readSipSdClock(device: string, channel: string, transport: typeof fetch = fetch): Promise<SdClockSource> {
  const origin = new URL(process.env.CAMERA_SD_CLOCK_ORIGIN || '');
  const token = process.env.CAMERA_SD_CLOCK_TOKEN;
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || !token || token.length < 32) fail('camera_sd_clock_unavailable', 503);
  const response = await transport(new URL(`/clock/${gbId(device)}/${gbId(channel)}`, origin), { headers: { Authorization: 'Bearer ' + token }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12000) });
  if (!response.ok || Number(response.headers.get('content-length')) > 4096) fail('camera_sd_clock_unavailable', 503);
  const text = await response.text(); if (text.length > 4096) fail('camera_sd_clock_unavailable', 503);
  const data = JSON.parse(text), source = new Date(data.source), observed = Date.parse(data.observedAt);
  if (!Number.isFinite(source.getTime()) || !Number.isFinite(observed) || Math.abs(Date.now() - observed) > 15000 || data.identityKind !== 'gb28181-registration' || typeof data.serialHash !== 'string' || !/^[a-f0-9]{64}$/.test(data.serialHash)) fail('camera_sd_clock_unavailable', 503);
  return { source, serialHash: data.serialHash };
}
export const readSdClock: SdClockReader = async (device, channel) => {
  if (process.env.CAMERA_SD_CLOCK_ORIGIN) {
    try { return await readSipSdClock(device, channel); } catch { fail('camera_sd_clock_unavailable', 503); }
  }
  if (!process.env.CAMERA_SD_PYTHON || !process.env.CAMERA_SD_VENDOR_ADAPTER || !process.env.CAMERA_SD_DEVICES_FILE) fail('camera_sd_clock_unavailable', 503);
  try {
    const result = await promisify(execFile)(process.env.CAMERA_SD_PYTHON, [path.join(process.cwd(), 'scripts/construction-camera-sd-clock.py'), gbId(device), gbId(channel)], { timeout: 12000, maxBuffer: 4096, windowsHide: true });
    const data = JSON.parse(result.stdout), source = new Date(data.source);
    if (!Number.isFinite(source.getTime()) || typeof data.serialHash !== 'string' || !/^[a-f0-9]{64}$/.test(data.serialHash)) throw Error();
    return { source, serialHash: data.serialHash };
  } catch { fail('camera_sd_clock_unavailable', 503); }
};
