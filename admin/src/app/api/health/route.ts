import { NextResponse } from 'next/server';
import {
  checkPostgresConnection,
  isPostgresConfigured,
} from '@/lib/postgresql';

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
  const postgresql = await checkPostgresDatabase();
  const healthy = postgresql.status === 'ok';

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'error',
      databases: {
        postgresql: {
          ...postgresql,
          required: true,
        },
      },
    },
    { status: healthy ? 200 : 503 }
  );
}
