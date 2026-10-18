import { timingSafeEqual } from 'node:crypto';
export function authorized(request: Request) {
  const expected = process.env.CRON_SECRET; const actual = request.headers.get('x-cron-secret');
  return Boolean(expected && actual && Buffer.byteLength(expected) === Buffer.byteLength(actual) && timingSafeEqual(Buffer.from(expected!), Buffer.from(actual!)));
}
