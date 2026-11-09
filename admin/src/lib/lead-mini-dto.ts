import { leadToDto } from '@/db/postgres-dto';
import { getSignedMiniAiAssetUrl } from '@/lib/ai/mini-ai-assets';
import { attachLeadAssignmentActions } from '@/lib/lead-assignment-actions';
import { redactLeadConversionDetailsForConsumer } from '@/lib/lead-conversion';

export function leadDtoForMini(
  request: Request,
  lead: Parameters<typeof leadToDto>[0],
  role?: string,
  actorId?: bigint | null
) {
  const include = role === 'measurer';
  const hasStaffContext = Boolean(role && role !== 'user');
  const assetId = lead.assignedUser?.wechatQrAssetId;
  const dto = leadToDto(lead, {
    includeDesignerWechat: include,
    designerWechatQrUrl: include && assetId && lead.enterpriseId
      ? getSignedMiniAiAssetUrl({ request, assetId: assetId.toString(), enterpriseId: lead.enterpriseId.toString() })
      : null,
  });
  const scoped = hasStaffContext ? dto : redactLeadConversionDetailsForConsumer(dto);
  return attachLeadAssignmentActions(scoped, lead, role || '', actorId ?? null);
}
