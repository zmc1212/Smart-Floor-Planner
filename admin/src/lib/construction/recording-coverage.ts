export type RecordingRange = { from: string; to: string; milliseconds: number; segments: number };
export type RecordingGap = { from: string; to: string; milliseconds: number };
export type RecordingCoverage = {
  bindingId: string; day: string; sampledAt: string; from: string; to: string;
  segments: number; coveredMilliseconds: number; gapMilliseconds: number;
  ranges: RecordingRange[]; gaps: RecordingGap[]; truncated: boolean; limit: number;
};

// Only gaps BETWEEN indexed sealed ranges are known. Day edges and the open
// recorder's current segment provide no evidence of an interruption.
export function recordingCoverage(from: Date, to: Date, samples: { startedAt: Date; endedAt: Date }[]) {
  const start = from.getTime(), end = to.getTime();
  const intervals = samples.map(item => ({ from: Math.max(start, item.startedAt.getTime()), to: Math.min(end, item.endedAt.getTime()) }))
    .filter(item => Number.isFinite(item.from) && Number.isFinite(item.to) && item.to > item.from)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: { from: number; to: number; segments: number }[] = [];
  for (const item of intervals) {
    const last = merged.at(-1);
    if (last && item.from <= last.to) { last.to = Math.max(last.to, item.to); last.segments++; }
    else merged.push({ ...item, segments: 1 });
  }
  const ranges = merged.map(item => ({ from: new Date(item.from).toISOString(), to: new Date(item.to).toISOString(), milliseconds: item.to - item.from, segments: item.segments }));
  const gaps = merged.slice(1).map((item, i) => ({ from: new Date(merged[i].to).toISOString(), to: new Date(item.from).toISOString(), milliseconds: item.from - merged[i].to }));
  return { segments: intervals.length, ranges, gaps, coveredMilliseconds: ranges.reduce((sum, item) => sum + item.milliseconds, 0), gapMilliseconds: gaps.reduce((sum, item) => sum + item.milliseconds, 0) };
}

export function coverageDuration(milliseconds: number) {
  if (milliseconds < 1000) return milliseconds + ' 毫秒';
  const seconds = Math.floor(milliseconds / 1000), hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60);
  const remainingSeconds = Number(((milliseconds % 60000) / 1000).toFixed(3));
  return [hours ? hours + ' 小时' : '', minutes ? minutes + ' 分' : '', remainingSeconds ? remainingSeconds + ' 秒' : ''].filter(Boolean).join(' ') || '0 秒';
}
