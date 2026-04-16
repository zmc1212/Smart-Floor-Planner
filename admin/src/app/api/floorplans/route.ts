import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import dbConnect from '@/lib/mongodb';
import { FloorPlan } from '@/models/FloorPlan';
import { User } from '@/models/User';

// Apply FloorPlan mapping: Save layout data from Mini Program
export async function POST(req: Request) {
  try {
    await dbConnect();
    const { openid, name, layoutData } = await req.json();

    if (!openid || !layoutData) {
      return NextResponse.json({ success: false, error: 'Missing openid or layoutData' }, { status: 400 });
    }

    const user = await User.findOne({ openid });
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found for provided openid' }, { status: 404 });
    }

    const newPlan = await FloorPlan.create({
      name: name || '未命名户型',
      creator: user._id,
      layoutData,
      status: 'completed'
    });

    return NextResponse.json({ success: true, data: newPlan });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Get all floor plans or filtered list
export async function GET(req: Request) {
  try {
    await dbConnect();
    const { searchParams } = new URL(req.url);
    const openid = searchParams.get('openid');
    const search = searchParams.get('search');

    let query: any = {};
    if (openid) {
      const user = await User.findOne({ openid });
      if (!user) {
        return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
      }
      query.creator = user._id;
    }

    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }

    const floorPlans = await FloorPlan.find(query)
      .populate({ path: 'creator', model: User })
      .sort({ createdAt: -1 });

    return NextResponse.json({ success: true, data: floorPlans });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
