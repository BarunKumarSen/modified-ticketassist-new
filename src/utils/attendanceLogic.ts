import type { Employee } from '../types/asset';
import type {
  AttendanceDashboardStats,
  AttendanceRecord,
  AttendanceRegisterData,
  AttendanceRegisterDayCode,
  AttendanceRegisterDayEntry,
  AttendanceRegisterEmployeeRow,
  AttendanceStatus,
  DailyAttendanceReportRow,
  LeaveRecord,
  MonthlyAttendanceReportRow,
  PublicHoliday,
} from '../types/attendance';

export const STANDARD_SHIFT_START = '09:30';
export const STANDARD_SHIFT_END = '18:00';

export function parseTimeToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function calculateLateMinutes(
  checkInTime: string | null | undefined,
  shiftStart: string = STANDARD_SHIFT_START
): number {
  const checkInMins = parseTimeToMinutes(checkInTime);
  const startMins = parseTimeToMinutes(shiftStart);
  if (checkInMins === null || startMins === null) return 0;
  return Math.max(0, checkInMins - startMins);
}

export function calculateEarlyExitMinutes(
  checkOutTime: string | null | undefined,
  shiftEnd: string = STANDARD_SHIFT_END
): number {
  const outMins = parseTimeToMinutes(checkOutTime);
  const endMins = parseTimeToMinutes(shiftEnd);
  if (outMins === null || endMins === null) return 0;
  return Math.max(0, endMins - outMins);
}

export function calculateWorkHours(
  checkInTime: string | null | undefined,
  checkOutTime: string | null | undefined
): number {
  const start = parseTimeToMinutes(checkInTime);
  const end = parseTimeToMinutes(checkOutTime);
  if (start === null || end === null || end <= start) return 0;
  return Number(((end - start) / 60).toFixed(2));
}

export function calculateOvertimeHours(workHours: number, standardDailyHours = 8): number {
  const hrs = Number(workHours) || 0;
  if (hrs <= standardDailyHours) return 0;
  return Number((hrs - standardDailyHours).toFixed(2));
}

export function deriveAttendanceStatusOnCheckIn(
  checkInTime: string,
  shiftStart: string = STANDARD_SHIFT_START
): AttendanceStatus {
  return calculateLateMinutes(checkInTime, shiftStart) > 0 ? 'Late' : 'Present';
}

export function calculateLeaveDays(startDate: string, endDate: string): number {
  if (!startDate || !endDate) return 0;
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  const diffDays = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  return diffDays;
}

export function getDateRangeList(startDate: string, endDate: string): string[] {
  const days = calculateLeaveDays(startDate, endDate);
  if (days <= 0 || days > 60) return [];
  const start = new Date(`${startDate}T00:00:00Z`);
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    out.push(d.toISOString().split('T')[0]);
  }
  return out;
}

export function buildDailyAttendanceReport(params: {
  date: string;
  employees: Pick<Employee, 'id' | 'employeeId' | 'name' | 'department' | 'designation'>[];
  attendance: AttendanceRecord[];
}): DailyAttendanceReportRow[] {
  const { date, employees, attendance } = params;
  const byEmployee = new Map<string, AttendanceRecord>();
  for (const rec of attendance) {
    if (rec.attendanceDate === date) {
      byEmployee.set(rec.employeeId, rec);
    }
  }

  return employees.map((emp) => {
    const rec = byEmployee.get(emp.id);
    if (!rec) {
      return {
        employeeId: emp.id,
        employeeCode: emp.employeeId || emp.id,
        employeeName: emp.name,
        department: emp.department,
        designation: emp.designation,
        attendanceDate: date,
        checkInTime: null,
        checkOutTime: null,
        status: 'Absent',
        lateMinutes: 0,
        workHours: 0,
        remarks: 'No check-in recorded',
      };
    }

    return {
      employeeId: emp.id,
      employeeCode: emp.employeeId || emp.id,
      employeeName: emp.name,
      department: emp.department,
      designation: emp.designation,
      attendanceDate: rec.attendanceDate,
      checkInTime: rec.checkInTime,
      checkOutTime: rec.checkOutTime,
      status: rec.status,
      lateMinutes: rec.lateMinutes,
      workHours: rec.workHours,
      remarks: rec.remarks,
    };
  });
}

