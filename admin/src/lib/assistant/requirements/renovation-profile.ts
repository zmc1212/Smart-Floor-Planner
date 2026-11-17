import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, type ActorContext } from '../contracts';
import { allRequirementKeys, type DraftRequirements } from './contract';

const profileKeys = allRequirementKeys.filter(key => key !== 'budget');
export const profileRecallKind = 'renovation_profile_recall';
export const profileFieldLabels: Readonly<Record<string, string>> = {
  housing: '房屋情况', household: '居住需求', style: '风格偏好', timeline: '装修时间',
  room: '房间需求', space: '空间偏好', usage: '使用方式', frequency: '使用频率', devices: '设备需求',
};

export function renovationLeadId(entry: Row | undefined) {
  if (!entry || entry.retentionRedacted || entry.activePublicSite) return null;
  const id = entry.kind === 'lead' ? entry.id : entry.renovationLeadId;
  return typeof id === 'string' && /^[1-9]\d{0,18}$/.test(id) ? id : null;
}

type ProfileField = { key: string; label: string; value: string; source: 'message' | 'confirmed'; confirmedAt: string };
export type RenovationProfile = { leadId: string; version: number; updatedAt: string; fields: ProfileField[] };
type StaffProfileField = Pick<ProfileField, 'key' | 'label' | 'value'> & {
  source: ProfileField['source'] | 'consultation';
  recordedAt: string;
};
export type StaffRenovationProfile = { leadId: string; fields: StaffProfileField[] };
type AutomaticSource = { summaryId: string; messageId: string };
type ProjectProfileRow = { lead_id: string; version: number; updated_at: string; field_sources: Record<string, string> };
export type ProfileRecallRef = { leadId: string; ownerId: string; version: number; digest: string };

export async function renovationProfile(tx: PostgresTransaction, enterpriseId: string, leadId: string): Promise<RenovationProfile | null> {
  const records = await rows<ProjectProfileRow & { key: string; value: string; original: string | null; confirmed_at: string }>(
    tx, sql`select p.lead_id::text,p.version,p.updated_at,f.key,s.confirmed_fields->>f.key as value,
      s.draft_fields->f.key->>'text' as original,s.confirmed_at
      from app.assistant_renovation_profiles p
      join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
        and l.customer_user_id=p.customer_user_id and l.archived_at is null and l.status<>'closed'
      cross join lateral jsonb_each_text(p.field_sources) f
      join app.assistant_requirement_summaries s on s.enterprise_id=p.enterprise_id and s.id::text=f.value
        and s.customer_user_id=p.customer_user_id and s.lead_id=p.lead_id and s.status='confirmed'
      join app.assistant_conversations c on c.enterprise_id=s.enterprise_id and c.id=s.conversation_id
        and c.purpose='customer_consultation' and c.entry_snapshot->>'retentionRedacted' is distinct from 'true'
      join app.assistant_participants owner on owner.enterprise_id=c.enterprise_id and owner.conversation_id=c.id
        and owner.user_id=p.customer_user_id and owner.participant_role='owner' and owner.status='active'
      where p.enterprise_id=${enterpriseId} and p.lead_id=${leadId} and p.shared
        and f.key=any(${sql.param(profileKeys)}::text[]) and coalesce(s.confirmed_fields->>f.key,'')<>''`);
  if (!records.length) return null;
  const [first] = records;
  return {
    leadId: first.lead_id,
    version: first.version,
    updatedAt: first.updated_at,
    fields: profileKeys.flatMap(key => {
      const row = records.find(item => item.key === key);
      return row ? [{ key, label: profileFieldLabels[key], value: row.value,
        source: row.original === row.value ? 'message' : 'confirmed', confirmedAt: row.confirmed_at }] : [];
    }),
  };
}

