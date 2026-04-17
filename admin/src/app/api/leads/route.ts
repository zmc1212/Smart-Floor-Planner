import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import { getTenantContext, getTenantFilter } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await dbConnect();
    const context = await getTenantContext(request);
    if (!context) {
      console.log('Leads API: Unauthorized access attempt');
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const source = searchParams.get('source');

    const basicQuery: any = {};
    if (status) basicQuery.status = status;
    if (source) basicQuery.source = source;

    // Apply tenant filter
    const tenantFilter = getTenantFilter(context, { staffField: 'assignedTo' });
    const query = { ...basicQuery, ...tenantFilter };

    console.log(`Leads API Trace: User=${context.username}, Role=${context.role}, EID=${context.enterpriseId}, Query=${JSON.stringify(query)}`);

    const leads = await Lead.find(query)
      .populate('assignedTo', 'displayName username')
      .sort({ createdAt: -1 });

    console.log(`Leads API Result: Found ${leads.length} leads`);

    return NextResponse.json({ success: true, data: leads });
  } catch (error: any) {
    console.error('Fetch leads error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await dbConnect();
    const body = await request.json();
    
    // validate required fields
    if (!body.name || !body.phone) {
      return NextResponse.json({ success: false, error: 'Name and phone are required' }, { status: 400 });
    }

    const lead = await Lead.create(body);
    return NextResponse.json({ success: true, data: lead }, { status: 201 });
  } catch (error: any) {
    console.error('Create lead error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
