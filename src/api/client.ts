import type { PermissionName } from '../auth/permissions';
import type {
  Asset,
  AssetOSState,
  AssetReturn,
  AssetStatus,
  AssetTransfer,
  AssigneeEntityType,
  Assignment,
  BulkDirectoryImportResult,
  BulkEmployeeImportResult,
  CompanySettings,
  DepartmentDesignation,
  DisposalRecord,
  Employee,
  EmploymentCategory,
  EmploymentConversionRecord,
  ExpenseCategoryRecord,
  ExpenseRecord,
  FreelancerAccessoryItem,
  FreelancerAllotmentRecord,
  MaintenanceRecord,
  PaymentModeRecord,
  PersonnelEntity,
  PersonnelEntityType,
  SupportTicket,
  SystemAuditLog,
  ThemePalette,
  Vendor,
  VisitorAnalyticsSummary,
} from '../types/asset';
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
  WorkflowRequestType,
} from '../types/attendance';
import type {
  EmailAuditRecord,
  EmailDashboardSummary,
  EmailLogRecord,
  EmployeeMailReportRow,
  MailHealthStatus,
  ManagerMailReportRow,
} from '../types/mail';
import type {
  EmployeeCenterRecord,
  PolicyAcknowledgmentRecord,
  PolicyDocumentRecord,
} from '../types/policy';
import type { PermissionRecord, RoleRecord, SessionUser } from '../types/user';

export const TOKEN_STORAGE_KEY = 'assetos.token';

export class ApiError extends Error {
  status: number;
  errors?: Record<string, string>;
  details?: string;

  constructor(status: number, message: string, errors?: Record<string, string>, details?: string) {
    super(message);
    this.status = status;
    this.errors = errors;
    this.details = details;
  }
}

export function getStoredToken(): string | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_STORAGE_KEY) : null;
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (typeof window === 'undefined') return;
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota errors
  }
}

async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      res.status,
      typeof data?.error === 'string' ? data.error : `Request failed (${res.status})`,
      data?.errors,
      typeof data?.details === 'string' ? data.details : undefined
    );
  }
  return data as T;
}

