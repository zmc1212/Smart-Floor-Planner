/** Offline acceptance oracles only. Not wired to runtime authorization, dispatch or semantic approval. */
import { isDeepStrictEqual } from 'node:util';
import { fingerprint } from '@/lib/assistant/contracts';

export type KnowledgeSourceSnapshot = {
  sourceId: string; documentId: string; ref: { type: string; id: string; version: string }; hash: string; text: string;
  model: { professional: unknown; applicability: unknown; context: unknown };
};
export type AcceptanceSegment = { basis: string; text: string; citations: Array<{ sourceId: string; quote: string }> };
export type JointPremiseExpectation = {
  /** Reviewer-owned annotation, zero based; the model must not select or weaken this expectation. */
  segmentIndex: number;
  support: Array<{ sourceId: string; documentId: string; version: string; hash: string; quote: string }>;
};
function result(scope: string, violations: string[]) {
  return { scope, passed: violations.length === 0, violations, semanticCorrectness: 'requires_review' as const };
}
function validSnapshot(source: KnowledgeSourceSnapshot) {
  return !!source.sourceId && !!source.documentId && source.ref.type === 'knowledge_chunk' && !!source.ref.id
    && !!source.ref.version && !!source.text && source.hash === fingerprint(source.text);
}

/** Preserve every selected canonical chunk, including repeats from one document and all source metadata.
 * Redundant excerpt/quote hints may be omitted; they cannot replace the complete canonical text. */
export function checkKnowledgeSourceCoverage(requiredDocumentIds: readonly string[], expected: readonly KnowledgeSourceSnapshot[], included: readonly KnowledgeSourceSnapshot[]) {
  const violations: string[] = [];
  if (!requiredDocumentIds.length || new Set(requiredDocumentIds).size !== requiredDocumentIds.length) violations.push('invalid_required_documents');
  if (!expected.length || new Set(expected.map(s => s.sourceId)).size !== expected.length || expected.some(s => !validSnapshot(s))) violations.push('invalid_expected_sources');
  for (const documentId of requiredDocumentIds) if (!expected.some(s => s.documentId === documentId)) violations.push('missing_expected_document:' + documentId);
  if (new Set(included.map(s => s.sourceId)).size !== included.length) violations.push('duplicate_included_source');
  for (const source of included) if (!expected.some(s => s.sourceId === source.sourceId)) violations.push('unexpected_source:' + source.sourceId);
  for (const source of expected) {
    const actual = included.find(s => s.sourceId === source.sourceId);
    if (!actual) violations.push('missing_source:' + source.sourceId);
    else if (!validSnapshot(actual) || !isDeepStrictEqual(actual, source)) violations.push('changed_source:' + source.sourceId);
  }
  return result('declared_source_coverage', violations);
}

/** Check a declared shared-prerequisite claim in its own evidence paragraph.
 * This is not free-text claim extraction. Both sides must retain identity/version and quote the complete premise. */
export function checkJointPremiseAttribution(segments: readonly AcceptanceSegment[], sources: readonly KnowledgeSourceSnapshot[], expected: JointPremiseExpectation) {
  const violations: string[] = [];
  if (!Number.isSafeInteger(expected.segmentIndex) || expected.segmentIndex < 0 || expected.support.length < 2
    || new Set(expected.support.map(s => s.sourceId)).size !== expected.support.length
    || new Set(expected.support.map(s => s.documentId)).size !== expected.support.length) violations.push('invalid_joint_premise_expectation');
  const segment = segments[expected.segmentIndex];
  if (!segment || segment.basis !== 'evidence' || !segment.text.trim()) violations.push('missing_evidence_paragraph');
  for (const side of expected.support) {
    const matches = sources.filter(s => s.sourceId === side.sourceId), source = matches[0];
    if (matches.length !== 1 || !validSnapshot(source) || source.documentId !== side.documentId || source.ref.version !== side.version || source.hash !== side.hash
      || !side.quote.trim() || !source.text.includes(side.quote)) { violations.push('invalid_premise_source:' + side.sourceId); continue; }
    if (!segment?.citations.some(c => c.sourceId === side.sourceId && c.quote.includes(side.quote) && source.text.includes(c.quote))) {
      violations.push('missing_same_paragraph_support:' + side.sourceId);
    }
  }
  return result('declared_joint_premise', violations);
}

export type DispatchObservation = {
  /** Target model turn only. Earlier dispatch markers and unknown charges must not be erased. */
  events: Array<{ kind: string; code?: string }>;
  httpCalls: number; terminalStatus: string; reservationStatus: string;
  priorBillableUnsettled: boolean;
  providerAttempts: Array<{ status: string; accepted: boolean }>;
};
/** Contract for an independently confirmed oversized request. An attempt-created row is allowed;
 * a provider-started marker, HTTP invocation or unknown outcome is not a valid local rejection. */
export function checkOversizeDispatchRejection(textBytes: number, limit: number, observation: DispatchObservation) {
  const violations: string[] = [];
  if (!Number.isSafeInteger(textBytes) || !Number.isSafeInteger(limit) || limit !== 48000 || textBytes <= limit) violations.push('invalid_oversize_case');
  const rejected = observation.events.findIndex(e => e.kind === 'preparation_rejected' && e.code === 'agent_input_limit');
  if (rejected < 0) violations.push('missing_pre_dispatch_rejection');
  const marker = observation.events.findIndex(e => e.kind === 'provider_started');
  if (marker >= 0) violations.push(marker < rejected ? 'provider_started_before_rejection' : 'provider_started_after_rejection');
  if (observation.events.some(e => e.kind === 'http_dispatched') || observation.httpCalls !== 0) violations.push('http_dispatched');
  if (observation.terminalStatus !== 'failed') violations.push('not_known_failed');
  if (observation.providerAttempts.some(a => a.status !== 'failed' || a.accepted)) violations.push('turn_attempt_not_known_unaccepted');
  if (observation.events.filter(e => e.kind === 'attempt_created').length !== observation.providerAttempts.length) violations.push('attempt_trace_mismatch');
  if (observation.priorBillableUnsettled) {
    if (observation.reservationStatus !== 'reconciling') violations.push('prior_cost_reconciliation_lost');
  } else if (!['released', 'none'].includes(observation.reservationStatus)) violations.push('reservation_not_released');
  return result('oversize_dispatch_fence', violations);
}
