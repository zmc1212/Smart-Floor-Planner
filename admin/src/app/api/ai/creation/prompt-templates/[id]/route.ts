import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { getActivePromptTemplate } from '@/lib/ai/prompt-library-query';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    return await withTenantRoute(req, {}, async () => {
      const { id } = await params;
      const data = await getActivePromptTemplate(id);
      if (!data) return NextResponse.json({ success: false, error: 'Prompt template not found' }, { status: 404 });
      return NextResponse.json({ success: true, data });
    });
  } catch (error) {
    console.error('[AI Prompt Template GET]', error);
    return NextResponse.json({ success: false, error: 'Failed to load prompt template' }, { status: 500 });
  }
}
