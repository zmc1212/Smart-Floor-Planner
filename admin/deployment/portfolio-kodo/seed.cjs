const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Client } = require('pg');
const qiniu = require('qiniu');
const { loadKodoCredentials, objectKey, signedKodoUrl } = require('./signing');

const bucket = process.env.PORTFOLIO_KODO_BUCKET;
assert.equal(bucket, 'sfp-zly-portfolio-demo-20261113');
const config = new qiniu.conf.Config({ useHttpsDomain: true, zone: qiniu.zone.Zone_z0 });
const uploader = new qiniu.form_up.FormUploader(config);

async function publishedAssets() {
  const db = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 4000 });
  await db.connect();
  try {
    await db.query('begin read only');
    await db.query("select set_config('app.current_enterprise_id','1',true),set_config('app.is_platform_admin','false',true)");
    const { rows } = await db.query(`select w.id::text as work_id, v.id::text as version_id, a.id::text as asset_id, a.image_base64, a.content_hash
      from app.portfolio_works w join app.portfolio_versions v on (v.enterprise_id,v.work_id,v.id)=(w.enterprise_id,w.id,w.published_version_id)
      join app.portfolio_assets a on (a.enterprise_id,a.work_id)=(w.enterprise_id,w.id)
      where w.enterprise_id=1 and w.id between 1 and 12 and w.author_id in (24,25,26) and not w.withdrawn
        and v.status='published' and v.content->>'title' like '%（演示）%'
        and (exists(select 1 from jsonb_array_elements(v.content->'images') i where i->>'assetId'=a.id::text)
          or v.content->'planComparison'->>'originalAssetId'=a.id::text or v.content->'planComparison'->>'designAssetId'=a.id::text)
      order by w.id,a.id`);
    const counts = new Map();
    for (const row of rows) counts.set(row.work_id, (counts.get(row.work_id) || 0) + 1);
    assert.deepEqual([...counts], Array.from({ length: 12 }, (_, n) => [String(n + 1), 12]));
    await db.query('commit');
    return rows;
  } finally { await db.end(); }
}

async function read(url) {
  return fetch(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000) });
}

async function copy(row, credentials, mac) {
  const key = objectKey(row.work_id, row.asset_id, row.content_hash);
  const bytes = Buffer.from(row.image_base64, 'base64');
  assert.equal(createHash('sha256').update(JSON.stringify(row.image_base64)).digest('hex'), row.content_hash);
  assert.equal(bytes.readUInt16BE(0), 0xffd8);
  const url = signedKodoUrl({ bucket, key, credentials });
  let response = await read(url);
  let uploaded = false;
  if (response.status === 404) {
    await response.body?.cancel();
    const policy = new qiniu.rs.PutPolicy({ scope: `${bucket}:${key}`, insertOnly: 1 });
    const result = await uploader.put(policy.uploadToken(mac), key, bytes, new qiniu.form_up.PutExtra(undefined, undefined, 'image/jpeg'));
    assert.ok(result.ok() || result.resp?.statusCode === 614, `Upload HTTP ${result.resp?.statusCode}`);
    uploaded = result.ok();
    response = await read(signedKodoUrl({ bucket, key, credentials }));
  }
  assert.equal(response.status, 200, 'Signed object download');
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  const remote = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.equals(remote), 'Downloaded content must equal the published JPEG');
  const receipt = { work: row.work_id, version: row.version_id, asset: row.asset_id, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), uploaded };
  console.log(JSON.stringify(receipt));
  return { key, receipt };
}

async function main() {
  const credentials = await loadKodoCredentials();
  const mac = new qiniu.auth.digest.Mac(credentials.accessKeyId, credentials.secretAccessKey);
  const manager = new qiniu.rs.BucketManager(mac, config);
  const info = await manager.getBucketInfo(bucket);
  assert.ok(info.ok() && Number(info.data.private) === 1 && info.data.zone === 'z0');
  const assets = await publishedAssets();
  const first = await copy(assets[0], credentials, mac);
  const unsignedUrl = new URL(signedKodoUrl({ bucket, key: first.key, credentials }));
  unsignedUrl.search = '';
  const unsigned = await read(unsignedUrl);
  await unsigned.body?.cancel();
  assert.ok([400, 401, 403].includes(unsigned.status), `Unsigned request returned ${unsigned.status}`);
  if (process.argv.includes('--sample')) return;
  for (let offset = 1; offset < assets.length; offset += 4) {
    const results = await Promise.allSettled(assets.slice(offset, offset + 4).map(row => copy(row, credentials, mac)));
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
  }
  console.log(JSON.stringify({ works: 12, assets: assets.length, bucket, unsignedStatus: unsigned.status, complete: true }));
}

main().catch(error => { console.error(error.code || 'kodo_seed_error', error.message); process.exitCode = 1; });
