import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import {
  adminUserToDto,
  parseOptionalPostgresId,
  parsePostgresId,
} from '@/db/postgres-dto';
import {
  AdminUserRepository,
  ActionPermissionRepository,
  type AdminUserUpdate,
  AiCreationRepository,
  DepartmentRepository,
} from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';
import { retryPendingLeadAssignmentsForEnterprise } from '@/lib/lead-assignment-retry';

interface StaffUpdateBody {
  username?: string;
  password?: string;
  displayName?: string;
  role?: string;
  phone?: string;
  status?: string;
  promoterIds?: string[];
  departmentId?: string | null;
  wechatId?: string;
  wechatQrAssetId?: string | null;
  assignmentPaused?: boolean;
}

const BUSINESS_ROLES = [
  'enterprise_admin',
  'designer',
  'salesperson',
  'measurer',
];

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
        const staffId = parsePostgresId(id);
        const body = (await request.json()) as StaffUpdateBody;

        if (body.role && !BUSINESS_ROLES.includes(body.role)) {
          return NextResponse.json(
            { success: false, error: 'Unsupported staff role' },
            { status: 403 }
          );
        }
        if (
          context.role === 'enterprise_admin' &&
          body.role &&
          !['designer', 'salesperson', 'measurer'].includes(body.role)
        ) {
          return NextResponse.json(
            { success: false, error: 'Forbidden role' },
            { status: 403 }
          );
        }
        if (body.password && body.password.trim().length < 6) {
          return NextResponse.json(
            { success: false, error: 'Password must be at least 6 characters' },
            { status: 400 }
          );
        }

        const updated = await withTenantTransaction(
          context.enterpriseId!,
          async (transaction) => {
            const repository = new AdminUserRepository(transaction);
            const current = await repository.findById(staffId);
            if (!current) return null;

            const updateData: AdminUserUpdate = {};
            if (body.username !== undefined) {
              const username = body.username.trim();
              if (
                username !== current.username &&
                (await repository.existsWithUsername(username, staffId))
              ) {
                throw Object.assign(new Error('Username already exists'), {
                  code: '23505',
                  constraint: 'admin_users_username_uidx',
                });
              }
              updateData.username = username;
            }
            if (body.displayName !== undefined) {
              updateData.displayName = body.displayName.trim();
            }
            if (body.role !== undefined) updateData.role = body.role;
            if (body.phone !== undefined) {
              const phone = body.phone.trim();
              if (
                phone &&
                phone !== current.phone &&
                (await repository.existsWithPhone(phone, staffId))
              ) {
                throw Object.assign(new Error('Phone already exists'), {
                  code: '23505',
                  constraint: 'admin_users_phone_uidx',
                });
              }
              updateData.phone = phone || null;
            }
            if (body.status !== undefined) updateData.status = body.status;
            if (typeof body.assignmentPaused === 'boolean') {
              updateData.assignmentPaused = body.assignmentPaused;
            }
            if (body.departmentId !== undefined) {
              const departmentId = parseOptionalPostgresId(
                body.departmentId,
                'departmentId'
              );
              if (
                departmentId &&
                !(await new DepartmentRepository(transaction).findById(
                  departmentId
                ))
              ) {
                throw new Error('Department not found in this enterprise');
              }
              updateData.departmentId = departmentId;
            }
            if (body.password) {
              updateData.passwordHash = await bcrypt.hash(body.password, 10);
            }

            const nextRole = body.role || current.role;
            const qrAssetId = body.wechatQrAssetId === undefined
              ? current.wechatQrAssetId
              : parseOptionalPostgresId(body.wechatQrAssetId, 'wechatQrAssetId');
            const nextWechatId = body.wechatId === undefined ? current.wechatId : body.wechatId.trim();
            if (nextRole === 'designer' && (!nextWechatId || !qrAssetId)) {
              throw new Error('设计师必须填写微信号并上传个人二维码');
            }
            if (qrAssetId && qrAssetId !== current.wechatQrAssetId) {
              const asset = await new AiCreationRepository(transaction).findMediaAssetForUpdate(qrAssetId);
              if (!asset || asset.enterpriseId !== current.enterpriseId || asset.ownerType !== 'staff_wechat_qr' || (asset.ownerId !== null && asset.ownerId !== staffId)) {
                throw new Error('微信二维码资源无效或已被使用');
              }
              updateData.wechatQrAssetId = qrAssetId;
              await new AiCreationRepository(transaction).updateMediaAsset(qrAssetId, { ownerId: staffId });
            }
            if (body.wechatId !== undefined || nextRole !== current.role) updateData.wechatId = nextRole === 'designer' ? nextWechatId || null : null;
            if (body.wechatQrAssetId !== undefined || nextRole !== current.role) updateData.wechatQrAssetId = nextRole === 'designer' ? qrAssetId : null;

            const promoterIds = body.promoterIds?.map((promoterId) =>
              parsePostgresId(promoterId, 'promoterId')
            );
            if (promoterIds) {
              for (const promoterId of promoterIds) {
                if (!(await repository.findById(promoterId))) {
                  throw new Error('Promoter not found in this enterprise');
                }
              }
            }
            const result = await repository.update(staffId, updateData, promoterIds);
            if (!result) return null;
            if (body.role && body.role !== current.role) {
              await new ActionPermissionRepository(transaction).deleteUserOverrides(staffId);
            }
            return repository.findById(staffId);
          }
        );

        if (!updated) {
          return NextResponse.json(
            { success: false, error: 'Staff not found' },
            { status: 404 }
          );
        }
        const mayExpandAssignmentPool =
          body.role !== undefined ||
          body.status === 'active' ||
          body.assignmentPaused === false ||
          (updated.role === 'designer' &&
            (body.wechatId !== undefined ||
              body.wechatQrAssetId !== undefined));
        if (
          mayExpandAssignmentPool &&
          updated.enterpriseId &&
          updated.status === 'active' &&
          !updated.assignmentPaused &&
          (updated.role === 'designer' || updated.role === 'measurer')
        ) {
          await retryPendingLeadAssignmentsForEnterprise({
            enterpriseId: updated.enterpriseId,
            reason: 'staff_profile_or_assignment_availability_changed',
          }).catch((error) => {
            console.error('[Staff update assignment retry]', error);
          });
        }
        return NextResponse.json({
          success: true,
          data: adminUserToDto(updated),
        });
      }
    );
  } catch (error: unknown) {
    const details = error as { code?: string; constraint?: string };
    if (details.code === '23505') {
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
        if (id === context.userId) {
          return NextResponse.json(
            { success: false, error: 'Cannot delete yourself' },
            { status: 400 }
          );
        }
        const deleted = await withTenantTransaction(
          context.enterpriseId!,
          async (transaction) => {
            const repository = new AdminUserRepository(transaction);
            return repository.delete(parsePostgresId(id));
          }
        );
        if (!deleted) {
          return NextResponse.json(
            { success: false, error: 'Staff not found' },
            { status: 404 }
          );
        }
        return NextResponse.json({
          success: true,
          message: 'Deleted successfully',
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