export function buildMonthlyAttendanceReport(params: {
  month: string; // YYYY-MM
  employees: Pick<Employee, 'id' | 'employeeId' | 'name' | 'department'>[];
  attendance: AttendanceRecord[];
}): MonthlyAttendanceReportRow[] {
  const { month, employees, attendance } = params;
  const monthRecords = attendance.filter((r) => r.attendanceDate.startsWith(`${month}-`));
  const trackedDates = new Set(monthRecords.map((r) => r.attendanceDate));
  const baselineDays = Math.max(1, trackedDates.size);

  return employees.map((emp) => {
    const empRecords = monthRecords.filter((r) => r.employeeId === emp.id);
    let presentDays = 0;
    let lateDays = 0;
    let halfDays = 0;
    let leaveDays = 0;
    let absentDays = 0;
    let totalWorkHours = 0;
    let totalLateMinutes = 0;

    for (const r of empRecords) {
      totalWorkHours += Number(r.workHours) || 0;
      totalLateMinutes += Number(r.lateMinutes) || 0;
      if (r.status === 'Present') presentDays++;
      else if (r.status === 'Late') lateDays++;
      else if (r.status === 'Half Day') halfDays++;
      else if (r.status === 'On Leave') leaveDays++;
      else if (r.status === 'Absent') absentDays++;
    }

    const attendedUnits = presentDays + lateDays + halfDays * 0.5;
    const denominator = Math.max(baselineDays, empRecords.length || 1);
    const attendanceRatePct =
      empRecords.length === 0 && trackedDates.size === 0
        ? 0
        : Math.min(100, Math.round((attendedUnits / denominator) * 100));

    return {
      employeeId: emp.id,
      employeeCode: emp.employeeId || emp.id,
      employeeName: emp.name,
      department: emp.department,
      presentDays,
      lateDays,
      halfDays,
      leaveDays,
      absentDays,
      totalWorkHours: Number(totalWorkHours.toFixed(2)),
      totalLateMinutes,
      attendanceRatePct,
    };
  });
}

export function computeAttendanceDashboardStats(params: {
  today: string;
  month: string;
  employees: Pick<Employee, 'id'>[];
  attendance: AttendanceRecord[];
  leaves: LeaveRecord[];
}): AttendanceDashboardStats {
  const { today, month, employees, attendance, leaves } = params;
  const empIds = new Set(employees.map((e) => e.id));

  const todayRecords = attendance.filter(
    (r) => r.attendanceDate === today && empIds.has(r.employeeId)
  );
  const byEmpToday = new Map(todayRecords.map((r) => [r.employeeId, r]));

  let presentToday = 0;
  let lateToday = 0;
  let onLeaveToday = 0;
  let absentToday = 0;

  for (const emp of employees) {
    const rec = byEmpToday.get(emp.id);
    if (!rec) {
      absentToday++;
    } else if (rec.status === 'Present') {
      presentToday++;
    } else if (rec.status === 'Late') {
      presentToday++;
      lateToday++;
    } else if (rec.status === 'Half Day') {
      presentToday++;
    } else if (rec.status === 'On Leave') {
      onLeaveToday++;
    } else {
      absentToday++;
    }
  }

  const monthRecords = attendance.filter(
    (r) => r.attendanceDate.startsWith(`${month}-`) && empIds.has(r.employeeId)
  );
  const completedHours = monthRecords.filter((r) => r.workHours > 0);
  const avgWorkHours =
    completedHours.length === 0
      ? 0
      : Number(
          (
            completedHours.reduce((sum, r) => sum + r.workHours, 0) / completedHours.length
          ).toFixed(2)
        );

  const pendingLeaves = leaves.filter(
    (l) => l.status === 'Pending' && empIds.has(l.employeeId)
  ).length;

  const lateArrivalsThisMonth = monthRecords.filter(
    (r) => r.status === 'Late' || r.lateMinutes > 0
  ).length;

  return {
    totalEmployeesInScope: employees.length,
    presentToday,
    lateToday,
    onLeaveToday,
    absentToday,
    avgWorkHours,
    pendingLeaves,
    lateArrivalsThisMonth,
  };
}

export interface CalendarDayCell {
  date: string; // YYYY-MM-DD
  dayOfMonth: number;
  inCurrentMonth: boolean;
  isWeekend: boolean;
  holidays: PublicHoliday[];
  approvedLeaves: LeaveRecord[];
}

