import crypto from 'node:crypto';
import express, { type Express } from 'express';
import { validatePasswordStrength } from '../src/auth/authLogic.ts';
import {
  isValidPermission,
  type PermissionName,
} from '../src/auth/permissions.ts';
import {
  acknowledgePolicyInDb,
  assignTeamMembersToManagerInDb,
  bulkImportEmployeeCentersInDb,
  bulkImportEmployeesInDb,
  bulkImportPersonnelEntitiesInDb,
  canUserViewPolicy,
  checkInEmployeeInDb,
  checkOutEmployeeInDb,
  consumeApprovalTokenInDb,
  consumeMailChangeOtpInDb,
  convertEmploymentTypeInDb,
  createDepartmentInDb,
  createDesignationInDb,
  createEmployeeCenterInDb,
  createEmployeeInDb,
  createLeaveInDb,
  createMailChangeOtpInDb,
  createOrUpdateManualAttendanceInDb,
  createPersonnelEntityInDb,
  createPolicyInDb,
  createPublicHolidayInDb,
  createUserInDb,
  createWorkflowRequestInDb,
  deleteAttendanceInDb,
  deleteDesignationInDb,
  deleteEmployeeCenterInDb,
  deleteEmployeeInDb,
  deletePersonnelEntityInDb,
  deletePolicyInDb,
  deletePublicHolidayInDb,
  deleteUserInDb,
  enqueueEmailInDb,
  getAttendanceById,
  getEmailDashboardSummaryAndReportsFromDb,
  getPolicyByIdFromDb,
  getPolicyPdfBufferFromDb,
  getSessionUserById,
  getUserAuthRowByLoginOrEmail,
  getVerifiedMailChangeOtpInDb,
  getVisitorAnalyticsSummaryFromDb,
  listAttendanceFromDb,
  listAuditLogsFromDb,
  listDepartmentsAndDesignationsFromDb,
  listEmailAuditLogsFromDb,
  listEmailLogsFromDb,
  listEmployeeCentersFromDb,
  listEmployeesFromDb,
  listEmploymentConversionsFromDb,
  listLeavesFromDb,
  listPermissions,
  listPersonnelEntitiesFromDb,
  listPoliciesFromDb,
  listPolicyAcknowledgmentsFromDb,
  listPublicHolidaysFromDb,
  listRolesWithPermissions,
  listUsersWithPermissions,
  listWorkflowRequestsFromDb,
  markUserOfflineInDb,
  recordSiteVisitInDb,
  resetUserPasswordInDb,
  reviewLeaveInDb,
  reviewWorkflowRequestInDb,
  saveMailConfigInDb,
  syncNationalHolidaysForRange,
  toggleConsultantManagerInDb,
  updateEmployeeCenterInDb,
  updateEmployeeInDb,
  updatePersonnelEntityInDb,
  updatePolicyInDb,
  updatePublicHolidayInDb,
  updateRolePermissionsInDb,
  updateUserInDb,
  updateUserThemePreferenceInDb,
  upsertUserPresenceInDb,
  verifyMailChangeOtpInDb,
  type AppDatabase,
} from '../src/db/sqlite.ts';
import {
  addQuickOptionInDb,
  assignAssetInDb,
  bulkImportVendorsInDb,
  bulkUpdateAssetsInDb,
  createAssetInDb,
  createExpenseCategoryInDb,
  createPaymentModeInDb,
  createTicketInDb,
  deleteAssetInDb,
  deleteAssignmentInDb,
  deleteExpenseCategoryInDb,
  deleteExpenseInDb,
  deleteMaintenanceInDb,
  deletePaymentModeInDb,
  deleteReturnInDb,
  deleteTransferInDb,
  deleteVendorInDb,
  disposeAssetInDb,
  exportFullBackupFromDb,
  importAssetsInDb,
  listAllTicketsFromDb,
  listExpenseCategoriesFromDb,
  listFreelancerAllotmentsFromDb,
  listPaymentModesFromDb,
  listSystemAuditLogsFromDb,
  listWorkspaceStateFromDb,
  reorderTicketsInDb,
  restoreFullBackupInDb,
  returnAssetInDb,
  saveExpenseInDb,
  saveMaintenanceInDb,
  saveVendorInDb,
  subAssignAssetInDb,
  toggleExpenseCategoryActiveInDb,
  togglePaymentModeActiveInDb,
  transferAssetInDb,
  updateAssetInDb,
  updateExpenseCategoryInDb,
  updatePaymentModeInDb,
  updateTicketInDb,
  updateWorkspaceSettingsInDb,
  type AuditActorContext,
} from '../src/db/workspaceStore.ts';
import { DEFAULT_INDIAN_CENTER, normalizeCenterName } from '../src/data/indianCenters.ts';
import type { AssetStatus, Employee, EmploymentCategory, PersonnelEntityType } from '../src/types/asset.ts';
import type { AttendanceStatus, WorkflowRequestType } from '../src/types/attendance.ts';
import {
  formatFiveDigitEmployeeId,
  normalizeThemePalette,
  validateFiveDigitEmployeeId,
} from '../src/utils/assetMath.ts';
import {
  buildDailyAttendanceReport,
  buildMonthlyAttendanceRegister,
  buildMonthlyAttendanceReport,
  computeAttendanceDashboardStats,
} from '../src/utils/attendanceLogic.ts';
import {
  canManagePolicies,
  canModifyManagerFields,
  canUserApproveLeave,
  getDirectReportsForManager,
  isAdminRole,
  isEmployeeManagerUser,
  resolveEmployeeByIdentifier,
} from '../src/utils/hierarchyLogic.ts';
import {
  computeEmployeeLeaveBucket,
  countChargeableLeaveDays,
} from '../src/utils/leaveAccrual.ts';
import { parseVisibleRoles } from '../src/utils/policyLogic.ts';
import {
  confirmWorkOrderByEmployee,
  createSupportTicketRecord,
  hasAdminSlotOverlap,
  transitionTicketStatus,
} from '../src/utils/ticketLogic.ts';
import { renderApprovalOutcomeHtml } from './emailTemplates.ts';
import {
  ADMIN_MAIL_CONFIG_ERROR,
  ADMIN_MAIL_CONFIG_SUCCESS,
  getEffectiveMailConfig,
  getPublicMailStatus,
  hasCustomTestMailTransport,
  sendLiveLoopbackVerification,
  sendMailViaSmtp,
  verifyAndSyncImap,
  verifySmtpConnection,
} from './mailer.ts';
import {
  getRequestBaseUrl,
  notifyEmployeeAttendanceCorrection,
  notifyEmployeeLeaveDecision,
  notifyEmployeesHolidayPublished,
  notifyEmployeeWorkflowDecision,
  notifyManagerLateAttendance,
  notifyManagerLeaveSubmitted,
  notifyManagerNewEmployee,
  notifyManagerWorkflowSubmitted,
  notifyTicketWorkOrderScheduled,
  notifyUserAccountCreated,
  notifyUserPasswordReset,
  notifyUserRoleOrPermissionsChanged,
  processMailQueueOnce,
  sendEmailLogNow,
} from './mailQueue.ts';
import {
  canUserAccessEmployee,
  filterEmployeesForUser,
  isOrgWideAttendanceRole,
  requireAnyPermission,
  requireAuth,
  requirePermission,
  type AuthenticatedRequest,
} from './middleware/rbac.ts';
import { revokeJwt, signJwt, verifyJwt, verifyPassword } from './security.ts';

function getTodayDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getCurrentTimeStr(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function generateStrongTempPassword(): string {
  const token = crypto.randomBytes(4).toString('hex');
  return `Mdn@${token}9`;
}

function getClientIp(req: express.Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  if (Array.isArray(fwd) && fwd.length > 0) {
    return String(fwd[0]).trim();
  }
  return req.ip || req.socket?.remoteAddress || '127.0.0.1';
}

function buildAuditActor(req: AuthenticatedRequest): AuditActorContext {
  return {
    userId: req.authUser?.id || 'system',
    userName: req.authUser?.fullName || 'System',
    userRole: req.authUser?.role || 'System',
    ipAddress: getClientIp(req),
  };
}

function isAssetOpsWriteRole(role?: string): boolean {
  return role === 'Super Admin' || role === 'Administrator' || role === 'Manager';
}

function sendStoreError(res: express.Response, err: unknown, fallback = 'Operation failed.') {
  const raw = err instanceof Error ? err.message : fallback;
  if (raw.startsWith('CONFLICT:')) {
    return res.status(409).json({ error: raw.slice('CONFLICT:'.length) });
  }
  if (raw.startsWith('NOT_FOUND:')) {
    return res.status(404).json({ error: raw.slice('NOT_FOUND:'.length) });
  }
  if (raw.startsWith('VALIDATION:')) {
    return res.status(400).json({ error: raw.slice('VALIDATION:'.length) });
  }
  if (raw.startsWith('Access Denied')) {
    return res.status(403).json({ error: raw });
  }
  return res.status(400).json({ error: raw });
}

const LOGIN_FAILURE_WINDOW_MS = 5 * 60_000;
const LOGIN_FAILURE_MAX_ATTEMPTS = 15;
const loginFailuresByKey = new Map<string, number[]>();

function isLoginLockedOut(key: string): boolean {
  const now = Date.now();
  const timestamps = (loginFailuresByKey.get(key) || []).filter((t) => now - t <= LOGIN_FAILURE_WINDOW_MS);
  if (timestamps.length === 0) {
    loginFailuresByKey.delete(key);
    return false;
  }
  loginFailuresByKey.set(key, timestamps);
  return timestamps.length >= LOGIN_FAILURE_MAX_ATTEMPTS;
}

function recordLoginFailure(key: string): void {
  const now = Date.now();
  const timestamps = (loginFailuresByKey.get(key) || []).filter((t) => now - t <= LOGIN_FAILURE_WINDOW_MS);
  timestamps.push(now);
  loginFailuresByKey.set(key, timestamps);
}

function clearLoginFailures(key: string): void {
  loginFailuresByKey.delete(key);
}

function resolveEmployeeOrEntityForNotification(
  db: AppDatabase,
  idOrCode?: string | null
): Employee | null {
  if (!idOrCode) return null;
  const emp = listEmployeesFromDb(db).find(
    (e) => e.id === idOrCode || e.employeeId === idOrCode
  );
  if (emp) return emp;
  const ent = listPersonnelEntitiesFromDb(db).find(
    (e) => e.id === idOrCode || e.entityCode.toUpperCase() === idOrCode.trim().toUpperCase()
  );
  if (!ent) return null;
  return {
    id: ent.id,
    employeeId: ent.entityCode,
    name: ent.name,
    email: ent.email,
    personalEmail: ent.personalEmail,
    officialEmail: ent.officialEmail,
    department: ent.department || 'Operations',
    designation: ent.designation || ent.entityType,
    phone: ent.phone || '',
    branch: ent.center,
    center: ent.center,
    isManager: ent.isManager,
    status: ent.status,
  };
}

export function createApiApp(
  db: AppDatabase,
  _options?: { enableBackgroundWorker?: boolean }
): Express {
  const app = express();
  app.use(express.json({ limit: '15mb' }));
  // Background auto-mail worker disabled: emails dispatch only upon manual user action.

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // =========================================================================
  // AUTHENTICATION ROUTES
  // =========================================================================
  app.post('/api/auth/login', (req, res) => {
    const loginInput = typeof req.body?.loginId === 'string'
      ? req.body.loginId
      : typeof req.body?.email === 'string'
      ? req.body.email
      : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!loginInput.trim() || !password) {
      return res.status(401).json({ error: 'Invalid login ID or password.' });
    }

    const attemptKey = `${getClientIp(req)}:${loginInput.trim().toLowerCase()}`;
    if (isLoginLockedOut(attemptKey)) {
      return res.status(429).json({
        error: 'Too many failed login attempts. Please wait a few minutes and try again.',
      });
    }

    const found = getUserAuthRowByLoginOrEmail(db, loginInput);
    if (!found || !verifyPassword(password, found.passwordHash)) {
      recordLoginFailure(attemptKey);
      return res.status(401).json({ error: 'Invalid login ID or password.' });
    }

    if (!found.user.active) {
      return res.status(403).json({
        error: 'Your account is inactive. Please contact an administrator.',
      });
    }

    clearLoginFailures(attemptKey);

    const token = signJwt({
      sub: found.user.id,
      loginId: found.user.loginId,
      role: found.user.role,
      roleId: found.user.roleId || '',
    });

    upsertUserPresenceInDb(db, found.user);
    const visitorKeyInput =
      typeof req.body?.visitorKey === 'string' && req.body.visitorKey.trim()
        ? req.body.visitorKey.trim()
        : `user:${found.user.id}`;
    recordSiteVisitInDb(db, { visitorKey: visitorKeyInput, userId: found.user.id });

    return res.json({ token, user: found.user });
  });

  app.post('/api/auth/forgot-password', (req, res) => {
    const identifier =
      typeof req.body?.loginId === 'string'
        ? req.body.loginId.trim()
        : typeof req.body?.email === 'string'
        ? req.body.email.trim()
        : '';

    if (!identifier) {
      return res.status(400).json({ error: 'Please provide your Login ID or registered email address.' });
    }

    const found = getUserAuthRowByLoginOrEmail(db, identifier);
    if (found && found.user.active) {
      const tempPassword = generateStrongTempPassword();
      const updatedUser = resetUserPasswordInDb(db, found.user.id, tempPassword);
      if (updatedUser) {
        const employees = listEmployeesFromDb(db);
        const linkedEmp = updatedUser.employeeId
          ? employees.find((e) => e.id === updatedUser.employeeId || e.employeeId === updatedUser.employeeId) || null
          : null;
        notifyUserPasswordReset(db, {
          user: updatedUser,
          temporaryPassword: tempPassword,
          employee: linkedEmp,
          baseUrl: getRequestBaseUrl(req),
          resetId: crypto.randomUUID(),
        });
      }
    }

    return res.json({
      ok: true,
      message: 'If an active matching account was found, a password reset email has been queued.',
    });
  });

  app.post('/api/auth/logout', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (req.authToken) {
      revokeJwt(req.authToken, db);
    }
    if (req.authUser?.id) {
      markUserOfflineInDb(db, req.authUser.id);
    }
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth(db), (req: AuthenticatedRequest, res) => {
    res.json({ user: req.authUser });
  });

  app.put('/api/auth/theme', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const normalizedTheme = normalizeThemePalette(
      typeof req.body?.theme === 'string' ? req.body.theme : ''
    );
    const updatedUser = updateUserThemePreferenceInDb(db, req.authUser!.id, normalizedTheme);
    return res.json({ theme: normalizedTheme, user: updatedUser });
  });

  // =========================================================================
  // VISITOR ANALYTICS & LIVE PRESENCE
  // =========================================================================
  app.post('/api/analytics/visit', (req, res) => {
    const rawVisitorKey =
      typeof req.body?.visitorKey === 'string' ? req.body.visitorKey.trim() : '';
    const ipUaHash = crypto
      .createHash('sha256')
      .update(`${getClientIp(req)}::${String(req.headers['user-agent'] || '')}`)
      .digest('hex')
      .slice(0, 24);
    const visitorKey = rawVisitorKey || `anon:${ipUaHash}`;

    let userId: string | undefined;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const payload = verifyJwt(authHeader.slice(7).trim(), db);
      if (payload?.sub) {
        userId = payload.sub;
      }
    }

    recordSiteVisitInDb(db, { visitorKey, userId });
    return res.json({ ok: true, summary: getVisitorAnalyticsSummaryFromDb(db) });
  });

  app.post('/api/analytics/heartbeat', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    upsertUserPresenceInDb(db, user);
    const rawVisitorKey =
      typeof req.body?.visitorKey === 'string' && req.body.visitorKey.trim()
        ? req.body.visitorKey.trim()
        : `user:${user.id}`;
    recordSiteVisitInDb(db, { visitorKey: rawVisitorKey, userId: user.id });
    return res.json({ ok: true, summary: getVisitorAnalyticsSummaryFromDb(db) });
  });

  app.get('/api/analytics/visitors', requireAuth(db), (_req, res) => {
    return res.json({ summary: getVisitorAnalyticsSummaryFromDb(db) });
  });

  // =========================================================================
  // ROLES & PERMISSIONS ROUTES
  // =========================================================================
  app.get(
    '/api/permissions',
    requireAuth(db),
    requireAnyPermission(['user.view', 'user.create', 'user.edit', 'role.manage']),
    (_req, res) => {
      res.json({ permissions: listPermissions(db) });
    }
  );

  app.get('/api/roles', requireAuth(db), (_req, res) => {
    res.json({ roles: listRolesWithPermissions(db) });
  });

  app.put(
    '/api/roles/:id/permissions',
    requireAuth(db),
    requirePermission('role.manage'),
    (req: AuthenticatedRequest, res) => {
      const roleId = String(req.params.id);
      const rawPerms = Array.isArray(req.body?.permissions) ? req.body.permissions : null;
      if (!rawPerms) {
        return res.status(400).json({ error: 'permissions array is required.' });
      }
      const validPerms = rawPerms.filter(
        (p: unknown): p is PermissionName => typeof p === 'string' && isValidPermission(p)
      );
      if (roleId === 'role_super_admin' && !validPerms.includes('role.manage')) {
        return res.status(400).json({
          error: 'Super Admin must retain role.manage permission.',
        });
      }
      const updated = updateRolePermissionsInDb(db, roleId, validPerms);
      if (!updated) {
        return res.status(404).json({ error: 'Role not found.' });
      }

      const baseUrl = getRequestBaseUrl(req);
      const employees = listEmployeesFromDb(db);
      const affectedUsers = listUsersWithPermissions(db).filter((u) => u.active && u.roleId === roleId);
      const changeKey = `${roleId}:${Date.now()}`;
      for (const targetUser of affectedUsers) {
        const linkedEmp = targetUser.employeeId
          ? employees.find((e) => e.id === targetUser.employeeId || e.employeeId === targetUser.employeeId) || null
          : null;
        notifyUserRoleOrPermissionsChanged(db, {
          user: targetUser,
          roleName: updated.roleName,
          permissions: targetUser.permissions,
          employee: linkedEmp,
          actorName: req.authUser?.fullName || 'Administrator',
          changeKey,
          baseUrl,
        });
      }

      return res.json({ role: updated });
    }
  );

  // =========================================================================
  // USER MANAGEMENT ROUTES (RBAC PROTECTED)
  // =========================================================================
  app.get('/api/users', requireAuth(db), requirePermission('user.view'), (_req, res) => {
    res.json({ users: listUsersWithPermissions(db) });
  });

  app.post('/api/users', requireAuth(db), requirePermission('user.create'), (req, res) => {
    const loginId = typeof req.body?.loginId === 'string' ? req.body.loginId.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const roleIdInput = typeof req.body?.roleId === 'string' ? req.body.roleId.trim() : '';
    const roleNameInput = typeof req.body?.role === 'string' ? req.body.role.trim() : '';
    const employeeId = typeof req.body?.employeeId === 'string' ? req.body.employeeId.trim() : '';
    const department = typeof req.body?.department === 'string' ? req.body.department.trim() : '';
    const active = req.body?.active !== false;
    const customPermissions = Array.isArray(req.body?.customPermissions)
      ? req.body.customPermissions.filter(
          (p: unknown): p is PermissionName => typeof p === 'string' && isValidPermission(p)
        )
      : [];

    const roles = listRolesWithPermissions(db);
    const matchedRole =
      roles.find((r) => r.id === roleIdInput) ||
      roles.find((r) => r.roleName.toLowerCase() === roleNameInput.toLowerCase()) ||
      (roleNameInput === 'Administrator' ? roles.find((r) => r.id === 'role_super_admin') : undefined) ||
      (roleNameInput === 'Manager' ? roles.find((r) => r.id === 'role_dept_manager') : undefined);

    const errors: Record<string, string> = {};
    if (!loginId || loginId.length < 3 || loginId.length > 30 || !/^[a-zA-Z0-9._-]+$/.test(loginId)) {
      errors.loginId =
        'Login ID must be 3-30 chars (letters, digits, dots, underscores, hyphens).';
    }
    if (!password) {
      errors.password = 'Password is required.';
    } else {
      const pwErr = validatePasswordStrength(password);
      if (pwErr) errors.password = pwErr;
    }
    if (!fullName) errors.fullName = 'Full Name is required.';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Please enter a valid email address.';
    }
    if (!matchedRole) {
      errors.role = 'Please select a valid role.';
    } else if (matchedRole.roleName === 'Employee' && !employeeId) {
      errors.employeeId = 'Please select a linked Employee record.';
    }

    const existingUsers = listUsersWithPermissions(db);
    if (existingUsers.some((u) => u.loginId.toLowerCase() === loginId.toLowerCase())) {
      errors.loginId = `Login ID "${loginId}" is already in use.`;
    }
    if (existingUsers.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      errors.email = `Email "${email}" is already in use.`;
    }

    if (Object.keys(errors).length > 0 || !matchedRole) {
      return res.status(400).json({ error: Object.values(errors)[0] || 'Validation failed', errors });
    }

    const user = createUserInDb(db, {
      loginId,
      password,
      fullName,
      email,
      roleId: matchedRole.id,
      employeeId: employeeId || undefined,
      department: department || undefined,
      active,
      customPermissions,
    });

    const linkedEmp = resolveEmployeeOrEntityForNotification(db, user.employeeId);
    notifyUserAccountCreated(db, {
      user,
      employee: linkedEmp,
      rawPassword: password,
      baseUrl: getRequestBaseUrl(req),
    });

    return res.status(201).json({ user });
  });

  app.put('/api/users/:id', requireAuth(db), requirePermission('user.edit'), (req: AuthenticatedRequest, res) => {
    const userId = String(req.params.id);
    const existingUsers = listUsersWithPermissions(db);
    const editingUser = existingUsers.find((u) => u.id === userId);
    if (!editingUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const loginId = typeof req.body?.loginId === 'string' ? req.body.loginId.trim() : editingUser.loginId;
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : editingUser.fullName;
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : editingUser.email;
    const roleIdInput = typeof req.body?.roleId === 'string' ? req.body.roleId.trim() : '';
    const roleNameInput = typeof req.body?.role === 'string' ? req.body.role.trim() : '';
    const employeeId =
      typeof req.body?.employeeId === 'string' ? req.body.employeeId.trim() : '';
    const department =
      typeof req.body?.department === 'string' ? req.body.department.trim() : '';
    const active = typeof req.body?.active === 'boolean' ? req.body.active : editingUser.active;
    const customPermissions = Array.isArray(req.body?.customPermissions)
      ? req.body.customPermissions.filter(
          (p: unknown): p is PermissionName => typeof p === 'string' && isValidPermission(p)
        )
      : undefined;

    const roles = listRolesWithPermissions(db);
    const matchedRole =
      roles.find((r) => r.id === roleIdInput) ||
      roles.find((r) => r.roleName.toLowerCase() === roleNameInput.toLowerCase()) ||
      (roleNameInput === 'Administrator' ? roles.find((r) => r.id === 'role_super_admin') : undefined) ||
      (roleNameInput === 'Manager' ? roles.find((r) => r.id === 'role_dept_manager') : undefined) ||
      roles.find((r) => r.id === editingUser.roleId);

    const errors: Record<string, string> = {};
    if (!loginId || loginId.length < 3 || loginId.length > 30 || !/^[a-zA-Z0-9._-]+$/.test(loginId)) {
      errors.loginId =
        'Login ID must be 3-30 chars (letters, digits, dots, underscores, hyphens).';
    }
    if (password.length > 0) {
      const pwErr = validatePasswordStrength(password);
      if (pwErr) errors.password = pwErr;
    }
    if (!fullName) errors.fullName = 'Full Name is required.';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Please enter a valid email address.';
    }
    if (!matchedRole) {
      errors.role = 'Please select a valid role.';
    } else if (matchedRole.roleName === 'Employee' && !employeeId) {
      errors.employeeId = 'Please select a linked Employee record.';
    }

    if (
      existingUsers.some(
        (u) => u.id !== userId && u.loginId.toLowerCase() === loginId.toLowerCase()
      )
    ) {
      errors.loginId = `Login ID "${loginId}" is already in use.`;
    }
    if (existingUsers.some((u) => u.id !== userId && u.email.toLowerCase() === email.toLowerCase())) {
      errors.email = `Email "${email}" is already in use.`;
    }

    const isSuperRole = (r: string) => r === 'Super Admin' || r === 'Administrator';
    const otherActiveAdmins = existingUsers.filter(
      (u) => u.id !== userId && isSuperRole(u.role) && u.active
    );
    if (
      matchedRole &&
      isSuperRole(editingUser.role) &&
      editingUser.active &&
      (!isSuperRole(matchedRole.roleName) || !active) &&
      otherActiveAdmins.length === 0
    ) {
      errors.form = 'At least one active Super Admin account must remain in the system.';
    }

    if (Object.keys(errors).length > 0 || !matchedRole) {
      return res.status(400).json({ error: Object.values(errors)[0] || 'Validation failed', errors });
    }

    const updated = updateUserInDb(db, userId, {
      loginId,
      password: password || undefined,
      fullName,
      email,
      roleId: matchedRole.id,
      employeeId: employeeId || undefined,
      department: department || undefined,
      active,
      customPermissions,
    });

    if (updated) {
      const baseUrl = getRequestBaseUrl(req);
      const linkedEmp = resolveEmployeeOrEntityForNotification(db, updated.employeeId);

      if (password.length > 0) {
        notifyUserPasswordReset(db, {
          user: updated,
          employee: linkedEmp,
          baseUrl,
          resetId: crypto.randomUUID(),
        });
      }

      const prevPermKey = [...editingUser.permissions].sort().join(',');
      const nextPermKey = [...updated.permissions].sort().join(',');
      if (editingUser.roleId !== updated.roleId || prevPermKey !== nextPermKey) {
        notifyUserRoleOrPermissionsChanged(db, {
          user: updated,
          roleName: updated.role,
          permissions: updated.permissions,
          employee: linkedEmp,
          actorName: req.authUser?.fullName || 'Administrator',
          changeKey: `${updated.roleId}:${Date.now()}`,
          baseUrl,
        });
      }
    }

    return res.json({ user: updated });
  });

  app.post(
    '/api/users/:id/reset-password',
    requireAuth(db),
    requirePermission('user.edit'),
    (req: AuthenticatedRequest, res) => {
      const userId = String(req.params.id);
      const target = getSessionUserById(db, userId);
      if (!target) {
        return res.status(404).json({ error: 'User not found.' });
      }
      const tempPassword = generateStrongTempPassword();
      const updated = resetUserPasswordInDb(db, userId, tempPassword);
      if (!updated) {
        return res.status(404).json({ error: 'User not found.' });
      }
      const linkedEmp = updated.employeeId
        ? listEmployeesFromDb(db).find((e) => e.id === updated.employeeId || e.employeeId === updated.employeeId) || null
        : null;
      notifyUserPasswordReset(db, {
        user: updated,
        temporaryPassword: tempPassword,
        employee: linkedEmp,
        baseUrl: getRequestBaseUrl(req),
        resetId: crypto.randomUUID(),
      });
      return res.json({ ok: true, message: `Password reset email queued for ${updated.email}.` });
    }
  );

  app.delete(
    '/api/users/:id',
    requireAuth(db),
    requirePermission('user.delete'),
    (req: AuthenticatedRequest, res) => {
      const userId = String(req.params.id);
      if (req.authUser?.id === userId) {
        return res.status(400).json({ error: 'Cannot delete the currently logged-in user.' });
      }
      const target = getSessionUserById(db, userId);
      if (!target) {
        return res.status(404).json({ error: 'User not found.' });
      }
      const allUsers = listUsersWithPermissions(db);
      const isSuperRole = (r: string) => r === 'Super Admin' || r === 'Administrator';
      const remainingAdmins = allUsers.filter(
        (u) => u.id !== userId && isSuperRole(u.role) && u.active
      );
      if (isSuperRole(target.role) && remainingAdmins.length === 0) {
        return res
          .status(400)
          .json({ error: 'At least one active Super Admin account must remain.' });
      }

      deleteUserInDb(db, userId);
      return res.json({ ok: true });
    }
  );

  // =========================================================================
  // EMPLOYEE CENTERS MASTER DATA (INDIAN CITIES / LOCATIONS)
  // =========================================================================
  app.get('/api/centers', requireAuth(db), (_req, res) => {
    res.json({ centers: listEmployeeCentersFromDb(db) });
  });

  app.post('/api/centers', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAdminRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Access Denied: Only Administrators can add Employee Centers.' });
    }
    const cityName = typeof req.body?.cityName === 'string' ? req.body.cityName.trim() : '';
    const stateName = typeof req.body?.stateName === 'string' ? req.body.stateName.trim() : '';
    const centerCode = typeof req.body?.centerCode === 'string' ? req.body.centerCode.trim() : '';
    const officialAddress =
      typeof req.body?.officialAddress === 'string' ? req.body.officialAddress.trim() : '';
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
    const result = createEmployeeCenterInDb(
      db,
      { cityName, stateName, centerCode, officialAddress, phone },
      buildAuditActor(req)
    );
    if (!result.ok) {
      return res.status(result.code).json({ error: result.error });
    }
    return res.status(201).json({ center: result.center });
  });

  app.put('/api/centers/:id', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAdminRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Access Denied: Only Administrators can update Employee Centers.' });
    }
    const result = updateEmployeeCenterInDb(
      db,
      String(req.params.id),
      {
        cityName: typeof req.body?.cityName === 'string' ? req.body.cityName : undefined,
        stateName: typeof req.body?.stateName === 'string' ? req.body.stateName : undefined,
        centerCode: typeof req.body?.centerCode === 'string' ? req.body.centerCode : undefined,
        officialAddress: typeof req.body?.officialAddress === 'string' ? req.body.officialAddress : undefined,
        phone: typeof req.body?.phone === 'string' ? req.body.phone : undefined,
      },
      buildAuditActor(req)
    );
    if (!result.ok) {
      return res.status(result.code).json({ error: result.error });
    }
    return res.json({ center: result.center });
  });

  app.post('/api/centers/bulk', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAdminRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Access Denied: Only Administrators can import Employee Centers.' });
    }
    const rawText = typeof req.body?.rawText === 'string' ? req.body.rawText : '';
    const replaceExisting = req.body?.replaceExisting === true;
    if (!rawText.trim()) {
      return res.status(400).json({ error: 'City list text is required.' });
    }
    const result = bulkImportEmployeeCentersInDb(db, rawText, replaceExisting, buildAuditActor(req));
    return res.status(201).json(result);
  });

  app.delete('/api/centers/:id', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAdminRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Access Denied: Only Administrators can delete Employee Centers.' });
    }
    const ok = deleteEmployeeCenterInDb(db, String(req.params.id), buildAuditActor(req));
    if (!ok) return res.status(404).json({ error: 'Employee Center not found.' });
    return res.json({ ok: true });
  });

  // =========================================================================
  // DYNAMIC DEPARTMENTS & MAPPED DESIGNATIONS MASTER DATA
  // =========================================================================
  app.get('/api/departments', requireAuth(db), (_req, res) => {
    res.json(listDepartmentsAndDesignationsFromDb(db));
  });

  app.post('/api/departments', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAdminRole(req.authUser?.role) && !req.authUser?.permissions?.includes('role.manage')) {
      return res.status(403).json({ error: 'Access Denied: Only Administrators can create Departments.' });
    }
    const departmentName =
      typeof req.body?.name === 'string'
        ? req.body.name.trim()
        : typeof req.body?.departmentName === 'string'
        ? req.body.departmentName.trim()
        : '';
    const result = createDepartmentInDb(db, departmentName, buildAuditActor(req));
    if (!result.ok) {
      return res.status(result.code).json({ error: result.error });
    }
    return res.status(201).json(listDepartmentsAndDesignationsFromDb(db));
  });

  app.post('/api/designations', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAdminRole(req.authUser?.role) && !req.authUser?.permissions?.includes('role.manage')) {
      return res.status(403).json({ error: 'Access Denied: Only Administrators can create Designations.' });
    }
    const departmentName = typeof req.body?.departmentName === 'string' ? req.body.departmentName.trim() : '';
    const designationName = typeof req.body?.designationName === 'string' ? req.body.designationName.trim() : '';
    const result = createDesignationInDb(db, { departmentName, designationName }, buildAuditActor(req));
    if (!result.ok) {
      return res.status(result.code).json({ error: result.error });
    }
    return res.status(201).json({
      designation: result.designation,
      ...listDepartmentsAndDesignationsFromDb(db),
    });
  });

  app.delete('/api/designations/:id', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAdminRole(req.authUser?.role) && !req.authUser?.permissions?.includes('role.manage')) {
      return res.status(403).json({ error: 'Access Denied: Only Administrators can delete Designations.' });
    }
    const ok = deleteDesignationInDb(db, String(req.params.id), buildAuditActor(req));
    if (!ok) return res.status(404).json({ error: 'Designation not found.' });
    return res.json(listDepartmentsAndDesignationsFromDb(db));
  });

  // =========================================================================
  // EMPLOYEE ROUTES (RBAC PROTECTED + 5-DIGIT ID + KYC + EMAIL VERIFICATION)
  // =========================================================================
  app.get(
    '/api/employees',
    requireAuth(db),
    requirePermission('employee.view'),
    (req: AuthenticatedRequest, res) => {
      const all = listEmployeesFromDb(db);
      const scoped = filterEmployeesForUser(req.authUser!, all);
      res.json({ employees: scoped });
    }
  );

  app.post(
    '/api/employees/verify-email',
    requireAuth(db),
    requireAnyPermission(['employee.create', 'employee.edit']),
    async (req, res) => {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
      const kind = req.body?.kind === 'personal' ? 'personal' : 'official';
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ ok: false, error: `Please enter a valid ${kind} email address.` });
      }
      if (req.body?.sendMail === true) {
        try {
          await sendMailViaSmtp({
            to: email,
            subject: `[Email Verification] ${kind === 'personal' ? 'Personal' : 'Official'} Email Confirmed`,
            text: `Your ${kind} email address (${email}) has been verified for Median Asset & HR Suite employee onboarding.`,
            html: `<p>Your ${kind} email address (<strong>${email}</strong>) has been verified for Median Asset & HR Suite employee onboarding.</p>`,
            db,
          });
          return res.json({
            ok: true,
            verified: true,
            email,
            kind,
            message: 'Email Sent Successfully',
          });
        } catch (err) {
          return res.status(502).json({
            ok: false,
            error: 'Email Delivery Failed',
            details: err instanceof Error ? err.message : 'SMTP verification dispatch failed',
          });
        }
      }
      return res.json({
        ok: true,
        verified: true,
        email,
        kind,
        message: `${kind === 'personal' ? 'Personal' : 'Official'} email (${email}) verified successfully.`,
      });
    }
  );

  app.post(
    '/api/employees',
    requireAuth(db),
    requirePermission('employee.create'),
    (req: AuthenticatedRequest, res) => {
      const user = req.authUser!;
      const existingEmployees = listEmployeesFromDb(db);
      const rawEmployeeId = typeof req.body?.employeeId === 'string' ? req.body.employeeId.trim() : '';
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const personalEmail =
        typeof req.body?.personalEmail === 'string' ? req.body.personalEmail.trim() : '';
      const officialEmail =
        typeof req.body?.officialEmail === 'string' && req.body.officialEmail.trim()
          ? req.body.officialEmail.trim()
          : typeof req.body?.email === 'string'
          ? req.body.email.trim()
          : '';
      const panCard = typeof req.body?.panCard === 'string' ? req.body.panCard.trim().toUpperCase() : '';
      const voterIdCard =
        typeof req.body?.voterIdCard === 'string' ? req.body.voterIdCard.trim().toUpperCase() : '';
      const aadhaarCard =
        typeof req.body?.aadhaarCard === 'string' ? req.body.aadhaarCard.trim() : '';
      const uanNumber = typeof req.body?.uanNumber === 'string' ? req.body.uanNumber.trim() : '';
      const loginPassword = typeof req.body?.password === 'string' ? req.body.password : '';
      const personalEmailVerified = req.body?.personalEmailVerified === true;
      const officialEmailVerified = req.body?.officialEmailVerified === true;

      if (!name) {
        return res.status(400).json({ error: 'Employee full name is required.' });
      }

      const idErr = validateFiveDigitEmployeeId(rawEmployeeId, existingEmployees);
      if (idErr) {
        const isDuplicate = idErr.toLowerCase().includes('already exists');
        return res.status(isDuplicate ? 409 : 400).json({ error: idErr });
      }
      const formattedEmployeeId = formatFiveDigitEmployeeId(rawEmployeeId);

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!personalEmail || !emailRegex.test(personalEmail)) {
        return res.status(400).json({ error: 'Mandatory field missing: Valid Personal Email ID is required.' });
      }
      if (!officialEmail || !emailRegex.test(officialEmail)) {
        return res.status(400).json({ error: 'Mandatory field missing: Valid Official Email ID is required.' });
      }
      if (!personalEmailVerified) {
        return res.status(400).json({ error: 'Please complete verification for Personal Email ID.' });
      }
      if (!officialEmailVerified) {
        return res.status(400).json({ error: 'Please complete verification for Official Email ID.' });
      }
      if (!panCard) {
        return res.status(400).json({ error: 'Mandatory field missing: PAN Card number is required.' });
      }
      if (!voterIdCard) {
        return res.status(400).json({ error: 'Mandatory field missing: Voter ID Card number is required.' });
      }
      if (!aadhaarCard) {
        return res.status(400).json({ error: 'Mandatory field missing: Aadhaar Card number is required.' });
      }
      if (!loginPassword) {
        return res.status(400).json({ error: 'Mandatory field missing: Login Password is required.' });
      }
      const pwErr = validatePasswordStrength(loginPassword);
      if (pwErr) {
        return res.status(400).json({ error: pwErr });
      }

      const existingUsers = listUsersWithPermissions(db);
      if (existingUsers.some((u) => u.loginId.toLowerCase() === formattedEmployeeId.toLowerCase())) {
        return res.status(409).json({ error: `Login ID "${formattedEmployeeId}" already exists.` });
      }
      if (existingUsers.some((u) => u.email.toLowerCase() === officialEmail.toLowerCase())) {
        return res.status(409).json({ error: `Official Email "${officialEmail}" is already registered to a user login.` });
      }

      const wantsIsManager = req.body?.isManager === true;
      const requestedMgrId =
        typeof req.body?.reportingManagerId === 'string' ? req.body.reportingManagerId.trim() : '';
      if ((wantsIsManager || requestedMgrId) && !canModifyManagerFields(user)) {
        return res.status(403).json({
          error: 'Access Denied: Only Administrators can set "Is Manager?" or assign reporting managers.',
        });
      }

      const rawCenter =
        typeof req.body?.center === 'string' && req.body.center.trim()
          ? req.body.center.trim()
          : typeof req.body?.branch === 'string' && req.body.branch.trim()
          ? req.body.branch.trim()
          : DEFAULT_INDIAN_CENTER;
      const center = normalizeCenterName(rawCenter);

      const result = createEmployeeInDb(
        db,
        {
          id: formattedEmployeeId,
          employeeId: formattedEmployeeId,
          name,
          email: officialEmail,
          personalEmail,
          officialEmail,
          personalEmailVerified: true,
          officialEmailVerified: true,
          uanNumber,
          panCard,
          voterIdCard,
          aadhaarCard,
          leaveCarryForward: Number(req.body?.leaveCarryForward) || 0,
          department: typeof req.body?.department === 'string' && req.body.department.trim() ? req.body.department.trim() : 'IT',
          designation: typeof req.body?.designation === 'string' && req.body.designation.trim() ? req.body.designation.trim() : 'Staff',
          phone: typeof req.body?.phone === 'string' ? req.body.phone : '',
          branch: normalizeCenterName(
            typeof req.body?.branch === 'string' && req.body.branch.trim() ? req.body.branch.trim() : center
          ),
          center,
          isManager: canModifyManagerFields(user) ? wantsIsManager : false,
          reportingManagerId: canModifyManagerFields(user) ? requestedMgrId : '',
          reportingManagerName:
            typeof req.body?.reportingManagerName === 'string' ? req.body.reportingManagerName.trim() : '',
          reportingManagerEmail:
            typeof req.body?.reportingManagerEmail === 'string' ? req.body.reportingManagerEmail.trim() : '',
          joiningDate: typeof req.body?.joiningDate === 'string' ? req.body.joiningDate : '',
          address: typeof req.body?.address === 'string' ? req.body.address : '',
          remarks: typeof req.body?.remarks === 'string' ? req.body.remarks : '',
          status: req.body?.status === 'Inactive' ? 'Inactive' : 'Active',
        },
        buildAuditActor(req)
      );

      if (!result.ok) {
        return res.status(result.code).json({ error: result.error });
      }

      const createdUser = createUserInDb(db, {
        loginId: formattedEmployeeId,
        password: loginPassword,
        fullName: result.employee.name,
        email: officialEmail,
        roleId: result.employee.isManager ? 'role_dept_manager' : 'role_employee',
        employeeId: result.employee.id,
        department: result.employee.department,
        active: result.employee.status === 'Active',
      });

      const baseUrl = getRequestBaseUrl(req);
      const queuedAccountMail = notifyUserAccountCreated(db, {
        user: createdUser,
        employee: result.employee,
        rawPassword: loginPassword,
        baseUrl,
      });
      notifyManagerNewEmployee(db, {
        employee: result.employee,
        baseUrl,
      });

      return res.status(201).json({
        employee: result.employee,
        user: createdUser,
        queuedAccountMailId: queuedAccountMail?.id || null,
      });
    }
  );

  app.post(
    '/api/employees/bulk-import',
    requireAuth(db),
    requirePermission('employee.create'),
    (req: AuthenticatedRequest, res) => {
      const csvText = typeof req.body?.csvText === 'string' ? req.body.csvText : '';
      const duplicatePolicy = req.body?.duplicatePolicy === 'update' ? 'update' : 'skip';
      if (!csvText.trim()) {
        return res.status(400).json({ error: 'CSV content is required.' });
      }

      const result = bulkImportEmployeesInDb(db, {
        csvText,
        duplicatePolicy,
        actor: buildAuditActor(req),
      });

      const scopedEmployees = filterEmployeesForUser(req.authUser!, result.employees);
      return res.status(result.createdCount > 0 || result.updatedCount > 0 ? 201 : 200).json({
        ...result,
        employees: scopedEmployees,
      });
    }
  );

  app.put(
    '/api/employees/:id',
    requireAuth(db),
    requirePermission('employee.edit'),
    (req: AuthenticatedRequest, res) => {
      const user = req.authUser!;
      const id = String(req.params.id);
      const existing = listEmployeesFromDb(db).find((e) => e.id === id || e.employeeId === id);
      if (!existing) {
        return res.status(404).json({ error: 'Employee not found.' });
      }
      if (!canUserAccessEmployee(user, existing)) {
        return res.status(403).json({ error: 'Access Denied: Cannot edit employees outside your scope.' });
      }

      const isMgrFlagModified =
        typeof req.body?.isManager === 'boolean' && req.body.isManager !== Boolean(existing.isManager);
      const isMgrMappingModified =
        typeof req.body?.reportingManagerId === 'string' &&
        req.body.reportingManagerId.trim() !== (existing.reportingManagerId || '');

      if ((isMgrFlagModified || isMgrMappingModified) && !canModifyManagerFields(user)) {
        return res.status(403).json({
          error: 'Access Denied: Only Administrators can modify "Is Manager?" or Reporting Manager mapping.',
        });
      }

      if (
        req.body?.password !== undefined &&
        req.body?.password !== null &&
        typeof req.body.password !== 'string'
      ) {
        return res.status(400).json({ error: 'Password must be a valid string.' });
      }
      const nextPassword = typeof req.body?.password === 'string' ? req.body.password : '';
      if (nextPassword.length > 0) {
        const pwErr = validatePasswordStrength(nextPassword);
        if (pwErr) {
          return res.status(400).json({ error: pwErr });
        }
      }

      const rawNextCenter =
        typeof req.body?.center === 'string' && req.body.center.trim()
          ? req.body.center.trim()
          : typeof req.body?.branch === 'string' && req.body.branch.trim()
          ? req.body.branch.trim()
          : existing.center || existing.branch;
      const nextCenter = normalizeCenterName(rawNextCenter);

      const saved = updateEmployeeInDb(
        db,
        existing.id,
        {
          name: typeof req.body?.name === 'string' ? req.body.name : existing.name,
          email:
            typeof req.body?.officialEmail === 'string' && req.body.officialEmail.trim()
              ? req.body.officialEmail.trim()
              : typeof req.body?.email === 'string'
              ? req.body.email
              : existing.email,
          personalEmail:
            typeof req.body?.personalEmail === 'string'
              ? req.body.personalEmail
              : existing.personalEmail,
          officialEmail:
            typeof req.body?.officialEmail === 'string'
              ? req.body.officialEmail
              : existing.officialEmail,
          personalEmailVerified:
            typeof req.body?.personalEmailVerified === 'boolean'
              ? req.body.personalEmailVerified
              : existing.personalEmailVerified,
          officialEmailVerified:
            typeof req.body?.officialEmailVerified === 'boolean'
              ? req.body.officialEmailVerified
              : existing.officialEmailVerified,
          uanNumber:
            typeof req.body?.uanNumber === 'string' ? req.body.uanNumber : existing.uanNumber,
          panCard: typeof req.body?.panCard === 'string' ? req.body.panCard : existing.panCard,
          voterIdCard:
            typeof req.body?.voterIdCard === 'string' ? req.body.voterIdCard : existing.voterIdCard,
          aadhaarCard:
            typeof req.body?.aadhaarCard === 'string' ? req.body.aadhaarCard : existing.aadhaarCard,
          leaveCarryForward:
            req.body?.leaveCarryForward !== undefined
              ? Number(req.body.leaveCarryForward) || 0
              : existing.leaveCarryForward,
          department: typeof req.body?.department === 'string' ? req.body.department : existing.department,
          designation: typeof req.body?.designation === 'string' ? req.body.designation : existing.designation,
          phone: typeof req.body?.phone === 'string' ? req.body.phone : existing.phone,
          branch: normalizeCenterName(
            typeof req.body?.branch === 'string' && req.body.branch.trim() ? req.body.branch.trim() : nextCenter
          ),
          center: nextCenter,
          isManager: canModifyManagerFields(user) && typeof req.body?.isManager === 'boolean'
            ? req.body.isManager
            : existing.isManager,
          reportingManagerId: canModifyManagerFields(user) && typeof req.body?.reportingManagerId === 'string'
            ? req.body.reportingManagerId
            : existing.reportingManagerId,
          reportingManagerName:
            typeof req.body?.reportingManagerName === 'string'
              ? req.body.reportingManagerName
              : existing.reportingManagerName,
          reportingManagerEmail:
            typeof req.body?.reportingManagerEmail === 'string'
              ? req.body.reportingManagerEmail
              : existing.reportingManagerEmail,
          joiningDate: typeof req.body?.joiningDate === 'string' ? req.body.joiningDate : existing.joiningDate,
          address: typeof req.body?.address === 'string' ? req.body.address : existing.address,
          remarks: typeof req.body?.remarks === 'string' ? req.body.remarks : existing.remarks,
          status: req.body?.status === 'Inactive' ? 'Inactive' : req.body?.status === 'Active' ? 'Active' : existing.status,
          ...(nextPassword.length > 0 ? { password: nextPassword } : {}),
        },
        buildAuditActor(req)
      );

      if (!saved.ok) {
        return res.status(saved.code).json({ error: saved.error });
      }
      return res.json({
        employee: saved.employee,
        passwordUpdated: Boolean(saved.passwordUpdated),
        userAccountCreated: Boolean(saved.userAccountCreated),
      });
    }
  );

  app.put(
    '/api/employees/:id/manager-mapping',
    requireAuth(db),
    (req: AuthenticatedRequest, res) => {
      if (!canModifyManagerFields(req.authUser)) {
        return res.status(403).json({
          error: 'Access Denied: Only Administrators can modify manager flags or reporting hierarchy.',
        });
      }
      const id = String(req.params.id);
      const existing = listEmployeesFromDb(db).find((e) => e.id === id || e.employeeId === id);
      if (!existing) {
        return res.status(404).json({ error: 'Employee not found.' });
      }
      const saved = updateEmployeeInDb(
        db,
        existing.id,
        {
          isManager: typeof req.body?.isManager === 'boolean' ? req.body.isManager : existing.isManager,
          reportingManagerId:
            typeof req.body?.reportingManagerId === 'string'
              ? req.body.reportingManagerId
              : existing.reportingManagerId,
        },
        buildAuditActor(req)
      );
      if (!saved.ok) {
        return res.status(saved.code).json({ error: saved.error });
      }
      return res.json({ employee: saved.employee });
    }
  );

  app.delete(
    '/api/employees/:id',
    requireAuth(db),
    requirePermission('employee.delete'),
    (req: AuthenticatedRequest, res) => {
      const id = String(req.params.id);
      const existing = listEmployeesFromDb(db).find((e) => e.id === id || e.employeeId === id);
      if (!existing) {
        return res.status(404).json({ error: 'Employee not found.' });
      }
      if (!canUserAccessEmployee(req.authUser!, existing)) {
        return res.status(403).json({ error: 'Access Denied: Cannot delete employees outside your scope.' });
      }
      const result = deleteEmployeeInDb(db, existing.id, buildAuditActor(req));
      if (!result.ok) {
        return res.status(result.code).json({ error: result.error });
      }
      return res.json({ ok: true });
    }
  );

  // =========================================================================
  // PERSONNEL ENTITIES (CONSULTANT, RETAINER, FREELANCER/FLP, YRP, INTERN)
  // =========================================================================
  app.get('/api/entities', requireAuth(db), (req, res) => {
    const rawType = typeof req.query.type === 'string' ? req.query.type.trim() : '';
    const entities = listPersonnelEntitiesFromDb(
      db,
      rawType ? (rawType as PersonnelEntityType) : undefined
    );
    return res.json({ entities });
  });

  app.post(
    '/api/entities',
    requireAuth(db),
    requireAnyPermission(['employee.create', 'role.manage']),
    (req: AuthenticatedRequest, res) => {
      const user = req.authUser!;
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (password) {
        const pwErr = validatePasswordStrength(password);
        if (pwErr) {
          return res.status(400).json({ error: pwErr });
        }
      }

      const wantsIsManager = req.body?.entityType === 'Consultant' && req.body?.isManager === true;
      if (wantsIsManager && !canModifyManagerFields(user)) {
        return res.status(403).json({
          error: 'Access Denied: Only Administrators can grant Consultant Manager privileges.',
        });
      }

      const result = createPersonnelEntityInDb(
        db,
        {
          entityType: req.body?.entityType as PersonnelEntityType,
          entityCode: typeof req.body?.entityCode === 'string' ? req.body.entityCode : '',
          name: typeof req.body?.name === 'string' ? req.body.name : '',
          email: typeof req.body?.email === 'string' ? req.body.email : '',
          personalEmail: typeof req.body?.personalEmail === 'string' ? req.body.personalEmail : '',
          officialEmail: typeof req.body?.officialEmail === 'string' ? req.body.officialEmail : '',
          phone: typeof req.body?.phone === 'string' ? req.body.phone : '',
          whatsappNo: typeof req.body?.whatsappNo === 'string' ? req.body.whatsappNo : '',
          fatherHusbandName:
            typeof req.body?.fatherHusbandName === 'string' ? req.body.fatherHusbandName : '',
          address: typeof req.body?.address === 'string' ? req.body.address : '',
          center: typeof req.body?.center === 'string' ? req.body.center : 'Kolkata',
          department: typeof req.body?.department === 'string' ? req.body.department : '',
          designation: typeof req.body?.designation === 'string' ? req.body.designation : '',
          isManager: wantsIsManager,
          reportingManagerId:
            typeof req.body?.reportingManagerId === 'string' ? req.body.reportingManagerId : '',
          reportingManagerName:
            typeof req.body?.reportingManagerName === 'string' ? req.body.reportingManagerName : '',
          reportingManagerEmail:
            typeof req.body?.reportingManagerEmail === 'string' ? req.body.reportingManagerEmail : '',
          aadhaarCard: typeof req.body?.aadhaarCard === 'string' ? req.body.aadhaarCard : '',
          panCard: typeof req.body?.panCard === 'string' ? req.body.panCard : '',
          projectName: typeof req.body?.projectName === 'string' ? req.body.projectName : '',
          projectNo: typeof req.body?.projectNo === 'string' ? req.body.projectNo : '',
          eicName: typeof req.body?.eicName === 'string' ? req.body.eicName : '',
          bankName: typeof req.body?.bankName === 'string' ? req.body.bankName : '',
          bankBranch: typeof req.body?.bankBranch === 'string' ? req.body.bankBranch : '',
          bankAccountType:
            typeof req.body?.bankAccountType === 'string' ? req.body.bankAccountType : 'Savings',
          bankAccountNo: typeof req.body?.bankAccountNo === 'string' ? req.body.bankAccountNo : '',
          ifscCode: typeof req.body?.ifscCode === 'string' ? req.body.ifscCode : '',
          joiningDate: typeof req.body?.joiningDate === 'string' ? req.body.joiningDate : '',
          status: req.body?.status === 'Inactive' ? 'Inactive' : 'Active',
          remarks: typeof req.body?.remarks === 'string' ? req.body.remarks : '',
          password: password || undefined,
        },
        buildAuditActor(req)
      );

      if (!result.ok) {
        return res.status(result.code).json({ error: result.error });
      }

      if (result.user) {
        notifyUserAccountCreated(db, {
          user: result.user,
          employee: resolveEmployeeOrEntityForNotification(db, result.entity.id),
          rawPassword: password,
          baseUrl: getRequestBaseUrl(req),
        });
      }

      return res.status(201).json({ entity: result.entity, user: result.user });
    }
  );

  app.put(
    '/api/entities/:id',
    requireAuth(db),
    requireAnyPermission(['employee.edit', 'role.manage']),
    (req: AuthenticatedRequest, res) => {
      const id = String(req.params.id);
      const existing = listPersonnelEntitiesFromDb(db).find(
        (e) => e.id === id || e.entityCode.toUpperCase() === id.trim().toUpperCase()
      );
      if (!existing) {
        return res.status(404).json({ error: 'Personnel record not found.' });
      }
      if (
        typeof req.body?.isManager === 'boolean' &&
        req.body.isManager !== Boolean(existing.isManager) &&
        !canModifyManagerFields(req.authUser)
      ) {
        return res.status(403).json({
          error: 'Access Denied: Only Administrators can grant or revoke Consultant Manager privileges.',
        });
      }

      if (
        req.body?.password !== undefined &&
        req.body?.password !== null &&
        typeof req.body.password !== 'string'
      ) {
        return res.status(400).json({ error: 'Password must be a valid string.' });
      }
      const nextPassword = typeof req.body?.password === 'string' ? req.body.password : '';
      if (nextPassword.length > 0) {
        const pwErr = validatePasswordStrength(nextPassword);
        if (pwErr) {
          return res.status(400).json({ error: pwErr });
        }
      }

      const result = updatePersonnelEntityInDb(db, existing.id, req.body || {}, buildAuditActor(req));
      if (!result.ok) {
        return res.status(result.code).json({ error: result.error });
      }
      return res.json({
        entity: result.entity,
        passwordUpdated: Boolean(result.passwordUpdated),
        userAccountCreated: Boolean(result.userAccountCreated),
      });
    }
  );

  app.put('/api/entities/:id/manager-toggle', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!canModifyManagerFields(req.authUser)) {
      return res.status(403).json({
        error: 'Access Denied: Only Administrators can grant or revoke Consultant Manager privileges.',
      });
    }
    const isManager = req.body?.isManager === true;
    const forceUnassign = req.body?.forceUnassign === true;
    const result = toggleConsultantManagerInDb(
      db,
      String(req.params.id),
      isManager,
      forceUnassign,
      buildAuditActor(req)
    );
    if (!result.ok) {
      return res.status(result.code).json({
        error: result.error,
        activeReportCount: result.activeReportCount,
      });
    }
    return res.json({ entity: result.entity });
  });

  app.delete(
    '/api/entities/:id',
    requireAuth(db),
    requireAnyPermission(['employee.delete', 'role.manage']),
    (req: AuthenticatedRequest, res) => {
      const result = deletePersonnelEntityInDb(db, String(req.params.id), buildAuditActor(req));
      if (!result.ok) {
        return res.status(result.code).json({ error: result.error });
      }
      return res.json({ ok: true });
    }
  );

  app.post(
    '/api/entities/bulk-import',
    requireAuth(db),
    requireAnyPermission(['employee.create', 'role.manage']),
    (req: AuthenticatedRequest, res) => {
      const csvText = typeof req.body?.csvText === 'string' ? req.body.csvText : '';
      const entityType = typeof req.body?.entityType === 'string' ? (req.body.entityType.trim() as PersonnelEntityType) : '';
      const duplicatePolicy = req.body?.duplicatePolicy === 'update' ? 'update' : 'skip';
      const validTypes = new Set<string>(['Consultant', 'Retainer', 'Freelancer', 'Young Research Program', 'Intern']);
      if (!entityType || !validTypes.has(entityType)) {
        return res.status(400).json({ error: 'Valid personnel category (entityType) is required.' });
      }
      if (!csvText.trim()) {
        return res.status(400).json({ error: 'CSV content is required.' });
      }
      const result = bulkImportPersonnelEntitiesInDb(db, {
        csvText,
        entityType,
        duplicatePolicy,
        actor: buildAuditActor(req),
      });
      return res.status(result.createdCount > 0 || result.updatedCount > 0 ? 201 : 200).json(result);
    }
  );

  app.get('/api/workforce/conversions', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const allowed = isAdminRole(user.role) || user.role === 'HR Manager' || user.permissions?.includes('role.manage');
    if (!allowed) {
      return res.status(403).json({ error: 'Access Denied: Only Administrators or HR Managers can view employment conversions.' });
    }
    return res.json({ conversions: listEmploymentConversionsFromDb(db) });
  });

  app.post('/api/workforce/convert', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const allowed = isAdminRole(user.role) || user.role === 'HR Manager' || user.permissions?.includes('role.manage');
    if (!allowed) {
      return res.status(403).json({ error: 'Access Denied: Only Administrators or HR Managers can convert employment categories.' });
    }
    const validCategories = new Set<string>([
      'Employee',
      'Consultant',
      'Retainer',
      'Freelancer',
      'Young Research Program',
      'Intern',
    ]);
    const sourceCategory = String(req.body?.sourceCategory || '').trim();
    const targetCategory = String(req.body?.targetCategory || '').trim();
    const sourceId = String(req.body?.sourceId || '').trim();
    if (!validCategories.has(sourceCategory) || !validCategories.has(targetCategory) || !sourceId) {
      return res.status(400).json({ error: 'Valid sourceCategory, sourceId, and targetCategory are required.' });
    }

    const result = convertEmploymentTypeInDb(
      db,
      {
        sourceCategory: sourceCategory as EmploymentCategory,
        sourceId,
        targetCategory: targetCategory as EmploymentCategory,
        newCode: typeof req.body?.newCode === 'string' ? req.body.newCode.trim() : undefined,
        department: typeof req.body?.department === 'string' ? req.body.department.trim() : undefined,
        designation: typeof req.body?.designation === 'string' ? req.body.designation.trim() : undefined,
        reason: typeof req.body?.reason === 'string' ? req.body.reason.trim() : undefined,
      },
      buildAuditActor(req)
    );
    if (!result.ok) {
      return res.status(result.code).json({ error: result.error });
    }
    return res.status(201).json(result);
  });

  // =========================================================================
  // TEAM MEMBERS & REPORTING LINE ROUTES (MANAGERS + CONSULTANT-MANAGERS + ADMIN)
  // =========================================================================
  app.get('/api/team/members', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const allEmployees = listEmployeesFromDb(db);
    const allEntities = listPersonnelEntitiesFromDb(db);
    if (!isAdminRole(user.role) && !isEmployeeManagerUser(user, allEmployees, allEntities)) {
      return res.status(403).json({ error: 'Access Denied: Only designated Managers or Admins can view Team Members.' });
    }
    const requestedMgrId = typeof req.query.managerId === 'string' ? req.query.managerId.trim() : '';
    const consultantManagers = allEntities.filter(
      (e) => e.entityType === 'Consultant' && e.isManager && e.status === 'Active'
    );
    const candidateEmployees = allEmployees.filter((e) => e.status === 'Active');
    if (isAdminRole(user.role)) {
      const members = requestedMgrId
        ? getDirectReportsForManager(allEmployees, requestedMgrId, undefined, allEntities)
        : allEmployees;
      const managers = allEmployees.filter((e) => e.isManager);
      return res.json({ members, managers, consultantManagers, candidateEmployees });
    }

    const actorMgrKey = user.entityId || user.employeeId;
    const directReports = getDirectReportsForManager(allEmployees, actorMgrKey, user.email, allEntities);
    const deptScope =
      (user.role === 'Department Manager' || user.role === 'Manager') && user.department
        ? allEmployees.filter((e) => e.department === user.department && e.id !== user.employeeId)
        : [];
    const mergedMap = new Map<string, (typeof allEmployees)[number]>();
    for (const m of [...directReports, ...deptScope]) {
      mergedMap.set(m.id, m);
    }
    return res.json({
      members: Array.from(mergedMap.values()),
      managers: allEmployees.filter((e) => e.isManager),
      consultantManagers,
      candidateEmployees,
    });
  });

  app.post('/api/team/assign', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const allEmployees = listEmployeesFromDb(db);
    const allEntities = listPersonnelEntitiesFromDb(db);
    const isAdmin = canModifyManagerFields(user);
    const isMgr = isEmployeeManagerUser(user, allEmployees, allEntities);
    if (!isAdmin && !isMgr) {
      return res.status(403).json({
        error: 'Access Denied: Only Administrators or designated Managers/Consultant-Managers can manage team members.',
      });
    }

    const ownMgrId = user.entityId || user.employeeId || '';
    const requestedMgrId =
      typeof req.body?.managerId === 'string' && req.body.managerId.trim()
        ? req.body.managerId.trim()
        : ownMgrId;

    if (!requestedMgrId) {
      return res.status(400).json({ error: 'Manager ID is required.' });
    }
    if (!isAdmin && requestedMgrId.toUpperCase() !== ownMgrId.toUpperCase()) {
      return res.status(403).json({
        error: 'Access Denied: You can only build and manage your own team.',
      });
    }

    const addEmployeeIds = Array.isArray(req.body?.addEmployeeIds)
      ? req.body.addEmployeeIds.map((x: unknown) => String(x)).filter(Boolean)
      : [];
    const removeEmployeeIds = Array.isArray(req.body?.removeEmployeeIds)
      ? req.body.removeEmployeeIds.map((x: unknown) => String(x)).filter(Boolean)
      : [];

    const result = assignTeamMembersToManagerInDb(
      db,
      { managerId: requestedMgrId, addEmployeeIds, removeEmployeeIds },
      buildAuditActor(req)
    );
    if (!result.ok) {
      return res.status(result.code).json({ error: result.error });
    }
    return res.json({ ok: true, updatedCount: result.updatedCount });
  });

  app.get('/api/team/leaves', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const allEmployees = listEmployeesFromDb(db);
    const allEntities = listPersonnelEntitiesFromDb(db);
    if (!isAdminRole(user.role) && !isEmployeeManagerUser(user, allEmployees, allEntities)) {
      return res.status(403).json({ error: 'Access Denied: Only designated Managers or Admins can view team leave requests.' });
    }
    const allLeaves = listLeavesFromDb(db);
    if (isAdminRole(user.role)) {
      return res.json({ leaves: allLeaves });
    }
    const actorEmp = resolveEmployeeByIdentifier(allEmployees, user.employeeId);
    const actorEmpId = actorEmp?.id || user.entityId || user.employeeId || '';
    const directIds = new Set(
      getDirectReportsForManager(allEmployees, actorEmpId, user.email, allEntities).map((e) => e.id)
    );
    if ((user.role === 'Department Manager' || user.role === 'Manager') && user.department) {
      for (const e of allEmployees) {
        if (e.department === user.department) directIds.add(e.id);
      }
    }
    const filtered = allLeaves.filter(
      (l) => (actorEmpId && l.managerId === actorEmpId) || directIds.has(l.employeeId)
    );
    return res.json({ leaves: filtered });
  });

  // =========================================================================
  // ATTENDANCE MANAGEMENT ROUTES (RBAC PROTECTED + SCOPED)
  // =========================================================================
  app.get(
    '/api/attendance',
    requireAuth(db),
    requirePermission('attendance.view'),
    (req: AuthenticatedRequest, res) => {
      const user = req.authUser!;
      const allEmployees = listEmployeesFromDb(db);
      const accessibleEmpIds = new Set(filterEmployeesForUser(user, allEmployees).map((e) => e.id));

      const dateFilter = typeof req.query.date === 'string' ? req.query.date.trim() : '';
      const monthFilter = typeof req.query.month === 'string' ? req.query.month.trim() : '';
      const deptFilter = typeof req.query.department === 'string' ? req.query.department.trim() : '';
      const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim() : '';
      const empFilter = typeof req.query.employeeId === 'string' ? req.query.employeeId.trim() : '';

      const records = listAttendanceFromDb(db).filter((r) => {
        if (!accessibleEmpIds.has(r.employeeId)) return false;
        if (dateFilter && r.attendanceDate !== dateFilter) return false;
        if (monthFilter && !r.attendanceDate.startsWith(monthFilter)) return false;
        if (deptFilter && r.department !== deptFilter) return false;
        if (statusFilter && r.status !== statusFilter) return false;
        if (empFilter && r.employeeId !== empFilter) return false;
        return true;
      });

      res.json({ records });
    }
  );

  app.get(
    '/api/attendance/dashboard',
    requireAuth(db),
    requirePermission('attendance.view'),
    (req: AuthenticatedRequest, res) => {
      const user = req.authUser!;
      const todayDate =
        typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
          ? req.query.date
          : getTodayDateStr();

      const accessibleEmployees = filterEmployeesForUser(user, listEmployeesFromDb(db));
      const accessibleIds = new Set(accessibleEmployees.map((e) => e.id));
      const records = listAttendanceFromDb(db).filter((r) => accessibleIds.has(r.employeeId));
      const leaves = listLeavesFromDb(db).filter((l) => accessibleIds.has(l.employeeId));

      const stats = computeAttendanceDashboardStats({
        today: todayDate,
        month: todayDate.slice(0, 7),
        employees: accessibleEmployees,
        attendance: records,
        leaves,
      });

      res.json({ stats, todayDate });
    }
  );

  app.post(
    '/api/attendance/check-in',
    requireAuth(db),
    requirePermission('attendance.create'),
    (req: AuthenticatedRequest, res) => {
      const user = req.authUser!;
      const requestedEmpId =
        typeof req.body?.employeeId === 'string' ? req.body.employeeId.trim() : '';
      const targetEmpId = requestedEmpId || user.employeeId || '';

      if (!targetEmpId) {
        return res
          .status(400)
          .json({ error: 'Please select an employee or link an employee profile to your account.' });
      }

      const employees = listEmployeesFromDb(db);
      const emp = employees.find((e) => e.id === targetEmpId || e.employeeId === targetEmpId);
      if (!emp) {
        return res.status(404).json({ error: 'Employee record not found.' });
      }
      if (!canUserAccessEmployee(user, emp)) {
        return res.status(403).json({ error: 'Access Denied: Cannot check in for another user.' });
      }

      const date =
        typeof req.body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date)
          ? req.body.date
          : getTodayDateStr();
      const checkInTime =
        typeof req.body?.checkInTime === 'string' && /^\d{2}:\d{2}$/.test(req.body.checkInTime)
          ? req.body.checkInTime
          : getCurrentTimeStr();
      const remarks = typeof req.body?.remarks === 'string' ? req.body.remarks : '';

      const result = checkInEmployeeInDb(db, {
        employeeId: emp.id,
        date,
        checkInTime,
        remarks,
        actor: user,
      });

      if (!result.ok) {
        return res.status(400).json({ error: result.error });
      }
      if (result.record.lateMinutes > 0) {
        notifyManagerLateAttendance(db, {
          employee: emp,
          attendance: result.record,
          baseUrl: getRequestBaseUrl(req),
        });
      }
      return res.status(201).json({ record: result.record });
    }
  );

  app.post(
    '/api/attendance/check-out',
    requireAuth(db),
    requirePermission('attendance.create'),
    (req: AuthenticatedRequest, res) => {
      const user = req.authUser!;
      const requestedEmpId =
        typeof req.body?.employeeId === 'string' ? req.body.employeeId.trim() : '';
      const targetEmpId = requestedEmpId || user.employeeId || '';

      if (!targetEmpId) {
        return res
          .status(400)
          .json({ error: 'Please select an employee or link an employee profile to your account.' });
      }

      const employees = listEmployeesFromDb(db);
      const emp = employees.find((e) => e.id === targetEmpId || e.employeeId === targetEmpId);
      if (!emp) {
        return res.status(404).json({ error: 'Employee record not found.' });
      }
      if (!canUserAccessEmployee(user, emp)) {
        return res.status(403).json({ error: 'Access Denied: Cannot check out for another user.' });
      }

      const date =
        typeof req.body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date)
          ? req.body.date
          : getTodayDateStr();
      const checkOutTime =
        typeof req.body?.checkOutTime === 'string' && /^\d{2}:\d{2}$/.test(req.body.checkOutTime)
          ? req.body.checkOutTime
          : getCurrentTimeStr();
      const remarks = typeof req.body?.remarks === 'string' ? req.body.remarks : '';

      const result = checkOutEmployeeInDb(db, {
        employeeId: emp.id,
        date,
        checkOutTime,
        remarks,
        actor: user,
      });

      if (!result.ok) {
        return res.status(400).json({ error: result.error });
      }
      return res.json({ record: result.record });
    }
  );

  app.post(
    '/api/attendance',
    requireAuth(db),
    requirePermission('attendance.create'),
    (req: AuthenticatedRequest, res) => {
      const user = req.authUser!;
      const employeeId = typeof req.body?.employeeId === 'string' ? req.body.employeeId.trim() : '';
      const attendanceDate =
        typeof req.body?.attendanceDate === 'string' ? req.body.attendanceDate.trim() : '';
      const status = (req.body?.status || 'Present') as AttendanceStatus;
      const checkInTime =
        typeof req.body?.checkInTime === 'string' && req.body.checkInTime.trim()
          ? req.body.checkInTime.trim()
          : null;
      const checkOutTime =
        typeof req.body?.checkOutTime === 'string' && req.body.checkOutTime.trim()
          ? req.body.checkOutTime.trim()
          : null;
      const remarks = typeof req.body?.remarks === 'string' ? req.body.remarks : '';

      if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate)) {
        return res
          .status(400)
          .json({ error: 'employeeId and valid attendanceDate (YYYY-MM-DD) are required.' });
      }

      const emp = listEmployeesFromDb(db).find(
        (e) => e.id === employeeId || e.employeeId === employeeId
      );
      if (!emp) {
        return res.status(404).json({ error: 'Employee not found.' });
      }
      if (!canUserAccessEmployee(user, emp)) {
        return res.status(403).json({ error: 'Access Denied' });
      }

      const record = createOrUpdateManualAttendanceInDb(db, {
        employeeId: emp.id,
        attendanceDate,
        checkInTime,
        checkOutTime,
        status,
        remarks,
        correctionStatus: 'None',
        actor: user,
      });
      if (record.lateMinutes > 0) {
        notifyManagerLateAttendance(db, {
          employee: emp,
          attendance: record,
          baseUrl: getRequestBaseUrl(req),
        });
      }
      return res.status(201).json({ record });
    }
  );

  app.put(
    '/api/attendance/:id',
    requireAuth(db),
    requirePermission('attendance.edit'),
    (req: AuthenticatedRequest, res) => {
      const user = req.authUser!;
      const id = String(req.params.id);
      const existing = getAttendanceById(db, id);
      if (!existing) {
        return res.status(404).json({ error: 'Attendance record not found.' });
      }

      const emp = listEmployeesFromDb(db).find((e) => e.id === existing.employeeId);
      if (!emp || !canUserAccessEmployee(user, emp)) {
        return res
          .status(403)
          .json({ error: 'Access Denied: Cannot edit attendance outside your scope.' });
      }

      const status = (req.body?.status || existing.status) as AttendanceStatus;
      const checkInTime =
        req.body?.checkInTime === null
          ? null
          : typeof req.body?.checkInTime === 'string'
          ? req.body.checkInTime.trim() || null
          : existing.checkInTime;
      const checkOutTime =
        req.body?.checkOutTime === null
          ? null
          : typeof req.body?.checkOutTime === 'string'
          ? req.body.checkOutTime.trim() || null
          : existing.checkOutTime;
      const remarks =
        typeof req.body?.remarks === 'string' ? req.body.remarks : existing.remarks;
      const correctionStatus = req.body?.correctionStatus || 'Approved';

      const updated = createOrUpdateManualAttendanceInDb(db, {
        id: existing.id,
        employeeId: existing.employeeId,
        attendanceDate: existing.attendanceDate,
        checkInTime,
        checkOutTime,
        status,
        remarks,
        correctionStatus,
        actor: user,
      });

      if (updated.correctionStatus === 'Approved' || updated.correctionStatus === 'Rejected') {
        notifyEmployeeAttendanceCorrection(db, {
          employee: emp,
          attendance: updated,
          actorName: user.fullName,
          baseUrl: getRequestBaseUrl(req),
        });
      }

      return res.json({ record: updated });
    }
  );

  app.delete(
    '/api/attendance/:id',
    requireAuth(db),
    requirePermission('attendance.delete'),
    (req: AuthenticatedRequest, res) => {
      const user = req.authUser!;
      const id = String(req.params.id);
      const existing = getAttendanceById(db, id);
      if (!existing) {
        return res.status(404).json({ error: 'Attendance record not found.' });
      }
      const emp = listEmployeesFromDb(db).find((e) => e.id === existing.employeeId);
      if (!emp || !canUserAccessEmployee(user, emp)) {
        return res
          .status(403)
          .json({ error: 'Access Denied: Cannot delete attendance outside your scope.' });
      }
      deleteAttendanceInDb(db, id, user);
      return res.json({ ok: true });
    }
  );

  // =========================================================================
  // ATTENDANCE REPORTS & AUDIT LOGS
  // =========================================================================
  app.get(
    '/api/attendance/reports/daily',
    requireAuth(db),
    requirePermission('attendance.report'),
    (req: AuthenticatedRequest, res) => {
      const user = req.authUser!;
      const date =
        typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
          ? req.query.date
          : getTodayDateStr();
      const deptFilter = typeof req.query.department === 'string' ? req.query.department.trim() : '';

      const scopedEmployees = filterEmployeesForUser(user, listEmployeesFromDb(db)).filter(
        (e) => !deptFilter || e.department === deptFilter
      );
      const records = listAttendanceFromDb(db);
      const rows = buildDailyAttendanceReport({
        date,
        employees: scopedEmployees,
        attendance: records,
      });
      res.json({ date, rows });
    }
  );

  app.get(
    '/api/attendance/reports/monthly',
    requireAuth(db),
    requirePermission('attendance.report'),
    (req: AuthenticatedRequest, res) => {
      const user = req.authUser!;
      const defaultMonth = getTodayDateStr().slice(0, 7);
      const month =
        typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
          ? req.query.month
          : defaultMonth;
      const deptFilter = typeof req.query.department === 'string' ? req.query.department.trim() : '';

      const scopedEmployees = filterEmployeesForUser(user, listEmployeesFromDb(db)).filter(
        (e) => !deptFilter || e.department === deptFilter
      );
      const records = listAttendanceFromDb(db);
      const rows = buildMonthlyAttendanceReport({
        month,
        employees: scopedEmployees,
        attendance: records,
      });
      res.json({ month, rows });
    }
  );

  app.get(
    '/api/attendance/register',
    requireAuth(db),
    requirePermission('attendance.view'),
    (req: AuthenticatedRequest, res) => {
      const user = req.authUser!;
      const defaultMonth = getTodayDateStr().slice(0, 7);
      const month =
        typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
          ? req.query.month
          : defaultMonth;
      const deptFilter = typeof req.query.department === 'string' ? req.query.department.trim() : '';
      const centerFilter = typeof req.query.center === 'string' ? req.query.center.trim() : '';
      const empFilter = typeof req.query.employeeId === 'string' ? req.query.employeeId.trim() : '';

      const scopedEmployees = filterEmployeesForUser(user, listEmployeesFromDb(db)).filter((e) => {
        if (deptFilter && e.department !== deptFilter) return false;
        if (centerFilter && (e.center || e.branch) !== centerFilter) return false;
        if (empFilter && e.id !== empFilter && e.employeeId !== empFilter) return false;
        return true;
      });
      const records = listAttendanceFromDb(db);
      const leaves = listLeavesFromDb(db);
      const holidays = listPublicHolidaysFromDb(db);
      const register = buildMonthlyAttendanceRegister({
        month,
        employees: scopedEmployees,
        attendance: records,
        leaves,
        holidays,
        today: getTodayDateStr(),
      });
      return res.json({ register });
    }
  );

  app.get(
    '/api/attendance/audit-logs',
    requireAuth(db),
    requireAnyPermission(['attendance.edit', 'role.manage', 'attendance.report']),
    (req: AuthenticatedRequest, res) => {
      const user = req.authUser!;
      if (isOrgWideAttendanceRole(user)) {
        return res.json({ logs: listAuditLogsFromDb(db) });
      }
      const accessibleIds = new Set(
        filterEmployeesForUser(user, listEmployeesFromDb(db)).map((e) => e.id)
      );
      const logs = listAuditLogsFromDb(db).filter((l) => accessibleIds.has(l.employeeId));
      return res.json({ logs });
    }
  );

  // =========================================================================
  // LEAVE TRACKING ROUTES (MANAGER ROUTING + REMARKS + ADMIN OVERRIDE)
  // =========================================================================
  app.get(
    '/api/leaves',
    requireAuth(db),
    requirePermission('attendance.view'),
    (req: AuthenticatedRequest, res) => {
      const user = req.authUser!;
      const allEmployees = listEmployeesFromDb(db);
      const allEntities = listPersonnelEntitiesFromDb(db);
      const accessibleIds = new Set(
        filterEmployeesForUser(user, allEmployees).map((e) => e.id)
      );
      const actorEmp = resolveEmployeeByIdentifier(allEmployees, user.employeeId);
      const actorEmpId = actorEmp?.id || user.entityId || user.employeeId || '';

      if (isEmployeeManagerUser(user, allEmployees, allEntities)) {
        for (const dr of getDirectReportsForManager(allEmployees, actorEmpId, user.email, allEntities)) {
          accessibleIds.add(dr.id);
        }
      }

      const leaves = listLeavesFromDb(db).filter(
        (l) => accessibleIds.has(l.employeeId) || (Boolean(actorEmpId) && l.managerId === actorEmpId)
      );
      res.json({ leaves });
    }
  );

  app.get(
    '/api/leaves/balances',
    requireAuth(db),
    requirePermission('attendance.view'),
    (req: AuthenticatedRequest, res) => {
      const user = req.authUser!;
      const yearRaw = Number(req.query.year);
      const year =
        Number.isFinite(yearRaw) && yearRaw >= 2020 && yearRaw <= 2100
          ? yearRaw
          : new Date().getFullYear();
      const asOfRaw = Number(req.query.asOfMonth);
      const asOfMonth =
        Number.isFinite(asOfRaw) && asOfRaw >= 1 && asOfRaw <= 12 ? asOfRaw : 12;

      const allEmployees = listEmployeesFromDb(db);
      const scopedEmployees = filterEmployeesForUser(user, allEmployees);
      const allLeaves = listLeavesFromDb(db);
      const holidays = listPublicHolidaysFromDb(db);

      const balances = scopedEmployees.map((emp) =>
        computeEmployeeLeaveBucket({
          employee: emp,
          year,
          leaves: allLeaves,
          holidays,
          asOfMonth,
        })
      );

      return res.json({ year, balances });
    }
  );

  app.post(
    '/api/leaves',
    requireAuth(db),
    requirePermission('attendance.create'),
    (req: AuthenticatedRequest, res) => {
      const user = req.authUser!;
      const requestedEmpId =
        typeof req.body?.employeeId === 'string' ? req.body.employeeId.trim() : '';
      const targetEmpId = requestedEmpId || user.employeeId || '';

      if (!targetEmpId) {
        return res
          .status(400)
          .json({ error: 'Please select an employee or link an employee profile.' });
      }

      const emp = listEmployeesFromDb(db).find(
        (e) => e.id === targetEmpId || e.employeeId === targetEmpId
      );
      if (!emp) {
        return res.status(404).json({ error: 'Employee not found.' });
      }
      if (!canUserAccessEmployee(user, emp)) {
        return res.status(403).json({ error: 'Access Denied' });
      }

      const startDate = String(req.body?.startDate || '');
      const endDate = String(req.body?.endDate || '');
      const holidays = listPublicHolidaysFromDb(db);
      const chargeableDays = countChargeableLeaveDays({
        startDate,
        endDate,
        holidays,
        employeeCenter: emp.center || emp.branch,
      });

      const result = createLeaveInDb(db, {
        employeeId: emp.id,
        leaveType: req.body?.leaveType || 'Casual',
        startDate,
        endDate,
        reason: String(req.body?.reason || ''),
        actor: user,
        overrideDays: chargeableDays,
      });

      if (!result.ok) {
        return res.status(400).json({ error: result.error });
      }
      notifyManagerLeaveSubmitted(db, {
        employee: emp,
        leave: result.leave,
        baseUrl: getRequestBaseUrl(req),
      });

      return res.status(201).json({ leave: result.leave });
    }
  );

  app.put(
    '/api/leaves/:id',
    requireAuth(db),
    (req: AuthenticatedRequest, res) => {
      const user = req.authUser!;
      const leaveId = String(req.params.id);
      const status = req.body?.status === 'Rejected' ? 'Rejected' : 'Approved';
      const remarks = typeof req.body?.remarks === 'string' ? req.body.remarks : undefined;

      const leave = listLeavesFromDb(db).find((l) => l.id === leaveId);
      if (!leave) {
        return res.status(404).json({ error: 'Leave request not found.' });
      }

      const allEmployees = listEmployeesFromDb(db);
      const allEntities = listPersonnelEntitiesFromDb(db);
      const emp = allEmployees.find((e) => e.id === leave.employeeId);
      if (!emp) {
        return res.status(404).json({ error: 'Employee record for this leave was not found.' });
      }

      const decision = canUserApproveLeave({
        user,
        leave,
        targetEmployee: emp,
        employees: allEmployees,
        entities: allEntities,
      });
      if (!decision.allowed) {
        return res
          .status(403)
          .json({ error: decision.reason || 'Access Denied: Cannot review leave outside your scope.' });
      }

      const updated = reviewLeaveInDb(db, {
        leaveId,
        status,
        actor: user,
        remarks,
        isOverride: decision.isOverride,
      });

      if (updated) {
        notifyEmployeeLeaveDecision(db, {
          employee: emp,
          leave: updated,
          actorName: user.fullName,
          baseUrl: getRequestBaseUrl(req),
        });
      }

      return res.json({ leave: updated });
    }
  );

  // =========================================================================
  // POLICIES MODULE (HR POLICY, POSH POLICY, IT POLICY PDF + ACKNOWLEDGMENTS)
  // =========================================================================
  app.get('/api/policies', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const visiblePolicies = listPoliciesFromDb(db).filter((p) =>
      canUserViewPolicy(req.authUser!, p)
    );
    res.json({ policies: visiblePolicies });
  });

  app.get('/api/policies/acknowledgments', requireAuth(db), (req, res) => {
    const policyId = typeof req.query.policyId === 'string' ? req.query.policyId.trim() : undefined;
    return res.json({ acknowledgments: listPolicyAcknowledgmentsFromDb(db, policyId || undefined) });
  });

  app.post('/api/policies/:id/acknowledge', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const policyId = String(req.params.id);
    const targetPolicy = getPolicyByIdFromDb(db, policyId);
    if (!targetPolicy) {
      return res.status(404).json({ error: 'Policy document not found.' });
    }
    if (!canUserViewPolicy(req.authUser!, targetPolicy)) {
      return res.status(403).json({
        error: 'Access Denied: You are not authorized to access or acknowledge this policy.',
      });
    }
    const result = acknowledgePolicyInDb(
      db,
      policyId,
      req.authUser!,
      buildAuditActor(req)
    );
    if (!result.ok) {
      return res.status(result.code).json({ error: result.error });
    }
    return res.json({ acknowledgment: result.acknowledgment });
  });

  app.get('/api/policies/:id/file', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const policyId = String(req.params.id);
    const targetPolicy = getPolicyByIdFromDb(db, policyId);
    if (!targetPolicy) {
      return res.status(404).json({ error: 'Policy PDF document not found.' });
    }
    if (!canUserViewPolicy(req.authUser!, targetPolicy)) {
      return res.status(403).json({
        error: 'Access Denied: You are not authorized to view or download this policy.',
      });
    }
    const fileData = getPolicyPdfBufferFromDb(db, policyId);
    if (!fileData) {
      return res.status(404).json({ error: 'Policy PDF document not found.' });
    }
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${fileData.fileName.replace(/"/g, '')}"`
    );
    return res.send(fileData.buffer);
  });

  app.post('/api/policies', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!canManagePolicies(req.authUser)) {
      return res.status(403).json({
        error: 'Access Denied: Only Administrators can upload policy documents.',
      });
    }
    const category = typeof req.body?.category === 'string' ? req.body.category.trim() : 'HR Policy';
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const description = typeof req.body?.description === 'string' ? req.body.description : '';
    const version = typeof req.body?.version === 'string' ? req.body.version : '1.0';
    const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName : `${category}.pdf`;
    const contentBase64 = typeof req.body?.contentBase64 === 'string' ? req.body.contentBase64 : '';
    const notes = typeof req.body?.notes === 'string' ? req.body.notes : '';
    const visibleRoles = req.body?.visibleRoles !== undefined ? parseVisibleRoles(req.body.visibleRoles) : undefined;

    const result = createPolicyInDb(
      db,
      {
        category,
        title,
        description,
        version,
        fileName,
        contentBase64,
        notes,
        uploadedBy: req.authUser!.fullName,
        visibleRoles,
      },
      buildAuditActor(req)
    );
    if (!result.ok) {
      return res.status(result.code).json({ error: result.error });
    }
    return res.status(201).json({ policy: result.policy });
  });

  app.put('/api/policies/:id', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!canManagePolicies(req.authUser)) {
      return res.status(403).json({
        error: 'Access Denied: Only Administrators can replace or update policy documents.',
      });
    }
    const visibleRoles = req.body?.visibleRoles !== undefined ? parseVisibleRoles(req.body.visibleRoles) : undefined;
    const result = updatePolicyInDb(
      db,
      String(req.params.id),
      {
        category: typeof req.body?.category === 'string' ? req.body.category : undefined,
        title: typeof req.body?.title === 'string' ? req.body.title : undefined,
        description: typeof req.body?.description === 'string' ? req.body.description : undefined,
        fileName: typeof req.body?.fileName === 'string' ? req.body.fileName : undefined,
        contentBase64: typeof req.body?.contentBase64 === 'string' ? req.body.contentBase64 : undefined,
        versionBump: req.body?.versionBump === 'major' ? 'major' : 'minor',
        notes: typeof req.body?.notes === 'string' ? req.body.notes : undefined,
        updatedBy: req.authUser!.fullName,
        visibleRoles,
      },
      buildAuditActor(req)
    );
    if (!result.ok) {
      return res.status(result.code).json({ error: result.error });
    }
    return res.json({ policy: result.policy });
  });

  app.delete('/api/policies/:id', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!canManagePolicies(req.authUser)) {
      return res.status(403).json({
        error: 'Access Denied: Only Administrators can delete policy documents.',
      });
    }
    const ok = deletePolicyInDb(db, String(req.params.id), buildAuditActor(req));
    if (!ok) {
      return res.status(404).json({ error: 'Policy document not found.' });
    }
    return res.json({ ok: true });
  });

  // =========================================================================
  // PUBLIC HOLIDAYS ROUTES (AUTO-ROLLING NATIONAL HOLIDAYS + ADMIN OVERRIDES)
  // =========================================================================
  app.get('/api/holidays', requireAuth(db), (req, res) => {
    const requestedYear = Number(req.query.year);
    if (Number.isFinite(requestedYear) && requestedYear >= 2025 && requestedYear <= 2100) {
      syncNationalHolidaysForRange(
        db,
        2025,
        Math.max(requestedYear + 1, new Date().getFullYear() + 2)
      );
    }
    const centerFilter = typeof req.query.center === 'string' ? req.query.center.trim().toLowerCase() : '';
    const monthFilter = typeof req.query.month === 'string' ? req.query.month.trim() : '';
    const yearFilter = Number.isFinite(requestedYear) && requestedYear >= 2020 ? String(requestedYear) : '';
    const holidays = listPublicHolidaysFromDb(db).filter((h) => {
      if (yearFilter && !h.holidayDate.startsWith(yearFilter)) return false;
      if (monthFilter && !h.holidayDate.startsWith(monthFilter)) return false;
      if (centerFilter && centerFilter !== 'all' && centerFilter !== 'all centers') {
        const hCenter = h.center.trim().toLowerCase();
        if (hCenter !== 'all centers' && hCenter !== centerFilter) return false;
      }
      return true;
    });
    res.json({ holidays });
  });

  app.post(
    '/api/holidays',
    requireAuth(db),
    requireAnyPermission(['attendance.edit', 'attendance.create', 'role.manage']),
    (req: AuthenticatedRequest, res) => {
      const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
      const holidayDate = typeof req.body?.holidayDate === 'string' ? req.body.holidayDate.trim() : '';
      const rawCenter = typeof req.body?.center === 'string' ? req.body.center.trim() : 'All Centers';
      const center =
        !rawCenter || rawCenter === 'All Centers'
          ? 'All Centers'
          : normalizeCenterName(rawCenter);
      const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
      const isNational = req.body?.isNational === true;

      if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(holidayDate)) {
        return res.status(400).json({ error: 'Holiday title and valid date (YYYY-MM-DD) are required.' });
      }

      const holiday = createPublicHolidayInDb(db, {
        title,
        holidayDate,
        center: isNational ? 'All Centers' : center,
        description,
        isNational,
        createdBy: req.authUser?.fullName || 'Administrator',
      });

      const employees = listEmployeesFromDb(db);
      const notifiedCount = notifyEmployeesHolidayPublished(db, {
        holiday,
        employees,
        baseUrl: getRequestBaseUrl(req),
      });

      return res.status(201).json({ holiday, notifiedCount });
    }
  );

  app.put(
    '/api/holidays/:id',
    requireAuth(db),
    requireAnyPermission(['attendance.edit', 'role.manage']),
    (req: AuthenticatedRequest, res) => {
      const holidayId = String(req.params.id);
      const title = typeof req.body?.title === 'string' ? req.body.title.trim() : undefined;
      const holidayDate =
        typeof req.body?.holidayDate === 'string' ? req.body.holidayDate.trim() : undefined;
      const rawCenter = typeof req.body?.center === 'string' ? req.body.center.trim() : undefined;
      const center =
        rawCenter === undefined
          ? undefined
          : !rawCenter || rawCenter === 'All Centers'
          ? 'All Centers'
          : normalizeCenterName(rawCenter);
      const description =
        typeof req.body?.description === 'string' ? req.body.description.trim() : undefined;

      if (holidayDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(holidayDate)) {
        return res.status(400).json({ error: 'Valid date (YYYY-MM-DD) is required.' });
      }

      const updated = updatePublicHolidayInDb(db, holidayId, {
        title,
        holidayDate,
        center,
        description,
      });
      if (!updated) {
        return res.status(404).json({ error: 'Holiday not found.' });
      }
      return res.json({ holiday: updated });
    }
  );

  app.delete(
    '/api/holidays/:id',
    requireAuth(db),
    requireAnyPermission(['attendance.delete', 'attendance.edit', 'role.manage']),
    (req, res) => {
      const ok = deletePublicHolidayInDb(db, String(req.params.id));
      if (!ok) {
        return res.status(404).json({ error: 'Holiday not found.' });
      }
      return res.json({ ok: true });
    }
  );

  // =========================================================================
  // WORKFLOW REQUESTS (REGULARIZATION, WFH, PROFILE CHANGES)
  // =========================================================================
  app.get(
    '/api/workflow-requests',
    requireAuth(db),
    requirePermission('attendance.view'),
    (req: AuthenticatedRequest, res) => {
      const user = req.authUser!;
      const typeFilter = typeof req.query.type === 'string' ? req.query.type.trim() : '';
      const accessibleIds = new Set(
        filterEmployeesForUser(user, listEmployeesFromDb(db)).map((e) => e.id)
      );
      const requests = listWorkflowRequestsFromDb(db).filter((r) => {
        if (!accessibleIds.has(r.employeeId)) return false;
        if (typeFilter && r.requestType !== typeFilter) return false;
        return true;
      });
      res.json({ requests });
    }
  );

  function handleSubmitWorkflowRequest(
    requestType: WorkflowRequestType,
    req: AuthenticatedRequest,
    res: express.Response
  ) {
    const user = req.authUser!;
    const requestedEmpId =
      typeof req.body?.employeeId === 'string' ? req.body.employeeId.trim() : '';
    const targetEmpId = requestedEmpId || user.employeeId || '';

    if (!targetEmpId) {
      return res
        .status(400)
        .json({ error: 'Please select an employee or link an employee profile.' });
    }

    const emp = listEmployeesFromDb(db).find(
      (e) => e.id === targetEmpId || e.employeeId === targetEmpId
    );
    if (!emp) {
      return res.status(404).json({ error: 'Employee record not found.' });
    }

    const isSelfEmployee =
      Boolean(user.employeeId) &&
      (emp.id.toUpperCase() === user.employeeId!.toUpperCase() ||
        emp.employeeId.toUpperCase() === user.employeeId!.toUpperCase());

    if (!isSelfEmployee && !canUserAccessEmployee(user, emp)) {
      return res.status(403).json({ error: 'Access Denied' });
    }

    const targetDate =
      typeof req.body?.targetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.targetDate)
        ? req.body.targetDate
        : getTodayDateStr();

    const result = createWorkflowRequestInDb(db, {
      requestType,
      employeeId: emp.id,
      targetDate,
      endDate: typeof req.body?.endDate === 'string' ? req.body.endDate : null,
      requestedCheckIn: typeof req.body?.requestedCheckIn === 'string' ? req.body.requestedCheckIn : null,
      requestedCheckOut: typeof req.body?.requestedCheckOut === 'string' ? req.body.requestedCheckOut : null,
      payload: req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : null,
      reason: String(req.body?.reason || ''),
      actor: user,
    });

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    notifyManagerWorkflowSubmitted(db, {
      employee: emp,
      request: result.request,
      baseUrl: getRequestBaseUrl(req),
    });

    return res.status(201).json({ request: result.request });
  }

  app.post(
    '/api/attendance/regularizations',
    requireAuth(db),
    requirePermission('attendance.create'),
    (req: AuthenticatedRequest, res) => handleSubmitWorkflowRequest('regularization', req, res)
  );

  app.post(
    '/api/attendance/wfh',
    requireAuth(db),
    requirePermission('attendance.create'),
    (req: AuthenticatedRequest, res) => handleSubmitWorkflowRequest('wfh', req, res)
  );

  app.post(
    '/api/employees/:id/profile-change-requests',
    requireAuth(db),
    (req: AuthenticatedRequest, res) => {
      req.body = {
        ...(req.body || {}),
        employeeId: String(req.params.id),
      };
      return handleSubmitWorkflowRequest('profile_change', req, res);
    }
  );

  app.put(
    '/api/workflow-requests/:id',
    requireAuth(db),
    requireAnyPermission(['attendance.edit', 'employee.edit', 'role.manage']),
    (req: AuthenticatedRequest, res) => {
      const user = req.authUser!;
      const requestId = String(req.params.id);
      const status = req.body?.status === 'Rejected' ? 'Rejected' : 'Approved';
      const reviewNotes = typeof req.body?.reviewNotes === 'string' ? req.body.reviewNotes : undefined;

      const existing = listWorkflowRequestsFromDb(db).find((r) => r.id === requestId);
      if (!existing) {
        return res.status(404).json({ error: 'Workflow request not found.' });
      }
      const emp = listEmployeesFromDb(db).find((e) => e.id === existing.employeeId);
      if (!emp || !canUserAccessEmployee(user, emp)) {
        return res
          .status(403)
          .json({ error: 'Access Denied: Cannot review requests outside your scope.' });
      }

      const updated = reviewWorkflowRequestInDb(db, {
        requestId,
        status,
        actorName: user.fullName,
        actorUserId: user.id,
        reviewNotes,
      });

      if (updated) {
        notifyEmployeeWorkflowDecision(db, {
          employee: emp,
          request: updated,
          actorName: user.fullName,
          baseUrl: getRequestBaseUrl(req),
        });
      }

      return res.json({ request: updated });
    }
  );

  // =========================================================================
  // SECURE MANAGER EMAIL APPROVAL LINK ENDPOINT
  // =========================================================================
  app.get('/api/approvals/respond', (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    const actionRaw = typeof req.query.action === 'string' ? req.query.action.trim().toLowerCase() : '';
    const baseUrl = getRequestBaseUrl(req);

    if (!token || (actionRaw !== 'approve' && actionRaw !== 'reject')) {
      return res.status(400).send(
        renderApprovalOutcomeHtml({
          ok: false,
          title: 'Invalid Approval Link',
          message: 'This approval link is missing a valid token or decision parameter.',
          statusLabel: 'Invalid Link',
          portalUrl: baseUrl,
        })
      );
    }

    const result = consumeApprovalTokenInDb(db, {
      rawToken: token,
      action: actionRaw,
    });

    if (!result.ok) {
      return res.status(result.code).send(
        renderApprovalOutcomeHtml({
          ok: false,
          title: result.alreadyProcessed ? 'Request Already Processed' : 'Approval Link Unavailable',
          message: result.error,
          statusLabel: result.status || 'Unavailable',
          portalUrl: baseUrl,
        })
      );
    }

    const emp = listEmployeesFromDb(db).find((e) => e.id === result.employeeId);
    if (emp) {
      if (result.entityType === 'leave') {
        const leave = listLeavesFromDb(db).find((l) => l.id === result.entityId);
        if (leave) {
          notifyEmployeeLeaveDecision(db, {
            employee: emp,
            leave,
            actorName: result.managerName,
            baseUrl,
          });
        }
      } else {
        const wf = listWorkflowRequestsFromDb(db).find((w) => w.id === result.entityId);
        if (wf) {
          notifyEmployeeWorkflowDecision(db, {
            employee: emp,
            request: wf,
            actorName: result.managerName,
            baseUrl,
          });
        }
      }
    }

    return res.status(200).send(
      renderApprovalOutcomeHtml({
        ok: true,
        title: `Request ${result.status}`,
        message: `Thank you, ${result.managerName}. Your decision (${result.status}) has been recorded, attendance/employee records have been updated, and ${emp?.name || 'the employee'} has been notified by email.`,
        statusLabel: result.status,
        details: [
          { label: 'Employee', value: emp ? `${emp.name} (${emp.employeeId})` : result.employeeId },
          { label: 'Center', value: emp?.center || emp?.branch || 'Mumbai' },
          { label: 'Request Type', value: result.entityType.replace('_', ' ').toUpperCase() },
          { label: 'Actioned By', value: `${result.managerName} (${result.managerEmail})` },
        ],
        portalUrl: baseUrl,
      })
    );
  });

  // =========================================================================
  // EMAIL MANAGEMENT DASHBOARD & QUEUE ROUTES
  // =========================================================================
  app.get(
    '/api/mail/logs',
    requireAuth(db),
    requireAnyPermission(['role.manage', 'attendance.report', 'user.view']),
    (req, res) => {
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : undefined;
      res.json({ logs: listEmailLogsFromDb(db, status) });
    }
  );

  app.get(
    '/api/mail/reports',
    requireAuth(db),
    requireAnyPermission(['role.manage', 'attendance.report', 'user.view']),
    (_req, res) => {
      res.json(getEmailDashboardSummaryAndReportsFromDb(db));
    }
  );

  app.get(
    '/api/mail/audit',
    requireAuth(db),
    requireAnyPermission(['role.manage', 'attendance.report', 'user.view']),
    (_req, res) => {
      res.json({ logs: listEmailAuditLogsFromDb(db) });
    }
  );

  app.get(
    '/api/mail/status',
    requireAuth(db),
    requireAnyPermission(['role.manage', 'attendance.report', 'user.view']),
    (_req, res) => {
      res.json({ status: getPublicMailStatus(db) });
    }
  );

  app.post(
    '/api/mail/send/:id',
    requireAuth(db),
    async (req: AuthenticatedRequest, res) => {
      const user = req.authUser!;
      const logId = String(req.params.id);
      const isMailPrivileged =
        isAdminRole(user.role) ||
        user.role === 'HR Manager' ||
        user.role === 'Manager' ||
        Boolean(user.permissions?.includes('role.manage')) ||
        Boolean(user.permissions?.includes('user.edit'));
      if (!isMailPrivileged) {
        const target = listEmailLogsFromDb(db).find((l) => l.id === logId);
        if (!target) {
          return res.status(404).json({ ok: false, error: 'Email log not found.' });
        }
        const ownsLog =
          (target.recipientEmail && target.recipientEmail.toLowerCase() === user.email.toLowerCase()) ||
          (target.employeeId &&
            (target.employeeId === user.employeeId || target.employeeId === user.entityId));
        if (!ownsLog) {
          return res.status(403).json({ ok: false, error: 'Access Denied: Cannot dispatch mail logs outside your scope.' });
        }
      }
      const result = await sendEmailLogNow(
        db,
        logId,
        user.fullName || 'Administrator'
      );
      if (!result.ok) {
        return res.status(result.code).json(result);
      }
      return res.json(result);
    }
  );

  app.post(
    '/api/mail/retry/:id',
    requireAuth(db),
    requireAnyPermission(['role.manage', 'attendance.edit', 'user.edit']),
    async (req: AuthenticatedRequest, res) => {
      const result = await sendEmailLogNow(
        db,
        String(req.params.id),
        req.authUser?.fullName || 'Administrator'
      );
      if (!result.ok) {
        return res.status(result.code).json(result);
      }
      return res.json(result);
    }
  );

  app.post(
    '/api/mail/send-entity',
    requireAuth(db),
    async (req: AuthenticatedRequest, res) => {
      const user = req.authUser!;
      const relatedEntityType =
        typeof req.body?.relatedEntityType === 'string' ? req.body.relatedEntityType.trim() : '';
      const relatedEntityId =
        typeof req.body?.relatedEntityId === 'string' ? req.body.relatedEntityId.trim() : '';

      if (!relatedEntityType || !relatedEntityId) {
        return res.status(400).json({
          ok: false,
          error: 'Email Delivery Failed',
          details: 'relatedEntityType and relatedEntityId are required.',
        });
      }

      const targetLog = listEmailLogsFromDb(db).find(
        (l) =>
          l.relatedEntityType === relatedEntityType &&
          l.relatedEntityId === relatedEntityId &&
          l.status === 'Queued'
      );

      if (!targetLog) {
        return res.status(404).json({
          ok: false,
          error: 'Email Delivery Failed',
          details: 'No pending queued email found for this item.',
        });
      }

      const isMailPrivileged =
        isAdminRole(user.role) ||
        user.role === 'HR Manager' ||
        user.role === 'Manager' ||
        Boolean(user.permissions?.includes('role.manage')) ||
        Boolean(user.permissions?.includes('user.edit'));
      if (!isMailPrivileged) {
        const ownsLog =
          (targetLog.recipientEmail && targetLog.recipientEmail.toLowerCase() === user.email.toLowerCase()) ||
          (targetLog.employeeId &&
            (targetLog.employeeId === user.employeeId || targetLog.employeeId === user.entityId));
        if (!ownsLog) {
          return res.status(403).json({
            ok: false,
            error: 'Access Denied: Cannot dispatch queued mail for another employee.',
          });
        }
      }

      const result = await sendEmailLogNow(
        db,
        targetLog.id,
        user.fullName || 'User'
      );
      if (!result.ok) {
        return res.status(result.code).json(result);
      }
      return res.json(result);
    }
  );

  app.post(
    '/api/mail/process-queue',
    requireAuth(db),
    requireAnyPermission(['role.manage', 'attendance.edit', 'user.edit']),
    async (_req, res) => {
      const dispatch = await processMailQueueOnce(db);
      return res.json({ dispatch });
    }
  );

  app.post(
    '/api/mail/test-connections',
    requireAuth(db),
    requireAnyPermission(['role.manage', 'attendance.report']),
    async (_req, res) => {
      const [smtp, imap] = await Promise.all([
        verifySmtpConnection(db),
        verifyAndSyncImap(db),
      ]);
      return res.json({ smtp, imap });
    }
  );

  // =========================================================================
  // ADMIN SENDER EMAIL CHANGE WORKFLOW (6-DIGIT OTP + LIVE LOOPBACK CHECK)
  // =========================================================================
  app.post(
    '/api/mail/sender-change/request-otp',
    requireAuth(db),
    requirePermission('role.manage'),
    async (req, res) => {
      const newEmail = typeof req.body?.newEmail === 'string' ? req.body.newEmail.trim() : '';
      if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
        return res.status(400).json({ error: 'Please enter a valid new sender email address.' });
      }

      const effective = getEffectiveMailConfig(db);
      const currentEmail = effective.config.from || 'barunkumarsenbks1997@gmail.com';
      if (newEmail.toLowerCase() === currentEmail.toLowerCase()) {
        return res.status(400).json({ error: 'New sender email must differ from the current sender email.' });
      }

      const otpCode = String(crypto.randomInt(100000, 1000000));
      const otpRecord = createMailChangeOtpInDb(db, {
        oldEmail: currentEmail,
        newEmail,
        otpCode,
      });

      const exactPromptText = `Hello Admin, to remove your mail ID from ${currentEmail} to ${newEmail}, please put your OTP here in the web application.`;
      const textBody = `${exactPromptText}\n\n6-Digit Verification OTP: ${otpCode}`;
      const htmlBody = `<p>${exactPromptText}</p><p style="font-size:18px;font-weight:bold;letter-spacing:3px;">OTP: ${otpCode}</p>`;

      const enqueued = enqueueEmailInDb(db, {
        dedupeKey: `admin-mail-otp:${otpRecord.id}`,
        eventType: 'ADMIN_SENDER_CHANGE_OTP',
        recipientEmail: currentEmail,
        recipientName: 'Administrator',
        recipientRole: 'System',
        subject: `[Admin Verification OTP] Sender Mail Migration (${currentEmail} -> ${newEmail})`,
        htmlBody,
        textBody,
        relatedEntityType: 'mail_config_otp',
        relatedEntityId: otpRecord.id,
      });

      const canAttemptSmtp =
        hasCustomTestMailTransport() || Boolean(effective.config.host && effective.config.username && effective.config.password);

      if (canAttemptSmtp) {
        const dispatch = await sendEmailLogNow(db, enqueued.log.id, 'Admin Sender Migration');
        if (!dispatch.ok) {
          return res.status(dispatch.code).json({
            ok: false,
            error: 'Email Delivery Failed',
            details: dispatch.details,
            deletedLogId: dispatch.deletedLogId,
          });
        }
        return res.json({
          ok: true,
          otpId: otpRecord.id,
          currentEmail,
          newEmail,
          mailDispatched: true,
          message: 'Email Sent Successfully',
        });
      }

      // Unconfigured preview environment fallback: OTP email stays queued while allowing OTP popup testing
      return res.json({
        ok: true,
        otpId: otpRecord.id,
        currentEmail,
        newEmail,
        mailDispatched: false,
        sandboxOtpPreview: process.env.NODE_ENV === 'production' ? undefined : otpCode,
        message: '6-digit OTP generated for Admin sender email verification.',
      });
    }
  );

  app.post(
    '/api/mail/sender-change/verify-otp',
    requireAuth(db),
    requirePermission('role.manage'),
    async (req: AuthenticatedRequest, res) => {
      const otpId = typeof req.body?.otpId === 'string' ? req.body.otpId.trim() : undefined;
      const otpCode = typeof req.body?.otpCode === 'string' ? req.body.otpCode.trim() : '';
      if (!/^\d{6}$/.test(otpCode)) {
        return res.status(400).json({ error: 'Please enter the exact 6-digit OTP.' });
      }

      const verified = verifyMailChangeOtpInDb(db, { otpId, otpCode });
      if (!verified.ok) {
        return res.status(400).json({ error: verified.error });
      }

      // Send confirmation email to the old email (e.g. barunkumarsenbks1997@gmail.com)
      const effective = getEffectiveMailConfig(db);
      const confirmSubject = `[Confirmed] Sender Email Migration OTP Verified (${verified.oldEmail})`;
      const confirmText = `Your OTP has been verified to migrate system sender email from ${verified.oldEmail} to ${verified.newEmail}.`;
      const enqueued = enqueueEmailInDb(db, {
        dedupeKey: `admin-mail-otp-verified:${verified.id}`,
        eventType: 'ADMIN_SENDER_CHANGE_CONFIRMED',
        recipientEmail: verified.oldEmail,
        recipientName: 'Administrator',
        recipientRole: 'System',
        subject: confirmSubject,
        htmlBody: `<p>${confirmText}</p>`,
        textBody: confirmText,
        relatedEntityType: 'mail_config_otp',
        relatedEntityId: verified.id,
      });

      let confirmationSent = false;
      const canAttemptSmtp =
        hasCustomTestMailTransport() || Boolean(effective.config.host && effective.config.username && effective.config.password);
      if (canAttemptSmtp) {
        const sentRes = await sendEmailLogNow(
          db,
          enqueued.log.id,
          req.authUser?.fullName || 'Administrator'
        );
        confirmationSent = sentRes.ok;
      }

      return res.json({
        ok: true,
        otpId: verified.id,
        oldEmail: verified.oldEmail,
        newEmail: verified.newEmail,
        confirmationSent,
      });
    }
  );

  app.post(
    '/api/mail/sender-change/complete',
    requireAuth(db),
    requirePermission('role.manage'),
    async (req: AuthenticatedRequest, res) => {
      const otpId = typeof req.body?.otpId === 'string' ? req.body.otpId.trim() : undefined;
      const verifiedOtp = getVerifiedMailChangeOtpInDb(db, otpId);
      if (!verifiedOtp) {
        return res.status(400).json({
          error: '6-digit OTP verification is required before configuring the new sender mail server.',
        });
      }

      const smtpHost = typeof req.body?.smtpHost === 'string' ? req.body.smtpHost.trim() : '';
      const smtpPort = Number(req.body?.smtpPort) || 587;
      const rawEnc = typeof req.body?.encryption === 'string' ? req.body.encryption.toLowerCase() : 'tls';
      const encryption: 'tls' | 'ssl' | 'none' =
        rawEnc === 'ssl' ? 'ssl' : rawEnc === 'none' ? 'none' : 'tls';
      const imapHost = typeof req.body?.imapHost === 'string' ? req.body.imapHost.trim() : '';
      const imapPort = Number(req.body?.imapPort) || 993;
      const appPassword = typeof req.body?.appPassword === 'string' ? req.body.appPassword.trim() : '';
      const appName = typeof req.body?.appName === 'string' ? req.body.appName.trim() : '';

      const loopback = await sendLiveLoopbackVerification({
        appName,
        from: verifiedOtp.newEmail,
        host: smtpHost,
        port: smtpPort,
        encryption,
        imapHost,
        imapPort,
        username: verifiedOtp.newEmail,
        password: appPassword,
      });

      if (!loopback.ok) {
        return res.status(400).json({
          ok: false,
          error: ADMIN_MAIL_CONFIG_ERROR,
          details: loopback.details,
        });
      }

      saveMailConfigInDb(
        db,
        {
          appName,
          fromEmail: verifiedOtp.newEmail,
          smtpHost,
          smtpPort,
          encryption,
          imapHost,
          imapPort,
          username: verifiedOtp.newEmail,
          appPassword,
        },
        buildAuditActor(req)
      );
      consumeMailChangeOtpInDb(db, verifiedOtp.id);

      return res.json({
        ok: true,
        message: ADMIN_MAIL_CONFIG_SUCCESS,
        status: getPublicMailStatus(db),
      });
    }
  );

  // =========================================================================
  // WORKSPACE, ASSETS, BATCH UPDATE, OPERATIONS, AUDIT & BACKUP/RESTORE ROUTES
  // =========================================================================
  app.get('/api/workspace/state', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const allEmployees = listEmployeesFromDb(db);
    const scopedEmployees = filterEmployeesForUser(req.authUser!, allEmployees);
    const workspace = listWorkspaceStateFromDb(db, scopedEmployees, req.authUser!);
    return res.json({ state: workspace });
  });

  app.put(
    '/api/workspace/settings',
    requireAuth(db),
    requirePermission('role.manage'),
    (req: AuthenticatedRequest, res) => {
      const updated = updateWorkspaceSettingsInDb(
        db,
        {
          settings: req.body?.settings,
          categories: Array.isArray(req.body?.categories) ? req.body.categories : undefined,
          departments: Array.isArray(req.body?.departments) ? req.body.departments : undefined,
          locations: Array.isArray(req.body?.locations) ? req.body.locations : undefined,
        },
        buildAuditActor(req)
      );
      return res.json(updated);
    }
  );

  app.post('/api/workspace/options', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    const kind = req.body?.kind;
    const value = typeof req.body?.value === 'string' ? req.body.value.trim() : '';
    if ((kind !== 'category' && kind !== 'department' && kind !== 'location') || !value) {
      return res.status(400).json({ error: 'Valid option kind and value are required.' });
    }
    const updated = addQuickOptionInDb(db, kind, value, buildAuditActor(req));
    return res.json(updated);
  });

  app.post('/api/assets', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    if (!req.body?.name || !req.body?.serial || !req.body?.category) {
      return res.status(400).json({ error: 'Asset name, category, and serial are required.' });
    }
    const asset = createAssetInDb(db, req.body, buildAuditActor(req));
    return res.status(201).json({ asset });
  });

  app.post('/api/assets/bulk-update', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    const assetIds = Array.isArray(req.body?.assetIds)
      ? req.body.assetIds.map((x: unknown) => String(x)).filter(Boolean)
      : [];
    const allowedStatuses = new Set<AssetStatus>(['Available', 'Assigned', 'Under Maintenance', 'Disposed']);
    const status =
      typeof req.body?.status === 'string' && allowedStatuses.has(req.body.status as AssetStatus)
        ? (req.body.status as AssetStatus)
        : undefined;
    const department =
      typeof req.body?.department === 'string' && req.body.department.trim()
        ? req.body.department.trim()
        : undefined;
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : undefined;

    if (assetIds.length === 0) {
      return res.status(400).json({ error: 'Select at least one asset for batch update.' });
    }
    if (!status && !department) {
      return res.status(400).json({ error: 'Choose at least one field (Status or Department) to update.' });
    }

    const result = bulkUpdateAssetsInDb(
      db,
      { assetIds, status, department, notes },
      buildAuditActor(req)
    );
    return res.json(result);
  });

  app.post('/api/assets/bulk-import', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    const items = Array.isArray(req.body?.assets) ? req.body.assets : [];
    if (items.length === 0) {
      return res.status(400).json({ error: 'No asset rows provided.' });
    }
    const created = importAssetsInDb(db, items, buildAuditActor(req));
    return res.status(201).json({ assets: created });
  });

  app.put('/api/assets/:id', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    const updated = updateAssetInDb(db, String(req.params.id), req.body || {}, buildAuditActor(req));
    if (!updated) return res.status(404).json({ error: 'Asset not found.' });
    return res.json({ asset: updated });
  });

  app.delete('/api/assets/:id', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    const ok = deleteAssetInDb(db, String(req.params.id), buildAuditActor(req));
    if (!ok) return res.status(404).json({ error: 'Asset not found.' });
    return res.json({ ok: true });
  });

  app.get('/api/freelancer-allotments', requireAuth(db), (_req, res) => {
    return res.json({ allotments: listFreelancerAllotmentsFromDb(db) });
  });

  app.post('/api/assignments', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    try {
      const result = assignAssetInDb(db, req.body, buildAuditActor(req));
      return res.status(201).json(result);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Assignment failed.' });
    }
  });

  app.post('/api/sub-assignments', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    try {
      const result = subAssignAssetInDb(db, req.body, {
        ...buildAuditActor(req),
        employeeId: user.employeeId,
        entityId: user.entityId,
      });
      return res.status(201).json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sub-assignment failed.';
      return res.status(msg.startsWith('Access Denied') ? 403 : 400).json({ error: msg });
    }
  });

  app.post('/api/sub-assignments/:id/return', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const subId = String(req.params.id);
    const subRow = db
      .prepare(`SELECT * FROM Assignments WHERE id = ? AND status = 'Active' AND custody_level = 'Sub-Assigned' LIMIT 1`)
      .get(subId) as
      | {
          id: string;
          asset_id: string;
          employee_id: string;
          assigned_by_id?: string | null;
          parent_assignment_id?: string | null;
        }
      | undefined;

    if (!subRow) {
      return res.status(404).json({ error: 'Active sub-assignment not found.' });
    }

    const parentRow = subRow.parent_assignment_id
      ? (db
          .prepare(`SELECT employee_id FROM Assignments WHERE id = ? LIMIT 1`)
          .get(subRow.parent_assignment_id) as { employee_id?: string } | undefined)
      : undefined;

    const callerIds = new Set(
      [user.id, user.employeeId, user.entityId]
        .filter((x): x is string => Boolean(x && x.trim()))
        .map((x) => x.toUpperCase())
    );
    const isAdmin = isAssetOpsWriteRole(user.role);
    const isParentHolder =
      (subRow.assigned_by_id && callerIds.has(subRow.assigned_by_id.toUpperCase())) ||
      (parentRow?.employee_id && callerIds.has(parentRow.employee_id.toUpperCase()));
    const isSubHolder = callerIds.has(subRow.employee_id.toUpperCase());

    if (!isAdmin && !isParentHolder && !isSubHolder) {
      return res.status(403).json({
        error: 'Access Denied: Only the Primary custody holder, Administrator, or Sub-Assignee can return this sub-assignment.',
      });
    }

    try {
      const result = returnAssetInDb(
        db,
        {
          assetId: subRow.asset_id,
          employeeId: subRow.employee_id,
          assignmentId: subRow.id,
          custodyLevel: 'Sub-Assigned',
          date:
            typeof req.body?.date === 'string' && req.body.date.trim()
              ? req.body.date.trim()
              : getTodayDateStr(),
          condition: req.body?.condition || 'Good',
          damage: req.body?.damage || 'No Damage',
          remarks: typeof req.body?.remarks === 'string' ? req.body.remarks : 'Sub-assignment returned',
        },
        buildAuditActor(req)
      );
      return res.status(201).json(result);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Sub-assignment return failed.' });
    }
  });

  app.delete('/api/assignments/:id', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    const ok = deleteAssignmentInDb(db, String(req.params.id), buildAuditActor(req));
    if (!ok) return res.status(404).json({ error: 'Assignment not found.' });
    return res.json({ ok: true });
  });

  app.post('/api/returns', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    try {
      const result = returnAssetInDb(db, req.body, buildAuditActor(req));
      return res.status(201).json(result);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Return failed.' });
    }
  });

  app.delete('/api/returns/:id', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    const ok = deleteReturnInDb(db, String(req.params.id), buildAuditActor(req));
    if (!ok) return res.status(404).json({ error: 'Return record not found.' });
    return res.json({ ok: true });
  });

  app.post('/api/transfers', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    try {
      const result = transferAssetInDb(db, req.body, buildAuditActor(req));
      return res.status(201).json(result);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Transfer failed.' });
    }
  });

  app.delete('/api/transfers/:id', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    const ok = deleteTransferInDb(db, String(req.params.id), buildAuditActor(req));
    if (!ok) return res.status(404).json({ error: 'Transfer record not found.' });
    return res.json({ ok: true });
  });

  app.post('/api/maintenance', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    const record = saveMaintenanceInDb(db, req.body, buildAuditActor(req));
    return res.status(201).json({ maintenance: record });
  });

  app.put('/api/maintenance/:id', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    const record = saveMaintenanceInDb(db, { ...req.body, id: String(req.params.id) }, buildAuditActor(req));
    return res.json({ maintenance: record });
  });

  app.delete('/api/maintenance/:id', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    const ok = deleteMaintenanceInDb(db, String(req.params.id), buildAuditActor(req));
    if (!ok) return res.status(404).json({ error: 'Maintenance record not found.' });
    return res.json({ ok: true });
  });

  app.post('/api/disposals', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    const disposal = disposeAssetInDb(db, req.body, buildAuditActor(req));
    return res.status(201).json({ disposal });
  });

  app.post('/api/vendors', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    try {
      const vendor = saveVendorInDb(db, { ...req.body, isEdit: false }, buildAuditActor(req));
      return res.status(201).json({ vendor });
    } catch (err) {
      return sendStoreError(res, err, 'Failed to save vendor.');
    }
  });

  app.post('/api/vendors/bulk-import', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    const csvText = typeof req.body?.csvText === 'string' ? req.body.csvText : '';
    const duplicatePolicy = req.body?.duplicatePolicy === 'update' ? 'update' : 'skip';
    if (!csvText.trim()) {
      return res.status(400).json({ error: 'CSV content is required.' });
    }
    const result = bulkImportVendorsInDb(db, {
      csvText,
      duplicatePolicy,
      actor: buildAuditActor(req),
    });
    return res.status(result.createdCount > 0 || result.updatedCount > 0 ? 201 : 200).json(result);
  });

  app.put('/api/vendors/:id', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    try {
      const vendor = saveVendorInDb(
        db,
        { ...req.body, id: String(req.params.id), isEdit: true },
        buildAuditActor(req)
      );
      return res.json({ vendor });
    } catch (err) {
      return sendStoreError(res, err, 'Failed to update vendor.');
    }
  });

  app.delete('/api/vendors/:id', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    const ok = deleteVendorInDb(db, String(req.params.id), buildAuditActor(req));
    if (!ok) return res.status(404).json({ error: 'Vendor not found.' });
    return res.json({ ok: true });
  });

  app.get('/api/expense-categories', requireAuth(db), (req, res) => {
    const activeOnly = req.query.activeOnly === '1';
    return res.json({ categories: listExpenseCategoriesFromDb(db, activeOnly) });
  });

  app.post('/api/expense-categories', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role) && req.authUser?.role !== 'HR Manager' && !req.authUser?.permissions?.includes('role.manage')) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    try {
      const category = createExpenseCategoryInDb(db, req.body || {}, buildAuditActor(req));
      return res.status(201).json({ category });
    } catch (err) {
      return sendStoreError(res, err, 'Failed to create expense category.');
    }
  });

  app.put('/api/expense-categories/:id', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role) && req.authUser?.role !== 'HR Manager' && !req.authUser?.permissions?.includes('role.manage')) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    try {
      const category = updateExpenseCategoryInDb(db, String(req.params.id), req.body || {}, buildAuditActor(req));
      return res.json({ category });
    } catch (err) {
      return sendStoreError(res, err, 'Failed to update expense category.');
    }
  });

  app.put('/api/expense-categories/:id/toggle', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role) && req.authUser?.role !== 'HR Manager' && !req.authUser?.permissions?.includes('role.manage')) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    try {
      const category = toggleExpenseCategoryActiveInDb(
        db,
        String(req.params.id),
        req.body?.active === true,
        buildAuditActor(req)
      );
      return res.json({ category });
    } catch (err) {
      return sendStoreError(res, err, 'Failed to toggle expense category.');
    }
  });

  app.delete('/api/expense-categories/:id', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role) && req.authUser?.role !== 'HR Manager' && !req.authUser?.permissions?.includes('role.manage')) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    try {
      const ok = deleteExpenseCategoryInDb(db, String(req.params.id), buildAuditActor(req));
      if (!ok) return res.status(404).json({ error: 'Expense Category not found.' });
      return res.json({ ok: true });
    } catch (err) {
      return sendStoreError(res, err, 'Failed to delete expense category.');
    }
  });

  app.get('/api/payment-modes', requireAuth(db), (req, res) => {
    const activeOnly = req.query.activeOnly === '1';
    return res.json({ modes: listPaymentModesFromDb(db, activeOnly) });
  });

  app.post('/api/payment-modes', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role) && req.authUser?.role !== 'HR Manager' && !req.authUser?.permissions?.includes('role.manage')) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    try {
      const mode = createPaymentModeInDb(db, req.body || {}, buildAuditActor(req));
      return res.status(201).json({ mode });
    } catch (err) {
      return sendStoreError(res, err, 'Failed to create payment mode.');
    }
  });

  app.put('/api/payment-modes/:id', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role) && req.authUser?.role !== 'HR Manager' && !req.authUser?.permissions?.includes('role.manage')) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    try {
      const mode = updatePaymentModeInDb(db, String(req.params.id), req.body || {}, buildAuditActor(req));
      return res.json({ mode });
    } catch (err) {
      return sendStoreError(res, err, 'Failed to update payment mode.');
    }
  });

  app.put('/api/payment-modes/:id/toggle', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role) && req.authUser?.role !== 'HR Manager' && !req.authUser?.permissions?.includes('role.manage')) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    try {
      const mode = togglePaymentModeActiveInDb(
        db,
        String(req.params.id),
        req.body?.active === true,
        buildAuditActor(req)
      );
      return res.json({ mode });
    } catch (err) {
      return sendStoreError(res, err, 'Failed to toggle payment mode.');
    }
  });

  app.delete('/api/payment-modes/:id', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role) && req.authUser?.role !== 'HR Manager' && !req.authUser?.permissions?.includes('role.manage')) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    try {
      const ok = deletePaymentModeInDb(db, String(req.params.id), buildAuditActor(req));
      if (!ok) return res.status(404).json({ error: 'Payment Mode not found.' });
      return res.json({ ok: true });
    } catch (err) {
      return sendStoreError(res, err, 'Failed to delete payment mode.');
    }
  });

  app.post('/api/expenses', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    try {
      const expense = saveExpenseInDb(db, { ...req.body, isEdit: false }, buildAuditActor(req));
      return res.status(201).json({ expense });
    } catch (err) {
      return sendStoreError(res, err, 'Failed to record expense.');
    }
  });

  app.put('/api/expenses/:id', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    try {
      const expense = saveExpenseInDb(
        db,
        { ...req.body, id: String(req.params.id), isEdit: true },
        buildAuditActor(req)
      );
      return res.json({ expense });
    } catch (err) {
      return sendStoreError(res, err, 'Failed to update expense.');
    }
  });

  app.delete('/api/expenses/:id', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAssetOpsWriteRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    const ok = deleteExpenseInDb(db, String(req.params.id), buildAuditActor(req));
    if (!ok) return res.status(404).json({ error: 'Expense not found.' });
    return res.json({ ok: true });
  });

  // =========================================================================
  // SUPPORT TICKETING SYSTEM, FCFS QUEUE & MINUTE WORK ORDERS
  // =========================================================================
  app.post('/api/tickets', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const allEmployees = listEmployeesFromDb(db);
    const allEntities = listPersonnelEntitiesFromDb(db);
    const workspace = listWorkspaceStateFromDb(db, allEmployees);
    const existingTickets = listAllTicketsFromDb(db);
    const holidays = listPublicHolidaysFromDb(db);

    const created = createSupportTicketRecord({
      input: {
        assetId: String(req.body?.assetId || ''),
        subject: String(req.body?.subject || ''),
        description: String(req.body?.description || ''),
        priority: req.body?.priority || 'Medium',
        requestedDate: typeof req.body?.requestedDate === 'string' ? req.body.requestedDate : undefined,
        requestedStartTime:
          typeof req.body?.requestedStartTime === 'string' ? req.body.requestedStartTime : undefined,
        requestedDurationMins:
          req.body?.requestedDurationMins !== undefined
            ? Number(req.body.requestedDurationMins)
            : undefined,
      },
      session: user,
      employees: allEmployees,
      entities: allEntities,
      assets: workspace.assets,
      assignments: workspace.assignments,
      existingTickets,
      holidays,
    });

    if (!created.ok) {
      return res.status(400).json({
        error: created.errors.form || Object.values(created.errors)[0] || 'Invalid ticket request.',
        errors: created.errors,
      });
    }

    const ticket = createTicketInDb(db, created.ticket, buildAuditActor(req));
    return res.status(201).json({ ticket });
  });

  app.put('/api/tickets/reorder', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAdminRole(req.authUser?.role) && !req.authUser?.permissions?.includes('role.manage')) {
      return res.status(403).json({ error: 'Access Denied: Only Administrators can reorder the Admin Ticket Queue.' });
    }
    const orderedIds = Array.isArray(req.body?.orderedIds)
      ? req.body.orderedIds.map((id: unknown) => String(id).trim()).filter(Boolean)
      : null;
    if (!orderedIds || orderedIds.length === 0) {
      return res.status(400).json({ error: 'orderedIds array is required.' });
    }
    const tickets = reorderTicketsInDb(db, orderedIds, buildAuditActor(req));
    return res.json({ tickets });
  });

  app.post('/api/tickets/:id/work-order', requireAuth(db), (req: AuthenticatedRequest, res) => {
    if (!isAdminRole(req.authUser?.role) && !req.authUser?.permissions?.includes('role.manage')) {
      return res.status(403).json({ error: 'Access Denied: Only Administrators can schedule Work Orders.' });
    }
    const id = String(req.params.id);
    const allTickets = listAllTicketsFromDb(db);
    const existing = allTickets.find((t) => t.id === id);
    if (!existing) return res.status(404).json({ error: 'Ticket not found.' });

    const workOrderDate = typeof req.body?.workOrderDate === 'string' ? req.body.workOrderDate.trim() : '';
    const workOrderStartTime =
      typeof req.body?.workOrderStartTime === 'string' ? req.body.workOrderStartTime.trim() : '';
    const workOrderDurationMins = Number(req.body?.workOrderDurationMins);

    const nextRes = transitionTicketStatus({
      ticket: existing,
      action: 'approve',
      session: req.authUser!,
      workOrderDate,
      workOrderStartTime,
      workOrderDurationMins,
      allTickets,
    });

    if (!nextRes.ok) {
      return res.status(400).json({ error: nextRes.error });
    }

    const updated = updateTicketInDb(db, id, nextRes.ticket, buildAuditActor(req));
    const emp = resolveEmployeeOrEntityForNotification(db, existing.employeeId);
    const queuedMailLog =
      updated && emp
        ? notifyTicketWorkOrderScheduled(db, {
            ticket: updated,
            employee: emp,
            baseUrl: getRequestBaseUrl(req),
          })
        : null;

    return res.json({ ticket: updated, queuedMailId: queuedMailLog?.id || null });
  });

  app.post('/api/tickets/:id/confirm', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const id = String(req.params.id);
    const existing = listAllTicketsFromDb(db).find((t) => t.id === id);
    if (!existing) return res.status(404).json({ error: 'Ticket not found.' });

    const confirmRes = confirmWorkOrderByEmployee({
      ticket: existing,
      session: req.authUser!,
    });
    if (!confirmRes.ok) {
      return res.status(403).json({ error: confirmRes.error });
    }
    const updated = updateTicketInDb(db, id, confirmRes.ticket, buildAuditActor(req));
    return res.json({ ticket: updated });
  });

  app.post('/api/tickets/:id/close', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const id = String(req.params.id);
    const existing = listAllTicketsFromDb(db).find((t) => t.id === id);
    if (!existing) return res.status(404).json({ error: 'Ticket not found.' });

    const closeRes = transitionTicketStatus({
      ticket: existing,
      action: 'close',
      session: req.authUser!,
    });
    if (!closeRes.ok) {
      return res.status(403).json({ error: closeRes.error });
    }
    const updated = updateTicketInDb(db, id, closeRes.ticket, buildAuditActor(req));
    return res.json({ ticket: updated });
  });

  app.post('/api/tickets/:id/send-mail', requireAuth(db), async (req: AuthenticatedRequest, res) => {
    const id = String(req.params.id);
    const existing = listAllTicketsFromDb(db).find((t) => t.id === id);
    if (!existing) return res.status(404).json({ error: 'Ticket not found.' });

    const queued = listEmailLogsFromDb(db).find(
      (l) => l.relatedEntityType === 'ticket' && l.relatedEntityId === id && l.status === 'Queued'
    );
    const emp = resolveEmployeeOrEntityForNotification(db, existing.employeeId);

    const logIdToSend =
      queued?.id ||
      (emp
        ? notifyTicketWorkOrderScheduled(db, {
            ticket: existing,
            employee: emp,
            baseUrl: getRequestBaseUrl(req),
          }).id
        : null);

    if (!logIdToSend) {
      return res.status(400).json({
        ok: false,
        error: 'Email Delivery Failed',
        details: 'Employee email record not found for ticket.',
      });
    }

    const result = await sendEmailLogNow(
      db,
      logIdToSend,
      req.authUser?.fullName || 'Administrator'
    );
    if (!result.ok) {
      return res.status(result.code).json(result);
    }

    const updatedTicket = updateTicketInDb(
      db,
      id,
      { workOrderMailSentAt: new Date().toISOString() },
      buildAuditActor(req)
    );
    return res.json({
      ok: true,
      message: 'Email Sent Successfully',
      ticket: updatedTicket,
      log: result.log,
    });
  });

  app.put('/api/tickets/:id', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const id = String(req.params.id);
    const allTickets = listAllTicketsFromDb(db);
    const existing = allTickets.find((t) => t.id === id);
    if (!existing) return res.status(404).json({ error: 'Ticket not found.' });

    const action = req.body?.action as 'approve' | 'reject' | 'close' | undefined;
    if (action === 'approve' || action === 'reject' || action === 'close') {
      const nextRes = transitionTicketStatus({
        ticket: existing,
        action,
        session: req.authUser!,
        reason: typeof req.body?.reason === 'string' ? req.body.reason : req.body?.rejectionReason,
        workOrderDate:
          typeof req.body?.workOrderDate === 'string' ? req.body.workOrderDate : undefined,
        workOrderStartTime:
          typeof req.body?.workOrderStartTime === 'string'
            ? req.body.workOrderStartTime
            : undefined,
        workOrderDurationMins:
          req.body?.workOrderDurationMins !== undefined
            ? Number(req.body.workOrderDurationMins)
            : undefined,
        allTickets,
      });
      if (!nextRes.ok) {
        return res.status(400).json({ error: nextRes.error });
      }
      const updated = updateTicketInDb(db, id, nextRes.ticket, buildAuditActor(req));
      if (action === 'approve' && updated?.workOrderDate) {
        const emp = resolveEmployeeOrEntityForNotification(db, updated.employeeId);
        if (emp) {
          notifyTicketWorkOrderScheduled(db, {
            ticket: updated,
            employee: emp,
            baseUrl: getRequestBaseUrl(req),
          });
        }
      }
      return res.json({ ticket: updated });
    }

    if (!isAdminRole(req.authUser?.role) && !req.authUser?.permissions?.includes('role.manage')) {
      return res.status(403).json({
        error: 'Access Denied: Only Administrators can modify ticket schedules or fields directly.',
      });
    }

    if (
      req.body?.workOrderDate &&
      req.body?.workOrderStartTime &&
      req.body?.workOrderDurationMins
    ) {
      const overlap = hasAdminSlotOverlap({
        candidateDate: String(req.body.workOrderDate),
        candidateStartTime: String(req.body.workOrderStartTime),
        candidateDurationMins: Number(req.body.workOrderDurationMins),
        tickets: allTickets,
        ignoreTicketId: id,
      });
      if (overlap.overlapping) {
        return res.status(400).json({
          error: `Admin is already booked during ${overlap.conflictingTicket?.workOrderDate} ${overlap.conflictingTicket?.workOrderStartTime}–${overlap.conflictingTicket?.workOrderEndTime}.`,
        });
      }
    }

    const updated = updateTicketInDb(db, id, req.body || {}, buildAuditActor(req));
    if (!updated) return res.status(404).json({ error: 'Ticket not found.' });
    return res.json({ ticket: updated });
  });

  app.get(
    '/api/audit-logs',
    requireAuth(db),
    requireAnyPermission(['role.manage', 'employee.view', 'attendance.report']),
    (req, res) => {
      const limit = Number(req.query.limit) > 0 ? Math.min(Number(req.query.limit), 500) : 250;
      return res.json({ logs: listSystemAuditLogsFromDb(db, limit) });
    }
  );

  app.get(
    '/api/backup/export',
    requireAuth(db),
    requirePermission('role.manage'),
    (req: AuthenticatedRequest, res) => {
      const backup = exportFullBackupFromDb(db, buildAuditActor(req));
      return res.json({ backup });
    }
  );

  app.post(
    '/api/backup/restore',
    requireAuth(db),
    requirePermission('role.manage'),
    (req: AuthenticatedRequest, res) => {
      try {
        const mode = req.body?.mode === 'replace' ? 'replace' : 'merge';
        const payload = req.body?.backup && typeof req.body.backup === 'object' ? req.body.backup : req.body;
        const result = restoreFullBackupInDb(db, payload, mode, buildAuditActor(req));
        return res.json(result);
      } catch (err) {
        return res.status(400).json({ error: err instanceof Error ? err.message : 'Backup restore failed.' });
      }
    }
  );

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  return app;
}