/** The staff projection is separate from the customer and public projections. */
export async function staffRenovationProfile(tx: PostgresTransaction, enterpriseId: string, leadId: string): Promise<StaffRenovationProfile | null> {
  const shared = await renovationProfile(tx, enterpriseId, leadId);
  const automatic = await rows<{ key: string; value: string; recorded_at: string }>(tx, sql`
    select f.key, s.draft_fields->f.key->>'text' as value, m.created_at as recorded_at
    from app.assistant_renovation_profiles p
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
      and l.customer_user_id=p.customer_user_id and l.archived_at is null and l.status<>'closed'
    cross join lateral jsonb_each(p.automatic_field_sources) f
    join app.assistant_requirement_summaries s on s.enterprise_id=p.enterprise_id and s.id::text=f.value->>'summaryId'
      and s.customer_user_id=p.customer_user_id and s.status<>'redacted'
    join app.assistant_conversations c on c.enterprise_id=s.enterprise_id and c.id=s.conversation_id
      and c.purpose='customer_consultation' and c.entry_snapshot->>'staffProfileLeadId'=p.lead_id::text
      and c.entry_snapshot->>'retentionRedacted' is distinct from 'true'
      and (p.automatic_revoked_at is null or c.created_at>p.automatic_revoked_at)
    join app.assistant_participants owner on owner.enterprise_id=c.enterprise_id and owner.conversation_id=c.id
      and owner.user_id=p.customer_user_id and owner.participant_role='owner' and owner.status='active'
    join app.assistant_messages m on m.enterprise_id=c.enterprise_id and m.conversation_id=c.id
      and m.id::text=f.value->>'messageId' and m.author_kind='user' and m.user_id=p.customer_user_id
      and m.content->'blocks'->0->>'type'='text'
    where p.enterprise_id=${enterpriseId} and p.lead_id=${leadId}
      and f.key=any(${sql.param(profileKeys)}::text[])
      and s.draft_fields->f.key->>'sourceMessageId'=m.id::text
      and coalesce(s.draft_fields->f.key->>'text','')<>''
      and strpos(m.content->'blocks'->0->>'text',s.draft_fields->f.key->>'text')>0`);
  const fields = profileKeys.flatMap<StaffProfileField>(key => {
    const captured = automatic.find(item => item.key === key);
    const approved = shared?.fields.find(item => item.key === key);
    if (captured && (!approved || new Date(captured.recorded_at) > new Date(approved.confirmedAt))) {
      return [{ key, label: profileFieldLabels[key], value: captured.value, source: 'consultation', recordedAt: captured.recorded_at }];
    }
    if (!approved) return [];
    const { confirmedAt, ...field } = approved;
    return [{ ...field, recordedAt: confirmedAt }];
  });
  return fields.length ? { leadId, fields } : null;
}

/** Store pointers only to fields from the captured message. A draft may also
 * contain earlier statements and model summaries that are private to chat. */
export async function captureStaffRenovationProfile(tx: PostgresTransaction, enterpriseId: string, ownerId: string,
  conversation: Row, summaryId: string, source: { id: string; text: string }, fields: DraftRequirements) {
  const entry = conversation.entry_snapshot as Row | undefined;
  const leadId = entry?.staffProfileLeadId;
  if (typeof leadId !== 'string' || entry?.activePublicSite || entry?.retentionRedacted
    || conversation.purpose !== 'customer_consultation' || conversation.mode !== 'ai') return;
  const keys = profileKeys.filter(key => {
    const field = fields[key];
    return field?.sourceMessageId === source.id && field.text && source.text.includes(field.text);
  });
  if (!keys.length) return;
  // The lead lock serializes first capture, older worker receipts, and revocation.
  const lead = await one(tx, sql`select id from app.leads where enterprise_id=${enterpriseId} and id=${leadId}
    and customer_user_id=${ownerId} and archived_at is null and status<>'closed' for no key update`);
  if (!lead) return;
  const profile = await one<{ automatic_field_sources: Record<string, AutomaticSource>; automatic_revoked_at: string | null }>(
    tx, sql`select automatic_field_sources,automatic_revoked_at from app.assistant_renovation_profiles
      where enterprise_id=${enterpriseId} and lead_id=${leadId} for update`);
  if (profile?.automatic_revoked_at && new Date(conversation.created_at as string | Date) <= new Date(profile.automatic_revoked_at)) return;
  const sources = { ...profile?.automatic_field_sources };
  const newer = keys.filter(key => !sources[key] || BigInt(sources[key].messageId) <= BigInt(source.id));
  if (!newer.length) return;
  for (const key of newer) sources[key] = { summaryId, messageId: source.id };
  await tx.execute(sql`insert into app.assistant_renovation_profiles
    (enterprise_id,lead_id,customer_user_id,version,shared,field_sources,automatic_field_sources)
    values(${enterpriseId},${leadId},${ownerId},1,false,'{}'::jsonb,${JSON.stringify(sources)}::jsonb)
    on conflict (enterprise_id,lead_id) do update set customer_user_id=excluded.customer_user_id,
      automatic_field_sources=excluded.automatic_field_sources`);
}

export async function renovationProfileOptions(tx: PostgresTransaction, enterpriseId: string, ownerId: string, entry: Row) {
  if (entry.retentionRedacted || entry.activePublicSite) return { leadId: null, options: [], current: null };
  const bound = renovationLeadId(entry);
  const leads = await rows(tx, sql`select l.id,l.name,l.community_name,l.city,l.area,coalesce(p.version,0) as version,coalesce(p.shared,false) as shared
    from app.leads l left join app.assistant_renovation_profiles p on p.enterprise_id=l.enterprise_id
      and p.lead_id=l.id and p.customer_user_id=l.customer_user_id
    where l.enterprise_id=${enterpriseId} and l.customer_user_id=${ownerId} and l.archived_at is null and l.status<>'closed'
      ${bound ? sql`and l.id=${bound}` : sql``} order by l.id desc`);
  return {
    leadId: bound,
    options: leads.map(lead => ({
      id: String(lead.id), label: [lead.community_name || lead.name || '服务档案', lead.city, lead.area ? `${lead.area}㎡` : null, `#${lead.id}`].filter(Boolean).join(' · '),
      version: Number(lead.version), shared: lead.shared === true,
    })),
    current: bound && leads.length ? await renovationProfile(tx, enterpriseId, bound) : null,
  };
}

