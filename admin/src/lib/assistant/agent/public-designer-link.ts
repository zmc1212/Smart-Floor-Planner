import type { ModelTool } from '../contracts/model';

export const publicDesignerLinkProtocol = 'designer-service-link-v1';
export const publicDesignerLinkToolName = 'offer_designer_service_link';

/** A public visitor does not receive a platform-wide designer catalogue. The
 * typed action only records the exact question that should be continued after
 * the visitor scans an enterprise activity code. */
export const publicDesignerServiceLinkTool: ModelTool = {
  name: publicDesignerLinkToolName,
  description: '仅当客户本轮明确要找、推荐或联系具体设计师时调用。不要用于“如何挑选设计师”的泛建议；不查目录、不创建线索、不联系任何人，只为当前原问题准备扫活动码后继续的入口。无需参数。',
  parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
};

export function publicDesignerLinkReceipt(questionMessageId: string) {
  return {
    protocol: publicDesignerLinkProtocol,
    status: 'ready',
    questionMessageId,
    instructions: '回复中只说明扫活动码后可以继续联系设计师；不得声称已匹配、已联系、已预约或已创建线索。',
  };
}
