import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = 'http://127.0.0.1:3006';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const reportDir = path.join(root, 'tmp', 'family-camera-acceptance-' + stamp);
const reportFile = path.join(reportDir, 'report.json');
const serverLogFile = path.join(reportDir, 'server.log');
const steps = [];
const failures = [];
const cleanup = { attempted: false, ok: false, errors: [] };

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

const env = loadEnv(path.join(root, '.env.local'));
if (!env.DATABASE_URL) throw new Error('DATABASE_URL missing from admin/.env.local');
if (!env.JWT_SECRET) throw new Error('JWT_SECRET missing from admin/.env.local');
const target = new URL(env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '5432' || target.pathname !== '/smart_floor_planner') {
  throw new Error('Acceptance only runs against the local development database target');
}
const dbTarget = `${target.hostname}:${target.port}${target.pathname} (user ${target.username})`;
const jwtSecret = new TextEncoder().encode(env.JWT_SECRET);

function record(name, pass, detail = {}) {
  const entry = { name, pass: !!pass, detail };
  steps.push(entry);
  if (!pass) failures.push(entry);
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail && Object.keys(detail).length ? ' ' + JSON.stringify(detail) : ''));
  return entry;
}

async function token(userId) {
  return await new SignJWT({
    sub: String(userId), id: String(userId), mode: 'customer', role: 'user',
    contextVersion: 1, source: 'wechat',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime('1h')
    .setAudience('miniprogram')
    .sign(jwtSecret);
}

async function request(method, route, options = {}) {
  const headers = {};
  if (options.token) headers.authorization = 'Bearer ' + options.token;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  Object.assign(headers, options.headers || {});
  const response = await fetch(base + route, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 500) }; }
  return { status: response.status, json, headers: response.headers, raw: text };
}

function errorCode(result) {
  return result.json && (result.json.error || result.json.code) || null;
}

function sessionCookie(response) {
  const raw = response.headers.get('set-cookie') || '';
  const first = raw.split(/,(?=\s*[A-Za-z0-9_-]+=)/)[0] || '';
  return first.split(';')[0].trim();
}

function parseEntryToken(url) {
  const match = /#entry=([1-9]\d*\.[A-Za-z0-9_-]{43})$/.exec(String(url || ''));
  return match ? match[1] : '';
}

