import type { PermissionName } from '../src/auth/permissions.ts';
import {
  claimDueMailJobsFromDb,
  createApprovalTokenInDb,
  deleteFailedEmailLogFromDb,
  enqueueEmailInDb,
  getEmailLogByIdFromDb,
  listUsersWithPermissions,
  markEmailSentInDb,
  writeEmailAuditLogInDb,
  type AppDatabase,
} from '../src/db/sqlite.ts';
import type { Employee } from '../src/types/asset.ts';
import type {
  AttendanceRecord,
  LeaveRecord,
  PublicHoliday,
  WorkflowRequestRecord,
} from '../src/types/attendance.ts';
import type { EmailLogRecord } from '../src/types/mail.ts';
import type { SupportTicket } from '../src/types/ticket.ts';
import type { SessionUser } from '../src/types/user.ts';
import { buildProfessionalEmail, COMPANY_SUPPORT_EMAIL } from './emailTemplates.ts';
import { sendMailViaSmtp } from './mailer.ts';

let isProcessing = false;

export async function processMailQueueOnce(db: AppDatabase): Promise<{
  processed: number;
  sent: number;
  failedOrRetrying: number;
  deletedFailed: number;
}> {
  if (isProcessing) {
    return { processed: 0, sent: 0, failedOrRetrying: 0, deletedFailed: 0 };
  }
  isProcessing = true;
  let processed = 0;
  let sent = 0;
  let failedOrRetrying = 0;

  try {
    const jobs = claimDueMailJobsFromDb(db, 10);
    for (const job of jobs) {
      processed++;
      try {
        const res = await sendMailViaSmtp({
          to: job.recipientEmail,
          subject: job.subject,
          html: job.htmlBody,
          text: job.textBody,
          db,
        });
        markEmailSentInDb(db, job.id, res.messageId);
        sent++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown SMTP delivery error';
        deleteFailedEmailLogFromDb(db, job.id, msg, 'smtp-manual');
        failedOrRetrying++;
      }
    }
  } finally {
    isProcessing = false;
  }

  return { processed, sent, failedOrRetrying, deletedFailed: failedOrRetrying };
}

export async function sendEmailLogNow(
  db: AppDatabase,
  emailLogId: string,
  actorName = 'Administrator'
): Promise<
  | { ok: true; message: string; log: EmailLogRecord }
  | { ok: false; code: number; error: string; details: string; deletedLogId: string }
