import { fingerprint, type Evidence } from '../contracts';
import { hasAcceptanceClaim } from '../agent/formal-claim-scope';
import type { SynthesisAnswer, SynthesisSource } from '../agent/synthesis';
import type { SpecialistCheck, SpecialistCheckCategory, SpecialistCheckStatus, SpecialistEvidenceRef } from './registry';

export function specialistPublicSections(coverage: unknown) {
  return coverage === 'technical' ? ['5.1 一般规定', '5.6 建筑室内工程']
    : coverage === 'test' ? ['6.0.12'] : undefined;
}

export type SpecialistProjectEvidence = {
  id: string;
  roomId: string;
  stage: string | null;
  revision: number;
  records: Array<{ id: string; version: number; hash: string }>;
};

export type SpecialistEnterpriseRead = {
  status: 'sources_found' | 'no_match' | 'disabled' | 'unavailable';
  epoch: number;
  sources?: Array<Pick<Evidence, 'ref' | 'hash'>>;
};

export type SpecialistPublicRead = {
  status: string;
  standardId?: string;
  editionStatus?: string;
  sources?: Array<{ hash: string; page: number }>;
};

function toEvidenceRef(evidence: Evidence, projectId: string): SpecialistEvidenceRef | null {
  const { ref, hash, knowledge, professional, web } = evidence;
  if (!ref.version) return null;
  const versionedRef = { ...ref, version: ref.version };
  if (knowledge?.published && knowledge.versionId === ref.version
    && (knowledge.scope === 'enterprise' || knowledge.projectId === projectId)) {
    if (professional && professional.entry.origin.authority !== 'enterprise_rule') return null;
    return { kind: 'enterprise_standard', ref: versionedRef, hash };
  }
  if (web?.standard?.kind === 'standard_text' && web.document?.reviewedTextHash) {
    return { kind: 'public_standard', ref: versionedRef, hash, standardId: web.standard.id,
      page: web.document.page, originalHash: web.document.hash, url: web.url };
  }
  return null;
}

/** Use the selected citations of the persisted, validated answer. A retrieved
 * candidate, status announcement, or model claim alone cannot supply a check. */
function checkStatus(basis: Set<SpecialistCheck['basis'][number]>, enterprise: boolean, publicStandard: boolean,
  text: string): SpecialistCheckStatus {
  if (basis.has('not_applicable')) return 'not_applicable';
  // Only a Construction review receipt can mark an item reviewed; model
  // analysis never produces that status.
  if (hasAcceptanceClaim(text)) return 'pending_review';
  if (basis.has('unverified')) return 'evidence_missing';
  if (basis.has('enterprise_standard') && enterprise) return 'enterprise_explicit';
  if (basis.has('public_standard') && publicStandard) return 'public_explicit';
  if (basis.has('project_fact')) return 'project_supported';
  if (basis.has('general_advice')) return 'general_advice';
  return 'evidence_missing';
}

/** The ten waterproof checklist dimensions. Classification is display scope,
 * not a status and not a new fact source. */
function checkCategory(text: string): SpecialistCheckCategory {
  const categories: Array<[SpecialistCheckCategory, RegExp]> = [
    ['pipe_root', /管根|地漏|穿管|管线|管道/u],
    ['corner', /阴阳角|阴角|阳角/u],
    ['embed', /预埋|埋设|止水节|套管/u],
    ['test_acceptance', /闭水|蓄水|淋水|试验|验收/u],
    ['next_process', /贴砖|铺砖|下一道工序|回填|后续工序/u],
    ['protection', /保护层|成品保护|保护/u],
    ['waterproof_layer', /防水层|涂刷|涂膜|卷材/u],
    ['base_course', /基层|找平|空鼓|起砂|含水率/u],
    ['material_record', /材料|合格证|施工记录|证明文件/u],
    ['enterprise_process', /企业|公司|工艺|做法/u],
  ];
  return categories.find(([, pattern]) => pattern.test(text))?.[0] ?? 'other';
}

function checkSourceType(basis: Set<SpecialistCheck['basis'][number]>): NonNullable<SpecialistCheck['sourceType']> {
  const grounded = (['enterprise_standard', 'public_standard', 'project_fact'] as const).filter(kind => basis.has(kind));
  if (grounded.length > 1) return 'mixed';
  if (grounded.length === 1) return grounded[0] === 'project_fact' ? 'project_record' : grounded[0];
  return basis.has('general_advice') ? 'general_advice' : 'unverified';
}

