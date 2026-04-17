import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { Enterprise } from '@/models/Enterprise';
import { getTenantContext } from '@/lib/auth';

export const dynamic = 'force-dynamic';

import { AdminUser, DEFAULT_PERMISSIONS } from '@/models/AdminUser';
import bcrypt from 'bcryptjs';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: enterpriseId } = await params;
    console.log(`[API] Patching enterprise: ${enterpriseId}`);

    await dbConnect();
    const context = await getTenantContext(request);

    if (!context || (context.role !== 'super_admin' && context.role !== 'admin')) {
      return NextResponse.json({ success: false, error: '权限不足' }, { status: 403 });
    }

    const body = await request.json();
    const { name, code, contactPerson, status } = body;
    
    const updateData: any = {};
    if (name) updateData.name = name;
    if (code) updateData.code = code;
    if (contactPerson) updateData.contactPerson = contactPerson;
    if (status) updateData.status = status;

    console.log(`[API] Updating with data:`, updateData);

    const enterprise = await Enterprise.findByIdAndUpdate(
      enterpriseId,
      updateData,
      { new: true }
    );

    if (!enterprise) {
      console.error(`[API] Enterprise not found: ${enterpriseId}`);
      return NextResponse.json({ success: false, error: '企业不存在' }, { status: 404 });
    }

    // If approved, ensure admin account exists
    if (status === 'active' && enterprise.contactPerson?.phone) {
      console.log(`[API] Enterprise approved. Checking admin account for ${enterprise.contactPerson.phone}`);
      const existingUser = await AdminUser.findOne({ username: enterprise.contactPerson.phone });
      if (!existingUser) {
        console.log(`[API] Creating new AdminUser for ${enterprise.contactPerson.phone}`);
        const passwordHash = await bcrypt.hash('Admin123456', 10);
        await AdminUser.create({
          username: enterprise.contactPerson.phone,
          passwordHash,
          displayName: enterprise.contactPerson.name,
          role: 'enterprise_admin',
          enterpriseId: enterprise._id,
          phone: enterprise.contactPerson.phone,
          menuPermissions: DEFAULT_PERMISSIONS['enterprise_admin'],
          status: 'active'
        });
      } else {
        console.log(`[API] AdminUser already exists.`);
      }
    }

    return NextResponse.json({ success: true, data: enterprise });
  } catch (error: any) {
    console.error(`[API] PATCH error:`, error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    console.log(`[API] Deleting enterprise: ${id}`);

    await dbConnect();
    const context = await getTenantContext(request);

    if (!context || (context.role !== 'super_admin' && context.role !== 'admin')) {
      return NextResponse.json({ success: false, error: '权限不足' }, { status: 403 });
    }

    await Enterprise.findByIdAndDelete(id);
    return NextResponse.json({ success: true, message: '企业已删除' });
  } catch (error: any) {
    console.error(`[API] DELETE error:`, error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