> {
  const existing = getEmailLogByIdFromDb(db, emailLogId);
  if (!existing) {
    return {
      ok: false,
      code: 404,
      error: 'Email Delivery Failed',
      details: 'Email queue item not found.',
      deletedLogId: emailLogId,
    };
  }

  writeEmailAuditLogInDb(db, {
    emailLogId: existing.id,
    eventType: 'MANUAL_MAIL_CLICKED',
    actor: actorName,
    status: 'Sending',
    details: `Manual mail dispatch initiated by ${actorName} to ${existing.recipientEmail}`,
  });

  try {
    const res = await sendMailViaSmtp({
      to: existing.recipientEmail,
      subject: existing.subject,
      html: existing.htmlBody,
      text: existing.textBody,
      db,
    });
    markEmailSentInDb(db, existing.id, res.messageId);
    const updated = getEmailLogByIdFromDb(db, existing.id) || {
      ...existing,
      status: 'Sent' as const,
      messageId: res.messageId,
    };
    return {
      ok: true,
      message: 'Email Sent Successfully',
      log: updated,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'SMTP delivery failed';
    deleteFailedEmailLogFromDb(db, existing.id, msg, actorName);
    return {
      ok: false,
      code: 502,
      error: 'Email Delivery Failed',
      details: msg,
      deletedLogId: existing.id,
    };
  }
}

export function kickMailQueue(_db: AppDatabase): void {
  // Automatic background sending is disabled across the system.
  // Emails are queued and sent only when a user explicitly clicks a Mail button.
}

export function startMailQueueWorker(_db: AppDatabase, _intervalMs = 10000): void {
  // Automatic background mail worker disabled per manual mail trigger policy.
}

export function stopMailQueueWorker(): void {
  // No-op since background mail worker is disabled.
}

export function getRequestBaseUrl(req?: { protocol?: string; get?: (h: string) => string | undefined }): string {
  if (process.env.APP_BASE_URL) {
    return process.env.APP_BASE_URL.replace(/\/+$/, '');
  }
  if (req && typeof req.get === 'function') {
    const host = req.get('host');
    if (host) {
      const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
      return `${proto}://${host}`;
    }
  }
  return 'http://localhost:3000';
}

function resolveManagerRecipient(
  db: AppDatabase,
  employee?: Pick<Employee, 'reportingManagerId' | 'reportingManagerName' | 'reportingManagerEmail'> | null
): { name: string; email: string } {
  if (employee?.reportingManagerId) {
    const mgrRow = db
      .prepare(`SELECT name, email FROM Employees WHERE id = ? OR employee_id = ? LIMIT 1`)
      .get(employee.reportingManagerId, employee.reportingManagerId) as
      | { name: string; email: string }
      | undefined;
    if (mgrRow?.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mgrRow.email.trim())) {
      return {
        name: mgrRow.name || employee.reportingManagerName || 'Reporting Manager',
        email: mgrRow.email.trim(),
      };
    }
  }
  const mgrEmail = employee?.reportingManagerEmail?.trim();
  const mgrName = employee?.reportingManagerName?.trim();
  if (mgrEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mgrEmail)) {
    return {
      name: mgrName || 'Reporting Manager',
      email: mgrEmail,
    };
  }
  const users = listUsersWithPermissions(db);
  const hrOrAdmin =
    users.find((u) => u.active && u.role === 'HR Manager' && u.email) ||
    users.find((u) => u.active && (u.role === 'Super Admin' || u.role === 'Administrator') && u.email);
  if (hrOrAdmin) {
    return { name: hrOrAdmin.fullName, email: hrOrAdmin.email };
  }
  return { name: 'HR & Admin Operations', email: COMPANY_SUPPORT_EMAIL };
}

function buildApprovalUrls(baseUrl: string, rawToken: string) {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return {
    approveUrl: `${cleanBase}/api/approvals/respond?token=${encodeURIComponent(rawToken)}&action=approve`,
    rejectUrl: `${cleanBase}/api/approvals/respond?token=${encodeURIComponent(rawToken)}&action=reject`,
  };
}

// =========================================================================
// REPORTING MANAGER WORKFLOW EMAILS
// =========================================================================

export function notifyManagerNewEmployee(
  db: AppDatabase,
  params: { employee: Employee; baseUrl: string }
): void {
  const { employee, baseUrl } = params;
  const manager = resolveManagerRecipient(db, employee);
  const template = buildProfessionalEmail({
    subject: `[New Employee] ${employee.name} (${employee.employeeId}) onboarded in ${employee.department}`,
    headline: 'New Employee Onboarding Notice',
    recipientName: manager.name,
    summaryText: `A new employee record has been created under your reporting line for ${employee.center || employee.branch}.`,
    employee,
    details: [
      { label: 'Employee ID', value: employee.employeeId },
      { label: 'Designation', value: employee.designation || 'Staff' },
      { label: 'Department', value: employee.department },
      { label: 'Assigned Center', value: employee.center || employee.branch || 'Mumbai' },
      { label: 'Joining Date', value: employee.joiningDate || new Date().toISOString().slice(0, 10) },
    ],
    ctaLabel: 'View Employee Directory',
    ctaUrl: baseUrl,
  });

  enqueueEmailInDb(db, {
    dedupeKey: `new-employee:${employee.id}:${employee.employeeId}`,
    eventType: 'NEW_EMPLOYEE_CREATED',
    recipientEmail: manager.email,
    recipientName: manager.name,
    recipientRole: 'Manager',
    employeeId: employee.id,
    employeeName: employee.name,
    managerName: manager.name,
    managerEmail: manager.email,
    center: employee.center || employee.branch,
    subject: template.subject,
    htmlBody: template.htmlBody,
    textBody: template.textBody,
    relatedEntityType: 'employee',
    relatedEntityId: employee.id,
  });
}

