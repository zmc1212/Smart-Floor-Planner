import type { NextRequest } from 'next/server';
import { publicCatalogHttp } from '@/lib/construction/public-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest, context: { params: Promise<{ enterpriseId: string; path: string[] }> }) {
  const params = await context.params;
  return publicCatalogHttp(request, params.enterpriseId, params.path);
}
