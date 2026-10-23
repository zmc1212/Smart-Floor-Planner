import type { NextRequest } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { fail } from '@/lib/assistant/contracts';
import { cameraJson, cameraError } from '@/lib/construction/camera/http';
import { cameraCapacity } from '@/lib/construction/camera-capacity';

export const runtime = 'nodejs';
type Context = { params: Promise<{ projectId: string; bindingId: string }> };
export async function GET(request: NextRequest, context: Context) {
  return withTenantRoute(request, { requireEnterprise: true }, async actor => {
    try {
      if (request.nextUrl.search) fail('camera_invalid_request', 422);
      const { projectId, bindingId } = await context.params;
      return cameraJson(await cameraCapacity({ enterpriseId: actor.enterpriseId!, adminId: actor.userId }, projectId, bindingId));
    } catch (error) { return cameraError(error); }
  });
}
