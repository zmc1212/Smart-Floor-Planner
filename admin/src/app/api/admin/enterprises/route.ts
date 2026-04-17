import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { Enterprise } from '@/models/Enterprise';
import { getTenantContext } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// GET /api/admin/enterprises - List all enterprises (Super Admin only)
export async function GET(request: Request) {
  try {
    await dbConnect();
    const context = await getTenantContext(request);

    if (!context || (context.role !== 'super_admin' && context.role !== 'admin')) {
      return NextResponse.json({ success: false, error: '权限不足' }, { status: 403 });
    }

    const enterprises = await Enterprise.find().sort({ createdAt: -1 });
    return NextResponse.json({ success: true, data: enterprises });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

import { AdminUser, DEFAULT_PERMISSIONS } from '@/models/AdminUser';
import bcrypt from 'bcryptjs';

// POST /api/admin/enterprises - Manually create an enterprise
export async function POST(request: Request) {
  try {
    await dbConnect();
    const context = await getTenantContext(request);

    if (!context || (context.role !== 'super_admin' && context.role !== 'admin')) {
      return NextResponse.json({ success: false, error: '权限不足' }, { status: 403 });
    }

    const body = await request.json();
    const enterprise = await Enterprise.create({
      ...body,
      registrationMode: 'manual',
    });

    // Create a default administrator account for this enterprise
    if (enterprise.contactPerson?.phone) {
      const passwordHash = await bcrypt.hash('Admin123456', 10);
      // Check if username already exists to avoid conflict
      const existingUser = await AdminUser.findOne({ username: enterprise.contactPerson.phone });
      if (!existingUser) {
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
      }
    }

    return NextResponse.json({ success: true, data: enterprise });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
