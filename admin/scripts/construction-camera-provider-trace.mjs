// Optional diagnostic preload: --import <this file>. It observes the existing
// fetch once, without retrying requests or logging URLs, credentials or bodies.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isMainThread} from 'node:worker_threads';

const reads = new Set([
  '/api/user/login', '/api/record/plan/query', '/api/record/plan/get',
  '/api/record/plan/channel/list', '/api/cloud/record/list', '/api/cloud/record/play/path',
  '/index/api/isRecording', '/index/api/getThreadsLoad', '/index/api/getMediaList',
]);
const controls = new Set([
  '/api/record/plan/add', '/api/record/plan/update', '/api/record/plan/link',
  '/api/cloud/record/delete', '/api/play/snap',
  '/index/api/startRecord', '/index/api/stopRecord',
]);
const dynamic = [
  ['channels', /^\/api\/device\/query\/devices\/\d{20}\/channels$/],
  ['play-start', /^\/api\/play\/start\/\d{20}\/\d{20}$/],
  ['sd-query', /^\/api\/gb_record\/query\/\d{20}\/\d{20}$/],
  ['sd-start', /^\/api\/playback\/start\/\d{20}\/\d{20}$/],
  ['sd-stop', /^\/api\/playback\/stop\/\d{20}\/\d{20}\/[a-zA-Z0-9_-]{1,160}$/],
  ['ptz', /^\/api\/front-end\/ptz\/\d{20}\/\d{20}$/],
];
function endpoint(url) {
  if (reads.has(url.pathname) || controls.has(url.pathname)) return url.pathname;
  return dynamic.find(([, pattern]) => pattern.test(url.pathname))?.[0];
}
function scalarCode(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d{1,8}$/.test(value)) return value;
  return undefined;
}
export function responseShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {jsonType: Array.isArray(value) ? 'array' : typeof value};
  const data = value.data;
  return {
    jsonType: 'object', code: scalarCode(value.code),
    result: typeof value.result === 'boolean' ? value.result : undefined,
    status: typeof value.status === 'boolean' ? value.status : undefined,
    messageCategory: value.msg === 'can not find the stream' ? 'stream_missing' : value.msg === undefined ? 'absent' : 'other',
    dataType: data === null ? 'null' : Array.isArray(data) ? 'array' : typeof data,
    dataList: Array.isArray(data?.list), listLength: Array.isArray(data?.list) ? data.list.length : undefined,
  };
}
async function shape(response, maxBytes, bodyDeadlineMs) {
  const reader = response.clone().body?.getReader();
  if (!reader) return {bodyState: 'empty'};
  let timer;
  try {
    const consume = async () => {
      const chunks = []; let bytes = 0;
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > maxBytes) return {bodyState: 'oversized', bytesRead: bytes};
        chunks.push(Buffer.from(next.value));
      }
      try { return {bodyState: 'json', bytesRead: bytes, ...responseShape(JSON.parse(Buffer.concat(chunks).toString('utf8')))}; }
      catch { return {bodyState: bytes ? 'non_json' : 'empty', bytesRead: bytes}; }
    };
    return await Promise.race([consume(), new Promise(resolve => { timer = setTimeout(() => resolve({bodyState: 'diagnostic_deadline'}), bodyDeadlineMs); })]);
  } catch { return {bodyState: 'unreadable'}; }
  finally { clearTimeout(timer); void reader.cancel().catch(() => undefined); }
}

export function installProviderTrace({file, origins, transport = globalThis.fetch, maxBytes = 2 * 1024 * 1024, bodyDeadlineMs = 1000}) {
  if (!path.isAbsolute(file) || !origins.length || typeof transport !== 'function') throw Error('Invalid provider trace configuration');
  const allowed = new Set(origins.map(value => new URL(value).origin));
  // Each process has its own new receipt. Existing attempts are never replaced.
  const fd = fs.openSync(file, 'wx', 0o600), pending = new Set();
  let sequence = 0, failed = false;
  const write = event => {
    try { fs.writeSync(fd, JSON.stringify({at: new Date().toISOString(), pid: process.pid, ...event})+'\n'); }
    catch { if (!failed) { failed = true; process.stderr.write('camera_provider_trace_write_failed\n'); } }
  };
  write({phase: 'installed', driverSha256: createHash('sha256').update(fs.readFileSync(import.meta.filename)).digest('hex')});
  const fetch = async (input, init) => {
    let url;
    try { url = new URL(input instanceof Request ? input.url : String(input)); } catch { return transport(input, init); }
    const name = allowed.has(url.origin) ? endpoint(url) : undefined;
    if (!name) return transport(input, init);
    const id = ++sequence, began = performance.now();
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    write({id, phase: 'request', endpoint: name, method: ['GET','POST','DELETE','HEAD'].includes(method) ? method : 'other'});
    let response;
    try { response = await transport(input, init); }
    catch (error) { write({id, phase: 'transport_error', endpoint: name, elapsedMs: performance.now()-began}); throw error; }
    write({id, phase: 'headers', endpoint: name, http: response.status, elapsedMs: performance.now()-began});
    // Background observation never extends a provider's configured deadline or
    // changes the Response, Signal, request body, success guard or retry count.
    const work = shape(response, maxBytes, bodyDeadlineMs).then(value => write({id, phase: 'body', endpoint: name, http: response.status, elapsedMs: performance.now()-began, ...value}));
    pending.add(work); void work.finally(() => pending.delete(work));
    return response;
  };
  return {fetch, async close() { await Promise.allSettled([...pending]); fs.closeSync(fd); return {writeFailed: failed}; }};
}

// NODE_OPTIONS also reaches esbuild's synchronous compiler Worker. It shares
// the parent's PID; opening the same exclusive receipt there can fail before
// the Worker can wake the parent's Atomics.wait(). Observe the application main
// thread only, and leave compiler/loader workers untouched.
if (process.env.CAMERA_PROVIDER_TRACE_DIR && isMainThread) {
  const trace = installProviderTrace({
    file: path.join(process.env.CAMERA_PROVIDER_TRACE_DIR, `provider-${process.pid}.jsonl`),
    origins: [process.env.CAMERA_WVP_ORIGIN, process.env.CAMERA_MEDIA_ORIGIN].filter(Boolean),
  });
  globalThis.fetch = trace.fetch;
  process.once('beforeExit', () => trace.close());
}
