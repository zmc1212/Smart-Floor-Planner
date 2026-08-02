import { NextResponse } from 'next/server';
import { packageToDto, parsePostgresId } from '@/db/postgres-dto';
import { PackageRepository, type PackageUpdate } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { getTenantContext } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const PACKAGE_STATUSES = new Set(['active', 'disabled']);

function errorResponse(error: unknown) {
  const details = error as { code?: string; cause?: { code?: string } };
  const code = details.code ?? details.cause?.code;
  const message = error instanceof Error ? error.message : 'Unknown error';
  return NextResponse.json(
    {
      success: false,
      error: code === '23505' ? 'Package name already exists' : message,
    },
    { status: code === '23505' ? 409 : 400 }
  );
}

function packageUpdate(body: Record<string, unknown>): PackageUpdate {
  const values: PackageUpdate = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) throw new Error('Package name is required');
    values.name = name;
  }
  if (body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) {
      throw new Error('Package price must be a non-negative number');
    }
    values.price = price.toFixed(2);
  }
  if (body.promotionCommission !== undefined) {
    const promotionCommission = Number(body.promotionCommission);
    if (!Number.isFinite(promotionCommission) || promotionCommission < 0) {
      throw new Error('Promotion commission must be a non-negative number');
    }
    values.promotionCommission = promotionCommission.toFixed(2);
  }
  if (body.description !== undefined) {
    values.description = String(body.description).trim() || null;
  }
  if (body.features !== undefined) {
    if (!Array.isArray(body.features)) throw new Error('Features must be an array');
    values.features = body.features
      .map((item) => String(item).trim())
      .filter(Boolean);
  }
  if (body.status !== undefined) {
    const status = String(body.status);
    if (!PACKAGE_STATUSES.has(status)) throw new Error('Invalid package status');
    values.status = status;
  }
  return values;
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await getTenantContext(request);
    if (!context) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    if (!['admin', 'super_admin'].includes(context.role)) {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const values = packageUpdate(await request.json());
    const item = await withPlatformTransaction((transaction) =>
      new PackageRepository(transaction).update(
        parsePostgresId(id, 'package id'),
        values
      )
    );
    if (!item) {
      return NextResponse.json(
        { success: false, error: 'Package not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: packageToDto(item) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await getTenantContext(request);
    if (!context) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    if (!['admin', 'super_admin'].includes(context.role)) {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const item = await withPlatformTransaction((transaction) =>
      new PackageRepository(transaction).delete(
        parsePostgresId(id, 'package id')
      )
    );
    if (!item) {
      return NextResponse.json(
        { success: false, error: 'Package not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, message: 'Deleted' });
  } catch (error) {
    return errorResponse(error);
  }
}
