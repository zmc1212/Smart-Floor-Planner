import { NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { fail } from '@/lib/assistant/contracts';
import { cityCode, shortText } from '@/lib/portfolio/contracts';
import { isMapProviderKey } from './contracts';
import { getPlatformMapConfig, importEnvironmentMapConfig, mapError, savePlatformMapConfig, testPlatformMapConnection } from './config';

const headers = { 'Cache-Control': 'no-store' };
async function readBody(request: Request) {
  if (!request.body) return fail('map_config_invalid', 422);
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); return fail('map_config_invalid', 413); }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { reader.releaseLock(); }
}
export async function mapConfigHttp(request: Request, action: 'read' | 'save' | string) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async context => {
      if (action === 'read') return NextResponse.json({ success: true, data: await getPlatformMapConfig(context.userId) }, { headers });
      const raw = await readBody(request);
      let body: Record<string, unknown>;
      try { body = JSON.parse(raw); } catch { return fail('map_config_invalid', 422); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail('map_config_invalid', 422);
      if (action === 'save') return NextResponse.json({ success: true, data: await savePlatformMapConfig(body, context.userId) }, { headers });
      const allowed = action === 'test' ? ['expectedVersion', 'cityCode', 'query', 'providerKey'] : ['expectedVersion'];
      if (Object.keys(body).some(k => !allowed.includes(k)) || !Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 0) fail('map_config_invalid', 422);
      const version = Number(body.expectedVersion);
      if (action === 'import') return NextResponse.json({ success: true, data: await importEnvironmentMapConfig(version, context.userId) }, { headers });
      if (action === 'test') {
        if (body.providerKey !== undefined && !isMapProviderKey(body.providerKey)) fail('map_config_invalid', 422);
        const city = cityCode(body.cityCode), query = shortText(body.query, 50, true);
        if ([...query].length < 2) fail('map_config_invalid', 422);
        return NextResponse.json({ success: true, data: await testPlatformMapConnection(context.userId, version, city, query, fetch, body.providerKey as 'amap' | 'tianditu' | undefined) }, { headers });
      }
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404, headers });
    });
  } catch (error) {
    const safe = mapError(error);
    return NextResponse.json({ success: false, error: safe.message, code: safe.code }, { status: safe.status, headers });
  }
}
