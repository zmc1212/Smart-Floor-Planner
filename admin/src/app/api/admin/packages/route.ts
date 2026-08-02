import { NextResponse } from 'next/server';
import { packageToDto } from '@/db/postgres-dto';
import { PackageRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { getTenantContext } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const PACKAGE_STATUSES = new Set(['active', 'disabled']);

function isPlatformAdmin(role: string) {
  return role === 'admin' || role === 'super_admin';
}

function packageValues(body: Record<string, unknown>) {
  const name = String(body.name ?? '').trim();
  const price = Number(body.price);
  const promotionCommission = Number(body.promotionCommission ?? 0);
  const status = String(body.status ?? 'active');
  const features = Array.isArray(body.features)
    ? body.features.map((item) => String(item).trim()).filter(Boolean)
    : [];

  if (!name) throw new Error('Package name is required');
  if (!Number.isFinite(price) || price < 0) {
    throw new Error('Package price must be a non-negative number');
  }
  if (!Number.isFinite(promotionCommission) || promotionCommission < 0) {
    throw new Error('Promotion commission must be a non-negative number');
  }
  if (!PACKAGE_STATUSES.has(status)) throw new Error('Invalid package status');

  return {
    name,
    price: price.toFixed(2),
    promotionCommission: promotionCommission.toFixed(2),
    description: String(body.description ?? '').trim() || null,
    features,
    status,
  };
}

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

export async function GET(request: Request) {
  try {
    const context = await getTenantContext(request);
    if (!context) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    if (!isPlatformAdmin(context.role)) {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 }
      );
    }

    const status = new URL(request.url).searchParams.get('status');
    if (status && !PACKAGE_STATUSES.has(status)) {
      return NextResponse.json(
        { success: false, error: 'Invalid package status' },
        { status: 400 }
      );
    }
    const items = await withPlatformTransaction((transaction) =>
      new PackageRepository(transaction).list(status)
    );
    return NextResponse.json({ success: true, data: items.map(packageToDto) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await getTenantContext(request);
    if (!context) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    if (!isPlatformAdmin(context.role)) {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 }
      );
    }

    const values = packageValues(await request.json());
    const item = await withPlatformTransaction((transaction) =>
      new PackageRepository(transaction).create(values)
    );
    return NextResponse.json(
      { success: true, data: packageToDto(item) },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
