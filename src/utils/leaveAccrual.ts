import type { Employee } from '../types/asset';
import type {
  LeaveAccrualMonthRow,
  LeaveBalanceSummary,
  LeaveRecord,
  PublicHoliday,
} from '../types/attendance';

export const MONTHLY_LEAVE_ACCRUAL = 2;
export const ANNUAL_LEAVE_CAP = 22; // Jan-Nov (11 * 2), Dec = 0
export const MAX_LEAVE_BUCKET_CAP = 44; // 2 full years * 22
export const JOINING_CUTOFF_DAY = 15;

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function parseIsoDateParts(dateStr?: string | null): { year: number; month: number; day: number } | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) return null;
  const [y, m, d] = dateStr.trim().split('-').map(Number);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { year: y, month: m, day: d };
}

/**
 * Counts chargeable leave days between startDate and endDate inclusive,
 * excluding National Holidays and Center-wise Holidays matching the employee's center.
 */
export function countChargeableLeaveDays(params: {
  startDate: string;
  endDate: string;
  holidays: readonly PublicHoliday[];
  employeeCenter?: string | null;
}): number {
  const { startDate, endDate, holidays, employeeCenter } = params;
  if (!startDate || !endDate) return 0;
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;

  const empCenterNorm = (employeeCenter || '').trim().toLowerCase();
  const excludedDates = new Set<string>();

  for (const h of holidays) {
    const hCenterNorm = (h.center || 'All Centers').trim().toLowerCase();
    const appliesToEmployee =
      Boolean(h.isNational) ||
      hCenterNorm === 'all centers' ||
      (empCenterNorm !== '' && hCenterNorm === empCenterNorm);
    if (appliesToEmployee) {
      excludedDates.add(h.holidayDate);
    }
  }

  let count = 0;
  const totalSpan = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const safeSpan = Math.min(totalSpan, 366);
  for (let i = 0; i < safeSpan; i++) {
    const dt = new Date(start.getTime() + i * 86400000);
    const iso = dt.toISOString().split('T')[0];
    if (!excludedDates.has(iso)) {
      count++;
    }
  }
  return count;
}

/**
 * Computes monthly accrual (Jan-Nov = 2/mo when eligible, Dec = 0) for a single month (1..12).
 * Applies 15th-of-month joining cutoff and Active status requirement.
 */
export function getMonthlyLeaveAccrualForMonth(params: {
  year: number;
  month: number; // 1..12
  joiningDate?: string | null;
  status: 'Active' | 'Inactive';
}): number {
  const { year, month, joiningDate, status } = params;
  if (status !== 'Active') return 0;
  if (month < 1 || month > 12) return 0;
  if (month === 12) return 0; // December always accrues 0 leaves

  const join = parseIsoDateParts(joiningDate);
  if (!join) {
    // Existing/legacy employee without explicit joiningDate: eligible for full Jan-Nov
    return MONTHLY_LEAVE_ACCRUAL;
  }

  if (join.year > year) return 0;
  if (join.year < year) return MONTHLY_LEAVE_ACCRUAL;

  // Joined in target year
  if (month < join.month) return 0;
  if (month > join.month) return MONTHLY_LEAVE_ACCRUAL;

  // Joining month: <= 15th receives 2 leaves; > 15th receives 0 leaves
  return join.day <= JOINING_CUTOFF_DAY ? MONTHLY_LEAVE_ACCRUAL : 0;
}

/**
 * Calculates full-year leave bucket simulation enforcing:
 * - Jan-Nov +2 leaves/mo, Dec = 0 (22/yr max)
 * - 15th-of-month joining cutoff
 * - Active status requirement through December
 * - Carry-forward & 44-leave maximum cap
 * - Deduction on Approved leaves + ongoing +2/mo additions up to 44-leave cap
 */
export function computeEmployeeLeaveBucket(params: {
  employee: Pick<Employee, 'id' | 'employeeId' | 'name' | 'joiningDate' | 'status' | 'center' | 'branch' | 'leaveCarryForward'>;
  year: number;
  leaves: readonly LeaveRecord[];
  holidays?: readonly PublicHoliday[];
  asOfMonth?: number; // 1..12 for live current balance snapshot (default 12 = full year)
}): LeaveBalanceSummary {
  const { employee, year, leaves, holidays = [], asOfMonth = 12 } = params;
  const carryForwardStart = Math.min(
    MAX_LEAVE_BUCKET_CAP,
    Math.max(0, Number(employee.leaveCarryForward) || 0)
  );
  const empCenter = employee.center || employee.branch || '';

  const yearApprovedByMonth = new Map<number, number>();
  let totalApprovedUsedDays = 0;
  let totalPendingDays = 0;

  for (const lv of leaves) {
    if (lv.employeeId !== employee.id && lv.employeeId !== employee.employeeId) continue;
    const startParts = parseIsoDateParts(lv.startDate);
    if (!startParts || startParts.year !== year) continue;

    // Exclude National & Center holidays when determining effective leave days if holidays supplied
    const effectiveDays =
      holidays.length > 0
        ? countChargeableLeaveDays({
            startDate: lv.startDate,
            endDate: lv.endDate,
            holidays,
            employeeCenter: empCenter,
          })
        : Number(lv.days) || 0;

    if (lv.status === 'Approved') {
      totalApprovedUsedDays += effectiveDays;
      yearApprovedByMonth.set(
        startParts.month,
        (yearApprovedByMonth.get(startParts.month) || 0) + effectiveDays
      );
    } else if (lv.status === 'Pending') {
      totalPendingDays += effectiveDays;
    }
  }

  let runningBalance = carryForwardStart;
  let annualAccrued = 0;
  let availableAtAsOfMonth = carryForwardStart;
  const safeAsOf = Math.min(12, Math.max(1, asOfMonth));

  const monthlyBreakdown: LeaveAccrualMonthRow[] = [];

  for (let m = 1; m <= 12; m++) {
    const rawAccrual = getMonthlyLeaveAccrualForMonth({
      year,
      month: m,
      joiningDate: employee.joiningDate,
      status: employee.status,
    });

    // Apply monthly accrual capped at 44 total bucket
    const beforeAccrual = runningBalance;
    const afterAccrual = Math.min(MAX_LEAVE_BUCKET_CAP, beforeAccrual + rawAccrual);
    const actualAccruedThisMonth = afterAccrual - beforeAccrual;
    annualAccrued += actualAccruedThisMonth;

    // Deduct leaves approved in this month
    const deductedThisMonth = yearApprovedByMonth.get(m) || 0;
    runningBalance = Math.max(0, afterAccrual - deductedThisMonth);

    if (m === safeAsOf) {
      availableAtAsOfMonth = runningBalance;
    }

    monthlyBreakdown.push({
      month: m,
      label: MONTH_LABELS[m - 1],
      accrued: rawAccrual,
      deducted: deductedThisMonth,
      endingBalance: runningBalance,
    });
  }

  return {
    employeeId: employee.id,
    employeeCode: employee.employeeId || employee.id,
    employeeName: employee.name,
    year,
    joiningDate: employee.joiningDate || '',
    status: employee.status,
    carryForwardStart,
    annualAccrued,
    approvedUsedDays: totalApprovedUsedDays,
    pendingDays: totalPendingDays,
    availableBalance: availableAtAsOfMonth,
    projectedYearEndBalance: Math.min(MAX_LEAVE_BUCKET_CAP, runningBalance),
    maxCap: MAX_LEAVE_BUCKET_CAP,
    monthlyBreakdown,
  };
}
