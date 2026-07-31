import { loadEnvConfig } from '@next/env';
import { defineConfig } from 'drizzle-kit';

loadEnvConfig(process.cwd());

const migrationUrl =
  process.env.DATABASE_MIGRATION_URL?.trim() ||
  process.env.DATABASE_URL?.trim();

if (!migrationUrl) {
  throw new Error(
    'DATABASE_MIGRATION_URL or DATABASE_URL is required for Drizzle migrations'
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: migrationUrl,
  },
  strict: true,
  verbose: true,
});
