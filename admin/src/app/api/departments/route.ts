import { NextResponse } from 'next/server';
import {
  departmentToDto,
  parseOptionalPostgresId,
} from '@/db/postgres-dto';
import { DepartmentRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import {
  resolveWritableEnterpriseId,
  withTenantRoute,
} from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

interface DepartmentCreateBody {
  name?: string;
  parentId?: string | null;
  order?: number;
  enterpriseId?: string;
}

export async function GET(request: Request) {
  try {
    return await withTenantRoute(
      request,
      {
        roles: [
          'super_admin',
          'admin',
          'enterprise_admin',
          'designer',
          'salesperson',
        ],
        requireEnterprise: true,
      },
      async (context) => {
        const rows = await withTenantTransaction(
          context.enterpriseId!,
          (transaction) => new DepartmentRepository(transaction).listAll()
        );
        return NextResponse.json({
          success: true,
          data: rows.map(departmentToDto),
        });
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    return await withTenantRoute(
      request,
      {
        roles: ['enterprise_admin', 'super_admin', 'admin'],
        requireEnterprise: true,
      },
      async (context) => {
        const body = (await request.json()) as DepartmentCreateBody;
        const name = body.name?.trim();
        if (!name) {
          return NextResponse.json(
            { success: false, error: '请填写部门名称' },
            { status: 400 }
          );
        }

        const targetEnterpriseId = resolveWritableEnterpriseId(
          context,
          body.enterpriseId
        );
        if (!targetEnterpriseId) {
          return NextResponse.json(
            { success: false, error: '无法确定关联企业' },
            { status: 400 }
          );
        }

        const department = await withTenantTransaction(
          targetEnterpriseId,
          async (transaction) => {
            const repository = new DepartmentRepository(transaction);
            const parentId = parseOptionalPostgresId(
              body.parentId,
              'parentId'
            );
            if (parentId && !(await repository.findById(parentId))) {
              throw new Error('Parent department not found in this enterprise');
            }
            return repository.create({
              name,
              enterpriseId: BigInt(targetEnterpriseId),
              parentId,
              order: body.order || 0,
            });
          }
        );

        return NextResponse.json(
          { success: true, data: departmentToDto(department) },
          { status: 201 }
        );
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
