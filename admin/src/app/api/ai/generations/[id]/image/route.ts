import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiCreationRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    return await withTenantRoute(req, { requireEnterprise: true }, async (context) => {
      const { id } = await params;
      if (!/^[1-9]\d*$/.test(id)) {
        return NextResponse.json({ success: false, error: 'Generation image not found' }, { status: 404 });
      }
      const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterpriseId');
      const generation = await withTenantTransaction(enterpriseId, (transaction) =>
        new AiCreationRepository(transaction).findGeneration(parsePostgresId(id, 'generationId'))
      );
      const assetId = generation?.output && typeof generation.output === 'object'
        ? String((generation.output as Record<string, unknown>).imageUrl || '').match(/^\/api\/ai\/assets\/([1-9]\d*)\/image/i)?.[1]
        : undefined;
      if (!assetId) {
        return NextResponse.json({ success: false, error: 'Generation image not found' }, { status: 404 });
      }
      return NextResponse.redirect(new URL(`/api/ai/assets/${assetId}/image`, req.url));
    });
  } catch (error) {
    console.error('[AI Generation Image GET]', error);
    return NextResponse.json({ success: false, error: 'Failed to load generation image' }, { status: 500 });
  }
}
