import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { CustomerProjectRepository, ProfessionalProfileRepository } from '@/db/repositories';
import { customerProjectToDto } from '@/lib/customer-project';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';
import { publicProfessionalProfile } from '@/lib/professional-profile';

export const dynamic = 'force-dynamic';

function publicMiniProgramError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (/failed query|select\s+/i.test(message)) {
    console.error('[customer-project GET]', error);
    return fallback;
  }
  return message || fallback;
}

export async function GET(request: Request, { params }: { params: Promise<{ leadId: string }> }) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
    if (context.mode !== 'customer') return NextResponse.json({ success: false, error: '仅客户本人可查看项目' }, { status: 403 });
    const { leadId: leadIdText } = await params;
    const leadId = parsePostgresId(leadIdText, 'lead id');
    const result = await withMiniProgramPostgresTransaction(context, async (transaction) => {
      const project = await new CustomerProjectRepository(transaction).findCustomerProject(
        parsePostgresId(context.user._id, 'customer user id'),
        leadId
      );
      if (!project) return null;
      const profiles = new ProfessionalProfileRepository(transaction);
      const [designerProfile, measurerProfile] = await Promise.all([
        project.designer ? profiles.findForStaff(project.designer.id) : null,
        project.measurer ? profiles.findForStaff(project.measurer.id) : null,
      ]);
      return { project, designerProfile, measurerProfile };
    });
    const project = result?.project;
    if (!project) return NextResponse.json({ success: false, error: '项目不存在或无权访问' }, { status: 404 });
    return NextResponse.json({
      success: true,
      data: await customerProjectToDto(request, project, {
        designerProfessionalProfile: publicProfessionalProfile(result.designerProfile),
        measurerProfessionalProfile: publicProfessionalProfile(result.measurerProfile),
      }),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: publicMiniProgramError(error, '读取客户项目失败') },
      { status: 400 }
    );
  }
}
