import assert from 'node:assert/strict';
import test from 'node:test';
import { consultationSpecialist, specialistDomain } from './consultation';
import { specialistChecks } from './evidence';
import {
  electricalAgentId, electricalWorkflowTemplateId, specialists, waterproofAgentId,
} from './registry';
import { extractDrawingPage, parseDrawingBytes, type ElectricalDrawingRead } from './drawing';
import { createElectricalInspectionDefinition } from '@/lib/native-workflow/specialist-template';
import { compileDefinition } from '@/lib/native-workflow/compile';
import { validateDefinition } from '@/lib/native-workflow/validate';
import { createWorkflowService } from '@/lib/native-workflow/service';
import { createMemoryWorkflowStore } from '@/lib/native-workflow/store/memory-store';

const agent = specialists.version(electricalAgentId, 1)!;

const drawing: ElectricalDrawingRead = {
  status: 'ready', version: 'drawing-version-1', failures: [],
  drawings: [{
    projectId: '11', roomId: '15', drawingId: 'grant-7', drawingType: 'electrical_layout',
    drawingVersion: 'grant-7', revision: 'r'.repeat(64), sourceHash: 's'.repeat(64),
    pageNumber: 1, coordinateReference: 'page:1', uncertainty: [], verificationStatus: 'extracted',
    extractedElements: [{ elementId: 'p1:10:20:0', kind: 'socket', label: '厨房 插座 3个', roomName: '厨房',
      pageNumber: 1, coordinateReference: 'page:1:x:10:y:20' }],
  }],
};

test('electrical is registered as its own candidate agent with five stage phases and isolated domains', () => {
  assert.equal(agent.status, 'active');
  assert.equal(specialists.active(electricalAgentId)?.version, 1);
  assert.equal(agent.workflowTemplateId, electricalWorkflowTemplateId);
  assert.equal(agent.name, '水电阶段专业 Agent');
  assert.equal(agent.stagePhases?.length, 5);
  assert.deepEqual(agent.knowledgeDomains, ['strong_current', 'weak_current', 'water_supply', 'drainage', 'concealment']);
  assert.notEqual(agent.knowledgeDomains, specialists.active(waterproofAgentId)?.knowledgeDomains);
});

test('waterproof terms stay in the waterproof scope and electrical terms select the electrical agent', () => {
  assert.equal(specialistDomain('卫生间防水管根怎么做？'), 'waterproof');
  assert.equal(specialistDomain('厨房插座回路怎么分？'), 'electrical');
  assert.equal(specialistDomain('卫生间给排水点位怎么核对？'), 'electrical');
  assert.equal(specialistDomain('客厅弱电和强电交叉怎么办？'), 'electrical');
  assert.equal(specialistDomain('今天天气怎么样？'), null);
  const routed = consultationSpecialist('厨房插座点位怎么核对？', [], agent);
  assert.equal(routed?.agent.agentId, electricalAgentId);
  assert.equal(routed?.room, '厨房');
  const corrected = consultationSpecialist('不是厨房，是卫生间。', ['厨房插座点位怎么核对？'], agent);
  assert.equal(corrected?.room, '卫生间');
  assert.equal(consultationSpecialist('那弱电点位呢？', ['厨房插座点位怎么核对？'], agent)?.agent.agentId, electricalAgentId);
  // Two rooms stay unbound; the main Agent must ask for one exact room.
  assert.equal(consultationSpecialist('客厅和卧室的插座点位分别怎么核对？', [], agent)?.room, null);
});

test('drawing evidence becomes design-only checks that always require site verification', () => {
  const result = specialistChecks({
    answer: { kind: 'synthesis', segments: [{ basis: 'advice', text: '点位需要现场核对', citations: [] }] },
    sources: [], project: { id: '11', roomId: '15', stage: 'utilities', revision: 3, records: [], drawings: drawing },
    enterprise: { status: 'no_match', epoch: 1 },
    publicStandard: { status: 'unavailable' }, knowledgeEpoch: 1, agentId: electricalAgentId,
    binding: { agentId: electricalAgentId, agentVersion: 1, workflowRunId: 'specialist:1' },
  });
  assert.equal(result.hasDrawing, true);
  const check = result.requestedChecks.find(item => item.basis.includes('project_drawing'))!;
  assert.match(check.text, /^图纸标注：/u);
  assert.equal(check.checkStatus, 'drawing_supported');
  assert.equal(check.needsHumanReview, true);
  assert.equal(check.category, 'strong_current_points');
  assert.equal(check.drawingRefs?.[0]?.drawingId, 'grant-7');
  assert.equal(check.drawingRefs?.[0]?.pageNumber, 1);
  assert.ok(check.evidenceRefs.some(ref => ref.kind === 'project_drawing' && ref.elementId === 'p1:10:20:0'));
  assert.ok(result.unresolvedItems.includes('图纸设计点位不代表现场已完成，需现场核实实际安装'));
  assert.ok(result.unresolvedItems.includes('本次未核实可用的企业水电施工工艺'));
});

