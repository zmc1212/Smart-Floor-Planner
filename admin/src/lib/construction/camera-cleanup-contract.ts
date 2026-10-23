export type RecordingCleanupItem = {
  id: string;
  startedAt: string;
  endedAt: string;
  bytes: string;
  state: 'deleting' | 'deleted' | 'missing';
  deletedAt: string | null;
  failure: 'identity_conflict' | 'delete_unconfirmed' | 'retry_pending' | null;
};
export type RecordingCleanupPage = { items: RecordingCleanupItem[]; nextCursor: string | null };

const timestamp = (value: unknown): string | null => {
  if (!(value instanceof Date) && typeof value !== 'string') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

// Never return upstream IDs, paths, credentials or arbitrary stored error text.
export function recordingCleanup(row: Record<string, unknown>): RecordingCleanupItem {
  const state = row.state as RecordingCleanupItem['state'];
  const error = state === 'deleting' && row.last_error !== null && row.last_error !== undefined;
  return {
    id: String(row.id), startedAt: timestamp(row.started_at)!, endedAt: timestamp(row.ended_at)!, bytes: String(row.bytes), state,
    deletedAt: state === 'deleted' ? timestamp(row.deleted_at) : null,
    failure: !error ? null : row.last_error === 'camera_recording_conflict' ? 'identity_conflict'
      : row.last_error === 'camera_recording_delete_unconfirmed' ? 'delete_unconfirmed' : 'retry_pending',
  };
}

export const recordingCleanupLabels = { deleting: '待清理', deleted: '已清理', missing: '登记缺失' } as const;
export const recordingCleanupFailures = {
  identity_conflict: '录像身份不一致，清理已保留待重试',
  delete_unconfirmed: '尚未确认文件及上游索引均已删除，等待重试',
  retry_pending: '上次清理未完成，等待系统重试',
} as const;

export function cleanupTime(value: string | null): string {
  return value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '未记录';
}

export function cleanupSize(value: string): string {
  const bytes = BigInt(value);
  for (const [divisor, unit] of [[1_000_000_000n, 'GB'], [1_000_000n, 'MB'], [1_000n, 'KB']] as const) {
    if (bytes >= divisor) {
      const tenths = (bytes * 10n + divisor / 2n) / divisor;
      return `${tenths / 10n}.${tenths % 10n} ${unit}`;
    }
  }
  return `${bytes} B`;
}
