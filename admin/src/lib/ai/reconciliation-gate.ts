type ReconciliationEntry = {
  inFlight?: Promise<number>;
  lastCompletedAt?: number;
  lastResult?: number;
};

export function createReconciliationGate(options: {
  cooldownMs?: number;
  now?: () => number;
} = {}) {
  const cooldownMs = options.cooldownMs ?? 1_000;
  const now = options.now ?? Date.now;
  const entries = new Map<string, ReconciliationEntry>();

  return {
    async run(scope: string, work: () => Promise<number>) {
      const entry = entries.get(scope) ?? {};
      entries.set(scope, entry);
      if (entry.inFlight) return entry.inFlight;
      if (
        entry.lastCompletedAt !== undefined
        && entry.lastResult !== undefined
        && now() - entry.lastCompletedAt < cooldownMs
      ) return entry.lastResult;

      const inFlight = Promise.resolve().then(work);
      entry.inFlight = inFlight;
      try {
        const result = await inFlight;
        entry.lastCompletedAt = now();
        entry.lastResult = result;
        return result;
      } catch (error) {
        entry.lastCompletedAt = undefined;
        entry.lastResult = undefined;
        throw error;
      } finally {
        if (entry.inFlight === inFlight) entry.inFlight = undefined;
      }
    },
  };
}

export const postgresCreationReconciliationGate = createReconciliationGate();
