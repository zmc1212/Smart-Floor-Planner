const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { isPackagedSource } = require('./helpers/package-source');

const root = path.join(__dirname, '..');
const fontPath = 'packages/assistant/assets/studio-serif.woff2.br';
const font = zlib.brotliDecompressSync(fs.readFileSync(path.join(root, fontPath)));
const source = fs.readFileSync(path.join(root, 'packages/assistant/lib/studio-font.js'), 'utf8');

function loader(wx) {
  let timeout;
  const context = { module: { exports: {} }, wx,
    setTimeout: callback => { timeout = callback; return 1; }, clearTimeout() {} };
  vm.runInNewContext(source, context);
  return { load: context.module.exports.loadStudioFont, expire: () => timeout() };
}

test('the uploadable Brotli file preserves the entire approved font and excludes its development copy', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  assert.ok(config.packOptions.include.some(rule => rule.type === 'file' && rule.value === fontPath),
    'the file API asset must be force-included even when unused-file pruning is enabled');
  assert.equal(font.subarray(0, 4).toString(), 'wOF2');
  assert.equal(font.length, 459576);
  assert.equal(crypto.createHash('sha256').update(font).digest('hex'), '202f926bd016f1ad9bde3418ca6ca57ed11cfd6bffa7b8275fc5224a8bc53638');
  assert.equal(isPackagedSource(fontPath), true);
  assert.equal(isPackagedSource('packages/assistant/assets/studio-serif-data.js'), false);
  assert.equal(isPackagedSource('project.config.json'), false);
  assert.equal(isPackagedSource('project.private.config.json'), false);
});

test('both pages share one read and load the original Data URL, family and weight', async () => {
  const reads = [], faces = [];
  const { load } = loader({
    getFileSystemManager: () => ({ readCompressedFile: options => reads.push(options) }),
    arrayBufferToBase64: data => Buffer.from(data).toString('base64'),
    loadFontFace: options => { faces.push(options); options.success(); },
  });
  const first = load(), second = load();
  assert.equal(first, second);
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
  const pending = load(); expire();
  assert.equal(await pending, false);
  read.success({ data: font });
  assert.equal(faces, 0);
});

test('an unavailable native file API settles as an ordinary font-load failure', async () => {
  assert.equal(await loader({ loadFontFace() {} }).load(), false);
});