export function notifyManagerLateAttendance(
  db: AppDatabase,
  params: { employee: Employee; attendance: AttendanceRecord; baseUrl: string }
): void {
  const { employee, attendance, baseUrl } = params;
  if (!attendance.lateMinutes || attendance.lateMinutes <= 0) return;

  const manager = resolveManagerRecipient(db, employee);
  const template = buildProfessionalEmail({
    subject: `[Late Attendance Alert] ${employee.name} (${employee.employeeId}) · ${attendance.attendanceDate}`,
    headline: 'Late Attendance Detected',
    recipientName: manager.name,
    summaryText: `${employee.name} checked in ${attendance.lateMinutes} minutes after the shift threshold on ${attendance.attendanceDate}.`,
    employee,
    details: [
      { label: 'Attendance Date', value: attendance.attendanceDate },
      { label: 'Check-In Time', value: attendance.checkInTime || '—' },
      { label: 'Late Duration', value: `${attendance.lateMinutes} minutes` },
      { label: 'Status', value: attendance.status },
      { label: 'Remarks', value: attendance.remarks || 'None provided' },
    ],
    ctaLabel: 'Review Attendance Logs',
    ctaUrl: baseUrl,
  });

  enqueueEmailInDb(db, {
    dedupeKey: `late-attendance:${attendance.id}:${attendance.attendanceDate}:${attendance.checkInTime || ''}`,
    eventType: 'LATE_ATTENDANCE_ALERT',
    recipientEmail: manager.email,
    recipientName: manager.name,
    recipientRole: 'Manager',
    employeeId: employee.id,
    employeeName: employee.name,
    managerName: manager.name,
    managerEmail: manager.email,
    center: employee.center || employee.branch,
    subject: template.subject,
    htmlBody: template.htmlBody,
    textBody: template.textBody,
    relatedEntityType: 'attendance',
    relatedEntityId: attendance.id,
  });
}

export function notifyManagerLeaveSubmitted(
  db: AppDatabase,
  params: { employee: Employee; leave: LeaveRecord; baseUrl: string }
): void {
  const { employee, leave, baseUrl } = params;
  const manager = resolveManagerRecipient(db, employee);
  const { rawToken } = createApprovalTokenInDb(db, {
    entityType: 'leave',
    entityId: leave.id,
    employeeId: employee.id,
    managerName: manager.name,
    managerEmail: manager.email,
  });
  const { approveUrl, rejectUrl } = buildApprovalUrls(baseUrl, rawToken);

  const template = buildProfessionalEmail({
    subject: `[Approval Required] ${leave.leaveType} Leave Request · ${employee.name} (${leave.startDate})`,
    headline: 'Leave Request Awaiting Your Approval',
    recipientName: manager.name,
    summaryText: `${employee.name} has submitted a ${leave.leaveType} leave request for ${leave.days} day(s). You can approve or reject directly using the secure buttons below.`,
    employee,
    details: [
      { label: 'Leave Type', value: leave.leaveType },
      { label: 'Period', value: `${leave.startDate} to ${leave.endDate} (${leave.days} day${leave.days > 1 ? 's' : ''})` },
      { label: 'Reason', value: leave.reason },
      { label: 'Current Status', value: leave.status },
    ],
    approveUrl,
    rejectUrl,
    ctaLabel: 'Review in Attendance Portal',
    ctaUrl: baseUrl,
  });

  enqueueEmailInDb(db, {
    dedupeKey: `leave-submitted:${leave.id}`,
    eventType: 'LEAVE_SUBMITTED',
    recipientEmail: manager.email,
    recipientName: manager.name,
    recipientRole: 'Manager',
    employeeId: employee.id,
    employeeName: employee.name,
    managerName: manager.name,
    managerEmail: manager.email,
    center: employee.center || employee.branch,
    subject: template.subject,
    htmlBody: template.htmlBody,
    textBody: template.textBody,
    relatedEntityType: 'leave',
    relatedEntityId: leave.id,
  });
}

