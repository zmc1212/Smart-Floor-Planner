import { Badge } from '@/components/ui/badge';
import { EnterpriseListItem } from './types';

export function getEnterpriseStatusBadge(status: EnterpriseListItem['status']) {
  switch (status) {
    case 'pending_approval':
      return (
        <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">
          待审核
        </Badge>
      );
    case 'active':
      return (
        <Badge variant="secondary" className="bg-green-100 text-green-800 hover:bg-green-100">
          已启用
        </Badge>
      );
    case 'disabled':
      return (
        <Badge variant="outline" className="border-gray-200 text-gray-500">
          已禁用
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export function isEnterpriseWecomConfigured(ent: EnterpriseListItem) {
  return Boolean(
    ent.wecomConfigConfigured || (ent.wecomConfig?.corpId && ent.wecomConfig?.agentId)
  );
}

export function getWecomCompletionText(ent: EnterpriseListItem) {
  const configuredStaff = Number(ent.wecomMemberStats?.configuredStaff || 0);
  const totalStaff = Number(ent.wecomMemberStats?.totalStaff || 0);
  return `${configuredStaff}/${totalStaff}`;
}

export function formatAiKeyStatus(ent: EnterpriseListItem) {
  return ent.aiUsageSnapshot?.keyInfo?.status || ent.aiConfig?.status || 'unconfigured';
}
