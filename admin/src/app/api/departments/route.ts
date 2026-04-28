import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { Department } from '@/models/Department';
import { resolveWritableEnterpriseId, withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

interface DepartmentCreateBody {
  name?: string;
  parentId?: string | null;
  order?: number;
  enterpriseId?: string;
}

export async function GET(request: Request) {
  try {
    await dbConnect();

    return await withTenantRoute(
      request,
      {
        roles: ['super_admin', 'admin', 'enterprise_admin', 'designer', 'salesperson'],
        requireEnterprise: true,
      },
      async () => {
        const departments = await Department.find({}).sort({ order: 1, createdAt: 1 });
        return NextResponse.json({ success: true, data: departments });
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
      { roles: ['enterprise_admin', 'super_admin', 'admin'], requireEnterprise: true },
      async (context) => {
        const body = (await request.json()) as DepartmentCreateBody;
        const { name, parentId, order } = body;

        if (!name) {
          return NextResponse.json({ success: false, error: '请填写部门名称' }, { status: 400 });
        }

        const targetEnterpriseId = resolveWritableEnterpriseId(context, body.enterpriseId);
        if (!targetEnterpriseId) {
          return NextResponse.json({ success: false, error: '无法确定关联企业' }, { status: 400 });
        }

        const department = await Department.create({
          name,
          enterpriseId: targetEnterpriseId,
          parentId: parentId || null,
          order: order || 0,
        });

        return NextResponse.json({ success: true, data: department }, { status: 201 });
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
