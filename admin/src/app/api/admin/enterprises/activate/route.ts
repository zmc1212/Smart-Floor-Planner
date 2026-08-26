import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import {
  AdminUserRepository,
  CommercialRepository,
  EnterpriseRepository,
  PromotionRecordRepository,
} from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { DEFAULT_PERMISSIONS } from '@/lib/admin-user-roles';
import {
  ENTERPRISE_ADMIN_INITIAL_PASSWORD,
  buildEnterpriseAdminUsername,
  hashEnterpriseAdminInitialPassword,
} from '@/lib/enterprise-admin-provision';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

interface ActivationBody {
  recordId?: string;
  orderId?: string;
}

/**
 * Activates a PostgreSQL promotion record as an enterprise account.
 * POST /api/admin/enterprises/activate
 */
export async function POST(request: Request) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin'] },
      async () => {
        const body = (await request.json()) as ActivationBody;
        if (!body.recordId) {
          return NextResponse.json(
            { success: false, error: 'Missing recordId' },
            { status: 400 }
          );
        }
        let recordId: bigint;
        let orderId: bigint | undefined;
        try {
          recordId = parsePostgresId(body.recordId, 'recordId');
          orderId = body.orderId
            ? parsePostgresId(body.orderId, 'orderId')
            : undefined;
        } catch (error: unknown) {
          return NextResponse.json(
            {
              success: false,
              error: error instanceof Error ? error.message : 'Invalid activation ID',
            },
            { status: 400 }
          );
        }

        const result = await withPlatformTransaction(async (transaction) => {
          const promotionRecords = new PromotionRecordRepository(transaction);
          const commercial = new CommercialRepository(transaction);
          const enterprises = new EnterpriseRepository(transaction);
          const adminUsers = new AdminUserRepository(transaction);
          const record = await promotionRecords.findById(recordId);
          if (!record) {
            throw Object.assign(new Error('Promotion record not found'), {
              code: 'PROMOTION_RECORD_NOT_FOUND',
            });
          }
          if (record.enterpriseId) {
            throw Object.assign(new Error('Enterprise already activated'), {
              code: 'ENTERPRISE_ALREADY_ACTIVATED',
            });
          }

          if (orderId) {
            const order = await commercial.findOrderById(orderId);
            if (!order || order.recordId !== record.id || order.enterpriseId) {
              throw Object.assign(
                new Error('Order does not belong to the promotion record'),
                { code: 'ORDER_RECORD_MISMATCH' }
              );
            }
          }

          const phone = record.phone.trim();
          if (!phone) {
            throw Object.assign(new Error('Promotion record phone is required'), {
              code: 'PROMOTION_PHONE_REQUIRED',
            });
          }
          if (await adminUsers.findByUsernameOrPhone(phone)) {
            throw Object.assign(
              new Error(`手机号 ${phone} 已被其他系统账号使用`),
              { code: 'ACCOUNT_CONFLICT' }
            );
          }

          const enterprise = await enterprises.create({
            name: record.enterpriseName,
            code: record.creditCode || `ENT-${record.id.toString()}`,
            status: 'active',
            registrationMode: 'manual',
            contactPerson: { name: record.contactPerson, phone },
            address: record.address,
            industry: record.industry,
          });
          await adminUsers.create({
            username: buildEnterpriseAdminUsername(phone, enterprise.id),
            passwordHash: await hashEnterpriseAdminInitialPassword(),
            mustChangePassword: true,
            displayName: record.contactPerson,
            role: 'enterprise_admin',
            enterpriseId: enterprise.id,
            phone,
            menuPermissions: DEFAULT_PERMISSIONS.enterprise_admin,
            status: 'active',
          });
          if (!(await commercial.activateRecord(record.id, enterprise.id, orderId))) {
            throw Object.assign(new Error('Enterprise already activated'), {
              code: 'ENTERPRISE_ALREADY_ACTIVATED',
            });
          }
          return {
            enterprise,
            username: buildEnterpriseAdminUsername(phone, enterprise.id),
          };
        });

        return NextResponse.json({
          success: true,
          data: {
            enterpriseId: result.enterprise.id.toString(),
            enterpriseName: result.enterprise.name,
            adminUsername: result.username,
            tempPassword: ENTERPRISE_ADMIN_INITIAL_PASSWORD,
          },
        });
      }
    );
  } catch (error: unknown) {
    const details = error as { code?: string };
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = details.code === 'PROMOTION_RECORD_NOT_FOUND'
      ? 404
      : [
      'ENTERPRISE_ALREADY_ACTIVATED',
      'ORDER_RECORD_MISMATCH',
      'PROMOTION_PHONE_REQUIRED',
      'ACCOUNT_CONFLICT',
      '23505',
    ].includes(details.code || '')
        ? 400
        : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
