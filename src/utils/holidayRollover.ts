import type { PublicHoliday } from '../types/attendance';

export interface NationalHolidaySeedTemplate {
  originKey: string;
  title: string;
  month: number; // 1..12
  day: number; // 1..31
  description: string;
}

export interface NationalHolidayOverrideRecord {
  id: string;
  originKey: string;
  year: number;
  action: 'edited' | 'deleted';
  title?: string;
  holidayDate?: string;
  center?: string;
  description?: string;
  updatedAt?: string;
}

/**
 * Baseline Indian National Holidays catalog that rolls forward automatically from year to year.
 */
export const DEFAULT_INDIAN_NATIONAL_HOLIDAYS: readonly NationalHolidaySeedTemplate[] = [
  {
    originKey: 'IN_REPUBLIC_DAY',
    title: 'Republic Day',
    month: 1,
    day: 26,
    description: 'Indian National Holiday commemorating the Constitution of India',
  },
  {
    originKey: 'IN_AMBEDKAR_JAYANTI',
    title: 'Dr. B. R. Ambedkar Jayanti',
    month: 4,
    day: 14,
    description: 'National Holiday honoring Dr. B. R. Ambedkar',
  },
  {
    originKey: 'IN_MAY_DAY',
    title: 'International Labour Day',
    month: 5,
    day: 1,
    description: 'National Holiday celebrating workers and labour rights',
  },
  {
    originKey: 'IN_INDEPENDENCE_DAY',
    title: 'Independence Day',
    month: 8,
    day: 15,
    description: 'Indian National Holiday commemorating Independence',
  },
  {
    originKey: 'IN_GANDHI_JAYANTI',
    title: 'Gandhi Jayanti',
    month: 10,
    day: 2,
    description: 'Indian National Holiday honoring Mahatma Gandhi',
  },
  {
    originKey: 'IN_CHRISTMAS_DAY',
    title: 'Christmas Day',
    month: 12,
    day: 25,
    description: 'National Public Holiday',
  },
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function clampDateForYear(year: number, month: number, day: number): string {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const safeDay = Math.min(Math.max(1, day), daysInMonth);
  return `${year}-${pad2(month)}-${pad2(safeDay)}`;
}

/**
 * Rolls Indian National Holidays forward sequentially from `startYear` through `endYear`,
 * deriving each year's calendar from the previous year's active calendar and applying any
 * Admin edit/delete overrides. Once an Admin deletes a National Holiday, it becomes an active
 * working day immediately and does not resurrect on rollover.
 */
export function buildRolledNationalHolidays(params: {
  startYear: number;
  endYear: number;
  overrides?: NationalHolidayOverrideRecord[];
}): PublicHoliday[] {
  const { startYear, endYear, overrides = [] } = params;
  if (endYear < startYear) return [];

  const overrideMap = new Map<string, NationalHolidayOverrideRecord>();
  for (const ov of overrides) {
    overrideMap.set(`${ov.year}:${ov.originKey}`, ov);
  }

  // Carry forward definitions from year Y-1 -> year Y
  let prevYearSpecs: Array<{
    originKey: string;
    title: string;
    month: number;
    day: number;
    center: string;
    description: string;
  }> = DEFAULT_INDIAN_NATIONAL_HOLIDAYS.map((tpl) => ({
    originKey: tpl.originKey,
    title: tpl.title,
    month: tpl.month,
    day: tpl.day,
    center: 'All Centers',
    description: tpl.description,
  }));

  const result: PublicHoliday[] = [];

  for (let year = startYear; year <= endYear; year++) {
    const nextYearSpecs: typeof prevYearSpecs = [];

    for (const spec of prevYearSpecs) {
      const ov = overrideMap.get(`${year}:${spec.originKey}`);
      if (ov?.action === 'deleted') {
        // Deleted by Admin: immediately becomes a normal working day and stops carrying forward
        continue;
      }

      const resolvedDate =
        ov?.action === 'edited' && ov.holidayDate && /^\d{4}-\d{2}-\d{2}$/.test(ov.holidayDate)
          ? ov.holidayDate
          : clampDateForYear(year, spec.month, spec.day);
      const [, mStr, dStr] = resolvedDate.split('-');
      const resolvedTitle = ov?.action === 'edited' && ov.title ? ov.title.trim() : spec.title;
      const resolvedCenter = ov?.action === 'edited' && ov.center ? ov.center.trim() : spec.center;
      const resolvedDesc =
        ov?.action === 'edited' && ov.description !== undefined
          ? ov.description
          : spec.description;

      result.push({
        id: `nat-${year}-${spec.originKey}`,
        title: resolvedTitle,
        holidayDate: resolvedDate,
        center: resolvedCenter || 'All Centers',
        description: resolvedDesc,
        isNational: true,
        originKey: spec.originKey,
        createdBy: 'System Calendar',
        createdAt: `${year}-01-01T00:00:00.000Z`,
      });

      nextYearSpecs.push({
        originKey: spec.originKey,
        title: resolvedTitle,
        month: Number(mStr) || spec.month,
        day: Number(dStr) || spec.day,
        center: resolvedCenter || 'All Centers',
        description: resolvedDesc,
      });
    }

    prevYearSpecs = nextYearSpecs;
  }

  return result;
}

export function isSundayDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const d = new Date(`${dateStr}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.getUTCDay() === 0;
}

export function findNationalHolidayOnDate(
  dateStr: string,
  holidays: readonly PublicHoliday[]
): PublicHoliday | undefined {
  return holidays.find((h) => h.holidayDate === dateStr && Boolean(h.isNational));
}

export function canRaiseTicketOnDate(params: {
  role?: string | null;
  isManager?: boolean;
  dateStr: string;
  holidays: readonly PublicHoliday[];
}): { allowed: boolean; reason?: string; holiday?: PublicHoliday } {
  const { role, isManager, dateStr, holidays } = params;
  const normalizedRole = (role || '').trim();
  const isMgr =
    Boolean(isManager) ||
    normalizedRole === 'Manager' ||
    normalizedRole === 'Department Manager' ||
    normalizedRole === 'Administrator' ||
    normalizedRole === 'Super Admin';

  const nationalHoliday = findNationalHolidayOnDate(dateStr, holidays);
  if (nationalHoliday) {
    return {
      allowed: false,
      holiday: nationalHoliday,
      reason: `Ticket creation is blocked on Indian National Holiday (${nationalHoliday.title} · ${dateStr}).`,
    };
  }

  if (!isMgr && isSundayDate(dateStr)) {
    return {
      allowed: false,
      reason: `Employees can raise tickets Monday through Saturday only. Sundays (${dateStr}) are closed for employee ticket requests.`,
    };
  }

  return { allowed: true };
}
