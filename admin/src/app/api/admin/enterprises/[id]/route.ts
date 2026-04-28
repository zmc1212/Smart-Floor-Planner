import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import dbConnect from '@/lib/mongodb';
import { Enterprise } from '@/models/Enterprise';
import { AdminUser, DEFAULT_PERMISSIONS } from '@/models/AdminUser';
import { withTenantRoute } from '@/lib/tenant-route';

interface EnterprisePatchBody {
  name?: string;
  code?: string;
  contactPerson?: {
    name: string;
    phone: string;
    email?: string;
  };
  status?: string;
  logo?: string;
  branding?: {
    primaryColor?: string;
    accentColor?: string;
  };
}

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();

    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin'] },
      async () => {
        const { id: enterpriseId } = await params;
        const body = (await request.json()) as EnterprisePatchBody;
        const { name, code, contactPerson, status, logo, branding } = body;

        const updateData: Record<string, unknown> = {};
        if (name !== undefined) updateData.name = name;
        if (code !== undefined) updateData.code = code;
        if (contactPerson !== undefined) updateData.contactPerson = contactPerson;
        if (status !== undefined) updateData.status = status;
        if (logo !== undefined) updateData.logo = logo;
        if (branding !== undefined) updateData.branding = branding;

        const enterprise = await Enterprise.findByIdAndUpdate(enterpriseId, updateData, { new: true });
        if (!enterprise) {
          return NextResponse.json({ success: false, error: '企业不存在' }, { status: 404 });
        }

        if (status === 'active' && enterprise.contactPerson?.phone) {
          const existingUser = await AdminUser.findOne({ username: enterprise.contactPerson.phone });
          if (!existingUser) {
            const passwordHash = await bcrypt.hash('Admin123456', 10);
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

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();

    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin'] },
      async () => {
        const { id } = await params;
        await Enterprise.findByIdAndDelete(id);
        return NextResponse.json({ success: true, message: '企业已删除' });
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
