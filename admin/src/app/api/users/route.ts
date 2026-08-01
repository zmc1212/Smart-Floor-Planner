import { NextResponse } from 'next/server';
import { userToDto } from '@/db/postgres-dto';
import { FloorPlanRepository, UserRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const result = await withPlatformTransaction(async (transaction) => {
      const users = await new UserRepository(transaction).list(
        searchParams.get('search') || ''
      );
      const planCounts = await new FloorPlanRepository(
        transaction
      ).countByCreatorIds(users.map((user) => user.id));
      return { users, planCounts };
    });
    const data = result.users.map((user) => ({
      ...userToDto(user),
      planCount: result.planCounts.get(user.id) ?? 0,
    }));
    return NextResponse.json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const user = await withPlatformTransaction((transaction) =>
      new UserRepository(transaction).create({
        enterpriseId: body.enterpriseId ? BigInt(body.enterpriseId) : null,
        username: body.username?.trim() || null,
        passwordHash: body.passwordHash || null,
        role: body.role || 'user',
        openid: body.openid?.trim() || null,
        nickname: body.nickname?.trim() || null,
        avatar: body.avatar || null,
        communityName: body.communityName?.trim() || null,
        city: body.city?.trim() || null,
        phone: body.phone?.trim() || null,
      })
    );
    return NextResponse.json(
      { success: true, data: userToDto(user) },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 400 }
    );
  }
}