export function notifyManagerWorkflowSubmitted(
  db: AppDatabase,
  params: { employee: Employee; request: WorkflowRequestRecord; baseUrl: string }
): void {
  const { employee, request, baseUrl } = params;
  const manager = resolveManagerRecipient(db, employee);
  const { rawToken } = createApprovalTokenInDb(db, {
    entityType: request.requestType,
    entityId: request.id,
    employeeId: employee.id,
    managerName: manager.name,
    managerEmail: manager.email,
  });
  const { approveUrl, rejectUrl } = buildApprovalUrls(baseUrl, rawToken);

  const labelMap: Record<WorkflowRequestRecord['requestType'], { title: string; eventType: string }> = {
    regularization: {
      title: 'Attendance Regularization Request',
      eventType: 'REGULARIZATION_SUBMITTED',
    },
    wfh: {
      title: 'Work From Home (WFH) Request',
      eventType: 'WFH_SUBMITTED',
    },
    profile_change: {
      title: 'Employee Profile Change Request',
      eventType: 'PROFILE_CHANGE_SUBMITTED',
    },
  };

  const info = labelMap[request.requestType];
  const details: Array<{ label: string; value: string }> = [
    { label: 'Request Type', value: info.title },
    {
      label: request.requestType === 'wfh' && request.endDate ? 'WFH Period' : 'Effective Date',
      value:
        request.endDate && request.endDate !== request.targetDate
          ? `${request.targetDate} to ${request.endDate}`
          : request.targetDate,
    },
  ];
  if (request.requestedCheckIn || request.requestedCheckOut) {
    details.push({
      label: 'Requested Timing',
      value: `${request.requestedCheckIn || '—'} to ${request.requestedCheckOut || '—'}`,
    });
  }
  if (request.payloadJson) {
    try {
      const parsed = JSON.parse(request.payloadJson) as Record<string, string>;
      const changeSummary = Object.entries(parsed)
        .filter(([, v]) => Boolean(v))
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      if (changeSummary) {
        details.push({ label: 'Requested Updates', value: changeSummary });
      }
    } catch {
      // Ignore parse error
    }
  }
  details.push({ label: 'Reason / Notes', value: request.reason });

  const template = buildProfessionalEmail({
    subject: `[Approval Required] ${info.title} · ${employee.name} (${request.targetDate})`,
    headline: `${info.title} Awaiting Approval`,
    recipientName: manager.name,
    summaryText: `${employee.name} submitted a ${info.title.toLowerCase()} requiring your review and decision.`,
    employee,
    details,
    approveUrl,
    rejectUrl,
    ctaLabel: 'Open Attendance & Requests',
    ctaUrl: baseUrl,
  });

  enqueueEmailInDb(db, {
    dedupeKey: `workflow-submitted:${request.id}`,
    eventType: info.eventType,
    recipientEmail: manager.email,
    recipientName: manager.name,
    recipientRole: 'Manager',
    employeeId: employee.id,
    employeeName: employee.name,
    managerName: manager.name,
    managerEmail: manager.email,
    center: employee.center || employee.branch,
    subject: template.subject,
    htmlBody: template.htmlBody,
    textBody: template.textBody,
    relatedEntityType: request.requestType,
    relatedEntityId: request.id,
  });
}

// =========================================================================
// EMPLOYEE NOTIFICATION EMAILS
// =========================================================================

export function notifyEmployeeLeaveDecision(
  db: AppDatabase,
  params: { employee: Employee; leave: LeaveRecord; actorName: string; baseUrl: string }
): void {
  const { employee, leave, actorName, baseUrl } = params;
  const template = buildProfessionalEmail({
    subject: `[Leave ${leave.status}] ${leave.leaveType} Leave (${leave.startDate} to ${leave.endDate})`,
    headline: `Your Leave Request Was ${leave.status}`,
    recipientName: employee.name,
    summaryText: `Your ${leave.leaveType} leave request for ${leave.days} day(s) has been ${leave.status.toLowerCase()} by ${actorName}.`,
    employee,
    details: [
      { label: 'Decision', value: leave.status },
      { label: 'Leave Type', value: leave.leaveType },
      { label: 'Dates', value: `${leave.startDate} to ${leave.endDate} (${leave.days}d)` },
      { label: 'Reviewed By', value: actorName },
    ],
    ctaLabel: 'View Leave History',
    ctaUrl: baseUrl,
  });

  enqueueEmailInDb(db, {
    dedupeKey: `leave-decision:${leave.id}:${leave.status}`,
    eventType: leave.status === 'Approved' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
    recipientEmail: employee.email,
    recipientName: employee.name,
    recipientRole: 'Employee',
    employeeId: employee.id,
    employeeName: employee.name,
    managerName: employee.reportingManagerName || actorName,
    managerEmail: employee.reportingManagerEmail || '',
    center: employee.center || employee.branch,
    subject: template.subject,
    htmlBody: template.htmlBody,
    textBody: template.textBody,
    relatedEntityType: 'leave',
    relatedEntityId: leave.id,
  });
}

