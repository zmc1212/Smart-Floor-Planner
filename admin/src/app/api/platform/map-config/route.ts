import { mapConfigHttp } from '@/lib/map-services/http';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => mapConfigHttp(request, 'read');
export const PATCH = (request: Request) => mapConfigHttp(request, 'save');
