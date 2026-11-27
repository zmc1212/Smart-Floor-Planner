const { parseAppointmentBounds, formatAppointmentDisplay } = require('./appointmentTimeRange');

function name(item) { return item.communityName || item.title || '量房项目'; }

function localSurvey(leadId, read) {
  if (!/^[1-9]\d{0,18}$/.test(String(leadId))) return 0;
  let entry;
  try { entry = read('surveying_draft_v1_' + leadId); } catch { return 0; }
  const draft = entry?.kind === 'survey-draft-envelope' ? entry.draft : entry;
  if (draft?.kind !== 'survey-wall-graph' || !Array.isArray(draft.floors)) return 0;
  const hasDrawing = draft.floors.some(floor => (Array.isArray(floor?.walls) && floor.walls.length)
    || (Array.isArray(floor?.openings) && floor.openings.length)
    || (Array.isArray(floor?.spaces) && floor.spaces.some(space => space?.closed)));
  return hasDrawing ? Number(entry.savedAt) || 1 : 0;
}

function buildWorkbenchSurvey(appointments, floorPlans, now = Date.now(), read = key => wx.getStorageSync(key)) {
  const day = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  const own = appointments.filter(item => item.canPerformSurvey && item.status === 'confirmed' && item.leadId && item.appointmentId);
  const visits = own.flatMap(item => {
    const range = formatAppointmentDisplay(item.timeRange);
    const bounds = parseAppointmentBounds(item.timeRange);
    return range.dateKey === day && bounds && (item.canCompleteSurvey || +bounds.endAt > now) ? [{ item, range }] : [];
  }).sort((a, b) => a.range.startMs - b.range.startMs);
  const visit = visits[0];
  let task = null;
  if (visit) {
    const { item, range } = visit;
    const canEnter = !item.canCompleteSurvey && item.floorPlanStatus !== 'completed';
    task = { label: '今日上门', title: range.timeText.replace(' - ', '–'), numeric: true, meta: name(item), note: item.subtitle,
      button: canEnter ? (item.floorPlanId ? '继续量房' : '开始量房') : item.canCompleteSurvey ? '确认完成量房' : '查看预约详情',
      kind: canEnter ? 'survey' : 'appointment', startMs: range.startMs, item };
  }
  const local = own.filter(item => !item.floorPlanId)
    .map(item => ({ item, savedAt: localSurvey(item.leadId, read) })).filter(row => row.savedAt)
    .sort((a, b) => b.savedAt - a.savedAt).slice(0, 3)
    .map(({ item }) => ({ key: 'local-' + item.leadId, title: name(item), status: '草稿 · 仅保存在本机', action: 'survey', item }));
  const cloud = floorPlans.filter(item => item.floorPlanId && item.floorPlanStatus === 'completed')
    .map(item => ({ key: 'cloud-' + item.floorPlanId, title: name(item), status: '正式户型 · 已归档', action: 'plan', item }));
  return { task, records: [...local, ...cloud] };
}

module.exports = { buildWorkbenchSurvey };
