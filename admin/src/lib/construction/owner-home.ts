import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { AssistantRepository, assistantWritesEnabled, one, rows } from '@/db/repositories/assistant-repository';
import { fail, id } from '@/lib/assistant/contracts';
import { stageIdForConstructionKey } from '@/lib/xiaok-v1/stages';
import { publicStageExperience, type StageExperience } from '@/lib/xiaok-v1/stage-experience';
import type { StageSuggestedQuestion } from '@/lib/xiaok-v1/stage-workflow-settings';
import { FollowupService } from './followup-service';
import { reportOwnerDecisions } from './site-plans';
import { currentStage, readStageSettings } from './stages-store';

// Progress/report access and video access are separate grants. Family access
// continues through the shared family page and is never an owner-home grant.
const ownerSiteAccess = (uid: string) => sql`l.customer_user_id=${uid}
  and l.archived_at is null and p.status='active' and e.status='active'
  and (p.customer_access or exists(select 1 from app.construction_camera_customer_grants g
    where g.enterprise_id=p.enterprise_id and g.project_id=p.id and g.user_id=${uid} and g.enabled))`;

export async function ownerSiteList(userId: string) {
  const uid = id(userId);
  const items = await withPlatformTransaction(tx => rows(tx, sql`select p.id::text,p.name,p.lead_id::text,p.customer_access
    from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    join app.enterprises e on e.id=p.enterprise_id
    where ${ownerSiteAccess(uid)} order by p.id desc limit 30`));
  return { items: items.map(p => ({ id: String(p.id), name: String(p.name), leadId: String(p.lead_id),
    progressAccess: p.customer_access === true })) };
}

export async function ownerSiteEnterprise(userId: string, projectId: string) {
  const uid = id(userId), pid = id(projectId);
  const located = await withPlatformTransaction(tx => one(tx, sql`select p.enterprise_id::text
    from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    join app.enterprises e on e.id=p.enterprise_id where p.id=${pid} and ${ownerSiteAccess(uid)}`));
  if (!located) fail('construction_not_found', 404);
  return String(located.enterprise_id);
}

export async function ownerSiteHome(identity: { userId: string; contextVersion: number }, projectId: string, includeDecision = false) {
  const uid = id(identity.userId), pid = id(projectId);
  const eid = await ownerSiteEnterprise(uid, pid);
  const actor = { enterpriseId: eid, principal: { kind: 'user' as const, userId: uid },
    contextVersion: identity.contextVersion, capabilities: ['assistant.followup.self' as const] };
  const { project, decision } = await withTenantTransaction(eid, async tx => {
    const identityIsCurrent = await one(tx, sql`select app.assistant_identity_is_current(${uid}::bigint,${identity.contextVersion}::integer) as valid`);
    if (!identityIsCurrent?.valid) fail('identity_context_invalid', 401);
    const repo = new AssistantRepository(tx, actor);
    const canDecide = includeDecision && assistantWritesEnabled(await repo.settings(false, 'share'));
    const p = await one(tx, sql`select p.name,p.lead_id::text,p.current_stage_key,p.customer_access,l.community_name,l.area
      from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
      join app.enterprises e on e.id=p.enterprise_id
      where p.enterprise_id=${eid} and p.id=${pid} and ${ownerSiteAccess(uid)} for share of p,l,e`);
    if (!p) fail('construction_not_found', 404);
    const progressAccess = p.customer_access === true;
    const stage = progressAccess ? currentStage(p, (await readStageSettings(tx, eid)).stages) : null;
    const stageId = progressAccess && stageIdForConstructionKey(String(p.current_stage_key));
    const agent = stageId && await one<{ questions: StageSuggestedQuestion[]; experience: StageExperience | null }>(tx, sql`select suggested_questions as questions, experience
      from app.assistant_stage_agents where enterprise_id=${eid} and stage_id=${stageId} and enabled`);
    const decisions = progressAccess && canDecide ? await reportOwnerDecisions(repo, pid, new Date()) : [];
    const pending = decisions.find(item => item.canDecide && (!item.leadId || item.leadId === String(p.lead_id)));
    return { project: { id: pid, name: String(p.name), leadId: String(p.lead_id), stageName: stage?.name || '', progressAccess,
      ...(progressAccess ? { communityName: String(p.community_name || ''), area: p.area == null ? null : Number(p.area) } : {}),
      ...(agent && agent.experience && stage ? {stageExperience:publicStageExperience(agent.experience,stage.name)} : {}),
      ...(agent && agent.questions.length ? { suggestedQuestions: agent.questions } : {}) },
      decision: pending ? { id: pending.id, title: pending.title, conversationId: pending.conversationId,
        publishedAt: pending.publishedAt } : null };
  });
  const report = project.progressAccess ? await new FollowupService(actor).latestOwnerDaily(pid) : null;
  return { project, report, decision };
}
