import { DateTime } from 'luxon';

export function getLastCompletedWeekRange(timezone) {
  const now = DateTime.now().setZone(timezone);
  const startOfCurrentWeek = now.startOf('week');
  const start = startOfCurrentWeek.minus({ weeks: 1 }).startOf('day');
  const end = startOfCurrentWeek.minus({ seconds: 1 }).endOf('second');
  return { start, end };
}

export function formatDate(dt) {
  return dt.toFormat('yyyy-LL-dd');
}

export function toUnix(dt) {
  return Math.floor(dt.toSeconds());
}

export function safeNumber(value, fallback = 0) {
  if (typeof value === 'bigint') return Number(value);
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((safeNumber(value) + Number.EPSILON) * factor) / factor;
}

export function divide(numerator, denominator) {
  const den = safeNumber(denominator);
  if (!den) return 0;
  return safeNumber(numerator) / den;
}

export function percent(numerator, denominator, digits = 2) {
  return round(divide(numerator, denominator) * 100, digits);
}

export function sum(arr) {
  return arr.reduce((acc, cur) => acc + safeNumber(cur), 0);
}

export function clamp(value, min, max) {
  return Math.min(Math.max(safeNumber(value), min), max);
}

export function normalizeTo100(value, cap) {
  if (!cap) return 0;
  return clamp((safeNumber(value) / cap) * 100, 0, 100);
}

export function serializeError(error) {
  return {
    message: error?.message,
    stack: error?.stack,
    name: error?.name
  };
}
