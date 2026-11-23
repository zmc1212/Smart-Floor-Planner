import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { fail, id } from '@/lib/assistant/contracts';
import { stageIdForConstructionKey } from '@/lib/xiaok-v1/stages';
import { publicStageExperience, type StageExperience } from '@/lib/xiaok-v1/stage-experience';
import type { StageSuggestedQuestion } from '@/lib/xiaok-v1/stage-workflow-settings';
import { FollowupService } from './followup-service';
import { currentStage, readStageSettings } from './stages-store';

// Progress/report access and video access are separate grants. Family access
// continues through the shared family page and is never an owner-home grant.
const ownerSiteAccess = (uid: string) => sql`l.customer_user_id=${uid}
  and l.archived_at is null and p.status='active' and e.status='active'
  and (p.customer_access or exists(select 1 from app.construction_camera_customer_grants g
    where g.enterprise_id=p.enterprise_id and g.project_id=p.id and g.user_id=${uid} and g.enabled))`;

export async function ownerSiteList(userId: string) {
  const uid = id(userId);
  const items = await withPlatformTransaction(tx => rows(tx, sql`select p.id::text,p.name
    from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    join app.enterprises e on e.id=p.enterprise_id
    where ${ownerSiteAccess(uid)} order by p.id desc limit 30`));
  return { items: items.map(p => ({ id: String(p.id), name: String(p.name) })) };
}

export async function ownerSiteEnterprise(userId: string, projectId: string) {
  const uid = id(userId), pid = id(projectId);
  const located = await withPlatformTransaction(tx => one(tx, sql`select p.enterprise_id::text
    from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    join app.enterprises e on e.id=p.enterprise_id where p.id=${pid} and ${ownerSiteAccess(uid)}`));
  if (!located) fail('construction_not_found', 404);
  return String(located.enterprise_id);
}

export async function ownerSiteHome(identity: { userId: string; contextVersion: number }, projectId: string) {
  const uid = id(identity.userId), pid = id(projectId);
  const eid = await ownerSiteEnterprise(uid, pid);
  const project = await withTenantTransaction(eid, async tx => {
    const identityIsCurrent = await one(tx, sql`select app.assistant_identity_is_current(${uid}::bigint,${identity.contextVersion}::integer) as valid`);
    if (!identityIsCurrent?.valid) fail('identity_context_invalid', 401);
    const p = await one(tx, sql`select p.name,p.lead_id::text,p.current_stage_key,p.customer_access
      from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
      join app.enterprises e on e.id=p.enterprise_id
      where p.enterprise_id=${eid} and p.id=${pid} and ${ownerSiteAccess(uid)} for share of p,l,e`);
    if (!p) fail('construction_not_found', 404);
    const progressAccess = p.customer_access === true;
    const stage = progressAccess ? currentStage(p, (await readStageSettings(tx, eid)).stages) : null;
    const stageId = progressAccess && stageIdForConstructionKey(String(p.current_stage_key));
    const agent = stageId && await one<{ questions: StageSuggestedQuestion[]; experience: StageExperience | null }>(tx, sql`select suggested_questions as questions, experience
      from app.assistant_stage_agents where enterprise_id=${eid} and stage_id=${stageId} and enabled`);
    return { id: pid, name: String(p.name), leadId: String(p.lead_id), stageName: stage?.name || '', progressAccess,
      ...(agent && agent.experience && stage ? {stageExperience:publicStageExperience(agent.experience,stage.name)} : {}),
      ...(agent && agent.questions.length ? { suggestedQuestions: agent.questions } : {}) };
  });
  const report = project.progressAccess ? await new FollowupService({
    enterpriseId: eid, principal: { kind: 'user', userId: uid }, contextVersion: identity.contextVersion,
    capabilities: ['assistant.followup.self'],
  }).latestOwnerDaily(pid) : null;
  return { project, report };
}
