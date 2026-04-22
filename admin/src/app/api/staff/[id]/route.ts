import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { AdminUser } from '@/models/AdminUser';
import { getTenantContext } from '@/lib/auth';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const context = await getTenantContext(request);
    const { id } = await params;

    if (!context || (context.role !== 'enterprise_admin' && context.role !== 'super_admin' && context.role !== 'admin')) {
      return NextResponse.json({ success: false, error: '权限不足' }, { status: 403 });
    }

    const body = await request.json();
    const { username, password, displayName, role, phone, status, promoterIds, wecomUserId, departmentId } = body;

    const staff = await AdminUser.findById(id);
    if (!staff) {
      return NextResponse.json({ success: false, error: '员工不存在' }, { status: 404 });
    }

    // Check if new username is already taken
    if (username && username.trim() !== staff.username) {
      const existing = await AdminUser.findOne({ 
        username: username.trim(),
        _id: { $ne: id }
      });
      if (existing) {
        return NextResponse.json({ success: false, error: '该账号名称已被占用' }, { status: 400 });
      }
    }

    // Tenant Isolation
    if (context.role === 'enterprise_admin' && staff.enterpriseId?.toString() !== context.enterpriseId) {
      return NextResponse.json({ success: false, error: '无权操作此账号' }, { status: 403 });
    }

    // Role check: Ensure only business roles can be set via this API
    const businessRoles = ['enterprise_admin', 'designer', 'salesperson'];
    if (role && !businessRoles.includes(role)) {
       return NextResponse.json({ success: false, error: '此接口仅允许分配业务员工角色' }, { status: 403 });
    }

    // Role check: Enterprise admin can't elevate roles
    if (context.role === 'enterprise_admin' && role && !['designer', 'salesperson'].includes(role)) {
       return NextResponse.json({ success: false, error: '无权设置此角色' }, { status: 403 });
    }

    // Prepare update data
    const updateData: any = {};
    if (username !== undefined) updateData.username = username.trim();
    if (displayName !== undefined) updateData.displayName = displayName.trim();
    if (role !== undefined) updateData.role = role;
    if (phone !== undefined) updateData.phone = phone.trim();
    if (status !== undefined) updateData.status = status;
    if (promoterIds !== undefined) updateData.promoterIds = promoterIds;
    if (wecomUserId !== undefined) updateData.wecomUserId = wecomUserId;
    if (departmentId !== undefined) {
      if (departmentId && departmentId !== 'none' && mongoose.Types.ObjectId.isValid(departmentId)) {
        updateData.departmentId = new mongoose.Types.ObjectId(departmentId);
      } else {
        updateData.departmentId = null;
      }
    }
    
    if (password && password.trim().length >= 6) {
      updateData.passwordHash = await bcrypt.hash(password, 10);
    }

    const updated = await AdminUser.findByIdAndUpdate(id, { $set: updateData }, { new: true }).select('-passwordHash');

    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const context = await getTenantContext(request);
    const { id } = await params;

    if (!context || (context.role !== 'enterprise_admin' && context.role !== 'super_admin' && context.role !== 'admin')) {
      return NextResponse.json({ success: false, error: '权限不足' }, { status: 403 });
    }

    const staff = await AdminUser.findById(id);
    if (!staff) {
      return NextResponse.json({ success: false, error: '员工不存在' }, { status: 404 });
    }

    // Tenant Isolation
    if (context.role === 'enterprise_admin' && staff.enterpriseId?.toString() !== context.enterpriseId) {
      return NextResponse.json({ success: false, error: '无权操作此账号' }, { status: 403 });
    }

    // Prevent self-deletion
    if (staff._id.toString() === context.userId) {
      return NextResponse.json({ success: false, error: '不能删除自己' }, { status: 400 });
    }

    await AdminUser.findByIdAndDelete(id);

    return NextResponse.json({ success: true, message: '删除成功' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
