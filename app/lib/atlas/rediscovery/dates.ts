const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function parseCalendarDate(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const match = CALENDAR_DATE_PATTERN.exec(input);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];
  return day <= daysInMonth ? input : null;
}

function calendarDateFromParts(year: number, month: number, day: number) {
  const date = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (!parseCalendarDate(date)) throw new RangeError('Invalid calendar date.');
  return date;
}

export function getLocalCalendarDate(now = new Date()): string {
  return calendarDateFromParts(
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate(),
  );
}

export function getUtcCalendarDate(now = new Date()): string {
  return calendarDateFromParts(
    now.getUTCFullYear(),
    now.getUTCMonth() + 1,
    now.getUTCDate(),
  );
}

function utcDate(date: string) {
  if (!parseCalendarDate(date)) throw new RangeError('Invalid calendar date.');
  const [year, month, day] = date.split('-').map(Number);
  // Date.UTC treats years 0–99 as 1900–1999; set the actual calendar year.
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(0, 0, 0, 0);
  return value;
}

export function shiftCalendarDate(date: string, delta: number): string | null {
  if (!parseCalendarDate(date) || !Number.isSafeInteger(delta)) return null;
  const value = utcDate(date);
  value.setUTCDate(value.getUTCDate() + delta);
  if (!Number.isFinite(value.getTime())) return null;
  const year = value.getUTCFullYear();
  if (year < 1 || year > 9999) return null;
  return getUtcCalendarDate(value);
}

export function formatCalendarDate(
  date: string,
  options: Intl.DateTimeFormatOptions = {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  },
): string {
  return new Intl.DateTimeFormat('en-US', {
    ...options,
    timeZone: 'UTC',
  }).format(utcDate(date));
}

export function onThisDayHref(date: string, page = 1): string {
  if (!parseCalendarDate(date)) throw new RangeError('Invalid calendar date.');
  const query = new URLSearchParams({ date });
  const safePage = Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1;
  if (safePage > 1) query.set('page', String(safePage));
  return `/dashboard/on-this-day?${query.toString()}`;
}
