import type { NextRequest } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { fail } from '@/lib/assistant/contracts';
import { cameraJson, cameraError } from '@/lib/construction/camera/http';
import { cameraCleanup } from '@/lib/construction/camera-cleanup';

export const runtime = 'nodejs';
type Context = { params: Promise<{ projectId: string; bindingId: string }> };
export async function GET(request: NextRequest, context: Context) {
  return withTenantRoute(request, { requireEnterprise: true }, async actor => {
    try {
      const query = request.nextUrl.searchParams;
      if ([...query.keys()].some(key => key !== 'beforeId') || query.getAll('beforeId').length > 1) fail('camera_invalid_request', 422);
      const { projectId, bindingId } = await context.params;
      return cameraJson(await cameraCleanup({ enterpriseId: actor.enterpriseId!, adminId: actor.userId }, projectId, bindingId, query.has('beforeId') ? query.get('beforeId')! : undefined));
    } catch (error) { return cameraError(error); }
  });
}
