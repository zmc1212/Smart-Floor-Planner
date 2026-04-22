import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import { Enterprise } from '@/models/Enterprise';
import { WeComService } from '@/lib/wecom';
import { getTenantContext } from '@/lib/auth';

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    await dbConnect();
    const context = await getTenantContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const leadId = params.id;
    const body = await request.json();
    const { message } = body;

    const lead = await Lead.findById(leadId);
    if (!lead) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }

    if (!lead.wecomGroupId) {
      return NextResponse.json({ success: false, error: 'WeCom group not found for this lead' }, { status: 400 });
    }

    const enterprise = await Enterprise.findById(lead.enterpriseId);
    if (!enterprise || !enterprise.wecomConfig) {
      return NextResponse.json({ success: false, error: 'Enterprise WeCom configuration missing' }, { status: 400 });
    }

    const success = await WeComService.sendMessage(
      enterprise,
      lead.wecomGroupId,
      message || `设计师已为您生成了最新的户型设计方案，请点击查看：${process.env.NEXT_PUBLIC_APP_URL}/floorplans/${lead.floorPlanIds?.[0] || ''}`
    );

    if (success) {
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ success: false, error: 'Failed to send WeCom message' }, { status: 500 });
    }
  } catch (error: any) {
    console.error('Share to WeCom error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
