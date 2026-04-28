import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import dbConnect from '@/lib/mongodb';
import { Enterprise } from '@/models/Enterprise';
import { AdminUser, DEFAULT_PERMISSIONS } from '@/models/AdminUser';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await dbConnect();

    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin'] },
      async () => {
        const enterprises = await Enterprise.find().sort({ createdAt: -1 });
        return NextResponse.json({ success: true, data: enterprises });
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await dbConnect();

    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin'] },
      async () => {
        const body = (await request.json()) as Record<string, unknown>;
        const enterprise = await Enterprise.create({
          ...body,
          registrationMode: 'manual',
        });

        if (enterprise.contactPerson?.phone) {
          const passwordHash = await bcrypt.hash('Admin123456', 10);
          const existingUser = await AdminUser.findOne({ username: enterprise.contactPerson.phone });
          if (!existingUser) {
            await AdminUser.create({
              username: enterprise.contactPerson.phone,
              passwordHash,
              displayName: enterprise.contactPerson.name,
              role: 'enterprise_admin',
              enterpriseId: enterprise._id,
              phone: enterprise.contactPerson.phone,
              menuPermissions: DEFAULT_PERMISSIONS.enterprise_admin,
              status: 'active',
            });
          }
        }

        return NextResponse.json({ success: true, data: enterprise });
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
