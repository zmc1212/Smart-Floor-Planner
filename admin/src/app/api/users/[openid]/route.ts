import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { User } from '@/models/User';
import mongoose from 'mongoose';

export async function GET(req: Request, { params }: { params: Promise<{ openid: string }> }) {
  try {
    await dbConnect();
    const resolvedParams = await params;
    const { openid } = resolvedParams;
    const isObjectId = mongoose.Types.ObjectId.isValid(openid);
    
    // Find by either standard DB _id or WeChat openid
    const user = isObjectId 
      ? await User.findById(openid) || await User.findOne({ openid }) 
      : await User.findOne({ openid });
      
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }
    
    return NextResponse.json({ success: true, data: user });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ openid: string }> }) {
  try {
    await dbConnect();
    const resolvedParams = await params;
    const { openid } = resolvedParams;
    const body = await req.json();
    
    // Safety check - don't allow modifying sensitive fields like role here unless authorized 
    // (For real apps, add JWT middleware)
    delete body.role; 

    const isObjectId = mongoose.Types.ObjectId.isValid(openid);
    let user;
    
    if (isObjectId) {
      user = await User.findByIdAndUpdate(openid, body, { new: true, runValidators: true });
      if (!user) {
         user = await User.findOneAndUpdate({ openid }, body, { new: true, runValidators: true });
      }
    } else {
      user = await User.findOneAndUpdate({ openid }, body, { new: true, runValidators: true });
    }

    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }
    
    return NextResponse.json({ success: true, data: user });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ openid: string }> }) {
  try {
    await dbConnect();
    const resolvedParams = await params;
    const { openid } = resolvedParams;
    
    const isObjectId = mongoose.Types.ObjectId.isValid(openid);
    let user;

    if (isObjectId) {
      user = await User.findByIdAndDelete(openid);
      if (!user) {
        user = await User.findOneAndDelete({ openid });
      }
    } else {
      user = await User.findOneAndDelete({ openid });
    }

    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }
    
    return NextResponse.json({ success: true, data: {} });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
