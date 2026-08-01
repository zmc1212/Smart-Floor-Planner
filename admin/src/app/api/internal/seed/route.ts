import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { AdminUser } from '@/models/AdminUser';
import bcrypt from 'bcryptjs';
import { getEffectivePermissions } from '@/lib/staff-access';

export async function POST(req: NextRequest) {
  // 安全校验：仅允许携带正确密钥的内部请求
  const secret = req.headers.get('x-internal-secret');
  const expectedSecret = process.env.INTERNAL_SECRET || 'sfp_internal_init_secret_2024';
  
  if (!secret || secret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await dbConnect();
    
    const exists = await AdminUser.findOne({ username: 'admin' });
    if (!exists) {
      const hash = await bcrypt.hash('admin123', 10);
      const menuPermissions = await getEffectivePermissions('super_admin');
      
      // 注意：AdminUser 模型中定义了 pre-save hook 会自动填充 super_admin 的权限
      await AdminUser.create({
        username: 'admin',
        passwordHash: hash,
        displayName: '系统管理员',
        role: 'super_admin',
        menuPermissions,
        status: 'active',
      });
      
      return NextResponse.json({ 
        success: true, 
        message: '✅ 初始账号创建成功: admin / admin123' 
      });
    } else {
      return NextResponse.json({ 
        success: true, 
        message: '✔️ 账号已存在，无需初始化' 
      });
    }
  } catch (error: unknown) {
    console.error('[Seed API Error]:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
