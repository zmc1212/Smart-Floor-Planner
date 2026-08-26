import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiCreationRepository, CustomerProjectRepository, LeadRepository } from '@/db/repositories';
import type { PostgresTransaction } from '@/db/transaction';
import { withTenantTransaction } from '@/db/transaction';
import { detectAiImageMimeType } from '@/lib/ai/image-validation';
import { getPostgresAssetIdFromImageUrl, readPostgresMediaAssetBuffer } from '@/lib/ai/postgres-media-assets';
import { getTenantContext } from '@/lib/auth';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withAdminPostgresTransaction, withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export const runtime = 'nodejs';

const MAX_RESULT_IMAGE_BYTES = 20 * 1024 * 1024;

function outputImageUrl(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const imageUrl = (value as Record<string, unknown>).imageUrl;
  return typeof imageUrl === 'string' ? imageUrl.trim() : '';
}

function canViewPublishedScheme(role: string, assignedTo: bigint | null, staffId: bigint) {
  return role === 'enterprise_admin' || (role === 'designer' && assignedTo === staffId);
}

type StaffActor = {
  role: string;
  enterpriseId: bigint;
  staffId: bigint;
  run: <T>(callback: (transaction: PostgresTransaction) => Promise<T>) => Promise<T>;
};

async function resolveStaffActor(request: Request): Promise<StaffActor | null> {
  const miniContext = await resolveMiniProgramContext(request);
  if (miniContext) {
    if (
      !miniContext.enterpriseId
      || miniContext.mode !== 'staff'
      || !miniContext.staff
      || !['designer', 'enterprise_admin'].includes(miniContext.staff.role)
    ) {
      return null;
    }
    return {
      role: miniContext.staff.role,
      enterpriseId: parsePostgresId(miniContext.enterpriseId, 'enterprise id'),
      staffId: parsePostgresId(miniContext.staff._id, 'staff id'),
      run: (callback) => withMiniProgramPostgresTransaction(miniContext, callback),
    };
  }

  const admin = await getTenantContext(request);
  if (!admin?.enterpriseId || !['designer', 'enterprise_admin'].includes(admin.role)) return null;
  return {
    role: admin.role,
    enterpriseId: parsePostgresId(admin.enterpriseId, 'enterprise id'),
    staffId: parsePostgresId(admin.userId, 'user id'),
    run: (callback) => withAdminPostgresTransaction(admin, callback),
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; generationId: string }> }
) {
  try {
    const actor = await resolveStaffActor(request);
    if (!actor) {
      return NextResponse.json({ success: false, error: '仅负责家装设计顾问或企业负责人可查看已发布方案' }, { status: 403 });
    }

    const { id: leadIdText, generationId: generationIdText } = await params;
    const leadId = parsePostgresId(leadIdText, 'lead id');
    const generationId = parsePostgresId(generationIdText, 'generation id');

    const publication = await actor.run(async (transaction) => {
      const lead = await new LeadRepository(transaction).findById(leadId);
      if (!lead || !canViewPublishedScheme(actor.role, lead.assignedTo, actor.staffId)) return null;
      const publications = await new CustomerProjectRepository(transaction).listActivePublications(
        actor.enterpriseId,
        leadId
      );
      return publications.find((item) => item.generation.id === generationId) ?? null;
    });

    if (!publication) {
      return NextResponse.json({ success: false, error: '已发布方案不存在或无权访问' }, { status: 404 });
    }

    const imageUrl = outputImageUrl(publication.generation.output);
    if (!imageUrl) {
      return NextResponse.json({ success: false, error: '已发布方案图片不存在' }, { status: 404 });
    }

    const assetId = getPostgresAssetIdFromImageUrl(imageUrl);
    if (assetId) {
      const asset = await withTenantTransaction(publication.generation.enterpriseId, (transaction) =>
        new AiCreationRepository(transaction).findMediaAsset(assetId)
      );
      if (!asset) {
        return NextResponse.json({ success: false, error: '已发布方案图片不存在' }, { status: 404 });
      }
      const buffer = await readPostgresMediaAssetBuffer(asset);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': asset.mimeType,
          'Content-Length': String(buffer.length),
          'Cache-Control': 'private, no-store',
        },
      });
    }

    if (!/^https?:\/\//i.test(imageUrl)) {
      return NextResponse.json({ success: false, error: '已发布方案图片无效' }, { status: 404 });
    }

    const upstream = await fetch(imageUrl, {
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    if (!upstream.ok) {
      return NextResponse.json({ success: false, error: '上游图片暂时不可用' }, { status: 502 });
    }
    const declaredSize = Number(upstream.headers.get('content-length') || 0);
    if (declaredSize > MAX_RESULT_IMAGE_BYTES) {
      return NextResponse.json({ success: false, error: '图片大小超出限制' }, { status: 413 });
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_RESULT_IMAGE_BYTES) {
      return NextResponse.json({ success: false, error: '图片大小超出限制' }, { status: 413 });
    }
    const mimeType = detectAiImageMimeType(buffer);
    if (!mimeType) {
      return NextResponse.json({ success: false, error: '图片格式不受支持' }, { status: 415 });
    }
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('[Lead Published Design Image]', error);
    return NextResponse.json({ success: false, error: '读取已发布方案图片失败' }, { status: 500 });
  }
}
