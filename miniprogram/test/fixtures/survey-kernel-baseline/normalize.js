const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const GENERATED_ENTITY_ID = /\b(floor|node|wall|opening|space)-[0-9a-z]{6,}-\d+\b/g;

function createIdMap(draft) {
  const idMap = new Map();
  const floors = draft && Array.isArray(draft.floors) ? draft.floors : [];
  floors.forEach((floor, floorIndex) => {
    if (floor && floor.id) idMap.set(floor.id, `floor-${floorIndex + 1}`);
    [
      ['nodes', 'node'],
      ['walls', 'wall'],
      ['openings', 'opening'],
      ['spaces', 'space']
    ].forEach(([collection, prefix]) => {
      const values = floor && Array.isArray(floor[collection]) ? floor[collection] : [];
      values.forEach((value, valueIndex) => {
        if (value && value.id) {
          idMap.set(value.id, `${prefix}-${floorIndex + 1}-${valueIndex + 1}`);
        }
      });
    });
  });
  return idMap;
}

function normalizeNumber(value) {
  if (Object.is(value, -0)) return 0;
  if (!Number.isFinite(value) || Number.isInteger(value)) return value;
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function normalizeString(value, idMap) {
  if (idMap.has(value)) return idMap.get(value);

  let normalized = value;
  [...idMap.entries()]
    .sort(([left], [right]) => right.length - left.length)
    .forEach(([sourceId, normalizedId]) => {
      if (normalized.includes(sourceId)) {
        normalized = normalized.split(sourceId).join(normalizedId);
      }
    });

  return normalized.replace(GENERATED_ENTITY_ID, (generatedId, prefix) => {
    if (!idMap.has(generatedId)) {
      const next = [...idMap.values()].filter((mappedId) => (
        mappedId.startsWith(`${prefix}-runtime-`)
      )).length + 1;
      idMap.set(generatedId, `${prefix}-runtime-${next}`);
    }
    return idMap.get(generatedId);
  });
}

function normalizeValue(value, idMap, key = '') {
  if (typeof value === 'number') return normalizeNumber(value);
  if (typeof value === 'string') {
    if ((key.endsWith('At') || key === 'timestamp') && ISO_TIMESTAMP.test(value)) {
      return '<timestamp>';
    }
    return normalizeString(value, idMap);
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item, idMap));
  }
  if (!value || typeof value !== 'object') return value;

  const output = {};
  Object.keys(value)
    .sort()
    .forEach((rawKey) => {
      if (typeof value[rawKey] === 'undefined') return;
      const normalizedKey = idMap.get(rawKey) || rawKey;
      output[normalizedKey] = normalizeValue(value[rawKey], idMap, rawKey);
    });
  return output;
}

function normalizeDraft(draft) {
  return normalizeValue(draft, createIdMap(draft));
}

function normalizeForDraft(value, draft) {
  return normalizeValue(value, createIdMap(draft));
}

module.exports = {
  createIdMap,
  normalizeDraft,
  normalizeForDraft,
  normalizeString,
  normalizeValue
};