export function notifyEmployeeAttendanceCorrection(
  db: AppDatabase,
  params: { employee: Employee; attendance: AttendanceRecord; actorName: string; baseUrl: string }
): void {
  const { employee, attendance, actorName, baseUrl } = params;
  if (attendance.correctionStatus !== 'Approved' && attendance.correctionStatus !== 'Rejected') {
    return;
  }

  const template = buildProfessionalEmail({
    subject: `[Attendance ${attendance.correctionStatus}] Correction for ${attendance.attendanceDate}`,
    headline: `Attendance Correction ${attendance.correctionStatus}`,
    recipientName: employee.name,
    summaryText: `Your attendance record for ${attendance.attendanceDate} was updated and marked ${attendance.correctionStatus.toLowerCase()} by ${actorName}.`,
    employee,
    details: [
      { label: 'Attendance Date', value: attendance.attendanceDate },
      { label: 'Updated Status', value: attendance.status },
      { label: 'Check-In / Check-Out', value: `${attendance.checkInTime || '—'} / ${attendance.checkOutTime || '—'}` },
      { label: 'Correction Status', value: attendance.correctionStatus },
      { label: 'Reviewed By', value: actorName },
    ],
    ctaLabel: 'View Attendance History',
    ctaUrl: baseUrl,
  });

  enqueueEmailInDb(db, {
    dedupeKey: `attendance-correction:${attendance.id}:${attendance.correctionStatus}:${attendance.updatedAt}`,
    eventType:
      attendance.correctionStatus === 'Approved'
        ? 'ATTENDANCE_CORRECTION_APPROVED'
        : 'ATTENDANCE_CORRECTION_REJECTED',
    recipientEmail: employee.email,
    recipientName: employee.name,
    recipientRole: 'Employee',
    employeeId: employee.id,
    employeeName: employee.name,
    managerName: employee.reportingManagerName || actorName,
    managerEmail: employee.reportingManagerEmail || '',
    center: employee.center || employee.branch,
    subject: template.subject,
    htmlBody: template.htmlBody,
    textBody: template.textBody,
    relatedEntityType: 'attendance',
    relatedEntityId: attendance.id,
  });
}

export function notifyEmployeeWorkflowDecision(
  db: AppDatabase,
  params: { employee: Employee; request: WorkflowRequestRecord; actorName: string; baseUrl: string }
): void {
  const { employee, request, actorName, baseUrl } = params;
  const labelMap: Record<WorkflowRequestRecord['requestType'], string> = {
    regularization: 'Attendance Regularization',
    wfh: 'Work From Home (WFH)',
    profile_change: 'Profile Change',
  };
  const label = labelMap[request.requestType];

  const template = buildProfessionalEmail({
    subject: `[${label} ${request.status}] Request for ${request.targetDate}`,
    headline: `${label} Request ${request.status}`,
    recipientName: employee.name,
    summaryText: `Your ${label.toLowerCase()} request for ${request.targetDate} has been ${request.status.toLowerCase()} by ${actorName}.`,
    employee,
    details: [
      { label: 'Request Type', value: label },
      { label: 'Target Date', value: request.endDate ? `${request.targetDate} to ${request.endDate}` : request.targetDate },
      { label: 'Decision', value: request.status },
      { label: 'Reviewed By', value: actorName },
      ...(request.reviewNotes ? [{ label: 'Reviewer Notes', value: request.reviewNotes }] : []),
    ],
    ctaLabel: 'Open Portal',
    ctaUrl: baseUrl,
  });

  enqueueEmailInDb(db, {
    dedupeKey: `workflow-decision:${request.id}:${request.status}`,
    eventType: `${request.requestType.toUpperCase()}_${request.status.toUpperCase()}`,
    recipientEmail: employee.email,
    recipientName: employee.name,
    recipientRole: 'Employee',
    employeeId: employee.id,
    employeeName: employee.name,
    managerName: employee.reportingManagerName || actorName,
    managerEmail: employee.reportingManagerEmail || '',
    center: employee.center || employee.branch,
    subject: template.subject,
    htmlBody: template.htmlBody,
    textBody: template.textBody,
    relatedEntityType: request.requestType,
    relatedEntityId: request.id,
  });
}

