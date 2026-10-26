import { fingerprint, fail } from '../contracts';
import { allRequirementKeys, type DraftRequirements } from './contract';
import { applyRequirementChanges, requirementItems, requirementSources, type CustomerSource, type RequirementChange } from './items';

/** A review is a proposed diff, never customer consent or a saved requirement. */
export function requirementReview(messages: CustomerSource[], previous: unknown, changes: unknown) {
  if (!Array.isArray(changes) || changes.length > 20) fail('invalid_requirement_changes', 422);
  for (const c of changes) if (!c || typeof c !== 'object' || Array.isArray(c)
    || Object.keys(c).some(k => !['operation','targetId','sourceId','field'].includes(k))) fail('invalid_requirement_changes', 422);
  const before = requirementItems(messages, previous), sources = requirementSources(messages);
  // A repeated exact addition is an acknowledgement of the existing item. Only
  // an add that satisfies the same field/source/target shape as the authoritative
  // validator may be removed; malformed values must still reach that validator.
  const isRepeatedAddition = (c: RequirementChange) => {
    if (c.operation !== 'add' || c.targetId !== undefined || typeof c.field !== 'string' || typeof c.sourceId !== 'string'
      || !allRequirementKeys.includes(c.field as typeof allRequirementKeys[number])) return false;
    const source = sources.find(s => s.id === c.sourceId);
    return !!source && before.some(item => item.field === c.field && item.text === source.text);
  };
  const effective = changes.filter((c: RequirementChange) => !isRepeatedAddition(c));
  const fields = effective.length ? applyRequirementChanges(messages, previous, effective)
    : (previous || Object.fromEntries(allRequirementKeys.map(k => [k, { text: '', sourceMessageId: null, truncated: false, items: [] }]))) as DraftRequirements;
  const after = requirementItems(messages, fields);
  const values = (items: typeof before) => allRequirementKeys.map(field => ({ field, texts: items.filter(i => i.field === field).map(i => i.text).sort() }));
  const unchanged = fingerprint(values(before)) === fingerprint(values(after));
  const position = (source: string) => messages.findIndex(m => m.id === source);
  const historicalTargets = new Set<string>();
  const isEarlierDifferentSource = (old: (typeof before)[number], source: (typeof sources)[number]) => {
    const sourcePosition = position(source.sourceMessageId), oldPosition = position(old.sourceMessageId);
    return source.text !== old.text && sourcePosition >= 0 && oldPosition >= 0 && sourcePosition < oldPosition;
  };
  for (const c of effective as RequirementChange[]) {
    if (c.operation !== 'replace') continue;
    const old = before.find(i => i.id === c.targetId), source = typeof c.sourceId === 'string' ? sources.find(s => s.id === c.sourceId) : undefined;
    if (old && source && isEarlierDifferentSource(old, source)) historicalTargets.add(old.id);
  }
  // A remove followed by an add can encode the same restoration as replace.
  // Pair by field so removing one item does not make an unrelated historical
  // addition require consent.
  const removed = (effective as RequirementChange[]).flatMap(c => {
    if (c.operation !== 'remove') return [];
    const old = before.find(i => i.id === c.targetId);
    return old ? [old] : [];
  });
  const added = (effective as RequirementChange[]).flatMap(c => {
    if (c.operation !== 'add' || typeof c.field !== 'string' || typeof c.sourceId !== 'string') return [];
    const source = sources.find(s => s.id === c.sourceId);
    return source ? [{ field: c.field, source }] : [];
  });
  for (const old of removed) if (added.some(next => next.field === old.field && isEarlierDifferentSource(old, next.source))) {
    historicalTargets.add(old.id);
  }
  const diff = allRequirementKeys.flatMap(field => {
    const old = before.filter(i => i.field === field), next = after.filter(i => i.field === field);
    if (fingerprint(old.map(i => i.text)) === fingerprint(next.map(i => i.text))) return [];
    return [{ field, before: old.map(i => i.text).join('；'), after: next.map(i => i.text).join('；'),
       sources: next.map(i => ({ messageId: i.sourceMessageId, text: i.text })),
       restoresHistory: old.some(i => historicalTargets.has(i.id)) }];
  });
  return { fields, unchanged, diff, requiresRestoreConsent: historicalTargets.size > 0 };
}
