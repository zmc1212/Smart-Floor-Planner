/**
 * 多租户插件测试脚本
 * 用于验证插件是否正确工作
 */

import mongoose from 'mongoose';
import { multiTenantPlugin } from './src/lib/mongoose-tenant-plugin';
import { tenantStorage, TenantStore } from './src/lib/tenant-context';

// 测试用模型定义
interface ITestModel {
  name: string;
  enterpriseId?: string;
  data: any;
}

const TestSchema = new mongoose.Schema<ITestModel>({
  name: { type: String, required: true },
  enterpriseId: { type: String },
  data: { type: mongoose.Schema.Types.Mixed }
}, {
  timestamps: true
});

// 应用多租户插件
TestSchema.plugin(multiTenantPlugin);

const TestModel = mongoose.model<ITestModel>('TestModel', TestSchema);

// 模拟租户上下文
const mockTenantContext = (enterpriseId: string, role: string, testFn: () => Promise<any>) => {
  return tenantStorage.run(
    { enterpriseId, role, userId: 'test-user' } as TenantStore,
    testFn
  );
};

// 测试函数
async function testMultiTenantPlugin() {
  try {
    console.log('🧪 开始测试多租户插件...');

    // 连接到内存数据库进行测试
    const conn = await mongoose.createConnection('mongodb://localhost:27017/test_tenant', {
      serverSelectionTimeoutMS: 5000
    });

    console.log('✅ 数据库连接成功');

    // 清理测试数据
    await TestModel.deleteMany({});

    // 测试1: 超级管理员应该能看到所有数据
    console.log('\n📋 测试1: 超级管理员权限');
    await mockTenantContext('enterprise1', 'super_admin', async () => {
      await TestModel.create([
        { name: '数据1', enterpriseId: 'enterprise1', data: { value: 1 } },
        { name: '数据2', enterpriseId: 'enterprise2', data: { value: 2 } }
      ]);

      const allData = await TestModel.find({});
      console.log(`超级管理员找到 ${allData.length} 条数据`);
      console.log('数据企业ID:', allData.map(d => d.enterpriseId));
    });

    // 测试2: 普通企业用户只能看到自己的数据
    console.log('\n📋 测试2: 企业用户权限隔离');
    await mockTenantContext('enterprise1', 'enterprise_admin', async () => {
      const myData = await TestModel.find({});
      console.log(`企业1用户找到 ${myData.length} 条数据`);
      console.log('数据企业ID:', myData.map(d => d.enterpriseId));
    });

    // 测试3: 不同企业用户看到不同数据
    console.log('\n📋 测试3: 跨企业数据隔离');
    await mockTenantContext('enterprise2', 'enterprise_admin', async () => {
      const myData = await TestModel.find({});
      console.log(`企业2用户找到 ${myData.length} 条数据`);
      console.log('数据企业ID:', myData.map(d => d.enterpriseId));
    });

    // 测试4: 新建数据自动注入enterpriseId
    console.log('\n📋 测试4: 自动注入enterpriseId');
    await mockTenantContext('enterprise3', 'enterprise_admin', async () => {
      const newDoc = await TestModel.create({
        name: '新数据',
        data: { value: 3 }
        // 注意：没有指定enterpriseId
      });

      console.log('新建文档的enterpriseId:', newDoc.enterpriseId);
      console.log('✅ 自动注入成功' + (newDoc.enterpriseId === 'enterprise3' ? '✅' : '❌'));
    });

    // 测试5: 聚合查询的租户隔离
    console.log('\n📋 测试5: 聚合查询租户隔离');
    await mockTenantContext('enterprise1', 'enterprise_admin', async () => {
      const aggResult = await TestModel.aggregate([
        { $group: { _id: '$enterpriseId', count: { $sum: 1 } } }
      ]);
      console.log('聚合结果:', aggResult);
      // 应该只包含enterprise1的数据
    });

    console.log('\n🎉 所有测试完成！');

    // 清理并关闭连接
    await TestModel.deleteMany({});
    await conn.close();

  } catch (error) {
    console.error('❌ 测试失败:', error);
  }
}

// 如果直接运行此文件，则执行测试
if (require.main === module) {
  testMultiTenantPlugin();
}

export { testMultiTenantPlugin };