export function notifyEmployeesHolidayPublished(
  db: AppDatabase,
  params: { holiday: PublicHoliday; employees: Employee[]; baseUrl: string }
): number {
  const { holiday, employees, baseUrl } = params;
  const targetCenter = (holiday.center || 'All Centers').trim().toLowerCase();
  const recipients = employees.filter((e) => {
    if (e.status !== 'Active' || !e.email) return false;
    if (targetCenter === 'all centers') return true;
    const empCenter = (e.center || e.branch || '').trim().toLowerCase();
    return empCenter === targetCenter;
  });

  let queuedCount = 0;
  for (const emp of recipients) {
    const template = buildProfessionalEmail({
      subject: `[Public Holiday] ${holiday.title} on ${holiday.holidayDate} · ${holiday.center}`,
      headline: 'New Public Holiday Published',
      recipientName: emp.name,
      summaryText: `A new public holiday has been published for ${holiday.center}. Please update your team leave and attendance planning accordingly.`,
      employee: emp,
      centerOverride: holiday.center,
      details: [
        { label: 'Holiday Title', value: holiday.title },
        { label: 'Date', value: holiday.holidayDate },
        { label: 'Applicable Center', value: holiday.center },
        { label: 'Notes', value: holiday.description || 'Official company holiday' },
      ],
      ctaLabel: 'View Team Attendance Calendar',
      ctaUrl: baseUrl,
    });

    const res = enqueueEmailInDb(db, {
      dedupeKey: `holiday-published:${holiday.id}:${emp.id}`,
      eventType: 'HOLIDAY_PUBLISHED',
      recipientEmail: emp.email,
      recipientName: emp.name,
      recipientRole: 'Employee',
      employeeId: emp.id,
      employeeName: emp.name,
      managerName: emp.reportingManagerName || '',
      managerEmail: emp.reportingManagerEmail || '',
      center: emp.center || emp.branch || holiday.center,
      subject: template.subject,
      htmlBody: template.htmlBody,
      textBody: template.textBody,
      relatedEntityType: 'holiday',
      relatedEntityId: holiday.id,
    });
    if (res.enqueued) queuedCount++;
  }
  return queuedCount;
}

