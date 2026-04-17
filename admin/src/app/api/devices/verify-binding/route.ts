import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { Device } from '@/models/Device';
import { AdminUser } from '@/models/AdminUser';

export const dynamic = 'force-dynamic';

/**
 * POST /api/devices/verify-binding
 * Body: { deviceId (hardware address/code), name, openid }
 * Purpose: Verify if the current Mini Program user (openid) is authorized to use this device.
 */
export async function POST(request: Request) {
  try {
    await dbConnect();
    const { deviceId, name, openid } = await request.json();

    if (!deviceId) {
      return NextResponse.json({ success: false, error: '未提供设备ID' }, { status: 400 });
    }

    // 1. Find the device by its code
    // The deviceId from Bluetooth usually contains the code or MAC.
    // We look for a device whose 'code' is part of the reported deviceId or name.
    const devices = await Device.find({ status: 'assigned' }).lean();
    
    const matchedDevice = devices.find(d => {
      const code = d.code.toUpperCase();
      const devIdUpper = (deviceId || '').toUpperCase();
      const nameUpper = (name || '').toUpperCase();
      return devIdUpper.includes(code) || nameUpper.includes(code);
    });

    if (!matchedDevice) {
      return NextResponse.json({ 
        success: true, 
        authorized: false, 
        message: '该设备未在系统中注册或未指派' 
      });
    }

    // 2. Strict Binding Check
    // If the device is assigned to a specific user, we must verify the opening person
    if (matchedDevice.assignedUserId) {
      if (!openid) {
        return NextResponse.json({ 
          success: true, 
          authorized: false, 
          message: '未能识别当前用户信息，无法验证设备授权' 
        });
      }

      // Find the AdminUser linked to this openid
      const staff = await AdminUser.findOne({ openid: openid, status: 'active' });
      
      if (!staff || staff._id.toString() !== matchedDevice.assignedUserId.toString()) {
        return NextResponse.json({ 
          success: true, 
          authorized: false, 
          message: '该设备已绑定给其他设计师，您无权使用' 
        });
      }
    } else {
        // Device assigned to enterprise but not to a specific user yet?
        // Based on "Strict binding" requirement, it should ideally be assigned to a user.
        // If not assigned to a user, check if the staff belongs to the same enterprise.
        if (openid) {
            const staff = await AdminUser.findOne({ openid: openid, status: 'active' });
            if (!staff || staff.enterpriseId?.toString() !== matchedDevice.enterpriseId?.toString()) {
                return NextResponse.json({ 
                    success: true, 
                    authorized: false, 
                    message: '您无权使用该公司的设备' 
                });
            }
        }
    }

    return NextResponse.json({ 
      success: true, 
      authorized: true, 
      message: '设备验证通过' 
    });

  } catch (error: any) {
    console.error('Verify binding error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
