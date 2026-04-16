import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import dbConnect from '@/lib/mongodb';
import { User } from '@/models/User';

import { FloorPlan } from '@/models/FloorPlan';

// Admin API: List all users with filtering and plan counts
export async function GET(req: Request) {
  try {
    await dbConnect();
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search');

    let query: any = {};
    if (search) {
      query.$or = [
        { nickname: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { openid: { $regex: search, $options: 'i' } },
        { communityName: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(query).sort({ createdAt: -1 }).lean();
    
    // Efficiently get counts for each user
    const usersWithCounts = await Promise.all(users.map(async (user: any) => {
      const planCount = await FloorPlan.countDocuments({ creator: user._id });
      return { ...user, planCount };
    }));

    return NextResponse.json({ success: true, count: usersWithCounts.length, data: usersWithCounts });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Admin API: Create a user manually
export async function POST(req: Request) {
  try {
    await dbConnect();
    const body = await req.json();
    const newUser = await User.create(body);
    return NextResponse.json({ success: true, data: newUser }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}
