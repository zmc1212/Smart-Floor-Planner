const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

const root = path.join(__dirname, '..');
const fontPath = 'packages/construction/assets/notebook-font.woff2.br';
const font = zlib.brotliDecompressSync(fs.readFileSync(path.join(root, fontPath)));
const source = fs.readFileSync(path.join(root, 'packages/construction/lib/site-font.js'), 'utf8');

function loader(wx) {
  let timeout;
  const context = { module: { exports: {} }, wx,
    setTimeout: callback => { timeout = callback; return 1; }, clearTimeout() {} };
  vm.runInNewContext(source, context);
  return { load: context.module.exports.loadSiteFont, expire: () => timeout() };
}

test('the packaged Site Serif payload is an uploadable Brotli WOFF2 force-included in packOptions', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  assert.ok(config.packOptions.include.some(rule => rule.type === 'file' && rule.value === fontPath),
    'the file API asset must be force-included even when unused-file pruning is enabled');
  assert.equal(font.subarray(0, 4).toString(), 'wOF2');
  assert.equal(font.length, 182836);
  const stylesheet = fs.readFileSync(path.join(root, 'packages/construction/notebook-font.less'), 'utf8');
  assert.doesNotMatch(stylesheet, /base64,/, 'the stylesheet must stay free of the embedded font');
});

test('the shared loader reads once and registers Site Serif at weight 900', async () => {
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
  reads[0].success({ data: font });
  assert.equal(await first, true);
  assert.equal(faces[0].source, 'url("data:font/woff2;base64,' + font.toString('base64') + '")');
  assert.equal(faces[0].family, 'Site Serif');
  assert.equal(faces[0].global, true);
  assert.equal(faces[0].desc.weight, '900');
  assert.equal(faces[0].desc.style, 'normal');
});

test('a failed load is retried on the next page entry and a missing API settles false', async () => {
  let attempt = 0;
  const { load } = loader({
    getFileSystemManager: () => ({ readCompressedFile: options => { attempt += 1; options.fail(); } }),
    arrayBufferToBase64: () => '', loadFontFace: () => {},
  });
  assert.equal(await load(), false);
  assert.equal(await load(), false);
  assert.equal(attempt, 2);
  assert.equal(await loader({ loadFontFace() {} }).load(), false);
});

test('every construction page that compiles notebook styles requests the shared font', () => {
  const pages = [
    'brief/brief.js', 'chat/chat.js', 'projects/projects.js',
    'public-live/public-live.js', 'public-sites/public-page.js',
  ];
  for (const page of pages) {
    const code = fs.readFileSync(path.join(root, 'packages/construction', page), 'utf8');
    assert.match(code, /loadSiteFont/, `${page} must load Site Serif`);
  }
});