test('an uncertain drawing stays pending site verification instead of claiming design support', () => {
  const uncertain = { ...drawing, drawings: [{ ...drawing.drawings[0], uncertainty: ['图纸点位与房间关系不明确'] }] };
  const result = specialistChecks({
    answer: null, sources: [],
    project: { id: '11', roomId: '15', stage: 'utilities', revision: 3, records: [], drawings: uncertain },
    enterprise: { status: 'no_match', epoch: 1 }, publicStandard: { status: 'unavailable' },
    knowledgeEpoch: 1, agentId: electricalAgentId,
  });
  assert.equal(result.requestedChecks.find(item => item.basis.includes('project_drawing'))?.checkStatus,
    'pending_site_verification');
});

test('drawing extraction keeps page coordinates, room binding and the drawing version', () => {
  const base = { projectId: '11', roomId: '15', drawingId: 'grant-7', drawingVersion: 'grant-7',
    sourceHash: 's'.repeat(64), revision: 'r'.repeat(64) };
  const page = extractDrawingPage(2, [
    { text: '厨房 插座 3个', page: 2, x: 40, y: 500 },
    { text: '卫生间 地漏 DN50', page: 2, x: 40, y: 460 },
    { text: '设计说明', page: 2, x: 40, y: 420 },
  ], base);
  assert.equal(page.drawingType, 'electrical_layout');
  assert.equal(page.verificationStatus, 'extracted');
  assert.deepEqual(page.extractedElements.map(element => [element.kind, element.roomName, element.pageNumber]),
    [['socket', '厨房', 2], ['floor_drain', '卫生间', 2]]);
  assert.equal(page.extractedElements[0].coordinateReference, 'page:2:x:40:y:500');
  assert.equal(page.drawingVersion, 'grant-7');
});

test('a PDF without recognizable Chinese point text is text_only, and an image is never silently treated as parsed', async () => {
  const pdf = Buffer.from(['%PDF-1.4', '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
    '4 0 obj << /Length 62 >> stream', 'BT /F1 12 Tf 20 150 Td (Living room socket point 3) Tj ET', 'endstream endobj',
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj', 'trailer << /Root 1 0 R >>', '%%EOF'].join('\n'));
  const parsed = await parseDrawingBytes({ data: pdf, mime: 'application/pdf' },
    { projectId: '11', roomId: '15', drawingId: 'grant-8', drawingVersion: 'grant-8', sourceHash: 'x'.repeat(64) });
  assert.equal(parsed.status, 'ready');
  assert.equal(parsed.drawings[0].verificationStatus, 'text_only');
  assert.ok(parsed.drawings[0].uncertainty.includes('该页未识别出明确的水电点位，需人工核对图纸'));
  const image = await parseDrawingBytes({ data: Buffer.from([0xff, 0xd8, 0xff, 0xdb]), mime: 'image/jpeg' },
    { projectId: '11', roomId: '15', drawingId: 'grant-9', drawingVersion: 'grant-9', sourceHash: 'y'.repeat(64) });
  assert.equal(image.status, 'empty');
  assert.equal(image.drawings[0].verificationStatus, 'unreadable');
  assert.ok(image.drawings[0].uncertainty.includes('图片图纸未做文字识别，点位和尺寸需现场核实'));
});

test('the electrical template validates, compiles, publishes and simulates on the existing runtime', async () => {
  const definition = createElectricalInspectionDefinition();
  assert.equal(validateDefinition(definition).ok, true);
  assert.equal(definition.definitionId, electricalWorkflowTemplateId);
  assert.equal(definition.nodes.find(node => node.nodeId === 'analysis_ready')?.config?.evidencePolicy, 'any_evidence');
  assert.deepEqual(definition.nodes.find(node => node.nodeId === 'analysis_ready')?.inputs?.drawing,
    { nodeId: 'assessment', outputPath: 'hasDrawing' });
  const service = createWorkflowService({ store: createMemoryWorkflowStore() });
  const draft = await service.createFromTemplate(electricalWorkflowTemplateId);
  const { version } = await service.publishDraft({ definitionId: electricalWorkflowTemplateId,
    expectedDraftRevision: draft.draft.draftRevision });
  assert.equal(version.digest, compileDefinition(version.definition).digest);
  for (const [fixtureSetId, branch, node] of [
    ['waterproof-reviewed', 'issue', 'issue'],
    ['waterproof-waiting', 'true', 'checklist'],
    ['waterproof-missing-evidence', 'false', 'request_material'],
  ] as const) {
    const result = await service.simulate({ definitionId: electricalWorkflowTemplateId, source: 'published',
      revision: version.revision, fixtureSetId });
    assert.equal(result.simulation.runs[0].status, fixtureSetId === 'waterproof-reviewed' ? 'completed' : 'waiting');
    assert.equal(result.simulation.runs[0].trace.find(entry => entry.kind === 'branch_selected')?.detail?.branch, branch);
    assert.ok(result.simulation.runs[0].outputs[node]);
  }
});
