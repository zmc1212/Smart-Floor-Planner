import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function GET() {
  try {
    const mineIconsDir = path.resolve('g:/workspace/向总/Smart-Floor-Planner/miniprogram/images/mine-icons');
    
    // 1. Delete all .svg files we created in miniprogram/images/mine-icons/
    const svgFiles = [
      'tab-home.svg',
      'tab-home-active.svg',
      'tab-leads.svg',
      'tab-leads-active.svg',
      'tab-measure.svg',
      'tab-bulb.svg',
      'tab-bulb-active.svg',
      'tab-mine.svg',
      'tab-mine-active.svg'
    ];

    svgFiles.forEach(file => {
      const filePath = path.join(mineIconsDir, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`Deleted unused file: ${file}`);
      }
    });

    // 2. Delete the unauthorized API directory: admin/src/app/api/save-icons
    const oldApiDir = path.resolve('g:/workspace/向总/Smart-Floor-Planner/admin/src/app/api/save-icons');
    if (fs.existsSync(oldApiDir)) {
      fs.rmSync(oldApiDir, { recursive: true, force: true });
      console.log('Deleted unused old api directory');
    }

    // 3. Self-destruct: Delete this miniprogram/save-icons directory after response is sent
    const currentApiDir = path.resolve('g:/workspace/向总/Smart-Floor-Planner/admin/src/app/api/miniprogram/save-icons');
    setTimeout(() => {
      if (fs.existsSync(currentApiDir)) {
        fs.rmSync(currentApiDir, { recursive: true, force: true });
        console.log('API self-destructed successfully');
      }
    }, 1000);

    return NextResponse.json({
      success: true,
      message: 'Unused .svg files and debug APIs successfully cleared.'
    }, { headers: CORS_HEADERS });

  } catch (error: any) {
    console.error('Failed to cleanup files:', error);
    return NextResponse.json({
      success: false,
      message: error.message
    }, { status: 500, headers: CORS_HEADERS });
  }
}

export async function POST(request: Request) {
  try {
    const data = await request.json();
    const destDir = path.resolve('g:/workspace/向总/Smart-Floor-Planner/miniprogram/images/mine-icons');
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const fileMap: { [key: string]: string } = {
      home_inactive: 'tab-home.png',
      home_active: 'tab-home-active.png',
      leads_inactive: 'tab-leads.png',
      leads_active: 'tab-leads-active.png',
      measure: 'tab-measure.png',
      bulb_inactive: 'tab-bulb.png',
      bulb_active: 'tab-bulb-active.png',
      mine_inactive: 'tab-mine.png',
      mine_active: 'tab-mine-active.png',
    };

    for (const [key, base64] of Object.entries(data)) {
      const fileName = fileMap[key];
      if (fileName && typeof base64 === 'string') {
        const filePath = path.join(destDir, fileName);
        const buffer = Buffer.from(base64, 'base64');
        fs.writeFileSync(filePath, buffer);
        console.log(`Successfully saved icon: ${fileName}`);
      }
    }

    return NextResponse.json(
      { success: true, message: 'All icons successfully saved as PNG' },
      { headers: CORS_HEADERS }
    );
  } catch (error: any) {
    console.error('Failed to save icons:', error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
