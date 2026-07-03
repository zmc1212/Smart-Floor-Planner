import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { FloorPlan } from '@/models/FloorPlan';
import { User } from '@/models/User';
import { AdminUser } from '@/models/AdminUser';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { linkFloorPlanToLead } from '@/lib/floorplan-lead-link';

interface FloorPlanUpdateBody {
  openid?: string;
  name?: string;
  layoutData?: unknown;
  status?: 'draft' | 'completed';
  leadId?: string;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function isSurveyingPrototypeLayout(layoutData: unknown) {
  if (!layoutData || typeof layoutData !== 'object' || Array.isArray(layoutData)) {
    return false;
  }

  const parsed = layoutData as {
    measurementMode?: unknown;
    prototypeOnly?: unknown;
    surveyDraft?: { kind?: unknown };
  };

  return parsed.measurementMode === 'surveying_prototype' &&
    parsed.prototypeOnly === true &&
    parsed.surveyDraft?.kind === 'survey-wall-graph';
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();
    const { id } = await params;
    const body = await req.json() as FloorPlanUpdateBody;

    // Automatic Association for Staff if missing
    const staffUpdate: Record<string, unknown> = {};
    const context = await resolveMiniProgramContext(req);
    
    if (context?.staff) {
       staffUpdate.staffId = context.staff._id;
       staffUpdate.enterpriseId = context.staff.enterpriseId;
    } else if (body.openid) {
       // Legacy fallback
       const user = await User.findOne({ openid: body.openid });
       if (user && user.role === 'staff') {
         const staffMember = await AdminUser.findOne({ phone: user.phone });
         if (staffMember) {
           staffUpdate.staffId = staffMember._id;
           staffUpdate.enterpriseId = staffMember.enterpriseId;
         }
       }
    }

    if (isSurveyingPrototypeLayout(body.layoutData)) {
      const existingPlan = await FloorPlan.findById(id).select('layoutData');
      if (existingPlan && !isSurveyingPrototypeLayout(existingPlan.layoutData)) {
        return NextResponse.json(
          { success: false, error: 'Cannot overwrite a formal floor plan with a surveying prototype draft' },
          { status: 409 }
        );
      }
    }

    const updatedPlan = await FloorPlan.findByIdAndUpdate(
      id,
      { 
        $set: {
          name: body.name,
          layoutData: body.layoutData,
          status: body.status,
          ...staffUpdate
        }
      },
      { new: true }
    );

    if (!updatedPlan) {
      return NextResponse.json({ success: false, error: 'FloorPlan not found' }, { status: 404 });
    }

    if (body.leadId) {
      await linkFloorPlanToLead(body.leadId, updatedPlan._id);
    }

    return NextResponse.json({ success: true, data: updatedPlan });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();
    const { id } = await params;
    await FloorPlan.findByIdAndDelete(id);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
