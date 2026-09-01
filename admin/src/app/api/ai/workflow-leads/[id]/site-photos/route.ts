import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { LeadRepository, LeadSitePhotoRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { LEAD_SITE_PHOTO_SPACE_TAG_LABELS, type LeadSitePhotoSpaceTag } from '@/lib/lead-site-photos';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return await withTenantRoute(request, { requireEnterprise: true }, async (context) => {
      const { id } = await params;
      const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterpriseId');
      const leadId = parsePostgresId(id, 'leadId');
      const result = await withTenantTransaction(enterpriseId, async (transaction) => {
        const lead = await new LeadRepository(transaction).findById(leadId);
        if (!lead || lead.enterpriseId !== enterpriseId || lead.archivedAt) return null;
        const photos = await new LeadSitePhotoRepository(transaction).listActive(leadId);
        return { lead, photos };
      });
      if (!result) {
        return NextResponse.json({ success: false, error: '客户不存在或无权访问' }, { status: 404 });
      }
      return NextResponse.json({
        success: true,
        data: {
          lead: { id: result.lead.id.toString(), name: result.lead.name },
          items: result.photos.map((photo) => {
            const spaceTag = photo.spaceTag as LeadSitePhotoSpaceTag | null;
            return {
              id: photo.id.toString(),
              assetId: photo.assetId.toString(),
              previewUrl: `/api/ai/assets/${photo.assetId.toString()}/image`,
              spaceTag,
              spaceTagLabel: spaceTag ? LEAD_SITE_PHOTO_SPACE_TAG_LABELS[spaceTag] || '其他' : '未分类',
              width: photo.width,
              height: photo.height,
              createdAt: photo.createdAt.toISOString(),
            };
          }),
        },
      });
    });
  } catch (error) {
    console.error('[AI Workflow Lead Site Photos GET]', error);
    const status = (error as { status?: number })?.status || 500;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '读取客户现场图失败' },
      { status },
    );
  }
}
