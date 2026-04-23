/**
 * 调试租户插件是否正常工作
 */

import mongoose from 'mongoose';
import { tenantStorage, TenantStore } from './src/lib/tenant-context';
import Lead from './src/models/Lead';
import dbConnect from './src/lib/mongodb';

async function testTenantPlugin() {
  try {
    console.log('🧪 开始测试租户插件...');

    await dbConnect();
    console.log('✅ 数据库连接成功');

    // 模拟企业用户的上下文
    const mockStore: TenantStore = {
      enterpriseId: '662f1a2b3c4d5e6f7g8h9i0j', // 模拟的企业ID
      role: 'enterprise_admin',
      userId: '662f1a2b3c4d5e6f7g8h9i1a'
    };

    console.log('📋 测试企业用户上下文:', mockStore);

    // 在租户上下文中执行查询
    await tenantStorage.run(mockStore, async () => {
      console.log('🔍 执行Lead.find({})查询...');

      try {
        // 获取查询对象，但不立即执行
        const query = Lead.find({});

        // 查看插件注入的过滤条件
        const filter = query.getFilter();
        console.log('📊 查询过滤条件:', filter);

        // 执行查询
        const results = await query.limit(5);
        console.log(`✅ 查询结果: 找到 ${results.length} 条记录`);

        // 显示结果的enterpriseId
        results.forEach((lead, index) => {
          console.log(`  记录 ${index + 1}: enterpriseId = ${lead.enterpriseId}`);
        });

      } catch (error) {
        console.error('❌ 查询执行失败:', error);
      }
    });

    // 测试设计师角色
    const designerStore: TenantStore = {
      enterpriseId: '662f1a2b3c4d5e6f7g8h9i0j',
      role: 'designer',
      userId: '662f1a2b3c4d5e6f7g8h9i1b'
    };

    console.log('\n📋 测试设计师角色上下文:', designerStore);

    await tenantStorage.run(designerStore, async () => {
      console.log('🔍 执行设计师查询...');

      const query = Lead.find({});
      const filter = query.getFilter();
      console.log('📊 设计师查询过滤条件:', filter);
    });

    // 测试销售角色
    const salesStore: TenantStore = {
      enterpriseId: '662f1a2b3c4d5e6f7g8h9i0j',
      role: 'salesperson',
      userId: '662f1a2b3c4d5e6f7g8h9i1c'
    };

    console.log('\n📋 测试销售角色上下文:', salesStore);

    await tenantStorage.run(salesStore, async () => {
      console.log('🔍 执行销售查询...');

      const query = Lead.find({});
      const filter = query.getFilter();
      console.log('📊 销售查询过滤条件:', filter);
    });

    console.log('\n🎉 测试完成！');

  } catch (error) {
    console.error('❌ 测试失败:', error);
  }
}

// 运行测试
testTenantPlugin().catch(console.error);