import { NextResponse } from 'next/server';
import {
  departmentToDto,
  parseOptionalPostgresId,
  parsePostgresId,
} from '@/db/postgres-dto';
import {
  AdminUserRepository,
  DepartmentRepository,
} from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
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
    return await withTenantRoute(
      request,
      {
        roles: ['enterprise_admin', 'super_admin', 'admin'],
        requireEnterprise: true,
      },
      async (context) => {
        const { id } = await params;
        const departmentId = parsePostgresId(id);
        const body = (await request.json()) as DepartmentUpdateBody;
        const updated = await withTenantTransaction(
          context.enterpriseId!,
          async (transaction) => {
            const repository = new DepartmentRepository(transaction);
            const current = await repository.findById(departmentId);
            if (!current) return null;

            const updateData: {
              name?: string;
              parentId?: bigint | null;
              order?: number;
            } = {};
            if (body.name !== undefined) updateData.name = body.name.trim();
            if (body.order !== undefined) updateData.order = body.order;
            if (body.parentId !== undefined) {
              const parentId = parseOptionalPostgresId(
                body.parentId,
                'parentId'
              );
              if (parentId === departmentId) {
                throw new Error('A department cannot be its own parent');
              }
              if (parentId && !(await repository.findById(parentId))) {
                throw new Error(
                  'Parent department not found in this enterprise'
                );
              }
              updateData.parentId = parentId;
            }
            return repository.update(departmentId, updateData);
          }
        );
        if (!updated) {
          return NextResponse.json(
            { success: false, error: '部门不存在' },
            { status: 404 }
          );
        }
        return NextResponse.json({
          success: true,
          data: departmentToDto(updated),
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

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    return await withTenantRoute(
      request,
      {
        roles: ['enterprise_admin', 'super_admin', 'admin'],
        requireEnterprise: true,
      },
      async (context) => {
        const { id } = await params;
        const departmentId = parsePostgresId(id);
        const result = await withTenantTransaction(
          context.enterpriseId!,
          async (transaction) => {
            const departments = new DepartmentRepository(transaction);
            const department = await departments.findById(departmentId);
            if (!department) return { status: 'not_found' as const };
            if ((await departments.countChildren(departmentId)) > 0) {
              return { status: 'has_children' as const };
            }
            if (
              (await new AdminUserRepository(transaction).countByDepartment(
                departmentId
              )) > 0
            ) {
              return { status: 'has_staff' as const };
            }
            await departments.delete(departmentId);
            return { status: 'deleted' as const };
          }
        );

        if (result.status === 'not_found') {
          return NextResponse.json(
            { success: false, error: '部门不存在' },
            { status: 404 }
          );
        }
        if (result.status === 'has_children') {
          return NextResponse.json(
            { success: false, error: '请先删除下级部门' },
            { status: 400 }
          );
        }
        if (result.status === 'has_staff') {
          return NextResponse.json(
            { success: false, error: '该部门下还有员工，无法删除' },
            { status: 400 }
          );
        }
        return NextResponse.json({ success: true });
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
