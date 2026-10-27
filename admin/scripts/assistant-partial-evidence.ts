import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { bailianBinding, type BailianBinding } from '@/lib/ai/providers/bailian-capabilities';
import { parseAgentChat } from '@/lib/ai/providers/agent-chat';
import { partialBody, joinDraft } from '@/lib/assistant/agent/draft-continuation';
import { fingerprint } from '@/lib/assistant/contracts';

/** Local development proof, never a boolean environment bypass. Reparse the
 * original successful wire response with today's parser and exact request.
 * Search-only changes in the shared transport do not invalidate Partial proof. */
export function verifyPartialEvidence(root:string,file:string,binding:BailianBinding):boolean {
  try {
    const evidence=JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));
    if(evidence.protocol!=='bailian-partial-live-v1'||binding.thinking
      ||fingerprint(bailianBinding(binding.baseUrl,binding.model,false))!==fingerprint(binding)
      ||fingerprint(evidence.binding)!==fingerprint(binding))return false;
    for(const source of ['admin/src/lib/assistant/agent/draft-continuation.ts','admin/src/lib/assistant/contracts/model.ts','admin/src/lib/ai/providers/agent-chat.ts']) {
      const actual=createHash('sha256').update(fs.readFileSync(path.join(root,source))).digest('hex');
      if(evidence.sourceHashes?.[source]!==actual)return false;
    }
    const request=partialBody(binding,evidence.prefix);
    if(fingerprint(request)!==evidence.requestHash||fingerprint(evidence.request)!==evidence.requestHash)return false;
    const wire=JSON.parse(fs.readFileSync(path.resolve(evidence.wireFile),'utf8'));
    if(wire.status!==200||wire.method!=='POST'||wire.url!==binding.baseUrl+'/chat/completions'
      ||fingerprint(wire.body)!==evidence.requestHash||!wire.response)return false;
    const timestamp=Date.parse(wire.startedAt);
    if(!Number.isFinite(timestamp)||timestamp>Date.now()+60000||Date.now()-timestamp>7*86400000)return false;
    const parsed=parseAgentChat(wire.response,wire.requestId);
    if(!parsed.usage||!parsed.providerRequestId||parsed.toolCalls.length||parsed.finishReason!=='stop'
      ||fingerprint(parsed)!==evidence.responseHash||fingerprint(evidence.result)!==evidence.responseHash)return false;
    joinDraft(evidence.prefix,parsed.text);return true;
  }catch{return false;}
}
