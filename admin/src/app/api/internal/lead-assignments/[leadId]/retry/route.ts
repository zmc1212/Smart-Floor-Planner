import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { retrySingleLeadAssignment } from '@/lib/lead-assignment-retry';

export const dynamic = 'force-dynamic';

function authorized(request: Request) {
  const expected = process.env.INTERNAL_SECRET?.trim() || '';
  const supplied = request.headers.get('x-internal-secret') || '';
  if (expected.length < 32 || supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ leadId: string }> }
) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { leadId } = await params;
    const body = await request.json().catch(() => ({}));
    const reason =
      typeof body.reason === 'string' && body.reason.trim()
        ? body.reason.trim().slice(0, 160)
        : 'internal_retry';
    const result = await retrySingleLeadAssignment({
      leadId: parsePostgresId(leadId, 'lead id'),
      reason,
    });
    if (!result) {
      return NextResponse.json(
        { success: false, error: 'Lead not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({
      success: true,
      data: {
        leadId: result.lead.id.toString(),
        result: result.kind,
        assignmentStatus: result.lead.assignmentStatus,
        assignmentErrorCode: result.lead.assignmentErrorCode,
        designerId: result.lead.assignedTo?.toString() || null,
        measurerId: result.lead.measurerId?.toString() || null,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Assignment retry failed',
      },
      { status: 400 }
    );
  }
}
