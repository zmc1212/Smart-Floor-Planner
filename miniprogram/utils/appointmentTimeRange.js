function toIsoTimestamp(value) {
  const text = String(value || '').trim().replace(/"/g, '');
  const match = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}(?::?\d{2})?)?$/i);
  if (!match) return text;
  const date = match[1];
  const time = match[2];
  let zone = match[3] || 'Z';
  if (zone.toUpperCase() === 'Z') zone = 'Z';
  else if (/^[+-]\d{2}$/.test(zone)) zone = `${zone}:00`;
  else if (/^[+-]\d{4}$/.test(zone)) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
  return `${date}T${time}${zone}`;
}

function parseAppointmentBounds(timeRange) {
  const match = String(timeRange || '').match(/[[(]([^,]+),([^\])]+)[\])]/);
  if (!match) return null;
  const startAt = new Date(toIsoTimestamp(match[1]));
  const endAt = new Date(toIsoTimestamp(match[2]));
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return null;
  return { startAt, endAt };
}

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const SHANGHAI_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function shanghaiParts(date) {
  // Asia/Shanghai is UTC+8 with no DST. WeChat JS engines (especially Android)
  // often omit `Intl`, so do not call Intl.DateTimeFormat here.
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return {
    year: String(shifted.getUTCFullYear()),
    month: String(shifted.getUTCMonth() + 1),
    day: String(shifted.getUTCDate()),
    weekday: SHANGHAI_WEEKDAYS[shifted.getUTCDay()],
    hour: String(shifted.getUTCHours()),
    minute: String(shifted.getUTCMinutes()),
  };
}

function padTwo(value) {
  return String(value).padStart(2, '0');
}

function formatAppointmentDisplay(timeRange) {
  const bounds = parseAppointmentBounds(timeRange);
  if (!bounds) {
    return {
      dateKey: '',
      dateLabel: '',
      dateText: '时间待确认',
      timeText: '—',
      time: '时间待确认',
      startHour: 0,
      startMs: 0,
    };
  }
  const start = shanghaiParts(bounds.startAt);
  const end = shanghaiParts(bounds.endAt);
  const weekdayIndex = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[start.weekday] ?? bounds.startAt.getDay();
  const month = String(Number(start.month));
  const day = String(Number(start.day));
  const startHm = `${padTwo(start.hour)}:${padTwo(start.minute)}`;
  const endHm = `${padTwo(end.hour)}:${padTwo(end.minute)}`;
  return {
    dateKey: `${start.year}-${padTwo(start.month)}-${padTwo(start.day)}`,
    dateLabel: `${month}/${day}`,
    dateText: `${start.year}年${month}月${day}日 周${'日一二三四五六'[weekdayIndex]}`,
    timeText: `${startHm} - ${endHm}`,
    time: `${startHm} - ${endHm}`,
    startHour: Number(start.hour),
    startMs: bounds.startAt.getTime(),
  };
}

module.exports = {
  toIsoTimestamp,
  parseAppointmentBounds,
  formatAppointmentDisplay,
};
