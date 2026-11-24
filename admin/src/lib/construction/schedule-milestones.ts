import { fail } from '@/lib/assistant/contracts';
import type { Row } from '@/db/repositories/assistant-repository';
import { object, text } from './contracts';
import { stageKey, type ConstructionStage } from './stages';

type Estimate = { start: string; end: string };
type Agreement = { date: string; reason: string };
export type ScheduleMilestone = {
  key: string;
  stageKey: string;
  name: string;
  kind: 'start' | 'phase' | 'handover';
  estimate?: Estimate | null;
  followup?: { outcome: 'ongoing' | 'completed'; note: string; auditId?: string };
  agreement?: Agreement;
};

export type MilestoneChange =
  | { kind: 'template' }
  | { kind: 'followup'; key: string; estimate: Estimate | null; outcome: 'ongoing' | 'completed'; note: string }
  | { kind: 'agreement'; key: string; date: string; reason: string; confirmedOffline: true };

export const scheduleDayStart = (day: string) => Date.parse(day + 'T00:00:00+08:00');
const dayMillis = 86_400_000;

export function scheduleDateInput(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('invalid_construction', 422);
  const parsed = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== value) fail('invalid_construction', 422);
  return value;
}

const standardStages: Array<[string, ScheduleMilestone['kind'], string]> = [
  ['demolition', 'start', '开工'],
  ['utilities', 'phase', '水电验收'],
  ['masonry_carpentry', 'phase', '泥木完成'],
  ['installation', 'phase', '安装收尾'],
];

export function standardMilestones(stages: ConstructionStage[]): ScheduleMilestone[] {
  const milestones = stages.flatMap(stage => {
    const rule = standardStages.find(item => item[0] === stage.key);
    return rule ? [{ key: 'milestone_' + stage.key, stageKey: stage.key, kind: rule[1], name: rule[2] }] : [];
  });
  const handover = stages.find(stage => stage.key === 'completion') || stages.at(-1);
  if (!milestones.length && stages.length > 1) {
    const first = stages[0];
    milestones.push({ key: 'milestone_first', stageKey: first.key, kind: 'phase', name: first.name });
  }
  if (handover) milestones.push({ key: 'milestone_handover', stageKey: handover.key, kind: 'handover', name: '竣工交付' });
  return milestones;
}

const auditedStage = (row: Row) => String((row.snapshot as Row)?.stageKey || '');
const auditTime = (row: Row) => row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at));

function completionAudit(milestone: ScheduleMilestone, audits: Row[], stages: ConstructionStage[], currentStage: string) {
  const index = audits.findLastIndex(row => auditedStage(row) === milestone.stageKey);
  if (index < 0) return;
  if (milestone.kind === 'start') return audits[index];
  const next = audits[index + 1], stageIndex = stages.findIndex(s => s.key === milestone.stageKey);
  if (next && stages.findIndex(s => s.key === auditedStage(next)) > stageIndex
    && stages.findIndex(s => s.key === currentStage) > stageIndex) return next;
}

