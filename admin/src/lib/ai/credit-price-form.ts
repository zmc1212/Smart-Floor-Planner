export function clonePriceRows<T>(rows: T[] | null | undefined): T[] {
  return JSON.parse(JSON.stringify(rows || []));
}

function snapshotActionPrices(items: unknown) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const row = item as { actionKey?: unknown; credits?: unknown; enabled?: unknown };
    return {
      actionKey: String(row.actionKey || ''),
      credits: Number(row.credits),
      enabled: Boolean(row.enabled),
    };
  });
}

function snapshotModelPrices(modelPrices: unknown) {
  return (Array.isArray(modelPrices) ? modelPrices : []).map((item) => {
    const row = item as {
      modelProfileKey?: unknown;
      resolutionTier?: unknown;
      credits?: unknown;
      enabled?: unknown;
    };
    return {
      modelProfileKey: String(row.modelProfileKey || ''),
      resolutionTier: String(row.resolutionTier || ''),
      credits: Number(row.credits),
      enabled: Boolean(row.enabled),
    };
  });
}

export function creditPriceFormHasChanges(
  items: unknown,
  savedItems: unknown,
  modelPrices: unknown,
  savedModelPrices: unknown,
) {
  return JSON.stringify(snapshotActionPrices(items)) !== JSON.stringify(snapshotActionPrices(savedItems))
    || JSON.stringify(snapshotModelPrices(modelPrices)) !== JSON.stringify(snapshotModelPrices(savedModelPrices));
}

export function creditPriceSaveDisabled(input: {
  saving?: boolean;
  hasRows: boolean;
  hasChanges: boolean;
}) {
  return Boolean(input.saving) || !input.hasRows || !input.hasChanges;
}
