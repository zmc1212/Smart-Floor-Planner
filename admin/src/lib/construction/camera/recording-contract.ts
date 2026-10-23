import path from 'node:path';
import { fail } from '@/lib/assistant/contracts';
import { mediaPart, type CameraStream } from './wvp';

export type CloudRecording = { sourceId: number; app: string; stream: string; mediaServerId: string; filePath: string; start: Date; end: Date; bytes: number };
export function shanghaiDay(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('camera_invalid_date',422);
  const from=new Date(value+'T00:00:00+08:00');
  if (!Number.isFinite(from.getTime()) || new Date(from.getTime()+28800000).toISOString().slice(0,10)!==value) fail('camera_invalid_date',422);
  return {from,to:new Date(from.getTime()+86400000)};
}
export function wvpTime(date: Date) { return new Date(date.getTime()+28800000).toISOString().slice(0,19).replace('T',' '); }
export function recordingFilePath(value: unknown, root=process.env.CAMERA_RECORDING_ROOT || '/opt/media/www/record') {
  if(typeof value!=='string'||!root.startsWith('/')||root==='/'||root.includes('..')||value.includes('\\')||value.includes('\0')||path.posix.normalize(value)!==value||!value.startsWith(root.replace(/\/$/,'')+'/')||!value.endsWith('.mp4')) fail('camera_invalid_recording',502);
  return value;
}
export function cloudRecording(value: unknown, expected: CameraStream): CloudRecording {
  if(!value||typeof value!=='object')fail('camera_invalid_recording',502);
  const r=value as Record<string,unknown>,rawStart=Number(r.startTime),rawEnd=Number(r.endTime),bytes=Number(r.fileSize),sourceId=Number(r.id);
  // The deployed WVP index exposes milliseconds; older event forms use seconds.
  const start=rawStart>=1e11?rawStart:rawStart*1000,end=rawEnd>=1e11?rawEnd:rawEnd*1000;
  if(!Number.isSafeInteger(sourceId)||sourceId<1||r.app!==expected.app||r.stream!==expected.stream||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<946684800000||end<=start||end>Date.now()+10000||!Number.isSafeInteger(bytes)||bytes<1||typeof r.mediaServerId!=='string'||!r.mediaServerId)fail('camera_invalid_recording',502);
  return {sourceId,app:mediaPart(r.app),stream:mediaPart(r.stream),mediaServerId:r.mediaServerId,filePath:recordingFilePath(r.filePath),start:new Date(start),end:new Date(end),bytes};
}
