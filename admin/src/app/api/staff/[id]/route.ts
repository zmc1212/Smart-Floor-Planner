import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { AdminUser } from '@/models/AdminUser';
import { withTenantRoute } from '@/lib/tenant-route';

interface StaffUpdateBody {
  username?: string;
  password?: string;
  displayName?: string;
  role?: string;
  phone?: string;
  status?: string;
  promoterIds?: string[];
  wecomUserId?: string;
  departmentId?: string | null;
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();

    return await withTenantRoute(
      request,
      { roles: ['enterprise_admin', 'super_admin', 'admin'], requireEnterprise: true },
      async (context) => {
        const { id } = await params;
        const body = (await request.json()) as StaffUpdateBody;
        const { username, password, displayName, role, phone, status, promoterIds, wecomUserId, departmentId } = body;

        const staff = await AdminUser.findById(id);
        if (!staff) {
          return NextResponse.json({ success: false, error: 'Staff not found' }, { status: 404 });
        }

        if (username && username.trim() !== staff.username) {
          const existing = await AdminUser.findOne({
            username: username.trim(),
            _id: { $ne: id },
          });
          if (existing) {
            return NextResponse.json({ success: false, error: 'Username already exists' }, { status: 400 });
          }
        }

        const businessRoles = ['enterprise_admin', 'designer', 'salesperson', 'measurer'];
        if (role && !businessRoles.includes(role)) {
          return NextResponse.json({ success: false, error: 'Unsupported staff role' }, { status: 403 });
        }

        if (context.role === 'enterprise_admin' && role && !['designer', 'salesperson', 'measurer'].includes(role)) {
          return NextResponse.json({ success: false, error: 'Forbidden role' }, { status: 403 });
        }

        const updateData: Record<string, unknown> = {};
        if (username !== undefined) updateData.username = username.trim();
        if (displayName !== undefined) updateData.displayName = displayName.trim();
        if (role !== undefined) updateData.role = role;
        if (phone !== undefined) updateData.phone = phone.trim();
        if (status !== undefined) updateData.status = status;
        if (promoterIds !== undefined) updateData.promoterIds = promoterIds;
        if (wecomUserId !== undefined) updateData.wecomUserId = wecomUserId;
        if (departmentId !== undefined) {
          updateData.departmentId =
            departmentId && departmentId !== 'none' && mongoose.Types.ObjectId.isValid(departmentId)
              ? new mongoose.Types.ObjectId(departmentId)
              : null;
        }

        if (password && password.trim().length >= 6) {
          updateData.passwordHash = await bcrypt.hash(password, 10);
        }

        const updated = await AdminUser.findByIdAndUpdate(id, { $set: updateData }, { new: true }).select('-passwordHash');
        return NextResponse.json({ success: true, data: updated });
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();

    return await withTenantRoute(
      request,
      { roles: ['enterprise_admin', 'super_admin', 'admin'], requireEnterprise: true },
      async (context) => {
        const { id } = await params;
        const staff = await AdminUser.findById(id);
        if (!staff) {
          return NextResponse.json({ success: false, error: 'Staff not found' }, { status: 404 });
        }

        if (staff._id.toString() === context.userId) {
          return NextResponse.json({ success: false, error: 'Cannot delete yourself' }, { status: 400 });
        }

        await AdminUser.findByIdAndDelete(id);
        return NextResponse.json({ success: true, message: 'Deleted successfully' });
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
