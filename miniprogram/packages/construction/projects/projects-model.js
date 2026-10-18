const roleLabels = { manager: '项目经理', worker: '施工师傅', designer: '设计协作', observer: '只读成员', owner: '企业负责人' };
const statusLabels = { active: '进行中', paused: '已暂停', archived: '已归档' };
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
function decorateDetail(value) {
  const assignments = value.assignments || [];
  return { ...value, project: decorateProject(value.project, value.stages || []),
    roleLabel: roleLabels[value.myRole] || '',
    stages: (value.stages || []).map(s => ({ ...s,
      assignedText: assignments.filter(a => a.stage_key === s.key).map(a => `${a.display_name}${a.staff_status !== 'active' ? '（已停用）' : a.is_primary ? '（主要联系人）' : ''}`).join('、') || '待分配员工',
    })),
    members: (value.members || []).map(m => ({ ...m, roleLabel: roleLabels[m.role] || m.role,
      available: m.active && m.staff_status === 'active', canRemove: value.manage && (value.owner || m.role !== 'manager') && m.active })),
  };
}
function operationKey() { return 'construction-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }
module.exports = { decorateProject, decorateDetail, errorText, roleLabels, operationKey };
