const statusLabels: Record<string, string> = {
  pending: '待确认', confirmed: '已确认', completed: '已完成', cancelled: '已取消', expired: '已过期',
};

const beijingTime = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function beijingParts(value: Date) {
  const parts = beijingTime.formatToParts(value);
  const read = (type: string) => parts.find(part => part.type === type)?.value || '';
  return { year: Number(read('year')), month: Number(read('month')), day: Number(read('day')), clock: `${read('hour')}:${read('minute')}` };
}

/** Render the stored Postgres range as customer-readable Beijing time.
 * The raw range text, record id and version stay in the authoritative snapshot. */
export function appointmentTimeText(timeRange: string) {
  const bounds = /^[[(]\s*([^,\s]+)\s*,\s*([^)\]]+?)\s*[)\]]$/.exec(String(timeRange || '').trim());
  if (!bounds) return '';
  const start = new Date(bounds[1]), end = new Date(bounds[2]);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) return '';
  const from = beijingParts(start), to = beijingParts(end);
  const sameDay = from.year === to.year && from.month === to.month && from.day === to.day;
  return `${from.year}年${from.month}月${from.day}日 ${from.clock}–${sameDay ? to.clock : `${to.month}月${to.day}日 ${to.clock}`}`;
}

/** One customer-facing appointment line: project, state and local time only.
 * Internal record ids, snapshot versions and ISO range text are never shown. */
export function appointmentDisplayText(project: string, status: string, timeRange: string) {
  const name = String(project || '').trim() || '本企业服务档案';
  const state = statusLabels[status] || '状态待核实';
  const when = appointmentTimeText(timeRange);
  return when
    ? `${name}：量房预约${state}，时间${when}（北京时间）。`
    : `${name}：量房预约${state}，具体时间待核实。`;
}
