import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const targetUrl = searchParams.get('url');

    if (!targetUrl) {
      return NextResponse.json({ success: false, error: 'Missing url' }, { status: 400 });
    }

    const parsed = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return NextResponse.json({ success: false, error: 'Unsupported protocol' }, { status: 400 });
    }

    const response = await fetch(targetUrl);
    if (!response.ok) {
      return NextResponse.json({ success: false, error: 'Failed to fetch image' }, { status: 502 });
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const buffer = await response.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('[AI Image Proxy]', error);
    return NextResponse.json({ success: false, error: 'Image proxy failed' }, { status: 500 });
  }
}
