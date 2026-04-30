import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import {
  revokeEnterpriseManagedPollinationsKey,
  syncEnterprisePollinationsSnapshot,
  updateEnterpriseAiConfig,
  upsertEnterpriseManagedPollinationsKey,
} from '@/lib/ai/enterprise-ai';

interface AiKeyBody {
  allowedModels?: string[];
  pollenBudget?: number | null;
  rotate?: boolean;
  status?: 'revoked';
}

function getErrorResponse(error: unknown, fallbackMessage: string) {
  const status =
    error &&
    typeof error === 'object' &&
    'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : 500;

  return NextResponse.json(
    {
      success: false,
      error: error instanceof Error ? error.message : fallbackMessage,
    },
    { status }
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();

    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const body = (await request.json().catch(() => ({}))) as AiKeyBody;
      const { id } = await params;
      const result = await upsertEnterpriseManagedPollinationsKey({
        enterpriseId: id,
        allowedModels: body.allowedModels || [],
        pollenBudget: body.pollenBudget ?? null,
        rotate: Boolean(body.rotate),
      });

      return NextResponse.json({
        success: true,
        data: {
          secret: result.secret,
          maskedKey: result.maskedKey,
          keyInfo: result.keyInfo,
          snapshot: result.snapshot,
        },
      });
    });
  } catch (error) {
    console.error('[Enterprise AI Key POST]', error);
    return getErrorResponse(error, 'Server error');
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();

    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const body = (await request.json()) as AiKeyBody;
      const { id } = await params;

      if (
        (body.status as unknown as string) === 'active' ||
        (body.status as unknown as string) === 'disabled'
      ) {
        return NextResponse.json(
          {
            success: false,
            error: 'Pollinations 子 Key 不支持启用或停用，请使用轮换或撤销。',
          },
          { status: 400 }
        );
      }

      if (body.status === 'revoked') {
        await revokeEnterpriseManagedPollinationsKey(id);
      } else {
        await updateEnterpriseAiConfig({
          enterpriseId: id,
          allowedModels: body.allowedModels,
          pollenBudget: body.pollenBudget,
        });
      }

      const snapshot = await syncEnterprisePollinationsSnapshot(id).catch(() => null);
      return NextResponse.json({
        success: true,
        data: snapshot,
      });
    });
  } catch (error) {
    console.error('[Enterprise AI Key PATCH]', error);
    return getErrorResponse(error, 'Server error');
  }
}
