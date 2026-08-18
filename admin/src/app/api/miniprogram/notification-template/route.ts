import { NextResponse } from 'next/server';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import {
  getMiniProgramSubscriptionTemplates,
} from '@/lib/platform-notification-config';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const templates = await getMiniProgramSubscriptionTemplates();
    return NextResponse.json({
      success: true,
      data: {
        version: 2,
        templates: templates.map(({ type, title, templateId }) => ({
          type,
          title,
          templateId,
        })),
        // One-release compatibility for older Mini Program bundles.
        miniprogramTemplateId:
          templates.find((template) => template.type === 'workflow_todo')?.templateId || '',
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
