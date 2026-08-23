import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { CustomerProjectRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import {
  attachPublishedSchemeDisplayUrls,
  buildPublishedSchemeFolioDto,
  buildPublishedSchemeViews,
} from '@/lib/customer-project';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';

export const dynamic = 'force-dynamic';

function publicMiniProgramError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (/failed query|select\s+/i.test(message)) {
    console.error('[published-scheme-folio GET]', error);
    return fallback;
  }
  return message || fallback;
}

export async function GET(request: Request, { params }: { params: Promise<{ leadId: string }> }) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
    const { leadId: leadIdText } = await params;
    const leadId = parsePostgresId(leadIdText, 'lead id');
    const folio = await withPlatformTransaction((transaction) =>
      new CustomerProjectRepository(transaction).findPublishedSchemeFolio(leadId)
    );
    if (!folio?.lead.enterpriseId) {
      return NextResponse.json({ success: false, error: '方案不存在或已撤回' }, { status: 404 });
    }
    const publishedSchemes = await attachPublishedSchemeDisplayUrls(
      request,
      folio.lead.enterpriseId.toString(),
      folio.publications,
      buildPublishedSchemeViews(
        folio.publications,
        leadId.toString(),
        folio.lead.finalizedWorkflowId
      )
    );
    return NextResponse.json({
      success: true,
      data: buildPublishedSchemeFolioDto({
        leadId: leadId.toString(),
        communityName: folio.lead.communityName,
        publishedSchemes,
      }),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: publicMiniProgramError(error, '读取分享方案失败') },
      { status: 400 }
    );
  }
}
