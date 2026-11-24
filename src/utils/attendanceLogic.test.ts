import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAttendanceCalendarMonth,
  buildDailyAttendanceReport,
  buildMonthlyAttendanceReport,
  calculateLateMinutes,
  calculateLeaveDays,
  calculateWorkHours,
  computeAttendanceDashboardStats,
  deriveAttendanceStatusOnCheckIn,
} from './attendanceLogic.ts';
import { buildAttendancePdfBytes, buildExcelSpreadsheetXml } from './attendanceExport.ts';
import type { AttendanceRecord, LeaveRecord, PublicHoliday } from '../types/attendance.ts';

test('calculateLateMinutes and deriveAttendanceStatusOnCheckIn detect late arrivals after 09:30', () => {
  assert.equal(calculateLateMinutes('09:15'), 0);
  assert.equal(calculateLateMinutes('09:30'), 0);
  assert.equal(calculateLateMinutes('09:45'), 15);
  assert.equal(calculateLateMinutes('10:30'), 60);

  assert.equal(deriveAttendanceStatusOnCheckIn('09:29'), 'Present');
  assert.equal(deriveAttendanceStatusOnCheckIn('09:50'), 'Late');
});

test('calculateWorkHours and calculateLeaveDays compute durations accurately', () => {
  assert.equal(calculateWorkHours('09:00', '17:30'), 8.5);
  assert.equal(calculateWorkHours('09:30', '09:00'), 0);
  assert.equal(calculateLeaveDays('2026-08-10', '2026-08-10'), 1);
  assert.equal(calculateLeaveDays('2026-08-10', '2026-08-12'), 3);
  assert.equal(calculateLeaveDays('2026-08-12', '2026-08-10'), 0);
});

test('daily and monthly reports + dashboard stats aggregate attendance records correctly', () => {
  const employees = [
    { id: 'EMP001', employeeId: 'EMP-1001', name: 'Rahim Ahmed', department: 'IT', designation: 'Engineer' },
    { id: 'EMP002', employeeId: 'EMP-1002', name: 'Karim Uddin', department: 'HR', designation: 'Manager' },
  ];

  const attendance: AttendanceRecord[] = [
    {
      id: 'att1',
      employeeId: 'EMP001',
      attendanceDate: '2026-08-10',
      checkInTime: '09:45',
      checkOutTime: '17:45',
      status: 'Late',
      lateMinutes: 15,
      workHours: 8,
      remarks: 'Traffic',
      correctionStatus: 'None',
      createdAt: '2026-08-10T09:45:00Z',
      updatedAt: '2026-08-10T17:45:00Z',
    },
    {
      id: 'att2',
      employeeId: 'EMP001',
      attendanceDate: '2026-08-11',
      checkInTime: '09:10',
      checkOutTime: '17:10',
      status: 'Present',
      lateMinutes: 0,
      workHours: 8,
      remarks: '',
      correctionStatus: 'None',
      createdAt: '2026-08-11T09:10:00Z',
      updatedAt: '2026-08-11T17:10:00Z',
    },
    {
      id: 'att3',
      employeeId: 'EMP002',
      attendanceDate: '2026-08-10',
      checkInTime: null,
      checkOutTime: null,
      status: 'On Leave',
      lateMinutes: 0,
      workHours: 0,
      remarks: 'Approved Leave',
      correctionStatus: 'Approved',
      createdAt: '2026-08-10T09:00:00Z',
      updatedAt: '2026-08-10T09:00:00Z',
    },
  ];

  const leaves: LeaveRecord[] = [
    {
      id: 'lv1',
      employeeId: 'EMP001',
      leaveType: 'Casual',
      startDate: '2026-08-15',
      endDate: '2026-08-15',
      days: 1,
      reason: 'Personal',
      status: 'Pending',
      createdAt: '2026-08-10T10:00:00Z',
    },
  ];

  const daily = buildDailyAttendanceReport({ date: '2026-08-10', employees, attendance });
  assert.equal(daily.length, 2);
  assert.equal(daily[0].status, 'Late');
  assert.equal(daily[1].status, 'On Leave');

  const monthly = buildMonthlyAttendanceReport({ month: '2026-08', employees, attendance });
  assert.equal(monthly[0].presentDays, 1);
  assert.equal(monthly[0].lateDays, 1);
  assert.equal(monthly[0].totalWorkHours, 16);
  assert.equal(monthly[0].totalLateMinutes, 15);
  assert.equal(monthly[0].attendanceRatePct, 100);
  assert.equal(monthly[1].leaveDays, 1);

  const stats = computeAttendanceDashboardStats({
    today: '2026-08-10',
    month: '2026-08',
    employees,
    attendance,
    leaves,
  });
  assert.equal(stats.totalEmployeesInScope, 2);
  assert.equal(stats.presentToday, 1);
  assert.equal(stats.lateToday, 1);
  assert.equal(stats.onLeaveToday, 1);
  assert.equal(stats.pendingLeaves, 1);
  assert.equal(stats.avgWorkHours, 8);
});

