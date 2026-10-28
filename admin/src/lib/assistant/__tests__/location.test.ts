import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coordinates, reverseRegion } from '../location/geocode';
import { nearbyRegion, recommendationRegion } from '../location/region';
import { resolveDesignerQuery } from '@/lib/portfolio/designer-recommendation';

const region = () => ({ cityCode: '330100', cityName: '杭州市', district: '西湖区', source: 'wechat_location' as const, resolvedAt: new Date().toISOString() });
test('location provides a city without requiring spoken city/style/layout; explicit housing wins', () => {
  assert.deepEqual(resolveDesignerQuery({ triggerText: '看看适合我的设计师', location: region() }), { cityCode: '330100', style: '', layout: '' });
  assert.deepEqual(resolveDesignerQuery({ triggerText: '看看适合我的设计师，风格我还没想好', location: region() }), { cityCode: '330100', style: '', layout: '' });
  assert.deepEqual(resolveDesignerQuery({ triggerText: '不想说城市，先看看适合我的设计师', location: region() }), { cityCode: '330100', style: '', layout: '' });
  assert.equal(resolveDesignerQuery({ triggerText: '不要推荐原木风设计师', location: region() }), null);
  assert.deepEqual(resolveDesignerQuery({ triggerText: '看看适合我的设计师', memoryStyle: '原木风', location: region() }), { cityCode: '330100', style: '原木风', layout: '' });
  assert.equal(resolveDesignerQuery({ triggerText: '看看适合我的设计师', memoryHousing: '房子在宜昌', location: region() })?.cityCode, '420500');
  assert.equal(resolveDesignerQuery({ triggerText: '房子在宁波，想看看设计师', memoryHousing: '杭州', location: region() })?.cityCode, '330200');
  assert.equal(resolveDesignerQuery({ memoryHousing: '杭州或宁波', location: region() }), null);
  assert.equal(resolveDesignerQuery({ location: region(), input: { query: '宁波原木风' } }), null);
  assert.equal(recommendationRegion({ nearbyRegion: region() }, '宜昌西陵区')?.district, '西陵区');
});
test('stale, future, malformed or unsupported location cannot become recommendation context', () => {
  for (const patch of [{ resolvedAt: 'invalid' }, { resolvedAt: new Date(Date.now() - 1800001).toISOString() },
    { resolvedAt: new Date(Date.now() + 100000).toISOString() }, { cityName: '宁波市' }, { district: '西陵区' }, { source: 'user_text' }]) {
    assert.equal(nearbyRegion({ nearbyRegion: { ...region(), ...patch } }), null);
  }
  assert.equal(recommendationRegion({ nearbyRegion: region() }, '杭州？'), null);
});
test('reverse geocode uses GCJ02 and structured administrative identity, never address guesses', async () => {
  let captured: URL | undefined;
  const point = { latitude: 30.25, longitude: 120.13, coordinateSystem: 'gcj02' as const };
  const config = { key: 'synthetic-test-key', signingKey: 'synthetic', license: '', validUntil: '', dailyLimit: 10 };
  const response = (part: unknown) => new Response(JSON.stringify({ status: '1', regeocode: { formatted_address: '不保存的详细地址', addressComponent: part } }));
  const actual = await reverseRegion(point, config, (async url => { captured = url as URL; return response({ adcode: '330106', city: '杭州市', district: '西湖区' }); }) as typeof fetch);
  assert.equal(captured?.pathname, '/v3/geocode/regeo'); assert.equal(captured?.searchParams.get('location'), '120.130000,30.250000'); assert.ok(captured?.searchParams.get('sig'));
  assert.deepEqual(Object.keys(actual).sort(), ['cityCode', 'cityName', 'district', 'resolvedAt', 'source']);
  assert.equal(actual.district, '西湖区');
  for (const part of [{ adcode: '330106', city: '宁波市', district: '西湖区' }, { adcode: [], city: '杭州市', district: '西湖区' }, { adcode: '330106', city: '杭州市', district: '伪造片区' }]) {
    await assert.rejects(reverseRegion(point, config, (async () => response(part)) as typeof fetch), /location_unavailable/);
  }
  const beijing = await reverseRegion(point, config, (async () => response({ adcode: '110101', city: [], province: '北京市', district: '东城区' })) as typeof fetch);
  assert.equal(beijing.cityCode, '110000');
  await assert.rejects(reverseRegion(point, config, (async () => { throw Error('provider timeout'); }) as typeof fetch), /location_unavailable/);
  await assert.rejects(reverseRegion(point, { ...config, providerKey: 'tianditu' }), /map_provider_not_implemented/);
  for (const input of [{ ...point, latitude: 91 }, { ...point, longitude: NaN }, { ...point, coordinateSystem: 'wgs84' }, { ...point, cityCode: '330100' }]) assert.throws(() => coordinates(input), /invalid_location/);
});
