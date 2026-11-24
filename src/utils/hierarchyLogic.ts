import type { Employee, PersonnelEntity } from '../types/asset';
import type { LeaveRecord } from '../types/attendance';
import type { SessionUser } from '../types/user';

export function isAdminRole(role?: string | null): boolean {
  return role === 'Super Admin' || role === 'Administrator';
}

export function canModifyManagerFields(user: Pick<SessionUser, 'role'> | null | undefined): boolean {
  return Boolean(user && isAdminRole(user.role));
}

export function canManagePolicies(user: Pick<SessionUser, 'role'> | null | undefined): boolean {
  return Boolean(user && isAdminRole(user.role));
}

export function canOverrideLeaveDecision(user: Pick<SessionUser, 'role'> | null | undefined): boolean {
  return Boolean(user && isAdminRole(user.role));
}

export function canConsultantActAsManager(
  entity: Pick<PersonnelEntity, 'entityType' | 'isManager' | 'status'> | null | undefined
): boolean {
  return Boolean(entity && entity.entityType === 'Consultant' && entity.isManager && entity.status === 'Active');
}

export function validateRevokeConsultantManager(params: {
  consultant: Pick<PersonnelEntity, 'id' | 'name' | 'entityCode' | 'entityType' | 'isManager'>;
  employees: readonly Employee[];
  entities?: readonly PersonnelEntity[];
  forceUnassign?: boolean;
}): { ok: true } | { ok: false; error: string; activeReportCount: number } {
  const { consultant, employees, entities = [], forceUnassign } = params;
  if (consultant.entityType !== 'Consultant') {
    return { ok: false, error: 'Manager privilege toggle is only applicable to Consultants.', activeReportCount: 0 };
  }
  const activeEmpReports = employees.filter(
    (e) =>
      e.status === 'Active' &&
      (e.reportingManagerId === consultant.id || e.reportingManagerId === consultant.entityCode)
  );
  const activeEntReports = entities.filter(
    (e) =>
      e.id !== consultant.id &&
      e.status === 'Active' &&
      (e.reportingManagerId === consultant.id || e.reportingManagerId === consultant.entityCode)
  );
  const total = activeEmpReports.length + activeEntReports.length;
  if (total > 0 && !forceUnassign) {
    return {
      ok: false,
      activeReportCount: total,
      error: `${consultant.name} (${consultant.entityCode}) currently has ${total} active team member(s). Reassign them or confirm unassignment before revoking Manager privileges.`,
    };
  }
  return { ok: true };
}

export function resolveEmployeeByIdentifier(
  employees: readonly Employee[],
  idOrCode?: string | null
): Employee | undefined {
  const key = (idOrCode || '').trim().toLowerCase();
  if (!key) return undefined;
  return employees.find(
    (e) => e.id.toLowerCase() === key || e.employeeId.toLowerCase() === key
  );
}

export function resolveEntityByIdentifier(
  entities: readonly PersonnelEntity[],
  idOrCode?: string | null
): PersonnelEntity | undefined {
  const key = (idOrCode || '').trim().toLowerCase();
  if (!key) return undefined;
  return entities.find(
    (e) => e.id.toLowerCase() === key || e.entityCode.toLowerCase() === key
  );
}

export function isEmployeeManagerUser(
  user: Pick<SessionUser, 'role' | 'employeeId' | 'entityId' | 'email' | 'isManager'> | null | undefined,
  employees: readonly Employee[] = [],
  entities: readonly PersonnelEntity[] = []
): boolean {
  if (!user) return false;
  if (user.isManager) return true;
  if (user.role === 'Department Manager' || user.role === 'Manager') return true;
  const linked = resolveEmployeeByIdentifier(employees, user.employeeId);
  if (linked?.isManager) return true;
  const linkedEnt = resolveEntityByIdentifier(entities, user.entityId || user.employeeId);
  if (canConsultantActAsManager(linkedEnt)) return true;
  if (linked) {
    return employees.some(
      (e) =>
        e.reportingManagerId === linked.id ||
        (e.reportingManagerEmail &&
          linked.email &&
          e.reportingManagerEmail.toLowerCase() === linked.email.toLowerCase())
    );
  }
  if (linkedEnt) {
    return employees.some((e) => e.reportingManagerId === linkedEnt.id || e.reportingManagerId === linkedEnt.entityCode);
  }
  return false;
}

export function getDirectReportsForManager(
  employees: readonly Employee[],
  managerEmployeeId?: string | null,
  managerEmail?: string | null,
  entities: readonly PersonnelEntity[] = []
): Employee[] {
  const mgr = resolveEmployeeByIdentifier(employees, managerEmployeeId);
  const mgrEnt = resolveEntityByIdentifier(entities, managerEmployeeId);
  const candidateMgrIds = new Set<string>();
  if (mgr?.id) candidateMgrIds.add(mgr.id);
  if (mgrEnt?.id) candidateMgrIds.add(mgrEnt.id);
  if (mgrEnt?.entityCode) candidateMgrIds.add(mgrEnt.entityCode);
  if (managerEmployeeId?.trim()) candidateMgrIds.add(managerEmployeeId.trim());

  const resolvedEmail = (mgr?.email || mgrEnt?.email || managerEmail || '').trim().toLowerCase();

  if (candidateMgrIds.size === 0 && !resolvedEmail) return [];

  return employees.filter((emp) => {
    if (mgr?.id && emp.id === mgr.id) return false;
    if (emp.reportingManagerId) {
      return candidateMgrIds.has(emp.reportingManagerId);
    }
    if (resolvedEmail && emp.reportingManagerEmail) {
      return emp.reportingManagerEmail.toLowerCase() === resolvedEmail;
    }
    return false;
  });
}