export function notifyUserAccountCreated(
  db: AppDatabase,
  params: { user: SessionUser; employee?: Employee | null; rawPassword?: string; baseUrl: string }
): EmailLogRecord | null {
  const { user, employee, rawPassword, baseUrl } = params;
  const targetEmail = employee?.officialEmail || user.email;
  if (!targetEmail) return null;

  const details: Array<{ label: string; value: string }> = [
    { label: 'Login ID / Official Email', value: `${user.loginId} / ${targetEmail}` },
    { label: 'Employee ID', value: employee?.employeeId || user.employeeId || '—' },
    { label: 'Assigned Role', value: user.role },
    { label: 'Department', value: user.department || employee?.department || 'General' },
    { label: 'Designation', value: employee?.designation || 'Staff' },
    { label: 'Account Status', value: user.active ? 'Active' : 'Inactive' },
  ];
  if (rawPassword) {
    details.splice(1, 0, { label: 'Login Password', value: rawPassword });
  }

  const template = buildProfessionalEmail({
    subject: `[Account Created] Welcome to Median Research Asset & HR Portal (${user.loginId})`,
    headline: 'Your Portal Account Is Ready',
    recipientName: user.fullName,
    summaryText: rawPassword
      ? `Your employee account has been created on the Median Research & Consulting Pvt Ltd Portal. Use the login User/Email ID and Password below to sign in.`
      : `An account has been provisioned for you on the Median Research & Consulting Pvt Ltd Employee & Asset Portal with the role "${user.role}".`,
    employee: employee || null,
    centerOverride: employee?.center || employee?.branch || 'Mumbai',
    details,
    ctaLabel: 'Sign In to Portal',
    ctaUrl: baseUrl,
    footerNote: rawPassword
      ? 'Please keep your login credentials confidential and change your password periodically.'
      : 'For security, your initial password is shared separately by your administrator.',
  });

  const res = enqueueEmailInDb(db, {
    dedupeKey: `account-created:${user.id}:${employee?.employeeId || ''}`,
    eventType: 'ACCOUNT_CREATED',
    recipientEmail: targetEmail,
    recipientName: user.fullName,
    recipientRole: 'Employee',
    employeeId: employee?.id || user.employeeId || null,
    employeeName: employee?.name || user.fullName,
    managerName: employee?.reportingManagerName || '',
    managerEmail: employee?.reportingManagerEmail || '',
    center: employee?.center || employee?.branch || 'Mumbai',
    subject: template.subject,
    htmlBody: template.htmlBody,
    textBody: template.textBody,
    relatedEntityType: 'user',
    relatedEntityId: user.id,
  });
  return res.log;
}

export function notifyTicketWorkOrderScheduled(
  db: AppDatabase,
  params: { ticket: SupportTicket; employee: Employee; baseUrl: string }
): EmailLogRecord {
  const { ticket, employee, baseUrl } = params;
  const recipientEmail = employee.officialEmail || employee.email;
  const slotWindow =
    ticket.workOrderDate && ticket.workOrderStartTime && ticket.workOrderEndTime
      ? `${ticket.workOrderDate} (${ticket.workOrderStartTime} – ${ticket.workOrderEndTime}, ${ticket.workOrderDurationMins} mins)`
      : 'Scheduled';

  const template = buildProfessionalEmail({
    subject: `[Work Order Scheduled] Ticket #${ticket.id} · ${ticket.subject}`,
    headline: 'Work Order Date & Time Slot Scheduled',
    recipientName: employee.name,
    summaryText: `Admin has generated and confirmed the Work Order schedule for your support ticket "${ticket.subject}". Your assigned support window is ${slotWindow}.`,
    employee,
    centerOverride: employee.center || employee.branch || 'Mumbai',
    details: [
      { label: 'Ticket ID', value: ticket.id },
      { label: 'Asset ID', value: ticket.assetId },
      { label: 'Priority', value: ticket.priority },
      { label: 'Work Order Date', value: ticket.workOrderDate || '—' },
      {
        label: 'Time Slot (Minutes)',
        value: `${ticket.workOrderStartTime || '—'} to ${ticket.workOrderEndTime || '—'} (${ticket.workOrderDurationMins || 0} mins)`,
      },
      { label: 'Ticket Status', value: ticket.status },
    ],
    ctaLabel: 'View Ticket Work Order',
    ctaUrl: baseUrl,
  });

  const res = enqueueEmailInDb(db, {
    dedupeKey: `ticket-workorder:${ticket.id}:${ticket.workOrderDate || ''}:${ticket.workOrderStartTime || ''}:${ticket.workOrderDurationMins || 0}`,
    eventType: 'TICKET_WORK_ORDER_SCHEDULED',
    recipientEmail,
    recipientName: employee.name,
    recipientRole: 'Employee',
    employeeId: employee.id,
    employeeName: employee.name,
    managerName: employee.reportingManagerName || '',
    managerEmail: employee.reportingManagerEmail || '',
    center: employee.center || employee.branch || 'Mumbai',
    subject: template.subject,
    htmlBody: template.htmlBody,
    textBody: template.textBody,
    relatedEntityType: 'ticket',
    relatedEntityId: ticket.id,
  });
  return res.log;
}

