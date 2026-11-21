import type { BriefingDefinition } from './contracts.js';
import { assertBriefingDefinition } from './guards.js';

interface LocalParts {
  readonly weekday: number;
  readonly hour: number;
  readonly minute: number;
}

const weekdayMap: Readonly<Record<string, number>> = Object.freeze({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 });
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  const existing = formatters.get(timezone);
  if (existing) return existing;
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  formatters.set(timezone, created);
  return created;
}

function localParts(timestamp: number, timezone: string): LocalParts {
  const values = Object.fromEntries(formatter(timezone).formatToParts(timestamp).map((part) => [part.type, part.value]));
  const weekday = weekdayMap[values.weekday ?? ''];
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  if (!weekday || !Number.isInteger(hour) || !Number.isInteger(minute)) throw new Error('TIMEZONE_FORMAT_INVALID');
  return { weekday, hour, minute };
}

export function nextDeliveryAt(definition: BriefingDefinition, after: number): string {
  assertBriefingDefinition(definition);
  if (!Number.isFinite(after)) throw new Error('DELIVERY_CLOCK_INVALID');
  const [targetHourRaw, targetMinuteRaw] = definition.deliveryLocalTime.split(':');
  const targetHour = Number(targetHourRaw);
  const targetMinute = Number(targetMinuteRaw);
  const start = Math.floor(after / 60_000) * 60_000 + 60_000;
  const limit = start + 15 * 86_400_000;
  for (let candidate = start; candidate <= limit; candidate += 60_000) {
    const local = localParts(candidate, definition.timezone);
    if (definition.weekdays.includes(local.weekday) && local.hour === targetHour && local.minute === targetMinute) {
      return new Date(candidate).toISOString();
    }
  }
  throw new Error('DELIVERY_TIME_UNRESOLVABLE');
}
