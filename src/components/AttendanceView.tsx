import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import {
  CalendarCheck2,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ClockAlert,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  Home,
  LayoutGrid,
  List,
  LogIn,
  LogOut,
  Mail,
  MapPin,
  Pencil,
  Plus,
  Printer,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import { apiClient, ApiError } from '../api/client';
import { useSession } from '../auth/SessionContext';
import type { Employee, ThemePalette, ToastMessage } from '../types/asset';
import type { EmployeeCenterRecord } from '../types/policy';
import type {
  AttendanceAuditLog,
  AttendanceDashboardStats,
  AttendanceRecord,
  AttendanceRegisterData,
  AttendanceStatus,
  DailyAttendanceReportRow,
  LeaveBalanceSummary,
  LeaveRecord,
  LeaveType,
  MonthlyAttendanceReportRow,
  PublicHoliday,
  WorkflowRequestRecord,
} from '../types/attendance';
import { INDIAN_CENTERS } from '../data/indianCenters';
import { THEME_PALETTES } from '../utils/assetMath';
import {
  buildMonthlyRegisterCsv,
  downloadExcelReport,
  downloadMonthlyRegisterExcel,
  downloadMonthlyRegisterPdf,
  downloadPdfReport,
} from '../utils/attendanceExport';
import {
  buildAttendanceCalendarMonth,
  calculateEarlyExitMinutes,
  calculateOvertimeHours,
  type CalendarDayCell,
} from '../utils/attendanceLogic';
import { canUserApproveLeave } from '../utils/hierarchyLogic';
import { ModalShell } from './AssetModals';
import { SearchableCenterSelect } from './SearchableCenterSelect';

type AttendanceSubTab =
  | 'dashboard'
  | 'calendar'
  | 'requests'
  | 'history'
  | 'daily-report'
  | 'monthly-report'
  | 'late-arrivals'
  | 'leaves'
  | 'audit-logs';

function getTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function getCurrentMonthStr(): string {
  return getTodayStr().slice(0, 7);
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'Present':
    case 'Approved':
      return 'bg-[#dcfce7] text-[#166534] border-[#bbf7d0]';
    case 'Late':
    case 'Pending':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'Absent':
    case 'Rejected':
      return 'bg-[#fce7f3] text-[#be185d] border-[#fbcfe8]';
    case 'On Leave':
      return 'bg-sky-100 text-sky-800 border-sky-200';
    case 'Half Day':
      return 'bg-orange-100 text-orange-800 border-orange-200';
    default:
      return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

function registerCodeBadgeClass(code: string): string {
  switch (code) {
    case 'P':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'L':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'HD':
      return 'bg-orange-100 text-orange-800 border-orange-200';
    case 'LV':
      return 'bg-sky-100 text-sky-800 border-sky-200';
    case 'H':
      return 'bg-violet-100 text-violet-800 border-violet-200';
    case 'WO':
      return 'bg-slate-100 text-slate-500 border-slate-200';
    case 'A':
      return 'bg-rose-100 text-rose-700 border-rose-200';
    default:
      return 'bg-slate-50 text-slate-400 border-slate-200';
  }
}

export const AttendanceView: React.FC<{
  theme: ThemePalette;
  initialSubTab?: AttendanceSubTab;
  centers?: EmployeeCenterRecord[];
  onMailStatus?: (popup: { ok: boolean; title: string; details?: string }) => void;
  onNotify: (msg: string, type?: ToastMessage['type']) => void;
}> = ({ theme, initialSubTab = 'dashboard', centers: propCenters, onMailStatus, onNotify }) => {
  const { session, hasPermission, hasAnyPermission } = useSession();
  const palette = THEME_PALETTES[theme];

  const canCreate = hasPermission('attendance.create');
  const canEdit = hasPermission('attendance.edit');
  const canDelete = hasPermission('attendance.delete');
  const canReport = hasPermission('attendance.report');
  const canExport = hasPermission('attendance.export');
  const canManageHolidays =
    hasPermission('attendance.edit') || hasPermission('role.manage');
  const canReviewWorkflows =
    hasPermission('attendance.edit') ||
    hasPermission('employee.edit') ||
    hasPermission('role.manage');
  const canViewAudit = hasAnyPermission(['attendance.edit', 'role.manage', 'attendance.report']);
  const isOrgWide =
    session?.role === 'Super Admin' ||
    session?.role === 'Administrator' ||
    session?.role === 'HR Manager' ||
    session?.role === 'Auditor';
  const isDeptManager = session?.role === 'Department Manager' || session?.role === 'Manager';

  const [subTab, setSubTab] = useState<AttendanceSubTab>(initialSubTab);

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [leaves, setLeaves] = useState<LeaveRecord[]>([]);
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalanceSummary[]>([]);
  const [holidays, setHolidays] = useState<PublicHoliday[]>([]);
  const [workflowRequests, setWorkflowRequests] = useState<WorkflowRequestRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AttendanceAuditLog[]>([]);
  const [stats, setStats] = useState<AttendanceDashboardStats | null>(null);
  const [dailyRows, setDailyRows] = useState<DailyAttendanceReportRow[]>([]);
  const [monthlyRows, setMonthlyRows] = useState<MonthlyAttendanceReportRow[]>([]);

  // Filters
  const [todayDate] = useState<string>(getTodayStr);
  const [reportDate, setReportDate] = useState<string>(getTodayStr);
  const [reportMonth, setReportMonth] = useState<string>(getCurrentMonthStr);
  const [calendarMonth, setCalendarMonth] = useState<string>(getCurrentMonthStr);
  const [calendarDept, setCalendarDept] = useState<string>('');
  const [calendarCenter, setCalendarCenter] = useState<string>('All Centers');
  const [selectedCalDate, setSelectedCalDate] = useState<string>(getTodayStr);
  const [deptFilter, setDeptFilter] = useState<string>('');
  const [historySearch, setHistorySearch] = useState<string>('');
  const [historyStatus, setHistoryStatus] = useState<string>('');
  const [historyMonth, setHistoryMonth] = useState<string>(getCurrentMonthStr);
  const [historyLayout, setHistoryLayout] = useState<'grid' | 'log'>('grid');
  const [registerData, setRegisterData] = useState<AttendanceRegisterData | null>(null);
  const [registerLoading, setRegisterLoading] = useState(false);

  // Quick Check-In / Out state
  const [selectedEmpId, setSelectedEmpId] = useState<string>(session?.employeeId || '');
  const [checkRemarks, setCheckRemarks] = useState<string>('');
  const [checkSubmitting, setCheckSubmitting] = useState(false);

  // Modals
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [holidayModalOpen, setHolidayModalOpen] = useState(false);
  const [editingHoliday, setEditingHoliday] = useState<PublicHoliday | null>(null);
  const [regModalOpen, setRegModalOpen] = useState(false);
  const [wfhModalOpen, setWfhModalOpen] = useState(false);
  const [loadedCenters, setLoadedCenters] = useState<EmployeeCenterRecord[]>([]);
  const [leaveReviewModal, setLeaveReviewModal] = useState<{
    leave: LeaveRecord;
    decision: 'Approved' | 'Rejected';
    isOverride: boolean;
  } | null>(null);
  const [leaveReviewRemarks, setLeaveReviewRemarks] = useState('');
  const [leaveReviewSubmitting, setLeaveReviewSubmitting] = useState(false);

  const trendCanvasRef = useRef<HTMLCanvasElement>(null);
  const trendChartRef = useRef<Chart | null>(null);
  const calendarYear = Number(calendarMonth.slice(0, 4)) || new Date().getFullYear();

  const loadAllAttendanceData = useCallback(async () => {
    setLoading(true);
    try {
      const [dashRes, attRes, leaveRes, balRes, holidayRes, wfRes, centerRes] = await Promise.all([
        apiClient.getAttendanceDashboard(todayDate),
        apiClient.listAttendance(),
        apiClient.listLeaves(),
        apiClient
          .getLeaveBalances(new Date().getFullYear())
          .catch(() => ({ year: new Date().getFullYear(), balances: [] })),
        apiClient.listHolidays({ year: calendarYear }),
        apiClient.listWorkflowRequests().catch(() => ({ requests: [] })),
        apiClient.listCenters().catch(() => ({ centers: [] })),
      ]);
      setStats(dashRes.stats);
      setRecords(attRes.records);
      setLeaves(leaveRes.leaves);
      setLeaveBalances(balRes.balances);
      setHolidays(holidayRes.holidays);
      setWorkflowRequests(wfRes.requests);
      if (centerRes.centers.length > 0) {
        setLoadedCenters(centerRes.centers);
      }

      if (hasPermission('employee.view')) {
        const empRes = await apiClient.listEmployees();
        setEmployees(empRes.employees);
        setSelectedEmpId((prev) => {
          if (prev && empRes.employees.some((e) => e.id === prev)) return prev;
          if (session?.employeeId && empRes.employees.some((e) => e.id === session.employeeId)) {
            return session.employeeId;
          }
          return empRes.employees[0]?.id || '';
        });
      } else if (session?.employeeId) {
        setSelectedEmpId((prev) => prev || session.employeeId || '');
      }

      if (canViewAudit) {
        try {
          const auditRes = await apiClient.listAuditLogs();
          setAuditLogs(auditRes.logs);
        } catch {
          setAuditLogs([]);
        }
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to load attendance data';
      onNotify(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [todayDate, calendarYear, hasPermission, canViewAudit, session?.employeeId, onNotify]);

  useEffect(() => {
    void loadAllAttendanceData();
  }, [loadAllAttendanceData]);

  // Load reports or monthly register when active
  useEffect(() => {
    if (subTab === 'history') {
      const targetMonth = historyMonth || getCurrentMonthStr();
      setRegisterLoading(true);
      apiClient
        .getAttendanceRegister({
          month: targetMonth,
          department: deptFilter || undefined,
          employeeId: !isOrgWide ? session?.employeeId : undefined,
        })
        .then((res) => setRegisterData(res.register))
        .catch((err) =>
          onNotify(
            err instanceof ApiError ? err.message : 'Failed to load monthly attendance register',
            'error'
          )
        )
        .finally(() => setRegisterLoading(false));
      return;
    }
    if (!canReport) return;
    if (subTab === 'daily-report') {
      apiClient
        .getDailyReport(reportDate, deptFilter || undefined)
        .then((res) => setDailyRows(res.rows))
        .catch((err) => onNotify(err instanceof ApiError ? err.message : 'Failed to load daily report', 'error'));
    } else if (subTab === 'monthly-report') {
      apiClient
        .getMonthlyReport(reportMonth, deptFilter || undefined)
        .then((res) => setMonthlyRows(res.rows))
        .catch((err) => onNotify(err instanceof ApiError ? err.message : 'Failed to load monthly report', 'error'));
    }
  }, [subTab, reportDate, reportMonth, historyMonth, deptFilter, canReport, isOrgWide, session?.employeeId, onNotify]);

  // Compute 7-day trend from loaded scoped records and render Chart
  useEffect(() => {
    if (subTab !== 'dashboard' || !stats || !trendCanvasRef.current) return;
    if (trendChartRef.current) {
      trendChartRef.current.destroy();
    }
    const ctx = trendCanvasRef.current.getContext('2d');
    if (!ctx) return;

    const base = new Date(`${todayDate}T00:00:00Z`);
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(base.getTime() - i * 86400000);
      days.push(d.toISOString().split('T')[0]);
    }

    trendChartRef.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: days.map((d) => d.slice(5)),
        datasets: [
          {
            label: 'Present',
            data: days.map(
              (d) =>
                records.filter((r) => r.attendanceDate === d && r.status === 'Present').length
            ),
            backgroundColor: '#15803d',
            borderRadius: 4,
          },
          {
            label: 'Late',
            data: days.map(
              (d) => records.filter((r) => r.attendanceDate === d && r.status === 'Late').length
            ),
            backgroundColor: '#d97706',
            borderRadius: 4,
          },
          {
            label: 'On Leave',
            data: days.map(
              (d) =>
                records.filter((r) => r.attendanceDate === d && r.status === 'On Leave').length
            ),
            backgroundColor: '#0284c7',
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
        },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });

    return () => {
      trendChartRef.current?.destroy();
    };
  }, [subTab, stats, records, todayDate]);

  const effectiveTargetEmpId = isOrgWide
    ? selectedEmpId || session?.employeeId || employees[0]?.id || ''
    : session?.employeeId || selectedEmpId || '';

  const todayMyRecord = useMemo(
    () =>
      records.find(
        (r) =>
          r.attendanceDate === todayDate &&
          (r.employeeId === effectiveTargetEmpId || r.employeeCode === effectiveTargetEmpId)
      ),
    [records, todayDate, effectiveTargetEmpId]
  );

  const handleCheckIn = async () => {
    if (checkSubmitting) return;
    setCheckSubmitting(true);
    try {
      const res = await apiClient.checkIn({
        employeeId: effectiveTargetEmpId || undefined,
        date: todayDate,
        remarks: checkRemarks,
      });
      onNotify(
        `Checked in at ${res.record.checkInTime} (${res.record.status}${
          res.record.lateMinutes > 0 ? `, ${res.record.lateMinutes}m late` : ''
        })`
      );
      setCheckRemarks('');
      await loadAllAttendanceData();
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Check-in failed', 'error');
    } finally {
      setCheckSubmitting(false);
    }
  };

  const handleCheckOut = async () => {
    if (checkSubmitting) return;
    setCheckSubmitting(true);
    try {
      const res = await apiClient.checkOut({
        employeeId: effectiveTargetEmpId || undefined,
        date: todayDate,
        remarks: checkRemarks,
      });
      onNotify(`Checked out at ${res.record.checkOutTime} (${res.record.workHours} hrs logged)`);
      setCheckRemarks('');
      await loadAllAttendanceData();
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Check-out failed', 'error');
    } finally {
      setCheckSubmitting(false);
    }
  };

  const handleDeleteRecord = async (rec: AttendanceRecord) => {
    try {
      await apiClient.deleteAttendance(rec.id);
      onNotify(`Deleted attendance record for ${rec.employeeName} (${rec.attendanceDate})`, 'info');
      await loadAllAttendanceData();
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Failed to delete record', 'error');
    }
  };

  const openLeaveDecisionModal = (
    leave: LeaveRecord,
    decision: 'Approved' | 'Rejected',
    isOverride = false
  ) => {
    setLeaveReviewModal({ leave, decision, isOverride });
    setLeaveReviewRemarks(leave.reviewRemarks || '');
  };

  const handleConfirmReviewLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leaveReviewModal || leaveReviewSubmitting) return;
    setLeaveReviewSubmitting(true);
    try {
      await apiClient.reviewLeave(
        leaveReviewModal.leave.id,
        leaveReviewModal.decision,
        leaveReviewRemarks.trim() || undefined
      );
      onNotify(
        `Leave request ${leaveReviewModal.decision.toLowerCase()} for ${
          leaveReviewModal.leave.employeeName || leaveReviewModal.leave.employeeId
        }`
      );
      setLeaveReviewModal(null);
      setLeaveReviewRemarks('');
      await loadAllAttendanceData();
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Failed to update leave', 'error');
    } finally {
      setLeaveReviewSubmitting(false);
    }
  };

  const departments = useMemo(() => {
    const set = new Set<string>();
    employees.forEach((e) => e.department && set.add(e.department));
    records.forEach((r) => r.department && set.add(r.department));
    leaves.forEach((l) => l.department && set.add(l.department));
    return Array.from(set).sort();
  }, [employees, records, leaves]);

  const centerRecords = useMemo<EmployeeCenterRecord[]>(() => {
    const base =
      propCenters && propCenters.length > 0
        ? propCenters
        : loadedCenters.length > 0
        ? loadedCenters
        : INDIAN_CENTERS.map((c) => ({
            id: c.id,
            name: c.name,
            stateRegion: c.stateRegion,
            isActive: true,
            createdAt: '',
          }));
    const seen = new Set(base.map((c) => c.name.toLowerCase()));
    const merged = [...base];
    const extraNames: string[] = [];
    employees.forEach((e) => {
      const c = (e.center || e.branch || '').trim();
      if (c) extraNames.push(c);
    });
    holidays.forEach((h) => {
      const c = (h.center || '').trim();
      if (c && c !== 'All Centers') extraNames.push(c);
    });
    extraNames.forEach((name, idx) => {
      const key = name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push({
          id: `extra_${idx}_${key}`,
          name,
          stateRegion: 'India',
          isActive: true,
          createdAt: '',
        });
      }
    });
    return merged.sort((a, b) => a.name.localeCompare(b.name));
  }, [propCenters, loadedCenters, employees, holidays]);

  const calendarData = useMemo(
    () =>
      buildAttendanceCalendarMonth({
        month: calendarMonth,
        leaves,
        holidays,
        employees,
        department: calendarDept,
        center: calendarCenter,
      }),
    [calendarMonth, leaves, holidays, employees, calendarDept, calendarCenter]
  );

  const selectedDayCell: CalendarDayCell | undefined = useMemo(
    () =>
      calendarData.days.find((d) => d.date === selectedCalDate) ||
      calendarData.days.find((d) => d.holidays.length > 0 || d.approvedLeaves.length > 0) ||
      calendarData.days[0],
    [calendarData.days, selectedCalDate]
  );

  const shiftCalendarMonth = (delta: number) => {
    const [y, m] = calendarMonth.split('-').map(Number);
    if (!y || !m) return;
    const next = new Date(Date.UTC(y, m - 1 + delta, 1));
    const nextStr = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
    setCalendarMonth(nextStr);
    setSelectedCalDate(`${nextStr}-01`);
  };

  const handleDeleteHoliday = async (holiday: PublicHoliday) => {
    try {
      await apiClient.deleteHoliday(holiday.id);
      onNotify(`Removed holiday "${holiday.title}"`, 'info');
      await loadAllAttendanceData();
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Failed to delete holiday', 'error');
    }
  };

  const handleReviewWorkflow = async (
    reqItem: WorkflowRequestRecord,
    status: 'Approved' | 'Rejected'
  ) => {
    try {
      await apiClient.reviewWorkflowRequest(reqItem.id, status);
      onNotify(`${reqItem.requestType} request ${status.toLowerCase()} for ${reqItem.employeeName || reqItem.employeeId}`);
      await loadAllAttendanceData();
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Failed to update request', 'error');
    }
  };

  const handleSendEntityMail = async (
    entityType: 'leave' | 'workflow_request',
    entityId: string
  ) => {
    try {
      const res = await apiClient.sendEntityMail(entityType, entityId);
      if (onMailStatus) {
        onMailStatus({
          ok: true,
          title: 'Email Sent Successfully',
          details: res.message,
        });
      } else {
        onNotify(res.message || 'Email Sent Successfully');
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Email Delivery Failed';
      if (onMailStatus) {
        onMailStatus({
          ok: false,
          title: 'Email Delivery Failed',
          details: msg,
        });
      } else {
        onNotify(msg, 'error');
      }
    }
  };

  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return records.filter((r) => {
      if (historyMonth && !r.attendanceDate.startsWith(historyMonth)) return false;
      if (historyStatus && r.status !== historyStatus) return false;
      if (deptFilter && r.department !== deptFilter) return false;
      if (q) {
        const hay = `${r.employeeName} ${r.employeeCode} ${r.department || ''} ${r.remarks}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [records, historySearch, historyStatus, historyMonth, deptFilter]);

  const lateRecords = useMemo(
    () => records.filter((r) => r.status === 'Late' || r.lateMinutes > 0),
    [records]
  );

  const filteredRegister = useMemo<AttendanceRegisterData | null>(() => {
    if (!registerData) return null;
    const q = historySearch.trim().toLowerCase();
    const rows = registerData.rows.filter((row) => {
      if (q) {
        const hay = `${row.employeeName} ${row.employeeCode} ${row.department} ${row.center}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (historyStatus === 'Present' && row.presentDays === 0) return false;
      if (historyStatus === 'Late' && row.lateDays === 0) return false;
      if (historyStatus === 'Half Day' && row.halfDays === 0) return false;
      if (historyStatus === 'On Leave' && row.leaveDays === 0) return false;
      if (historyStatus === 'Absent' && row.absentDays === 0) return false;
      return true;
    });
    return {
      ...registerData,
      rows,
      summary: {
        totalEmployees: rows.length,
        totalPresentDays: rows.reduce((s, r) => s + r.presentDays, 0),
        totalLateArrivals: rows.reduce((s, r) => s + r.lateDays, 0),
        totalEarlyExits: rows.reduce((s, r) => s + r.earlyExitCount, 0),
        totalLeaveDays: rows.reduce((s, r) => s + r.leaveDays, 0),
        totalHolidays: rows.reduce((s, r) => s + r.holidayDays, 0),
        totalAbsentDays: rows.reduce((s, r) => s + r.absentDays, 0),
        totalOvertimeHours: Number(rows.reduce((s, r) => s + r.overtimeHours, 0).toFixed(2)),
        totalWorkHours: Number(rows.reduce((s, r) => s + r.totalWorkHours, 0).toFixed(2)),
      },
    };
  }, [registerData, historySearch, historyStatus]);

  const exportHistoryExcel = () => {
    if (historyLayout === 'grid' && filteredRegister) {
      downloadMonthlyRegisterExcel(filteredRegister);
      return;
    }
    downloadExcelReport({
      filename: `Median-Attendance-Log-${historyMonth || todayDate}.xls`,
      sheetName: 'Attendance History',
      headers: [
        'Employee ID',
        'Employee Name',
        'Department',
        'Date',
        'Check In',
        'Check Out',
        'Late (m)',
        'Early Exit (m)',
        'Hours',
        'OT (h)',
        'Status',
        'Remarks',
      ],
      rows: filteredHistory.map((r) => [
        r.employeeCode || r.employeeId,
        r.employeeName || r.employeeId,
        r.department || '—',
        r.attendanceDate,
        r.checkInTime || '—',
        r.checkOutTime || '—',
        r.lateMinutes,
        calculateEarlyExitMinutes(r.checkOutTime),
        r.workHours,
        calculateOvertimeHours(r.workHours),
        r.status,
        r.remarks || '—',
      ]),
    });
  };

  const exportHistoryCsv = () => {
    const csv = filteredRegister
      ? buildMonthlyRegisterCsv(filteredRegister)
      : [
          ['Code', 'Name', 'Department', 'Date', 'Check In', 'Check Out', 'Late (m)', 'Early Exit (m)', 'Hours', 'OT (h)', 'Status'].join(','),
          ...filteredHistory.map((r) =>
            [
              r.employeeCode || r.employeeId,
              `"${(r.employeeName || r.employeeId).replace(/"/g, '""')}"`,
              `"${(r.department || '').replace(/"/g, '""')}"`,
              r.attendanceDate,
              r.checkInTime || '',
              r.checkOutTime || '',
              r.lateMinutes,
              calculateEarlyExitMinutes(r.checkOutTime),
              r.workHours,
              calculateOvertimeHours(r.workHours),
              r.status,
            ].join(',')
          ),
        ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Median-Attendance-Register-${historyMonth || todayDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportHistoryPdf = () => {
    if (historyLayout === 'grid' && filteredRegister) {
      downloadMonthlyRegisterPdf(filteredRegister);
      return;
    }
    downloadPdfReport({
      filename: `Median-Attendance-Log-${historyMonth || todayDate}.pdf`,
      title: 'Median Asset & HR Suite - Attendance History Report',
      subtitle: `Generated ${todayDate} · Scope: ${session?.role}`,
      headers: ['ID', 'Employee', 'Dept', 'Date', 'In', 'Out', 'Late', 'Early', 'Hrs', 'OT', 'Status'],
      rows: filteredHistory.map((r) => [
        r.employeeCode || r.employeeId,
        r.employeeName || r.employeeId,
        r.department || '-',
        r.attendanceDate,
        r.checkInTime || '-',
        r.checkOutTime || '-',
        `${r.lateMinutes}m`,
        `${calculateEarlyExitMinutes(r.checkOutTime)}m`,
        r.workHours,
        `${calculateOvertimeHours(r.workHours)}h`,
        r.status,
      ]),
    });
  };

  const tabs: Array<{ id: AttendanceSubTab; label: string; show: boolean }> = [
    { id: 'dashboard', label: 'Dashboard & Check-In', show: true },
    { id: 'calendar', label: 'Team Calendar', show: true },
    { id: 'requests', label: 'Requests & Approvals', show: true },
    { id: 'history', label: 'Monthly Register', show: true },
    { id: 'daily-report', label: 'Daily Report', show: canReport },
    { id: 'monthly-report', label: 'Monthly Report', show: canReport },
    { id: 'late-arrivals', label: 'Late Arrivals', show: true },
    { id: 'leaves', label: 'Leave Tracking', show: true },
    { id: 'audit-logs', label: 'Audit Logs', show: canViewAudit },
  ];

  return (
    <div className="space-y-4 pb-10">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Attendance Management</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {isOrgWide
              ? 'Organization-wide employee check-in, team calendar, leave & workflow approvals'
              : isDeptManager
              ? `Department-scoped attendance & correction approvals (${session?.department || 'Department'})`
              : 'Personal check-in, team calendar, WFH/regularization requests & leave records'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canCreate && (isOrgWide || isDeptManager) && (
            <button
              type="button"
              onClick={() => setManualModalOpen(true)}
              className={`${palette.primaryBtn} ${palette.primaryBtnHover} px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer`}
            >
              <Plus className="w-3.5 h-3.5" /> Log Manual Entry
            </button>
          )}
          {canManageHolidays && (
            <button
              type="button"
              onClick={() => setHolidayModalOpen(true)}
              className="bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-emerald-700" /> Publish Holiday
            </button>
          )}
          {canCreate && (
            <button
              type="button"
              onClick={() => setLeaveModalOpen(true)}
              className="bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer"
            >
              <CalendarDays className="w-3.5 h-3.5" /> Request Leave
            </button>
          )}
        </div>
      </div>

      {/* Sub-Navigation */}
      <div className={`flex flex-wrap gap-1.5 bg-white dark:bg-slate-900 p-2 rounded-xl border ${palette.border} dark:border-slate-800 shadow-sm`}>
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                subTab === t.id
                  ? `${palette.primaryBtn} shadow-sm`
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
      </div>

      {loading && !stats ? (
        <div className={`bg-white dark:bg-slate-900 p-10 rounded-xl border ${palette.border} dark:border-slate-800 text-center text-xs text-slate-500`}>
          Loading attendance records...
        </div>
      ) : null}

      {/* =================================================================== */}
      {/* TAB 1: DASHBOARD & CHECK-IN / CHECK-OUT                             */}
      {/* =================================================================== */}
      {subTab === 'dashboard' && (
        <div className="space-y-4">
          {/* Check-In / Check-Out Action Panel */}
          {canCreate && (
            <div className={`bg-white dark:bg-slate-900 rounded-xl border ${palette.border} dark:border-slate-800 shadow-sm p-5`}>
              <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-emerald-700" />
                    <h2 className="text-sm font-extrabold text-slate-900">
                      Daily Check-In / Check-Out ({todayDate})
                    </h2>
                  </div>
                  <p className="text-xs text-slate-500">
                    Standard shift starts at <strong>09:30</strong>. Check-ins after 09:30 are
                    automatically flagged as <strong>Late</strong>.
                  </p>
                  {todayMyRecord ? (
                    <div className="pt-1 flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={`px-2 py-0.5 rounded font-bold text-[10px] border ${statusBadgeClass(
                          todayMyRecord.status
                        )}`}
                      >
                        {todayMyRecord.status}
                      </span>
                      <span className="text-slate-700 font-semibold">
                        In: {todayMyRecord.checkInTime || '—'}
                      </span>
                      <span className="text-slate-700 font-semibold">
                        Out: {todayMyRecord.checkOutTime || 'Active shift'}
                      </span>
                      {todayMyRecord.lateMinutes > 0 && (
                        <span className="text-amber-700 font-semibold">
                          ({todayMyRecord.lateMinutes}m late)
                        </span>
                      )}
                      {todayMyRecord.workHours > 0 && (
                        <span className="text-emerald-700 font-semibold">
                          · {todayMyRecord.workHours} hrs
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs font-medium text-slate-600 pt-1">
                      Not checked in yet for today ({todayDate}).
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap lg:flex-nowrap items-center gap-2 xl:shrink-0">
                  {isOrgWide && employees.length > 0 && (
                    <select
                      aria-label="Select employee for check-in/out"
                      value={effectiveTargetEmpId}
                      onChange={(e) => setSelectedEmpId(e.target.value)}
                      className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none max-w-[210px]"
                    >
                      {employees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.name} ({emp.employeeId})
                        </option>
                      ))}
                    </select>
                  )}

                  <input
                    type="text"
                    aria-label="Attendance remarks"
                    value={checkRemarks}
                    onChange={(e) => setCheckRemarks(e.target.value)}
                    placeholder="Optional remarks..."
                    className="w-full sm:w-40 px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />

                  <button
                    type="button"
                    disabled={checkSubmitting || Boolean(todayMyRecord?.checkInTime)}
                    onClick={handleCheckIn}
                    className="px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    <span>Check In</span>
                  </button>

                  <button
                    type="button"
                    disabled={
                      checkSubmitting ||
                      !todayMyRecord?.checkInTime ||
                      Boolean(todayMyRecord?.checkOutTime)
                    }
                    onClick={handleCheckOut}
                    className="px-3.5 py-2 bg-[#3f3f46] hover:bg-[#27272a] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Check Out</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* KPI Cards */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Staff in Scope
                </p>
                <p className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1 tabular-nums">
                  {stats.totalEmployeesInScope}
                </p>
              </div>
              <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Present Today
                </p>
                <p className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-400 mt-1 tabular-nums">
                  {stats.presentToday}
                </p>
              </div>
              <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Late Arrivals
                </p>
                <p className="text-2xl font-extrabold text-amber-600 dark:text-amber-400 mt-1 tabular-nums">
                  {stats.lateToday}
                </p>
              </div>
              <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  On Leave Today
                </p>
                <p className="text-2xl font-extrabold text-sky-700 dark:text-sky-400 mt-1 tabular-nums">
                  {stats.onLeaveToday}
                </p>
              </div>
              <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Attendance Rate
                </p>
                <p className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1 tabular-nums">
                  {stats.totalEmployeesInScope > 0
                    ? Math.round((stats.presentToday / stats.totalEmployeesInScope) * 100)
                    : 0}
                  %
                </p>
              </div>
              <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Pending Leaves
                </p>
                <p className="text-2xl font-extrabold text-rose-700 dark:text-rose-400 mt-1 tabular-nums">
                  {stats.pendingLeaves}
                </p>
              </div>
            </div>
          )}

          {/* Chart + Recent Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-3">
                7-Day Attendance Breakdown
              </h3>
              <div className="h-60">
                <canvas ref={trendCanvasRef} />
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                  Recent Logs
                </h3>
                <button
                  type="button"
                  onClick={() => setSubTab('history')}
                  className="text-[11px] font-semibold text-emerald-700 hover:underline cursor-pointer"
                >
                  View All
                </button>
              </div>
              <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
                {records.slice(0, 6).map((r) => (
                  <div key={r.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <p className="font-bold text-slate-800 truncate">{r.employeeName}</p>
                      <p className="text-[10px] text-slate-500 tabular-nums">
                        {r.attendanceDate} · In {r.checkInTime || '—'} · Out {r.checkOutTime || '—'}
                      </p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded font-bold text-[9px] border shrink-0 ${statusBadgeClass(
                        r.status
                      )}`}
                    >
                      {r.status}
                    </span>
                  </div>
                ))}
                {records.length === 0 && (
                  <p className="text-xs text-slate-400 py-6 text-center">No attendance logs yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 1B: TEAM CALENDAR (APPROVED LEAVES & PUBLIC HOLIDAYS)           */}
      {/* =================================================================== */}
      {subTab === 'calendar' && (
        <div className="space-y-4" data-testid="attendance-team-calendar">
          <div className={`bg-white dark:bg-slate-900 rounded-xl border ${palette.border} dark:border-slate-800 shadow-sm p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3`}>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => shiftCalendarMonth(-1)}
                className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <input
                type="month"
                aria-label="Calendar month"
                value={calendarMonth}
                onChange={(e) => {
                  if (e.target.value) {
                    setCalendarMonth(e.target.value);
                    setSelectedCalDate(`${e.target.value}-01`);
                  }
                }}
                className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-bold text-slate-800 dark:text-slate-100"
              />
              <button
                type="button"
                aria-label="Next month"
                onClick={() => shiftCalendarMonth(1)}
                className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              {departments.length > 0 && (
                <select
                  aria-label="Filter calendar by department"
                  value={calendarDept}
                  onChange={(e) => setCalendarDept(e.target.value)}
                  className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs"
                >
                  <option value="">All Departments</option>
                  {departments.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              )}

              <SearchableCenterSelect
                centers={centerRecords}
                value={calendarCenter}
                onChange={setCalendarCenter}
                includeAllOption
                allOptionLabel="All Centers"
                ariaLabel="Filter calendar by center"
                className="min-w-[210px]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 tabular-nums">
              <span>
                Holidays:{' '}
                <strong className="text-amber-800">{calendarData.totalHolidaysInMonth}</strong>
              </span>
              <span className="text-slate-300">·</span>
              <span>
                Approved Leave Days:{' '}
                <strong className="text-sky-700">
                  {calendarData.totalApprovedLeaveDaysInMonth}
                </strong>
              </span>
              <span className="text-slate-300">·</span>
              <span>
                On Leave Today: <strong className="text-slate-900">{stats?.onLeaveToday ?? 0}</strong>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
            <div className={`xl:col-span-3 bg-white dark:bg-slate-900 rounded-xl border ${palette.border} dark:border-slate-800 shadow-sm overflow-hidden`}>
              <div className={`grid grid-cols-7 ${palette.surfaceBg} dark:bg-slate-800 border-b ${palette.border} dark:border-slate-700 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 text-center`}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                  <div key={day} className="py-2.5 border-r last:border-r-0 border-slate-200 dark:border-slate-700">
                    {day}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 divide-x divide-y divide-slate-100">
                {Array.from({ length: calendarData.leadingEmptySlots }).map((_, idx) => (
                  <div key={`empty-${idx}`} className="min-h-[96px] bg-slate-50/50" />
                ))}
                {calendarData.days.map((cell) => {
                  const isToday = cell.date === todayDate;
                  const isSelected = selectedDayCell?.date === cell.date;
                  return (
                    <button
                      key={cell.date}
                      type="button"
                      onClick={() => setSelectedCalDate(cell.date)}
                      className={`min-h-[96px] p-2 text-left align-top transition-colors cursor-pointer flex flex-col gap-1 ${
                        isSelected
                          ? 'bg-blue-50/60 dark:bg-blue-950/30 ring-2 ring-inset ring-blue-500'
                          : cell.isWeekend
                          ? 'bg-slate-50/70 hover:bg-slate-100/70'
                          : 'bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span
                          className={`text-xs font-bold tabular-nums ${
                            isToday
                              ? 'px-1.5 py-0.5 rounded bg-emerald-700 text-white'
                              : cell.isWeekend
                              ? 'text-slate-400'
                              : 'text-slate-800'
                          }`}
                        >
                          {cell.dayOfMonth}
                        </span>
                        {(cell.holidays.length > 0 || cell.approvedLeaves.length > 0) && (
                          <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                            {cell.holidays.length + cell.approvedLeaves.length}
                          </span>
                        )}
                      </div>

                      {cell.holidays.map((h) => (
                        <div
                          key={h.id}
                          className="w-full px-1.5 py-0.5 rounded bg-amber-100 border border-amber-300 text-[10px] font-bold text-amber-900 truncate"
                          title={`${h.title} (${h.center})`}
                        >
                          Holiday: {h.title}
                        </div>
                      ))}

                      {cell.approvedLeaves.slice(0, 2).map((lv) => (
                        <div
                          key={lv.id}
                          className="w-full px-1.5 py-0.5 rounded bg-sky-50 border border-sky-200 text-[10px] font-semibold text-sky-900 truncate"
                          title={`${lv.employeeName || lv.employeeId} · ${lv.leaveType}`}
                        >
                          {lv.employeeName || lv.employeeCode || lv.employeeId} ({lv.leaveType})
                        </div>
                      ))}
                      {cell.approvedLeaves.length > 2 && (
                        <span className="text-[10px] font-semibold text-sky-700">
                          +{cell.approvedLeaves.length - 2} more
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Day Planning Details
                  </p>
                  <h3 className="text-sm font-extrabold text-slate-900 tabular-nums">
                    {selectedDayCell?.date || selectedCalDate}
                  </h3>
                </div>
                {canManageHolidays && (
                  <button
                    type="button"
                    onClick={() => setHolidayModalOpen(true)}
                    className="text-[11px] font-bold text-emerald-700 hover:underline cursor-pointer"
                  >
                    + Add Holiday
                  </button>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
                  Public Holidays ({selectedDayCell?.holidays.length || 0})
                </p>
                {selectedDayCell && selectedDayCell.holidays.length > 0 ? (
                  selectedDayCell.holidays.map((h) => (
                    <div
                      key={h.id}
                      className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs space-y-1"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-bold text-amber-950">{h.title}</span>
                          {h.isNational && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-200/80 text-amber-950 text-[9px] font-bold uppercase">
                              National
                            </span>
                          )}
                        </div>
                        {canManageHolidays && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              aria-label={`Edit holiday ${h.title}`}
                              onClick={() => setEditingHoliday(h)}
                              className="text-amber-800 hover:text-amber-950 cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete holiday ${h.title}`}
                              onClick={() => handleDeleteHoliday(h)}
                              className="text-rose-700 hover:text-rose-900 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                      <p className="text-[11px] text-amber-900 flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> {h.center}
                      </p>
                      {h.description && (
                        <p className="text-[11px] text-slate-600">{h.description}</p>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-400">No public holidays on this date.</p>
                )}
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-100">
                <p className="text-[10px] font-bold uppercase tracking-wider text-sky-800">
                  Approved Leaves ({selectedDayCell?.approvedLeaves.length || 0})
                </p>
                {selectedDayCell && selectedDayCell.approvedLeaves.length > 0 ? (
                  selectedDayCell.approvedLeaves.map((lv) => (
                    <div
                      key={lv.id}
                      className="p-2.5 rounded-lg bg-sky-50 border border-sky-200 text-xs space-y-0.5"
                    >
                      <p className="font-bold text-slate-900">
                        {lv.employeeName || lv.employeeId}
                      </p>
                      <p className="text-[11px] text-sky-900">
                        {lv.leaveType} Leave · {lv.department || 'Team'}
                      </p>
                      <p className="text-[10px] font-mono text-slate-500 tabular-nums">
                        {lv.startDate} → {lv.endDate} ({lv.days}d)
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-400">No approved team leaves on this date.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 1C: WORKFLOW REQUESTS & APPROVALS (REGULARIZATION, WFH, PROFILE)*/}
      {/* =================================================================== */}
      {subTab === 'requests' && (
        <div className="bg-white rounded-xl border border-[#fef08a] shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-extrabold text-slate-900">
                Attendance Regularization, WFH &amp; Profile Change Requests
              </h2>
              <p className="text-[11px] text-slate-500">
                Requests automatically notify the employee&apos;s Reporting Manager with Approve/Reject links
              </p>
            </div>
            {canCreate && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRegModalOpen(true)}
                  className="px-3 py-1.5 bg-[#fef9c3] hover:bg-[#fef08a] text-[#854d0e] border border-[#fef08a] rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Clock className="w-3.5 h-3.5" /> Submit Regularization
                </button>
                <button
                  type="button"
                  onClick={() => setWfhModalOpen(true)}
                  className={`${palette.primaryBtn} ${palette.primaryBtnHover} px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer`}
                >
                  <Home className="w-3.5 h-3.5" /> Request WFH
                </button>
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Employee &amp; Center</th>
                  <th className="px-4 py-3">Reporting Manager</th>
                  <th className="px-4 py-3">Date / Window</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {workflowRequests.map((reqItem) => (
                  <tr key={reqItem.id} className="hover:bg-slate-50 align-top">
                    <td className="px-4 py-3 whitespace-nowrap font-bold text-slate-800 uppercase text-[10px]">
                      {reqItem.requestType === 'wfh'
                        ? 'Work From Home'
                        : reqItem.requestType === 'regularization'
                        ? 'Regularization'
                        : 'Profile Change'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-bold text-slate-900 block">
                        {reqItem.employeeName || reqItem.employeeId}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500">
                        {reqItem.employeeCode || reqItem.employeeId} · {reqItem.center || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-slate-800 block">
                        {reqItem.reportingManagerName || '—'}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {reqItem.reportingManagerEmail || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700 whitespace-nowrap tabular-nums">
                      <span>{reqItem.targetDate}</span>
                      {reqItem.endDate && reqItem.endDate !== reqItem.targetDate && (
                        <span> → {reqItem.endDate}</span>
                      )}
                      {reqItem.requestedCheckIn && (
                        <span className="block text-[10px] text-slate-500">
                          {reqItem.requestedCheckIn} – {reqItem.requestedCheckOut || '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 max-w-xs">{reqItem.reason}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded font-bold text-[10px] border ${statusBadgeClass(
                          reqItem.status
                        )}`}
                      >
                        {reqItem.status}
                      </span>
                      {reqItem.reviewedBy && (
                        <span className="block text-[10px] text-slate-400 mt-1">
                          by {reqItem.reviewedBy}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap space-x-1">
                      <button
                        type="button"
                        aria-label={`Send email for workflow request ${reqItem.id}`}
                        title="Send email notification"
                        onClick={() => void handleSendEntityMail('workflow_request', reqItem.id)}
                        className="inline-flex items-center justify-center w-7 h-7 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 cursor-pointer align-middle"
                      >
                        <Mail className="w-3.5 h-3.5" />
                      </button>
                      {canReviewWorkflows && reqItem.status === 'Pending' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleReviewWorkflow(reqItem, 'Approved')}
                            className="px-2 py-1 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer align-middle"
                          >
                            <CheckCircle2 className="w-3 h-3" /> Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReviewWorkflow(reqItem, 'Rejected')}
                            className="px-2 py-1 rounded bg-rose-100 hover:bg-rose-200 text-rose-800 text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer align-middle"
                          >
                            <XCircle className="w-3 h-3" /> Reject
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {workflowRequests.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                      No regularization, WFH, or profile change requests submitted yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 2: MONTHLY ATTENDANCE REGISTER & DETAILED PUNCH LOG             */}
      {/* =================================================================== */}
      {subTab === 'history' && (
        <div className="space-y-4" data-testid="monthly-attendance-register">
          {/* Summary KPI Strip */}
          {filteredRegister && (
            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2.5">
              <div className={`bg-white dark:bg-slate-900 p-3 rounded-xl border ${palette.border} dark:border-slate-800 shadow-sm`}>
                <p className="text-[10px] font-bold uppercase text-slate-400">Staff</p>
                <p className="text-lg font-extrabold text-slate-900 dark:text-white tabular-nums">
                  {filteredRegister.summary.totalEmployees}
                </p>
              </div>
              <div className={`bg-white dark:bg-slate-900 p-3 rounded-xl border ${palette.border} dark:border-slate-800 shadow-sm`}>
                <p className="text-[10px] font-bold uppercase text-slate-400">Present Days</p>
                <p className="text-lg font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums">
                  {filteredRegister.summary.totalPresentDays}
                </p>
              </div>
              <div className={`bg-white dark:bg-slate-900 p-3 rounded-xl border ${palette.border} dark:border-slate-800 shadow-sm`}>
                <p className="text-[10px] font-bold uppercase text-slate-400">Late (&gt;09:30)</p>
                <p className="text-lg font-extrabold text-amber-600 tabular-nums">
                  {filteredRegister.summary.totalLateArrivals}
                </p>
              </div>
              <div className={`bg-white dark:bg-slate-900 p-3 rounded-xl border ${palette.border} dark:border-slate-800 shadow-sm`}>
                <p className="text-[10px] font-bold uppercase text-slate-400">Early Exit (&lt;18:00)</p>
                <p className="text-lg font-extrabold text-orange-600 tabular-nums">
                  {filteredRegister.summary.totalEarlyExits}
                </p>
              </div>
              <div className={`bg-white dark:bg-slate-900 p-3 rounded-xl border ${palette.border} dark:border-slate-800 shadow-sm`}>
                <p className="text-[10px] font-bold uppercase text-slate-400">Leaves</p>
                <p className="text-lg font-extrabold text-sky-700 dark:text-sky-400 tabular-nums">
                  {filteredRegister.summary.totalLeaveDays}
                </p>
              </div>
              <div className={`bg-white dark:bg-slate-900 p-3 rounded-xl border ${palette.border} dark:border-slate-800 shadow-sm`}>
                <p className="text-[10px] font-bold uppercase text-slate-400">Holidays</p>
                <p className="text-lg font-extrabold text-violet-700 dark:text-violet-400 tabular-nums">
                  {filteredRegister.summary.totalHolidays}
                </p>
              </div>
              <div className={`bg-white dark:bg-slate-900 p-3 rounded-xl border ${palette.border} dark:border-slate-800 shadow-sm`}>
                <p className="text-[10px] font-bold uppercase text-slate-400">Work Hours</p>
                <p className="text-lg font-extrabold text-slate-900 dark:text-white tabular-nums">
                  {filteredRegister.summary.totalWorkHours}h
                </p>
              </div>
              <div className={`bg-white dark:bg-slate-900 p-3 rounded-xl border ${palette.border} dark:border-slate-800 shadow-sm`}>
                <p className="text-[10px] font-bold uppercase text-slate-400">Overtime (&gt;8h)</p>
                <p className="text-lg font-extrabold text-indigo-700 dark:text-indigo-400 tabular-nums">
                  {filteredRegister.summary.totalOvertimeHours}h
                </p>
              </div>
            </div>
          )}

          <div className={`bg-white dark:bg-slate-900 rounded-xl border ${palette.border} dark:border-slate-800 shadow-sm overflow-hidden`}>
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 no-print">
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg border border-slate-300 dark:border-slate-700 overflow-hidden">
                  <button
                    type="button"
                    data-testid="register-layout-grid-btn"
                    onClick={() => setHistoryLayout('grid')}
                    className={`px-3 py-1.5 text-xs font-bold flex items-center gap-1 cursor-pointer ${
                      historyLayout === 'grid'
                        ? palette.primaryBtn
                        : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <LayoutGrid className="w-3.5 h-3.5" /> Register Grid
                  </button>
                  <button
                    type="button"
                    data-testid="register-layout-log-btn"
                    onClick={() => setHistoryLayout('log')}
                    className={`px-3 py-1.5 text-xs font-bold flex items-center gap-1 cursor-pointer ${
                      historyLayout === 'log'
                        ? palette.primaryBtn
                        : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <List className="w-3.5 h-3.5" /> Detailed Log
                  </button>
                </div>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    aria-label="Search attendance history"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder="Search staff, code, dept..."
                    className="w-48 pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs dark:text-slate-100 focus:outline-none"
                  />
                </div>
                <input
                  type="month"
                  aria-label="Filter by month"
                  value={historyMonth}
                  onChange={(e) => setHistoryMonth(e.target.value || getCurrentMonthStr())}
                  className="px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs dark:text-slate-100"
                />
                <select
                  aria-label="Filter by attendance status"
                  value={historyStatus}
                  onChange={(e) => setHistoryStatus(e.target.value)}
                  className="px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs dark:text-slate-100"
                >
                  <option value="">All Statuses</option>
                  <option value="Present">Present</option>
                  <option value="Late">Late</option>
                  <option value="Absent">Absent</option>
                  <option value="Half Day">Half Day</option>
                  <option value="On Leave">On Leave</option>
                </select>
                {isOrgWide && (
                  <select
                    aria-label="Filter by department"
                    value={deptFilter}
                    onChange={(e) => setDeptFilter(e.target.value)}
                    className="px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs dark:text-slate-100"
                  >
                    <option value="">All Departments</option>
                    {departments.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" /> Print
                </button>
                {canExport && (
                  <>
                    <button
                      type="button"
                      onClick={exportHistoryExcel}
                      className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" /> Excel
                    </button>
                    <button
                      type="button"
                      onClick={exportHistoryCsv}
                      className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 text-blue-700" /> CSV
                    </button>
                    <button
                      type="button"
                      onClick={exportHistoryPdf}
                      className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5 text-rose-700" /> PDF
                    </button>
                  </>
                )}
              </div>
            </div>

            {historyLayout === 'grid' && (
              <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-3 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                <span className="font-bold uppercase tracking-wider text-slate-500">Legend:</span>
                {[
                  ['P', 'Present'],
                  ['L', 'Late (>09:30)'],
                  ['HD', 'Half Day'],
                  ['LV', 'Leave'],
                  ['H', 'Holiday'],
                  ['WO', 'Week Off'],
                  ['A', 'Absent'],
                ].map(([code, label]) => (
                  <span key={code} className="inline-flex items-center gap-1">
                    <span
                      className={`px-1.5 py-0.5 rounded border font-bold text-[9px] ${registerCodeBadgeClass(
                        code
                      )}`}
                    >
                      {code}
                    </span>
                    <span>{label}</span>
                  </span>
                ))}
              </div>
            )}

            {historyLayout === 'grid' ? (
              <div className="overflow-x-auto">
                {registerLoading && !filteredRegister ? (
                  <div className="py-10 text-center text-xs text-slate-400">
                    Generating Monthly Attendance Register...
                  </div>
                ) : filteredRegister ? (
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead>
                      <tr className={`${palette.surfaceBg} dark:bg-slate-800 border-b ${palette.border} dark:border-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider`}>
                        <th className="px-3 py-2.5 sticky left-0 z-10 bg-slate-100 dark:bg-slate-800 min-w-[170px] border-r border-slate-200 dark:border-slate-700">
                          Staff Member
                        </th>
                        {filteredRegister.dates.map((d) => (
                          <th key={d} className="px-1 py-2.5 text-center min-w-[28px] tabular-nums">
                            {d.slice(-2)}
                          </th>
                        ))}
                        <th className="px-2 py-2.5 text-center border-l border-slate-200 dark:border-slate-700">P</th>
                        <th className="px-2 py-2.5 text-center">L</th>
                        <th className="px-2 py-2.5 text-center">Early</th>
                        <th className="px-2 py-2.5 text-center">Lv</th>
                        <th className="px-2 py-2.5 text-center">Hol</th>
                        <th className="px-2 py-2.5 text-center">Abs</th>
                        <th className="px-2 py-2.5 text-right">Hrs</th>
                        <th className="px-2 py-2.5 text-right">OT</th>
                        <th className="px-2 py-2.5 text-right">Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredRegister.rows.map((row) => (
                        <tr key={row.employeeId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="px-3 py-2 sticky left-0 z-10 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700">
                            <span className="font-bold text-slate-900 dark:text-white block truncate max-w-[160px]">
                              {row.employeeName}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400">
                              {row.employeeCode} · {row.department}
                            </span>
                          </td>
                          {filteredRegister.dates.map((d) => {
                            const entry = row.days[d];
                            const code = entry?.code || '—';
                            const tip = entry
                              ? `${d}: ${code}${entry.checkInTime ? ` | In ${entry.checkInTime}` : ''}${
                                  entry.checkOutTime ? ` | Out ${entry.checkOutTime}` : ''
                                }${entry.lateMinutes > 0 ? ` | Late ${entry.lateMinutes}m` : ''}${
                                  entry.earlyExitMinutes > 0
                                    ? ` | Early Exit ${entry.earlyExitMinutes}m`
                                    : ''
                                }${entry.overtimeHours > 0 ? ` | OT ${entry.overtimeHours}h` : ''}${
                                  entry.holidayName ? ` | ${entry.holidayName}` : ''
                                }`
                              : d;
                            return (
                              <td key={d} className="px-0.5 py-1.5 text-center">
                                <span
                                  title={tip}
                                  className={`inline-block min-w-[22px] px-1 py-0.5 rounded border font-bold text-[9px] tabular-nums ${registerCodeBadgeClass(
                                    code
                                  )}`}
                                >
                                  {code}
                                </span>
                              </td>
                            );
                          })}
                          <td className="px-2 py-2 text-center font-bold text-emerald-700 border-l border-slate-200 dark:border-slate-700 tabular-nums">
                            {row.presentDays}
                          </td>
                          <td className="px-2 py-2 text-center font-bold text-amber-600 tabular-nums">
                            {row.lateDays}
                          </td>
                          <td className="px-2 py-2 text-center font-semibold text-orange-600 tabular-nums">
                            {row.earlyExitCount}
                          </td>
                          <td className="px-2 py-2 text-center font-semibold text-sky-700 tabular-nums">
                            {row.leaveDays}
                          </td>
                          <td className="px-2 py-2 text-center font-semibold text-violet-700 tabular-nums">
                            {row.holidayDays}
                          </td>
                          <td className="px-2 py-2 text-center font-semibold text-rose-700 tabular-nums">
                            {row.absentDays}
                          </td>
                          <td className="px-2 py-2 text-right font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                            {row.totalWorkHours}h
                          </td>
                          <td className="px-2 py-2 text-right font-semibold text-indigo-700 dark:text-indigo-400 tabular-nums">
                            {row.overtimeHours}h
                          </td>
                          <td className="px-2 py-2 text-right font-extrabold text-slate-900 dark:text-white tabular-nums">
                            {row.attendanceRatePct}%
                          </td>
                        </tr>
                      ))}
                      {filteredRegister.rows.length === 0 && (
                        <tr>
                          <td
                            colSpan={filteredRegister.dates.length + 10}
                            className="px-4 py-8 text-center text-slate-400"
                          >
                            No attendance register rows match the selected filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                ) : (
                  <div className="py-10 text-center text-xs text-slate-400">
                    Monthly register unavailable.
                  </div>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className={`${palette.surfaceBg} dark:bg-slate-800 border-b ${palette.border} dark:border-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider`}>
                      <th className="px-4 py-3">Employee</th>
                      <th className="px-4 py-3">Department</th>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Check In</th>
                      <th className="px-4 py-3">Check Out</th>
                      <th className="px-4 py-3">Late</th>
                      <th className="px-4 py-3">Early Exit</th>
                      <th className="px-4 py-3">Hours</th>
                      <th className="px-4 py-3">Overtime</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Remarks</th>
                      {(canEdit || canDelete) && <th className="px-4 py-3 text-right no-print">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                    {filteredHistory.map((rec) => {
                      const earlyMins = calculateEarlyExitMinutes(rec.checkOutTime);
                      const otHours = calculateOvertimeHours(rec.workHours);
                      return (
                        <tr key={rec.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="px-4 py-2.5">
                            <span className="font-bold text-slate-900 dark:text-white block">
                              {rec.employeeName}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400">
                              {rec.employeeCode}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                            {rec.department || '—'}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-slate-700 dark:text-slate-200 tabular-nums">
                            {rec.attendanceDate}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums text-slate-700 dark:text-slate-200">
                            {rec.checkInTime || '—'}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums text-slate-700 dark:text-slate-200">
                            {rec.checkOutTime || '—'}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums">
                            {rec.lateMinutes > 0 ? (
                              <span className="text-amber-700 font-semibold">{rec.lateMinutes}m</span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums">
                            {earlyMins > 0 ? (
                              <span className="text-orange-600 font-semibold">{earlyMins}m</span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums font-semibold text-slate-700 dark:text-slate-200">
                            {rec.workHours > 0 ? `${rec.workHours}h` : '—'}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums">
                            {otHours > 0 ? (
                              <span className="text-indigo-700 dark:text-indigo-400 font-semibold">
                                +{otHours}h
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <span
                              className={`px-2 py-0.5 rounded font-bold text-[9px] border ${statusBadgeClass(
                                rec.status
                              )}`}
                            >
                              {rec.status}
                            </span>
                            {rec.correctionStatus === 'Approved' && (
                              <span className="ml-1 text-[9px] text-emerald-700 font-semibold">
                                (Approved)
                              </span>
                            )}
                          </td>
                          <td
                            className="px-4 py-2.5 text-slate-500 max-w-[180px] truncate"
                            title={rec.remarks}
                          >
                            {rec.remarks || '—'}
                          </td>
                          {(canEdit || canDelete) && (
                            <td className="px-4 py-2.5 text-right whitespace-nowrap space-x-1 no-print">
                              {canEdit && (
                                <button
                                  type="button"
                                  aria-label={`Edit attendance for ${rec.employeeName} on ${rec.attendanceDate}`}
                                  title="Edit / Approve Correction"
                                  onClick={() => setEditingRecord(rec)}
                                  className="w-7 h-7 rounded bg-orange-50 text-orange-700 hover:bg-orange-100 inline-flex items-center justify-center cursor-pointer"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {canDelete && (
                                <button
                                  type="button"
                                  aria-label={`Delete attendance for ${rec.employeeName} on ${rec.attendanceDate}`}
                                  title="Delete Record"
                                  onClick={() => handleDeleteRecord(rec)}
                                  className="w-7 h-7 rounded bg-rose-50 text-rose-700 hover:bg-rose-100 inline-flex items-center justify-center cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {filteredHistory.length === 0 && (
                      <tr>
                        <td colSpan={12} className="px-4 py-8 text-center text-slate-400">
                          No attendance records match the current filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 3: DAILY ATTENDANCE REPORT (attendance.report)                  */}
      {/* =================================================================== */}
      {subTab === 'daily-report' && canReport && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <CalendarCheck2 className="w-4 h-4 text-emerald-700" />
              <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">Daily Attendance Report</h2>
              <input
                type="date"
                aria-label="Daily report date"
                value={reportDate}
                onChange={(e) => setReportDate(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold dark:text-slate-100"
              />
              {isOrgWide && (
                <select
                  aria-label="Daily report department"
                  value={deptFilter}
                  onChange={(e) => setDeptFilter(e.target.value)}
                  className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs"
                >
                  <option value="">All Departments</option>
                  {departments.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {canExport && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    downloadExcelReport({
                      filename: `daily-attendance-${reportDate}.xls`,
                      sheetName: 'Daily Attendance',
                      headers: [
                        'Employee ID',
                        'Name',
                        'Department',
                        'Designation',
                        'Check In',
                        'Check Out',
                        'Late (m)',
                        'Work Hours',
                        'Status',
                        'Remarks',
                      ],
                      rows: dailyRows.map((r) => [
                        r.employeeCode,
                        r.employeeName,
                        r.department,
                        r.designation,
                        r.checkInTime || '—',
                        r.checkOutTime || '—',
                        r.lateMinutes,
                        r.workHours,
                        r.status,
                        r.remarks || '—',
                      ]),
                    })
                  }
                  className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" /> Export Excel
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadPdfReport({
                      filename: `daily-attendance-${reportDate}.pdf`,
                      title: `Daily Attendance Report (${reportDate})`,
                      subtitle: deptFilter ? `Department: ${deptFilter}` : 'All Accessible Staff',
                      headers: ['ID', 'Name', 'Dept', 'In', 'Out', 'Late', 'Hrs', 'Status'],
                      rows: dailyRows.map((r) => [
                        r.employeeCode,
                        r.employeeName,
                        r.department,
                        r.checkInTime || '-',
                        r.checkOutTime || '-',
                        `${r.lateMinutes}m`,
                        r.workHours,
                        r.status,
                      ]),
                    })
                  }
                  className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-rose-700" /> Export PDF
                </button>
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                  <th className="px-4 py-3">Employee ID</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Check In</th>
                  <th className="px-4 py-3">Check Out</th>
                  <th className="px-4 py-3">Late Mins</th>
                  <th className="px-4 py-3">Work Hours</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {dailyRows.map((row) => (
                  <tr key={row.employeeId} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono text-slate-600">{row.employeeCode}</td>
                    <td className="px-4 py-2.5 font-bold text-slate-900">{row.employeeName}</td>
                    <td className="px-4 py-2.5 text-slate-600">{row.department}</td>
                    <td className="px-4 py-2.5 tabular-nums">{row.checkInTime || '—'}</td>
                    <td className="px-4 py-2.5 tabular-nums">{row.checkOutTime || '—'}</td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {row.lateMinutes > 0 ? `${row.lateMinutes}m` : '—'}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums font-semibold">
                      {row.workHours > 0 ? `${row.workHours}h` : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`px-2 py-0.5 rounded font-bold text-[9px] border ${statusBadgeClass(
                          row.status
                        )}`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{row.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 4: MONTHLY ATTENDANCE REPORT (attendance.report)                */}
      {/* =================================================================== */}
      {subTab === 'monthly-report' && canReport && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <CalendarCheck2 className="w-4 h-4 text-emerald-700" />
              <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">Monthly Attendance Summary</h2>
              <input
                type="month"
                aria-label="Monthly report month"
                value={reportMonth}
                onChange={(e) => setReportMonth(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold dark:text-slate-100"
              />
              {isOrgWide && (
                <select
                  aria-label="Monthly report department"
                  value={deptFilter}
                  onChange={(e) => setDeptFilter(e.target.value)}
                  className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs"
                >
                  <option value="">All Departments</option>
                  {departments.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {canExport && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    downloadExcelReport({
                      filename: `monthly-attendance-${reportMonth}.xls`,
                      sheetName: 'Monthly Summary',
                      headers: [
                        'Employee ID',
                        'Name',
                        'Department',
                        'Present',
                        'Late',
                        'Half Day',
                        'On Leave',
                        'Absent',
                        'Late Mins',
                        'Total Hours',
                        'Attendance %',
                      ],
                      rows: monthlyRows.map((r) => [
                        r.employeeCode,
                        r.employeeName,
                        r.department,
                        r.presentDays,
                        r.lateDays,
                        r.halfDays,
                        r.leaveDays,
                        r.absentDays,
                        r.totalLateMinutes,
                        r.totalWorkHours,
                        `${r.attendanceRatePct}%`,
                      ]),
                    })
                  }
                  className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" /> Export Excel
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadPdfReport({
                      filename: `monthly-attendance-${reportMonth}.pdf`,
                      title: `Monthly Attendance Report (${reportMonth})`,
                      subtitle: deptFilter ? `Department: ${deptFilter}` : 'All Accessible Staff',
                      headers: ['ID', 'Name', 'Dept', 'Present', 'Late', 'Leave', 'Absent', 'Hrs', 'Rate'],
                      rows: monthlyRows.map((r) => [
                        r.employeeCode,
                        r.employeeName,
                        r.department,
                        r.presentDays,
                        r.lateDays,
                        r.leaveDays,
                        r.absentDays,
                        r.totalWorkHours,
                        `${r.attendanceRatePct}%`,
                      ]),
                    })
                  }
                  className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-rose-700" /> Export PDF
                </button>
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#fefce8] border-b border-[#fef08a] text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Dept</th>
                  <th className="px-4 py-3">Present</th>
                  <th className="px-4 py-3">Late</th>
                  <th className="px-4 py-3">Half Day</th>
                  <th className="px-4 py-3">On Leave</th>
                  <th className="px-4 py-3">Absent</th>
                  <th className="px-4 py-3">Late Mins</th>
                  <th className="px-4 py-3">Hours</th>
                  <th className="px-4 py-3">Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {monthlyRows.map((row) => (
                  <tr key={row.employeeId} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <span className="font-bold text-slate-900 block">{row.employeeName}</span>
                      <span className="text-[10px] font-mono text-slate-400">
                        {row.employeeCode}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{row.department}</td>
                    <td className="px-4 py-2.5 tabular-nums font-bold text-emerald-700">
                      {row.presentDays}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-amber-700 font-semibold">
                      {row.lateDays}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-600">{row.halfDays}</td>
                    <td className="px-4 py-2.5 tabular-nums text-sky-700">{row.leaveDays}</td>
                    <td className="px-4 py-2.5 tabular-nums text-rose-700">{row.absentDays}</td>
                    <td className="px-4 py-2.5 tabular-nums">{row.totalLateMinutes}m</td>
                    <td className="px-4 py-2.5 tabular-nums font-semibold">
                      {row.totalWorkHours}h
                    </td>
                    <td className="px-4 py-2.5 tabular-nums font-bold text-slate-900">
                      {row.attendanceRatePct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 5: LATE ARRIVAL TRACKING                                        */}
      {/* =================================================================== */}
      {subTab === 'late-arrivals' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClockAlert className="w-4 h-4 text-amber-600" />
              <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">
                Late Arrival Tracking ({lateRecords.length} incidents)
              </h2>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">Shift threshold: 09:30 AM</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Check In</th>
                  <th className="px-4 py-3">Delay</th>
                  <th className="px-4 py-3">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {lateRecords.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-bold text-slate-900">
                      {r.employeeName}{' '}
                      <span className="text-[10px] font-mono text-slate-400 font-normal">
                        ({r.employeeCode})
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{r.department || '—'}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums">{r.attendanceDate}</td>
                    <td className="px-4 py-2.5 font-semibold text-amber-700 tabular-nums">
                      {r.checkInTime || '—'}
                    </td>
                    <td className="px-4 py-2.5 font-bold text-rose-700 tabular-nums">
                      +{r.lateMinutes} mins
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{r.remarks || '—'}</td>
                  </tr>
                ))}
                {lateRecords.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                      No late arrivals recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 6: LEAVE TRACKING                                               */}
      {/* =================================================================== */}
      {subTab === 'leaves' && (
        <div className="space-y-4">
          {leaveBalances.length > 0 && (
            <div
              data-testid="leave-accrual-buckets"
              className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden"
            >
              <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-100">
                    Annual Leave Accrual Buckets ({new Date().getFullYear()})
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    +2/month Jan–Nov (Dec = 0) · Joined ≤15th accrues current month · Max Carry-Forward Cap: 44 · Excludes National &amp; Center Holidays
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                      <th className="px-4 py-2.5">Employee</th>
                      <th className="px-4 py-2.5">Joined</th>
                      <th className="px-4 py-2.5">Eligible Months</th>
                      <th className="px-4 py-2.5">Carry-Fwd</th>
                      <th className="px-4 py-2.5">Accrued YTD</th>
                      <th className="px-4 py-2.5">Approved Used</th>
                      <th className="px-4 py-2.5 text-right">Available Bucket</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs tabular-nums">
                    {leaveBalances.map((b) => (
                      <tr key={b.employeeId} className="hover:bg-slate-50">
                        <td className="px-4 py-2">
                          <span className="font-bold text-slate-900">{b.employeeName}</span>{' '}
                          <span className="text-[10px] font-mono text-slate-400">
                            ({b.employeeCode})
                          </span>
                        </td>
                        <td className="px-4 py-2 font-mono text-slate-600">{b.joiningDate || '—'}</td>
                        <td className="px-4 py-2 text-slate-700">
                          {b.monthlyBreakdown.filter((m) => m.accrued > 0).length} mo(s)
                        </td>
                        <td className="px-4 py-2 font-semibold text-slate-700">{b.carryForwardStart}</td>
                        <td className="px-4 py-2 font-semibold text-emerald-700">+{b.annualAccrued}</td>
                        <td className="px-4 py-2 font-semibold text-amber-700">-{b.approvedUsedDays}</td>
                        <td className="px-4 py-2 text-right font-extrabold text-slate-900">
                          {b.availableBalance} / {b.maxCap}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-sky-700" />
              <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">Leave Tracking</h2>
            </div>
            {canCreate && (
              <button
                type="button"
                onClick={() => setLeaveModalOpen(true)}
                className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Apply Leave
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Date Range</th>
                  <th className="px-4 py-3">Days</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Reporting Manager</th>
                  <th className="px-4 py-3">Status &amp; Remarks</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {leaves.map((lv) => {
                  const targetEmp = employees.find((e) => e.id === lv.employeeId);
                  const authCheck = session
                    ? canUserApproveLeave({
                        user: session,
                        leave: lv,
                        targetEmployee: targetEmp,
                        employees,
                      })
                    : { allowed: false, isOverride: false };

                  return (
                    <tr key={lv.id} className="hover:bg-slate-50 align-top">
                      <td className="px-4 py-2.5">
                        <span className="font-bold text-slate-900 block">{lv.employeeName}</span>
                        <span className="text-[10px] font-mono text-slate-400">
                          {lv.department} · {lv.employeeCode}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-semibold text-slate-700">{lv.leaveType}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-600 tabular-nums whitespace-nowrap">
                        {lv.startDate} → {lv.endDate}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums font-bold">{lv.days}d</td>
                      <td className="px-4 py-2.5 text-slate-600 max-w-[200px]" title={lv.reason}>
                        {lv.reason}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        <span className="font-semibold text-slate-800 block">
                          {lv.managerName || targetEmp?.reportingManagerName || '—'}
                        </span>
                        {lv.reviewedBy && (
                          <span className="text-[10px] text-slate-400">
                            Reviewed by {lv.reviewedBy}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 space-y-1">
                        <div className="flex flex-wrap items-center gap-1">
                          <span
                            className={`px-2 py-0.5 rounded font-bold text-[9px] border ${statusBadgeClass(
                              lv.status
                            )}`}
                          >
                            {lv.status}
                          </span>
                          {lv.overriddenBy && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[9px] font-bold">
                              Overridden ({lv.overriddenBy})
                            </span>
                          )}
                        </div>
                        {lv.reviewRemarks && (
                          <p className="text-[11px] text-slate-600 max-w-[220px]">
                            &ldquo;{lv.reviewRemarks}&rdquo;
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap space-x-1">
                        <button
                          type="button"
                          aria-label={`Send leave notification email for ${lv.employeeName}`}
                          title="Send leave notification email"
                          onClick={() => void handleSendEntityMail('leave', lv.id)}
                          className="inline-flex items-center justify-center w-7 h-7 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 cursor-pointer align-middle"
                        >
                          <Mail className="w-3.5 h-3.5" />
                        </button>
                        {authCheck.allowed && lv.status === 'Pending' && (
                          <>
                            <button
                              type="button"
                              aria-label={`Approve leave for ${lv.employeeName}`}
                              onClick={() => openLeaveDecisionModal(lv, 'Approved', false)}
                              className="px-2 py-1 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer align-middle"
                            >
                              <CheckCircle2 className="w-3 h-3" /> Approve
                            </button>
                            <button
                              type="button"
                              aria-label={`Reject leave for ${lv.employeeName}`}
                              onClick={() => openLeaveDecisionModal(lv, 'Rejected', false)}
                              className="px-2 py-1 rounded bg-rose-100 hover:bg-rose-200 text-rose-800 text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer align-middle"
                            >
                              <XCircle className="w-3 h-3" /> Reject
                            </button>
                          </>
                        )}
                        {authCheck.allowed && authCheck.isOverride && lv.status !== 'Pending' && (
                          <button
                            type="button"
                            aria-label={`Override leave decision for ${lv.employeeName}`}
                            onClick={() =>
                              openLeaveDecisionModal(
                                lv,
                                lv.status === 'Approved' ? 'Rejected' : 'Approved',
                                true
                              )
                            }
                            className="px-2 py-1 rounded bg-amber-100 hover:bg-amber-200 text-amber-900 text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer align-middle"
                          >
                            Override to {lv.status === 'Approved' ? 'Rejected' : 'Approved'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {leaves.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                      No leave records found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 7: AUDIT LOGS                                                   */}
      {/* =================================================================== */}
      {subTab === 'audit-logs' && canViewAudit && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
            <History className="w-4 h-4 text-slate-700 dark:text-slate-300" />
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">
              Attendance &amp; RBAC Audit Trail
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      {log.createdAt.replace('T', ' ').slice(0, 19)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200 font-mono text-[10px] font-bold">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-slate-800">{log.actorName}</td>
                    <td className="px-4 py-2.5 text-slate-700">{log.employeeName}</td>
                    <td className="px-4 py-2.5 text-slate-600">{log.details}</td>
                  </tr>
                ))}
                {auditLogs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                      No audit events recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* EDIT / APPROVE CORRECTION MODAL */}
      {editingRecord && canEdit && (
        <AttendanceEditModal
          record={editingRecord}
          headerClass={palette.modalHeader}
          primaryBtnClass={`${palette.primaryBtn} ${palette.primaryBtnHover}`}
          onClose={() => setEditingRecord(null)}
          onSaved={async () => {
            setEditingRecord(null);
            onNotify('Attendance correction saved and logged');
            await loadAllAttendanceData();
          }}
          onError={(msg) => onNotify(msg, 'error')}
        />
      )}

      {/* MANUAL ENTRY MODAL */}
      {manualModalOpen && canCreate && (
        <ManualAttendanceModal
          employees={employees}
          headerClass={palette.modalHeader}
          primaryBtnClass={`${palette.primaryBtn} ${palette.primaryBtnHover}`}
          defaultDate={todayDate}
          onClose={() => setManualModalOpen(false)}
          onSaved={async () => {
            setManualModalOpen(false);
            onNotify('Manual attendance entry saved');
            await loadAllAttendanceData();
          }}
          onError={(msg) => onNotify(msg, 'error')}
        />
      )}

      {/* LEAVE REQUEST MODAL */}
      {leaveModalOpen && canCreate && (
        <LeaveRequestModal
          employees={employees}
          lockedEmployeeId={isOrgWide || isDeptManager ? undefined : session?.employeeId}
          headerClass={palette.modalHeader}
          primaryBtnClass={`${palette.primaryBtn} ${palette.primaryBtnHover}`}
          defaultDate={todayDate}
          onClose={() => setLeaveModalOpen(false)}
          onSaved={async () => {
            setLeaveModalOpen(false);
            onNotify('Leave request submitted & Reporting Manager notified');
            await loadAllAttendanceData();
          }}
          onError={(msg) => onNotify(msg, 'error')}
        />
      )}

      {/* PUBLISH / EDIT PUBLIC HOLIDAY MODAL */}
      {(holidayModalOpen || editingHoliday) && canManageHolidays && (
        <HolidayFormModal
          centers={centerRecords}
          headerClass={palette.modalHeader}
          primaryBtnClass={`${palette.primaryBtn} ${palette.primaryBtnHover}`}
          defaultDate={selectedCalDate || todayDate}
          editingHoliday={editingHoliday}
          onClose={() => {
            setHolidayModalOpen(false);
            setEditingHoliday(null);
          }}
          onSaved={async (notifiedCount, isEdit) => {
            setHolidayModalOpen(false);
            setEditingHoliday(null);
            onNotify(
              isEdit
                ? 'Public holiday updated'
                : `Public holiday published · ${notifiedCount} staff notification(s) ready`
            );
            await loadAllAttendanceData();
          }}
          onError={(msg) => onNotify(msg, 'error')}
        />
      )}

      {/* LEAVE DECISION / REMARKS MODAL */}
      {leaveReviewModal && (
        <ModalShell
          title={`${leaveReviewModal.isOverride ? 'Admin Override: ' : ''}${
            leaveReviewModal.decision === 'Approved' ? 'Approve' : 'Reject'
          } Leave Request`}
          icon={
            leaveReviewModal.decision === 'Approved' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-400" />
            )
          }
          headerClass={palette.modalHeader}
          maxWidth="max-w-md"
          onClose={() => setLeaveReviewModal(null)}
        >
          <form onSubmit={handleConfirmReviewLeave} className="p-6 space-y-4 bg-white dark:bg-slate-900">
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs space-y-1">
              <p className="font-bold text-slate-900">
                {leaveReviewModal.leave.employeeName || leaveReviewModal.leave.employeeId} ·{' '}
                {leaveReviewModal.leave.leaveType} Leave
              </p>
              <p className="font-mono text-slate-600 tabular-nums">
                {leaveReviewModal.leave.startDate} → {leaveReviewModal.leave.endDate} (
                {leaveReviewModal.leave.days}d)
              </p>
              <p className="text-slate-600">Reason: {leaveReviewModal.leave.reason}</p>
            </div>
            <div>
              <label
                htmlFor="att-leave-review-remarks"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Review Remarks {leaveReviewModal.decision === 'Rejected' ? '*' : '(Optional)'}
              </label>
              <textarea
                id="att-leave-review-remarks"
                rows={3}
                required={leaveReviewModal.decision === 'Rejected'}
                value={leaveReviewRemarks}
                onChange={(e) => setLeaveReviewRemarks(e.target.value)}
                placeholder="Add approval or rejection remarks for employee visibility..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setLeaveReviewModal(null)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={leaveReviewSubmitting}
                className={`px-5 py-2 rounded-lg text-xs font-bold text-white cursor-pointer disabled:opacity-50 ${
                  leaveReviewModal.decision === 'Approved'
                    ? 'bg-emerald-700 hover:bg-emerald-800'
                    : 'bg-rose-700 hover:bg-rose-800'
                }`}
              >
                {leaveReviewSubmitting
                  ? 'Saving...'
                  : leaveReviewModal.isOverride
                  ? `Confirm Override (${leaveReviewModal.decision})`
                  : `Confirm ${leaveReviewModal.decision}`}
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {/* SUBMIT ATTENDANCE REGULARIZATION MODAL */}
      {regModalOpen && canCreate && (
        <RegularizationModal
          employees={employees}
          lockedEmployeeId={isOrgWide || isDeptManager ? undefined : session?.employeeId}
          headerClass={palette.modalHeader}
          primaryBtnClass={`${palette.primaryBtn} ${palette.primaryBtnHover}`}
          defaultDate={todayDate}
          onClose={() => setRegModalOpen(false)}
          onSaved={async () => {
            setRegModalOpen(false);
            onNotify('Attendance regularization submitted to Reporting Manager');
            await loadAllAttendanceData();
          }}
          onError={(msg) => onNotify(msg, 'error')}
        />
      )}

      {/* SUBMIT WFH REQUEST MODAL */}
      {wfhModalOpen && canCreate && (
        <WfhModal
          employees={employees}
          lockedEmployeeId={isOrgWide || isDeptManager ? undefined : session?.employeeId}
          headerClass={palette.modalHeader}
          primaryBtnClass={`${palette.primaryBtn} ${palette.primaryBtnHover}`}
          defaultDate={todayDate}
          onClose={() => setWfhModalOpen(false)}
          onSaved={async () => {
            setWfhModalOpen(false);
            onNotify('Work-From-Home request submitted to Reporting Manager');
            await loadAllAttendanceData();
          }}
          onError={(msg) => onNotify(msg, 'error')}
        />
      )}
    </div>
  );
};

const AttendanceEditModal: React.FC<{
  record: AttendanceRecord;
  headerClass: string;
  primaryBtnClass: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string) => void;
}> = ({ record, headerClass, primaryBtnClass, onClose, onSaved, onError }) => {
  const [status, setStatus] = useState<AttendanceStatus>(record.status);
  const [checkInTime, setCheckInTime] = useState(record.checkInTime || '');
  const [checkOutTime, setCheckOutTime] = useState(record.checkOutTime || '');
  const [remarks, setRemarks] = useState(record.remarks || '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiClient.updateAttendance(record.id, {
        status,
        checkInTime: checkInTime.trim() || null,
        checkOutTime: checkOutTime.trim() || null,
        remarks,
        correctionStatus: 'Approved',
      });
      await onSaved();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title={`Correct Attendance — ${record.employeeName} (${record.attendanceDate})`}
      icon={<ShieldCheck className="w-4 h-4 text-emerald-400" />}
      headerClass={headerClass}
      maxWidth="max-w-md"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-4 bg-white">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Check In (HH:MM)
            </label>
            <input
              type="time"
              value={checkInTime}
              onChange={(e) => setCheckInTime(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Check Out (HH:MM)
            </label>
            <input
              type="time"
              value={checkOutTime}
              onChange={(e) => setCheckOutTime(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Status
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as AttendanceStatus)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
          >
            <option value="Present">Present</option>
            <option value="Late">Late</option>
            <option value="Half Day">Half Day</option>
            <option value="Absent">Absent</option>
            <option value="On Leave">On Leave</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Correction Remarks
          </label>
          <textarea
            rows={2}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
          />
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className={`${primaryBtnClass} px-5 py-2 rounded-lg text-xs font-bold cursor-pointer`}
          >
            {saving ? 'Saving...' : 'Approve & Save Correction'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

const ManualAttendanceModal: React.FC<{
  employees: Employee[];
  headerClass: string;
  primaryBtnClass: string;
  defaultDate: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string) => void;
}> = ({ employees, headerClass, primaryBtnClass, defaultDate, onClose, onSaved, onError }) => {
  const [employeeId, setEmployeeId] = useState(employees[0]?.id || '');
  const [attendanceDate, setAttendanceDate] = useState(defaultDate);
  const [checkInTime, setCheckInTime] = useState('09:15');
  const [checkOutTime, setCheckOutTime] = useState('17:30');
  const [status, setStatus] = useState<AttendanceStatus>('Present');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId) return;
    setSaving(true);
    try {
      await apiClient.createManualAttendance({
        employeeId,
        attendanceDate,
        checkInTime: status === 'Absent' || status === 'On Leave' ? null : checkInTime || null,
        checkOutTime: status === 'Absent' || status === 'On Leave' ? null : checkOutTime || null,
        status,
        remarks,
      });
      await onSaved();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Failed to save attendance entry');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title="Log Manual Attendance Entry"
      icon={<Clock className="w-4 h-4 text-emerald-400" />}
      headerClass={headerClass}
      maxWidth="max-w-md"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-4 bg-white">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Employee *
          </label>
          <select
            required
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
          >
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name} ({emp.employeeId} · {emp.department})
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Date *
            </label>
            <input
              type="date"
              required
              value={attendanceDate}
              onChange={(e) => setAttendanceDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Status *
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as AttendanceStatus)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            >
              <option value="Present">Present</option>
              <option value="Late">Late</option>
              <option value="Half Day">Half Day</option>
              <option value="Absent">Absent</option>
              <option value="On Leave">On Leave</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Check In
            </label>
            <input
              type="time"
              value={checkInTime}
              onChange={(e) => setCheckInTime(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Check Out
            </label>
            <input
              type="time"
              value={checkOutTime}
              onChange={(e) => setCheckOutTime(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Remarks
          </label>
          <textarea
            rows={2}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
          />
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className={`${primaryBtnClass} px-5 py-2 rounded-lg text-xs font-bold cursor-pointer`}
          >
            {saving ? 'Saving...' : 'Save Entry'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

const LeaveRequestModal: React.FC<{
  employees: Employee[];
  lockedEmployeeId?: string;
  headerClass: string;
  primaryBtnClass: string;
  defaultDate: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string) => void;
}> = ({
  employees,
  lockedEmployeeId,
  headerClass,
  primaryBtnClass,
  defaultDate,
  onClose,
  onSaved,
  onError,
}) => {
  const [employeeId, setEmployeeId] = useState(lockedEmployeeId || employees[0]?.id || '');
  const [leaveType, setLeaveType] = useState<LeaveType>('Casual');
  const [startDate, setStartDate] = useState(defaultDate);
  const [endDate, setEndDate] = useState(defaultDate);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiClient.createLeave({
        employeeId: lockedEmployeeId || employeeId || undefined,
        leaveType,
        startDate,
        endDate,
        reason,
      });
      await onSaved();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Failed to submit leave request');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title="Submit Leave Request"
      icon={<CalendarDays className="w-4 h-4 text-emerald-400" />}
      headerClass={headerClass}
      maxWidth="max-w-md"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-4 bg-white">
        {!lockedEmployeeId && employees.length > 0 && (
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Employee *
            </label>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            >
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} ({emp.employeeId})
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Leave Type *
          </label>
          <select
            value={leaveType}
            onChange={(e) => setLeaveType(e.target.value as LeaveType)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
          >
            <option value="Casual">Casual Leave</option>
            <option value="Sick">Sick Leave</option>
            <option value="Annual">Annual Leave</option>
            <option value="Unpaid">Unpaid Leave</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Start Date *
            </label>
            <input
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              End Date *
            </label>
            <input
              type="date"
              required
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Reason *
          </label>
          <textarea
            rows={2}
            required
            minLength={5}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Describe leave reason (min 5 characters)"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
          />
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer"
          >
            Cancel
          </button>
            <button
              type="submit"
              disabled={saving}
              className={`${primaryBtnClass} px-5 py-2 rounded-lg text-xs font-bold cursor-pointer`}
            >
              {saving ? 'Submitting...' : 'Submit Leave Request'}
            </button>
          </div>
        </form>
      </ModalShell>
    );
  };

const HolidayFormModal: React.FC<{
  centers: EmployeeCenterRecord[];
  headerClass: string;
  primaryBtnClass: string;
  defaultDate: string;
  editingHoliday?: PublicHoliday | null;
  onClose: () => void;
  onSaved: (notifiedCount: number, isEdit: boolean) => Promise<void>;
  onError: (msg: string) => void;
}> = ({
  centers,
  headerClass,
  primaryBtnClass,
  defaultDate,
  editingHoliday,
  onClose,
  onSaved,
  onError,
}) => {
  const [title, setTitle] = useState(editingHoliday?.title || '');
  const [holidayDate, setHolidayDate] = useState(editingHoliday?.holidayDate || defaultDate);
  const [center, setCenter] = useState(editingHoliday?.center || 'All Centers');
  const [description, setDescription] = useState(editingHoliday?.description || '');
  const [isNational, setIsNational] = useState(Boolean(editingHoliday?.isNational));
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !holidayDate) return;
    setSaving(true);
    try {
      if (editingHoliday) {
        await apiClient.updateHoliday(editingHoliday.id, {
          title: title.trim(),
          holidayDate,
          center: isNational ? 'All Centers' : center,
          description: description.trim(),
        });
        await onSaved(0, true);
      } else {
        const res = await apiClient.createHoliday({
          title: title.trim(),
          holidayDate,
          center: isNational ? 'All Centers' : center,
          description: description.trim(),
          isNational,
        });
        await onSaved(res.notifiedCount, false);
      }
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Failed to save public holiday');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title={editingHoliday ? 'Edit Public / National Holiday' : 'Publish Public Holiday'}
      icon={<CalendarDays className="w-4 h-4 text-emerald-400" />}
      headerClass={headerClass}
      maxWidth="max-w-md"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-4 bg-white">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Holiday Title *
          </label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. National Foundation Day"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Date *
            </label>
            <input
              type="date"
              required
              value={holidayDate}
              onChange={(e) => setHolidayDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Assigned Center *
            </label>
            <SearchableCenterSelect
              centers={centers}
              value={isNational ? 'All Centers' : center}
              onChange={setCenter}
              includeAllOption
              allOptionLabel="All Centers"
              ariaLabel="Assigned Center"
              required
            />
          </div>
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-slate-700 font-semibold cursor-pointer">
          <input
            type="checkbox"
            checked={isNational}
            onChange={(e) => setIsNational(e.target.checked)}
          />
          <span>Indian National Holiday (blocks ticket creation across all centers)</span>
        </label>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Description
          </label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional notice sent to employees at this center..."
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
          />
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className={`${primaryBtnClass} px-5 py-2 rounded-lg text-xs font-bold cursor-pointer`}
          >
            {saving ? 'Saving...' : editingHoliday ? 'Save Holiday Changes' : 'Publish Holiday'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

const RegularizationModal: React.FC<{
  employees: Employee[];
  lockedEmployeeId?: string;
  headerClass: string;
  primaryBtnClass: string;
  defaultDate: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string) => void;
}> = ({
  employees,
  lockedEmployeeId,
  headerClass,
  primaryBtnClass,
  defaultDate,
  onClose,
  onSaved,
  onError,
}) => {
  const [employeeId, setEmployeeId] = useState(lockedEmployeeId || employees[0]?.id || '');
  const [targetDate, setTargetDate] = useState(defaultDate);
  const [requestedCheckIn, setRequestedCheckIn] = useState('09:15');
  const [requestedCheckOut, setRequestedCheckOut] = useState('17:30');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiClient.submitRegularization({
        employeeId: lockedEmployeeId || employeeId || undefined,
        targetDate,
        requestedCheckIn,
        requestedCheckOut,
        reason,
      });
      await onSaved();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Failed to submit regularization');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title="Submit Attendance Regularization"
      icon={<Clock className="w-4 h-4 text-emerald-400" />}
      headerClass={headerClass}
      maxWidth="max-w-md"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-4 bg-white">
        {!lockedEmployeeId && employees.length > 0 && (
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Employee *
            </label>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            >
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} ({emp.employeeId})
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Attendance Date *
          </label>
          <input
            type="date"
            required
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Requested Check-In *
            </label>
            <input
              type="time"
              required
              value={requestedCheckIn}
              onChange={(e) => setRequestedCheckIn(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Requested Check-Out *
            </label>
            <input
              type="time"
              required
              value={requestedCheckOut}
              onChange={(e) => setRequestedCheckOut(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Reason *
          </label>
          <textarea
            rows={2}
            required
            minLength={5}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain missed punch or timing discrepancy..."
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
          />
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className={`${primaryBtnClass} px-5 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer`}
          >
            <Send className="w-3.5 h-3.5" />
            <span>{saving ? 'Submitting...' : 'Submit Regularization'}</span>
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

const WfhModal: React.FC<{
  employees: Employee[];
  lockedEmployeeId?: string;
  headerClass: string;
  primaryBtnClass: string;
  defaultDate: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string) => void;
}> = ({
  employees,
  lockedEmployeeId,
  headerClass,
  primaryBtnClass,
  defaultDate,
  onClose,
  onSaved,
  onError,
}) => {
  const [employeeId, setEmployeeId] = useState(lockedEmployeeId || employees[0]?.id || '');
  const [targetDate, setTargetDate] = useState(defaultDate);
  const [endDate, setEndDate] = useState(defaultDate);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiClient.submitWfh({
        employeeId: lockedEmployeeId || employeeId || undefined,
        targetDate,
        endDate: endDate || targetDate,
        reason,
      });
      await onSaved();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Failed to submit WFH request');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title="Submit Work-From-Home Request"
      icon={<Home className="w-4 h-4 text-emerald-400" />}
      headerClass={headerClass}
      maxWidth="max-w-md"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-4 bg-white">
        {!lockedEmployeeId && employees.length > 0 && (
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Employee *
            </label>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            >
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} ({emp.employeeId})
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Start Date *
            </label>
            <input
              type="date"
              required
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              End Date *
            </label>
            <input
              type="date"
              required
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Reason / Plan *
          </label>
          <textarea
            rows={2}
            required
            minLength={5}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Describe remote work deliverable or reason..."
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
          />
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className={`${primaryBtnClass} px-5 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer`}
          >
            <Send className="w-3.5 h-3.5" />
            <span>{saving ? 'Submitting...' : 'Submit WFH Request'}</span>
          </button>
        </div>
      </form>
    </ModalShell>
  );
};
