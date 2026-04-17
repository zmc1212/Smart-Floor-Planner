import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Inspiration from '@/models/Inspiration';

export async function GET(request: Request) {
  try {
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const style = searchParams.get('style');
    const roomType = searchParams.get('roomType');
    const recommended = searchParams.get('recommended');

    const query: any = {};
    if (style) query.style = style;
    if (roomType) query.roomType = roomType;
    if (recommended === 'true') query.isRecommended = true;

    const inspirations = await Inspiration.find(query).sort({ createdAt: -1 });
    return NextResponse.json({ success: true, data: inspirations });
  } catch (error: any) {
    console.error('Fetch inspirations error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await dbConnect();
    const body = await request.json();
    
    // basic validation
    if (!body.title || !body.coverImage || !body.layoutData) {
      return NextResponse.json({ success: false, error: 'Title, coverImage and layoutData are required' }, { status: 400 });
    }

    const inspiration = await Inspiration.create(body);
    return NextResponse.json({ success: true, data: inspiration }, { status: 201 });
  } catch (error: any) {
    console.error('Create inspiration error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 });
    }

    await Inspiration.findByIdAndDelete(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete inspiration error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
