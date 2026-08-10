export type FloorPlanDisplayLead = {
  name?: string | null;
  communityName?: string | null;
};

export type FloorPlanDisplay = {
  projectTitle: string;
  projectSubtitle: string;
  measurementLabel: string;
  recordTitle: string;
  legacyName: string;
};

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Keeps the persisted floor-plan name as a compatibility fallback while
 * exposing a stable, customer-oriented identity for every live surface.
 */
export function getFloorPlanDisplay(
  plan: { name?: string | null },
  options: {
    lead?: FloorPlanDisplayLead | null;
    measurementSequence?: number | null;
  } = {}
): FloorPlanDisplay {
  const legacyName = text(plan.name) || '未命名户型';
  const communityName = text(options.lead?.communityName);
  const customerName = text(options.lead?.name);
  const sequence = Number(options.measurementSequence);
  const measurementLabel = Number.isInteger(sequence) && sequence > 0
    ? `第 ${sequence} 次量房`
    : '量房记录';
  const projectTitle = communityName || customerName || legacyName;
  const projectSubtitle = [
    customerName && customerName !== projectTitle ? customerName : '',
    measurementLabel,
  ].filter(Boolean).join(' · ');

  return {
    projectTitle,
    projectSubtitle,
    measurementLabel,
    recordTitle: `${projectTitle} · ${measurementLabel}`,
    legacyName,
  };
}
