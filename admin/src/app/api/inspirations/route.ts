import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import {
  InspirationRepository,
  type InspirationRecord,
} from '@/db/repositories';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';
import { withTenantRoute } from '@/lib/tenant-route';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Internal server error';
}

function serializeInspiration(inspiration: InspirationRecord) {
  return {
    _id: inspiration.id.toString(),
    title: inspiration.title,
    coverImage: inspiration.coverImage,
    renderingImage: inspiration.renderingImage,
    style: inspiration.style,
    roomType: inspiration.roomType,
    layoutData: inspiration.layoutData,
    isRecommended: inspiration.isRecommended,
    viewCount: Number(inspiration.viewCount),
    createdAt: inspiration.createdAt.toISOString(),
    updatedAt: inspiration.updatedAt.toISOString(),
  };
}

export async function GET(request: Request) {
  try {
    return await withTenantRoute(request, { requireEnterprise: true }, async (context) => {
      const { searchParams } = new URL(request.url);
      const limit = Math.min(parseInt(searchParams.get('limit') || '0', 10) || 0, 50);
      const inspirations = await withAdminPostgresTransaction(context, (transaction) =>
        new InspirationRepository(transaction).list({
          style: searchParams.get('style') || undefined,
          roomType: searchParams.get('roomType') || undefined,
          isRecommended: searchParams.get('recommended') === 'true' ? true : undefined,
          limit: limit || undefined,
        })
      );
      return NextResponse.json({ success: true, data: inspirations.map(serializeInspiration) });
    });
  } catch (error: unknown) {
    console.error('Fetch inspirations error:', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    return await withTenantRoute(request, { requireEnterprise: true }, async (context) => {
      const body = await request.json();
      if (!body.title || !body.coverImage || !body.renderingImage || !body.style || !body.roomType || !body.layoutData) {
        return NextResponse.json(
          { success: false, error: 'title, coverImage, renderingImage, style, roomType and layoutData are required' },
          { status: 400 }
        );
      }
      const inspiration = await withAdminPostgresTransaction(context, (transaction) =>
        new InspirationRepository(transaction).create({
          enterpriseId: parsePostgresId(context.enterpriseId!, 'enterpriseId'),
          title: String(body.title),
          coverImage: String(body.coverImage),
          renderingImage: String(body.renderingImage),
          style: String(body.style),
          roomType: String(body.roomType),
          layoutData: body.layoutData as Record<string, unknown>,
          isRecommended: body.isRecommended === true,
          viewCount: Number.isSafeInteger(body.viewCount) && body.viewCount >= 0 ? BigInt(body.viewCount) : BigInt(0),
        })
      );
      return NextResponse.json({ success: true, data: serializeInspiration(inspiration) }, { status: 201 });
    });
  } catch (error: unknown) {
    console.error('Create inspiration error:', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    return await withTenantRoute(request, { requireEnterprise: true }, async (context) => {
      const { searchParams } = new URL(request.url);
      const id = searchParams.get('id');
      if (!id) {
        return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 });
      }
      await withAdminPostgresTransaction(context, (transaction) =>
        new InspirationRepository(transaction).delete(parsePostgresId(id, 'id'))
      );
      return NextResponse.json({ success: true });
    });
  } catch (error: unknown) {
    console.error('Delete inspiration error:', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
