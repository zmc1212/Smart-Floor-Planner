import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WvpClient } from '../wvp';
import { cameraMediaPath, rewriteCameraPlaylist } from '../media';
import {cloudRecording} from '../recording-contract';
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

test('recording plans use minute offsets and require explicit plan membership lookup',async()=>{
  const name='SFP-00000000-0000-4000-8000-000000000001',items:Record<string,unknown>[]=[];let added=false;
  const wvp=new WvpClient(config,(async(input:URL,init?:RequestInit)=>{
    const u=new URL(input);
    if(u.pathname==='/api/user/login')return Response.json({code:0,data:{accessToken:'fixture'}});
    if(u.pathname.endsWith('/channels'))return Response.json({code:0,data:{list:[{id:6,deviceId:'34020000001320000004',recordPLan:null}]}});
    if(u.pathname.endsWith('/channel/list')){assert.equal(u.searchParams.get('planId'),'7');return Response.json({code:0,data:{list:[{gbId:6,gbDeviceId:'34020000001320000004'}]}});}
    if(u.pathname.endsWith('/query'))return Response.json({code:0,data:{list:added?[{id:7,name}]:[],total:added?1:0}});
    if(u.pathname.endsWith('/add')){assert.equal(init?.method,'POST');const body=JSON.parse(String(init?.body));items.push(...body.planItemList);added=true;return Response.json({code:0});}
    if(u.pathname.endsWith('/get'))return Response.json({code:0,data:{id:7,name,planItemList:items}});
    throw Error('Unexpected endpoint '+u.pathname);
  }) as typeof fetch);
  assert.equal(await wvp.recordingPlan(name,true),7);assert.equal(items.length,7);
  assert.deepEqual(items.map(r=>r.stop),Array(7).fill(1440));
  assert.deepEqual(await wvp.recordingChannel('34020000001320000003','34020000001320000004',7),{id:6,planId:7});
});

test('only the pinned absent-stream reply means stopped; unrelated provider failures remain unknown',async()=>{
  let body:unknown={code:-500,msg:'can not find the stream'};
  const wvp=new WvpClient({...config,mediaSecret:'fixture'},(async()=>Response.json(body)) as typeof fetch);
  assert.equal(await wvp.isRecording({app:'rtp',stream:'one'}),false);
  body={code:-500,msg:'database unavailable'};await assert.rejects(wvp.isRecording({app:'rtp',stream:'one'}),/invalid_response/);
  body={code:0,status:true};assert.equal(await wvp.isRecording({app:'rtp',stream:'one'}),true);
});

test('real file existence uses bounded GET; WVP epoch milliseconds and legacy seconds normalize identically',async()=>{
  const wvp=new WvpClient({...config,mediaSecret:'fixture'},(async(_input:URL,init?:RequestInit)=>{
    assert.notEqual(init?.method,'HEAD');assert.deepEqual(init?.headers,{Range:'bytes=0-0'});return new Response(null,{status:404});
  }) as typeof fetch);
  assert.equal(await wvp.recordingFileStatus('/opt/media/www/record/rtp/one/a.mp4'),404);
  const value={id:1,app:'rtp',stream:'one',mediaServerId:'wvp-zlm-01',filePath:'/opt/media/www/record/rtp/one/a.mp4',startTime:1792728147000,endTime:1792728271507,fileSize:14228945};
  assert.equal(cloudRecording(value,{app:'rtp',stream:'one'}).start.toISOString(),'2026-10-23T04:02:27.000Z');
  assert.equal(cloudRecording({...value,startTime:value.startTime/1000,endTime:Math.floor(value.endTime/1000)},{app:'rtp',stream:'one'}).start.getTime(),value.startTime);
});

test('recording clock uses the private media response Date and rejects unverified time',async()=>{
  const stamp='Fri, 23 Oct 2026 05:19:00 GMT';let verified=true;
  const wvp=new WvpClient({...config,mediaSecret:'fixture'},(async(input:URL,init?:RequestInit)=>{
    const u=new URL(input);assert.equal(u.origin,config.mediaOrigin);assert.equal(u.pathname,'/index/api/getThreadsLoad');assert.equal(u.searchParams.get('secret'),'fixture');assert.equal(init?.redirect,'error');
    return Response.json({code:0},{headers:verified?{Date:stamp}:{}});
  }) as typeof fetch);
  assert.equal((await wvp.recordingClock()).toISOString(),'2026-10-23T05:19:00.000Z');verified=false;
  await assert.rejects(wvp.recordingClock(),/camera_recording_clock_unavailable/);
  const rejected=new WvpClient({...config,mediaSecret:'fixture'},(async()=>Response.json({code:-100},{headers:{Date:stamp}})) as typeof fetch);
  await assert.rejects(rejected.recordingClock(),/camera_recording_clock_unavailable/);
});
