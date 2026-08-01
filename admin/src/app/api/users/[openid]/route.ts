import { NextResponse } from 'next/server';
import { parsePostgresId, userToDto } from '@/db/postgres-dto';
import { UserRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';

function buildContextUserData(
  context: NonNullable<
    Awaited<ReturnType<typeof resolveMiniProgramContext>>
  >
) {
  return {
    ...context.user,
    ...(context.staff
      ? {
          staffRole: context.staff.role,
          enterpriseId: context.staff.enterpriseId,
          enterpriseName: context.enterprise?.name || '',
          staffId: context.staff._id,
        }
      : {}),
  };
}

export async function GET(req: Request) {
  try {
    const context = await resolveMiniProgramContext(req);
    if (!context) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    return NextResponse.json({
      success: true,
      data: buildContextUserData(context),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  try {
    const context = await resolveMiniProgramContext(req);
    if (!context) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    const body = await req.json();
    const profileUpdate = {
      nickname:
        body.nickname !== undefined ? String(body.nickname).trim() || null : undefined,
      avatar: body.avatar !== undefined ? String(body.avatar) || null : undefined,
      communityName:
        body.communityName !== undefined
          ? String(body.communityName).trim() || null
          : undefined,
      city:
        body.city !== undefined ? String(body.city).trim() || null : undefined,
      phone:
        body.phone !== undefined
          ? String(body.phone).trim() || null
          : undefined,
    };
    const userId = String(context.user._id);
    const user = await withPlatformTransaction(async (transaction) => {
      const repository = new UserRepository(transaction);
      if (/^[1-9]\d*$/.test(userId)) {
        return repository.update(
          parsePostgresId(userId, 'user id'),
          profileUpdate
        );
      }
      if (!context.staff) return null;
      return repository.create({
        ...profileUpdate,
        openid:
          context.staff.openid || `staff_${String(context.staff._id)}`,
        phone: context.staff.phone || null,
        role: 'staff',
        enterpriseId: context.staff.enterpriseId
          ? BigInt(context.staff.enterpriseId)
          : null,
      });
    });
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: userToDto(user) });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 400 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const context = await resolveMiniProgramContext(req);
    if (!context) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    const userId = String(context.user._id);
    if (/^[1-9]\d*$/.test(userId)) {
      await withPlatformTransaction((transaction) =>
        new UserRepository(transaction).delete(
          parsePostgresId(userId, 'user id')
        )
      );
    }
    return NextResponse.json({ success: true, data: {} });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