export async function lockRenovationLead(tx: PostgresTransaction, enterpriseId: string, ownerId: string, entry: Row, leadId: string) {
  const bound = renovationLeadId(entry);
  if (entry.retentionRedacted || entry.activePublicSite || (bound && bound !== leadId)) fail('assistant_resource_not_found', 404);
  const lead = await one(tx, sql`select id from app.leads where enterprise_id=${enterpriseId} and id=${leadId} and customer_user_id=${ownerId}
    and archived_at is null and status<>'closed' for no key update`);
  if (!lead) fail('assistant_resource_not_found', 404);
  return one<{ version: number; field_sources: Record<string, string> }>(tx, sql`select version,field_sources from app.assistant_renovation_profiles
    where enterprise_id=${enterpriseId} and lead_id=${leadId} and customer_user_id=${ownerId} for update`);
}

export async function writeRenovationProfile(tx: PostgresTransaction, enterpriseId: string, ownerId: string, conversationId: string,
  leadId: string, expectedVersion: number, fields: Record<string, string>, prior?: { version: number; field_sources: Record<string, string> },
  summaryId?: string, removed: readonly string[] = []) {
  if (expectedVersion !== (prior?.version ?? 0)) fail('renovation_profile_changed', 409);
  const sources = summaryId ? { ...prior?.field_sources } : {};
  for (const key of profileKeys) {
    if (removed.includes(key)) delete sources[key];
    else if (summaryId && fields[key]) sources[key] = summaryId;
  }
  const shared = Object.keys(sources).length > 0;
  if (summaryId && !shared) fail('requirements_empty', 422);
  const saved = await one<{ version: number }>(tx, sql`insert into app.assistant_renovation_profiles
    (enterprise_id,lead_id,customer_user_id,version,shared,field_sources,automatic_revoked_at)
    values(${enterpriseId},${leadId},${ownerId},1,${shared},${JSON.stringify(sources)}::jsonb,
      case when ${!summaryId} then clock_timestamp() end)
    on conflict (enterprise_id,lead_id) do update
      set customer_user_id=excluded.customer_user_id,version=app.assistant_renovation_profiles.version+1,
        shared=excluded.shared,field_sources=excluded.field_sources,updated_at=now(),
        automatic_field_sources=case when ${!summaryId} then '{}'::jsonb else app.assistant_renovation_profiles.automatic_field_sources end,
        automatic_revoked_at=coalesce(excluded.automatic_revoked_at,app.assistant_renovation_profiles.automatic_revoked_at)
    returning version`);
  await tx.execute(sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${enterpriseId},${shared ? 'assistant.renovation_profile.shared.v1' : 'assistant.renovation_profile.withdrawn.v1'},
      'assistant_renovation_profile',${leadId},${saved!.version},${JSON.stringify({kind:'user',userId:ownerId})}::jsonb,${conversationId},
      ${JSON.stringify({ conversationId, leadId, summaryId: summaryId || null })}::jsonb)`);
  return saved!.version;
}

export async function renovationProfileRecall(tx: PostgresTransaction, actor: ActorContext, conversation: Row) {
  if (actor.principal.kind !== 'user') return null;
  const leadId = renovationLeadId(conversation.entry_snapshot as Row), ownerId = actor.principal.userId;
  if (!leadId || !await one(tx, sql`select id from app.leads where enterprise_id=${actor.enterpriseId} and id=${leadId}
    and customer_user_id=${ownerId} and archived_at is null and status<>'closed' for share`)) return null;
  const profile = await renovationProfile(tx, actor.enterpriseId, leadId);
  if (!profile) return null;
  const ref: ProfileRecallRef = { ownerId, leadId, version: profile.version, digest: fingerprint(profile.fields) };
  return { profile, ref };
}

export async function renovationRecallAvailable(tx: PostgresTransaction, enterpriseId: string, ref: ProfileRecallRef, reader?: ActorContext) {
  if (reader?.principal.kind !== 'user' || reader.enterpriseId !== enterpriseId || reader.principal.userId !== ref.ownerId) return false;
  const current = await renovationProfile(tx, enterpriseId, ref.leadId);
  return current?.version === ref.version && fingerprint(current.fields) === ref.digest;
}