export function buildAttendanceCalendarMonth(params: {
  month: string; // YYYY-MM
  leaves: LeaveRecord[];
  holidays: PublicHoliday[];
  employees?: Pick<Employee, 'id' | 'department' | 'center' | 'branch'>[];
  department?: string;
  center?: string;
}): {
  month: string;
  leadingEmptySlots: number;
  days: CalendarDayCell[];
  totalApprovedLeaveDaysInMonth: number;
  totalHolidaysInMonth: number;
} {
  const match = /^(\d{4})-(\d{2})$/.exec(params.month);
  const year = match ? Number(match[1]) : new Date().getFullYear();
  const monthIdx = match ? Number(match[2]) - 1 : new Date().getMonth();

  const firstDay = new Date(Date.UTC(year, monthIdx, 1));
  const daysInMonth = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
  const leadingEmptySlots = firstDay.getUTCDay(); // 0 = Sun ... 6 = Sat

  const empMap = new Map(
    (params.employees || []).map((e) => [e.id, e])
  );

  const deptFilter = (params.department || '').trim().toLowerCase();
  const centerFilter = (params.center || '').trim().toLowerCase();

  const filteredHolidays = params.holidays.filter((h) => {
    if (!h.holidayDate.startsWith(params.month)) return false;
    if (centerFilter && centerFilter !== 'all' && centerFilter !== 'all centers') {
      const hCenter = (h.center || 'All Centers').trim().toLowerCase();
      return hCenter === 'all centers' || hCenter === centerFilter;
    }
    return true;
  });

  const filteredApprovedLeaves = params.leaves.filter((lv) => {
    if (lv.status !== 'Approved') return false;
    const emp = empMap.get(lv.employeeId);
    if (deptFilter) {
      const lvDept = (lv.department || emp?.department || '').trim().toLowerCase();
      if (lvDept !== deptFilter) return false;
    }
    if (centerFilter && centerFilter !== 'all' && centerFilter !== 'all centers') {
      const empCenter = (emp?.center || emp?.branch || '').trim().toLowerCase();
      if (empCenter && empCenter !== centerFilter) return false;
    }
    return true;
  });

  const days: CalendarDayCell[] = [];
  let totalApprovedLeaveDaysInMonth = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(Date.UTC(year, monthIdx, d));
    const dateStr = dt.toISOString().split('T')[0];
    const dow = dt.getUTCDay();
    const isWeekend = dow === 0 || dow === 6;

    const dayHolidays = filteredHolidays.filter((h) => h.holidayDate === dateStr);
    const dayLeaves = filteredApprovedLeaves.filter(
      (lv) => lv.startDate <= dateStr && lv.endDate >= dateStr
    );
    totalApprovedLeaveDaysInMonth += dayLeaves.length;

    days.push({
      date: dateStr,
      dayOfMonth: d,
      inCurrentMonth: true,
      isWeekend,
      holidays: dayHolidays,
      approvedLeaves: dayLeaves,
    });
  }

  return {
    month: params.month,
    leadingEmptySlots,
    days,
    totalApprovedLeaveDaysInMonth,
    totalHolidaysInMonth: filteredHolidays.length,
  };
}

