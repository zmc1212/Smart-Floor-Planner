import { fingerprint, type Evidence } from '../contracts';
import { hasAcceptanceClaim } from '../agent/formal-claim-scope';
import type { SynthesisAnswer, SynthesisSource } from '../agent/synthesis';
import { electricalAgentId, type SpecialistCheck, type SpecialistCheckCategory, type SpecialistCheckStatus,
  type SpecialistDrawingRef, type SpecialistEvidenceRef } from './registry';
import type { ElectricalDrawingElement, ElectricalDrawingRead } from './drawing';

const standardSections: Readonly<Record<string, Readonly<Record<'technical' | 'test', readonly string[]>>>> = {
  'GB55030-2022': { technical: ['5.1 一般规定', '5.6 建筑室内工程'], test: ['6.0.12'] },
  // Only the reviewed water-supply/drainage clauses are available. Strong and
  // weak current claims must stay unverified instead of borrowing these pages.
  'GB55020-2021': { technical: ['4.2 卫生器具与水封', '8.1 一般规定'], test: ['8.3 调试与验收'] },
};

export function specialistPublicSections(coverage: unknown, standardId?: string): string[] | undefined {
  if (coverage !== 'technical' && coverage !== 'test') return undefined;
  const sections = standardSections[standardId ?? 'GB55030-2022']?.[coverage];
  return sections ? [...sections] : undefined;
}

export type SpecialistProjectEvidence = {
  id: string;
  roomId: string;
  stage: string | null;
  revision: number;
  records: Array<{ id: string; version: number; hash: string }>;
  drawings?: ElectricalDrawingRead;
};

export type SpecialistEnterpriseRead = {
  status: 'sources_found' | 'no_match' | 'disabled' | 'unavailable';
  epoch: number;
  retrievalStatus?: 'retrieval_unavailable';
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
  // A drawing only proves design intent; it never proves installed work.
  if (basis.has('project_drawing')) return 'pending_site_verification';
  if (basis.has('general_advice')) return 'general_advice';
  return 'evidence_missing';
}

/** The waterproof dimensions. Classification is display scope, not a status
 * and not a new fact source. */
