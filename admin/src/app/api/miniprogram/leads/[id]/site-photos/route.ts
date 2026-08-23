import { NextResponse } from 'next/server';
import {
  authorizeLeadSitePhotos,
  createLeadSitePhoto,
  isAuthorizedLeadSitePhotoContext,
  leadSitePhotoErrorResponse,
  listLeadSitePhotos,
} from '@/lib/lead-site-photos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await authorizeLeadSitePhotos(request, id);
    if (!isAuthorizedLeadSitePhotoContext(access)) return access;
    return NextResponse.json({ success: true, data: await listLeadSitePhotos(request, access) });
  } catch (error) {
    console.error('[Lead Site Photos GET]', error);
    return leadSitePhotoErrorResponse(error, '读取现场图失败');
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await authorizeLeadSitePhotos(request, id);
    if (!isAuthorizedLeadSitePhotoContext(access)) return access;
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: '请选择要上传的现场照片' }, { status: 400 });
    }
    const photo = await createLeadSitePhoto(request, access, {
      buffer: Buffer.from(await file.arrayBuffer()),
      source: formData.get('source'),
      spaceTag: formData.get('spaceTag'),
    });
    return NextResponse.json({ success: true, data: photo }, { status: 201 });
  } catch (error) {
    console.error('[Lead Site Photos POST]', error);
    return leadSitePhotoErrorResponse(error, '现场图上传失败');
  }
}
