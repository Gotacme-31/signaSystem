import { Prisma } from "@prisma/client";

export type NormalWindowWorkdayCandidate = {
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
  readyAt: string;
  capacityQty: unknown;
  isActive: boolean;
};

export function isValidProductionTimeKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

export function isValidActiveNormalWindow(window: NormalWindowWorkdayCandidate) {
  if (!window.isActive) return false;
  if (
    !isValidProductionTimeKey(window.startsAt)
    || !isValidProductionTimeKey(window.endsAt)
    || !isValidProductionTimeKey(window.readyAt)
    || window.startsAt >= window.endsAt
  ) {
    return false;
  }

  try {
    const capacityQty = new Prisma.Decimal(String(window.capacityQty));
    return capacityQty.isFinite() && capacityQty.gt(0);
  } catch {
    return false;
  }
}

export function workingWeekdaysFromNormalWindows(
  windows: readonly NormalWindowWorkdayCandidate[]
) {
  return new Set(
    windows.filter(isValidActiveNormalWindow).map((window) => window.dayOfWeek)
  );
}
