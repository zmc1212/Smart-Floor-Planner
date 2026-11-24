import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const directory = await mkdtemp(join(tmpdir(), 'sfp-camera-debug-'));
const playlist = join(directory, 'hls.m3u8');
const clip = join(directory, 'test-pattern.mp4');
const cover = join(directory, 'cover.jpg');
const options = ['-nostdin', '-hide_banner', '-loglevel', 'error'];
const runFfmpeg = promisify(execFile);
try {
  await runFfmpeg('ffmpeg', [...options, '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=15',
    '-t', '8', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-threads', '1', '-g', '15', '-sc_threshold', '0', clip],
  { timeout: 15000, windowsHide: true });
  await runFfmpeg('ffmpeg', [...options, '-ss', '2', '-i', clip, '-frames:v', '1', '-q:v', '3', '-threads', '1', cover],
    { timeout: 5000, windowsHide: true });
} catch (error) {
  await rm(directory, { recursive: true, force: true });
  throw error;
}
const coverCapturedAt = new Date().toISOString();
const loop = [...options, '-re', '-stream_loop', '-1', '-i', clip, '-map', '0:v:0', '-c:v', 'copy'];
const ffmpeg = spawn('ffmpeg', [...loop,
  '-f', 'hls', '-hls_time', '1', '-hls_list_size', '6', '-hls_flags', 'delete_segments+omit_endlist+temp_file+independent_segments',
  '-hls_segment_filename', join(directory, 'part-%08d.ts'), playlist], { stdio: ['ignore', 'ignore', 'inherit'], windowsHide: true });

const viewers = new Set();
let stopping = false;
const mediaPath = /^\/sfp_debug\/test_pattern\/(hls\.m3u8|part-\d{8}\.ts|cover\.jpg)$/;
const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  const head = request.method === 'HEAD';
  if (!head && request.method !== 'GET') return response.writeHead(405).end();
  const path = request.url;
  const match = mediaPath.exec(path ?? '');
  if (path === '/healthz' || match) {
    const name = match?.[1] ?? 'hls.m3u8';
    try {
      const data = await readFile(join(directory, name));
      if (!match) return response.writeHead(204).end();
      if (name === 'cover.jpg') {
        return response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': data.length,
          'X-Camera-Captured-At': coverCapturedAt }).end(head ? undefined : data);
      }
      const type = name.endsWith('.ts') ? 'video/mp2t' : 'application/vnd.apple.mpegurl';
      return response.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length }).end(head ? undefined : data);
    } catch {
      return response.writeHead(match ? 404 : 503).end();
    }
  }
  if (path !== '/sfp_debug/test_pattern.live.flv') return response.writeHead(404).end();
  if (head) return response.writeHead(200, { 'Content-Type': 'video/x-flv' }).end();
  if (viewers.size >= 8) return response.writeHead(503).end();

  // Both playback formats reuse the test pattern encoded at startup.
  const viewer = spawn('ffmpeg', [...loop, '-f', 'flv', '-flvflags', 'no_duration_filesize', 'pipe:1'],
  { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
  viewers.add(viewer);
  response.setHeader('Content-Type', 'video/x-flv');
  const finish = () => {
    viewers.delete(viewer);
    if (!response.headersSent) response.writeHead(503);
    response.end();
  };
  viewer.once('error', finish);
  viewer.once('close', finish);
  response.once('close', () => { if (viewers.has(viewer)) viewer.kill(); });
  viewer.stdout.pipe(response, { end: false });
});

async function stop(code) {
  if (stopping) return;
  stopping = true;
  server.close();
  server.closeAllConnections();
  for (const viewer of viewers) viewer.kill();
  if (ffmpeg.pid && ffmpeg.exitCode === null && ffmpeg.signalCode === null) {
    const stopped = new Promise(resolve => ffmpeg.once('close', resolve));
    ffmpeg.kill();
    await stopped;
  }
  await rm(directory, { recursive: true, force: true });
  process.exitCode = code;
}

ffmpeg.once('error', () => { void stop(1); });
ffmpeg.once('close', () => { if (!stopping) void stop(1); });
server.once('error', () => { void stop(1); });
process.once('SIGINT', () => { void stop(0); });
process.once('SIGTERM', () => { void stop(0); });
server.listen(Number(process.env.SFP_DEBUG_CAMERA_PORT ?? 8080), process.env.SFP_DEBUG_CAMERA_HOST ?? '0.0.0.0');
