import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { assistantWritesEnabled, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { isEnterpriseManagementRole } from '@/lib/admin-user-roles';
import { id, key } from '@/lib/assistant/contracts';
import { readWorkerHeartbeat, type WorkerHeartbeat } from '@/lib/assistant/operations';
import { canManageConstructionProject } from '@/lib/construction/contracts';
import { followupAvailable } from '@/lib/construction/report-scope';
import { reportAudiences } from '@/lib/construction/report-service';
import { readSchedule } from '@/lib/construction/site-schedule';
import { readStageSettings } from '@/lib/construction/stages-store';
import { defaultConstructionStages, type ConstructionStage } from '@/lib/construction/stages';
import { reminderPolicyForStage } from './stage-reminder-policies';
import { stageDefinitions, stageForConstructionKey, stageIds, type StageId } from './stages';
import { stageKnowledgeRegistry } from './stage-knowledge';
import { pilotProjectIds, pilotScopeTable, readPilotProjectScope, type PilotProjectScope } from './pilot-project-scope';
import { stageProjectForConversation } from './stage-chat-service';

/** A read-only pilot readiness report. It never mutates business data and only
 * reads the explicitly requested enterprise inside a tenant transaction. */
export type PilotReadiness = 'ready' | 'limited' | 'blocked';
export type PilotCheckStatus = 'passed' | 'failed' | 'warning' | 'skipped';
export type PilotAccountRole = 'owner' | 'boss' | 'manager' | 'designer' | 'worker';

export type PilotIssue = {
  checkId: string;
  check: string;
  actual: string;
  reason: string;
  fix: string;
  projectId?: string;
};

export type PilotCheck = {
  id: string;
  label: string;
  scope: 'enterprise' | 'pilot';
  status: PilotCheckStatus;
  actual: string;
  evidence?: Record<string, unknown>;
};

export type PilotRoleAccount = {
  kind: 'user' | 'admin';
  id: string;
  name: string;
  projectIds: string[];
  access: 'owner' | 'member' | 'customer';
  workbench?: boolean;
  c01ConversationId?: string;
};

export type PilotRejectedAccount = {
  kind: 'user' | 'admin';
  id: string;
  name: string;
  staffRole?: string;
  reason: string;
  projectIds?: string[];
};

export type PilotProjectReport = {
  id: string;
  name: string;
  status: string;
  reportable: boolean;
  customerAccess: boolean;
  currentStageKey: string | null;
  currentStageName: string | null;
  stageValid: boolean;
  stageReason?: string;
  plan: {
    required: boolean;
    available: boolean;
    version: number;
    structurallyValid: boolean;
    currentStageScheduled: boolean;
    nodes: number;
    gaps: string[];
  };
  c01: { available: boolean; conversationId: string | null };
  members: { manager: string[]; designer: string[]; worker: string[] };
};

type PilotSelection =
  | { mode: 'pilot'; pilotId: string }
  | { mode: 'preview'; projectIds: string[] }
  | { mode: 'enterprise_audit' }
  | { mode: 'unspecified' };

type PilotScopeResult = {
  mode: PilotSelection['mode'];
  pilotId: string | null;
  configuration: PilotProjectScope | null;
  requestedProjectIds: string[];
  unavailableProjectIds: string[];
};

export type PilotReadinessReport = {
  enterpriseId: string;
  enterpriseName: string | null;
  checkedAt: string;
  readiness: PilotReadiness;
  pilotScope: PilotScopeResult;
  enterpriseChecks: PilotCheck[];
  pilotProjectChecks: PilotCheck[];
  projects: PilotProjectReport[];
  projectGaps: {
    missingStageProjectIds: string[];
    missingPlanProjectIds: string[];
    incompleteRoleProjects: Array<{ projectId: string; missingRoles: PilotAccountRole[] }>;
    missingC01ProjectIds: string[];
  };
  outsideScope: {
    activeProjects: Array<{
      projectId: string;
      name: string;
      currentStageKey: string | null;
      leadArchived: boolean;
    }>;
    reminders: {
      candidateProjectIds: string[];
      unfinishedByProject: Array<{ projectId: string; byStatus: Record<string, number> }> | null;
    };
    weeklyReports: {
      planCandidateProjectIds: string[] | null;
      pendingOrHeldByProject: Array<{ projectId: string; count: number }> | null;
    };
  };
  activeStage: {
    expectedStages: string[];
    configuredStages: string[];
    stagesVersion: number;
    stagesCustomized: boolean;
    knowledgePacksActive: string[];
    reminderPoliciesActive: string[];
    perProject: Array<{ projectId: string; stageKey: string | null; stageName: string | null; canonicalStageId: string | null; valid: boolean; reason?: string }>;
  };
  roleAccounts: Record<PilotAccountRole, PilotRoleAccount[]>;
  rejectedAccounts: PilotRejectedAccount[];
  assistantStatus: {
    configured: boolean;
    enabled: boolean;
    policyVersion: number;
    retentionDays: number;
    dailyRequests: number;
    dailyTokens: string;
    dailyCostMicros: string;
  };
  workerStatus: WorkerHeartbeat & { scope: 'global'; healthFileConfigured: boolean };
  reminderStatus: {
    total: number;
    byStatus: Record<string, number>;
    byRole: Record<string, Record<string, number>>;
    failedReasons: Record<string, number>;
    pauses: number;
  };
  weeklyReportStatus: {
    configured: boolean;
    enabled: boolean;
    projectIds: string[];
    stageKeys: string[];
    audiences: string[];
    missingAudiences: string[];
    bindingAudiences: string[];
    missingBindingAudiences: string[];
    nextWeeklyAt: string | null;
  };
  migrationStatus: {
    ledgerReadable: boolean;
    appliedMigrations: number | null;
    migrations: Array<{
      id: string;
      name: string;
      applied: boolean;
      schemaApplied: boolean;
      ledgerApplied: boolean | null;
    }>;
  };
  rlsStatus: {
    account: { role: string; database: string; superuser: boolean; bypassRls: boolean };
    tables: Array<{ table: string; exists: boolean; rls: boolean; forced: boolean; policies: number }>;
  };
  inboxStatus: {
    channels: Record<PilotAccountRole, number>;
    expectedRoles: PilotAccountRole[];
    missingChannels: PilotAccountRole[];
    managerWorkbench: number;
    ownerC01: number;
    enabledBindings: number;
  };
  blockers: PilotIssue[];
  warnings: PilotIssue[];
  checks: PilotCheck[];
};

export type PilotReadinessOptions = {
  enterpriseId: string;
  pilotId?: string;
  projectIds?: readonly string[];
  enterpriseAudit?: boolean;
  now?: Date;
  env?: NodeJS.ProcessEnv;
  migrationsFolder?: string;
};

const rlsTables = [
  'construction_stage_reminders',
  'construction_stage_reminder_pauses',
  'construction_report_settings',
  'construction_followup_bindings',
  'construction_reports',
  'construction_report_versions',
  'construction_report_deliveries',
  'assistant_conversations',
  'assistant_messages',
  pilotScopeTable,
] as const;

const migrations = [
  { id: '0128', name: '0128_xiaok_v1_stage_reminders.sql' },
  { id: '0129', name: '0129_xiaok_v1_stage_reminder_receipts.sql' },
  { id: '0130', name: '0130_xiaok_pilot_project_scopes.sql' },
] as const;

type EnterpriseRow = { id: string; name: string; status: string };
type AdminRow = { id: string; display_name: string; role: string; must_change_password: boolean; access_role: string | null };
type MembershipRow = { admin_id: string; project_id: string; role: string };
type ProjectRow = {
  id: string; name: string; status: string; customer_access: boolean; current_stage_key: string | null;
  progress_revision: number; lead_id: string; lead_archived: boolean; customer_user_id: string | null;
};
type BindingRow = { id: string; audience: string; user_id: string | null; admin_id: string | null; project_id: string | null; conversation_id: string };

const text = (value: unknown) => String(value ?? '');
const count = (value: unknown) => Number(value || 0);
const sha256 = (source: string) => createHash('sha256').update(source).digest('hex');
const hashVariants = (source: string) => new Set([
  sha256(source),
  sha256(source.replace(/\r\n/g, '\n')),
  sha256(source.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')),
]);

function issue(checkId: string, check: string, actual: string, reason: string, fix: string, projectId?: string): PilotIssue {
  return { checkId, check, actual, reason, fix, ...(projectId ? { projectId } : {}) };
}

function check(
  id: string, label: string, status: PilotCheckStatus, actual: string,
  evidence?: Record<string, unknown>,
  scope: PilotCheck['scope'] = 'pilot',
): PilotCheck {
  return { id, label, scope, status, actual, ...(evidence ? { evidence } : {}) };
}

const enterpriseCheck: typeof check = (id, label, status, actual, evidence) =>
  check(id, label, status, actual, evidence, 'enterprise');

/** Optional tables may be absent on an older database. The checker must still
 * return an explicit blocked report instead of failing the whole run. */
async function optionalRows<T>(tx: PostgresTransaction, query: Parameters<typeof rows>[1]): Promise<T[] | null> {
  return optionalRead(tx, () => rows<T>(tx, query));
}

async function optionalRead<T>(tx: PostgresTransaction, read: () => Promise<T>): Promise<T | null> {
  // PostgreSQL aborts the transaction on a missing table or a denied SELECT.
  await tx.execute(sql`savepoint pilot_optional_read`);
  try {
    return await read();
  } catch (error) {
    await tx.execute(sql`rollback to savepoint pilot_optional_read`);
    const code = (error as { cause?: { code?: string } })?.cause?.code;
    if (code === '42P01' || code === '42501' || code === '42703') return null;
    throw error;
  } finally {
    await tx.execute(sql`release savepoint pilot_optional_read`);
  }
}

async function migrationHashes(folder: string) {
  const result = new Map<string, Set<string>>();
  for (const migration of migrations) {
    try {
      result.set(migration.id, hashVariants(await readFile(path.join(folder, migration.name), 'utf8')));
    } catch {
      result.set(migration.id, new Set());
    }
  }
  return result;
}

async function c01For(tx: PostgresTransaction, eid: string, project: ProjectRow) {
  if (!project.customer_user_id || !project.customer_access) return null;
  const conversations = await rows<{ id: string; lead_linked: boolean }>(tx, sql`select c.id::text as id,
    coalesce(c.entry_snapshot->>'kind'='lead',false) as lead_linked from app.assistant_conversations c
    join app.assistant_participants ap on ap.enterprise_id=c.enterprise_id and ap.conversation_id=c.id
    where c.enterprise_id=${eid} and c.purpose='customer_consultation' and c.status='open' and c.mode='ai'
    and ap.user_id=${project.customer_user_id} and ap.status='active' and ap.participant_role='owner'
    and coalesce(c.entry_snapshot->>'retentionRedacted','false')<>'true'
    and (coalesce(c.entry_snapshot->>'kind','')<>'lead' or c.entry_snapshot->>'id'=${project.lead_id})
    order by c.id desc`);
  for (const conversation of conversations) {
    if (conversation.lead_linked) return conversation.id;
    const linked = await stageProjectForConversation(tx, eid, conversation.id, project.customer_user_id);
    if (linked && String(linked.id) === project.id) return conversation.id;
  }
  return null;
}

async function collect(tx: PostgresTransaction, eid: string, selection: PilotSelection, now: Date, env: NodeJS.ProcessEnv, folder: string) {
  const checks: PilotCheck[] = [];
  const blockers: PilotIssue[] = [];
  const warnings: PilotIssue[] = [];

  const record = (entry: PilotCheck, issues: PilotIssue[] = []) => {
    checks.push(entry);
    for (const item of issues) {
      if (entry.status === 'failed') blockers.push(item);
      else if (entry.status === 'warning') warnings.push(item);
    }
  };
  const audit = selection.mode === 'enterprise_audit';

  // ---------------------------------------------------------------- enterprise
  const enterprise = await one<EnterpriseRow>(tx, sql`select id::text as id,name,status
    from app.enterprises where id=${eid}`);
  const enterpriseActive = enterprise?.status === 'active';
  record(enterpriseCheck('enterprise.status', '企业状态', enterpriseActive ? 'passed' : 'failed',
    enterprise ? `status=${enterprise.status}` : 'not_visible', { enterpriseId: eid, name: enterprise?.name ?? null }),
  enterpriseActive ? [] : [issue('enterprise.status', '企业状态',
    enterprise ? 'status=' + enterprise.status : '当前连接账号不可见该企业',
    enterprise ? '企业未处于 active 状态。' : '企业不存在，或当前数据库账号无权查看该企业。',
    '由平台管理员确认 enterpriseId，并先将企业状态调整为 active；不要用超级用户绕过 RLS 检查。')]);

  // ---------------------------------------------------------------- assistant
  const assistant = await one(tx, sql`select enabled,policy_version,retention_days,daily_requests,daily_tokens,daily_cost_micros
    from app.assistant_enterprise_settings where enterprise_id=${eid}`);
  const assistantEnabled = assistantWritesEnabled(assistant);
  record(enterpriseCheck('assistant.enabled', 'Assistant 启用', assistantEnabled ? 'passed' : 'failed',
    assistant ? `enabled=${Boolean(assistant.enabled)},retentionDays=${count(assistant.retention_days)}` : 'not_configured',
    assistant ? {
      policyVersion: count(assistant.policy_version), retentionDays: count(assistant.retention_days),
      dailyRequests: count(assistant.daily_requests),
    } : undefined),
  assistantEnabled ? [] : [issue('assistant.enabled', 'Assistant 启用',
    assistant ? `enabled=${Boolean(assistant.enabled)},retentionDays=${count(assistant.retention_days)}` : '未配置企业 Assistant 设置',
    assistant ? 'Assistant 企业设置未启用或保留期/配额不满足写入条件。' : '缺少 assistant_enterprise_settings 记录。',
    '在企业 Assistant 设置中启用并配置保留期、每日请求/Token/费用额度。')]);

  // ---------------------------------------------------------------- projects
  const projects = await rows<ProjectRow>(tx, sql`select p.id::text as id,p.name,p.status,p.customer_access,
      p.current_stage_key,p.progress_revision,p.lead_id::text as lead_id,
      (l.archived_at is not null) as lead_archived,l.customer_user_id::text as customer_user_id
    from app.construction_projects p
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    where p.enterprise_id=${eid}
    order by p.id`);
  const enterpriseProjects = projects.filter(project => !project.lead_archived && project.status !== 'archived');
  const enterpriseProjectIds = new Set(enterpriseProjects.map(project => project.id));
  const configuration = selection.mode === 'pilot'
    ? await optionalRead(tx, () => readPilotProjectScope(tx, eid, selection.pilotId))
    : null;
  const requestedProjectIds = selection.mode === 'preview' ? selection.projectIds : configuration?.projectIds ?? [];
  const requested = new Set(requestedProjectIds);
  const unavailableProjectIds = requestedProjectIds.filter(projectId => !enterpriseProjectIds.has(projectId));
  const scopeValid = requested.size > 0 && unavailableProjectIds.length === 0
    && (selection.mode !== 'pilot' || configuration?.status === 'active');
  const pilotScope: PilotScopeResult = {
    mode: selection.mode, pilotId: selection.mode === 'pilot' ? selection.pilotId : null,
    configuration, requestedProjectIds, unavailableProjectIds,
  };
  if (!audit) {
    const unapprovedPreview = selection.mode === 'preview' && scopeValid;
    const scopeStatus = unapprovedPreview ? 'warning' : scopeValid ? 'passed' : 'failed';
    const scopeReason = unavailableProjectIds.length ? '项目在当前企业不可用。'
      : configuration?.status === 'inactive' ? '该试点范围的最新版本已停用。'
      : !requested.size ? '缺少已明确指定的非空试点项目范围。'
      : unapprovedPreview ? '本次只按传入项目试算，尚未读取企业管理员保存的范围。' : '';
    record(check('pilot.scope', '试点项目范围', scopeStatus,
      `mode=${selection.mode},projects=${requested.size},unavailable=${unavailableProjectIds.length}`, pilotScope),
    scopeReason ? [issue('pilot.scope', '试点项目范围', `projects=${requested.size}`, scopeReason,
      '由具备施工管理权限的企业管理员提交项目 ID，使用 pilotId 预检保存的范围。')] : []);
  }
  const validProjects = audit ? enterpriseProjects : scopeValid ? enterpriseProjects.filter(project => requested.has(project.id)) : [];
  const validProjectIds = new Set(validProjects.map(project => project.id));
  const outsideProjects = audit ? [] : projects.filter(project => !validProjectIds.has(project.id));
  const outsideActiveProjects = outsideProjects.filter(project => project.status === 'active');
  const activeProjects = validProjects.filter(project => project.status === 'active');
  const hasProjects = validProjects.length > 0;
  const projectCheck = (id: string, label: string, status: PilotCheckStatus, actual: string, evidence?: Record<string, unknown>) =>
    check(id, label, !audit && !hasProjects ? 'skipped' : status, actual, evidence);
  record(projectCheck('project.exists', '有效项目', hasProjects ? (activeProjects.length ? 'passed' : 'warning') : 'failed',
    `valid=${validProjects.length},active=${activeProjects.length}`,
    { valid: validProjects.map(project => project.id) }),
  !hasProjects ? [issue('project.exists', '有效项目', '0 个有效项目',
    '检查范围内没有未归档且线索未归档的施工项目。', '核对项目及对应客户线索。')]
    : activeProjects.length ? [] : [issue('project.exists', '有效项目', '0 个 active 项目',
      '现有项目均非 active，提醒、周报与进度事实不会推进。', '确认试点项目状态并恢复为 active；如项目已完工，明确不纳入试点范围。')]);

  // ---------------------------------------------------------------- stages
  const stageSettings = await readStageSettings(tx, eid);
  const stages = stageSettings.stages.length ? stageSettings.stages : defaultConstructionStages;
  const configuredKeys = stages.map(stage => stage.key);
  const expectedKeys = stageDefinitions.flatMap(stage => [...stage.constructionKeys]);
  const missingKeys = expectedKeys.filter(key => !configuredKeys.includes(key));
  const activeKnowledge = stageIds.filter(stageId => stageKnowledgeRegistry.get(stageId)?.status === 'active') as StageId[];
  const activePolicies = stageIds.filter(stageId => {
    const policy = reminderPolicyForStage(stageId);
    return policy?.status === 'active';
  });
  const missingKnowledge = stageIds.filter(stageId => !activeKnowledge.includes(stageId));
  const missingPolicies = stageIds.filter(stageId => !activePolicies.includes(stageId));
  const stagesComplete = missingKeys.length === 0 && missingKnowledge.length === 0 && missingPolicies.length === 0;
  record(enterpriseCheck('stages.configured', '十阶段配置', stagesComplete ? 'passed' : 'failed',
    `configured=${configuredKeys.length},missingKeys=${missingKeys.length},missingKnowledge=${missingKnowledge.length},missingPolicies=${missingPolicies.length}`,
    { configured: configuredKeys, missingKeys, missingKnowledge, missingPolicies }),
  stagesComplete ? [] : [issue('stages.configured', '十阶段配置',
    `缺少阶段=${missingKeys.join(',') || '无'}；缺少知识包=${missingKnowledge.join(',') || '无'}；缺少提醒策略=${missingPolicies.join(',') || '无'}`,
    '企业阶段设置或代码内十阶段配置不完整，阶段问答/提醒/周报无法覆盖全部阶段。',
    '补齐 construction_stage_settings 的十个标准阶段 key，并确认十套知识包与提醒策略均为 active。')]);

  const stageSettingsRow = await one(tx, sql`select version from app.construction_stage_settings where enterprise_id=${eid}`);

  // ---------------------------------------------------------------- per project stage, plan, C01
  const projectReports: PilotProjectReport[] = [];
  const stageIssues: PilotIssue[] = [];
  const stageWarnings: PilotIssue[] = [];
  const planIssues: PilotIssue[] = [];
  const c01Warnings: PilotIssue[] = [];
  let c01Available = 0;
  let customerProjects = 0;

  for (const project of validProjects) {
    const stageKey = project.current_stage_key;
    const stage = stageKey ? stages.find(candidate => candidate.key === stageKey) : undefined;
    const canonical = stageForConstructionKey(stageKey);
    const reportable = project.status === 'active' && !['completion', 'move_in'].includes(stageKey || '');
    const planRequired = reportable;
    let stageValid = true;
    let stageReason: string | undefined;

    if (!stageKey) {
      stageValid = false;
      stageReason = '项目未设置当前装修阶段。';
      stageIssues.push(issue('project.stage', '项目当前装修阶段', `项目 ${project.id} current_stage_key=null`,
        stageReason, '在项目进度中设置当前装修阶段；阶段必须来自企业十阶段配置。', project.id));
    } else if (!stage) {
      stageValid = false;
      stageReason = '当前阶段不在企业阶段配置中。';
      stageIssues.push(issue('project.stage', '项目当前装修阶段', `项目 ${project.id} current_stage_key=${stageKey}`,
        stageReason, '将项目当前阶段改为企业阶段配置中的有效 key，或补齐阶段配置。', project.id));
    } else if (!canonical) {
      stageReason = '当前阶段不是小K十阶段标准 key，阶段 Agent/知识包不可用。';
      stageWarnings.push(issue('project.stage', '项目当前装修阶段', `项目 ${project.id} current_stage_key=${stageKey}`,
        stageReason, '如试点需要阶段问答/提醒，改用标准阶段 key；自定义阶段仅保留基础施工事实。', project.id));
    }

    const schedule = await readSchedule(tx, eid, project as unknown as Row, stages as ConstructionStage[], { now });
    const currentStageScheduled = schedule.nodes.some(node => node.stageKey === stageKey);
    const structurallyValid = Boolean(schedule.available && schedule.valid && schedule.nodes.length > 0);
    const plan = {
      required: planRequired, available: Boolean(schedule.available), version: Number(schedule.version || 0),
      structurallyValid, currentStageScheduled, nodes: schedule.nodes.length, gaps: schedule.gaps.map(gap => gap.kind),
    };
    if (planRequired) {
      if (!schedule.available || schedule.nodes.length === 0) {
        planIssues.push(issue('project.schedule', '有效施工计划', `项目 ${project.id} 未发布施工计划`,
          '项目没有已发布的施工进度计划，节点提醒与进度红黄绿无法工作。',
          '由项目经理发布包含真实房间和阶段节点的施工计划。', project.id));
      } else if (!structurallyValid) {
        planIssues.push(issue('project.schedule', '有效施工计划', `项目 ${project.id} 计划结构无效（${schedule.gaps.map(gap => gap.kind).join(',')}）`,
          '施工计划引用了已不可用的阶段或房间。',
          '重新发布当前有效的施工计划，确保阶段和房间仍存在。', project.id));
      } else if (!currentStageScheduled) {
        planIssues.push(issue('project.schedule', '有效施工计划', `项目 ${project.id} 当前阶段未排期`,
          '已发布计划没有覆盖当前施工阶段。',
          '在计划中补充当前阶段的节点日期并重新发布。', project.id));
      }
    }

    const c01 = await c01For(tx, eid, project);
    if (c01) c01Available++;
    if (project.customer_user_id && project.customer_access) customerProjects++;
    if (!c01) {
      c01Warnings.push(issue('owner.c01', '业主 C01', `项目 ${project.id} 无开放 C01 会话`,
        '缺少可访问项目的业主或可用的 customer_consultation 会话。',
        '核对现有客户绑定、customer_access 与 C01 初始化。', project.id));
    }

    projectReports.push({
      id: project.id, name: project.name, status: project.status, reportable,
      customerAccess: project.customer_access, currentStageKey: stageKey, currentStageName: stage?.name ?? null,
      stageValid, ...(stageReason ? { stageReason } : {}), plan,
      c01: { available: !!c01, conversationId: c01 },
      members: { manager: [], designer: [], worker: [] },
    });
  }

  const stageBlocked = stageIssues.length > 0;
  record(projectCheck('project.stage', '项目当前装修阶段', stageBlocked ? 'failed' : stageWarnings.length ? 'warning' : 'passed',
    `projects=${validProjects.length},invalid=${stageIssues.length},custom=${stageWarnings.length}`,
    { perProject: projectReports.map(project => ({ projectId: project.id, stageKey: project.currentStageKey, valid: project.stageValid })) }),
  stageBlocked ? stageIssues : stageWarnings);
  if (stageBlocked) warnings.push(...stageWarnings);

  const planFailed = planIssues.length > 0;
  record(projectCheck('project.schedule', '有效施工计划', planFailed ? 'failed' : 'passed',
    `required=${projectReports.filter(project => project.plan.required).length},invalid=${planIssues.length}`,
    { plans: projectReports.map(project => ({ projectId: project.id, ...project.plan })) }), planIssues);

  // ---------------------------------------------------------------- role accounts
  const projectSet = JSON.stringify([...validProjectIds]);
  const memberships = await rows<MembershipRow>(tx, sql`select m.admin_id::text as admin_id,m.project_id::text as project_id,m.role
    from app.construction_members m join app.admin_users a on a.enterprise_id=m.enterprise_id and a.id=m.admin_id
    where m.enterprise_id=${eid} and m.active and a.status='active'
    and ${projectSet}::jsonb ? m.project_id::text order by m.admin_id,m.project_id`);
  const membershipsByAdmin = new Map<string, MembershipRow[]>();
  for (const member of memberships) {
    const assigned = membershipsByAdmin.get(member.admin_id);
    if (assigned) assigned.push(member);
    else membershipsByAdmin.set(member.admin_id, [member]);
  }
  const memberAdminIds = JSON.stringify([...membershipsByAdmin.keys()]);
  const admins = await rows<AdminRow>(tx, sql`select a.id::text as id,a.display_name,a.role,a.must_change_password,
      app.construction_actor_access(a.id,${eid}::bigint) as access_role
    from app.admin_users a where a.enterprise_id=${eid} and a.status='active'
    and (${audit} or a.role in ('enterprise_admin','admin','super_admin') or ${memberAdminIds}::jsonb ? a.id::text)
    order by a.id`);
  const rejected: PilotRejectedAccount[] = [];
  const reportById = new Map(projectReports.map(project => [project.id, project]));

  const ownerAccounts: PilotRoleAccount[] = [];
  // Customers are platform-level identities; app.users is tenant-scoped and
  // often hides them from the enterprise transaction. Bind owners from the
  // lead/project relationship instead of treating an invisible user row as no
  // owner. C01 availability below still verifies the real conversation.
  for (const project of validProjects) {
    const ownerId = project.customer_user_id;
    if (!ownerId) continue;
    const ownerName = '客户 ' + ownerId;
    if (!project.customer_access) {
      rejected.push({ kind: 'user', id: ownerId, name: ownerName,
        reason: 'customer_access_disabled', projectIds: [project.id] });
      continue;
    }
    const existing = ownerAccounts.find(account => account.id === ownerId);
    const c01 = reportById.get(project.id)?.c01.conversationId;
    if (existing) {
      existing.projectIds.push(project.id);
      if (c01 && !existing.c01ConversationId) existing.c01ConversationId = c01;
      continue;
    }
    ownerAccounts.push({ kind: 'user', id: ownerId, name: ownerName,
      projectIds: [project.id], access: 'customer', ...(c01 ? { c01ConversationId: c01 } : {}) });
  }

  const bossAccounts: PilotRoleAccount[] = [];
  const managerAccounts: PilotRoleAccount[] = [];
  const designerAccounts: PilotRoleAccount[] = [];
  const workerAccounts: PilotRoleAccount[] = [];
  const staffRoles = { manager: managerAccounts, designer: designerAccounts, worker: workerAccounts };

  for (const admin of admins) {
    const adminId = admin.id;
    const projectsForAdmin = membershipsByAdmin.get(adminId) ?? [];
    const projectIds = projectsForAdmin.map(member => member.project_id);
    const access = admin.access_role === 'owner' || admin.access_role === 'member' ? admin.access_role : null;
    const base = { kind: 'admin' as const, id: adminId, name: admin.display_name || '未命名员工', projectIds };
    const reject = (reason: string) => rejected.push({
      kind: 'admin', id: adminId, name: admin.display_name || '未命名员工', staffRole: admin.role,
      reason, ...(projectIds.length ? { projectIds } : {}),
    });
    const roles = new Set(projectsForAdmin.map(member => member.role));

    if (isEnterpriseManagementRole(admin.role)) {
      if (admin.access_role === 'owner' && !admin.must_change_password) {
        bossAccounts.push({ ...base, access: 'owner', projectIds: validProjects.map(project => project.id) });
      } else {
        reject(admin.must_change_password ? 'must_change_password' : 'no_cross_project_owner_access');
      }
    }

    for (const role of ['manager', 'designer', 'worker'] as const) {
      if (!roles.has(role)) continue;
      if (!access || admin.must_change_password) {
        reject(admin.must_change_password ? 'must_change_password' : 'no_construction_actor_access');
        continue;
      }
      const roleProjects = projectsForAdmin.filter(member => member.role === role).map(member => member.project_id);
      staffRoles[role].push({ ...base, access, projectIds: roleProjects,
        ...(role === 'manager' ? { workbench: canManageConstructionProject(false, role) } : {}) });
      for (const projectId of roleProjects) reportById.get(projectId)?.members[role].push(adminId);
    }
    if (!roles.size && ['designer', 'construction_staff'].includes(admin.role)) {
      reject(admin.must_change_password ? 'must_change_password' : 'no_active_project_membership');
    }
  }

  const roleChecks: Array<{ role: PilotAccountRole; label: string; accounts: PilotRoleAccount[]; fix: string }> = [
    { role: 'owner', label: '业主账号', accounts: ownerAccounts, fix: '为项目线索绑定真实客户账号并开启 customer_access。' },
    { role: 'boss', label: '老板跨项目权限', accounts: bossAccounts, fix: '为企业负责人配置 enterprise_admin（或等价管理角色），并确认 construction_actor_access 返回 owner。' },
    { role: 'manager', label: '项目经理', accounts: managerAccounts, fix: '在项目中设置 active 的 manager 成员，并确认其具备 construction-projects 菜单权限。' },
    { role: 'designer', label: '设计师项目成员', accounts: designerAccounts, fix: '为设计师账号建立 active 的项目 designer 成员关系。' },
    { role: 'worker', label: '施工人员任务权限', accounts: workerAccounts, fix: '为施工人员账号建立 active 的项目 worker 成员关系。' },
  ];
  for (const role of roleChecks) {
    const passed = role.accounts.length > 0;
    const checkRole = role.role === 'boss' ? enterpriseCheck : projectCheck;
    record(checkRole(`role.${role.role}`, role.label, passed ? 'passed' : 'failed',
      `authorized=${role.accounts.length}`, { accounts: role.accounts.map(account => ({ id: account.id, projectIds: account.projectIds })) }),
    passed ? [] : [issue(`role.${role.role}`, role.label, '没有具备项目权限的账号',
      '企业可能存在同名角色账号，但没有有效的项目成员关系或施工访问权限。',
      `${role.fix} 不得仅凭账号存在就认定具备项目权限。`)]);
  }

  const workbenchManagers = managerAccounts.filter(account => account.workbench);
  record(projectCheck('manager.workbench', '项目经理工作台', workbenchManagers.length ? 'passed' : 'failed',
    `workbenchManagers=${workbenchManagers.length}`, { managers: workbenchManagers.map(account => account.id) }),
  workbenchManagers.length ? [] : [issue('manager.workbench', '项目经理工作台', '没有可用的经理工作台成员',
    '项目经理没有在有效项目上形成 manager 成员关系，工地工作台不会出现该项目的待办。',
    '为项目经理建立 active 的 manager 成员关系，并确认其可访问 construction-projects。')]);

  const projectsWithOwner = new Set(ownerAccounts.flatMap(account => account.projectIds));
  const roleGaps = projectReports.map(project => {
    const missingRoles: PilotAccountRole[] = [];
    if (!projectsWithOwner.has(project.id)) missingRoles.push('owner');
    if (!bossAccounts.length) missingRoles.push('boss');
    for (const role of ['manager', 'designer', 'worker'] as const) {
      if (!project.members[role].length) missingRoles.push(role);
    }
    return { projectId: project.id, missingRoles };
  }).filter(project => project.missingRoles.length);
  if (!audit) {
    record(projectCheck('project.role_coverage', '试点项目角色成员', roleGaps.length ? 'failed' : 'passed',
      `incomplete=${roleGaps.length}`, { projects: roleGaps }), roleGaps.map(({ projectId, missingRoles }) =>
      issue('project.role_coverage', '试点项目角色成员', missingRoles.join(','), '该项目缺少有效角色账号或成员关系。',
        '核对当前项目的业主、经理、设计师和施工人员，并检查企业管理权限。', projectId)));
  }

  // ---------------------------------------------------------------- C01
  const c01Failed = customerProjects === 0 || c01Available === 0;
  record(projectCheck('owner.c01', '业主 C01', c01Failed ? 'failed' : c01Warnings.length ? 'warning' : 'passed',
    `customerProjects=${customerProjects},available=${c01Available}`,
    { conversations: projectReports.map(project => ({ projectId: project.id, available: project.c01.available })) }),
  c01Failed ? [issue('owner.c01', '业主 C01',
    customerProjects === 0 ? '没有开启 customer_access 的客户项目' : '没有开放的 C01 会话',
    customerProjects === 0 ? '业主没有可访问的项目，C01 无法绑定项目事实。' : '客户项目存在，但没有 open/ai 的 customer_consultation 会话。',
    '确认项目 customer_access 已开启，并按现有 C01 初始化流程建立客户会话；不要伪造会话或消息。')] : c01Warnings);

  // ---------------------------------------------------------------- reports
  const reportSettings = await optionalRows<Row>(tx, sql`select enabled,timezone,daily_time,weekly_time,weekly_day,project_ids,stage_keys,
      audiences,next_weekly_at,next_daily_at,version from app.construction_report_settings where enterprise_id=${eid}`);
  const settings = reportSettings?.[0];
  const reportEnabled = Boolean(settings?.enabled);
  const configuredAudiences = Array.isArray(settings?.audiences) ? settings!.audiences.map(String) : [...reportAudiences];
  const missingAudiences = reportAudiences.filter(audience => !configuredAudiences.includes(audience));
  const configuredProjectIds = Array.isArray(settings?.project_ids) ? settings!.project_ids.map(String) : [];
  const configuredStageKeys = Array.isArray(settings?.stage_keys) ? settings!.stage_keys.map(String) : [];
  const unknownProjectIds = configuredProjectIds.filter(id => !enterpriseProjectIds.has(id));
  const unknownStageKeys = configuredStageKeys.filter(key => !configuredKeys.includes(key));
  const matchesWeeklyPlan = (project: ProjectRow) => reportEnabled && !project.lead_archived && project.status === 'active'
    && !['completion', 'move_in'].includes(project.current_stage_key || '')
    && (!configuredProjectIds.length || configuredProjectIds.includes(project.id))
    && (!configuredStageKeys.length || configuredStageKeys.includes(project.current_stage_key || ''));
  const reportableInScope = enterpriseProjects.filter(matchesWeeklyPlan);
  const planWarnings: PilotIssue[] = [];
  if (reportEnabled) {
    if (unknownProjectIds.length) {
      planWarnings.push(issue('report.plan', '企业报告计划', `项目范围包含不可用项目 ${unknownProjectIds.join(',')}`,
        '报告计划含当前企业内不可用的项目引用。', '由企业管理员核对现有报告计划。'));
    }
    if (!reportableInScope.length) {
      planWarnings.push(issue('report.plan', '企业报告计划', '当前范围内没有可生成周报的 active 项目',
        '报告计划已启用，但项目范围没有可生成报告的 active 项目。', '将至少一个 active 且未完工项目纳入报告范围。'));
    }
    if (unknownStageKeys.length) {
      planWarnings.push(issue('report.plan', '企业报告计划', `阶段范围包含未配置阶段 ${unknownStageKeys.join(',')}`,
        '报告计划引用了当前阶段设置中不存在的阶段 key。', '清理报告计划阶段范围或补齐阶段配置。'));
    }
  }
  record(enterpriseCheck('report.plan', '企业报告计划', reportEnabled ? (planWarnings.length ? 'warning' : 'passed') : 'failed',
    settings ? `enabled=${reportEnabled},projects=${configuredProjectIds.length},stages=${configuredStageKeys.length}` : 'not_configured',
    settings ? { version: count(settings.version), audiences: configuredAudiences } : undefined),
  reportEnabled ? planWarnings : [issue('report.plan', '企业报告计划',
    settings ? 'enabled=false' : '未配置 construction_report_settings',
    '周报依赖企业报告计划；未启用时不会生成或投递周报。',
    '在周报设置中启用报告计划，配置项目范围、四角色受众和周期。')]);

  if (!audit) {
    const missingCoverage = validProjects.filter(project => reportById.get(project.id)?.reportable && !matchesWeeklyPlan(project));
    record(projectCheck('pilot.weekly_plan', '试点项目周报计划覆盖',
      !reportEnabled ? 'skipped' : missingCoverage.length ? 'warning' : 'passed',
      `outsidePlan=${missingCoverage.length}`, { projectIds: missingCoverage.map(project => project.id) }),
    reportEnabled ? missingCoverage.map(project => issue('pilot.weekly_plan', '试点项目周报计划覆盖',
      '企业当前周报计划未覆盖该项目', '项目或阶段不在现有报告计划范围内。',
      '由企业管理员核对报告计划的项目和阶段条件。', project.id)) : []);
  }

  const audienceWarnings = reportEnabled && missingAudiences.length
    ? [issue('report.audiences', '四角色周报受众', `缺少受众 ${missingAudiences.join(',')}`,
      '报告计划受众未覆盖四端角色，对应角色不会收到周报。',
      '在报告计划中启用 customer/worker/designer/boss 四类受众。')]
    : [];
  record(enterpriseCheck('report.audiences', '四角色周报受众', !reportEnabled ? 'skipped' : missingAudiences.length ? 'warning' : 'passed',
    !reportEnabled ? 'skipped' : `configured=${configuredAudiences.length},missing=${missingAudiences.length}`,
    { audiences: configuredAudiences }), audienceWarnings);

  const bindings = await optionalRows<BindingRow>(tx, sql`select id::text as id,audience,user_id::text as user_id,
      admin_id::text as admin_id,project_id::text as project_id,conversation_id::text as conversation_id
    from app.construction_followup_bindings where enterprise_id=${eid} and status='enabled' order by id`);
  const availableBindings: BindingRow[] = [];
  for (const binding of bindings || []) {
    if (!audit) {
      const eligible = binding.audience === 'customer' ? binding.project_id && validProjectIds.has(binding.project_id)
        : binding.audience === 'boss' ? hasProjects && bossAccounts.some(account => account.id === binding.admin_id)
        : binding.admin_id && membershipsByAdmin.has(binding.admin_id);
      if (!eligible) continue;
    }
    if (await followupAvailable(tx, eid, binding as unknown as Row)) availableBindings.push(binding);
  }
  const bindingAudiences = [...new Set(availableBindings.map(binding => binding.audience))];
  const missingBindingAudiences = configuredAudiences.filter(audience => !bindingAudiences.includes(audience));
  const bindingWarnings = reportEnabled && missingBindingAudiences.length
    ? [issue('report.audiences', '四角色周报受众', `缺少可用周报会话 ${missingBindingAudiences.join(',')}`,
      '受众已配置，但没有启用且可访问的 construction_followup 会话，周报无法投递。',
      '启用报告计划后由现有发现流程创建会话，或按现有跟进会话流程补齐；不要手工伪造消息。')]
    : [];
  if (audit && bindingWarnings.length) {
    const target = checks.find(entry => entry.id === 'report.audiences');
    if (target) {
      target.status = 'warning';
      target.actual += `,可用会话受众=${bindingAudiences.length}`;
      warnings.push(...bindingWarnings);
    }
  }
  if (!audit) {
    record(projectCheck('report.bindings', '试点项目周报会话',
      !reportEnabled ? 'skipped' : bindingWarnings.length ? 'warning' : 'passed',
      `coveredAudiences=${bindingAudiences.length}`, { bindingAudiences, missingBindingAudiences }), bindingWarnings);
  }

  // ---------------------------------------------------------------- worker
  const heartbeat = await readWorkerHeartbeat(env, undefined, now.getTime());
  const workerFresh = heartbeat.freshness === 'fresh';
  record(enterpriseCheck('worker.heartbeat', 'Assistant Worker 心跳', workerFresh ? 'passed' : 'failed',
    `freshness=${heartbeat.freshness},ageSeconds=${heartbeat.ageSeconds}`,
    { lastSuccessAt: heartbeat.lastSuccessAt, healthFileConfigured: Boolean(env.ASSISTANT_WORKER_HEALTH_FILE?.trim()) }),
  workerFresh ? [] : [issue('worker.heartbeat', 'Assistant Worker 心跳',
    heartbeat.freshness === 'stale' ? `最近成功心跳 ${heartbeat.ageSeconds} 秒前` : '无可用 Worker 心跳',
    'Assistant Worker 未运行、未成功执行或健康文件不可读；提醒与周报事实不会推进。',
    '启动 assistant-worker 并确认 /api/internal/assistant/jobs/run 的近期成功心跳；同时检查 ASSISTANT_WORKER_HEALTH_FILE。')]);

  // ---------------------------------------------------------------- migrations
  const hashes = await migrationHashes(folder);
  const ledger = await optionalRows<{ hash: string }>(tx, sql`select hash from app.__drizzle_migrations order by id`);
  const migration0128 = await one(tx, sql`select
      (to_regclass('app.construction_stage_reminders') is not null) as reminders,
      (to_regclass('app.construction_stage_reminder_pauses') is not null) as pauses`);
  const migration0129 = await one(tx, sql`select
      exists(select 1 from pg_attribute where attrelid=to_regclass('app.construction_stage_reminders') and attname='conversation_id' and not attisdropped) as conversation_id,
      exists(select 1 from pg_attribute where attrelid=to_regclass('app.construction_stage_reminders') and attname='message_id' and not attisdropped) as message_id,
      exists(select 1 from pg_constraint where conrelid=to_regclass('app.construction_stage_reminders') and conname='construction_stage_reminders_receipt_check') as receipt_check`);
  const migration0130 = await one(tx, sql`select
      exists(select 1 from pg_trigger where tgrelid=to_regclass('app.xiaok_pilot_project_scopes')
        and tgname='xiaok_pilot_projects_available' and tgenabled in ('O','A') and not tgisinternal) as project_guard`);
  const schemaApplied: Record<string, boolean> = {
    '0128': Boolean(migration0128?.reminders && migration0128?.pauses),
    '0129': Boolean(migration0129?.conversation_id && migration0129?.message_id && migration0129?.receipt_check),
    '0130': Boolean(migration0130?.project_guard),
  };
  const migrationResults = migrations.map(migration => {
    const expected = hashes.get(migration.id) || new Set<string>();
    const ledgerApplied = ledger ? ledger.some(row => expected.has(String(row.hash))) : null;
    return {
      id: migration.id, name: migration.name, applied: schemaApplied[migration.id],
      schemaApplied: schemaApplied[migration.id], ledgerApplied,
    };
  });
  const missingMigrations = migrationResults.filter(migration => !migration.schemaApplied || migration.ledgerApplied === false);
  const migrationLabel = '迁移 0128/0129/0130';
  record(enterpriseCheck('database.migrations', migrationLabel, missingMigrations.length ? 'failed' : 'passed',
    migrationResults.map(migration => `${migration.id}:schema=${migration.schemaApplied},ledger=${migration.ledgerApplied}`).join(';'),
    { ledgerReadable: ledger !== null, appliedMigrations: ledger?.length ?? null }),
  missingMigrations.length ? [issue('database.migrations', migrationLabel,
    missingMigrations.map(migration => migration.id).join(','),
    '提醒或试点配置迁移的结构缺失，或可读迁移账本与文件哈希不匹配。',
    '核对迁移文件和数据库结构，按部署流程备份并执行已授权的迁移。')] : []);

  // ---------------------------------------------------------------- account + RLS
  const account = (await one(tx, sql`select current_user as role,current_database() as database,
      (select rolsuper from pg_roles where rolname=current_user) as superuser,
      (select rolbypassrls from pg_roles where rolname=current_user) as bypass_rls`))!;
  const accountSafe = !account.superuser && !account.bypass_rls;
  record(enterpriseCheck('database.account', '数据库业务账号', accountSafe ? 'passed' : 'failed',
    `role=${text(account.role)},superuser=${Boolean(account.superuser)},bypassRls=${Boolean(account.bypass_rls)}`,
    { database: text(account.database) }),
  accountSafe ? [] : [issue('database.account', '数据库业务账号', `role=${text(account.role)} 为超级用户或可绕过 RLS`,
    '业务连接使用超级用户/bypassrls 会绕过企业隔离。',
    '改用非超级用户业务账号（如 sfp_app），并保持 FORCE ROW LEVEL SECURITY；不要关闭 RLS。')]);

  const rlsList = sql.raw(rlsTables.map(table => `'${table}'`).join(','));
  const rlsRows = await rows<{ relname: string; rls: boolean; forced: boolean; policies: number }>(tx, sql`select c.relname,
      c.relrowsecurity as rls,c.relforcerowsecurity as forced,
      (select count(*)::int from pg_policies p where p.schemaname='app' and p.tablename=c.relname) as policies
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='app' and c.relname in (${rlsList})`);
  const rlsResults = rlsTables.map(table => {
    const row = rlsRows.find(candidate => candidate.relname === table);
    return { table, exists: !!row, rls: Boolean(row?.rls), forced: Boolean(row?.forced), policies: count(row?.policies) };
  });
  const rlsInvalid = rlsResults.filter(row => !row.exists || !row.rls || !row.forced || row.policies === 0);
  record(enterpriseCheck('database.rls', '提醒/周报/试点范围 RLS',
    rlsInvalid.length ? 'failed' : 'passed',
    `tables=${rlsResults.length},invalid=${rlsInvalid.length}`,
    { tables: rlsResults }),
  rlsInvalid.length ? [issue('database.rls', '提醒/周报/试点范围 RLS',
    rlsInvalid.map(row => `${row.table}(exists=${row.exists},rls=${row.rls},forced=${row.forced},policies=${row.policies})`).join(','),
    '相关表或强制租户 RLS 未就绪。',
    '核对迁移并确认租户策略、ENABLE 和 FORCE ROW LEVEL SECURITY。')] : []);

  // ---------------------------------------------------------------- reminders + inbox
  const reminderRows = await optionalRows<{ target_role: string; status: string; last_error: string | null; count: number }>(tx,
    sql`select target_role,status,case when status='failed' then last_error end as last_error,count(*)::int as count
      from app.construction_stage_reminders where enterprise_id=${eid}
      and (${audit} or ${projectSet}::jsonb ? project_id::text)
      group by 1,2,3 order by 1,2,3`);
  const pauseRow = await optionalRows<{ count: number }>(tx, sql`select count(*)::int as count
    from app.construction_stage_reminder_pauses where enterprise_id=${eid} and (${audit} or ${projectSet}::jsonb ? project_id::text)`);
  const byStatus: Record<string, number> = {};
  const byRole: Record<string, Record<string, number>> = {};
  const failedReasons = new Map<string, number>();
  for (const row of reminderRows || []) {
    byStatus[row.status] = count(byStatus[row.status]) + count(row.count);
    byRole[row.target_role] = byRole[row.target_role] || {};
    byRole[row.target_role][row.status] = count(byRole[row.target_role][row.status]) + count(row.count);
    if (row.status === 'failed') {
      const reason = row.last_error || 'unknown';
      failedReasons.set(reason, count(failedReasons.get(reason)) + count(row.count));
    }
  }
  const failedReasonCounts = Object.fromEntries(failedReasons);
  const reminderTotal = Object.values(byStatus).reduce((sum, value) => sum + value, 0);
  const failedReminders = count(byStatus.failed);
  const reminderAvailable = reminderRows !== null;
  record(projectCheck('reminder.state', '提醒运行状态', !reminderAvailable ? 'skipped' : failedReminders ? 'warning' : 'passed',
    !reminderAvailable ? '提醒表不可用（由迁移检查阻断）' : `total=${reminderTotal},failed=${failedReminders},paused=${count(byStatus.paused)}`,
    reminderAvailable ? { byStatus, byRole, failedReasons: failedReasonCounts } : undefined),
  reminderAvailable && failedReminders ? [issue('reminder.state', '提醒运行状态', `存在 ${failedReminders} 条 failed 提醒`,
    '提醒投递失败，可能缺少站内会话、收件人权限被撤销或 Worker 未运行。',
    `按 last_error 修复收件入口: ${[...failedReasons.keys()].join(',') || 'unknown'}。`)] : []);

  const outsideIds = JSON.stringify(outsideProjects.map(project => project.id));
  const outsideReminders = outsideProjects.length
    ? await optionalRows<{ project_id: string; status: string; count: number }>(tx, sql`select project_id::text,status,count(*)::int as count
        from app.construction_stage_reminders where enterprise_id=${eid} and ${outsideIds}::jsonb ? project_id::text
        and status in ('pending','failed','paused') group by project_id,status order by project_id,status`)
    : [];
  const existingDeliveries = outsideProjects.length
    ? await optionalRows<{ project_id: string; count: number }>(tx, sql`select p.project->>'id' as project_id,count(distinct d.event_id)::int as count
        from app.construction_report_deliveries d join app.construction_reports r
          on r.enterprise_id=d.enterprise_id and r.id=d.report_id
        join app.construction_report_versions v
          on v.enterprise_id=d.enterprise_id and v.report_id=d.report_id and v.revision=d.revision
        cross join lateral jsonb_array_elements(case when jsonb_typeof(v.facts->'projects')='array'
          then v.facts->'projects' else '[]'::jsonb end) p(project)
        where d.enterprise_id=${eid} and r.kind='weekly' and d.state in ('pending','held')
        and ${outsideIds}::jsonb ? (p.project->>'id') group by 1 order by 1`)
    : [];
  const remindersByProject = new Map<string, Record<string, number>>();
  for (const row of outsideReminders || []) {
    const statusCounts = remindersByProject.get(row.project_id) ?? {};
    statusCounts[row.status] = count(row.count);
    remindersByProject.set(row.project_id, statusCounts);
  }
  const reminderCandidates = outsideActiveProjects.filter(project => {
    const stage = stageForConstructionKey(project.current_stage_key);
    return !project.lead_archived && !!stage && reminderPolicyForStage(stage.stageId)?.status === 'active';
  }).map(project => project.id);
  const weeklyPlanCandidates = reportSettings === null ? null : outsideActiveProjects.filter(matchesWeeklyPlan).map(project => project.id);
  const outsideScope: PilotReadinessReport['outsideScope'] = {
    activeProjects: outsideActiveProjects.map(project => ({
      projectId: project.id, name: project.name, currentStageKey: project.current_stage_key, leadArchived: project.lead_archived,
    })),
    reminders: {
      candidateProjectIds: reminderCandidates,
      unfinishedByProject: outsideReminders === null ? null : [...remindersByProject].map(([projectId, byStatus]) => ({ projectId, byStatus })),
    },
    weeklyReports: {
      planCandidateProjectIds: weeklyPlanCandidates,
      pendingOrHeldByProject: existingDeliveries?.map(row => ({ projectId: row.project_id, count: count(row.count) })) ?? null,
    },
  };
  const outsideImpact = new Set([...reminderCandidates, ...(weeklyPlanCandidates ?? []), ...remindersByProject.keys(),
    ...(outsideScope.weeklyReports.pendingOrHeldByProject?.map(project => project.projectId) ?? [])]);
  if (outsideImpact.size) {
    record(check('pilot.outside_delivery', '范围外提醒与周报', 'warning', `projects=${outsideImpact.size}`, {
      projectIds: [...outsideImpact],
    }), [issue('pilot.outside_delivery', '范围外提醒与周报', `${outsideImpact.size} 个范围外项目有现有规则或待处理投递`,
      '现有 Worker 和企业报告计划独立运行，试点范围没有约束这些规则或存量投递。',
      '试点触达启用前，单独核定通知边界及存量投递。')]);
  }

  const c01Channel = projectReports.filter(project => project.c01.available).length;
  const customerBindingChannel = availableBindings.filter(binding => binding.audience === 'customer').length;
  const ownerChannel = c01Channel + customerBindingChannel;
  const managerChannel = workbenchManagers.length;
  const bossChannel = availableBindings.filter(binding => binding.audience === 'boss').length;
  const designerChannel = availableBindings.filter(binding => binding.audience === 'designer').length;
  const workerChannel = availableBindings.filter(binding => binding.audience === 'worker').length;
  const channels: Record<PilotAccountRole, number> = {
    owner: ownerChannel, boss: bossChannel, manager: managerChannel, designer: designerChannel, worker: workerChannel,
  };
  const expectedRoles: PilotAccountRole[] = [];
  if (ownerAccounts.length) expectedRoles.push('owner');
  if (bossAccounts.length) expectedRoles.push('boss');
  if (managerAccounts.length) expectedRoles.push('manager');
  if (designerAccounts.length) expectedRoles.push('designer');
  if (workerAccounts.length) expectedRoles.push('worker');
  const missingChannels = expectedRoles.filter(role => channels[role] === 0);
  const anyChannel = Object.values(channels).some(value => value > 0);
  const inboxWarnings = missingChannels.length
    ? [issue('inbox.channel', '站内消息入口', `缺少入口: ${missingChannels.join(',')}`,
      '对应角色没有可写的站内会话；提醒或周报会进入 failed/no_inbox。',
      '为缺少入口的角色建立现有跟进会话，或接受该角色只使用经理工作台；不要伪造消息回执。')]
    : [];
  const enabledBindingCount = audit ? bindings?.length ?? 0 : availableBindings.length;
  record(projectCheck('inbox.channel', '站内消息入口', !anyChannel ? 'failed' : inboxWarnings.length ? 'warning' : 'passed',
    `owner=${ownerChannel},manager=${managerChannel},boss=${bossChannel},designer=${designerChannel},worker=${workerChannel}`,
    { expectedRoles, missingChannels, enabledBindings: enabledBindingCount }),
  anyChannel ? inboxWarnings : [issue('inbox.channel', '站内消息入口', '没有任何可写的站内入口',
    '业主 C01、经理工作台和四角色跟进会话均不可用，提醒与周报无法送达。',
    '至少恢复业主 C01 或经理工作台入口，并为四端角色建立可用的站内会话。')]);

  const readiness: PilotReadiness = blockers.length ? 'blocked' : warnings.length ? 'limited' : 'ready';
  const rejectedByKey = new Map<string, PilotRejectedAccount>();
  for (const item of rejected) {
    const key = `${item.kind}:${item.id}:${item.reason}`;
    const existing = rejectedByKey.get(key);
    if (existing) {
      if (item.projectIds?.length) {
        existing.projectIds = [...new Set([...(existing.projectIds || []), ...item.projectIds])];
      }
    } else {
      rejectedByKey.set(key, { ...item });
    }
  }
  const rejectedAccounts = [...rejectedByKey.values()];
  const report: PilotReadinessReport = {
    enterpriseId: eid,
    enterpriseName: enterprise?.name ?? null,
    checkedAt: now.toISOString(),
    readiness,
    pilotScope,
    enterpriseChecks: checks.filter(entry => entry.scope === 'enterprise'),
    pilotProjectChecks: audit ? [] : checks.filter(entry => entry.scope === 'pilot'),
    projects: projectReports,
    projectGaps: {
      missingStageProjectIds: stageIssues.flatMap(item => item.projectId ? [item.projectId] : []),
      missingPlanProjectIds: planIssues.flatMap(item => item.projectId ? [item.projectId] : []),
      incompleteRoleProjects: roleGaps,
      missingC01ProjectIds: projectReports.filter(project => !project.c01.available).map(project => project.id),
    },
    outsideScope,
    activeStage: {
      expectedStages: expectedKeys,
      configuredStages: configuredKeys,
      stagesVersion: count(stageSettingsRow?.version ?? stageSettings.version),
      stagesCustomized: Boolean(stageSettingsRow),
      knowledgePacksActive: activeKnowledge,
      reminderPoliciesActive: activePolicies,
      perProject: projectReports.map(project => ({
        projectId: project.id, stageKey: project.currentStageKey, stageName: project.currentStageName,
        canonicalStageId: stageForConstructionKey(project.currentStageKey)?.stageId ?? null,
        valid: project.stageValid, ...(project.stageReason ? { reason: project.stageReason } : {}),
      })),
    },
    roleAccounts: {
      owner: ownerAccounts, boss: bossAccounts, manager: managerAccounts,
      designer: designerAccounts, worker: workerAccounts,
    },
    rejectedAccounts,
    assistantStatus: {
      configured: !!assistant, enabled: assistantEnabled, policyVersion: count(assistant?.policy_version),
      retentionDays: count(assistant?.retention_days), dailyRequests: count(assistant?.daily_requests),
      dailyTokens: text(assistant?.daily_tokens ?? '0'), dailyCostMicros: text(assistant?.daily_cost_micros ?? '0'),
    },
    workerStatus: {
      ...heartbeat, scope: 'global', healthFileConfigured: Boolean(env.ASSISTANT_WORKER_HEALTH_FILE?.trim()),
    },
    reminderStatus: {
      total: reminderTotal, byStatus, byRole, failedReasons: failedReasonCounts, pauses: count(pauseRow?.[0]?.count),
    },
    weeklyReportStatus: {
      configured: !!settings, enabled: reportEnabled, projectIds: configuredProjectIds, stageKeys: configuredStageKeys,
      audiences: configuredAudiences, missingAudiences, bindingAudiences, missingBindingAudiences,
      nextWeeklyAt: settings?.next_weekly_at ? new Date(String(settings.next_weekly_at)).toISOString() : null,
    },
    migrationStatus: {
      ledgerReadable: ledger !== null, appliedMigrations: ledger?.length ?? null, migrations: migrationResults,
    },
    rlsStatus: {
      account: { role: text(account.role), database: text(account.database),
        superuser: Boolean(account.superuser), bypassRls: Boolean(account.bypass_rls) },
      tables: rlsResults,
    },
    inboxStatus: {
      channels, expectedRoles, missingChannels, managerWorkbench: managerChannel,
      ownerC01: c01Channel, enabledBindings: enabledBindingCount,
    },
    blockers, warnings, checks,
  };
  return report;
}

/** An unspecified or empty selection checks the enterprise without choosing projects. */
export async function checkPilotReadiness(options: PilotReadinessOptions): Promise<PilotReadinessReport> {
  const enterpriseId = id(options.enterpriseId);
  const selections = [options.pilotId !== undefined, options.projectIds !== undefined, options.enterpriseAudit === true];
  if (selections.filter(Boolean).length > 1) throw new Error('Choose one of pilotId, projectIds or enterpriseAudit');
  const selection: PilotSelection = options.pilotId !== undefined ? { mode: 'pilot', pilotId: key(options.pilotId) }
    : options.projectIds !== undefined ? { mode: 'preview', projectIds: pilotProjectIds(options.projectIds) }
    : options.enterpriseAudit ? { mode: 'enterprise_audit' } : { mode: 'unspecified' };
  const now = options.now || new Date();
  const env = options.env || process.env;
  const folder = options.migrationsFolder || path.resolve(process.cwd(), 'drizzle');
  // Existing authorization helpers take shared locks. Use one repeatable
  // snapshot so the scope, project facts and diagnostics agree.
  return withTenantTransaction(enterpriseId, tx => collect(tx, enterpriseId, selection, now, env, folder),
    { isolationLevel: 'repeatable read' });
}
