import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import {
  checkPostgresConnection,
  isPostgresConfigured,
} from '@/lib/postgresql';
import { User } from '@/models/User';

export const dynamic = 'force-dynamic';

type DatabaseHealth =
  | {
      status: 'ok';
      latencyMs: number;
    }
  | {
      status: 'error';
      latencyMs: number;
    }
  | {
      status: 'not_configured';
    };

async function checkMongoDatabase() {
  const startedAt = Date.now();
  try {
    await dbConnect();
    const usersCount = await User.countDocuments();
    return {
      status: 'ok' as const,
      latencyMs: Date.now() - startedAt,
      usersCount,
    };
  } catch {
    return {
      status: 'error' as const,
      latencyMs: Date.now() - startedAt,
    };
  }
}

async function checkPostgresDatabase(): Promise<DatabaseHealth> {
  if (!isPostgresConfigured()) return { status: 'not_configured' };
  const startedAt = Date.now();
  try {
    await checkPostgresConnection();
    return {
      status: 'ok',
      latencyMs: Date.now() - startedAt,
    };
  } catch {
    return {
      status: 'error',
      latencyMs: Date.now() - startedAt,
    };
  }
}

export async function GET() {
  const postgresRequired =
    process.env.POSTGRES_HEALTHCHECK_REQUIRED?.trim().toLowerCase() === 'true';
  const [mongodb, postgresql] = await Promise.all([
    checkMongoDatabase(),
    checkPostgresDatabase(),
  ]);

  const postgresGatePassed = postgresRequired
    ? postgresql.status === 'ok'
    : true;
  const healthy = mongodb.status === 'ok' && postgresGatePassed;
  const degraded =
    healthy && postgresql.status === 'error' && !postgresRequired;
  const status = healthy ? (degraded ? 'degraded' : 'ok') : 'error';

  return NextResponse.json(
    {
      status,
      databases: {
        mongodb,
        postgresql: {
          ...postgresql,
          required: postgresRequired,
        },
      },
    },
    { status: healthy ? 200 : 503 }
  );
}
