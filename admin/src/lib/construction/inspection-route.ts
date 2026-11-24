import { sql } from 'drizzle-orm';
import { SaxesParser } from 'saxes';
import { withPlatformTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { AssistantError, fail, fingerprint, id } from '@/lib/assistant/contracts';
import { getTiandituInspectionKey } from '@/lib/map-services/config';
import { object, type ConstructionActor } from './contracts';
import { inspectionPoint, type InspectionPoint } from './inspection-policy';
import { inspectionStops } from './inspection';

export type DrivingLeg = { seconds: number; points: InspectionPoint[] };
type LegMatrix = Array<Array<DrivingLeg | null>>;

/** Matrix row zero is the chosen origin. Other rows are directed project legs. */
export function fastestInspectionOrder(matrix: LegMatrix, first?: number) {
  const count = matrix.length - 1;
  if (count < 1 || count > 8 || matrix.some(row => row.length !== count)) fail('invalid_construction', 422);
  const end = (1 << count) - 1;
  const costs = Array.from({ length: end + 1 }, () => Array<number>(count).fill(Infinity));
  const previous = Array.from({ length: end + 1 }, () => Array<number>(count).fill(-1));
  for (let i = 0; i < count; i++) {
    const leg = matrix[0][i];
    if (leg && (first === undefined || first === i)) costs[1 << i][i] = leg.seconds;
  }
  for (let mask = 1; mask <= end; mask++) {
    for (let from = 0; from < count; from++) {
      if (!Number.isFinite(costs[mask][from])) continue;
      for (let to = 0; to < count; to++) {
        const leg = matrix[from + 1][to];
        if (!leg || mask & (1 << to)) continue;
        const next = mask | (1 << to), cost = costs[mask][from] + leg.seconds;
        if (cost < costs[next][to]) {
          costs[next][to] = cost;
          previous[next][to] = from;
        }
      }
    }
  }
  const best = Math.min(...costs[end]);
  if (!Number.isFinite(best)) fail('inspection_route_unavailable', 503);
  let mask = end, stop = costs[end].indexOf(best);
  const indices: number[] = [];
  while (stop !== -1) {
    indices.push(stop);
    const next = previous[mask][stop];
    mask ^= 1 << stop;
    stop = next;
  }
  return { indices: indices.reverse(), seconds: best };
}

/** The existing Web Service returns XML. Duration units must be verified on the configured account. */
export function parseTiandituLeg(body: string, durationUnit: 'seconds' | 'minutes'): DrivingLeg {
  const values: Record<string, string> = {};
  const tags: string[] = [];
  const parser = new SaxesParser({ xmlns: false });
  parser.on('doctype', () => fail('inspection_route_unavailable', 503));
  parser.on('error', () => fail('inspection_route_unavailable', 503));
  parser.on('opentag', tag => { tags.push(tag.name.toLowerCase()); if (tags.length > 16 || tags[0] !== 'result') fail('inspection_route_unavailable', 503); });
  const append = (value: string) => {
    const key = tags.join('.');
    if (key === 'result.duration' || key === 'result.routelatlon') values[key] = (values[key] || '') + value;
  };
  parser.on('text', append);
  parser.on('cdata', append);
  parser.on('closetag', () => { tags.pop(); });
  parser.write(body).close();
  const duration = values['result.duration']?.trim(), geometry = values['result.routelatlon'];
  if (!duration || !/^\d+(?:\.\d+)?$/.test(duration) || !geometry) fail('inspection_route_unavailable', 503);
  const seconds = Number(duration) * (durationUnit === 'minutes' ? 60 : 1);
  const coordinates = geometry.trim().split(';').filter(Boolean);
  if (!Number.isFinite(seconds) || seconds <= 0 || coordinates.length < 2 || coordinates.length > 20000) fail('inspection_route_unavailable', 503);
  const points = coordinates.map(pair => {
    const match = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/.exec(pair.trim());
    if (!match) fail('inspection_route_unavailable', 503);
    return inspectionPoint({ longitude: Number(match[1]), latitude: Number(match[2]), coordinateSystem: 'wgs84' });
  });
  return { seconds: Math.ceil(seconds), points };
}

function routeSettings(): { limit: number; qps: number; unit: 'seconds' | 'minutes' } {
  const limit = Number(process.env.TIANDITU_INSPECTION_DAILY_LIMIT);
  const qps = Number(process.env.TIANDITU_INSPECTION_QPS);
  const unit = process.env.TIANDITU_INSPECTION_DURATION_UNIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000000 || !Number.isSafeInteger(qps) || qps < 1 || qps > 1000
    || !(unit === 'seconds' || unit === 'minutes')) fail('inspection_map_unconfigured', 503);
  return { limit, qps, unit };
}

export async function reserveDrivingCalls(count: number, limit: number) {
  if (count > limit) fail('inspection_map_quota', 429);
  // Keep capacity shared by every server process and every tenant using this account.
  const reserved = await withPlatformTransaction(tx => one(tx, sql`
    insert into app.construction_inspection_map_usage(config_key,day,request_count)
    values('tianditu-drive',(now() at time zone 'Asia/Shanghai')::date,${count})
    on conflict(config_key,day) do update set request_count=construction_inspection_map_usage.request_count+excluded.request_count
    where construction_inspection_map_usage.request_count+excluded.request_count<=${limit} returning request_count`));
  if (!reserved) fail('inspection_map_quota', 429);
}

