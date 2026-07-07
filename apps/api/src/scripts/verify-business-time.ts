import {
  addBusinessDays,
  businessDateKeyFromDate,
  businessDayOfWeek,
  businessTimeKeyFromDate,
  combineBusinessDateTimeToUtc,
  nextBusinessDayStartUtc,
  startOfBusinessDayUtc,
  todayBusinessDateKey,
} from "../lib/business-time";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const readyAt = combineBusinessDateTimeToUtc("2026-07-06", "03:00");
assert(businessDateKeyFromDate(readyAt) === "2026-07-06", "readyAt debe conservar fecha Mexico");
assert(businessTimeKeyFromDate(readyAt) === "03:00", "readyAt debe conservar hora Mexico");
assert(readyAt.toISOString() !== "2026-07-06T03:00:00.000Z", "readyAt no debe interpretarse como UTC crudo");

const dayStart = startOfBusinessDayUtc("2026-07-06");
const nextDayStart = nextBusinessDayStartUtc("2026-07-06");
assert(businessDateKeyFromDate(dayStart) === "2026-07-06", "inicio de dia debe ser 2026-07-06 Mexico");
assert(businessTimeKeyFromDate(dayStart) === "00:00", "inicio de dia debe ser 00:00 Mexico");
assert(businessDateKeyFromDate(nextDayStart) === "2026-07-07", "siguiente inicio debe ser 2026-07-07 Mexico");
assert(businessTimeKeyFromDate(nextDayStart) === "00:00", "siguiente inicio debe ser 00:00 Mexico");

assert(todayBusinessDateKey(new Date("2026-07-06T05:30:00.000Z")) === "2026-07-05", "todayBusinessDateKey no debe usar fecha UTC");
assert(businessDayOfWeek("2026-07-06") === 1, "2026-07-06 debe ser lunes");
assert(addBusinessDays("2026-07-06", 1) === "2026-07-07", "sumar un dia debe dar 2026-07-07");

const previousDayLate = combineBusinessDateTimeToUtc("2026-07-05", "23:59");
const sameDayStart = combineBusinessDateTimeToUtc("2026-07-06", "00:00");
const sameDayEnd = combineBusinessDateTimeToUtc("2026-07-06", "23:59");
const nextDayEarly = combineBusinessDateTimeToUtc("2026-07-07", "00:00");

assert(previousDayLate < dayStart, "filtro no debe incluir dia anterior Mexico");
assert(sameDayStart >= dayStart && sameDayStart < nextDayStart, "filtro debe incluir inicio del dia Mexico");
assert(sameDayEnd >= dayStart && sameDayEnd < nextDayStart, "filtro debe incluir fin del dia Mexico");
assert(nextDayEarly >= nextDayStart, "filtro no debe incluir dia siguiente Mexico");

console.log("business-time verification passed");
