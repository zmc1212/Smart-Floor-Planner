const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decorateLead,
  buildLeadPickerView,
  chooseDefaultLeadGroup,
  resolveLeadGroupAfterRefresh,
  decorateScheme,
  nextSchemeTitle,
  roomsFromWorkflowDetail,
  buildScopes,
} = require('../packages/ai-workflow/recipe-project/recipe-project-model.js');

test('recipe picker groups studio leads as designable vs needs survey', () => {
  const leads = [
    decorateLead({
      id: '1',
      name: '高容海',
      communityName: '东辰心语',
      workflowCount: 6,
      serviceStage: 'survey_completed',
      floorPlans: [{ id: 'fp-1', name: '正式户型' }],
    }),
    decorateLead({
      id: '2',
      name: '待量客户',
      communityName: '云深路',
      workflowCount: 0,
      serviceStage: 'survey_ready',
      floorPlans: [{ id: 'fp-pending', name: '正式户型' }],
    }),
  ];
  assert.equal(leads[0].group, 'designable');
  assert.equal(leads[0].actionLabel, '选择');
  assert.equal(leads[0].meta, '东辰心语 · 6 个方案');
  assert.equal(leads[1].group, 'needs_survey');
  assert.equal(leads[1].actionLabel, '去量房');
  assert.equal(chooseDefaultLeadGroup(leads), 'designable');
  assert.deepEqual(
    buildLeadPickerView(leads, 'designable', '东辰').filteredLeads.map((item) => item.id),
    ['1'],
  );
  assert.deepEqual(
    buildLeadPickerView(leads, 'needs_survey').leadGroups.map((item) => item.count),
    [1, 1],
  );
});

test('recipe picker switches to designable after the surveyed lead becomes eligible', () => {
  const afterComplete = [
    decorateLead({
      id: '2',
      name: '待量客户',
      communityName: '云深路',
      workflowCount: 0,
      serviceStage: 'survey_completed',
      floorPlans: [{ id: 'fp-2', name: '正式户型' }],
    }),
  ];
  assert.equal(
    resolveLeadGroupAfterRefresh(afterComplete, 'needs_survey', '2'),
    'designable',
  );

  const stillNeedsSurvey = [
    decorateLead({
      id: '2',
      name: '待量客户',
      communityName: '云深路',
      workflowCount: 0,
      floorPlans: [],
    }),
    decorateLead({
      id: '3',
      name: '另一待量',
      communityName: '滨江',
      workflowCount: 0,
      floorPlans: [],
    }),
  ];
  assert.equal(
    resolveLeadGroupAfterRefresh(stillNeedsSurvey, 'needs_survey', '2'),
    'needs_survey',
  );

  const currentTabEmpty = [
    decorateLead({
      id: '1',
      name: '高容海',
      communityName: '东辰心语',
      workflowCount: 1,
      serviceStage: 'survey_completed',
      floorPlans: [{ id: 'fp-1', name: '正式户型' }],
    }),
  ];
  assert.equal(
    resolveLeadGroupAfterRefresh(currentTabEmpty, 'needs_survey', ''),
    'designable',
  );
});

test('recipe picker continues an existing scheme and names a new one like Admin', () => {
  const scheme = decorateScheme({
    id: '88',
    title: '灯光设计',
    publishedCount: 2,
    generationCount: 4,
    sourceFloorPlanId: '7',
  });
  assert.equal(scheme.id, '88');
  assert.equal(scheme.meta, '已确认 2 张');
  assert.equal(scheme.coverUrl, '/images/ai-design-project-folio-cover-v1.png');
  assert.equal(nextSchemeTitle({ workflowCount: 0 }), '方案 1');
  assert.equal(nextSchemeTitle({ workflowCount: 6 }), '方案 7');

  const bound = roomsFromWorkflowDetail({
    workflow: {
      id: '88',
      title: '灯光设计',
      sourceFloorPlan: {
        id: '7',
        name: '正式户型',
        closedRoomCount: 2,
        rooms: [
          { roomId: 'living', roomName: '客厅', roomSize: '4.20 m x 3.60 m' },
        ],
      },
    },
    lead: { id: '1', name: '高容海', communityName: '东辰心语' },
  });
  const scopes = buildScopes(bound.rooms, bound.closedRoomCount);
  assert.equal(bound.floorPlanId, '7');
  assert.equal(scopes[0].targetScope, 'whole_floor_plan');
  assert.equal(scopes[1].roomId, 'living');
  assert.equal(scopes[1].name, '客厅');
});

