import mongoose from 'mongoose';
import { multiTenantPlugin } from './src/lib/mongoose-tenant-plugin';
import { tenantStorage, TenantStore } from './src/lib/tenant-context';

// 创建一个简单的测试模型
interface ITestDoc {
  name: string;
  enterpriseId?: string;
  staffId?: string;
}

const TestSchema = new mongoose.Schema<ITestDoc>({
  name: String,
  enterpriseId: String,
  staffId: String
});

// 应用插件
TestSchema.plugin(multiTenantPlugin, {
  enableRoleBasedFiltering: true,
  roleFilterFields: {
    designer: 'staffId',
    salesperson: 'staffId'
  }
});

const TestModel = mongoose.model<ITestDoc>('TestDoc', TestSchema);

async function simpleTest() {
  console.log('🧪 简单测试开始...');

  // 模拟租户上下文
  const mockContext: TenantStore = {
    enterpriseId: 'test-enterprise-123',
    role: 'enterprise_admin',
    userId: 'test-user-456'
  };

  // 在上下文中执行查询
  await tenantStorage.run(mockContext, async () => {
    console.log('📋 在租户上下文中执行查询...');

    // 创建查询对象
    const query = TestModel.find({});

    // 查看过滤条件
    console.log('🔍 查询过滤条件:', query.getFilter());

    // 手动触发pre钩子进行测试
    console.log('✅ 测试完成');
  });
}

// 运行测试
simpleTest().catch(console.error);