export const apiClient = {
  // Auth & Analytics
  login: (loginId: string, password: string, visitorKey?: string) =>
    requestJson<{ token: string; user: SessionUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ loginId, password, visitorKey }),
    }),
  forgotPassword: (identifier: string) =>
    requestJson<{ ok: boolean; message: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ loginId: identifier }),
    }),
  logout: () =>
    requestJson<{ ok: boolean }>('/api/auth/logout', {
      method: 'POST',
    }),
  me: () => requestJson<{ user: SessionUser }>('/api/auth/me'),
  updateMyTheme: (theme: ThemePalette) =>
    requestJson<{ theme: ThemePalette; user: SessionUser | null }>('/api/auth/theme', {
      method: 'PUT',
      body: JSON.stringify({ theme }),
    }),
  recordSiteVisit: (visitorKey?: string) =>
    requestJson<{ ok: boolean; summary: VisitorAnalyticsSummary }>('/api/analytics/visit', {
      method: 'POST',
      body: JSON.stringify({ visitorKey }),
    }),
  sendPresenceHeartbeat: (visitorKey?: string) =>
    requestJson<{ ok: boolean; summary: VisitorAnalyticsSummary }>('/api/analytics/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ visitorKey }),
    }),
  getVisitorAnalytics: () =>
    requestJson<{ summary: VisitorAnalyticsSummary }>('/api/analytics/visitors'),

  // Roles & Permissions
  listPermissions: () => requestJson<{ permissions: PermissionRecord[] }>('/api/permissions'),
  listRoles: () => requestJson<{ roles: RoleRecord[] }>('/api/roles'),
  updateRolePermissions: (roleId: string, permissions: PermissionName[]) =>
    requestJson<{ role: RoleRecord }>(`/api/roles/${encodeURIComponent(roleId)}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissions }),
    }),

  // Users
  listUsers: () => requestJson<{ users: SessionUser[] }>('/api/users'),
  createUser: (payload: {
    loginId: string;
    password: string;
    fullName: string;
    email: string;
    roleId: string;
    employeeId?: string;
    department?: string;
    active: boolean;
    customPermissions: PermissionName[];
  }) =>
    requestJson<{ user: SessionUser }>('/api/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateUser: (
    userId: string,
    payload: {
      loginId: string;
      password?: string;
      fullName: string;
      email: string;
      roleId: string;
      employeeId?: string;
      department?: string;
      active: boolean;
      customPermissions: PermissionName[];
    }
  ) =>
    requestJson<{ user: SessionUser }>(`/api/users/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  resetUserPassword: (userId: string) =>
    requestJson<{ ok: boolean; message: string }>(
      `/api/users/${encodeURIComponent(userId)}/reset-password`,
      { method: 'POST' }
    ),
  deleteUser: (userId: string) =>
    requestJson<{ ok: boolean }>(`/api/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    }),

  // Departments & Designations
  listDepartments: () =>
    requestJson<{ departments: string[]; designations: DepartmentDesignation[] }>('/api/departments'),
  createDepartment: (name: string) =>
    requestJson<{ departments: string[]; designations: DepartmentDesignation[] }>('/api/departments', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  createDesignation: (departmentName: string, designationName: string) =>
    requestJson<{
      designation: DepartmentDesignation;
      departments: string[];
      designations: DepartmentDesignation[];
    }>('/api/designations', {
      method: 'POST',
      body: JSON.stringify({ departmentName, designationName }),
    }),
  deleteDesignation: (id: string) =>
    requestJson<{ departments: string[]; designations: DepartmentDesignation[] }>(
      `/api/designations/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    ),

  // Employees
  listEmployees: () => requestJson<{ employees: Employee[] }>('/api/employees'),
  verifyEmployeeEmail: (email: string, kind: 'personal' | 'official', sendMail = false) =>
    requestJson<{ ok: boolean; verified: boolean; email: string; kind: string; message: string }>(
      '/api/employees/verify-email',
      {
        method: 'POST',
        body: JSON.stringify({ email, kind, sendMail }),
      }
    ),
  createEmployee: (
    payload: Omit<Employee, 'id' | 'employeeId'> & {
      id?: string;
      employeeId?: string;
      password?: string;
    }
  ) =>
    requestJson<{ employee: Employee; user?: SessionUser; queuedAccountMailId?: string | null }>(
      '/api/employees',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  bulkImportEmployees: (csvText: string, duplicatePolicy: 'skip' | 'update' = 'skip') =>
    requestJson<BulkEmployeeImportResult>('/api/employees/bulk-import', {
      method: 'POST',
      body: JSON.stringify({ csvText, duplicatePolicy }),
    }),
  updateEmployee: (id: string, payload: Partial<Employee> & { password?: string }) =>
    requestJson<{ employee: Employee; passwordUpdated?: boolean; userAccountCreated?: boolean }>(
      `/api/employees/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),
  deleteEmployee: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/employees/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  updateManagerMapping: (
    id: string,
    payload: { isManager?: boolean; reportingManagerId?: string }
  ) =>
    requestJson<{ employee: Employee }>(
      `/api/employees/${encodeURIComponent(id)}/manager-mapping`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),

  // Personnel Entities (Consultant, Retainer, Freelancer, YRP, Intern)
  listEntities: (type?: PersonnelEntityType) => {
    const suffix = type ? `?type=${encodeURIComponent(type)}` : '';
    return requestJson<{ entities: PersonnelEntity[] }>(`/api/entities${suffix}`);
  },
  createEntity: (
    payload: Omit<PersonnelEntity, 'id' | 'createdAt'> & {
      id?: string;
      password?: string;
    }
  ) =>
    requestJson<{ entity: PersonnelEntity; user?: SessionUser }>('/api/entities', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateEntity: (id: string, payload: Partial<PersonnelEntity> & { password?: string }) =>
    requestJson<{ entity: PersonnelEntity; passwordUpdated?: boolean; userAccountCreated?: boolean }>(
      `/api/entities/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),
  toggleConsultantManager: (id: string, isManager: boolean, forceUnassign = false) =>
    requestJson<{ entity: PersonnelEntity }>(
      `/api/entities/${encodeURIComponent(id)}/manager-toggle`,
      {
        method: 'PUT',
        body: JSON.stringify({ isManager, forceUnassign }),
      }
    ),
  deleteEntity: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/entities/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  bulkImportEntities: (
    entityType: PersonnelEntityType,
    csvText: string,
    duplicatePolicy: 'skip' | 'update' = 'skip'
  ) =>
    requestJson<BulkDirectoryImportResult & { entities: PersonnelEntity[] }>(
      '/api/entities/bulk-import',
      {
        method: 'POST',
        body: JSON.stringify({ entityType, csvText, duplicatePolicy }),
      }
    ),
  listEmploymentConversions: () =>
    requestJson<{ conversions: EmploymentConversionRecord[] }>('/api/workforce/conversions'),
  convertEmploymentType: (payload: {
    sourceCategory: EmploymentCategory;
    sourceId: string;
    targetCategory: EmploymentCategory;
    newCode?: string;
    department?: string;
    designation?: string;
    reason?: string;
  }) =>
    requestJson<{
      ok: true;
      conversion: EmploymentConversionRecord;
      targetId: string;
      targetCode: string;
    }>('/api/workforce/convert', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Employee Centers (Indian Locations)
  listCenters: () => requestJson<{ centers: EmployeeCenterRecord[] }>('/api/centers'),
  createCenter: (payload: {
    cityName: string;
    stateName?: string;
    centerCode?: string;
    officialAddress?: string;
    phone?: string;
  }) =>
    requestJson<{ center: EmployeeCenterRecord }>('/api/centers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateCenter: (
    id: string,
    payload: {
      cityName?: string;
      stateName?: string;
      centerCode?: string;
      officialAddress?: string;
      phone?: string;
    }
  ) =>
    requestJson<{ center: EmployeeCenterRecord }>(`/api/centers/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  bulkImportCenters: (rawText: string, replaceExisting = false) =>
    requestJson<{ addedCount: number; skippedCount: number; centers: EmployeeCenterRecord[] }>(
      '/api/centers/bulk',
      {
        method: 'POST',
        body: JSON.stringify({ rawText, replaceExisting }),
      }
    ),
  deleteCenter: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/centers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Team Members & Manager Queue
  getTeamMembers: (managerId?: string) => {
    const suffix = managerId ? `?managerId=${encodeURIComponent(managerId)}` : '';
    return requestJson<{
      members: Employee[];
      managers: Employee[];
      consultantManagers?: PersonnelEntity[];
      candidateEmployees?: Employee[];
    }>(`/api/team/members${suffix}`);
  },
  assignTeamMembers: (payload: {
    managerId?: string;
    addEmployeeIds?: string[];
    removeEmployeeIds?: string[];
  }) =>
    requestJson<{ updatedCount: number; employees: Employee[] }>('/api/team/assign', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getTeamLeaves: () => requestJson<{ leaves: LeaveRecord[] }>('/api/team/leaves'),

  // Attendance
  listAttendance: (params?: {
    date?: string;
    month?: string;
    department?: string;
    status?: string;
    employeeId?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.date) qs.set('date', params.date);
    if (params?.month) qs.set('month', params.month);
    if (params?.department) qs.set('department', params.department);
    if (params?.status) qs.set('status', params.status);
    if (params?.employeeId) qs.set('employeeId', params.employeeId);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return requestJson<{ records: AttendanceRecord[] }>(`/api/attendance${suffix}`);
  },
  getAttendanceDashboard: (date?: string) => {
    const suffix = date ? `?date=${encodeURIComponent(date)}` : '';
    return requestJson<{ stats: AttendanceDashboardStats; todayDate: string }>(
      `/api/attendance/dashboard${suffix}`
    );
  },
  checkIn: (payload: {
    employeeId?: string;
    date?: string;
    checkInTime?: string;
    remarks?: string;
  }) =>
    requestJson<{ record: AttendanceRecord }>('/api/attendance/check-in', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  checkOut: (payload: {
    employeeId?: string;
    date?: string;
    checkOutTime?: string;
    remarks?: string;
  }) =>
    requestJson<{ record: AttendanceRecord }>('/api/attendance/check-out', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createManualAttendance: (payload: {
    employeeId: string;
    attendanceDate: string;
    checkInTime: string | null;
    checkOutTime: string | null;
    status: AttendanceStatus;
    remarks: string;
  }) =>
    requestJson<{ record: AttendanceRecord }>('/api/attendance', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateAttendance: (
    id: string,
    payload: {
      checkInTime?: string | null;
      checkOutTime?: string | null;
      status?: AttendanceStatus;
      remarks?: string;
      correctionStatus?: 'None' | 'Pending' | 'Approved' | 'Rejected';
    }
  ) =>
    requestJson<{ record: AttendanceRecord }>(`/api/attendance/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteAttendance: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/attendance/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  getDailyReport: (date: string, department?: string) => {
    const qs = new URLSearchParams({ date });
    if (department) qs.set('department', department);
    return requestJson<{ date: string; rows: DailyAttendanceReportRow[] }>(
      `/api/attendance/reports/daily?${qs.toString()}`
    );
  },
  getMonthlyReport: (month: string, department?: string) => {
    const qs = new URLSearchParams({ month });
    if (department) qs.set('department', department);
    return requestJson<{ month: string; rows: MonthlyAttendanceReportRow[] }>(
      `/api/attendance/reports/monthly?${qs.toString()}`
    );
  },
  getAttendanceRegister: (params: {
    month: string;
    department?: string;
    center?: string;
    employeeId?: string;
  }) => {
    const qs = new URLSearchParams({ month: params.month });
    if (params.department) qs.set('department', params.department);
    if (params.center) qs.set('center', params.center);
    if (params.employeeId) qs.set('employeeId', params.employeeId);
    return requestJson<{ register: AttendanceRegisterData }>(
      `/api/attendance/register?${qs.toString()}`
    );
  },
  listAuditLogs: () => requestJson<{ logs: AttendanceAuditLog[] }>('/api/attendance/audit-logs'),

  // Leaves
  listLeaves: () => requestJson<{ leaves: LeaveRecord[] }>('/api/leaves'),
  getLeaveBalances: (year?: number, asOfMonth?: number) => {
    const qs = new URLSearchParams();
    if (year) qs.set('year', String(year));
    if (asOfMonth) qs.set('asOfMonth', String(asOfMonth));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return requestJson<{ year: number; balances: LeaveBalanceSummary[] }>(`/api/leaves/balances${suffix}`);
  },
  createLeave: (payload: {
    employeeId?: string;
    leaveType: LeaveType;
    startDate: string;
    endDate: string;
    reason: string;
  }) =>
    requestJson<{ leave: LeaveRecord }>('/api/leaves', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  reviewLeave: (id: string, status: 'Approved' | 'Rejected', remarks?: string) =>
    requestJson<{ leave: LeaveRecord }>(`/api/leaves/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ status, remarks }),
    }),

  // Employee Policies (PDF Viewer + Admin Versioned Management)
  listPolicies: () => requestJson<{ policies: PolicyDocumentRecord[] }>('/api/policies'),
  fetchPolicyPdfBlob: async (id: string, download = false): Promise<Blob> => {
    const token = getStoredToken();
    const qs = download ? '?download=1' : '';
    const res = await fetch(`/api/policies/${encodeURIComponent(id)}/file${qs}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new ApiError(
        res.status,
        typeof errData?.error === 'string' ? errData.error : `Failed to load policy PDF (${res.status})`
      );
    }
    return res.blob();
  },
  createPolicy: (payload: {
    category: string;
    title: string;
    description?: string;
    version?: string;
    fileName: string;
    contentBase64: string;
    notes?: string;
    visibleRoles?: EmploymentCategory[];
  }) =>
    requestJson<{ policy: PolicyDocumentRecord }>('/api/policies', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updatePolicy: (
    id: string,
    payload: {
      category?: string;
      title?: string;
      description?: string;
      fileName?: string;
      contentBase64?: string;
      versionBump?: 'minor' | 'major';
      notes?: string;
      visibleRoles?: EmploymentCategory[];
    }
  ) =>
    requestJson<{ policy: PolicyDocumentRecord }>(`/api/policies/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deletePolicy: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/policies/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  listPolicyAcknowledgments: (policyId?: string) => {
    const suffix = policyId ? `?policyId=${encodeURIComponent(policyId)}` : '';
    return requestJson<{ acknowledgments: PolicyAcknowledgmentRecord[] }>(
      `/api/policies/acknowledgments${suffix}`
    );
  },
  acknowledgePolicy: (policyId: string) =>
    requestJson<{ acknowledgment: PolicyAcknowledgmentRecord }>(
      `/api/policies/${encodeURIComponent(policyId)}/acknowledge`,
      { method: 'POST' }
    ),

  // Public Holidays
  listHolidays: (params?: { center?: string; month?: string; year?: number }) => {
    const qs = new URLSearchParams();
    if (params?.center) qs.set('center', params.center);
    if (params?.month) qs.set('month', params.month);
    if (params?.year) qs.set('year', String(params.year));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return requestJson<{ holidays: PublicHoliday[] }>(`/api/holidays${suffix}`);
  },
  createHoliday: (payload: {
    title: string;
    holidayDate: string;
    center: string;
    description?: string;
    isNational?: boolean;
  }) =>
    requestJson<{ holiday: PublicHoliday; notifiedCount: number }>('/api/holidays', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateHoliday: (
    id: string,
    payload: {
      title?: string;
      holidayDate?: string;
      center?: string;
      description?: string;
    }
  ) =>
    requestJson<{ holiday: PublicHoliday }>(`/api/holidays/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteHoliday: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/holidays/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Workflow Requests (Regularization, WFH, Profile Change)
  listWorkflowRequests: (type?: WorkflowRequestType) => {
    const suffix = type ? `?type=${encodeURIComponent(type)}` : '';
    return requestJson<{ requests: WorkflowRequestRecord[] }>(`/api/workflow-requests${suffix}`);
  },
  submitRegularization: (payload: {
    employeeId?: string;
    targetDate: string;
    requestedCheckIn: string;
    requestedCheckOut: string;
    reason: string;
  }) =>
    requestJson<{ request: WorkflowRequestRecord }>('/api/attendance/regularizations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  submitWfh: (payload: {
    employeeId?: string;
    targetDate: string;
    endDate?: string;
    reason: string;
  }) =>
    requestJson<{ request: WorkflowRequestRecord }>('/api/attendance/wfh', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  submitProfileChange: (
    employeeId: string,
    payload: {
      reason: string;
      payload: {
        name?: string;
        phone?: string;
        email?: string;
        center?: string;
        department?: string;
        designation?: string;
      };
    }
  ) =>
    requestJson<{ request: WorkflowRequestRecord }>(
      `/api/employees/${encodeURIComponent(employeeId)}/profile-change-requests`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  reviewWorkflowRequest: (id: string, status: 'Approved' | 'Rejected', reviewNotes?: string) =>
    requestJson<{ request: WorkflowRequestRecord }>(
      `/api/workflow-requests/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ status, reviewNotes }),
      }
    ),

  // Email Management Dashboard
  getMailLogs: (status?: string) => {
    const suffix = status ? `?status=${encodeURIComponent(status)}` : '';
    return requestJson<{ logs: EmailLogRecord[] }>(`/api/mail/logs${suffix}`);
  },
  getMailReports: () =>
    requestJson<{
      summary: EmailDashboardSummary;
      managerReports: ManagerMailReportRow[];
      employeeReports: EmployeeMailReportRow[];
    }>('/api/mail/reports'),
  getMailAudit: () => requestJson<{ logs: EmailAuditRecord[] }>('/api/mail/audit'),
  getMailStatus: () => requestJson<{ status: MailHealthStatus }>('/api/mail/status'),
  sendMailLogNow: (id: string) =>
    requestJson<{ ok: boolean; message: string; log: EmailLogRecord }>(
      `/api/mail/send/${encodeURIComponent(id)}`,
      { method: 'POST' }
    ),
  sendEntityMail: (relatedEntityType: string, relatedEntityId: string) =>
    requestJson<{ ok: boolean; message: string; log: EmailLogRecord }>('/api/mail/send-entity', {
      method: 'POST',
      body: JSON.stringify({ relatedEntityType, relatedEntityId }),
    }),
  retryMail: (id: string) =>
    requestJson<{ ok: boolean; message?: string; log: EmailLogRecord }>(
      `/api/mail/retry/${encodeURIComponent(id)}`,
      { method: 'POST' }
    ),
  processMailQueue: () =>
    requestJson<{ dispatch: { processed: number; sent: number; failedOrRetrying: number } }>(
      '/api/mail/process-queue',
      { method: 'POST' }
    ),
  testMailConnections: () =>
    requestJson<{
      smtp: { ok: boolean; details: string };
      imap: { ok: boolean; details: string; mailboxMessages?: number };
    }>('/api/mail/test-connections', { method: 'POST' }),
  requestSenderChangeOtp: (newEmail: string) =>
    requestJson<{
      ok: boolean;
      otpId: string;
      currentEmail: string;
      newEmail: string;
      mailDispatched: boolean;
      sandboxOtpPreview?: string;
      message: string;
    }>('/api/mail/sender-change/request-otp', {
      method: 'POST',
      body: JSON.stringify({ newEmail }),
    }),
  verifySenderChangeOtp: (payload: { otpId?: string; otpCode: string }) =>
    requestJson<{
      ok: boolean;
      otpId: string;
      oldEmail: string;
      newEmail: string;
      confirmationSent: boolean;
    }>('/api/mail/sender-change/verify-otp', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  completeSenderChange: (payload: {
    otpId?: string;
    smtpHost: string;
    smtpPort: number;
    encryption: 'tls' | 'ssl' | 'none';
    imapHost: string;
    imapPort: number;
    appPassword: string;
    appName: string;
  }) =>
    requestJson<{ ok: boolean; message: string; status: MailHealthStatus }>(
      '/api/mail/sender-change/complete',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  // Workspace, Assets, Batch Update & Operations
  getWorkspaceState: () => requestJson<{ state: AssetOSState }>('/api/workspace/state'),
  updateWorkspaceSettings: (payload: {
    settings?: CompanySettings;
    categories?: string[];
    departments?: string[];
    locations?: string[];
  }) =>
    requestJson<{
      settings: CompanySettings;
      categories: string[];
      departments: string[];
      locations: string[];
    }>('/api/workspace/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  addWorkspaceOption: (kind: 'category' | 'department' | 'location', value: string) =>
    requestJson<{
      settings: CompanySettings;
      categories: string[];
      departments: string[];
      locations: string[];
    }>('/api/workspace/options', {
      method: 'POST',
      body: JSON.stringify({ kind, value }),
    }),
  createAsset: (payload: Omit<Asset, 'id'> & { id?: string }) =>
    requestJson<{ asset: Asset }>('/api/assets', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateAsset: (id: string, payload: Partial<Asset>) =>
    requestJson<{ asset: Asset }>(`/api/assets/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteAsset: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/assets/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  bulkUpdateAssets: (payload: {
    assetIds: string[];
    status?: AssetStatus;
    department?: string;
    notes?: string;
  }) =>
    requestJson<{ updatedAssets: Asset[]; updatedCount: number }>('/api/assets/bulk-update', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  bulkImportAssets: (assets: Array<Omit<Asset, 'id'>>) =>
    requestJson<{ assets: Asset[] }>('/api/assets/bulk-import', {
      method: 'POST',
      body: JSON.stringify({ assets }),
    }),
  assignAsset: (payload: {
    assetId: string;
    employeeId: string;
    assigneeType?: AssigneeEntityType;
    assignDate: string;
    condition: Asset['condition'];
    notes: string;
    projectName?: string;
    projectNo?: string;
    eicName?: string;
    allotment?: {
      flpId?: string;
      flpName?: string;
      flpCode?: string;
      flpAddress?: string;
      aadhaarNo?: string;
      panNo?: string;
      mobileNo?: string;
      centerName?: string;
      executiveName?: string;
      executiveEmpId?: string;
      jobNumber?: string;
      issueDate?: string;
      accessories?: FreelancerAccessoryItem[];
      remarks?: string;
      witness1Name?: string;
      witness2Name?: string;
      allotmentDate?: string;
    };
  }) =>
    requestJson<{
      assignment: Assignment;
      asset: Asset;
      allotment?: FreelancerAllotmentRecord;
    }>('/api/assignments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteAssignment: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/assignments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  listFreelancerAllotments: () =>
    requestJson<{ allotments: FreelancerAllotmentRecord[] }>('/api/freelancer-allotments'),
  createSubAssignment: (payload: {
    assetId: string;
    assigneeId: string;
    assigneeType: AssigneeEntityType;
    assignDate: string;
    condition?: Asset['condition'];
    notes?: string;
    projectName?: string;
    projectNo?: string;
    eicName?: string;
    allotment?: {
      flpId?: string;
      flpName?: string;
      flpCode?: string;
      flpAddress?: string;
      aadhaarNo?: string;
      panNo?: string;
      mobileNo?: string;
      centerName?: string;
      executiveName?: string;
      executiveEmpId?: string;
      jobNumber?: string;
      issueDate?: string;
      accessories?: FreelancerAccessoryItem[];
      remarks?: string;
      witness1Name?: string;
      witness2Name?: string;
      allotmentDate?: string;
    };
  }) =>
    requestJson<{
      assignment: Assignment;
      asset: Asset;
      allotment?: FreelancerAllotmentRecord;
    }>('/api/sub-assignments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  returnSubAssignment: (
    assignmentId: string,
    payload?: {
      date?: string;
      condition?: Asset['condition'];
      damage?: AssetReturn['damage'];
      remarks?: string;
    }
  ) =>
    requestJson<{
      assignment?: Assignment;
      assetReturn: AssetReturn;
      asset: Asset;
    }>(`/api/sub-assignments/${encodeURIComponent(assignmentId)}/return`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
  returnAsset: (payload: {
    assetId: string;
    employeeId: string;
    assignmentId?: string;
    custodyLevel?: 'Primary' | 'Sub-Assigned';
    date: string;
    condition: Asset['condition'];
    damage: AssetReturn['damage'];
    remarks: string;
  }) =>
    requestJson<{ assetReturn: AssetReturn; asset: Asset }>('/api/returns', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteReturn: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/returns/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  transferAsset: (payload: {
    assetId: string;
    currentEmployeeId: string;
    newEmployeeId: string;
    date: string;
    newLocation: string;
    reason: string;
    remarks: string;
  }) =>
    requestJson<{ transfer: AssetTransfer; assignment: Assignment; asset: Asset }>('/api/transfers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteTransfer: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/transfers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  saveMaintenance: (payload: Omit<MaintenanceRecord, 'id'> & { id?: string }) =>
    payload.id
      ? requestJson<{ maintenance: MaintenanceRecord }>(`/api/maintenance/${encodeURIComponent(payload.id)}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
      : requestJson<{ maintenance: MaintenanceRecord }>('/api/maintenance', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
  deleteMaintenance: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/maintenance/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  disposeAsset: (payload: Omit<DisposalRecord, 'id'>) =>
    requestJson<{ disposal: DisposalRecord }>('/api/disposals', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  saveVendor: (payload: Omit<Vendor, 'id'> & { id: string }, isEdit = false) =>
    isEdit
      ? requestJson<{ vendor: Vendor }>(`/api/vendors/${encodeURIComponent(payload.id)}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
      : requestJson<{ vendor: Vendor }>('/api/vendors', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
  bulkImportVendors: (csvText: string, duplicatePolicy: 'skip' | 'update' = 'skip') =>
    requestJson<BulkDirectoryImportResult & { vendors: Vendor[] }>('/api/vendors/bulk-import', {
      method: 'POST',
      body: JSON.stringify({ csvText, duplicatePolicy }),
    }),
  deleteVendor: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/vendors/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  listExpenseCategories: (activeOnly = false) =>
    requestJson<{ categories: ExpenseCategoryRecord[] }>(
      `/api/expense-categories${activeOnly ? '?activeOnly=1' : ''}`
    ),
  createExpenseCategory: (payload: { name: string; description?: string; active?: boolean }) =>
    requestJson<{ category: ExpenseCategoryRecord }>('/api/expense-categories', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateExpenseCategory: (
    id: string,
    payload: { name?: string; description?: string; active?: boolean }
  ) =>
    requestJson<{ category: ExpenseCategoryRecord }>(
      `/api/expense-categories/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),
  toggleExpenseCategory: (id: string, active: boolean) =>
    requestJson<{ category: ExpenseCategoryRecord }>(
      `/api/expense-categories/${encodeURIComponent(id)}/toggle`,
      {
        method: 'PUT',
        body: JSON.stringify({ active }),
      }
    ),
  deleteExpenseCategory: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/expense-categories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  listPaymentModes: (activeOnly = false) =>
    requestJson<{ modes: PaymentModeRecord[] }>(
      `/api/payment-modes${activeOnly ? '?activeOnly=1' : ''}`
    ),
  createPaymentMode: (payload: { name: string; description?: string; active?: boolean }) =>
    requestJson<{ mode: PaymentModeRecord }>('/api/payment-modes', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updatePaymentMode: (
    id: string,
    payload: { name?: string; description?: string; active?: boolean }
  ) =>
    requestJson<{ mode: PaymentModeRecord }>(`/api/payment-modes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  togglePaymentMode: (id: string, active: boolean) =>
    requestJson<{ mode: PaymentModeRecord }>(
      `/api/payment-modes/${encodeURIComponent(id)}/toggle`,
      {
        method: 'PUT',
        body: JSON.stringify({ active }),
      }
    ),
  deletePaymentMode: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/payment-modes/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  saveExpense: (payload: Omit<ExpenseRecord, 'id'> & { id: string }, isEdit = false) =>
    isEdit
      ? requestJson<{ expense: ExpenseRecord }>(`/api/expenses/${encodeURIComponent(payload.id)}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
      : requestJson<{ expense: ExpenseRecord }>('/api/expenses', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
  deleteExpense: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/expenses/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  createTicket: (payload: Partial<SupportTicket> & { assetId: string; subject: string; description: string; priority: SupportTicket['priority'] }) =>
    requestJson<{ ticket: SupportTicket }>('/api/tickets', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateTicket: (id: string, payload: Partial<SupportTicket> & { action?: 'approve' | 'reject' | 'close'; reason?: string }) =>
    requestJson<{ ticket: SupportTicket }>(`/api/tickets/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  reorderTickets: (orderedIds: string[]) =>
    requestJson<{ tickets: SupportTicket[] }>('/api/tickets/reorder', {
      method: 'PUT',
      body: JSON.stringify({ orderedIds }),
    }),
  scheduleTicketWorkOrder: (
    id: string,
    payload: { workOrderDate: string; workOrderStartTime: string; workOrderDurationMins: number }
  ) =>
    requestJson<{ ticket: SupportTicket; queuedMailId?: string | null }>(
      `/api/tickets/${encodeURIComponent(id)}/work-order`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  confirmTicketWorkOrder: (id: string) =>
    requestJson<{ ticket: SupportTicket }>(`/api/tickets/${encodeURIComponent(id)}/confirm`, {
      method: 'POST',
    }),
  closeTicket: (id: string) =>
    requestJson<{ ticket: SupportTicket }>(`/api/tickets/${encodeURIComponent(id)}/close`, {
      method: 'POST',
    }),
  sendTicketWorkOrderMail: (id: string) =>
    requestJson<{ ok: boolean; message: string; ticket: SupportTicket; log: EmailLogRecord }>(
      `/api/tickets/${encodeURIComponent(id)}/send-mail`,
      { method: 'POST' }
    ),

  // System Audit & Enterprise Backup/Restore
  listSystemAuditLogs: (limit = 250) =>
    requestJson<{ logs: SystemAuditLog[] }>(`/api/audit-logs?limit=${limit}`),
  exportBackup: () => requestJson<{ backup: Record<string, unknown> }>('/api/backup/export'),
  restoreBackup: (backup: Record<string, unknown>, mode: 'merge' | 'replace' = 'merge') =>
    requestJson<{ restoredCounts: Record<string, number> }>('/api/backup/restore', {
      method: 'POST',
      body: JSON.stringify({ backup, mode }),
    }),
};
