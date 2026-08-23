import { NextResponse } from 'next/server';
import {
  authorizeLeadSitePhotos,
  isAuthorizedLeadSitePhotoContext,
  leadSitePhotoErrorResponse,
  softDeleteLeadSitePhoto,
  updateLeadSitePhotoTag,
} from '@/lib/lead-site-photos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  try {
    const { id, photoId } = await params;
    const access = await authorizeLeadSitePhotos(request, id);
    if (!isAuthorizedLeadSitePhotoContext(access)) return access;
    const body = await request.json().catch(() => ({})) as { spaceTag?: unknown };
    const photo = await updateLeadSitePhotoTag(request, access, photoId, body.spaceTag);
    return NextResponse.json({ success: true, data: photo });
  } catch (error) {
    console.error('[Lead Site Photos PATCH]', error);
    return leadSitePhotoErrorResponse(error, '更新现场图标签失败');
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  try {
    const { id, photoId } = await params;
    const access = await authorizeLeadSitePhotos(request, id);
    if (!isAuthorizedLeadSitePhotoContext(access)) return access;
    return NextResponse.json({ success: true, data: await softDeleteLeadSitePhoto(access, photoId) });
  } catch (error) {
    console.error('[Lead Site Photos DELETE]', error);
    return leadSitePhotoErrorResponse(error, '删除现场图失败');
  }
}