export function specialistChecks(input: {
  answer: SynthesisAnswer | null;
  sources: readonly SynthesisSource[];
  project: SpecialistProjectEvidence;
  enterprise: SpecialistEnterpriseRead;
  publicStandard: SpecialistPublicRead;
  knowledgeEpoch: number;
  binding?: { agentId?: string; agentVersion?: number; workflowRunId?: string };
}) {
  const { answer, sources, project, enterprise, publicStandard, knowledgeEpoch } = input;
  let hasEnterprise = false, hasPublic = false;
  const currentProjectState = `团队标记节点：${project.stage ?? '未标记'}；本房间已发布现场记录 ${project.records.length} 条；项目修订 ${project.revision}`;
  const checks: SpecialistCheck[] = [];
  for (const segment of answer?.segments ?? []) {
    const refs: SpecialistEvidenceRef[] = [];
    const basis = new Set<SpecialistCheck['basis'][number]>();
    if (segment.basis === 'advice') basis.add('general_advice');
    if (segment.basis === 'uncertainty') basis.add('unverified');
    let unmatched = false, checkEnterprise = false, checkPublic = false;
    for (const citation of segment.citations) {
      const source = sources.find(item => item.sourceId === citation.sourceId && item.text.includes(citation.quote));
      if (!source) unmatched = true;
      const e = source?.evidence;
      const ref = e && toEvidenceRef(e, project.id);
      if (ref) {
        refs.push(ref);
        basis.add(ref.kind);
        const applicability = e?.professional?.applicability.status;
        if (applicability === 'not_applicable') basis.add('not_applicable');
        if (applicability === 'unknown') basis.add('unverified');
        if (ref.kind === 'enterprise_standard' && segment.basis !== 'uncertainty'
          && applicability !== 'not_applicable' && applicability !== 'unknown'
          && enterprise.status === 'sources_found' && enterprise.epoch === knowledgeEpoch
          && enterprise.sources?.some(item => item.ref.id === ref.ref.id && item.ref.version === ref.ref.version && item.hash === ref.hash)) {
          hasEnterprise = true;
          checkEnterprise = true;
        }
        if (ref.kind === 'public_standard' && segment.basis !== 'uncertainty' && publicStandard.status === 'ready'
          && publicStandard.editionStatus === 'current' && ref.standardId === publicStandard.standardId
          && publicStandard.sources?.some(item => item.hash === ref.originalHash && item.page === ref.page)) {
          hasPublic = true;
          checkPublic = true;
        }
      } else if (source?.kind === 'project' && source.material?.ref.type === 'site_record') {
        const material = source.material;
        const record = project.records.find(item => item.id === material.ref.id
          && String(item.version) === material.ref.version && item.hash === material.hash
          && material.projectId === project.id && material.roomId === project.roomId);
        if (record) {
          basis.add('project_fact');
          refs.push({ kind: 'project_fact', ref: { type: 'site_record', id: record.id, version: String(record.version) }, hash: record.hash });
        }
      }
    }
    if (unmatched || !basis.size) basis.add('unverified');
    const status = checkStatus(basis, checkEnterprise, checkPublic, segment.text);
    checks.push({
      text: segment.text, basis: [...basis], evidenceRefs: refs,
      checkId: 'check_' + fingerprint({ projectId: project.id, roomId: project.roomId, text: segment.text,
        refs: refs.map(ref => ref.ref.type + ':' + ref.ref.id + ':' + ref.ref.version + ':' + ref.hash) }).slice(0, 24),
      projectId: project.id, roomId: project.roomId, stage: project.stage,
      ...(input.binding?.agentId ? { agentId: input.binding.agentId } : {}),
      ...(input.binding?.agentVersion ? { agentVersion: input.binding.agentVersion } : {}),
      ...(input.binding?.workflowRunId ? { workflowRunId: input.binding.workflowRunId } : {}),
      evidenceVersions: [...new Set(refs.map(ref => ref.ref.version))],
      sourceType: checkSourceType(basis),
      applicability: basis.has('not_applicable') ? 'not_applicable' : basis.has('unverified') ? 'unknown' : 'applicable',
      currentProjectState,
      checkStatus: status,
      needsHumanReview: status === 'evidence_missing' || status === 'pending_review',
      category: checkCategory(segment.text),
    });
  }
  const unresolvedItems = checks.filter(check => check.basis.includes('unverified')).map(check => check.text);
  if (!hasEnterprise) unresolvedItems.push(enterprise.status === 'unavailable' ? '企业知识服务暂不可用'
    : enterprise.status === 'disabled' ? '企业知识未启用' : '本次未核实可用的企业防水条款');
  if (!hasPublic) unresolvedItems.push('本次未核实适用的公开规范原页及同版状态');
  if (!project.records.length) unresolvedItems.push('待补充该房间已发布的现场记录');
  const evidenceRefs = [...new Map(checks.flatMap(check => check.evidenceRefs)
    .map(ref => [ref.ref.type + ':' + ref.ref.id + ':' + ref.ref.version, ref])).values()];
  return { requestedChecks: checks, unresolvedItems, evidenceRefs, hasEnterprise, hasPublic };
}
