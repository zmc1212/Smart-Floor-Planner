import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { Enterprise } from '@/models/Enterprise';

export const dynamic = 'force-dynamic';

// Public API for enterprise self-registration
export async function POST(request: Request) {
  try {
    await dbConnect();
    const body = await request.json();

    const { name, code, contactPerson } = body;

    // Basic Validation
    if (!name || !code || !contactPerson?.name || !contactPerson?.phone) {
      return NextResponse.json({ success: false, error: '请填写所有必填字段' }, { status: 400 });
    }

    // Check if code already registered
    const existing = await Enterprise.findOne({ code });
    if (existing) {
      return NextResponse.json({ success: false, error: '该统一社会信用代码已注册' }, { status: 400 });
    }

    const enterprise = await Enterprise.create({
      name,
      code,
      contactPerson,
      status: 'pending_approval',
      registrationMode: 'self_service',
    });

    return NextResponse.json({ success: true, data: enterprise });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
