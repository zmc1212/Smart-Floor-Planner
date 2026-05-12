import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { SystemRole } from '@/models/SystemRole';
import { DEFAULT_PERMISSIONS, ROLE_LABELS } from '@/models/AdminUser';

// GET /api/roles - List all roles with auto-seeding
export async function GET() {
  try {
    await dbConnect();
    
    let roles = await SystemRole.find().sort({ createdAt: 1 });
    
    // Auto-seed if empty
    if (roles.length === 0) {
      const seedData = Object.entries(DEFAULT_PERMISSIONS).map(([key, menus]) => ({
        roleKey: key,
        label: ROLE_LABELS[key] || key,
        menuKeys: menus,
      }));
      
      await SystemRole.insertMany(seedData);
      roles = await SystemRole.find().sort({ createdAt: 1 });
    }
    
    return NextResponse.json({ success: true, data: roles });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// PATCH /api/roles/:id - Update permissions for a role
export async function PATCH(request: Request) {
  try {
    await dbConnect();
    const body = await request.json();
    const { id, menuKeys } = body;
    
    if (!id || !menuKeys) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }
    
    const role = await SystemRole.findByIdAndUpdate(
      id,
      { menuKeys },
      { new: true }
    );
    
    if (!role) {
      return NextResponse.json({ success: false, error: 'Role not found' }, { status: 404 });
    }
    
    return NextResponse.json({ success: true, data: role });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
