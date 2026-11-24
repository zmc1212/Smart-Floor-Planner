const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { isPackagedSource } = require('./helpers/package-source');

const root = path.join(__dirname, '..');
const fontPath = require('../packages/portfolio-font/font-file');
const font = zlib.brotliDecompressSync(fs.readFileSync(path.join(root, fontPath)));
const source = fs.readFileSync(path.join(root, 'packages/assistant/lib/studio-font.js'), 'utf8');

function loader(wx, loadPackage = () => Promise.resolve(fontPath)) {
  let timeout;
  const packageRequests = [];
  const context = { module: { exports: {} }, wx,
    require: { async: modulePath => { packageRequests.push(modulePath); return loadPackage(); } },
    setTimeout: callback => { timeout = callback; return 1; }, clearTimeout() {} };
  vm.runInNewContext(source, context);
  return { load: context.module.exports.loadStudioFont, expire: () => timeout(), packageRequests };
}

test('the resource subpackage preserves the approved Brotli font and its source license', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  assert.ok(config.packOptions.include.some(rule => rule.type === 'file' && rule.value === fontPath),
    'the file API asset must be force-included even when unused-file pruning is enabled');
  assert.equal(fontPath, 'packages/portfolio-font/studio-serif.woff2.br');
  assert.equal(font.subarray(0, 4).toString(), 'wOF2');
  assert.equal(font.length, 459576);
  assert.equal(crypto.createHash('sha256').update(font).digest('hex'), '202f926bd016f1ad9bde3418ca6ca57ed11cfd6bffa7b8275fc5224a8bc53638');
  assert.equal(isPackagedSource(fontPath), true);
  assert.equal(fs.existsSync(path.join(root, 'packages/assistant/assets/studio-serif.woff2.br')), false);
  const licensePath = 'packages/portfolio-font/StudioSerif-OFL.txt';
  assert.ok(fs.readFileSync(path.join(root, licensePath), 'utf8').includes('SIL OPEN FONT LICENSE'));
  assert.equal(isPackagedSource('packages/assistant/assets/studio-serif-data.js'), false);
  assert.equal(isPackagedSource('project.config.json'), false);
  assert.equal(isPackagedSource('project.private.config.json'), false);
});

test('both pages share one subpackage load and register the original font', async () => {
  const reads = [], faces = [];
  const { load, packageRequests } = loader({
    getFileSystemManager: () => ({ readCompressedFile: options => reads.push(options) }),
    arrayBufferToBase64: data => Buffer.from(data).toString('base64'),
    loadFontFace: options => { faces.push(options); options.success(); },
  });
  const first = load(), second = load();
  assert.equal(first, second);
  assert.deepEqual(packageRequests, ['../../portfolio-font/font-file.js']);
  await new Promise(setImmediate);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].filePath, fontPath);
  assert.equal(reads[0].compressionAlgorithm, 'br');
  reads[0].success({ data: font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) });
  assert.equal(await first, true);
  assert.equal(faces[0].source, 'url("data:font/woff2;base64,' + font.toString('base64') + '")');
  assert.equal(faces[0].family, 'Studio Serif');
  assert.equal(faces[0].global, true);
  assert.equal(faces[0].desc.weight, '900');
  assert.equal(faces[0].desc.style, 'normal');
  assert.equal(await load(), true);
  assert.equal(reads.length, 1);
  assert.equal(packageRequests.length, 1);
});

test('a failed subpackage load can retry on the next portfolio page entry', async () => {
  let attempts = 0;
  const { load } = loader({
    getFileSystemManager: () => ({ readCompressedFile: options => options.success({ data: font }) }),
    arrayBufferToBase64: data => Buffer.from(data).toString('base64'),
    loadFontFace: options => options.success(),
  }, async () => {
    if (++attempts === 1) throw new Error('subpackage unavailable');
    return fontPath;
  });
  assert.equal(await load(), false);
  assert.equal(await load(), true);
  assert.equal(attempts, 2);
});

test('a subpackage arriving after the timeout does not start a font read', async () => {
  let resolvePackage;
  let reads = 0;
  const { load, expire } = loader({
    getFileSystemManager: () => ({ readCompressedFile: () => { reads += 1; } }),
    arrayBufferToBase64: () => '',
    loadFontFace: () => {},
  }, () => new Promise(resolve => { resolvePackage = resolve; }));
  const pending = load();
  expire();
  assert.equal(await pending, false);
  resolvePackage(fontPath);
  await new Promise(setImmediate);
  assert.equal(reads, 0);
});

test('a read or font failure is recoverable on the next existing page entry', async () => {
  let attempt = 0;
  const { load } = loader({
    getFileSystemManager: () => ({ readCompressedFile: options => {
      attempt += 1;
      if (attempt === 1) options.fail(); else options.success({ data: font });
    } }),
    arrayBufferToBase64: data => Buffer.from(data).toString('base64'),
    loadFontFace: options => { if (attempt === 2) options.fail(); else options.success(); },
  });
  assert.equal(await load(), false);
  assert.equal(await load(), false);
  assert.equal(await load(), true);
  assert.equal(attempt, 3);
});

test('an expired package read cannot start a late font load', async () => {
  let read, faces = 0;
  const { load, expire } = loader({
    getFileSystemManager: () => ({ readCompressedFile: options => { read = options; } }),
    arrayBufferToBase64: () => '', loadFontFace: () => { faces += 1; },
  });
  const pending = load();
  await new Promise(setImmediate);
  expire();
  assert.equal(await pending, false);
  read.success({ data: font });
  assert.equal(faces, 0);
});

test('an unavailable native file API settles as an ordinary font-load failure', async () => {
  assert.equal(await loader({ loadFontFace() {} }).load(), false);
});
