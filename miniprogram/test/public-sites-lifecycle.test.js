const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PublicSitesController } = require('../packages/construction/public-sites/public-sites-model');

const material = () => ({
  id: '21', versionId: '31', revision: 1, status: 'published', name: '测试工地',
  photos: [{ id: '41' }], excerpts: [], updatedAt: '2026-10-17',
});
const validEntry = () => ({ enterpriseId: '1', siteId: '21', versionId: '31' });

for (const switchIdentity of [false, true]) {
  test(`an invalid entry rejects a prior detail response${switchIdentity ? ' after an identity change' : ''}`, async () => {
    let finish;
    let identity = 'visitor-a';
    const loaded = [];
    const controller = new PublicSitesController({
      emit() {}, identity: () => identity,
      media: { clear() {}, async load(items) { loaded.push(items); } },
      client: { read() { return new Promise(resolve => { finish = resolve; }); } },
    });

    const original = controller.show(validEntry(), true);
    if (switchIdentity) identity = 'visitor-b';
    await controller.show({ ...validEntry(), versionId: 'invalid' }, true);
    finish(material());
    await original;

    assert.equal(controller.state.site, null);
    assert.equal(controller.state.unavailable, true);
    assert.equal(controller.state.loading, false);
    assert.deepEqual(loaded, []);
  });
}

test('an invalid entry removes cached photos and never polls or refreshes it', async () => {
  const calls = [];
  let clears = 0;
  const controller = new PublicSitesController({
    emit() {}, identity: () => 'visitor',
    media: { clear() { clears++; }, async load() {} },
    client: { async read(...args) { calls.push(args); return material(); } },
  });

  await controller.show(validEntry(), true);
  const before = clears;
  await controller.show({ ...validEntry(), enterpriseId: 'invalid' }, true);
  assert.ok(clears > before, 'discard files belonging to the prior valid entry');
  await controller.load();
  assert.equal(calls.length, 1, 'invalid entries must not create requests on refresh');
  assert.equal(controller.state.site, null);
  assert.equal(controller.state.unavailable, true);

  await controller.show(validEntry(), true);
  assert.equal(controller.state.site.id, '21', 'a later valid entry can recover normally');
  assert.equal(controller.state.unavailable, false);
  assert.equal(calls.length, 2);
});
