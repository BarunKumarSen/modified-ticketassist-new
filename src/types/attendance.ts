export type AttendanceStatus = 'Present' | 'Late' | 'Half Day' | 'On Leave' | 'Absent';
export type CorrectionStatus = 'None' | 'Pending' | 'Approved' | 'Rejected';
export type LeaveType = 'Annual' | 'Sick' | 'Casual' | 'Unpaid';
export type LeaveStatus = 'Pending' | 'Approved' | 'Rejected';

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeCode?: string;
  employeeName?: string;
  department?: string;
  designation?: string;
  attendanceDate: string; // YYYY-MM-DD
  checkInTime: string | null; // HH:mm
  checkOutTime: string | null; // HH:mm
  status: AttendanceStatus;
  lateMinutes: number;
  workHours: number;
  remarks: string;
  correctionStatus: CorrectionStatus;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveRecord {
  id: string;
  employeeId: string;
  employeeCode?: string;
  employeeName?: string;
  department?: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  managerId?: string | null;
  managerName?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewRemarks?: string | null;
  overriddenBy?: string | null;
  overriddenAt?: string | null;
  createdAt: string;
}

export interface AttendanceAuditLog {
  id: string;
  attendanceId?: string | null;
  employeeId: string;
  employeeName?: string;
  action: string;
  actorUserId: string;
  actorName: string;
  beforeJson?: string | null;
  afterJson?: string | null;
  details: string;
  createdAt: string;
}

export interface DailyAttendanceReportRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  designation: string;
  attendanceDate: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  status: AttendanceStatus;
  lateMinutes: number;
  workHours: number;
  remarks: string;
}

export interface MonthlyAttendanceReportRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  presentDays: number;
  lateDays: number;
  halfDays: number;
  leaveDays: number;
  absentDays: number;
  totalWorkHours: number;
  totalLateMinutes: number;
  attendanceRatePct: number;
}

export interface AttendanceDashboardStats {
  totalEmployeesInScope: number;
  presentToday: number;
  lateToday: number;
  onLeaveToday: number;
  absentToday: number;
  avgWorkHours: number;
  pendingLeaves: number;
  lateArrivalsThisMonth: number;
}

export interface PublicHoliday {
  id: string;
  title: string;
  holidayDate: string; // YYYY-MM-DD
  center: string; // e.g., 'All Centers', 'Mumbai', 'Bengaluru', 'New Delhi'
  description: string;
  isNational?: boolean;
  originKey?: string | null;
  createdBy?: string | null;
  createdAt: string;
}

export interface LeaveAccrualMonthRow {
  month: number; // 1..12
  label: string;
  accrued: number;
  deducted: number;
  endingBalance: number;
}

export interface LeaveBalanceSummary {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  year: number;
  joiningDate: string;
  status: 'Active' | 'Inactive';
  carryForwardStart: number;
  annualAccrued: number;
  approvedUsedDays: number;
  pendingDays: number;
  availableBalance: number;
  projectedYearEndBalance: number;
  maxCap: number;
  monthlyBreakdown: LeaveAccrualMonthRow[];
}

export type WorkflowRequestType = 'regularization' | 'wfh' | 'profile_change';
export type WorkflowRequestStatus = 'Pending' | 'Approved' | 'Rejected';

export interface WorkflowRequestRecord {
  id: string;
  requestType: WorkflowRequestType;
  employeeId: string;
  employeeCode?: string;
  employeeName?: string;
  employeeEmail?: string;
  department?: string;
  center?: string;
  reportingManagerName?: string;
  reportingManagerEmail?: string;
  targetDate: string; // YYYY-MM-DD (or effective date)
  endDate?: string | null;
  requestedCheckIn?: string | null;
  requestedCheckOut?: string | null;
  payloadJson?: string | null;
  reason: string;
  status: WorkflowRequestStatus;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewNotes?: string | null;
  createdAt: string;
}

export type AttendanceRegisterDayCode =
  | 'P'
  | 'L'
  | 'HD'
  | 'LV'
  | 'H'
  | 'WO'
  | '—'
  | 'A';

export interface AttendanceRegisterDayEntry {
  date: string;
  code: AttendanceRegisterDayCode;
  checkInTime: string | null;
  checkOutTime: string | null;
  lateMinutes: number;
  earlyExitMinutes: number;
  workHours: number;
  overtimeHours: number;
  holidayName?: string;
  leaveType?: LeaveType;
  remarks?: string;
}

export interface AttendanceRegisterEmployeeRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  designation: string;
  center: string;
  days: Record<string, AttendanceRegisterDayEntry>;
  presentDays: number;
  lateDays: number;
  halfDays: number;
  leaveDays: number;
  holidayDays: number;
  weekOffDays: number;
  absentDays: number;
  earlyExitCount: number;
  totalWorkHours: number;
  overtimeHours: number;
  attendanceRatePct: number;
}

export interface AttendanceRegisterData {
  month: string;
  daysInMonth: number;
  dates: string[];
  rows: AttendanceRegisterEmployeeRow[];
  summary: {
    totalEmployees: number;
    totalPresentDays: number;
    totalLateArrivals: number;
    totalEarlyExits: number;
    totalLeaveDays: number;
    totalHolidays: number;
    totalAbsentDays: number;
    totalOvertimeHours: number;
    totalWorkHours: number;
  };
}
