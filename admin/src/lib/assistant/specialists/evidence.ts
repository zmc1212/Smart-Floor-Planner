import type { Evidence } from '../contracts';
import type { SynthesisAnswer, SynthesisSource } from '../agent/synthesis';
import type { SpecialistCheck, SpecialistEvidenceRef } from './registry';

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
export function specialistChecks(input: {
  answer: SynthesisAnswer | null;
  sources: readonly SynthesisSource[];
  project: SpecialistProjectEvidence;
  enterprise: SpecialistEnterpriseRead;
  publicStandard: SpecialistPublicRead;
  knowledgeEpoch: number;
}) {
  const { answer, sources, project, enterprise, publicStandard, knowledgeEpoch } = input;
  let hasEnterprise = false, hasPublic = false;
  const checks: SpecialistCheck[] = [];
  for (const segment of answer?.segments ?? []) {
    const refs: SpecialistEvidenceRef[] = [];
    const basis = new Set<SpecialistCheck['basis'][number]>();
    if (segment.basis === 'advice') basis.add('general_advice');
    if (segment.basis === 'uncertainty') basis.add('unverified');
    let unmatched = false;
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
        }
        if (ref.kind === 'public_standard' && segment.basis !== 'uncertainty' && publicStandard.status === 'ready'
          && publicStandard.editionStatus === 'current' && ref.standardId === publicStandard.standardId
          && publicStandard.sources?.some(item => item.hash === ref.originalHash && item.page === ref.page)) {
          hasPublic = true;
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
    checks.push({ text: segment.text, basis: [...basis], evidenceRefs: refs });
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
