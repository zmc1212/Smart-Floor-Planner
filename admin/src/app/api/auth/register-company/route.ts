import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { Enterprise } from '@/models/Enterprise';

export async function POST(request: Request) {
  try {
    await dbConnect();
    const body = await request.json();

    // Basic validation
    if (!body.name || !body.contactPerson?.phone) {
      return NextResponse.json({ success: false, error: '请填写公司名称和联系电话' }, { status: 400 });
    }

    // Check if code/name already exists
    const existing = await Enterprise.findOne({ 
      $or: [{ name: body.name }, { code: body.code }] 
    });
    
    if (existing) {
      return NextResponse.json({ success: false, error: '公司名称或统一社会信用代码已注册' }, { status: 400 });
    }

    const enterprise = await Enterprise.create({
      ...body,
      status: 'pending_approval',
      registrationMode: 'self_service',
    });

    return NextResponse.json({ 
      success: true, 
      message: '申请已提交，请等待管理员审核',
      data: { id: enterprise._id } 
    });
  } catch (error: any) {
    console.error('Registration error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
