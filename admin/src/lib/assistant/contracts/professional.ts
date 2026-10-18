/** Published with the knowledge version; classification never grants access. */
export type ProfessionalKnowledge = {
  version: 1;
  kind: 'construction' | 'material' | 'service' | 'explanation' | 'internal';
  topics: string[];
  conditions: Array<{ field: 'stage' | 'room' | 'material' | 'city'; operator: 'in' | 'not_in'; values: string[] }>;
  prerequisites: string[];
  exceptions: string[];
  origin: { title: string; version: string; locator: string; authority: 'enterprise_rule' | 'manufacturer' | 'reference' };
  claim: { key: string; value: string } | null;
  review: { note: string; adminId: string; reviewedAt: string };
};
export type KnowledgeContext = { stage?: string; projectId?: string; revision?: number; leadId?: string };
export type Applicability = { status: 'applicable' | 'unknown' | 'not_applicable'; matched: string[]; missing: string[]; mismatched: string[] };
export type ProfessionalEvidence = {
  documentId: string; title: string; contentHash: string;
  entry: ProfessionalKnowledge; applicability: Applicability; context: KnowledgeContext;
};
