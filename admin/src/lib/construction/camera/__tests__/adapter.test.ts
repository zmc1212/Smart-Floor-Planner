import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WvpClient } from '../wvp';
import { cameraMediaPath, rewriteCameraPlaylist } from '../media';
const config = { origin: 'http://wvp.test', mediaOrigin: 'http://media.test', username: 'test', password: 'synthetic-password' };
test('pinned WVP envelopes, channel deviceId and absolute snapshot path are adapted without exposing upstream URLs', async () => {
  const calls: URL[] = [];
  const transport = (async (input: string | URL | Request) => {
    const u = new URL(String(input)); calls.push(u);
    if (u.pathname === '/api/user/login') return Response.json({ code: 0, data: { accessToken: 'test-token' } });
    if (u.pathname.endsWith('/channels')) return Response.json({ code: 0, data: { list: [{ deviceId: '34020000001320000004', status: 'ON', ptzType: 1 }] } });
    if (u.pathname.startsWith('/api/play/start')) return Response.json({ code: 0, data: { app: 'rtp', stream: 'stream_1', flv: 'http://private.test/secret' } });
    if (u.pathname === '/api/play/snap') return Response.json({ code: 0, data: '/opt/wvp/snap/34020000001320000003_34020000001320000004_20261022170000.jpg' });
    if (u.pathname.startsWith('/api/device/query/snap/')) { assert.equal(u.searchParams.get('mark'), '20261022170000'); return new Response(new Uint8Array([255,216,255,217])); }
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  const wvp = new WvpClient(config, transport);
  assert.equal((await wvp.channels('34020000001320000003'))[0].channelId, '34020000001320000004');
  assert.deepEqual(await wvp.play('34020000001320000003','34020000001320000004'), { app: 'rtp', stream: 'stream_1' });
  assert.equal((await wvp.snapshot('34020000001320000003','34020000001320000004')).length, 4);
  await wvp.ptz('34020000001320000003','34020000001320000004','stop');
  assert.equal(calls.filter(c => c.pathname === '/api/user/login').length, 1);
  assert.ok(!calls.some(c => c.pathname.includes('/play/stop')));
});
test('media paths and every HLS URI stay inside the authorized stream', () => {
  const stream = { app: 'rtp', stream: 'one' }, source = new URL('http://media.test/rtp/one/hls.m3u8');
  assert.equal(cameraMediaPath(stream, 'live.flv'), '/rtp/one.live.flv');
  const result = rewriteCameraPlaylist('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2,\nhls/1.ts', source, stream, 2);
  assert.ok(result.includes('URI="/camera-media/2/init.mp4"')); assert.ok(result.includes('/camera-media/2/hls/1.ts'));
  for (const bad of ['../other/1.ts','https://outside.test/file.ts','//outside.test/a.ts','%2e%2e/one.ts','one.ts?secret=x']) assert.throws(() => rewriteCameraPlaylist('#EXTM3U\n'+bad, source, stream, 2));
  for (const bad of ['../private','//a.ts','/a.ts','a%2fts','a.json']) assert.throws(() => cameraMediaPath(stream, bad));
});
test('upstream authentication failures never replay a PTZ move automatically', async () => {
  let moved = 0;
  const wvp = new WvpClient(config, (async (u: URL) => u.pathname === '/api/user/login' ? Response.json({ code: 0, data: { accessToken: 'synthetic' } }) : (moved++, new Response(null, { status: 401 }))) as typeof fetch);
  await assert.rejects(wvp.ptz('34020000001320000003','34020000001320000004','left'), /auth_failed/); assert.equal(moved, 1);
});
