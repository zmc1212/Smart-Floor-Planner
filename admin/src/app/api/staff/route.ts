import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import dbConnect from '@/lib/mongodb';
import { AdminUser } from '@/models/AdminUser';
import { getTenantContext } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// GET /api/staff - List staff within the current user's enterprise
export async function GET(request: Request) {
  try {
    await dbConnect();
    const context = await getTenantContext(request);

    if (!context) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    // Role check: Only admins or enterprise_admins can list staff
    if (context.role !== 'super_admin' && context.role !== 'admin' && context.role !== 'enterprise_admin') {
      return NextResponse.json({ success: false, error: '权限不足' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';

    let filter: any = {};
    
    // Apply Multi-tenant filter
    if (context.role === 'enterprise_admin') {
      filter.enterpriseId = context.enterpriseId;
      // Don't show the enterprise_admin themselves in the staff list? 
      // Usually, we show all, but we can filter out super_admins
      filter.role = { $in: ['designer', 'salesperson', 'enterprise_admin'] };
    } else if (context.role === 'super_admin' || context.role === 'admin') {
      // Super admins can filter by enterpriseId if provided
      const entId = searchParams.get('enterpriseId');
      if (entId) filter.enterpriseId = entId;
    }

    if (search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [{ username: regex }, { displayName: regex }],
      });
    }

    const staff = await AdminUser.find(filter)
      .select('-passwordHash')
      .sort({ createdAt: -1 });

    return NextResponse.json({ success: true, data: staff });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST /api/staff - Create a new staff member (Designer/Sales)
export async function POST(request: Request) {
  try {
    await dbConnect();
    const context = await getTenantContext(request);

    if (!context || (context.role !== 'enterprise_admin' && context.role !== 'super_admin' && context.role !== 'admin')) {
      return NextResponse.json({ success: false, error: '权限不足' }, { status: 403 });
    }

    const body = await request.json();
    const { username, password, displayName, role, phone } = body;

    if (!username || !password || !role) {
      return NextResponse.json({ success: false, error: '请填写完整信息' }, { status: 400 });
    }

    // Enterprise Isolation: staff must belong to the same enterprise as the creator
    // unless the creator is a super_admin
    let targetEnterpriseId: string | undefined = context.enterpriseId || undefined;
    if ((context.role === 'super_admin' || context.role === 'admin') && body.enterpriseId) {
      targetEnterpriseId = body.enterpriseId;
    }

    if (!targetEnterpriseId && context.role !== 'super_admin') {
      return NextResponse.json({ success: false, error: '无法确定关联企业' }, { status: 400 });
    }

    // Role check: Enterprise admin can only create designer or salesperson
    if (context.role === 'enterprise_admin' && !['designer', 'salesperson'].includes(role)) {
       return NextResponse.json({ success: false, error: '无权创建此角色' }, { status: 403 });
    }

    const existing = await AdminUser.findOne({ username: username.trim() });
    if (existing) {
      return NextResponse.json({ success: false, error: '用户名已存在' }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const staff = await AdminUser.create({
      username: username.trim(),
      passwordHash,
      displayName: displayName?.trim() || '',
      phone: phone?.trim() || '',
      role,
      enterpriseId: targetEnterpriseId,
      status: 'active',
    });

    const { passwordHash: _, ...result } = staff.toObject();
    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
