import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { Department } from '@/models/Department';
import { AdminUser } from '@/models/AdminUser';
import { withTenantRoute } from '@/lib/tenant-route';

interface DepartmentUpdateBody {
  name?: string;
  parentId?: string | null;
  order?: number;
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();

    return await withTenantRoute(
      request,
      { roles: ['enterprise_admin', 'super_admin', 'admin'], requireEnterprise: true },
      async () => {
        const { id } = await params;
        const body = (await request.json()) as DepartmentUpdateBody;
        const { name, parentId, order } = body;

        const department = await Department.findById(id);
        if (!department) {
          return NextResponse.json({ success: false, error: '部门不存在' }, { status: 404 });
        }

        if (name !== undefined) department.name = name;
        if (parentId !== undefined) {
          (department as any).parentId = parentId ? new mongoose.Types.ObjectId(parentId) : null;
        }
        if (order !== undefined) department.order = order;

        await department.save();
        return NextResponse.json({ success: true, data: department });
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
      { roles: ['enterprise_admin', 'super_admin', 'admin'], requireEnterprise: true },
      async () => {
        const { id } = await params;
        const department = await Department.findById(id);
        if (!department) {
          return NextResponse.json({ success: false, error: '部门不存在' }, { status: 404 });
        }

        const children = await Department.countDocuments({ parentId: id });
        if (children > 0) {
          return NextResponse.json({ success: false, error: '请先删除下级部门' }, { status: 400 });
        }

        const staffCount = await AdminUser.countDocuments({ departmentId: id });
        if (staffCount > 0) {
          return NextResponse.json({ success: false, error: '该部门下还有员工，无法删除' }, { status: 400 });
        }

        await Department.findByIdAndDelete(id);
        return NextResponse.json({ success: true });
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
