const assert = require('node:assert/strict');
const { test } = require('node:test');
const { PortfolioImages } = require('../packages/assistant/lib/portfolio');

const work = { id: '3', versionId: '3' };
const assetPath = '/miniprogram/assistant/conversations/1/portfolio/works/3/assets/25';

test('the online demo downloads an exact-version JPEG from the private gateway', async () => {
  const calls = [];
  const images = new PortfolioImages(null, async (path, options) => {
    calls.push({ path, options });
    return { tempFilePath: '/tmp/kodo.jpg' };
  }, 'production');
  assert.equal(await images.load('1', work, '25'), '/tmp/kodo.jpg');
  assert.deepEqual(calls, [{ path: `${assetPath}/kodo?versionId=3`, options: { suppressUnauthorized: true, timeout: 9000 } }]);
});

test('a storage failure uses the original authenticated JPEG, and a denial stops the request', async () => {
  for (const statusCode of [503, 401, 403]) {
    const calls = [];
    const images = new PortfolioImages(null, async path => {
      calls.push(path);
      if (calls.length === 1) throw { statusCode };
      return { tempFilePath: '/tmp/original.jpg' };
    }, 'production');
    const result = images.load('1', work, '25');
    if (statusCode === 503) {
      assert.equal(await result, '/tmp/original.jpg');
      assert.deepEqual(calls, [`${assetPath}/kodo?versionId=3`, `${assetPath}?versionId=3`]);
    } else {
      await assert.rejects(result, error => error.statusCode === statusCode);
      assert.equal(calls.length, 1);
    }
  }
});
