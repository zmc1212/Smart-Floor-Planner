import { NextResponse } from 'next/server';
import { exec } from 'child_process';

export const dynamic = 'force-dynamic';

export async function GET() {
  return new Promise((resolve) => {
    exec('node -v', (error, stdout, stderr) => {
      resolve(NextResponse.json({
        error: error ? error.message : null,
        stdout,
        stderr
      }));
    });
  });
}
