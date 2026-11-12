const roleLabels = { manager: '项目经理', worker: '施工师傅', designer: '设计协作', observer: '只读成员', owner: '企业负责人' };
const statusLabels = { active: '进行中', paused: '已暂停', archived: '已归档' };
const issueStatusLabels = { awaiting_owner: '待处理', awaiting_review: '待核对', invalidated: '待重新核对', rectifying: '整改中',
  cancelled: '已取消', dismissed: '已排除', implemented: '已整改待复核', resolved: '已修正待关闭', closed: '已修正' };
// Classification comes from the server projection; the page only orders it for display.
const issueGroupOrder = [['awaitingVerification', '待核实'], ['awaitingRectification', '待整改'], ['rectifying', '整改中'],
  ['awaitingReview', '已整改待复核'], ['fixed', '已修正'], ['excluded', '已排除或误报'], ['designReviews', '需求与设计']];
const planStatusLabels = { pending_customer: '待业主确认', deferred: '业主稍后决定', approved: '已确认',
  declined: '业主未同意', changes_requested: '业主已要求修改', withdrawn: '已撤回' };
const sourceLabels = { need: '业主需求', record: '现场记录' };
function issueWaitingText(issue) {
  if (issue.status === 'invalidated') return '原材料已变化，打开后重新核对当前版本';
  if (issue.status === 'dismissed') return '已排除为误报或非施工质量问题，不计入施工质量';
  if (issue.status === 'awaiting_owner') return issue.ownerName ? '等待' + issue.ownerName + '处理' : '尚未分配有效负责人';
  if (issue.status === 'awaiting_review') return '已有处理回复，仍待团队核对';
  if (issue.status === 'implemented') return '已提交现场落实，等待管理复核';
  if (issue.status === 'resolved') return '已正式解决，尚未关闭';
  if (issue.status === 'closed') return '已正式关闭，记录保留';
  if (issue.status === 'cancelled') return '已取消跟进';
  return '当前状态';
}
function decorateIssue(issue) {
  return { ...issue, statusLabel: issueStatusLabels[issue.status] || issue.status,
    sourceLabel: sourceLabels[issue.sourceKind] || '', waitingText: issueWaitingText(issue) };
}
function decoratePlan(plan) {
  return { ...plan, statusLabel: plan.available ? planStatusLabels[plan.status] || plan.status : '已失效' };
}
const errors = {
  construction_forbidden: '当前身份无工地权限，请联系企业负责人。', construction_not_found: '工地不存在或已取消分配，请返回刷新。',
  construction_staff_unavailable: '员工已停用或不属于本企业，请重新选择。', construction_member_required: '请先将员工加入本工地。',
  construction_project_inactive: '工地已暂停或归档，暂不能更新节点。', construction_stage_unavailable: '节点已调整，请刷新后重试。',
  construction_manager_required: '工地至少保留一位有效项目经理。', construction_reminder_disabled: '本节点尚未开启到场提醒。',
  construction_password_required: '请完成密码修改，或使用微信手机号登录。',
  version_conflict: '工地资料已有更新，请刷新核对后重新提交。', idempotency_conflict: '本次操作与原提交不一致，请核对原请求。',
  invalid_construction: '请核对员工、节点与填写内容。', construction_unavailable: '工地服务暂不可用，请稍后核对。',
};
function errorText(error) { return errors[error && error.error] || (error && error.statusCode === 401 ? '登录已失效，请重新登录。' : '暂未完成，请检查网络后重试。'); }
function decorateProject(p, stages) {
  return { ...p, stageName: (stages.find(s => s.key === p.current_stage_key) || {}).name || '尚未标记',
    statusLabel: statusLabels[p.status] || p.status, roleLabel: roleLabels[p.my_role] || '',
    workLabel: p.my_work_label || (p.my_stages || []).map(k => (stages.find(s => s.key === k) || {}).name).filter(Boolean).join(' / ') || '分工待安排' };
}
function decorateIssueGroups(groups, issues) {
  if (!groups) return [];
  return issueGroupOrder.map(([key, label]) => {
    const items = (groups[key] || []).map(issue => ({ ...issue, designText: issue.designRelated ? '设计相关' : '',
      mineText: issue.mine ? '我负责' : '', ownerText: issue.ownerName || '未分配负责人',
      syncLabel: issues.find(current => current.issueId === issue.issueId)?.sync?.label || '' }));
    return { key, label, count: items.length, items };
  }).filter(section => section.count > 0);
}
function decorateProgress(progress) {
  if (!progress) return null;
  return { ...progress,
    nodes: (progress.nodes || []).map(node => ({ ...node, title: [node.roomName, node.stageName].filter(Boolean).join(' · '),
      dateText: node.plannedStart + ' 至 ' + node.plannedEnd })) };
}
function decorateDetail(value) {
  const assignments = value.assignments || [];
  const issues = (value.issues || []).map(decorateIssue);
  const plans = (value.plans || []).map(decoratePlan);
  const issueSections = decorateIssueGroups(value.issueGroups, issues);
  return { ...value, project: decorateProject(value.project, value.stages || []),
    roleLabel: roleLabels[value.myRole] || '',
    issueSections,
    progress: decorateProgress(value.progress),
    issueCount: value.issueGroups ? value.issueGroups.openCount : issues.filter(issue => !['cancelled', 'closed', 'resolved', 'dismissed'].includes(issue.status)).length,
    pendingIssues: issues.filter(issue => !['cancelled', 'closed', 'resolved', 'dismissed'].includes(issue.status)).slice(0, 6),
    approvedPlans: plans.filter(plan => plan.available && plan.status === 'approved').slice(0, 6),
    stages: (value.stages || []).map(s => ({ ...s,
      assignedText: assignments.filter(a => a.stage_key === s.key).map(a => `${a.display_name}${a.staff_status !== 'active' ? '（已停用）' : a.is_primary ? '（主要联系人）' : ''}`).join('、') || '待分配员工',
    })),
    members: (value.members || []).map(m => ({ ...m, roleLabel: roleLabels[m.role] || m.role,
      available: m.active && m.staff_status === 'active', canRemove: value.manage && (value.owner || m.role !== 'manager') && m.active })),
  };
}
function operationKey() { return 'construction-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }
module.exports = { decorateProject, decorateDetail, decorateIssue, decoratePlan, errorText, roleLabels, operationKey };
