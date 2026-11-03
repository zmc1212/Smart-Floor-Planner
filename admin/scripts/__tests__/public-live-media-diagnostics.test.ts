import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { ZlmPublicLive } from '../../src/lib/construction/public-live/upstream';
import { liveMediaDiagnostics, type LiveMediaDiagnostic } from '../../src/lib/construction/public-live/media-diagnostics';

const signals = () => {
  const caller = new AbortController(), timeout = new AbortController(), local = new AbortController();
  return { caller, timeout, local, combined: AbortSignal.any([caller.signal, timeout.signal, local.signal]) };
};
const diagnostic = (s: ReturnType<typeof signals>, events: LiveMediaDiagnostic[]) =>
  liveMediaDiagnostics('private-token/hls.m3u8', { combined: s.combined, caller: s.caller.signal, timeout: s.timeout.signal }, e => events.push(e));

async function withUpstream(run: (upstream: ZlmPublicLive, server: Server) => Promise<void>) {
  const server = createServer((request, response) => {
    if (request.url?.endsWith('missing.m3u8')) { response.writeHead(404).end('private upstream body'); return; }
    if (request.url?.endsWith('unavailable.m3u8')) { response.writeHead(503).end('private upstream body'); return; }
    if (request.url?.endsWith('reset.m3u8')) { request.socket.destroy(); return; }
    response.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
    response.write('#EXTM3U\n');
    if (!request.url?.endsWith('pending.m3u8')) response.end('#EXT-X-ENDLIST\n');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  try {
    const upstream = new ZlmPublicLive({ origin: `http://127.0.0.1:${address.port}`, secret: 'private-secret', sourceOrigin: 'rtsp://127.0.0.1:18554/' });
    await run(upstream, server);
  }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
}

test('real HTTP failures retain the upstream status without exposing URL, body or credentials', async () => {
  await withUpstream(async upstream => {
    for (const [resource, status] of [['missing.m3u8', 404], ['unavailable.m3u8', 503]] as const) {
      const s = signals(), events: LiveMediaDiagnostic[] = [], trace = diagnostic(s, events);
      const response = await upstream.media('private-app', 'private-stream', resource, s.combined);
      trace.headers(response); await response.body?.cancel();
      assert.equal(events[0].outcome, 'upstream_http'); assert.equal(events[0].upstreamStatus, status);
      assert.equal(events[0].abort, 'none');
      assert.doesNotMatch(JSON.stringify(events), /private-|127\.0\.0\.1|http:|m3u8|upstream body/);
    }
  });
});

test('caller abort and deadline during a real response body are distinct, preserving the first abort', async () => {
  await withUpstream(async upstream => {
    for (const cause of ['caller', 'timeout'] as const) {
      const s = signals(), events: LiveMediaDiagnostic[] = [], trace = diagnostic(s, events);
      const response = await upstream.media('private-app', 'private-stream', 'pending.m3u8', s.combined);
      trace.headers(response); const body = response.text();
      s[cause].abort(new DOMException('private-token and origin must not be logged', cause === 'caller' ? 'AbortError' : 'TimeoutError'));
      s[cause === 'caller' ? 'timeout' : 'caller'].abort();
      await assert.rejects(body); trace.failure('body');
      const result = events.at(-1)!;
      assert.equal(result.outcome, cause === 'caller' ? 'caller_abort' : 'timeout');
      assert.equal(result.abort, cause); assert.equal(result.phase, 'body'); assert.equal(result.upstreamStatus, 200);
      assert.doesNotMatch(JSON.stringify(events), /private-|127\.0\.0\.1|origin|AbortError|TimeoutError/);
    }
  });
});

test('connection reset before headers is a transport error with no invented HTTP status', async () => {
  await withUpstream(async upstream => {
    const s = signals(), events: LiveMediaDiagnostic[] = [], trace = diagnostic(s, events);
    await assert.rejects(upstream.media('private-app', 'private-stream', 'reset.m3u8', s.combined));
    trace.failure('headers');
    assert.equal(events[0].outcome, 'transport_error'); assert.equal(events[0].upstreamStatus, null); assert.equal(events[0].abort, 'none');
  });
});

test('successful bytes and downstream cancellation cannot be confused with permission denial', async () => {
  await withUpstream(async upstream => {
    const s = signals(), events: LiveMediaDiagnostic[] = [], trace = diagnostic(s, events);
    const response = await upstream.media('private-app', 'private-stream', 'ready.m3u8', s.combined);
    trace.headers(response); const bytes = Buffer.byteLength(await response.text()); trace.addBytes(bytes); trace.complete();
    assert.equal(events.at(-1)!.outcome, 'complete'); assert.equal(events.at(-1)!.bytes, bytes);
    trace.cancel(); s.local.abort(); trace.failure('authorization', 'authorization_denied');
    assert.equal(events.at(-2)!.outcome, 'downstream_cancel'); assert.equal(events.at(-1)!.outcome, 'authorization_denied');
    assert.equal(events.at(-1)!.abort, 'local');
  });
});

test('diagnostics are opt-in outside production, and observer failures cannot affect delivery', () => {
  const env = { node: process.env.NODE_ENV, diagnostic: process.env.PUBLIC_LIVE_MEDIA_DIAGNOSTICS }, info = console.info;
  const messages: unknown[][] = []; console.info = (...args) => { messages.push(args); };
  const s = signals(), args = { combined: s.combined, caller: s.caller.signal, timeout: s.timeout.signal };
  try {
    for (const [node, flag] of [['production', '1'], ['development', '0']] as const) {
      Reflect.set(process.env, 'NODE_ENV', node); process.env.PUBLIC_LIVE_MEDIA_DIAGNOSTICS = flag;
      liveMediaDiagnostics('hls.m3u8', args).headers(new Response('ok'));
    }
    assert.equal(messages.length, 0);
    Reflect.set(process.env, 'NODE_ENV', 'development'); process.env.PUBLIC_LIVE_MEDIA_DIAGNOSTICS = '1';
    liveMediaDiagnostics('hls.m3u8', args).headers(new Response('ok'));
    assert.equal(messages.length, 1);
    assert.doesNotThrow(() => liveMediaDiagnostics('hls.m3u8', args, () => { throw Error('observer failure'); }).headers(new Response('ok')));
  } finally {
    console.info = info;
    if (env.node === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV'); else Reflect.set(process.env, 'NODE_ENV', env.node);
    if (env.diagnostic === undefined) delete process.env.PUBLIC_LIVE_MEDIA_DIAGNOSTICS; else process.env.PUBLIC_LIVE_MEDIA_DIAGNOSTICS = env.diagnostic;
  }
});
