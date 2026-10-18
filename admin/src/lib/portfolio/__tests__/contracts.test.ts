import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_WORK, cityCode, designerProfile, inCity, workContent } from '../contracts';
import { AmapCommunityProvider, candidateToken, communityPoi, providerConfig, readCandidate } from '../community-provider';

const valid = { ...EMPTY_WORK, title: '原木生活', description: '客餐厅和收纳方向', primaryStyle: '原木风', cityCode: '330100', cityName: '杭州市', authorRole: '主创', source: '本人原创', authorization: '已授权本组图片的作品展示和推荐',
  images: [{ assetId: '1', kind: 'render', aiGenerated: true, showroom: false, caption: '' }], coverAssetId: '1' };
test('publication requires rights/cover; AI/photo roles and source metadata are validated without guessing', () => {
  assert.deepEqual(workContent(valid, true).images[0], valid.images[0]);
  for (const content of [{ ...valid, authorization: '' }, { ...valid, images: [] }, { ...valid, coverAssetId: '2' }, { ...valid, secondaryStyles: ['原木风'] }, { ...valid, rightsUntil: '2020-01-01T00:00:00Z' }, { ...valid, images: [{ ...valid.images[0], kind: 'photo' }] }, { ...valid, images: [{ ...valid.images[0], showroom: true }] }, { ...valid, source: 'x\0' }, { ...valid, unexpected: true }]) assert.throws(() => workContent(content, true));
  assert.equal(workContent({ title: '还没传图' }).images.length, 0);
});
test('city boundaries distinguish same-name cities, districts and municipalities', () => {
  assert.equal(cityCode('330100'), '330100'); assert.equal(cityCode('110000'), '110000');
  for (const value of ['330106', '330000', '杭州', '', '330100 OR 1=1']) assert.throws(() => cityCode(value));
  assert.equal(inCity('330106', '330100'), true); assert.equal(inCity('330200', '330100'), false); assert.equal(inCity('110101', '110000'), true);
  assert.throws(() => designerProfile({ bio: '', cities: [], styles: [], featuredWorkIds: [], displayName: 'fake' }));
});
const raw = { id: 'B0FFTEST001', name: '测试花园一期', typecode: '120302', adcode: '330106', cityname: '杭州市', adname: '西湖区', address: '测试路' };
test('provider candidates reject ID-less tips, entrances, roads, other cities and ambiguous phases', () => {
  assert.ok(communityPoi(raw, '330100'));
  for (const v of [{ ...raw, id: '' }, { ...raw, typecode: '190301' }, { ...raw, adcode: '330206' }, { ...raw, name: '测试花园南门' }, { ...raw, name: '一期、二期' }]) assert.equal(communityPoi(v, '330100'), null);
});
test('v3 residential results without adcode require an exact known structured city and never trust request/address alone', () => {
  const liveShape = { ...raw, adcode: undefined, cityname: '宜昌市', adname: '西陵区', pname: '湖北省' };
  assert.equal(communityPoi(liveShape, '420500')?.cityCode, '420500');
  assert.equal(communityPoi({ ...liveShape, cityname: '武汉市' }, '420500'), null);
  assert.equal(communityPoi({ ...liveShape, cityname: '', address: '宜昌市测试路' }, '420500'), null);
  assert.equal(communityPoi({ ...liveShape, adcode: '420102' }, '420500'), null);
  assert.equal(communityPoi({ ...liveShape, adcode: 'invalid' }, '420500'), null);
  assert.equal(communityPoi({ ...liveShape, adcode: 420102 }, '420500'), null);
  assert.equal(communityPoi({ ...liveShape, adcode: ['420102'] }, '420500'), null);
  assert.equal(communityPoi({ ...liveShape, adcode: '420502', cityname: '武汉市' }, '420500'), null);
  assert.ok(communityPoi({ ...liveShape, cityname: [], pname: '北京市' }, '110000'));
  assert.equal(communityPoi({ ...liveShape, cityname: [], pname: '河北省' }, '110000'), null);
});
test('provider configuration requires a Key and valid app limit while authorization remains optional metadata', () => {
  assert.throws(() => providerConfig({}), /provider_unconfigured/);
  const env = { AMAP_WEB_SERVICE_KEY: 'fake-test-key' };
  assert.equal(providerConfig(env).dailyLimit, 1000);
  assert.equal(providerConfig(env).license, ''); assert.equal(providerConfig(env).validUntil, '');
  assert.equal(providerConfig({ AMAP_KEY: 'legacy-key' }).key, 'legacy-key');
  assert.equal(providerConfig({ ...env, AMAP_RIGHTS_VALID_UNTIL: 'invalid' }).validUntil, '');
  assert.equal(providerConfig({ ...env, AMAP_COMMERCIAL_LICENSE_CONFIRMED: 'false', AMAP_RIGHTS_VALID_UNTIL: '2020-01-01' }).key, env.AMAP_WEB_SERVICE_KEY);
  assert.throws(() => providerConfig({ ...env, AMAP_APP_DAILY_LIMIT: '0' }));
});
test('AMap proxy fixes domain/version/city/category; errors reveal neither provider key nor raw body', async () => {
  const config = { key: 'private-test-key', signingKey: '', license: 'test-only', validUntil: '2099-01-01', dailyLimit: 100 };
  let calls = 0;
  const provider = new AmapCommunityProvider(config, async input => {
    const url = new URL(String(input)); calls++; assert.equal(url.origin, 'https://restapi.amap.com');
    assert.equal(url.pathname, '/v3/place/text'); assert.equal(url.searchParams.get('citylimit'), 'true'); assert.equal(url.searchParams.get('types'), '120300');
    return Response.json({ status: '1', pois: [raw, { ...raw }, { ...raw, id: 'B0FFTEST002', adcode: '330206' }] });
  });
  assert.equal((await provider.search('330100', '测试')).length, 1); assert.equal(calls, 1);
  await assert.rejects(provider.search('330100', '测'), /query/); assert.equal(calls, 1);
  for (const [code, expected] of [['10001', /provider_denied/], ['10003', /provider_quota/], ['99999', /provider_unavailable/]] as const) {
    const p = new AmapCommunityProvider(config, async () => Response.json({ status: '0', infocode: code, info: 'private-test-key' }));
    await assert.rejects(p.search('330100', '测试'), expected);
  }
  await assert.rejects(new AmapCommunityProvider(config, async () => { throw Error('https://private-test-key'); }).search('330100', '测试'), /provider_unavailable/);
  const detail = new AmapCommunityProvider(config, async () => Response.json({ status: '1', pois: [{ ...raw, id: 'B0FFTEST002' }] }));
  await assert.rejects(detail.detail('330100', raw.id), /candidate_invalid/);
});
test('signed candidate binds operator/tenant/city/POI and cannot be forged', async () => {
  const prior = process.env.JWT_SECRET; process.env.JWT_SECRET = 'portfolio-unit-test-only';
  try {
    const poi = communityPoi(raw, '330100')!, token = await candidateToken('1', '2', poi);
    assert.equal((await readCandidate(token, '1', '2')).poiId, raw.id);
    await assert.rejects(readCandidate(token, '2', '2')); await assert.rejects(readCandidate(token, '1', '3')); await assert.rejects(readCandidate(token + 'forged', '1', '2'));
  } finally { if (prior === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = prior; }
});
