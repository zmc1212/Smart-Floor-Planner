import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { canCreateLeadBoundRoughSketchWorkflow } from '@/lib/ai/postgres-workflow-service';

const srcRoot = path.resolve(__dirname, '../..');

function read(relative: string) {
  return fs.readFileSync(path.join(srcRoot, relative), 'utf8');
}

test('lead-bound rough-sketch workflows can omit a source floor plan', () => {
  assert.equal(canCreateLeadBoundRoughSketchWorkflow({
    sourceAssetRole: 'rough_sketch',
  }), true);
  assert.equal(canCreateLeadBoundRoughSketchWorkflow({}), true);
  assert.equal(canCreateLeadBoundRoughSketchWorkflow({
    sourceFloorPlanId: '88',
    sourceAssetRole: 'floor_plan',
  }), true);
  assert.equal(canCreateLeadBoundRoughSketchWorkflow({
    sourceImage: 'data:image/png;base64,abc',
    sourceAssetRole: 'space_photo',
  }), true);
  assert.equal(canCreateLeadBoundRoughSketchWorkflow({
    sourceAssetRole: 'floor_plan',
  }), false);
});

test('appointment create accepts designing leads until formal survey is complete', () => {
  const source = read('db/repositories/appointment-repository.ts');
  const create = source.slice(source.indexOf('async create(input:'), source.indexOf('async reschedule('));
  assert.match(create, /lead\.status === 'converted'/);
  assert.match(create, /hasCompletedFormalSurveyForLead/);
  assert.doesNotMatch(create, /lead\.status === 'designing'/);
  assert.match(source, /sql`\$\{leads\.status\} in \('new', 'measuring', 'designing'\)`/);
});

test('first publish, not generation, advances lead status; photo batches bind lead only', () => {
  const publish = read('db/repositories/customer-project-repository.ts');
  const creation = read('lib/ai/postgres-creation-service.ts');
  const workflow = read('lib/ai/postgres-workflow-service.ts');
  assert.match(publish, /resolveLeadStatusAfterDesignPublished\(lead\.status\)/);
  assert.doesNotMatch(creation, /resolveLeadStatusAfterDesignPublished/);
  assert.doesNotMatch(workflow, /resolveLeadStatusAfterDesignPublished/);
  assert.match(creation, /floorPlanId: floorPlan\?\.id \?\? null/);
  assert.match(creation, /\.\.\.\(workflowBinding\.floorPlanId \? \{ floorPlanId: workflowBinding\.floorPlanId \} : \{\}\)/);
  assert.match(workflow, /canCreateLeadBoundRoughSketchWorkflow/);
});

test('admin workbench can start a photo scheme without a formal floor plan', () => {
  const source = read('components/ai-studio/workbench-workspace.tsx');
  assert.doesNotMatch(source, /该线索还没有合格的正式户型，请先完成量房/);
  assert.match(source, /sourceAssetRole: 'rough_sketch'/);
  assert.match(source, /eligibleFloorPlans\.length && !createFloorPlanId/);
  assert.doesNotMatch(source, /disabled=\{creating \|\| !createFloorPlanId\}/);
  assert.match(source, /hasBoundFloorPlan && draft\.renderMode === 'whole_floor_plan'[\s\S]*targetScope: draft\.targetScope/);
});

test('admin workbench can select persisted customer site photos in single-room mode', () => {
  const workbench = read('components/ai-studio/workbench-workspace.tsx');
  const route = read('app/api/ai/workflow-leads/[id]/site-photos/route.ts');
  assert.match(workbench, /选择客户现场图/);
  assert.match(workbench, /\/api\/ai\/workflow-leads\/\$\{selectedLeadId\}\/site-photos/);
  assert.match(workbench, /renderMode === 'single_room_photo'/);
  assert.match(workbench, /现场图将决定生成视角/);
  assert.match(workbench, /sitePhotoAssetIds: assets\.filter\(\(asset\) => asset\.role === 'site_photo'\)/);
  assert.match(workbench, /当前只有模板封面图，还需从客户现场图选择或从电脑上传至少一张现场照片/);
  assert.match(route, /withTenantRoute\(request, \{ requireEnterprise: true \}/);
  assert.match(route, /LeadSitePhotoRepository\(transaction\)\.listActive\(leadId\)/);
  assert.match(route, /previewUrl: `\/api\/ai\/assets\/\$\{photo\.assetId\.toString\(\)\}\/image`/);
});
