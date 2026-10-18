import { bigint, boolean, integer, jsonb, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';
// 0071_designer_portfolio owns composite tenant FKs, immutable publications and forced RLS.
const app = pgSchema('app');
const ref = (name: string) => bigint(name, { mode: 'bigint' });
const time = (name: string) => timestamp(name, { withTimezone: true });
const identity = () => ({ id: ref('id').primaryKey().generatedAlwaysAsIdentity(), enterpriseId: ref('enterprise_id').notNull(), createdAt: time('created_at').notNull().defaultNow() });
export const portfolioCommunities = app.table('portfolio_communities', {
  ...identity(), provider: text('provider').notNull(), providerPoiId: text('provider_poi_id'), name: text('name').notNull(),
  cityCode: text('city_code').notNull(), cityName: text('city_name').notNull(), district: text('district').notNull(), address: text('address').notNull(), provenance: text('provenance').notNull(), verifiedBy: ref('verified_by').notNull(), licenseValidUntil: time('license_valid_until'),
});
export const portfolioProfiles = app.table('portfolio_profiles', {
  id: ref('id').primaryKey().generatedAlwaysAsIdentity(), enterpriseId: ref('enterprise_id').notNull(), authorId: ref('author_id').notNull(), content: jsonb('content').notNull(), version: integer('version').notNull(), updatedAt: time('updated_at').notNull(),
});
export const portfolioWorks = app.table('portfolio_works', {
  ...identity(), kind: text('kind').notNull(), authorId: ref('author_id'), headVersionId: ref('head_version_id'), publishedVersionId: ref('published_version_id'), withdrawn: boolean('withdrawn').notNull(),
  version: integer('version').notNull(), createdBy: ref('created_by').notNull(), updatedBy: ref('updated_by').notNull(), updatedAt: time('updated_at').notNull(),
});
export const portfolioVersions = app.table('portfolio_versions', {
  ...identity(), workId: ref('work_id').notNull(), number: integer('number').notNull(), status: text('status').notNull(), content: jsonb('content').notNull(), searchText: text('search_text').notNull(),
  reviewNote: text('review_note').notNull(), submittedAt: time('submitted_at'), publishedAt: time('published_at'), reviewedBy: ref('reviewed_by'),
});
export const portfolioAssets = app.table('portfolio_assets', { ...identity(), workId: ref('work_id').notNull(), imageBase64: text('image_base64').notNull(), contentHash: text('content_hash').notNull() });
export const portfolioAudits = app.table('portfolio_audits', { ...identity(), workId: ref('work_id').notNull(), versionId: ref('version_id').notNull(), actorId: ref('actor_id').notNull(), action: text('action').notNull(), note: text('note').notNull() });
export const portfolioCommunityRequests = app.table('portfolio_community_requests', {
  ...identity(), requestedBy: ref('requested_by').notNull(), cityCode: text('city_code').notNull(), cityName: text('city_name').notNull(), name: text('name').notNull(), district: text('district').notNull(), address: text('address').notNull(),
  status: text('status').notNull(), communityId: ref('community_id'), reviewNote: text('review_note').notNull(), reviewedBy: ref('reviewed_by'),
});
export const portfolioProviderUsage = app.table('portfolio_provider_usage', { ...identity(), actorId: ref('actor_id').notNull(), pageKey: text('page_key').notNull(), providerKey: text('provider_key').notNull().default('amap'), failureCode: text('failure_code'), blockedUntil: time('blocked_until') });