async function drivingSlot(qps: number, signal: AbortSignal) {
  while (!signal.aborted) {
    const slot = await withPlatformTransaction(tx => one(tx, sql`
      update app.construction_inspection_map_usage set
        second_count=case when second_bucket=date_trunc('second',now()) then second_count+1 else 1 end,
        second_bucket=date_trunc('second',now())
      where config_key='tianditu-drive' and day=(now() at time zone 'Asia/Shanghai')::date
        and (second_bucket<>date_trunc('second',now()) or second_count<${qps}) returning second_count`));
    if (slot) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  fail('inspection_route_unavailable', 503);
}

async function tiandituDrivingLeg(from: InspectionPoint, to: InspectionPoint, key: string, unit: 'seconds' | 'minutes', signal: AbortSignal) {
  const url = new URL('https://api.tianditu.gov.cn/drive');
  const point = (p: InspectionPoint) => p.longitude.toFixed(6) + ',' + p.latitude.toFixed(6);
  url.search = new URLSearchParams({ tk: key, type: 'search', postStr: JSON.stringify({ orig: point(from), dest: point(to), style: '0' }) }).toString();
  try {
    const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]), redirect: 'error', cache: 'no-store' });
    if (response.status === 429) fail('inspection_map_quota', 429);
    if (!response.ok || !response.body) fail('inspection_route_unavailable', 503);
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 1024 * 1024) { await reader.cancel(); fail('inspection_route_unavailable', 503); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return parseTiandituLeg(Buffer.concat(chunks).toString('utf8'), unit);
  } catch (error) {
    if (error instanceof AssistantError && error.code === 'inspection_map_quota') throw error;
    return fail('inspection_route_unavailable', 503);
  }
}

export type DrivingProvider = {
  reserve: (count: number) => Promise<void>;
  leg: (from: InspectionPoint, to: InspectionPoint, signal: AbortSignal, key: string) => Promise<DrivingLeg>;
};
export async function tiandituProvider(): Promise<DrivingProvider> {
  const settings = routeSettings();
  const key = await getTiandituInspectionKey().catch(() => fail('inspection_map_unconfigured', 503));
  return {
    reserve: count => reserveDrivingCalls(count, settings.limit),
    leg: async (from, to, signal) => {
      await drivingSlot(settings.qps, signal);
      return tiandituDrivingLeg(from, to, key, settings.unit, signal);
    },
  };
}

export async function prepareInspectionRoute(actor: ConstructionActor, input: unknown) {
  const body = object(input, ['projectIds', 'origin', 'firstProjectId']);
  if (!Array.isArray(body.projectIds) || !body.projectIds.length || body.projectIds.length > 8) fail('invalid_construction', 422);
  const projectIds = body.projectIds.map(id);
  if (new Set(projectIds).size !== projectIds.length) fail('invalid_construction', 422);
  const firstId = body.firstProjectId == null ? null : id(body.firstProjectId);
  if (firstId && !projectIds.includes(firstId)) fail('invalid_construction', 422);
  const origin = inspectionPoint(body.origin);
  const authorized = await inspectionStops(actor, projectIds);
  const stops = projectIds.map(id => authorized.find(stop => stop.projectId === id)!);
  if (stops.some(site => !site.pin)) fail('inspection_pin_missing', 422);
  return { origin, projectIds, firstId, authorized, stops };
}

export async function executeInspectionRoute(
  actor: ConstructionActor,
  plan: Awaited<ReturnType<typeof prepareInspectionRoute>>,
  getProvider: () => Promise<DrivingProvider> = tiandituProvider,
) {
  const { origin, projectIds, firstId, authorized, stops } = plan;
  const points = [origin, ...stops.map(stop => stop.pin!)];
  const matrix: LegMatrix = points.map(() => stops.map(() => null));
  const legs = points.flatMap((from, index) => stops.flatMap((stop, to) => {
    if (index === to + 1 || (index === 0 && firstId && firstId !== stop.projectId)) return [];
    if (from.latitude === stop.pin!.latitude && from.longitude === stop.pin!.longitude) {
      matrix[index][to] = { seconds: 0, points: [from, stop.pin!] };
      return [];
    }
    return [{ from, index, to, destination: stop.pin! }];
  }));
  if (legs.length) {
    const provider = await getProvider();
    await provider.reserve(legs.length);
    const abort = new AbortController(), signal = AbortSignal.any([abort.signal, AbortSignal.timeout(45000)]);
    let offset = 0;
    try {
      await Promise.allSettled(Array.from({ length: Math.min(4, legs.length) }, async () => {
        try {
          for (let i = offset++; i < legs.length; i = offset++) {
            if (signal.aborted) fail('inspection_route_unavailable', 503);
            const leg = legs[i], key = leg.index + ':' + (leg.to + 1);
            matrix[leg.index][leg.to] = await provider.leg(leg.from, leg.destination, signal, key);
          }
        } catch (error) {
          abort.abort(error);
        }
      }));
      if (abort.signal.aborted) throw abort.signal.reason;
    } finally { abort.abort(); }
  }
  const latest = await inspectionStops(actor, projectIds);
  if (fingerprint(authorized) !== fingerprint(latest)) fail('inspection_route_changed', 409);
  const order = fastestInspectionOrder(matrix, firstId ? projectIds.indexOf(firstId) : undefined);
  let start = 0;
  return { provider: 'tianditu', seconds: order.seconds, calculatedAt: new Date().toISOString(),
    stops: order.indices.map(index => {
      const leg = matrix[start][index]!;
      start = index + 1;
      return { ...stops[index], seconds: leg.seconds, points: leg.points };
    }) };
}

export async function planInspectionRoute(actor: ConstructionActor, input: unknown, testProvider?: DrivingProvider) {
  const plan = await prepareInspectionRoute(actor, input);
  return executeInspectionRoute(actor, plan, testProvider && (async () => testProvider));
}
