import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { Department } from '@/models/Department';
import { AdminUser } from '@/models/AdminUser';
import { getTenantContext } from '@/lib/auth';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();
    const context = await getTenantContext(request);

    if (!context || (context.role !== 'enterprise_admin' && context.role !== 'super_admin' && context.role !== 'admin')) {
      return NextResponse.json({ success: false, error: '权限不足' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { name, parentId, order } = body;

    const department = await Department.findById(id);
    if (!department) {
      return NextResponse.json({ success: false, error: '部门不存在' }, { status: 404 });
    }

    // Permission check
    if (context.role === 'enterprise_admin' && department.enterpriseId.toString() !== context.enterpriseId?.toString()) {
      return NextResponse.json({ success: false, error: '无权操作此部门' }, { status: 403 });
    }

    if (name !== undefined) department.name = name;
    if (parentId !== undefined) department.parentId = parentId || null;
    if (order !== undefined) department.order = order;

    await department.save();

    return NextResponse.json({ success: true, data: department });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();
    const context = await getTenantContext(request);

    if (!context || (context.role !== 'enterprise_admin' && context.role !== 'super_admin' && context.role !== 'admin')) {
      return NextResponse.json({ success: false, error: '权限不足' }, { status: 403 });
    }

    const { id } = await params;
    const department = await Department.findById(id);
    if (!department) {
      return NextResponse.json({ success: false, error: '部门不存在' }, { status: 404 });
    }

    // Permission check
    if (context.role === 'enterprise_admin' && department.enterpriseId.toString() !== context.enterpriseId?.toString()) {
      return NextResponse.json({ success: false, error: '无权操作此部门' }, { status: 403 });
    }

    // Check if department has children
    const children = await Department.countDocuments({ parentId: id });
    if (children > 0) {
      return NextResponse.json({ success: false, error: '请先删除下级部门' }, { status: 400 });
    }

    // Check if department has staff
    const staffCount = await AdminUser.countDocuments({ departmentId: id });
    if (staffCount > 0) {
      return NextResponse.json({ success: false, error: '该部门下还有员工，无法删除' }, { status: 400 });
    }

    await Department.findByIdAndDelete(id);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
