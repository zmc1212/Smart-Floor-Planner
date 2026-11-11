import test from 'node:test';
import assert from 'node:assert/strict';
import { designerRecommendationReceipt, dialogueDesignerRecommendation, dialoguePublicSitesRecommendation,
  nearbyPublicSitesReceipt, nearbyPublicSitesText, publicSitesDelivery, publicSitesDeliveryText,
  publicSitesNeedRegionReceipt, publicSitesOutcomeOf, type RecommendToolRuntime } from '../agent/dialogue-recommend-tools';

/** Pure unit coverage for the shared recommendation tools: the server-authored
 * wordings, the need_region receipt that persists no step, the delivery
 * override for a located empty result, and the fixed 2000/2010 receipts that
 * are re-served after a restart. */

const region = { cityCode: '320500', cityName: '苏州', district: '姑苏区', source: 'housing' as const };

test('nearby text names the authorized place and only published sites', () => {
  assert.equal(nearbyPublicSitesText({ cityName: '苏州', district: '姑苏区' }, []),
    '按你所在的位置（苏州·姑苏区）暂时没有已授权公开的工地；这不代表这一片没有在施工的工地。');
  assert.equal(nearbyPublicSitesText({ cityName: '苏州' }, []),
    '按你所在的位置（苏州）暂时没有已授权公开的工地；这不代表这一片没有在施工的工地。');
  const items = [{ name: '阳光新城工地', stageName: '泥木阶段' }, { name: '第二工地' }];
  assert.equal(nearbyPublicSitesText({ cityName: '苏州', district: '姑苏区' }, items),
    '按你所在的位置（苏州·姑苏区）找到 2 个已授权公开的工地：阳光新城工地（泥木阶段）、第二工地。'
    + '公开工地卡片随本条回复展示，可直接打开查看公开记录；只按城市/区县筛选，没有精确距离。');
});

test('located results are ready or empty; need_region asks honestly and writes no step', () => {
  assert.deepEqual(nearbyPublicSitesReceipt(region, [{ name: '阳光新城工地' }]),
    { status: 'ready', tool: 'recommend_public_sites', text: nearbyPublicSitesText(region, [{ name: '阳光新城工地' }]) });
  assert.equal(nearbyPublicSitesReceipt(region, []).status, 'empty');
  const needRegion = publicSitesNeedRegionReceipt();
  assert.deepEqual(needRegion, { status: 'need_region', tool: 'recommend_public_sites',
    text: '还没有已获权的定位或明确的房屋城市，暂不能按附近筛选公开工地；可以请客户授权定位或补充所在城市。' });
  assert.equal(publicSitesOutcomeOf(needRegion), undefined);
});

test('an empty located result overrides delivery and drops the model draft', () => {
  const empty = { status: 'empty', text: '按你所在的位置（苏州·姑苏区）暂时没有已授权公开的工地；这不代表这一片没有在施工的工地。' };
  const model = '我们当然可以带您去看看附近的工地。';
  assert.equal(publicSitesDeliveryText(model, empty), empty.text);
  assert.equal(publicSitesDeliveryText(model, { status: 'ready', text: '列表' }), model);
  assert.equal(publicSitesDeliveryText(model, undefined), model);
  assert.deepEqual(publicSitesDelivery({ text: model, modelIncluded: true }, empty), { text: empty.text, modelIncluded: false });
  assert.deepEqual(publicSitesDelivery({ text: model, modelIncluded: true }, { status: 'ready', text: '列表' }),
    { text: model, modelIncluded: true });
  assert.deepEqual(publicSitesDelivery({ text: model, modelIncluded: false }, undefined), { text: model, modelIncluded: false });
  assert.deepEqual(publicSitesOutcomeOf({ status: 'ready', text: '列表' }), { status: 'ready', text: '列表' });
  assert.equal(publicSitesOutcomeOf({ status: 'empty', text: '占位' })?.status, 'empty');
  assert.equal(publicSitesOutcomeOf(undefined), undefined);
});

test('designer receipts keep the three authorized wordings', () => {
  assert.deepEqual(designerRecommendationReceipt(2, false), { status: 'ready', tool: 'recommend_designers',
    text: '按当前公开条件找到2位设计师的公开作品，卡片随本条回复展示。' });
  assert.deepEqual(designerRecommendationReceipt(0, true), { status: 'empty', tool: 'recommend_designers',
    text: '还缺少房屋城市或设计方向，暂不能推荐；可以请客户补充所在城市或想要的风格。' });
  assert.deepEqual(designerRecommendationReceipt(0, false), { status: 'empty', tool: 'recommend_designers',
    text: '没有找到符合条件的公开设计师作品。' });
});

/** Recovery must rebuild the public-site delivery state from the persisted
 * receipt before any call; otherwise a resumed graph can deliver a
 * contradictory model draft. */
const runtime = (recovered: RecommendToolRuntime['recovered']): RecommendToolRuntime => ({
  lease: { enterpriseId: '1454', jobId: '1', runId: '5', token: 't',
    actor: { enterpriseId: '1454', principal: { kind: 'user' as const, userId: '7' }, contextVersion: 1, capabilities: [] } },
  protocol: 'test',
  // A recovered receipt must be served from the persistence snapshot: reaching
  // authorization or a fresh candidate query is the defect under test.
  authorize: async () => { throw new Error('a recovered receipt must not re-authorize or re-query'); },
  context: { version: 1, knowledge: [], snapshots: [], sources: [] },
  messages: [],
  recovered,
} as unknown as RecommendToolRuntime);

const emptySites = { status: 'empty', tool: 'recommend_public_sites',
  text: '按你所在的位置（宜昌市·西陵区）暂时没有已授权公开的工地；这不代表这一片没有在施工的工地。' };

test('a recovered empty public-site receipt restores delivery without a new query', async () => {
  const sites = dialoguePublicSitesRecommendation(runtime({ publicSites: emptySites }));
  assert.deepEqual(sites.outcome(), { status: 'empty', text: emptySites.text },
    'The delivery outcome exists before any tool call');
  const first = await sites.call();
  assert.deepEqual(first, emptySites, 'The cached receipt is re-served verbatim');
  assert.deepEqual(await sites.call(), first, 'A later cache hit returns the same receipt');
  const composed = publicSitesDelivery({ text: '还需要知道您所在的城市或区县。', modelIncluded: true }, sites.outcome());
  assert.equal(composed.text, emptySites.text,
    'A saved located empty result must not become a request for the customer city');
  assert.equal(composed.modelIncluded, false);
});

test('a recovered designer receipt is re-served without a new query', async () => {
  const receipt = { status: 'ready', tool: 'recommend_designers',
    text: '按当前公开条件找到1位设计师的公开作品，卡片随本条回复展示。' };
  const designers = dialogueDesignerRecommendation(runtime({ designers: receipt }));
  assert.deepEqual(await designers(), receipt);
});

test('without a recovered receipt the outcome stays unset until a real call', () => {
  const sites = dialoguePublicSitesRecommendation(runtime(undefined));
  assert.equal(sites.outcome(), undefined);
});
