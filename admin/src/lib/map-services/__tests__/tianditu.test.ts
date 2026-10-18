import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TiandituCommunityProvider, tiandituCommunityPoi } from '../tianditu';
import { createCommunityProvider } from '../providers';

const config = { key: 'private-tianditu-test-key', signingKey: '', license: 'fixture-only', validUntil: '2099-01-01', dailyLimit: 100, providerKey: 'tianditu' };
const raw = { hotPointID: 'TDT_TEST_12345678', name: '测试花园一期', poiType: 101, typeCode: '120201', city: '宜昌市', cityCode: '156420500', county: '西陵区', countyCode: '156420502', address: '测试路' };
const result = (pois = [raw]) => Response.json({ status: { infocode: 1000 }, resultType: 1, pois });
test('Tianditu uses its own residential-community type and strict structured city identity', () => {
  assert.equal(tiandituCommunityPoi(raw, '420500')?.poiId, raw.hotPointID);
  assert.ok(tiandituCommunityPoi({ ...raw, cityCode: '420500', countyCode: '420502' }, '420500'));
  for (const changed of [{ hotPointID: '' }, { typeCode: '120202' }, { typeCode: '260303' }, { typeCode: '120302' }, { poiType: 102 }, { city: '武汉市' }, { countyCode: '156420102' }, { cityCode: 'malformed' }, { name: '测试花园南门' }, { name: '一期、二期' }]) assert.equal(tiandituCommunityPoi({ ...raw, ...changed }, '420500'), null);
  assert.ok(tiandituCommunityPoi({ ...raw, cityCode: undefined, countyCode: undefined }, '420500'));
  assert.equal(tiandituCommunityPoi({ ...raw, cityCode: undefined, countyCode: undefined, city: '', address: '宜昌市测试路' }, '420500'), null);
});
test('Tianditu transport fixes HTTPS host, city/admin/type/page controls and deduplicates stable IDs', async () => {
  let calls = 0;
  const provider = createCommunityProvider(config, async (input, init) => {
    const url = new URL(String(input)); calls++;
    assert.equal(url.origin, 'https://api.tianditu.gov.cn'); assert.equal(url.pathname, '/v2/search'); assert.equal(url.searchParams.get('tk'), config.key);
    assert.equal(url.searchParams.get('type'), 'query'); assert.equal(init?.cache, 'no-store'); assert.equal(init?.redirect, 'error');
    assert.deepEqual(JSON.parse(url.searchParams.get('postStr')!), { keyWord: '花园', specify: '156420500', queryType: 12, start: 0, count: 10, dataTypes: '120201', show: 2 });
    return result([raw, raw, { ...raw, hotPointID: 'TDT_TEST_99999999', countyCode: '156420102' }]);
  });
  assert.equal((await provider.search('420500', '花园')).length, 1);
  await assert.rejects(provider.search('420500', '花'), /query/); assert.equal(calls, 1);
  assert.throws(() => createCommunityProvider({ ...config, providerKey: 'unknown' }), /not_implemented/);
});
test('Tianditu revalidation repeats signed name search and accepts only the exact original ID', async () => {
  const provider = new TiandituCommunityProvider(config, async input => {
    const body = JSON.parse(new URL(String(input)).searchParams.get('postStr')!); assert.equal(body.keyWord, raw.name); return result();
  });
  assert.equal((await provider.detail('420500', raw.hotPointID, raw.name)).poiId, raw.hotPointID);
  await assert.rejects(provider.detail('420500', 'TDT_TEST_DIFFERENT', raw.name), /candidate_invalid/);
  await assert.rejects(provider.detail('420500', raw.hotPointID), /candidate_invalid/);
});
test('Tianditu suggestions/admin/statistics never become communities and empty results stay empty', async () => {
  for (const type of [2, 3, 4, 5]) {
    const provider = new TiandituCommunityProvider(config, async () => Response.json({ status: { infocode: 1000 }, resultType: type, pois: [raw] }));
    assert.deepEqual(await provider.search('420500', '花园'), []);
  }
  const empty = new TiandituCommunityProvider(config, async () => Response.json({ status: { infocode: 3001 }, resultType: 1 }));
  assert.deepEqual(await empty.search('420500', '花园'), []);
});
test('Tianditu errors and corrupt/oversized responses expose no provider key or raw error body', async () => {
  for (const [status, code] of [[401, /provider_denied/], [403, /provider_denied/], [429, /provider_quota/], [500, /provider_unavailable/]] as const) {
    await assert.rejects(new TiandituCommunityProvider(config, async () => new Response(config.key, { status })).search('420500', '花园'), code);
  }
  for (const response of [() => Response.json({ status: { infocode: 3000, cndesc: config.key } }), () => new Response('{invalid:' + config.key), () => new Response('x'.repeat(512001)), () => Response.json({ status: { infocode: 1000 }, resultType: 1, pois: {} })]) {
    await assert.rejects(new TiandituCommunityProvider(config, async () => response()).search('420500', '花园'), error => { assert.equal(String(error).includes(config.key), false); return /provider_unavailable/.test(String(error)); });
  }
  await assert.rejects(new TiandituCommunityProvider(config, async () => { throw Error(config.key); }).search('420500', '花园'), /provider_unavailable/);
});