export async function applyMilestoneChange(
  milestones: ScheduleMilestone[], raw: unknown, stages: ConstructionStage[], currentStage: string,
  audits: () => Promise<Row[]>,
) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('invalid_construction', 422);
  const kind = (raw as Row).kind;
  if (kind === 'template') {
    object(raw, ['kind']);
    const additions = standardMilestones(stages).filter(item => !milestones.some(node => node.key === item.key));
    return { milestones: [...milestones, ...additions], changed: additions.length > 0 };
  }
  const input = object(raw, kind === 'agreement' ? ['kind', 'key', 'date', 'reason', 'confirmedOffline']
    : ['kind', 'key', 'estimate', 'outcome', 'note']);
  const key = stageKey(input.key), node = milestones.find(item => item.key === key);
  if (!node || !stages.some(stage => stage.key === node.stageKey)) fail('construction_stage_unavailable', 422);
  let updated: ScheduleMilestone;
  if (kind === 'agreement' && node.kind === 'handover') {
    if (input.confirmedOffline !== true) fail('construction_agreement_confirmation_required', 422);
    const date = scheduleDateInput(input.date), reason = text(input.reason ?? '', 500, !!node.agreement && node.agreement.date !== date);
    if (date === node.agreement?.date) return { milestones, changed: false };
    if (completionAudit(node, await audits(), stages, currentStage)) fail('construction_milestone_completed', 409);
    updated = { ...node, agreement: { date, reason } };
  } else if (kind === 'followup' && node.kind !== 'handover') {
    const note = text(input.note ?? '', 500, false);
    if (input.outcome === 'completed') {
      const proof = completionAudit(node, await audits(), stages, currentStage);
      if (!proof) fail('construction_completion_evidence_required', 422);
      updated = { ...node, followup: { outcome: 'completed', note, auditId: String(proof.id) } };
    } else {
      if (input.outcome !== 'ongoing') fail('invalid_construction', 422);
      if (node.kind === 'start' || node.followup?.outcome === 'completed') {
        const proof = completionAudit(node, await audits(), stages, currentStage);
        if (proof && (node.kind === 'start' || String(proof.id) === node.followup?.auditId)) fail('construction_milestone_completed', 409);
      }
      const dates = input.estimate === null ? null : object(input.estimate, ['start', 'end']);
      const estimate = dates ? { start: scheduleDateInput(dates.start), end: scheduleDateInput(dates.end) } : null;
      if (estimate && estimate.start > estimate.end) fail('invalid_construction', 422);
      updated = { ...node, estimate, followup: { outcome: 'ongoing', note } };
    }
  } else {
    fail('invalid_construction', 422);
  }
  return { milestones: milestones.map(item => item.key === key ? updated : item), changed: true };
}

export function projectMilestones(
  milestones: ScheduleMilestone[], stages: ConstructionStage[], currentStage: string, audits: Row[], now: Date,
) {
  const history = audits.filter(row => +auditTime(row) <= +now);
  return milestones.map(node => {
    const valid = stages.some(stage => stage.key === node.stageKey);
    const proof = valid ? completionAudit(node, history, stages, currentStage) : undefined;
    const actual = proof && (node.kind !== 'phase' || node.followup?.auditId === String(proof.id)) ? proof : undefined;
    const end = node.estimate?.end;
    const overdueDays = !actual && valid && end ? Math.max(0, Math.floor((+now - scheduleDayStart(end)) / dayMillis)) : 0;
    const started = currentStage === node.stageKey || history.some(row => auditedStage(row) === node.stageKey);
    const label = !valid ? '阶段待核对' : actual ? '已完成' : overdueDays > 0 ? '待核实'
      : node.kind === 'handover' && node.agreement ? '待交付' : !node.estimate ? '待排期'
      : started && node.followup ? '施工中' : '待开始';
    return {
      key: node.key, stageKey: node.stageKey, name: node.name, kind: node.kind, valid, label,
      estimate: node.estimate ?? null, agreedDate: node.agreement?.date ?? '',
      completedAt: actual ? auditTime(actual).toISOString() : null,
      proof, actual, overdueDays, started,
      note: node.followup?.note ?? '', agreementReason: node.agreement?.reason ?? '',
    };
  });
}

export function milestoneTimeText(start: string, end: string, kind: 'estimate' | 'agreement') {
  const short = (date: string) => Number(date.slice(5, 7)) + '月' + Number(date.slice(8, 10)) + '日';
  if (kind === 'agreement' || start === end) return (kind === 'agreement' ? '已约定 ' : '预计 ') + short(end);
  if (start.slice(0, 4) !== end.slice(0, 4)) return '预计 ' + start + ' 至 ' + end;
  return '预计 ' + (start.slice(0, 7) === end.slice(0, 7) ? short(start).slice(0, -1) + '–' + Number(end.slice(8, 10)) + '日' : short(start) + '–' + short(end));
}
