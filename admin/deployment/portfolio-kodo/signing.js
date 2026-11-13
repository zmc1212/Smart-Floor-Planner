const aws4 = require('aws4');
const { createDecipheriv, createHash } = require('node:crypto');
const { Client } = require('pg');

const region = 'cn-east-1';
const host = `s3.${region}.qiniucs.com`;

function objectKey(workId, assetId, contentHash) {
  if (![workId, assetId].every(id => /^[1-9]\d{0,18}$/.test(id)) || !/^[a-f0-9]{64}$/.test(contentHash)) {
    throw new Error('Invalid portfolio object identity');
  }
  return `portfolio/1/${workId}/${assetId}-${contentHash}.jpg`;
}

async function loadKodoCredentials() {
  const secret = process.env.MEDIA_STORAGE_KEY_ENCRYPTION_SECRET?.trim();
  if (!secret) throw new Error('Missing media storage encryption secret');
  const decrypt = raw => {
    const [iv, tag, data] = raw.split('.').map(value => Buffer.from(value, 'base64'));
    const cipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), iv);
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
  };
  const db = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 4000 });
  await db.connect();
  try {
    await db.query('begin read only');
    await db.query("select set_config('app.is_platform_admin','true',true)");
    const { rows: [config] } = await db.query("select access_key_encrypted,secret_key_encrypted from app.media_storage_configs where key='zly-images' and driver='qiniu' and status='active'");
    if (!config) throw new Error('Missing existing Qiniu media storage profile');
    await db.query('commit');
    return { accessKeyId: decrypt(config.access_key_encrypted), secretAccessKey: decrypt(config.secret_key_encrypted) };
  } finally { await db.end(); }
}

function signedKodoUrl({ bucket, key, credentials, expires = 60 }) {
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('Invalid Kodo bucket');
  const path = `/${bucket}/${key}?X-Amz-Expires=${expires}`;
  const signed = aws4.sign({ host, path, service: 's3', region, method: 'GET', signQuery: true }, credentials);
  return `https://${host}${signed.path}`;
}

module.exports = { loadKodoCredentials, objectKey, signedKodoUrl };
