import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, open, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as pause } from 'node:timers/promises';
import { fail } from '@/lib/assistant/contracts';

const manifestName = 'hls.m3u8';
const segmentName = /^(seg-\d{9,20}\.ts)$/;
const segmentResource = /^aac\/([a-f\d-]{36})\/(seg-\d{9,20}\.ts)$/;
const targetDurationTag = /^#EXT-X-TARGETDURATION:([1-9]\d*)\r?$/m;
const fragmentDurationTag = /^#EXTINF:([\d.]+),/gm;
const idleMs = 25000;
const startupMs = 20000;
const startupBufferSeconds = 10;

type LiveAacJob = {
  id: string;
  abort: AbortController;
  directory: Promise<string>;
  targetDuration?: number;
  idle?: NodeJS.Timeout;
  done: Promise<void>;
};

// One FFmpeg process and sliding HLS playlist per trusted upstream stream.
const jobs = new Map<string, LiveAacJob>();

async function transcode(source: URL, directory: string, abort: AbortController) {
  const { signal } = abort;
  signal.throwIfAborted();
  const response = await fetch(source, { redirect: 'error', signal });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    fail('camera_operation_failed', 502);
  }
  signal.throwIfAborted();
  const child = spawn(process.env.CAMERA_LIVE_AAC_FFMPEG || 'ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-f', 'flv', '-analyzeduration', '5000000', '-probesize', '3000000', '-i', 'pipe:0',
    '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-c:a', 'aac', '-profile:a', 'aac_low',
    '-af', 'aresample=async=1:first_pts=0', '-ar', '48000', '-ac', '1', '-b:a', '48k',
    '-f', 'hls', '-hls_time', '2', '-hls_list_size', '11', '-hls_delete_threshold', '12', '-hls_start_number_source', 'epoch',
    '-hls_flags', 'delete_segments+omit_endlist+temp_file',
    '-hls_segment_filename', join(directory, 'seg-%09d.ts'), join(directory, manifestName),
  ], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true, signal, killSignal: 'SIGKILL' });
  const closed = new Promise<void>(resolve => child.once('close', () => { abort.abort(); resolve(); }));
  child.on('error', error => {
    if (error.name !== 'AbortError') console.error('Camera AAC encoder failed to start');
    abort.abort();
  });
  try {
    await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), child.stdin, { signal });
    await closed;
  } finally {
    abort.abort();
    await closed;
  }
}

function hold(job: LiveAacJob) {
  clearTimeout(job.idle);
  job.idle = setTimeout(() => job.abort.abort(), idleMs).unref();
}

function start(source: URL) {
  const parent = realpath(tmpdir());
  const job: LiveAacJob = {
    id: randomUUID(), abort: new AbortController(),
    directory: parent.then(path => mkdtemp(join(path, 'sfp-camera-aac-'))),
    done: Promise.resolve(),
  };
  jobs.set(source.href, job);
  hold(job);
  job.done = (async () => {
    try { await transcode(source, await job.directory, job.abort); }
    catch {
      if (!job.abort.signal.aborted) console.error('Camera AAC input unavailable');
    } finally {
      job.abort.abort();
      clearTimeout(job.idle);
      if (jobs.get(source.href) === job) jobs.delete(source.href);
      try {
        const directory = await realpath(await job.directory);
        if (dirname(directory) === await parent) await rm(directory, { recursive: true, force: true, maxRetries: 3 });
      } catch { console.error('Camera AAC temporary directory cleanup failed'); }
    }
  })();
  return job;
}

async function readManifest(job: LiveAacJob, signal: AbortSignal, minSegments: number) {
  const filename = join(await job.directory, manifestName);
  const deadline = Date.now() + startupMs;
  while (!job.abort.signal.aborted && !signal.aborted && Date.now() < deadline) {
    try {
      const manifest = await readFile(filename, 'utf8');
      const lines = manifest.split(/\r?\n/);
      const encoderTarget = Number(targetDurationTag.exec(manifest)?.[1]);
      if (!Number.isSafeInteger(encoderTarget)) fail('camera_invalid_playlist', 502);
      const targetDuration = job.targetDuration ?? Math.max(6, encoderTarget);
      const durations = [...manifest.matchAll(fragmentDurationTag)];
      const bufferedSeconds = durations.reduce((sum, item) => sum + Number(item[1]), 0);
      if (durations.length >= minSegments && (job.targetDuration || bufferedSeconds >= Math.max(startupBufferSeconds, targetDuration))) {
        // Keep a constant target while this playlist advances. FFmpeg reports
        // the longest segment currently in its window, which can vary by GOP.
        if (encoderTarget > targetDuration) {
          job.abort.abort();
          fail('camera_invalid_playlist', 502);
        }
        job.targetDuration = targetDuration;
        return lines.map(line => segmentName.test(line) ? `aac/${job.id}/${line}` : line)
          .join('\n').replace(targetDurationTag, `#EXT-X-TARGETDURATION:${job.targetDuration}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await pause(150, undefined, { signal });
  }
  fail('camera_operation_failed', 502);
}

export async function openCameraAacMedia(source: URL, resource: string, signal: AbortSignal, minSegments = 1) {
  const current = jobs.get(source.href);
  const job = current && !current.abort.signal.aborted ? current : undefined;
  if (resource === manifestName) {
    const playback = job ?? start(source);
    hold(playback);
    return { manifest: await readManifest(playback, signal, minSegments) };
  }
  const segment = segmentResource.exec(resource);
  if (!job || !segment || segment[1] !== job.id) fail('camera_media_unavailable', 404);
  try {
    const file = await open(join(await job.directory, segment[2]), 'r');
    hold(job);
    return { file };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') fail('camera_media_unavailable', 404);
    throw error;
  }
}

export async function stopCameraAacJobs() {
  const active = [...jobs.values()];
  for (const job of active) job.abort.abort();
  await Promise.all(active.map(job => job.done));
}
