import { mapConfigHttp } from '@/lib/map-services/http';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;
export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  return mapConfigHttp(request, (await context.params).action);
}