export function buildMonthlyAttendanceRegister(params: {
  month: string; // YYYY-MM
  employees: Pick<Employee, 'id' | 'employeeId' | 'name' | 'department' | 'designation' | 'center' | 'branch'>[];
  attendance: AttendanceRecord[];
  leaves: LeaveRecord[];
  holidays: PublicHoliday[];
  today?: string;
}): AttendanceRegisterData {
  const match = /^(\d{4})-(\d{2})$/.exec(params.month);
  const year = match ? Number(match[1]) : new Date().getFullYear();
  const monthIdx = match ? Number(match[2]) - 1 : new Date().getMonth();
  const daysInMonth = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
  const todayIso = params.today || new Date().toISOString().split('T')[0];

  const dates: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(Date.UTC(year, monthIdx, d));
    dates.push(dt.toISOString().split('T')[0]);
  }

  const attendanceByEmpDate = new Map<string, AttendanceRecord>();
  for (const rec of params.attendance) {
    if (rec.attendanceDate.startsWith(`${params.month}-`)) {
      attendanceByEmpDate.set(`${rec.employeeId}::${rec.attendanceDate}`, rec);
    }
  }

  const approvedLeaves = params.leaves.filter((l) => l.status === 'Approved');
  const monthHolidays = params.holidays.filter((h) => h.holidayDate.startsWith(`${params.month}-`));

  let totalPresentDays = 0;
  let totalLateArrivals = 0;
  let totalEarlyExits = 0;
  let totalLeaveDays = 0;
  let totalHolidays = 0;
  let totalAbsentDays = 0;
  let totalOvertimeHours = 0;
  let totalHoursAll = 0;

  const rows: AttendanceRegisterEmployeeRow[] = params.employees.map((emp) => {
    const empCenter = (emp.center || emp.branch || '').trim().toLowerCase();
    const empLeaves = approvedLeaves.filter((l) => l.employeeId === emp.id);
    const days: Record<string, AttendanceRegisterDayEntry> = {};

    let presentDays = 0;
    let lateDays = 0;
    let halfDays = 0;
    let leaveDays = 0;
    let holidayDays = 0;
    let weekOffDays = 0;
    let absentDays = 0;
    let earlyExitCount = 0;
    let totalWorkHours = 0;
    let overtimeHours = 0;

    for (const dateStr of dates) {
      const dt = new Date(`${dateStr}T00:00:00Z`);
      const dow = dt.getUTCDay();
      const isWeekend = dow === 0 || dow === 6;

      const holiday = monthHolidays.find((h) => {
        if (h.holidayDate !== dateStr) return false;
        const hCenter = (h.center || 'All Centers').trim().toLowerCase();
        return hCenter === 'all centers' || !empCenter || hCenter === empCenter;
      });

      const rec = attendanceByEmpDate.get(`${emp.id}::${dateStr}`);
      const onLeave = empLeaves.find((l) => l.startDate <= dateStr && l.endDate >= dateStr);

      let code: AttendanceRegisterDayCode = '—';
      let checkInTime: string | null = rec?.checkInTime ?? null;
      let checkOutTime: string | null = rec?.checkOutTime ?? null;
      let lateMinutes = Number(rec?.lateMinutes || 0);
      if (lateMinutes === 0 && checkInTime) {
        lateMinutes = calculateLateMinutes(checkInTime);
      }
      const earlyExitMinutes = checkOutTime ? calculateEarlyExitMinutes(checkOutTime) : 0;
      const workHours = Number(
        rec?.workHours || (checkInTime && checkOutTime ? calculateWorkHours(checkInTime, checkOutTime) : 0)
      );
      const dayOt = calculateOvertimeHours(workHours);

      if (rec) {
        if (rec.status === 'Present') {
          code = lateMinutes > 0 ? 'L' : 'P';
          presentDays++;
          if (lateMinutes > 0) lateDays++;
        } else if (rec.status === 'Late') {
          code = 'L';
          presentDays++;
          lateDays++;
        } else if (rec.status === 'Half Day') {
          code = 'HD';
          halfDays++;
        } else if (rec.status === 'On Leave') {
          code = 'LV';
          leaveDays++;
        } else if (rec.status === 'Absent') {
          code = 'A';
          absentDays++;
        }
      } else if (holiday) {
        code = 'H';
        holidayDays++;
      } else if (onLeave) {
        code = 'LV';
        leaveDays++;
      } else if (isWeekend) {
        code = 'WO';
        weekOffDays++;
      } else if (dateStr <= todayIso) {
        code = 'A';
        absentDays++;
      } else {
        code = '—';
      }

      if (earlyExitMinutes > 0 && (code === 'P' || code === 'L' || code === 'HD')) {
        earlyExitCount++;
      }
      totalWorkHours += workHours;
      overtimeHours += dayOt;

      days[dateStr] = {
        date: dateStr,
        code,
        checkInTime,
        checkOutTime,
        lateMinutes,
        earlyExitMinutes,
        workHours,
        overtimeHours: dayOt,
        holidayName: holiday?.title,
        leaveType: onLeave?.leaveType,
        remarks: rec?.remarks,
      };
    }

    const workingDaysTracked = presentDays + halfDays + absentDays;
    const attendanceRatePct =
      workingDaysTracked === 0
        ? 0
        : Math.min(100, Math.round(((presentDays + halfDays * 0.5) / workingDaysTracked) * 100));

    totalPresentDays += presentDays;
    totalLateArrivals += lateDays;
    totalEarlyExits += earlyExitCount;
    totalLeaveDays += leaveDays;
    totalHolidays += holidayDays;
    totalAbsentDays += absentDays;
    totalOvertimeHours += overtimeHours;
    totalHoursAll += totalWorkHours;

    return {
      employeeId: emp.id,
      employeeCode: emp.employeeId || emp.id,
      employeeName: emp.name,
      department: emp.department || '',
      designation: emp.designation || '',
      center: emp.center || emp.branch || '',
      days,
      presentDays,
      lateDays,
      halfDays,
      leaveDays,
      holidayDays,
      weekOffDays,
      absentDays,
      earlyExitCount,
      totalWorkHours: Number(totalWorkHours.toFixed(2)),
      overtimeHours: Number(overtimeHours.toFixed(2)),
      attendanceRatePct,
    };
  });

  return {
    month: params.month,
    daysInMonth,
    dates,
    rows,
    summary: {
      totalEmployees: rows.length,
      totalPresentDays,
      totalLateArrivals,
      totalEarlyExits,
      totalLeaveDays,
      totalHolidays,
      totalAbsentDays,
      totalOvertimeHours: Number(totalOvertimeHours.toFixed(2)),
      totalWorkHours: Number(totalHoursAll.toFixed(2)),
    },
  };
}


