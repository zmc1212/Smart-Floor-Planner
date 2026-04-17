import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';

export async function GET(request: Request) {
  try {
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const source = searchParams.get('source');

    const query: any = {};
    if (status) query.status = status;
    if (source) query.source = source;

    const leads = await Lead.find(query).sort({ createdAt: -1 });
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
