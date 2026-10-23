// Read-only estimates from sealed media; this module never controls a recorder.
export type CapacitySample = { bytes: string; durationMs: string; startedAt: string; endedAt: string };
export type RecordingCapacity = {
  bindingId: string;
  sampledAt: string;
  sample: { segments: number; seconds: number; bytes: string; from: string | null; until: string | null };
  averageMbps: number | null;
  bytesPerDay: string | null;
  indexed: { segments: number; bytes: string; pendingDeletion: number; failedDeletion: number };
};
const positive = (value: string) => /^\d{1,40}$/.test(value) && BigInt(value) > 0n;
const ceil = (value: bigint, divisor: bigint) => (value + divisor - 1n) / divisor;

export function capacityFromSamples(samples: CapacitySample[]) {
  let bytes = 0n, duration = 0n, from: string | null = null, until: string | null = null, segments = 0;
  for (const sample of samples) {
    if (!positive(sample.bytes) || !positive(sample.durationMs) || !Number.isFinite(Date.parse(sample.startedAt)) ||
      !Number.isFinite(Date.parse(sample.endedAt)) || Date.parse(sample.endedAt) <= Date.parse(sample.startedAt)) continue;
    bytes += BigInt(sample.bytes); duration += BigInt(sample.durationMs); segments++;
    if (!from || sample.startedAt < from) from = sample.startedAt;
    if (!until || sample.endedAt > until) until = sample.endedAt;
  }
  const enough = duration >= 60000n;
  return {
    sample: { segments, seconds: Number(duration) / 1000, bytes: String(bytes), from, until },
    averageMbps: enough ? Number(bytes * 8n / duration) / 1000 : null,
    bytesPerDay: enough ? String(ceil(bytes * 86400000n, duration)) : null,
  };
}

export function retentionCapacity(bytesPerDay: string | null, days: number) {
  if (!bytesPerDay || !positive(bytesPerDay) || !Number.isSafeInteger(days) || days < 1 || days > 30) return null;
  const bytes = BigInt(bytesPerDay) * BigInt(days);
  return { bytes: String(bytes), withReserve: String(ceil(bytes * 125n, 100n)) };
}

export function capacityGB(bytes: string) {
  if (!/^\d+$/.test(bytes)) return '未知';
  const tenths = (BigInt(bytes) * 10n + 500000000n) / 1000000000n;
  return String(tenths / 10n) + '.' + String(tenths % 10n) + ' GB';
}