test('photo recipes treat assigned unsurveyed leads as selectable and skip surveying', () => {
  const photoLead = decorateLead({
    id: '2',
    name: '待量客户',
    communityName: '云深路',
    workflowCount: 0,
    serviceStage: 'measurer_assigned',
    assignmentStatus: 'assigned',
    assignedTo: { id: 'd1' },
    floorPlans: [],
  }, { inputMode: 'photo' });
  assert.equal(photoLead.group, 'designable');
  assert.equal(photoLead.actionLabel, '选择');
  assert.equal(photoLead.helper, '可用户型图或现场照出图并发送');
  assert.equal(photoLead.eligibleFloorPlanId, '');

  const floorPlanLead = decorateLead({
    id: '2',
    name: '待量客户',
    communityName: '云深路',
    workflowCount: 0,
    serviceStage: 'measurer_assigned',
    assignmentStatus: 'assigned',
    assignedTo: { id: 'd1' },
    floorPlans: [],
  });
  assert.equal(floorPlanLead.group, 'needs_survey');
  assert.equal(floorPlanLead.actionLabel, '去量房');

  const closedPhoto = decorateLead({
    id: '9',
    name: '已关闭',
    status: 'closed',
    assignmentStatus: 'assigned',
    assignedTo: { id: 'd1' },
  }, { inputMode: 'photo' });
  assert.equal(closedPhoto.group, 'needs_survey');

  const fs = require('node:fs');
  const path = require('node:path');
  const projectScript = fs.readFileSync(
    path.join(__dirname, '..', 'packages', 'ai-workflow', 'recipe-project', 'recipe-project.js'),
    'utf8',
  );
  const confirmScript = fs.readFileSync(
    path.join(__dirname, '..', 'packages', 'ai-workflow', 'recipe-confirm', 'recipe-confirm.js'),
    'utf8',
  );
  assert.match(projectScript, /inputMode !== 'photo' && lead\.group === 'needs_survey'/);
  assert.match(projectScript, /sourceAssetRole: 'rough_sketch'/);
  assert.match(projectScript, /skipScope: true/);
  assert.match(confirmScript, /if \(!photoMode && !bound\.floorPlanId\)/);
  assert.match(confirmScript, /\.\.\.\(this\.data\.floorPlanId \? \{/);
});

test('recipe picker uses a signed generated cover instead of the folio placeholder', () => {
  const confirmed = decorateScheme({
    id: '88',
    title: '灯光设计',
    publishedCount: 2,
    coverUrl: 'https://example.test/api/miniprogram/ai/assets/91/image?expires=1&signature=abc',
  });
  assert.equal(
    confirmed.coverUrl,
    'https://example.test/api/miniprogram/ai/assets/91/image?expires=1&signature=abc',
  );

  const nested = decorateScheme({
    id: '89',
    title: '软装设计',
    publishedCount: 1,
    latestGeneration: {
      status: 'succeeded',
      output: { imageUrl: '/api/miniprogram/ai/assets/92/image?expires=1&signature=def' },
    },
  });
  assert.equal(
    nested.coverUrl,
    '/api/miniprogram/ai/assets/92/image?expires=1&signature=def',
  );

  const adminPath = decorateScheme({
    id: '90',
    title: '灯光设计',
    publishedCount: 2,
    latestGeneration: {
      status: 'succeeded',
      output: { imageUrl: '/api/ai/assets/91/image' },
    },
  });
  assert.equal(adminPath.coverUrl, '/images/ai-design-project-folio-cover-v1.png');
});
