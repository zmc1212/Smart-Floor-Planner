import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { EnterpriseAiUsageSnapshot } from '@/models/EnterpriseAiUsageSnapshot';
import {
  deriveEnterpriseKeyStatus,
  markEnterpriseAiSyncError,
  summarizeDailyUsage,
  syncEnterprisePollinationsSnapshot,
} from '@/lib/ai/enterprise-ai';

interface QuotaActionBody {
  action?: 'sync';
}

type SnapshotView = {
  balance?: number;
  currency?: string;
  lastSyncedAt?: Date | string | null;
  syncError?: string;
  dailyUsage?: Array<{ date: string; model: string; requests: number; costUsd: number }>;
  keyInfo?: {
    keyId?: string;
    valid?: boolean;
    allowedModels?: string[];
  } | null;
};

function buildQuotaResponse(snapshot: SnapshotView | null | undefined) {
  const usageSummary = summarizeDailyUsage(snapshot?.dailyUsage || []);
  const keyStatus = deriveEnterpriseKeyStatus({ keyInfo: snapshot?.keyInfo || null });

  return {
    tier: 'pollinations',
    usedCount: usageSummary.today.requests,
    monthlyLimit: -1,
    bonusCredits: 0,
    remaining: snapshot?.balance ?? 0,
    periodStart: snapshot?.lastSyncedAt ?? null,
    rechargeHistory: [],
    balance: snapshot?.balance ?? 0,
    currency: snapshot?.currency || 'USD',
    dailyUsageSummary: usageSummary,
    keyStatus,
    allowedModels: snapshot?.keyInfo?.allowedModels || [],
    lastSyncedAt: snapshot?.lastSyncedAt || null,
    syncError: snapshot?.syncError || '',
    keyInfo: snapshot?.keyInfo || null,
  };
}

export async function GET(req: Request) {
  try {
    await dbConnect();

    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      const enterpriseId = context.enterpriseId ?? undefined;
      let snapshot = enterpriseId
        ? await EnterpriseAiUsageSnapshot.findOne({ enterpriseId }).lean()
        : null;

      if (enterpriseId && !snapshot) {
        try {
          const synced = await syncEnterprisePollinationsSnapshot(String(enterpriseId));
          snapshot = synced.toObject();
        } catch (error) {
          await markEnterpriseAiSyncError(String(enterpriseId), error);
          snapshot = await EnterpriseAiUsageSnapshot.findOne({ enterpriseId }).lean();
        }
      }

      return NextResponse.json({
        success: true,
        data: buildQuotaResponse(snapshot),
      });
    });
  } catch (error) {
    console.error('[AI Quota GET]', error);
    return NextResponse.json({ success: false, error: '服务端错误' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await dbConnect();

    return await withTenantRoute(
      req,
      { roles: ['enterprise_admin', 'super_admin', 'admin'], requireEnterprise: true },
      async (context) => {
        const body = (await req.json()) as QuotaActionBody;
        if (body.action !== 'sync') {
          return NextResponse.json(
            {
              success: false,
              error:
                'AI 点数已改为 Pollinations 官方余额视图，当前不支持本地充值或升级。',
            },
            { status: 400 }
          );
        }

        const snapshot = await syncEnterprisePollinationsSnapshot(String(context.enterpriseId));
        return NextResponse.json({
          success: true,
          data: buildQuotaResponse(snapshot.toObject()),
        });
      }
    );
  } catch (error) {
    console.error('[AI Quota POST]', error);
    return NextResponse.json({ success: false, error: '服务端错误' }, { status: 500 });
  }
}
