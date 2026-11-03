const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { packageSourceFiles } = require('./helpers/package-source');
const { tourInput, selectTour, toursForView, tourUrl } = require('../packages/assistant/lib/tour');

const tour = (url, provider = 'Matterport', title = '') => ({ url, provider, title });

test('tour links allow only credential-free HTTPS hosts without ports or IP literals', () => {
  assert.equal(tourUrl('https://my.matterport.com/show/?m=abc'), 'https://my.matterport.com/show/?m=abc');
  assert.equal(tourUrl('https://kuula.co/share/collection/abc'), 'https://kuula.co/share/collection/abc');
  for (const value of [
    'http://my.matterport.com/show', 'https://user@my.matterport.com/show', 'https://my.matterport.com:8443/show',
    'https://127.0.0.1/show', 'https://192.168.1.10/show', 'https://[::1]/show', 'https://my matterport.com/show',
    'https://-bad.example.com/show', 'javascript:alert(1)', '//my.matterport.com/show', 'https://my.matterport.com/a b',
    '', null, 42,
  ]) assert.equal(tourUrl(value), '', String(value));
  assert.equal(tourUrl('https://' + 'a'.repeat(280) + '.example.com/show'), '');
});

test('tour view drops invalid links, keeps stable indices and never trusts raw parameters', () => {
  const work = { tours: [tour('http://unsafe.example.com'), tour('https://kuula.co/b', 'Kuula'), tour('', 'Empty'), tour('https://my.matterport.com/a', 'Matterport', '客餐厅')] };
  const tours = toursForView(work);
  assert.deepEqual(tours.map(item => item.provider), ['Kuula', 'Matterport']);
  assert.deepEqual(tours.map(item => item.index), [0, 1]);
  assert.equal(selectTour(work, 1).title, '客餐厅');
  assert.equal(selectTour(work, 2), null);
  assert.equal(selectTour(work, -1), null);
  assert.equal(selectTour(work, 0.5), null);
  assert.deepEqual(tourInput({ conversationId: '11', workId: '12', versionId: '13', index: '1' }), { conversationId: '11', workId: '12', versionId: '13', index: 1 });
  for (const options of [
    {}, { conversationId: '11', workId: '12', versionId: '13' }, { conversationId: '0', workId: '12', versionId: '13', index: '0' },
    { conversationId: '11', workId: '12', versionId: '13', index: '3' }, { conversationId: '11', workId: '12', versionId: '13', index: '-1' },
  ]) assert.equal(tourInput(options), null, JSON.stringify(options));
});

test('assistant tour-view is packaged with licensed PNG icons under the size limit', () => {
  const root = path.join(__dirname, '..');
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  assert.ok(app.subPackages.some(item => item.root === 'packages/assistant' && item.pages.includes('tour-view/tour-view')));
  const total = packageSourceFiles('packages/assistant').reduce((sum, file) => sum + file.size, 0);
  // DevTools counts ~81KB more than the source-file sum (2111KB reported for a
  // 2032KB tree on 2026-10-30), so keep 96KB of accounting headroom.
  assert.ok(total <= 2048 * 1024 - 96 * 1024, 'assistant subpackage is ' + total + ' bytes');
  for (const name of ['tour-3d.png', 'copy-link.png', 'tour-play.png', 'tour-3d-ink.png']) {
    const file = path.join(root, 'packages/assistant/assets', name);
    const bytes = fs.readFileSync(file);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], name);
    assert.ok(bytes.length <= 300 * 1024, name + ' is ' + bytes.length + ' bytes');
  }
});