async function createFixture(client) {
  const prefix = 'family-accept-' + stamp.toLowerCase().replace(/[^a-z0-9]/g, '').slice(-10) + '-' + Math.random().toString(36).slice(2, 7);
  const serial = String(Date.now()).slice(-13).padStart(13, '0');
  const deviceId = '9002' + serial + '001';
  const channelId = '9002' + serial + '002';
  await client.query('begin');
  try {
    await client.query("select set_config('app.is_platform_admin','true',true)");
    const enterprise = await client.query(
      "insert into app.enterprises(name,code,status) values($1,$2,'active') returning id",
      [prefix, prefix],
    );
    const eid = String(enterprise.rows[0].id);
    const users = [];
    for (const role of ['owner', 'family', 'outsider']) {
      const user = await client.query(
        'insert into app.users(nickname,openid,phone,context_version) values($1,$2,$3,1) returning id',
        [prefix + '-' + role, prefix + '-' + role + '@openid', '139' + String(Date.now()).slice(-8) + String(users.length + 1)],
      );
      const uid = String(user.rows[0].id);
      await client.query('insert into app.wechat_identities(user_id,openid) values($1,$2)', [uid, prefix + '-' + role + '@openid']);
      users.push(uid);
    }
    const [ownerId, familyId, outsiderId] = users;
    const lead = await client.query(
      "insert into app.leads(enterprise_id,customer_user_id,name,phone,source) values($1,$2,$3,$4,'acceptance') returning id",
      [eid, ownerId, prefix + '-lead', '138' + String(Date.now()).slice(-8)],
    );
    const lid = String(lead.rows[0].id);
    const project = await client.query(
      "insert into app.construction_projects(enterprise_id,lead_id,name,customer_access,status) values($1,$2,$3,true,'active') returning id",
      [eid, lid, prefix + '-project'],
    );
    const pid = String(project.rows[0].id);
    const camera = await client.query(
      'insert into app.construction_cameras(enterprise_id,device_id,channel_id,name,enabled,ptz_enabled) values($1,$2,$3,$4,true,true) returning id',
      [eid, deviceId, channelId, prefix + '-camera'],
    );
    const cid = String(camera.rows[0].id);
    const binding = await client.query(
      'insert into app.construction_camera_bindings(enterprise_id,project_id,camera_id) values($1,$2,$3) returning id',
      [eid, pid, cid],
    );
    const bid = String(binding.rows[0].id);
    await client.query(
      `insert into app.construction_camera_customer_grants
        (enterprise_id,project_id,user_id,enabled,capture_enabled,ptz_enabled,version)
        values($1,$2,$3,true,true,true,1)`,
      [eid, pid, ownerId],
    );
    await client.query('commit');
    return { prefix, eid, ownerId, familyId, outsiderId, lid, pid, cid, bid, deviceId, channelId };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

async function cleanupFixture(client, f) {
  cleanup.attempted = true;
  if (!f) {
    cleanup.ok = cleanup.errors.length === 0;
    return;
  }
  try {
    await client.query('begin');
    await client.query("select set_config('app.is_platform_admin','true',true)");
    const eid = f.eid, pid = f.pid;
    await client.query('delete from app.construction_camera_sessions where enterprise_id=$1', [eid]);
    await client.query('delete from app.construction_camera_entries where enterprise_id=$1', [eid]);
    await client.query('delete from app.construction_camera_snapshots where enterprise_id=$1', [eid]);
    await client.query('delete from app.construction_camera_sd_recordings where enterprise_id=$1', [eid]);
    await client.query('delete from app.construction_camera_sd_playbacks where enterprise_id=$1', [eid]);
    await client.query('delete from app.construction_camera_sd_windows where enterprise_id=$1', [eid]);
    await client.query('delete from app.construction_camera_recording_policies where enterprise_id=$1', [eid]);
    await client.query('delete from app.construction_camera_controls where enterprise_id=$1', [eid]);
    await client.query('delete from app.construction_camera_customer_grants where enterprise_id=$1', [eid]);
    await client.query('delete from app.construction_camera_bindings where enterprise_id=$1', [eid]);
    await client.query('delete from app.construction_cameras where enterprise_id=$1', [eid]);
    await client.query('delete from app.construction_stage_assignments where enterprise_id=$1', [eid]);
    await client.query('delete from app.construction_audits where enterprise_id=$1', [eid]);
    await client.query('delete from app.construction_links where enterprise_id=$1', [eid]);
    await client.query('delete from app.construction_visits where enterprise_id=$1', [eid]);
    await client.query('delete from app.construction_plans where enterprise_id=$1', [eid]);
    await client.query('delete from app.construction_rooms where enterprise_id=$1', [eid]);
    await client.query('delete from app.construction_projects where enterprise_id=$1 and id=$2', [eid, pid]);
    await client.query('delete from app.leads where enterprise_id=$1 and id=$2', [eid, f.lid]);
    await client.query('delete from app.wechat_identities where user_id = any($1::bigint[])', [[f.ownerId, f.familyId, f.outsiderId]]);
    await client.query('delete from app.users where id = any($1::bigint[])', [[f.ownerId, f.familyId, f.outsiderId]]);
    await client.query('delete from app.assistant_idempotency_records where enterprise_id=$1', [eid]);
    await client.query('delete from app.domain_event_deliveries where enterprise_id=$1', [eid]);
    await client.query('delete from app.domain_event_outbox where enterprise_id=$1', [eid]);
    await client.query('delete from app.construction_stage_settings where enterprise_id=$1', [eid]);
    await client.query('delete from app.construction_followup_bindings where enterprise_id=$1', [eid]);
    await client.query('delete from app.enterprises where id=$1', [eid]);
    await client.query('commit');
    const left = await client.query('select count(*)::int n from app.enterprises where code=$1', [f.prefix]);
    const leftProjects = await client.query('select count(*)::int n from app.construction_projects where name like $1', [f.prefix + '%']);
    const leftUsers = await client.query('select count(*)::int n from app.users where nickname like $1', [f.prefix + '%']);
    cleanup.ok = left.rows[0].n === 0 && leftProjects.rows[0].n === 0 && leftUsers.rows[0].n === 0;
    if (!cleanup.ok) cleanup.errors.push('fixture rows remain after cleanup');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    cleanup.errors.push(String(error.message || error));
  }
}

async function main() {
  fs.mkdirSync(reportDir, { recursive: true });
  const client = new pg.Client({ host: target.hostname, port: Number(target.port), database: target.pathname.slice(1), user: target.username, password: target.password });
  await client.connect();
  let fixture = null;
  let server = null;
  let upstream = null;
  let upstreamHits = 0;
  const serverLog = [];
  try {
    fixture = await createFixture(client);
    console.log(JSON.stringify({ fixture: { enterpriseId: fixture.eid, projectId: fixture.pid, ownerId: fixture.ownerId, familyId: fixture.familyId, outsiderId: fixture.outsiderId, bindingId: fixture.bid, prefix: fixture.prefix } }));

    upstream = http.createServer((_request, response) => {
      upstreamHits++;
      response.writeHead(500, { 'content-type': 'text/plain' });
      response.end('unexpected upstream request');
    });
    await new Promise(resolve => upstream.listen(39999, '127.0.0.1', resolve));

    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '-H', '127.0.0.1', '-p', '3006'], {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        NEXT_TELEMETRY_DISABLED: '1',
        DATABASE_URL: env.DATABASE_URL,
        JWT_SECRET: env.JWT_SECRET,
        CAMERA_PUBLIC_ORIGIN: base,
        CAMERA_WVP_ORIGIN: 'http://127.0.0.1:39999',
        CAMERA_MEDIA_ORIGIN: 'http://127.0.0.1:39999',
        CAMERA_WVP_USERNAME: 'acceptance',
        CAMERA_WVP_PASSWORD: 'acceptance',
        NATIVE_WORKFLOW_COLLABORATION_ENTERPRISE_IDS: fixture.eid,
      },
    });
    const onLog = chunk => {
      const text = String(chunk);
      serverLog.push(text);
      fs.appendFileSync(serverLogFile, text);
      if (serverLog.join('').length > 60000) serverLog.splice(0, serverLog.length - 20);
    };
    server.stdout.on('data', onLog);
    server.stderr.on('data', onLog);

    let healthy = false;
    for (let i = 0; i < 180; i++) {
      if (server.exitCode !== null) break;
      try {
        const health = await fetch(base + '/api/health');
        if (health.ok) { healthy = true; break; }
      } catch { /* server is still compiling */ }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    record('development server and database health', healthy, healthy ? { base } : { serverExit: server.exitCode, logTail: serverLog.join('').slice(-1200) });
    if (!healthy) throw new Error('development server did not become healthy');

    const ownerToken = await token(fixture.ownerId);
    const familyToken = await token(fixture.familyId);
    const outsiderToken = await token(fixture.outsiderId);

    const ownerListBefore = await request('GET', '/api/miniprogram/construction/customer-projects', { token: ownerToken });
    record('owner project list', ownerListBefore.status === 200 && Array.isArray(ownerListBefore.json?.data)
      && ownerListBefore.json.data.some(item => String(item.id) === fixture.pid && item.role === 'owner'),
      { status: ownerListBefore.status, ids: ownerListBefore.json?.data?.map(item => item.id) });

    const familyListBefore = await request('GET', '/api/miniprogram/construction/customer-projects', { token: familyToken });
    record('family project list is empty before grant', familyListBefore.status === 200 && Array.isArray(familyListBefore.json?.data)
      && familyListBefore.json.data.length === 0, { status: familyListBefore.status, count: familyListBefore.json?.data?.length });

    const outsiderListBefore = await request('GET', '/api/miniprogram/construction/customer-projects', { token: outsiderToken });
    record('unrelated customer cannot list the project', outsiderListBefore.status === 200 && Array.isArray(outsiderListBefore.json?.data)
      && outsiderListBefore.json.data.length === 0, { status: outsiderListBefore.status, count: outsiderListBefore.json?.data?.length });

    const familyProgressBefore = await request('GET', `/api/miniprogram/construction/projects/${fixture.pid}/progress`, { token: familyToken });
    record('family progress is denied before grant', familyProgressBefore.status === 404, { status: familyProgressBefore.status, error: errorCode(familyProgressBefore) });

    const outsiderInvite = await request('POST', `/api/miniprogram/construction/projects/${fixture.pid}/family-invite`, { token: outsiderToken });
    record('unrelated customer cannot create an invite', outsiderInvite.status === 403 || outsiderInvite.status === 404,
      { status: outsiderInvite.status, error: errorCode(outsiderInvite) });

    const invite = await request('POST', `/api/miniprogram/construction/projects/${fixture.pid}/family-invite`, { token: ownerToken });
    const inviteToken = String(invite.json?.data?.token || '');
    record('owner creates a signed share card', invite.status === 200 && inviteToken.split('.').length === 3 && !!invite.json?.data?.expiresAt,
      { status: invite.status, tokenSegments: inviteToken.split('.').length, expiresAt: invite.json?.data?.expiresAt });

    const accept = await request('POST', `/api/miniprogram/construction/family-invites/${encodeURIComponent(inviteToken)}/accept`, { token: familyToken });
    record('family accepts the card', accept.status === 200 && accept.json?.data?.access === 'family_view' && String(accept.json?.data?.projectId) === fixture.pid,
      { status: accept.status, access: accept.json?.data?.access, version: accept.json?.data?.version });

    const reuse = await request('POST', `/api/miniprogram/construction/family-invites/${encodeURIComponent(inviteToken)}/accept`, { token: outsiderToken });
    record('share card is single-use for another account', reuse.status === 409 && errorCode(reuse) === 'family_invite_used',
      { status: reuse.status, error: errorCode(reuse) });

    const familyProgress = await request('GET', `/api/miniprogram/construction/projects/${fixture.pid}/progress`, { token: familyToken });
    record('family reads progress as family_view without issues', familyProgress.status === 200
      && familyProgress.json?.data?.access === 'family_view' && familyProgress.json?.data?.progress
      && familyProgress.json.data.issues === undefined,
      { status: familyProgress.status, access: familyProgress.json?.data?.access, hasIssues: familyProgress.json?.data?.issues !== undefined });

    const ownerProgress = await request('GET', `/api/miniprogram/construction/projects/${fixture.pid}/progress`, { token: ownerToken });
    record('owner keeps full progress projection', ownerProgress.status === 200
      && ownerProgress.json?.data?.access === 'owner' && Array.isArray(ownerProgress.json?.data?.issues),
      { status: ownerProgress.status, access: ownerProgress.json?.data?.access, issues: ownerProgress.json?.data?.issues?.length });

    const ownerViewers = await request('GET', `/api/miniprogram/construction/projects/${fixture.pid}/family-viewers`, { token: ownerToken });
    const viewer = Array.isArray(ownerViewers.json?.data) ? ownerViewers.json.data.find(item => String(item.viewerId) === fixture.familyId) : null;
    record('owner sees the family viewer', ownerViewers.status === 200 && !!viewer && viewer.version === 1,
      { status: ownerViewers.status, viewers: ownerViewers.json?.data?.length, version: viewer?.version });

    const familyViewers = await request('GET', `/api/miniprogram/construction/projects/${fixture.pid}/family-viewers`, { token: familyToken });
    record('family cannot manage viewers', familyViewers.status === 403, { status: familyViewers.status, error: errorCode(familyViewers) });

    const familyCameras = await request('GET', `/api/miniprogram/construction/video/projects/${fixture.pid}/cameras`, { token: familyToken });
    record('family camera list is live-only', familyCameras.status === 200
      && familyCameras.json?.data?.liveOnly === true && familyCameras.json?.data?.canCapture === false
      && familyCameras.json?.data?.canControl === false && familyCameras.json?.data?.canViewSnapshots === false
      && Array.isArray(familyCameras.json?.data?.items) && familyCameras.json.data.items.length === 1,
      { status: familyCameras.status, liveOnly: familyCameras.json?.data?.liveOnly, canCapture: familyCameras.json?.data?.canCapture, canControl: familyCameras.json?.data?.canControl });

    const ownerCameras = await request('GET', `/api/miniprogram/construction/video/projects/${fixture.pid}/cameras`, { token: ownerToken });
    record('owner camera list keeps capture and PTZ', ownerCameras.status === 200
      && ownerCameras.json?.data?.liveOnly === false && ownerCameras.json?.data?.canCapture === true
      && ownerCameras.json?.data?.canControl === true && ownerCameras.json?.data?.canViewSnapshots === true,
      { status: ownerCameras.status, liveOnly: ownerCameras.json?.data?.liveOnly, canCapture: ownerCameras.json?.data?.canCapture, canControl: ownerCameras.json?.data?.canControl });

    const familyEntry = await request('POST', `/api/miniprogram/construction/video/projects/${fixture.pid}/entry`, { token: familyToken, body: {} });
    const familyEntryToken = parseEntryToken(familyEntry.json?.data?.url);
    record('family receives a camera entry', familyEntry.status === 200 && !!familyEntryToken, { status: familyEntry.status });

    const ownerEntry = await request('POST', `/api/miniprogram/construction/video/projects/${fixture.pid}/entry`, { token: ownerToken, body: {} });
    const ownerEntryToken = parseEntryToken(ownerEntry.json?.data?.url);
    record('owner receives a camera entry', ownerEntry.status === 200 && !!ownerEntryToken, { status: ownerEntry.status });

    async function openSession(entryToken) {
      const response = await fetch(base + '/api/construction-camera/exchange', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: base },
        body: JSON.stringify({ entry: entryToken }),
      });
      const json = await response.json().catch(() => null);
      return { status: response.status, json, csrf: json?.data?.csrf, cookie: sessionCookie(response) };
    }

    const familySession = await openSession(familyEntryToken);
    record('family camera session opens', familySession.status === 200 && !!familySession.csrf && !!familySession.cookie,
      { status: familySession.status });

    const familyState = await request('GET', '/api/construction-camera/state', { headers: { cookie: familySession.cookie } });
    record('family session state is live-only', familyState.status === 200
      && familyState.json?.data?.liveOnly === true && familyState.json?.data?.canCapture === false
      && familyState.json?.data?.canControl === false && familyState.json?.data?.canViewSnapshots === false,
      { status: familyState.status, liveOnly: familyState.json?.data?.liveOnly, canCapture: familyState.json?.data?.canCapture, canControl: familyState.json?.data?.canControl });

    const familyRecordings = await request('POST', '/api/construction-camera/recordings/query', {
      headers: { cookie: familySession.cookie, origin: base, 'x-camera-csrf': familySession.csrf },
      body: { date: '2026-11-17', bindingId: fixture.bid },
    });
    record('family playback query is rejected', familyRecordings.status === 403 && errorCode(familyRecordings) === 'camera_forbidden',
      { status: familyRecordings.status, error: errorCode(familyRecordings) });

    const familyCapture = await request('POST', '/api/construction-camera/snapshots', {
      headers: {
        cookie: familySession.cookie, origin: base, 'x-camera-csrf': familySession.csrf,
        'Idempotency-Key': 'family-accept-snapshot-' + Date.now().toString(36),
      },
      body: { bindingId: fixture.bid },
    });
    record('family snapshot is rejected before upstream', familyCapture.status === 403 && errorCode(familyCapture) === 'camera_forbidden',
      { status: familyCapture.status, error: errorCode(familyCapture) });

    const familyPtz = await request('POST', '/api/construction-camera/ptz', {
      headers: { cookie: familySession.cookie, origin: base, 'x-camera-csrf': familySession.csrf },
      body: { bindingId: fixture.bid, command: 'left', sequence: 1 },
    });
    record('family PTZ is rejected before upstream', familyPtz.status === 403 && errorCode(familyPtz) === 'camera_forbidden',
      { status: familyPtz.status, error: errorCode(familyPtz) });
    record('family capture and PTZ never reached the camera gateway', upstreamHits === 0, { upstreamHits });

    const ownerSession = await openSession(ownerEntryToken);
    record('owner camera session opens', ownerSession.status === 200 && !!ownerSession.csrf && !!ownerSession.cookie,
      { status: ownerSession.status });
    const ownerState = await request('GET', '/api/construction-camera/state', { headers: { cookie: ownerSession.cookie } });
    record('owner session keeps capture and PTZ', ownerState.status === 200
      && ownerState.json?.data?.liveOnly === false && ownerState.json?.data?.canCapture === true
      && ownerState.json?.data?.canControl === true && ownerState.json?.data?.canViewSnapshots === true,
      { status: ownerState.status, liveOnly: ownerState.json?.data?.liveOnly, canCapture: ownerState.json?.data?.canCapture, canControl: ownerState.json?.data?.canControl });

    const ownerRecordings = await request('POST', '/api/construction-camera/recordings/query', {
      headers: { cookie: ownerSession.cookie, origin: base, 'x-camera-csrf': ownerSession.csrf },
      body: { date: '2026-11-17', bindingId: fixture.bid },
    });
    record('owner playback query is allowed', ownerRecordings.status === 200 && Array.isArray(ownerRecordings.json?.data?.items),
      { status: ownerRecordings.status, items: ownerRecordings.json?.data?.items?.length });

    const revoke = await request('POST', `/api/miniprogram/construction/projects/${fixture.pid}/family-viewers/${fixture.familyId}`, {
      token: ownerToken,
      headers: { 'Idempotency-Key': 'family-accept-revoke-' + Date.now().toString(36) },
      body: { expectedVersion: 1, allowed: false },
    });
    record('owner revokes family access', revoke.status === 200 && revoke.json?.data?.allowed === false,
      { status: revoke.status, version: revoke.json?.data?.version });

    const familyProgressAfter = await request('GET', `/api/miniprogram/construction/projects/${fixture.pid}/progress`, { token: familyToken });
    record('family progress is denied after revoke', familyProgressAfter.status === 404,
      { status: familyProgressAfter.status, error: errorCode(familyProgressAfter) });

    const familyListAfter = await request('GET', '/api/miniprogram/construction/customer-projects', { token: familyToken });
    record('family project list is empty after revoke', familyListAfter.status === 200 && Array.isArray(familyListAfter.json?.data)
      && familyListAfter.json.data.length === 0, { status: familyListAfter.status, count: familyListAfter.json?.data?.length });

    const familyCamerasAfter = await request('GET', `/api/miniprogram/construction/video/projects/${fixture.pid}/cameras`, { token: familyToken });
    record('family camera list is denied after revoke', familyCamerasAfter.status === 404,
      { status: familyCamerasAfter.status, error: errorCode(familyCamerasAfter) });

    const familyStateAfter = await request('GET', '/api/construction-camera/state', { headers: { cookie: familySession.cookie } });
    record('existing family camera session is expired', familyStateAfter.status === 401,
      { status: familyStateAfter.status, error: errorCode(familyStateAfter) });

    const reuseAfterRevoke = await request('POST', `/api/miniprogram/construction/family-invites/${encodeURIComponent(inviteToken)}/accept`, { token: familyToken });
    record('consumed card cannot re-grant after revoke', reuseAfterRevoke.status === 409 && errorCode(reuseAfterRevoke) === 'family_invite_used',
      { status: reuseAfterRevoke.status, error: errorCode(reuseAfterRevoke) });

    const viewersAfter = await request('GET', `/api/miniprogram/construction/projects/${fixture.pid}/family-viewers`, { token: ownerToken });
    record('owner viewer list is empty after revoke', viewersAfter.status === 200 && Array.isArray(viewersAfter.json?.data)
      && viewersAfter.json.data.length === 0, { status: viewersAfter.status, count: viewersAfter.json?.data?.length });

    const outsiderProgress = await request('GET', `/api/miniprogram/construction/projects/${fixture.pid}/progress`, { token: outsiderToken });
    record('unrelated customer still cannot read progress', outsiderProgress.status === 404,
      { status: outsiderProgress.status, error: errorCode(outsiderProgress) });
  } catch (error) {
    record('acceptance runner completed without exception', false, { error: String(error.message || error) });
  } finally {
    if (server) {
      await new Promise(resolve => {
        execFile('taskkill.exe', ['/pid', String(server.pid), '/t', '/f'], { windowsHide: true }, () => resolve());
      });
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (upstream) await new Promise(resolve => upstream.close(resolve));
    await cleanupFixture(client, fixture);
    await client.end().catch(() => {});
    const report = {
      generatedAt: new Date().toISOString(),
      database: dbTarget,
      fixture: fixture ? {
        enterpriseId: fixture.eid, projectId: fixture.pid, ownerId: fixture.ownerId,
        familyId: fixture.familyId, outsiderId: fixture.outsiderId, bindingId: fixture.bid,
      } : null,
      steps,
      failures: failures.map(item => item.name),
      cleanup,
      serverLogTail: serverLog.join('').slice(-4000),
    };
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ reportFile, passed: steps.filter(s => s.pass).length, failed: failures.length, cleanup }, null, 2));
    if (failures.length || !cleanup.ok) process.exitCode = 1;
  }
}

await main();
