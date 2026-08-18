export type WeeklyAppointmentSchedule = Record<
  string,
  Array<{ start: string; end: string }>
>;

export const DEFAULT_APPOINTMENT_TIMEZONE = 'Asia/Shanghai';

export const DEFAULT_WEEKLY_APPOINTMENT_SCHEDULE: WeeklyAppointmentSchedule =
  Object.fromEntries(
    Array.from({ length: 7 }, (_, day) => [String(day), [{ start: '09:00', end: '18:00' }]])
  );

function isTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(':').map(Number);
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60;
}

function minutes(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

export function normalizeWeeklyAppointmentSchedule(
  value: unknown
): WeeklyAppointmentSchedule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_WEEKLY_APPOINTMENT_SCHEDULE;
  }
  const source = value as Record<string, unknown>;
  const normalized: WeeklyAppointmentSchedule = {};
  for (let day = 0; day < 7; day += 1) {
    const windows: unknown[] = Array.isArray(source[String(day)])
      ? source[String(day)] as unknown[]
      : [];
    normalized[String(day)] = windows
      .flatMap((window) => {
        if (!window || typeof window !== 'object' || Array.isArray(window)) return [];
        const candidate = window as { start?: unknown; end?: unknown };
        return isTime(candidate.start) && isTime(candidate.end) && minutes(candidate.start) < minutes(candidate.end)
          ? [{ start: candidate.start, end: candidate.end }]
          : [];
      })
      .sort((a, b) => minutes(a.start) - minutes(b.start));
  }
  return Object.values(normalized).some((windows) => windows.length)
    ? normalized
    : DEFAULT_WEEKLY_APPOINTMENT_SCHEDULE;
}

export function localDateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function zonedOffsetMilliseconds(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  ) - date.getTime();
}

export function zonedDateTimeToUtc(date: string, time: string, timeZone: string) {
  if (!isCalendarDate(date) || !isTime(time)) throw new Error('Invalid local appointment time');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const guessed = new Date(Date.UTC(year, month - 1, day, hour, minute));
  let timestamp = guessed.getTime() - zonedOffsetMilliseconds(guessed, timeZone);
  const adjusted = new Date(timestamp);
  timestamp = guessed.getTime() - zonedOffsetMilliseconds(adjusted, timeZone);
  return new Date(timestamp);
}

export function appointmentRange(start: Date, durationMinutes: number) {
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return `[${start.toISOString()},${end.toISOString()})`;
}

export function buildScheduleSlots(input: {
  date: string;
  schedule: WeeklyAppointmentSchedule;
  timeZone: string;
  durationMinutes: number;
  stepMinutes: number;
}) {
  if (!isCalendarDate(input.date)) return [];
  const day = String(new Date(`${input.date}T00:00:00.000Z`).getUTCDay());
  return (input.schedule[day] || []).flatMap((window) => {
    const result: Array<{ startAt: Date; endAt: Date }> = [];
    for (
      let start = minutes(window.start);
      start + input.durationMinutes <= minutes(window.end);
      start += input.stepMinutes
    ) {
      const time = `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
      const startAt = zonedDateTimeToUtc(input.date, time, input.timeZone);
      result.push({
        startAt,
        endAt: new Date(startAt.getTime() + input.durationMinutes * 60_000),
      });
    }
    return result;
  });
}
