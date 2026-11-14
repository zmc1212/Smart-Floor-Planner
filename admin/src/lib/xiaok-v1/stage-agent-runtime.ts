import { stageAgentRegistry } from './stage-agent-registry';
import { answerStageQuestion, type EnterpriseKnowledgeItem, type StageAnswer, type StageAudience } from './stage-answer';
import { buildReminderDrafts, type ReminderDraft, type ReminderProjectFacts, type StageReminderPolicy } from './reminder-engine';
import { routeStageQuestion, type StageRoute } from './stage-router';
import { stageForConstructionKey, stageIdForConstructionKey, type StageId } from './stages';
import { buildWeeklyDigest, type WeeklyReportDigest, type WeeklyReportRole, type WeeklyProjectFacts } from './weekly-report';

export type StageProgressProjection = {
  stageId: StageId | null;
  step: string;
  planAvailable: boolean;
  planColor: string;
  constructionStatus: string;
  summary: string;
  actionUrl: string;
};
export type StageTodoProjection = { id: string; title: string; role: string; dueAt: string | null; actionUrl: string };
export type StageRuntimeDependencies = {
  readProgress: (input: { enterpriseId: string; projectId: string; constructionStageKey: string | null }) => Promise<StageProgressProjection>;
  readTodos: (input: { enterpriseId: string; projectId: string; constructionStageKey: string | null }) => Promise<StageTodoProjection[]>;
  enterpriseKnowledge?: (input: { enterpriseId: string; projectId: string; stageId: StageId }) => Promise<EnterpriseKnowledgeItem[]>;
};

/** One shared runtime for all ten stages. Configuration, knowledge packs and
 * policies differ; the runtime, permissions and persistence do not. */
export function createStageAgentRuntime(dependencies: StageRuntimeDependencies) {
  return {
    identify(constructionStageKey: string | null | undefined) {
      const stage = stageForConstructionKey(constructionStageKey);
      const agent = stage ? stageAgentRegistry.active(stage.stageId) : null;
      return stage && agent ? { stageId: stage.stageId, stageName: stage.name, agent } : null;
    },
    route(input: { constructionStageKey: string | null | undefined; message: string }): StageRoute {
      return routeStageQuestion(input);
    },
    async answer(input: {
      enterpriseId: string; projectId: string; constructionStageKey: string | null | undefined;
      question: string; audience?: StageAudience;
    }): Promise<StageAnswer> {
      const stageId = stageIdForConstructionKey(input.constructionStageKey);
      if (!stageId) return answerStageQuestion(input);
      const enterpriseKnowledge = dependencies.enterpriseKnowledge
        ? await dependencies.enterpriseKnowledge({ enterpriseId: input.enterpriseId, projectId: input.projectId, stageId }) : [];
      return answerStageQuestion({ ...input, enterpriseKnowledge,
        enterpriseKnowledgeStatus: enterpriseKnowledge.length ? 'available' : 'not_configured' });
    },
    planReminders(input: { facts: ReminderProjectFacts; policy: StageReminderPolicy; now?: Date }): ReminderDraft[] {
      return buildReminderDrafts(input.facts, input.policy, input.now ?? new Date());
    },
    readProgress(input: { enterpriseId: string; projectId: string; constructionStageKey: string | null }) {
      return dependencies.readProgress(input);
    },
    readTodos(input: { enterpriseId: string; projectId: string; constructionStageKey: string | null }) {
      return dependencies.readTodos(input);
    },
    generateWeeklyReport(input: {
      enterpriseId: string; role: WeeklyReportRole; recipientId: string;
      periodStart: string; periodEnd: string; generatedAt: string; projects: WeeklyProjectFacts[];
      reportId?: string; reportVersion?: number;
    }): WeeklyReportDigest {
      return buildWeeklyDigest(input);
    },
  };
}
