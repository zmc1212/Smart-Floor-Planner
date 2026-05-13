import { Badge } from '@/components/ui/badge';
import { EnterpriseListItem } from './types';

export function getEnterpriseStatusBadge(status: EnterpriseListItem['status']) {
  switch (status) {
    case 'pending_approval':
      return (
        <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">
          寰呭鏍?
        </Badge>
      );
    case 'active':
      return (
        <Badge variant="secondary" className="bg-green-100 text-green-800 hover:bg-green-100">
          宸插惎鐢?
        </Badge>
      );
    case 'disabled':
      return (
        <Badge variant="outline" className="border-gray-200 text-gray-500">
          宸茬鐢?
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export function formatAiKeyStatus(ent: EnterpriseListItem) {
  const keyId = ent.aiUsageSnapshot?.keyInfo?.keyId || ent.aiConfig?.pollinationsKeyRef || '';
  if (!keyId) {
    return '鏈厤缃?';
  }

  if (ent.aiUsageSnapshot?.keyInfo?.valid === false) {
    return 'Key 鏃犳晥';
  }

  return '宸查厤缃?';
}
