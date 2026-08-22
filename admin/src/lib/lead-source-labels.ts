export const LEAD_SOURCE_LABELS: Record<string, string> = {
  referrer_network: '推荐人网络',
  staff_activity: '员工活动码',
  manual_entry: '企业录入',
};

export function getLeadSourceLabel(source?: string | null) {
  if (!source) return '未知';
  return LEAD_SOURCE_LABELS[source] || source;
}
