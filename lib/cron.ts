export interface ParsedCron {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  dayOfMonthWildcard: boolean;
  dayOfWeekWildcard: boolean;
}

const MINUTE_MS = 60 * 1000;

function parseField(
  field: string,
  min: number,
  max: number,
  normalize?: (value: number) => number
): Set<number> | null {
  const values = new Set<number>();
  for (const rawPart of field.split(",")) {
    if (!rawPart) return null;
    const [rangePart, stepPart] = rawPart.split("/");
    if (rawPart.split("/").length > 2) return null;
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step <= 0) return null;

    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const [startText, endText] = rangePart.split("-");
      start = Number(startText);
      end = Number(endText);
    } else {
      start = Number(rangePart);
      end = max;
      if (!stepPart) end = start;
    }

    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) return null;
    for (let value = start; value <= end; value += step) {
      const normalized = normalize ? normalize(value) : value;
      if (normalized < min || normalized > max) return null;
      values.add(normalized);
    }
  }
  return values;
}

export function parseCronExpression(expression: string): ParsedCron | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const parsed = {
    minute: parseField(minute, 0, 59),
    hour: parseField(hour, 0, 23),
    dayOfMonth: parseField(dayOfMonth, 1, 31),
    month: parseField(month, 1, 12),
    dayOfWeek: parseField(dayOfWeek, 0, 6, (value) => (value === 7 ? 0 : value)),
  };
  if (
    !parsed.minute ||
    !parsed.hour ||
    !parsed.dayOfMonth ||
    !parsed.month ||
    !parsed.dayOfWeek
  ) {
    return null;
  }
  return {
    minute: parsed.minute,
    hour: parsed.hour,
    dayOfMonth: parsed.dayOfMonth,
    month: parsed.month,
    dayOfWeek: parsed.dayOfWeek,
    dayOfMonthWildcard: dayOfMonth === "*",
    dayOfWeekWildcard: dayOfWeek === "*",
  };
}

export function isCronExpression(expression: string): boolean {
  return Boolean(parseCronExpression(expression));
}

function truncateToMinute(date: Date): Date {
  const value = new Date(date);
  value.setUTCSeconds(0, 0);
  return value;
}

function matchesCron(date: Date, cron: ParsedCron): boolean {
  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const dayOfMonth = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const dayOfWeek = date.getUTCDay();
  if (!cron.minute.has(minute) || !cron.hour.has(hour) || !cron.month.has(month)) {
    return false;
  }

  const domMatches = cron.dayOfMonth.has(dayOfMonth);
  const dowMatches = cron.dayOfWeek.has(dayOfWeek);
  if (cron.dayOfMonthWildcard && cron.dayOfWeekWildcard) return true;
  if (cron.dayOfMonthWildcard) return dowMatches;
  if (cron.dayOfWeekWildcard) return domMatches;
  return domMatches || dowMatches;
}

export function findNextCronOccurrence(
  expression: string,
  after: Date,
  maxSearchMinutes = 60 * 24 * 366 * 5
): Date | null {
  const cron = parseCronExpression(expression);
  if (!cron) return null;
  const cursor = new Date(truncateToMinute(after).getTime() + MINUTE_MS);
  for (let i = 0; i < maxSearchMinutes; i += 1) {
    if (matchesCron(cursor, cron)) return new Date(cursor);
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return null;
}

export function findDueCronOccurrence(
  expression: string,
  baseline: Date,
  now: Date
): Date | null {
  const next = findNextCronOccurrence(expression, baseline);
  if (!next || next.getTime() > now.getTime()) return null;
  return next;
}