function waterproofCategory(text: string): SpecialistCheckCategory {
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

/** The twelve electrical checklist groups in workflow order. */
function electricalCategory(text: string): SpecialistCheckCategory {
  const categories: Array<[SpecialistCheckCategory, RegExp]> = [
    ['drawing_review', /图纸|版本|修订|核对图/u],
    ['distribution_circuits', /配电箱|配电柜|电箱|空开|漏保|回路|总开|断路器/u],
    ['weak_current_points', /弱电|网络|网线|电视|智能家居|光纤|门禁|监控/u],
    ['water_supply', /给水|冷水|热水|水压|用水设备|水表/u],
    ['drainage', /排水|地漏|存水弯|坡度|标高|排污|下水/u],
    ['pipe_fixing', /线管|穿线|布线|管线|固定|连接|卡扣|管卡/u],
    ['concealment', /隐蔽|封槽|封闭|覆盖前/u],
    ['rectification', /整改|复核|返工|问题/u],
    ['test_basis', /打压|通水|通球|绝缘|接地|试验|检测|检查依据/u],
    ['site_records', /照片|施工记录|现场记录|影像/u],
    ['next_process', /后续|下一道|泥木|贴砖|封板/u],
    ['strong_current_points', /强电|插座|开关|照明|灯具|空调|厨电|专线/u],
  ];
  return categories.find(([, pattern]) => pattern.test(text))?.[0] ?? 'other';
}

function checkCategory(text: string, agentId?: string): SpecialistCheckCategory {
  return agentId === electricalAgentId ? electricalCategory(text) : waterproofCategory(text);
}

function drawingCategory(kind: ElectricalDrawingElement['kind']): SpecialistCheckCategory {
  if (kind === 'distribution_box' || kind === 'circuit') return 'distribution_circuits';
  if (kind === 'weak_current') return 'weak_current_points';
  if (kind === 'water_supply') return 'water_supply';
  if (kind === 'drainage' || kind === 'floor_drain') return 'drainage';
  if (kind === 'socket' || kind === 'switch' || kind === 'lighting' || kind === 'other') return 'strong_current_points';
  return 'other';
}

function checkSourceType(basis: Set<SpecialistCheck['basis'][number]>): NonNullable<SpecialistCheck['sourceType']> {
  const grounded = (['enterprise_standard', 'public_standard', 'project_fact', 'project_drawing'] as const)
    .filter(kind => basis.has(kind));
  if (grounded.length > 1) return 'mixed';
  if (grounded.length === 1) return grounded[0] === 'project_fact' ? 'project_record' : grounded[0];
  return basis.has('general_advice') ? 'general_advice' : 'unverified';
}

function drawingChecks(project: SpecialistProjectEvidence, binding: Parameters<typeof specialistChecks>[0]['binding']) {
  const checks: SpecialistCheck[] = [];
  for (const drawing of project.drawings?.drawings ?? []) {
    for (const element of drawing.extractedElements.slice(0, 24)) {
      const drawingRef: SpecialistDrawingRef = {
        projectId: project.id, roomId: project.roomId, drawingId: drawing.drawingId, drawingType: drawing.drawingType,
        drawingVersion: drawing.drawingVersion, revision: drawing.revision, sourceHash: drawing.sourceHash,
        pageNumber: element.pageNumber, coordinateReference: element.coordinateReference, elementId: element.elementId,
        uncertainty: drawing.uncertainty, verificationStatus: drawing.verificationStatus,
      };
      const evidenceRef: SpecialistEvidenceRef = { kind: 'project_drawing',
        ref: { type: 'drawing', id: drawing.drawingId, version: drawing.drawingVersion }, hash: drawing.sourceHash,
        page: element.pageNumber, elementId: element.elementId, coordinateReference: element.coordinateReference,
        drawingType: drawing.drawingType };
      const text = `图纸标注：${element.label}`;
      checks.push({
        text, basis: ['project_drawing'], evidenceRefs: [evidenceRef], drawingRefs: [drawingRef],
        checkId: 'check_' + fingerprint({ projectId: project.id, roomId: project.roomId, text,
          drawing: drawing.drawingId, element: element.elementId }).slice(0, 24),
        projectId: project.id, roomId: project.roomId, stage: project.stage, ...binding,
        evidenceVersions: [drawing.drawingVersion], sourceType: 'project_drawing', applicability: 'applicable',
        currentProjectState: `图纸 ${drawing.drawingId} 第 ${element.pageNumber} 页为设计内容，现场完成情况未核实`,
        checkStatus: drawing.uncertainty.length ? 'pending_site_verification' : 'drawing_supported',
        needsHumanReview: true, category: drawingCategory(element.kind),
      });
    }
  }
  return checks;
}

export function specialistChecks(input: {
  answer: SynthesisAnswer | null;
  sources: readonly SynthesisSource[];
  project: SpecialistProjectEvidence;
  enterprise: SpecialistEnterpriseRead;
  publicStandard: SpecialistPublicRead;
  knowledgeEpoch: number;
  agentId?: string;
  binding?: Pick<SpecialistCheck, 'agentId' | 'agentVersion' | 'workflowRunId' | 'workflowRevision' | 'workflowDigest'>;
}) {
  const { answer, sources, project, enterprise, publicStandard, knowledgeEpoch } = input;
  let hasEnterprise = false, hasPublic = false;
  const electrical = input.agentId === electricalAgentId;
  const drawingSummary = electrical ? project.drawings
    ? `；图纸 ${project.drawings.drawings.length} 份，状态 ${project.drawings.status}` : '；未读取到水电图纸' : '';
  const currentProjectState = `团队标记节点：${project.stage ?? '未标记'}；本房间已发布现场记录 ${project.records.length} 条；项目修订 ${project.revision}${drawingSummary}`;
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
          && (publicStandard.editionStatus === 'current'
            || input.binding?.workflowRevision && publicStandard.editionStatus === 'unknown')
          && ref.standardId === publicStandard.standardId
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
      ...input.binding,
      ...(checkPublic && input.binding?.workflowRevision ? {
        publicEditionStatus: publicStandard.editionStatus === 'current' ? 'current' : 'unknown',
      } : {}),
      evidenceVersions: [...new Set(refs.map(ref => ref.ref.version))],
      sourceType: checkSourceType(basis),
      applicability: basis.has('not_applicable') ? 'not_applicable' : basis.has('unverified') ? 'unknown' : 'applicable',
      currentProjectState,
      checkStatus: status,
      needsHumanReview: status === 'evidence_missing' || status === 'pending_review',
      category: checkCategory(segment.text, input.agentId),
    });
  }
  const drawingItems = electrical ? drawingChecks(project, input.binding) : [];
  checks.push(...drawingItems);
  const unresolvedItems = checks.filter(check => check.basis.includes('unverified')).map(check => check.text);
  if (!hasEnterprise) unresolvedItems.push(enterprise.status === 'unavailable' ? '企业知识服务暂不可用'
    : enterprise.status === 'disabled' ? '企业知识未启用'
    : electrical ? '本次未核实可用的企业水电施工工艺' : '本次未核实可用的企业防水条款');
  if (!hasPublic) unresolvedItems.push('本次未核实适用的公开规范原页及同版状态');
  else if (input.binding?.workflowRevision && publicStandard.editionStatus === 'unknown') unresolvedItems.push('本次已核对公开规范原页，现行状态待核实');
  if (!project.records.length) unresolvedItems.push('待补充该房间已发布的现场记录');
  if (electrical && project.drawings) {
    if (project.drawings.status === 'not_provided') unresolvedItems.push('待补充当前项目水电图纸');
    else if (project.drawings.status === 'unavailable') unresolvedItems.push('水电图纸未能读取，需提供可读版本或现场核实');
    else if (drawingItems.length) unresolvedItems.push('图纸设计点位不代表现场已完成，需现场核实实际安装');
    else unresolvedItems.push('水电图纸未识别出明确点位，需人工核对图纸');
  }
  const evidenceRefs = [...new Map(checks.flatMap(check => check.evidenceRefs)
    .map(ref => [ref.ref.type + ':' + ref.ref.id + ':' + ref.ref.version, ref])).values()];
  return { requestedChecks: checks, unresolvedItems, evidenceRefs, hasEnterprise, hasPublic, hasDrawing: drawingItems.length > 0 };
}
