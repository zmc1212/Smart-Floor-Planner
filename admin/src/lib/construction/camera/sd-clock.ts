import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fail } from '@/lib/assistant/contracts';
import { gbId } from './wvp';

export type SdClockSource = { source: Date; serialHash: string };
export type SdClockReader = (device: string, channel: string) => Promise<SdClockSource>;
export const readSdClock: SdClockReader = async (device, channel) => {
  if (!process.env.CAMERA_SD_PYTHON || !process.env.CAMERA_SD_VENDOR_ADAPTER || !process.env.CAMERA_SD_DEVICES_FILE) fail('camera_sd_clock_unavailable', 503);
  try {
    const result = await promisify(execFile)(process.env.CAMERA_SD_PYTHON, [path.join(process.cwd(), 'scripts/construction-camera-sd-clock.py'), gbId(device), gbId(channel)], { timeout: 12000, maxBuffer: 4096, windowsHide: true });
    const data = JSON.parse(result.stdout), source = new Date(data.source);
    if (!Number.isFinite(source.getTime()) || typeof data.serialHash !== 'string' || !/^[a-f0-9]{64}$/.test(data.serialHash)) throw Error();
    return { source, serialHash: data.serialHash };
  } catch { fail('camera_sd_clock_unavailable', 503); }
};
