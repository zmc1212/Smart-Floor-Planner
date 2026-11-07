import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fail, type Evidence } from '../contracts';

export const fastGPTRagProtocol = 'fastgpt-native-rag-v1';
export type RagSource = { nativeId: string; datasetId: string; collectionId: string; q: string; a: string; evidence: Evidence };
export type RagConfiguration = { protocol: typeof fastGPTRagProtocol; enterpriseId: string; appId: string;
  mode?: 'unified';
  grounding?: 'native-dataset' | 'native-dataset-classified';
  transportModel: string; bridgeKey: string; model: 'qwen3.7-flash' | 'qwen3.7-plus'; embeddingModel: 'text-embedding-v4'; sources: RagSource[] };
/** Private deployment binding, never accepted from chat input. The whole file
 * (including transport credentials) is bound to admission and each later read. */
export function fastGPTRagConfiguration(enterpriseId: string): { configuration: RagConfiguration; binding: string } | undefined {
  const file = process.env.XIAOK_FASTGPT_WORKFLOWS_FILE;
  if (!file) return;
  const bytes = fs.readFileSync(file), configuration = JSON.parse(bytes.toString('utf8')).rag as RagConfiguration | undefined;
  if (!configuration || configuration.enterpriseId !== enterpriseId) return;
  if (configuration.protocol !== fastGPTRagProtocol || configuration.mode !== undefined && configuration.mode !== 'unified'
    || configuration.grounding !== undefined && (!['native-dataset','native-dataset-classified'].includes(configuration.grounding) || configuration.mode !== 'unified')
    || !['qwen3.7-flash','qwen3.7-plus'].includes(configuration.model) || configuration.model === 'qwen3.7-plus' && configuration.mode !== 'unified'
    || configuration.embeddingModel !== 'text-embedding-v4' || !/^[a-f0-9]{24}$/.test(configuration.appId)
    || !configuration.transportModel || configuration.bridgeKey.length < 32 || !configuration.sources?.length
    || configuration.sources.length > 100 || new Set(configuration.sources.map(s => s.nativeId)).size !== configuration.sources.length
    || configuration.sources.some(s => ![s.nativeId, s.datasetId, s.collectionId].every(id => /^[a-f0-9]{24}$/.test(id))
      || typeof s.q !== 'string' || typeof s.a !== 'string' || s.evidence.ref.type !== 'knowledge_chunk'
      || !s.evidence.text || s.evidence.text.length > 600)) fail('context_changed');
  return { configuration, binding: createHash('sha256').update(bytes).digest('hex') };
}
