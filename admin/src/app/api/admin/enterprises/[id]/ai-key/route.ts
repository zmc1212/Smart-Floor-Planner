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
  status?: 'active' | 'disabled' | 'revoked';
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
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '服务端错误' },
      { status: 500 }
    );
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

      if (body.status === 'revoked') {
        await revokeEnterpriseManagedPollinationsKey(id);
      } else {
        await updateEnterpriseAiConfig({
          enterpriseId: id,
          allowedModels: body.allowedModels,
          pollenBudget: body.pollenBudget,
          status: body.status,
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
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '服务端错误' },
      { status: 500 }
    );
  }
}