export function notifyUserPasswordReset(
  db: AppDatabase,
  params: { user: SessionUser; temporaryPassword?: string; employee?: Employee | null; baseUrl: string; resetId: string }
): void {
  const { user, temporaryPassword, employee, baseUrl, resetId } = params;
  if (!user.email) return;

  const details: Array<{ label: string; value: string }> = [
    { label: 'Login ID', value: user.loginId },
    { label: 'Account Email', value: user.email },
    { label: 'Reset Timestamp', value: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC' },
  ];
  if (temporaryPassword) {
    details.push({ label: 'Temporary Password', value: temporaryPassword });
  }

  const template = buildProfessionalEmail({
    subject: `[Security Notice] Password Reset for ${user.loginId}`,
    headline: 'Your Account Password Has Been Reset',
    recipientName: user.fullName,
    summaryText: temporaryPassword
      ? 'A password reset was processed for your account. Use the temporary credentials below to sign in, then update your password with an administrator.'
      : 'Your account password was recently updated by an administrator. If you did not expect this change, contact HR/IT immediately.',
    employee: employee || null,
    centerOverride: employee?.center || employee?.branch || 'Mumbai',
    details,
    ctaLabel: 'Sign In to Portal',
    ctaUrl: baseUrl,
  });

  enqueueEmailInDb(db, {
    dedupeKey: `password-reset:${user.id}:${resetId}`,
    eventType: 'PASSWORD_RESET',
    recipientEmail: user.email,
    recipientName: user.fullName,
    recipientRole: 'Employee',
    employeeId: employee?.id || user.employeeId || null,
    employeeName: employee?.name || user.fullName,
    managerName: employee?.reportingManagerName || '',
    managerEmail: employee?.reportingManagerEmail || '',
    center: employee?.center || employee?.branch || 'Mumbai',
    subject: template.subject,
    htmlBody: template.htmlBody,
    textBody: template.textBody,
    relatedEntityType: 'user',
    relatedEntityId: user.id,
  });
}

export function notifyUserRoleOrPermissionsChanged(
  db: AppDatabase,
  params: {
    user: SessionUser;
    roleName: string;
    permissions: PermissionName[];
    employee?: Employee | null;
    actorName: string;
    changeKey: string;
    baseUrl: string;
  }
): void {
  const { user, roleName, permissions, employee, actorName, changeKey, baseUrl } = params;
  if (!user.email) return;

  const template = buildProfessionalEmail({
    subject: `[Access Update] Role & Permissions Updated (${roleName})`,
    headline: 'Your Role or Permissions Were Updated',
    recipientName: user.fullName,
    summaryText: `${actorName} updated your access profile on the Median Research Employee & Asset Portal.`,
    employee: employee || null,
    centerOverride: employee?.center || employee?.branch || 'Mumbai',
    details: [
      { label: 'Login ID', value: user.loginId },
      { label: 'Assigned Role', value: roleName },
      { label: 'Total Permissions', value: `${permissions.length} permission(s)` },
      { label: 'Permissions Summary', value: permissions.slice(0, 8).join(', ') + (permissions.length > 8 ? ` +${permissions.length - 8} more` : '') },
      { label: 'Updated By', value: actorName },
    ],
    ctaLabel: 'Open Portal',
    ctaUrl: baseUrl,
  });

  enqueueEmailInDb(db, {
    dedupeKey: `role-perm-changed:${user.id}:${changeKey}`,
    eventType: 'ROLE_PERMISSION_CHANGED',
    recipientEmail: user.email,
    recipientName: user.fullName,
    recipientRole: 'Employee',
    employeeId: employee?.id || user.employeeId || null,
    employeeName: employee?.name || user.fullName,
    managerName: employee?.reportingManagerName || '',
    managerEmail: employee?.reportingManagerEmail || '',
    center: employee?.center || employee?.branch || 'Mumbai',
    subject: template.subject,
    htmlBody: template.htmlBody,
    textBody: template.textBody,
    relatedEntityType: 'user',
    relatedEntityId: user.id,
  });
}
