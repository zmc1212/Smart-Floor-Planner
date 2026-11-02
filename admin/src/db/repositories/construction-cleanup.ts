import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one } from './assistant-repository';
import {fail} from '@/lib/assistant/contracts';

const tables = ['construction_camera_controls', 'construction_camera_snapshots', 'construction_camera_sessions', 'construction_camera_entries', 'construction_camera_bindings', 'construction_cameras', 'construction_public_sites', 'construction_public_audits', 'construction_public_media', 'construction_public_sources', 'construction_public_versions', 'construction_site_attachments', 'construction_site_record_versions', 'construction_site_records', 'construction_site_media', 'construction_watches', 'construction_chats', 'construction_stage_assignments', 'construction_links', 'construction_audits', 'construction_visits', 'construction_plans', 'construction_service_order_repairs', 'construction_service_order_extensions', 'construction_service_order_points', 'construction_service_order_quotes', 'construction_service_orders', 'construction_rooms', 'construction_members', 'construction_projects', 'construction_stage_settings'] as const;
export async function constructionCounts(tx: PostgresTransaction, enterpriseId: bigint) {
  const result = [];
  for(const table of ['construction_camera_sd_playbacks','construction_camera_sd_recordings','construction_camera_sd_windows','construction_recordings','construction_camera_recording_periods','construction_camera_recording_policies'])result.push({table,label:'施工服务：'+table,count:Number((await one(tx,sql`select count(*) n from ${sql.raw('app.'+table)} where enterprise_id=${enterpriseId}`))!.n)});
  for (const table of reportTables) result.push({ table, label: '施工服务：' + table, count: Number((await one(tx, sql`select count(*) n from ${sql.raw('app.' + table)} where enterprise_id=${enterpriseId}`))!.n) });
  for (const table of tables) result.push({ table, label: '施工服务：' + table, count: Number((await one(tx, sql`select count(*) n from ${sql.raw('app.' + table)} where enterprise_id=${enterpriseId}`))!.n) });
  return result;
}
export async function deleteConstructionData(tx: PostgresTransaction, enterpriseId: bigint) {
  const counts = await constructionCounts(tx, enterpriseId);
  // Do not lose physical-file ownership or an active provider policy by deleting
  // its tenant rows. Disable recording and finish the media cleanup first.
  if(await one(tx,sql`select binding_id from app.construction_camera_recording_policies where enterprise_id=${enterpriseId} and (enabled or state<>'stopped') limit 1`)
    ||await one(tx,sql`select id from app.construction_recordings where enterprise_id=${enterpriseId} and state<>'deleted' limit 1`)
    ||await one(tx,sql`select id from app.construction_camera_sd_playbacks where enterprise_id=${enterpriseId} and state<>'stopped' limit 1`))fail('construction_camera_recordings_require_cleanup',409);
  await tx.execute(sql`delete from app.construction_camera_sessions where enterprise_id=${enterpriseId}`);
  for(const table of ['construction_camera_sd_playbacks','construction_camera_sd_recordings','construction_camera_sd_windows','construction_recordings','construction_camera_recording_periods','construction_camera_recording_policies'])await tx.execute(sql`delete from ${sql.raw('app.'+table)} where enterprise_id=${enterpriseId}`);
  // The general assistant cleanup owns jobs/usage/messages/conversations. Drop domain FKs first.
  for (const table of reportTables) await tx.execute(sql`delete from ${sql.raw('app.' + table)} where enterprise_id=${enterpriseId}`);
  for (const table of tables) await tx.execute(sql`delete from ${sql.raw('app.' + table)} where enterprise_id=${enterpriseId}`);
  return counts;
}

const reportTables = ['construction_report_deliveries', 'construction_report_versions', 'construction_reports', 'construction_followup_bindings', 'construction_report_settings'] as const;