export function validateManagerMapping(params: {
  employees: readonly Employee[];
  entities?: readonly PersonnelEntity[];
  employeeId?: string;
  reportingManagerId?: string | null;
}): { ok: true; manager?: Employee; consultantManager?: PersonnelEntity } | { ok: false; error: string } {
  const { employees, entities = [], employeeId } = params;
  const rawMgrId = (params.reportingManagerId || '').trim();
  if (!rawMgrId) {
    return { ok: true, manager: undefined };
  }

  const manager = resolveEmployeeByIdentifier(employees, rawMgrId);
  const consultantMgr = !manager ? resolveEntityByIdentifier(entities, rawMgrId) : undefined;
  if (!manager && !consultantMgr) {
    return { ok: false, error: `Selected reporting manager "${rawMgrId}" was not found.` };
  }

  if (consultantMgr) {
    if (!canConsultantActAsManager(consultantMgr)) {
      return {
        ok: false,
        error: `${consultantMgr.name} (${consultantMgr.entityCode}) does not have Manager privileges enabled.`,
      };
    }
    return { ok: true, consultantManager: consultantMgr };
  }

  const resolvedMgr = manager!;
  const normalizedEmpId = (employeeId || '').trim();
  if (
    normalizedEmpId &&
    (resolvedMgr.id === normalizedEmpId ||
      resolvedMgr.employeeId.toLowerCase() === normalizedEmpId.toLowerCase())
  ) {
    return { ok: false, error: 'An employee cannot report to themselves.' };
  }

  if (!resolvedMgr.isManager) {
    return {
      ok: false,
      error: `${resolvedMgr.name} (${resolvedMgr.employeeId}) is not marked as a Manager ("Is Manager? = Yes").`,
    };
  }

  // Prevent circular reporting hierarchy (A -> B -> ... -> A)
  if (normalizedEmpId) {
    const targetEmp = resolveEmployeeByIdentifier(employees, normalizedEmpId);
    const selfId = targetEmp?.id || normalizedEmpId;
    const visited = new Set<string>([selfId]);
    let cursor: Employee | undefined = resolvedMgr;
    while (cursor) {
      if (visited.has(cursor.id)) {
        return {
          ok: false,
          error: `Circular reporting hierarchy detected involving ${cursor.name} (${cursor.employeeId}).`,
        };
      }
      visited.add(cursor.id);
      if (!cursor.reportingManagerId) break;
      cursor = resolveEmployeeByIdentifier(employees, cursor.reportingManagerId);
    }
  }

  return { ok: true, manager: resolvedMgr };
}

export function canUserApproveLeave(params: {
  user: Pick<SessionUser, 'role' | 'employeeId' | 'entityId' | 'email' | 'department' | 'permissions' | 'isManager'>;
  leave: Pick<LeaveRecord, 'employeeId' | 'managerId' | 'department' | 'status'>;
  targetEmployee?: Employee;
  employees?: readonly Employee[];
  entities?: readonly PersonnelEntity[];
}): { allowed: boolean; isOverride: boolean; reason?: string } {
  const { user, leave, targetEmployee, employees = [], entities = [] } = params;
  const isAdmin = isAdminRole(user.role);
  const alreadyDecided = leave.status !== 'Pending';

  if (isAdmin) {
    return { allowed: true, isOverride: alreadyDecided };
  }

  // Non-admins cannot override already decided leave requests
  if (alreadyDecided) {
    return {
      allowed: false,
      isOverride: false,
      reason: 'Only an Administrator can override a leave decision after approval or rejection.',
    };
  }

  const actorEmp = resolveEmployeeByIdentifier(employees, user.employeeId);
  const actorEnt = resolveEntityByIdentifier(entities, user.entityId || user.employeeId);
  const actorIds = new Set<string>(
    [actorEmp?.id, actorEnt?.id, actorEnt?.entityCode, user.employeeId, user.entityId]
      .filter((x): x is string => Boolean(x && x.trim()))
  );

  // Direct reporting manager routing check
  const assignedManagerId = leave.managerId || targetEmployee?.reportingManagerId || '';
  if (assignedManagerId && actorIds.has(assignedManagerId)) {
    return { allowed: true, isOverride: false };
  }

  if (
    user.email &&
    targetEmployee?.reportingManagerEmail &&
    targetEmployee.reportingManagerEmail.toLowerCase() === user.email.toLowerCase()
  ) {
    return { allowed: true, isOverride: false };
  }

  const hasAttendanceEdit =
    Array.isArray(user.permissions) && user.permissions.includes('attendance.edit');

  if (user.role === 'HR Manager' && hasAttendanceEdit) {
    return { allowed: true, isOverride: false };
  }

  if (
    (user.role === 'Department Manager' || user.role === 'Manager') &&
    hasAttendanceEdit
  ) {
    const empDept = targetEmployee?.department || leave.department;
    if (!user.department || empDept === user.department) {
      return { allowed: true, isOverride: false };
    }
  }

  return {
    allowed: false,
    isOverride: false,
    reason: 'You are not the assigned reporting manager for this leave request.',
  };
}
