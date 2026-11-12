import type { ModelMessage } from '../contracts/model';
import { originalMessageId } from './context-budget';
import { isKnowledgeTool } from '../knowledge/rag-tools';

export const homeSourceViewProtocol = 'explicit-home-read-view-v1';
export type HomeSourceView = { conversationId: string; leadId: string };

export const knowledgeSynthesisReadInstructions = '解释专业原理、取舍、适用条件时用kind=synthesis和segments，引用本轮synthesisSources；原文查询也用该段落结构保留引用，不输出kind=knowledge或顶层text/selections。冲突保留双方并说明待核实；缺知识仍可给标明身份的一般建议。不得编造企业或现场事实。其他独立业务/案例展示结果沿其真实resultKey与原协议。'
  + '当前问题若问验收或完成状态，直接用“当前证据不足以支持该结论，仍需核对实际检查记录”等措辞回答判断。text中禁止复述完成词，包括否定句、引号与举例中的“已验收”“已经验收”“已批准”“已经批准”“已完成验收”；不要写“不能认定已经验收/不支持已经验收”，改为“当前证据不能支持该结论”。原文quote仍须逐字保留，不能改写。';

/** Only the model request changes. The durable tool receipts and source
 * revalidation are unchanged. Prefer the customer's explicit room read over
 * the whole-home context automatically attached to a later knowledge result. */
export function projectHomeSourceView(messages: ModelMessage[], triggerId: string, home: HomeSourceView): ModelMessage[] {
  const trigger = messages.findIndex(message => originalMessageId(message) === triggerId);
  if (trigger < 0) return messages;
  let calls = new Map<string, string>(), explicit = false, changed = false;
  const projected = messages.map((message, index) => {
    if (index <= trigger) return message;
    if (message.role === 'assistant') {
      calls = new Map(message.toolCalls?.map(call => [call.id, call.name]));
      return message;
    }
    if (message.role !== 'tool') return message;
    const name = calls.get(message.callId);
    calls.delete(message.callId);
    if (name !== 'query_materials' && name !== 'search_knowledge' && !(name && isKnowledgeTool(name))) return message;
    if (name === 'query_materials') explicit = false;
    try {
      const packet = JSON.parse(message.content);
      if (!Array.isArray(packet?.synthesisSources)) return message;
      if (name === 'query_materials') {
        explicit = packet.query?.domain === 'materials' && packet.query?.conversationId === home.conversationId
          && packet.query?.leadId === home.leadId && Array.isArray(packet.leadIds) && packet.leadIds.length === 1
          && packet.leadIds[0] === home.leadId && packet.data?.resolution === 'resolved' && typeof packet.resultKey === 'string'
          && packet.synthesisSources.some((source: { kind?: string; resultKey?: string }) => source?.kind === 'project' && source.resultKey === packet.resultKey);
        return message;
      }
      if (!explicit || packet.boundProjectContext?.resolution !== 'resolved' || typeof packet.knowledgeStatus !== 'string'
        || packet.unresolvedConflict !== false || packet.instructions !== knowledgeSynthesisReadInstructions) return message;
      const synthesisSources = packet.synthesisSources.filter((source: { kind?: string; resultKey?: string }) =>
        !(source?.kind === 'project' && /^(?:bound|stage|followups):/.test(source.resultKey ?? '')));
      if (synthesisSources.length === packet.synthesisSources.length) return message;
      changed = true;
      const compact = { ...packet, synthesisSources,
        instructions: '企业知识用本回执，现场判断用本轮显式获权资料；缺少现场事实需向现场团队核实。' };
      delete compact.boundProjectContext;
      return { ...message, content: JSON.stringify(compact) };
    } catch { return message; }
  });
  return changed ? projected : messages;
}
