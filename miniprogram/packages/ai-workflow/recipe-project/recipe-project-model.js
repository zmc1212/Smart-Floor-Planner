const FOLIO_COVER = '/images/ai-design-project-folio-cover-v1.png';

const LEAD_GROUP_DEFINITIONS = [
  { key: 'designable', label: '可设计' },
  { key: 'needs_survey', label: '待量房' },
];

function workflowIdentity(workflow) {
  return String(workflow && (workflow.id || workflow._id) || '');
}

function signedOrHttpCover(imageUrl) {
  const url = String(imageUrl || '');
  if (/^https?:\/\//i.test(url)) return url;
  if (url.indexOf('/miniprogram/ai/') >= 0) return url;
  return '';
}

function decorateLead(lead) {
  const floorPlans = Array.isArray(lead && lead.floorPlans) ? lead.floorPlans : [];
  const designable = floorPlans.length > 0;
  const name = String((lead && lead.name) || '未命名客户');
  const communityName = String((lead && lead.communityName) || '');
  const workflowCount = Number((lead && lead.workflowCount) || 0);
  return {
    ...(lead || {}),
    id: String((lead && lead.id) || ''),
    name,
    communityName,
    workflowCount,
    displayTitle: communityName ? `${name} · ${communityName}` : name,
    meta: `${communityName || '未登记小区'} · ${workflowCount} 个方案`,
    group: designable ? 'designable' : 'needs_survey',
    statusLabel: designable ? '可设计' : '待量房',
    actionLabel: designable ? '选择' : '去量房',
    eligibleFloorPlanId: floorPlans[0] && floorPlans[0].id ? String(floorPlans[0].id) : '',
  };
}

function buildLeadPickerView(leads, activeGroup = 'designable', search = '') {
  const query = String(search || '').trim().toLocaleLowerCase();
  const groups = LEAD_GROUP_DEFINITIONS.map((definition) => ({
    ...definition,
    count: (leads || []).filter((item) => item.group === definition.key).length,
    active: definition.key === activeGroup,
  }));
  const filteredLeads = (leads || []).filter((item) => {
    if (item.group !== activeGroup) return false;
    if (!query) return true;
    return [item.name, item.communityName, item.displayTitle]
      .some((value) => String(value || '').toLocaleLowerCase().includes(query));
  });
  const emptyCopy = query
    ? '没有找到匹配的客户'
    : activeGroup === 'designable'
      ? '当前没有可设计的客户'
      : '当前没有待量房的客户';
  return { leadGroups: groups, filteredLeads, leadEmptyCopy: emptyCopy };
}

function chooseDefaultLeadGroup(leads) {
  if ((leads || []).some((item) => item.group === 'designable')) return 'designable';
  return 'needs_survey';
}

function decorateScheme(workflow) {
  const publishedCount = Number((workflow && workflow.publishedCount) || 0);
  const generationCount = Number((workflow && workflow.generationCount) || 0);
  const latest = workflow && workflow.latestGeneration;
  const coverUrl = signedOrHttpCover(latest && (latest.imageUrl || latest.resultImageUrl)) || FOLIO_COVER;
  return {
    ...(workflow || {}),
    id: workflowIdentity(workflow),
    title: String((workflow && workflow.title) || 'AI 设计方案').trim() || 'AI 设计方案',
    publishedCount,
    generationCount,
    meta: publishedCount ? `已确认 ${publishedCount} 张` : `${generationCount} 轮出图`,
    coverUrl,
    sourceFloorPlanId: String(
      (workflow && (workflow.sourceFloorPlanId || (workflow.sourceFloorPlan && workflow.sourceFloorPlan.id))) || '',
    ),
  };
}

function nextSchemeTitle(lead) {
  const count = Number((lead && lead.workflowCount) || 0);
  return count ? `方案 ${count + 1}` : '方案 1';
}

function roomsFromWorkflowDetail(detail) {
  const workflow = (detail && detail.workflow) || detail || {};
  const sourceFloorPlan = workflow.sourceFloorPlan || {};
  const rooms = Array.isArray(sourceFloorPlan.rooms) ? sourceFloorPlan.rooms : [];
  return {
    workflow,
    lead: (detail && detail.lead) || {},
    floorPlanId: String(sourceFloorPlan.id || workflow.sourceFloorPlanId || ''),
    floorPlanName: sourceFloorPlan.name || '正式户型',
    closedRoomCount: Number(sourceFloorPlan.closedRoomCount != null ? sourceFloorPlan.closedRoomCount : rooms.length),
    rooms,
  };
}

function buildScope(closedRoomCount, room) {
  if (!room) {
    return {
      key: 'whole_floor_plan',
      targetScope: 'whole_floor_plan',
      roomId: '',
      name: '完整户型',
      meta: `${Number(closedRoomCount || 0)} 个闭合空间`,
    };
  }
  return {
    key: room.roomId,
    targetScope: 'single_room',
    roomId: room.roomId,
    name: room.roomName || '房间',
    meta: room.roomSize || `${Number(room.openingCount || 0)} 个门窗开口`,
  };
}

function buildScopes(rooms, closedRoomCount) {
  const list = Array.isArray(rooms) ? rooms : [];
  return [buildScope(closedRoomCount, null), ...list.map((room) => buildScope(closedRoomCount, room))];
}

module.exports = {
  LEAD_GROUP_DEFINITIONS,
  decorateLead,
  buildLeadPickerView,
  chooseDefaultLeadGroup,
  decorateScheme,
  nextSchemeTitle,
  roomsFromWorkflowDetail,
  buildScope,
  buildScopes,
  workflowIdentity,
};
