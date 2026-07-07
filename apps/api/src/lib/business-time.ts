import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

// Date representa instantes reales. YYYY-MM-DD representa fecha de negocio.
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

function assertDateKey(value: string) {
  const parsed = parseDateKey(value);
  if (!parsed) throw new Error(`Fecha inválida: ${value}. Formato esperado: YYYY-MM-DD`);
  return parsed;
}

function assertTimeKey(value: string) {
  if (!isValidTimeKey(value)) throw new Error(`Hora inválida: ${value}. Formato esperado: HH:mm`);
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

export function todayBusinessDateKey(now = new Date()): string {
  return businessDateKeyFromDate(now);
}

export function businessDateKeyFromDate(date: Date): string {
  return formatInTimeZone(date, BUSINESS_TIME_ZONE, "yyyy-MM-dd");
}

export function businessTimeKeyFromDate(date: Date): string {
  return formatInTimeZone(date, BUSINESS_TIME_ZONE, "HH:mm");
}

export function combineBusinessDateTimeToUtc(dateKey: string, timeKey: string): Date {
  assertDateKey(dateKey);
  assertTimeKey(timeKey);
  return fromZonedTime(`${dateKey}T${timeKey}:00`, BUSINESS_TIME_ZONE);
}

export function businessDateToUtcNoon(dateKey: string): Date {
  return combineBusinessDateTimeToUtc(dateKey, "12:00");
}

export function startOfBusinessDayUtc(dateKey: string): Date {
  return combineBusinessDateTimeToUtc(dateKey, "00:00");
}

export function nextBusinessDayStartUtc(dateKey: string): Date {
  return startOfBusinessDayUtc(addBusinessDays(dateKey, 1));
}

export function addBusinessDays(dateKey: string, days: number): string {
  const { year, month, day } = assertDateKey(dateKey);
  if (!Number.isInteger(days)) throw new Error("days debe ser entero");

  const next = new Date(Date.UTC(year, month - 1, day + days));
  return dateKeyFromUtcDate(next);
}

export function businessDayOfWeek(dateKey: string): number {
  const { year, month, day } = assertDateKey(dateKey);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function formatBusinessDateTime(date: Date): string {
  return formatInTimeZone(date, BUSINESS_TIME_ZONE, "dd/MM/yyyy HH:mm");
}
