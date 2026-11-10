import test from 'node:test';
import assert from 'node:assert/strict';
import { designerRecommendationReceipt, nearbyPublicSitesReceipt, nearbyPublicSitesText, publicSitesDelivery,
  publicSitesDeliveryText, publicSitesNeedRegionReceipt, publicSitesOutcomeOf } from '../agent/dialogue-recommend-tools';

/** Pure unit coverage for the shared recommendation tools: the server-authored
 * wordings, the need_region receipt that persists no step, and the delivery
 * override for a located empty result. The factories themselves need a live
 * run and are exercised by native acceptance. */

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