test('Excel SpreadsheetML and PDF generators produce valid downloadable outputs', () => {
  const xml = buildExcelSpreadsheetXml({
    sheetName: 'Daily Attendance',
    headers: ['ID', 'Name', 'Status'],
    rows: [['EMP-1001', 'Rahim & Co', 'Present']],
  });
  assert.ok(xml.includes('<?mso-application progid="Excel.Sheet"?>'));
  assert.ok(xml.includes('Rahim &amp; Co'));

  const pdfBytes = buildAttendancePdfBytes({
    title: 'Monthly Report',
    subtitle: '2026-08',
    headers: ['ID', 'Name', 'Status'],
    rows: [['EMP-1001', 'Rahim Ahmed', 'Present']],
  });
  const pdfText = new TextDecoder().decode(pdfBytes);
  assert.ok(pdfText.startsWith('%PDF-1.4'));
  assert.ok(pdfText.includes('%%EOF'));
  assert.ok(pdfText.includes('Rahim Ahmed'));
});

test('buildAttendanceCalendarMonth places approved leaves and center-matched holidays while excluding pending/rejected leaves', () => {
  const employees = [
    { id: 'EMP001', department: 'IT', center: 'Dhaka HQ', branch: 'Dhaka HQ' },
    { id: 'EMP002', department: 'HR', center: 'Sylhet', branch: 'Sylhet' },
  ];

  const leaves: LeaveRecord[] = [
    {
      id: 'lv-approved',
      employeeId: 'EMP001',
      employeeName: 'Rahim Ahmed',
      department: 'IT',
      leaveType: 'Annual',
      startDate: '2026-11-10',
      endDate: '2026-11-12',
      days: 3,
      reason: 'Vacation',
      status: 'Approved',
      createdAt: '2026-11-01T10:00:00Z',
    },
    {
      id: 'lv-pending',
      employeeId: 'EMP002',
      employeeName: 'Karim Uddin',
      department: 'HR',
      leaveType: 'Casual',
      startDate: '2026-11-14',
      endDate: '2026-11-14',
      days: 1,
      reason: 'Errand',
      status: 'Pending',
      createdAt: '2026-11-02T10:00:00Z',
    },
    {
      id: 'lv-sylhet-approved',
      employeeId: 'EMP002',
      employeeName: 'Karim Uddin',
      department: 'HR',
      leaveType: 'Sick',
      startDate: '2026-11-18',
      endDate: '2026-11-18',
      days: 1,
      reason: 'Clinic visit',
      status: 'Approved',
      createdAt: '2026-11-03T10:00:00Z',
    },
  ];

  const holidays: PublicHoliday[] = [
    {
      id: 'hol-all',
      title: 'Foundation Day',
      holidayDate: '2026-11-05',
      center: 'All Centers',
      description: 'Company-wide holiday',
      createdBy: 'Admin',
      createdAt: '2026-11-01T00:00:00Z',
    },
    {
      id: 'hol-dhaka',
      title: 'Dhaka Center Maintenance',
      holidayDate: '2026-11-20',
      center: 'Dhaka HQ',
      description: 'Dhaka HQ only',
      createdBy: 'Admin',
      createdAt: '2026-11-01T00:00:00Z',
    },
    {
      id: 'hol-sylhet',
      title: 'Sylhet Regional Holiday',
      holidayDate: '2026-11-22',
      center: 'Sylhet',
      description: 'Sylhet only',
      createdBy: 'Admin',
      createdAt: '2026-11-01T00:00:00Z',
    },
  ];

  // 2026-11-01 is Sunday (leadingEmptySlots === 0, 30 days)
  const allView = buildAttendanceCalendarMonth({
    month: '2026-11',
    leaves,
    holidays,
    employees,
  });
  assert.equal(allView.leadingEmptySlots, 0);
  assert.equal(allView.days.length, 30);
  assert.equal(allView.totalHolidaysInMonth, 3);
  assert.equal(allView.totalApprovedLeaveDaysInMonth, 4); // 3 days for EMP001 + 1 day for EMP002
  assert.equal(allView.days[13].approvedLeaves.length, 0); // Pending leave on 2026-11-14 excluded
  assert.equal(allView.days[9].approvedLeaves[0].id, 'lv-approved');
  assert.equal(allView.days[11].approvedLeaves[0].id, 'lv-approved');

  // Filter by center = Dhaka HQ -> includes 'All Centers' + 'Dhaka HQ' holidays, excludes Sylhet holiday & HR Sylhet leave
  const dhakaView = buildAttendanceCalendarMonth({
    month: '2026-11',
    leaves,
    holidays,
    employees,
    center: 'Dhaka HQ',
  });
  assert.equal(dhakaView.totalHolidaysInMonth, 2);
  assert.equal(dhakaView.totalApprovedLeaveDaysInMonth, 3);
  assert.equal(dhakaView.days[21].holidays.length, 0); // 2026-11-22 Sylhet holiday excluded

  // Filter by department = HR -> includes only EMP002 approved leave (1 day)
  const hrView = buildAttendanceCalendarMonth({
    month: '2026-11',
    leaves,
    holidays,
    employees,
    department: 'HR',
  });
  assert.equal(hrView.totalApprovedLeaveDaysInMonth, 1);
  assert.equal(hrView.days[17].approvedLeaves[0].employeeId, 'EMP002');
});
