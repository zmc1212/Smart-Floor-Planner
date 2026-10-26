import { fail } from '../contracts';
import { allRequirementKeys, type RequirementKey } from './contract';
import { requirementItems, type CustomerSource, type RequirementChange } from './items';
import { requirementReview } from './review';

/** Omission retains the pre-existing whole-proposal protocol for old clients. */
export function selectedRequirementFields(value: unknown): RequirementKey[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length || value.length > allRequirementKeys.length
    || new Set(value).size !== value.length
    || value.some(k => typeof k !== 'string' || !allRequirementKeys.includes(k as RequirementKey))) {
    fail('invalid_requirement_selection', 422);
  }
  return allRequirementKeys.filter(k => value.includes(k));
}

/** The customer selects fields; model-generated scope is never approval. */
export function selectedRequirementReview(messages: CustomerSource[], previous: unknown, changes: unknown, value: unknown) {
  const complete = requirementReview(messages, previous, changes);
  const selected = selectedRequirementFields(value);
  if (!selected) return complete;
  if (selected.some(k => !complete.diff.some(d => d.field === k))) fail('invalid_requirement_selection', 422);
  const before = requirementItems(messages, previous);
  const chosen = (changes as RequirementChange[]).filter(c => {
    const field = c.operation === 'add' ? c.field : before.find(i => i.id === c.targetId)?.field;
    if (!field) fail('invalid_requirement_selection', 422);
    return selected.includes(field);
  });
  const review = requirementReview(messages, previous, chosen);
  // Preserve the exact stored representation as well as item IDs/provenance.
  for (const field of allRequirementKeys) if (!selected.includes(field) && previous && typeof previous === 'object'
    && field in previous) review.fields[field] = (previous as typeof review.fields)[field];
  return review;
}
