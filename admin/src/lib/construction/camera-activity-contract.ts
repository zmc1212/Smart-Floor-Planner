export type RecordingActivity = {
  id: string;
  createdAt: string;
  actor: 'admin' | 'system' | 'unknown';
  event: 'recording.configure' | 'storage.ok' | 'storage.warning' | 'storage.critical' | 'storage.blocked' | 'storage.unavailable';
  enabled: boolean | null;
  retentionDays: number | null;
  usedPercent: number | null;
  reason: 'camera_storage_low' | 'camera_storage_unavailable' | 'camera_storage_warning' | null;
};
export type RecordingActivityPage = { items: RecordingActivity[]; nextCursor: string | null };

const events = new Set<RecordingActivity['event']>(['recording.configure', 'storage.ok', 'storage.warning', 'storage.critical', 'storage.blocked', 'storage.unavailable']);
const reasons = new Set(['camera_storage_low', 'camera_storage_unavailable', 'camera_storage_warning']);
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function recordingActivity(row: Record<string, unknown>): RecordingActivity | null {
  const event = String(row.action).replace(/^camera\./, '') as RecordingActivity['event'];
  if (!events.has(event)) return null;
  const snapshot = object(row.snapshot), actor = object(row.actor_ref);
  const configured = event === 'recording.configure';
  const retention = snapshot.retentionDays, used = snapshot.usedPercent;
  return {
    id: String(row.id), createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(String(row.created_at)).toISOString(),
    actor: actor.kind === 'admin' || actor.kind === 'system' ? actor.kind : 'unknown', event,
    enabled: configured && typeof snapshot.enabled === 'boolean' ? snapshot.enabled : null,
    retentionDays: configured && typeof retention === 'number' && Number.isInteger(retention) && retention >= 1 && retention <= 30 ? retention : null,
    usedPercent: !configured && typeof used === 'number' && Number.isFinite(used) && used >= 0 && used <= 100 ? used : null,
    reason: !configured && typeof snapshot.reason === 'string' && reasons.has(snapshot.reason) ? snapshot.reason as RecordingActivity['reason'] : null,
  };
}

export const recordingActivityLabels: Record<RecordingActivity['event'], string> = {
  'recording.configure': '录像策略调整', 'storage.ok': '存储正常', 'storage.warning': '容量提醒',
  'storage.critical': '容量严重告警', 'storage.blocked': '存储保护', 'storage.unavailable': '容量数据不可用',
};

export function recordingActivityDetail(item: RecordingActivity): string {
  if (item.event === 'recording.configure') {
    return (item.enabled === null ? '开启状态未记录' : item.enabled ? '连续录像开启' : '连续录像关闭') +
      (item.retentionDays === null ? '；保留天数未记录' : '；保留 ' + item.retentionDays + ' 天');
  }
  const reason = item.reason === 'camera_storage_low' ? '空间低于保护阈值' : item.reason === 'camera_storage_unavailable' ? '暂时无法确认存储容量' : item.reason === 'camera_storage_warning' ? '空间接近保护阈值' : item.event === 'storage.ok' ? '存储容量正常' : '原因未记录';
  const percentageLabel = item.event === 'storage.unavailable' ? '；最近已知已用 ' : '；当时已用 ';
  return reason + (item.usedPercent === null ? '' : percentageLabel + item.usedPercent.toFixed(1) + '%');
}
