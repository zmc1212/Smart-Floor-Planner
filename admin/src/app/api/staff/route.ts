import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import {
  adminUserToDto,
  parseOptionalPostgresId,
  parsePostgresId,
} from '@/db/postgres-dto';
import {
  AdminUserRepository,
  DepartmentRepository,
} from '@/db/repositories';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { createPaginationMetadata, getPaginationParams } from '@/lib/pagination';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { getEffectivePermissions } from '@/lib/staff-access';
import {
  resolveWritableEnterpriseId,
  withTenantRoute,
} from '@/lib/tenant-route';

interface StaffCreateBody {
  username: string;
  password?: string;
  displayName?: string;
  role: string;
  phone?: string;
  enterpriseId?: string;
  departmentId?: string;
  promoterIds?: string[];
}

const BUSINESS_ROLES = [
  'enterprise_admin',
  'designer',
  'salesperson',
  'measurer',
];

function duplicateResponse(error: unknown) {
  const details = error as { code?: string; constraint?: string };
  if (details.code !== '23505') return null;
  return NextResponse.json(
    {
      success: false,
      error: details.constraint?.includes('phone')
        ? 'Phone already exists'
        : 'Username already exists',
    },
    { status: 400 }
  );
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const { page, limit } = getPaginationParams(request.url);
    const scope = searchParams.get('scope');
    const roles =
      searchParams
        .get('roles')
        ?.split(',')
        .map((item) => item.trim())
        .filter(Boolean) || [];

    if (scope === 'unassigned-promoters') {
      return await withTenantRoute(
        request,
        { roles: ['super_admin', 'admin'] },
        async () => {
          const result = await withPlatformTransaction((transaction) =>
            new AdminUserRepository(transaction).list({
              roles: ['salesperson'],
              status: 'active',
              withoutEnterprise: true,
              page,
              limit,
            })
          );
          return NextResponse.json({
            success: true,
            data: result.rows.map((row) => adminUserToDto(row)),
            pagination: createPaginationMetadata(result.total, page, limit),
          });
        }
      );
    }

    const mpContext = await resolveMiniProgramContext(request);
    if (mpContext?.staff) {
      if (mpContext.staff.role !== 'enterprise_admin') {
        return NextResponse.json(
          { success: false, error: 'Forbidden' },
          { status: 403 }
        );
      }
      const enterpriseId = mpContext.staff.enterpriseId?.toString();
      if (!enterpriseId) {
        return NextResponse.json(
          { success: false, error: 'Enterprise required' },
          { status: 400 }
        );
      }
      const result = await withTenantTransaction(
        enterpriseId,
        (transaction) =>
          new AdminUserRepository(transaction).list({
            roles,
            status: 'active',
            page,
            limit,
          })
      );
      return NextResponse.json({
        success: true,
        data: result.rows.map((row) => adminUserToDto(row)),
        pagination: createPaginationMetadata(result.total, page, limit),
      });
    }

    return await withTenantRoute(
      request,
      {
        roles: ['super_admin', 'admin', 'enterprise_admin'],
        requireEnterprise: true,
      },
      async (context) => {
        const departmentParam = searchParams.get('departmentId');
        const result = await withTenantTransaction(
          context.enterpriseId!,
          (transaction) =>
            new AdminUserRepository(transaction).list({
              roles,
              search: searchParams.get('search') || '',
              departmentId:
                departmentParam &&
                departmentParam !== 'none' &&
                departmentParam !== 'all'
                  ? parsePostgresId(departmentParam, 'departmentId')
                  : undefined,
              withoutDepartment: departmentParam === 'none',
              page,
              limit,
            })
        );
        return NextResponse.json({
          success: true,
          data: result.rows.map((row) =>
            adminUserToDto(row, { populateRelations: true })
          ),
          pagination: createPaginationMetadata(result.total, page, limit),
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
        const body = (await request.json()) as StaffCreateBody;
        const {
          username,
          password,
          displayName,
          role,
          phone,
          promoterIds,
          departmentId,
        } = body;

        if (!username || !password || !role) {
          return NextResponse.json(
            { success: false, error: 'Missing required fields' },
            { status: 400 }
          );
        }
        if (password.length < 6) {
          return NextResponse.json(
            { success: false, error: 'Password must be at least 6 characters' },
            { status: 400 }
          );
        }
        if (!BUSINESS_ROLES.includes(role)) {
          return NextResponse.json(
            { success: false, error: 'Unsupported staff role' },
            { status: 403 }
          );
        }
        if (
          context.role === 'enterprise_admin' &&
          !['designer', 'salesperson', 'measurer'].includes(role)
        ) {
          return NextResponse.json(
            { success: false, error: 'Forbidden role' },
            { status: 403 }
          );
        }

        const targetEnterpriseId = resolveWritableEnterpriseId(
          context,
          body.enterpriseId
        );
        if (!targetEnterpriseId) {
          return NextResponse.json(
            { success: false, error: 'Unable to determine enterprise' },
            { status: 400 }
          );
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const menuPermissions = await getEffectivePermissions(role);
        const staff = await withTenantTransaction(
          targetEnterpriseId,
          async (transaction) => {
            const repository = new AdminUserRepository(transaction);
            if (await repository.existsWithUsername(username.trim())) {
              throw Object.assign(new Error('Username already exists'), {
                code: '23505',
                constraint: 'admin_users_username_uidx',
              });
            }

            const targetDepartmentId = parseOptionalPostgresId(
              departmentId,
              'departmentId'
            );
            if (
              targetDepartmentId &&
              !(await new DepartmentRepository(transaction).findById(
                targetDepartmentId
              ))
            ) {
              throw new Error('Department not found in this enterprise');
            }

            const targetPromoterIds = (promoterIds || []).map((id) =>
              parsePostgresId(id, 'promoterId')
            );
            for (const promoterId of targetPromoterIds) {
              if (!(await repository.findById(promoterId))) {
                throw new Error('Promoter not found in this enterprise');
              }
            }

            return repository.create(
              {
                username: username.trim(),
                passwordHash,
                displayName: displayName?.trim() || '',
                phone: phone?.trim() || null,
                role,
                menuPermissions,
                enterpriseId: BigInt(targetEnterpriseId),
                departmentId: targetDepartmentId,
                status: 'active',
              },
              targetPromoterIds
            );
          }
        );

        return NextResponse.json(
          { success: true, data: adminUserToDto(staff) },
          { status: 201 }
        );
      }
    );
  } catch (error: unknown) {
    const duplicate = duplicateResponse(error);
    if (duplicate) return duplicate;
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
