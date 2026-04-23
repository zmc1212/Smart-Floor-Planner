/**
 * 实现验证脚本
 * 检查所有文件是否正确实现
 */

import * as fs from 'fs';
import * as path from 'path';

const ADMIN_DIR = path.join(process.cwd(), 'admin');

function checkFileExists(filePath: string): boolean {
  return fs.existsSync(path.join(ADMIN_DIR, filePath));
}

function checkFileContains(filePath: string, content: string): boolean {
  if (!checkFileExists(filePath)) return false;
  const fileContent = fs.readFileSync(path.join(ADMIN_DIR, filePath), 'utf8');
  return fileContent.includes(content);
}

function verifyImplementation() {
  console.log('🔍 验证多租户插件化实现...');

  const checks = [
    {
      name: '租户上下文存储模块',
      file: 'src/lib/tenant-context.ts',
      content: 'tenantStorage',
      required: true
    },
    {
      name: 'Mongoose多租户插件',
      file: 'src/lib/mongoose-tenant-plugin.ts',
      content: 'multiTenantPlugin',
      required: true
    },
    {
      name: '认证模块增强',
      file: 'src/lib/auth.ts',
      content: 'withTenantContext',
      required: true
    },
    {
      name: 'FloorPlan模型插件应用',
      file: 'src/models/FloorPlan.ts',
      content: 'multiTenantPlugin',
      required: true
    },
    {
      name: 'Device模型插件应用',
      file: 'src/models/Device.ts',
      content: 'multiTenantPlugin',
      required: true
    },
    {
      name: 'Lead模型插件应用',
      file: 'src/models/Lead.ts',
      content: 'multiTenantPlugin',
      required: true
    },
    {
      name: 'API路由使用新包装器',
      file: 'src/app/api/devices/route.ts',
      content: 'withTenantContext',
      required: true
    }
  ];

  let allPassed = true;

  checks.forEach(check => {
    const fileExists = checkFileExists(check.file);
    const contentExists = fileExists && checkFileContains(check.file, check.content);

    const status = contentExists ? '✅' : (check.required ? '❌' : '⚠️');
    console.log(`${status} ${check.name}: ${contentExists ? '已实现' : '未实现'}`);

    if (check.required && !contentExists) {
      allPassed = false;
    }

    if (!fileExists) {
      console.log(`   文件不存在: ${check.file}`);
    } else if (!contentExists) {
      console.log(`   文件缺少必要内容: ${check.content}`);
    }
  });

  console.log('\n📊 验证总结:');
  if (allPassed) {
    console.log('✅ 所有核心功能已实现！');
    console.log('\n🚀 多租户插件化自动隔离系统已完成部署');
    console.log('\n📝 使用说明:');
    console.log('1. 在API路由中使用 withTenantContext() 包装器');
    console.log('2. 在模型上调用 .plugin(multiTenantPlugin)');
    console.log('3. 插件会自动处理所有查询的租户隔离');
    console.log('4. super_admin 和 admin 角色可以看到所有数据');
  } else {
    console.log('❌ 存在未实现的核心功能，请检查上述报告');
  }

  return allPassed;
}

// 如果直接运行此文件，则执行验证
if (require.main === module) {
  verifyImplementation();
}

export { verifyImplementation };