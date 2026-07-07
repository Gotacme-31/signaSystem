// Date/ISO representa instantes reales. YYYY-MM-DD representa fecha de negocio.
// HH:mm representa hora de negocio. La zona fija del negocio es Mexico City.
export const BUSINESS_TIME_ZONE = "America/Mexico_City";

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_KEY_RE = /^(\d{2}):(\d{2})$/;

function parseDateKey(value: string) {
  const match = DATE_KEY_RE.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));

  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function dateFromInput(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? null : date;
}

function businessParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: byType.year,
    month: byType.month,
    day: byType.day,
    hour: byType.hour,
    minute: byType.minute,
  };
}

function dateKeyFromUtcDate(value: Date) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isValidDateKey(value: string): boolean {
  return !!parseDateKey(value);
}

export function isValidTimeKey(value: string): boolean {
  const match = TIME_KEY_RE.exec(value);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

export function todayBusinessDateKey() {
  return dateKeyFromBusinessInstant(new Date());
}

export function dateKeyFromBusinessInstant(dateOrIso: string | Date) {
  const date = dateFromInput(dateOrIso);
  if (!date) return "";
  const parts = businessParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function timeKeyFromBusinessInstant(dateOrIso: string | Date) {
  const date = dateFromInput(dateOrIso);
  if (!date) return "";
  const parts = businessParts(date);
  return `${parts.hour}:${parts.minute}`;
}

export function formatDateInBusinessTimeZone(dateOrIso: string | Date) {
  const key = safeDateKey(dateOrIso);
  const match = DATE_KEY_RE.exec(key);
  if (!match) return "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatTimeInBusinessTimeZone(dateOrIso: string | Date) {
  return safeTimeKey(dateOrIso);
}

export function formatDateTimeInBusinessTimeZone(dateOrIso: string | Date) {
  const date = formatDateInBusinessTimeZone(dateOrIso);
  const time = formatTimeInBusinessTimeZone(dateOrIso);
  return date && time ? `${date} ${time}` : date || time;
}

export function safeDateKey(value?: string | Date | null) {
  if (!value) return "";
  if (typeof value === "string" && isValidDateKey(value)) return value;
  return dateKeyFromBusinessInstant(value);
}

export function safeTimeKey(value?: string | Date | null) {
  if (!value) return "";
  if (typeof value === "string" && isValidTimeKey(value)) return value;
  return timeKeyFromBusinessInstant(value);
}

export function addBusinessDays(dateKey: string, days: number) {
  const parsed = parseDateKey(dateKey);
  if (!parsed || !Number.isInteger(days)) return "";
  const next = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  return dateKeyFromUtcDate(next);
}

export function businessDayOfWeek(dateKey: string) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return null;
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
}

export function businessDateDiffInDays(fromDateKey: string, toDateKey: string) {
  const from = parseDateKey(fromDateKey);
  const to = parseDateKey(toDateKey);
  if (!from || !to) return null;

  const fromTime = Date.UTC(from.year, from.month - 1, from.day);
  const toTime = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((toTime - fromTime) / (24 * 60 * 60 * 1000));
}

export function todayBusinessTimeKey() {
  return timeKeyFromBusinessInstant(new Date());
}
