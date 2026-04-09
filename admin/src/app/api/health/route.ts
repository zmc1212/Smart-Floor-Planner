import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { User } from '@/models/User';

export async function GET() {
  try {
    await dbConnect();
    // Simple query to ensure connection works
    const count = await User.countDocuments();
    return NextResponse.json({ status: 'ok', message: 'MongoDB connected', usersCount: count });
  } catch (error: any) {
    return NextResponse.json({ status: 'error', message: error.message }, { status: 500 });
  }
}
