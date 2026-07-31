import { jsonb, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';

export const appSchema = pgSchema('app');

export const migrationCheckpoints = appSchema.table('migration_checkpoints', {
  key: text('key').primaryKey(),
  phase: text('phase').notNull(),
  status: text('status').notNull(),
  details: jsonb('details').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});
