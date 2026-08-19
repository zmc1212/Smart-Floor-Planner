export function isAssignmentEligibleStaff(member: {
  role?: string | null;
  status?: string | null;
  assignmentPaused?: boolean | null;
  wechatId?: string | null;
  wechatQrAssetId?: string | bigint | null;
}) {
  if (member.status !== 'active' || member.assignmentPaused) return false;
  if (member.role === 'measurer') return true;
  if (member.role !== 'designer') return false;
  return Boolean(String(member.wechatId || '').trim() && member.wechatQrAssetId);
}

export function buildStaffingGapItems(input: {
  eligibleDesignerCount: number;
  eligibleMeasurerCount: number;
}) {
  const items = [];
  if (input.eligibleDesignerCount <= 0) {
    items.push({
      id: 'staffing-designer',
      title: '暂无可用设计师',
      subtitle: '补齐微信号、二维码或恢复派单后，再重试待派队列',
      metaLabel: '人员缺口',
      action: 'staffing',
      serviceStage: 'assignment_pending',
      nextAction: '补齐可用设计师或测量员后重试派单',
    });
  }
  if (input.eligibleMeasurerCount <= 0) {
    items.push({
      id: 'staffing-measurer',
      title: '暂无可用测量员',
      subtitle: '启用测量员或取消暂停派单后，再重试待派队列',
      metaLabel: '人员缺口',
      action: 'staffing',
      serviceStage: 'assignment_pending',
      nextAction: '补齐可用设计师或测量员后重试派单',
    });
  }
  return items;
}
