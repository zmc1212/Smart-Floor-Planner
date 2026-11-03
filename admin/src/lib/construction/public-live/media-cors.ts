import { fail } from '@/lib/assistant/contracts';

// Media uses short-lived URL capabilities, never cookies/Authorization. The
// browser HLS loader fetches manifests/segments across the Mini Program host.
export const liveMediaCorsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Range',
};

export function liveMediaPreflight(request: Request) {
  const method = request.headers.get('Access-Control-Request-Method');
  const requested = (request.headers.get('Access-Control-Request-Headers') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (method !== 'GET' || requested.some(name => name !== 'range')) fail('public_live_unavailable', 404);
  return new Response(null, { status: 204, headers: { ...liveMediaCorsHeaders, 'Access-Control-Max-Age': '0', 'Cache-Control': 'no-store' } });
}
