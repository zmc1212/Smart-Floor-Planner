import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import dbConnect from '@/lib/mongodb';
import { Enterprise } from '@/models/Enterprise';
import { AdminUser, DEFAULT_PERMISSIONS } from '@/models/AdminUser';
import { PromotionEnterpriseRecord } from '@/models/PromotionEnterpriseRecord';
import { EnterpriseOrder } from '@/models/EnterpriseOrder';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

/**
 * 从报备记录激活企业账号
 * POST /api/admin/enterprises/activate
 * body: { recordId: string, orderId?: string }
 */
export async function POST(request: Request) {
  try {
    await dbConnect();

    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin'] },
      async () => {
        const body = (await request.json()) as { recordId: string; orderId?: string };
        const { recordId, orderId } = body;

        if (!recordId) {
          return NextResponse.json({ success: false, error: 'Missing recordId' }, { status: 400 });
        }

        const record = await PromotionEnterpriseRecord.findById(recordId);
        if (!record) {
          return NextResponse.json({ success: false, error: 'Promotion record not found' }, { status: 404 });
        }

        if (record.enterpriseId) {
          return NextResponse.json({ success: false, error: 'Enterprise already activated' }, { status: 400 });
        }

        // 1. 创建企业
        // 使用报备信息填充企业基础资料
        const enterprise = await Enterprise.create({
          name: record.enterpriseName,
          code: record.creditCode || `ENT-${Date.now()}`, // 如果没有信用代码，生成临时编码
          status: 'active',
          registrationMode: 'manual',
          contactPerson: {
            name: record.contactPerson,
            phone: record.phone,
          },
          address: record.address,
          industry: record.industry,
        });

        // 2. 创建企业管理员账号
        const passwordHash = await bcrypt.hash('Admin123456', 10);
        // 检查用户名冲突
        let username = record.phone;
        const existingUser = await AdminUser.findOne({ username });
        if (existingUser) {
          // 如果手机号已被占用（作为地推员或其他角色），则加上企业后缀
          username = `${record.phone}_${enterprise.code.slice(-4)}`;
        }

        await AdminUser.create({
          username,
          passwordHash,
          displayName: record.contactPerson,
          role: 'enterprise_admin',
          enterpriseId: enterprise._id,
          phone: record.phone,
          menuPermissions: DEFAULT_PERMISSIONS.enterprise_admin,
          status: 'active',
        });

        // 3. 回填 IDs 并更新状态
        record.enterpriseId = enterprise._id as any;
        record.businessStage = 'paid'; // 确保状态同步
        await record.save();

        // 4. 如果有关联订单，也回填 enterpriseId
        if (orderId) {
          await EnterpriseOrder.findByIdAndUpdate(orderId, { $set: { enterpriseId: enterprise._id } });
        } else {
          // 查找该 record 下所有未绑定 enterpriseId 的订单进行回填
          await EnterpriseOrder.updateMany(
            { recordId: record._id, enterpriseId: { $exists: false } },
            { $set: { enterpriseId: enterprise._id } }
          );
        }

        return NextResponse.json({
          success: true,
          data: {
            enterpriseId: enterprise._id,
            enterpriseName: enterprise.name,
            adminUsername: username,
            tempPassword: 'Admin123456',
          },
        });
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
