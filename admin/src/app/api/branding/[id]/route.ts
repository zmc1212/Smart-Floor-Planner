import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { Enterprise } from '@/models/Enterprise';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await dbConnect();

    const enterprise = await Enterprise.findById(id).select('name logo branding status');

    if (!enterprise) {
      return NextResponse.json({ success: false, error: 'Enterprise not found' }, { status: 404 });
    }

    if (enterprise.status !== 'active') {
      return NextResponse.json({ success: false, error: 'Enterprise is not active' }, { status: 403 });
    }

    return NextResponse.json({
      success: true,
      data: {
        name: enterprise.name,
        logo: enterprise.logo,
        branding: enterprise.branding || {
          primaryColor: '#171717',
          accentColor: '#0070f3'
        }
      }
    });
  } catch (error: any) {
    console.error(`[API] Branding GET error:`, error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
