import type {
  Asset,
  Assignment,
  Employee,
  MaintenanceRecord,
  PersonnelEntity,
} from '../types/asset';
import type { PublicHoliday } from '../types/attendance';
import type { SupportTicket, TicketPriority, TicketStatus } from '../types/ticket';
import type { SessionUser } from '../types/user';
import { normalizeEmployeeId } from './assetMath';
import { parseTimeToMinutes } from './attendanceLogic';
import { canRaiseTicketOnDate } from './holidayRollover';

export const SELF_SERVICE_ENTITY_ROLES = [
  'Employee',
  'Consultant',
  'Retainer',
  'Freelancer',
  'Young Research Program',
  'Intern',
] as const;

export function isSelfServiceEntityRole(role?: string | null): boolean {
  return Boolean(role && (SELF_SERVICE_ENTITY_ROLES as readonly string[]).includes(role));
}

export interface TicketFormInput {
  assetId: string;
  subject: string;
  description: string;
  priority: TicketPriority | '';
  requestedDate?: string;
  requestedStartTime?: string;
  requestedDurationMins?: number;
}

export interface TicketValidationErrors {
  form?: string;
  assetId?: string;
  subject?: string;
  description?: string;
  priority?: string;
  requestedDate?: string;
  requestedStartTime?: string;
  requestedDurationMins?: string;
}

export interface OwnedAssetSummary {
  asset: Asset;
  assignedDate: string;
  assignmentId: string;
  custodyLevel?: 'Primary' | 'Sub-Assigned';
  subAssignedToName?: string;
  subAssignmentId?: string;
}

export interface ScopedEmployeeData {
  employee: Employee | null;
  entity?: PersonnelEntity | null;
  ownedAssets: OwnedAssetSummary[];
  assets: Asset[];
  tickets: SupportTicket[];
  maintenance: MaintenanceRecord[];
  openTicketsCount: number;
}

export function isManagerSession(session: SessionUser | null, employees: readonly Employee[] = []): boolean {
  if (!session) return false;
  if (session.role === 'Manager' || session.role === 'Department Manager' || Boolean(session.isManager)) {
    return true;
  }
  if (session.employeeId) {
    const norm = normalizeEmployeeId(session.employeeId);
    const emp = employees.find(
      (e) => e.id === session.employeeId || normalizeEmployeeId(e.employeeId || e.id) === norm
    );
    if (emp?.isManager) return true;
  }
  return false;
}

export function canUserRaiseTicket(session: SessionUser | null): boolean {
  if (!session) return false;
  return (
    isSelfServiceEntityRole(session.role) ||
    session.role === 'Manager' ||
    session.role === 'Department Manager'
  );
}

export function canUserManageTicketQueue(session: SessionUser | null): boolean {
  if (!session) return false;
  return (
    session.role === 'Administrator' ||
    session.role === 'Super Admin' ||
    session.role === 'Manager' ||
    session.role === 'Department Manager' ||
    Boolean(session.isManager)
  );
}

export function resolveEntityForSession(
  session: SessionUser | null,
  entities: readonly PersonnelEntity[] = []
): PersonnelEntity | null {
  if (!session || !canUserRaiseTicket(session) || entities.length === 0) return null;
  const keys = [session.entityId, session.employeeId, session.loginId]
    .filter((k): k is string => Boolean(k && k.trim()))
    .map((k) => k.trim().toUpperCase());
  for (const key of keys) {
    const found = entities.find(
      (ent) => ent.id.toUpperCase() === key || ent.entityCode.toUpperCase() === key
    );
    if (found) return found;
  }
  if (session.email) {
    const byEmail = entities.find((ent) => ent.email.toLowerCase() === session.email.toLowerCase());
    if (byEmail) return byEmail;
  }
  return null;
}

export function resolveEmployeeForSession(
  session: SessionUser | null,
  employees: Employee[]
): Employee | null {
  if (!session || !canUserRaiseTicket(session)) {
    return null;
  }
  if (session.employeeId) {
    const target = session.employeeId.trim();
    if (target) {
      const normalizedTarget = normalizeEmployeeId(target);
      const byId = employees.find(
        (emp) =>
          emp.id === target || normalizeEmployeeId(emp.employeeId || emp.id) === normalizedTarget
      );
      if (byId) return byId;
    }
  }
  if (session.email) {
    const byEmail = employees.find(
      (emp) => emp.email.toLowerCase() === session.email.toLowerCase()
    );
    if (byEmail) return byEmail;
  }
  return null;
}

/**
 * Single centralized check for "is this asset owned by / actively assigned to this employee or entity?"
 */
export function isAssetOwnedBy(
  asset: Pick<Asset, 'id' | 'status'> | undefined | null,
  employeeId: string | undefined | null,
  assignments: Assignment[],
  employees: Employee[] = [],
  entities: readonly PersonnelEntity[] = []
): boolean {
  if (!asset || !asset.id || asset.status === 'Disposed') {
    return false;
  }
  const rawEmployeeId = typeof employeeId === 'string' ? employeeId.trim() : '';
  if (!rawEmployeeId) {
    return false;
  }

  const normalizedInput = normalizeEmployeeId(rawEmployeeId);
  const upperInput = rawEmployeeId.toUpperCase();
  const candidateIds = new Set<string>([normalizedInput, upperInput]);

  if (employees.length > 0 || entities.length > 0) {
    const matchedEmployee = employees.find(
      (emp) =>
        emp.id === rawEmployeeId ||
        normalizeEmployeeId(emp.employeeId || emp.id) === normalizedInput
    );
    const matchedEntity = !matchedEmployee
      ? entities.find(
          (ent) => ent.id === rawEmployeeId || ent.entityCode.toUpperCase() === upperInput
        )
      : undefined;

    if (!matchedEmployee && !matchedEntity && employees.length > 0) {
      return false;
    }
    if (matchedEmployee) {
      candidateIds.add(normalizeEmployeeId(matchedEmployee.id));
      candidateIds.add(matchedEmployee.id.toUpperCase());
      if (matchedEmployee.employeeId) {
        candidateIds.add(normalizeEmployeeId(matchedEmployee.employeeId));
        candidateIds.add(matchedEmployee.employeeId.toUpperCase());
      }
    }
    if (matchedEntity) {
      candidateIds.add(matchedEntity.id.toUpperCase());
      candidateIds.add(matchedEntity.entityCode.toUpperCase());
    }
  }

  return assignments.some(
    (asn) =>
      asn.status === 'Active' &&
      asn.assetId === asset.id &&
      (candidateIds.has(normalizeEmployeeId(asn.employeeId)) ||
        candidateIds.has(asn.employeeId.trim().toUpperCase()))
  );
}

export function getAssignedAssetsForEmployee(
  session: SessionUser | null,
  employees: Employee[],
  assets: Asset[],
  assignments: Assignment[],
  entities: readonly PersonnelEntity[] = []
): Asset[] {
  if (!session) return [];
  const isMgr =
    session.role === 'Manager' ||
    session.role === 'Department Manager' ||
    Boolean(session.isManager);
  const resolvedEmployee = resolveEmployeeForSession(session, employees);
  const resolvedEntity = resolveEntityForSession(session, entities);
  const targetId = resolvedEntity?.id || resolvedEmployee?.id || session.entityId || session.employeeId;

  if (targetId) {
    const owned = assets.filter((asset) =>
      isAssetOwnedBy(asset, targetId, assignments, employees, entities)
    );
    if (owned.length > 0 || !isMgr) {
      return owned;
    }
  }

  // Managers raising operational/support tickets without personal asset assignments
  if (isMgr) {
    return assets.filter((a) => a.status !== 'Disposed');
  }

  return [];
}

export function isAssetAssignedToEmployee(
  assetId: string,
  session: SessionUser | null,
  employees: Employee[],
  assets: Asset[],
  assignments: Assignment[],
  entities: readonly PersonnelEntity[] = []
): boolean {
  const trimmed = typeof assetId === 'string' ? assetId.trim() : '';
  if (!trimmed || trimmed.includes(',') || trimmed.includes(' ')) {
    return false;
  }
  const resolvedEmployee = resolveEmployeeForSession(session, employees);
  const resolvedEntity = resolveEntityForSession(session, entities);
  const holderId = resolvedEntity?.id || resolvedEmployee?.id;
  if (!session || !holderId) {
    if (
      session &&
      (session.role === 'Manager' || session.role === 'Department Manager' || Boolean(session.isManager))
    ) {
      return assets.some((a) => a.id === trimmed && a.status !== 'Disposed');
    }
    return false;
  }
  const asset = assets.find((a) => a.id === trimmed);
  if (isAssetOwnedBy(asset, holderId, assignments, employees, entities)) {
    return true;
  }
  if (session.role === 'Manager' || session.role === 'Department Manager' || Boolean(session.isManager)) {
    return Boolean(asset && asset.status !== 'Disposed');
  }
  return false;
}

export function getScopedEmployeeData(params: {
  session: SessionUser | null;
  employees: Employee[];
  entities?: readonly PersonnelEntity[];
  assets: Asset[];
  assignments: Assignment[];
  tickets: SupportTicket[];
  maintenance: MaintenanceRecord[];
}): ScopedEmployeeData {
  const { session, employees, entities = [], assets, assignments, tickets, maintenance } = params;
  const employee = resolveEmployeeForSession(session, employees);
  const entity = resolveEntityForSession(session, entities);
  const isMgrRole =
    session?.role === 'Manager' ||
    session?.role === 'Department Manager' ||
    Boolean(session?.isManager);

  if (!session || !canUserRaiseTicket(session) || (!employee && !entity && !isMgrRole)) {
    return {
      employee: null,
      entity: null,
      ownedAssets: [],
      assets: [],
      tickets: [],
      maintenance: [],
      openTicketsCount: 0,
    };
  }

  const candidateIds = new Set<string>();
  if (session.employeeId) {
    candidateIds.add(normalizeEmployeeId(session.employeeId));
    candidateIds.add(session.employeeId.trim().toUpperCase());
  }
  if (session.entityId) {
    candidateIds.add(session.entityId.trim().toUpperCase());
  }
  if (employee) {
    candidateIds.add(normalizeEmployeeId(employee.id));
    candidateIds.add(employee.id.toUpperCase());
    if (employee.employeeId) {
      candidateIds.add(normalizeEmployeeId(employee.employeeId));
      candidateIds.add(employee.employeeId.toUpperCase());
    }
  }
  if (entity) {
    candidateIds.add(entity.id.toUpperCase());
    candidateIds.add(entity.entityCode.toUpperCase());
  }

  const holderId = entity?.id || employee?.id;
  const scopedAssets = holderId
    ? assets.filter((asset) => isAssetOwnedBy(asset, holderId, assignments, employees, entities))
    : [];

  const ticketSelectableAssets =
    scopedAssets.length === 0 && isMgrRole ? assets.filter((a) => a.status !== 'Disposed') : scopedAssets;

  const ownedAssetIds = new Set(ticketSelectableAssets.map((a) => a.id));

  const ownedAssets: OwnedAssetSummary[] = scopedAssets.map((asset) => {
    const activeAssignment = assignments.find(
      (asn) =>
        asn.status === 'Active' &&
        asn.assetId === asset.id &&
        (candidateIds.has(normalizeEmployeeId(asn.employeeId)) ||
          candidateIds.has(asn.employeeId.trim().toUpperCase()))
    );
    const childSub = activeAssignment
      ? assignments.find(
          (asn) =>
            asn.status === 'Active' &&
            asn.assetId === asset.id &&
            asn.custodyLevel === 'Sub-Assigned' &&
            (asn.parentAssignmentId === activeAssignment.id || asn.assignedById === holderId)
        )
      : undefined;
    let subHolderName: string | undefined;
    if (childSub) {
      subHolderName =
        entities.find((e) => e.id === childSub.employeeId || e.entityCode === childSub.employeeId)?.name ||
        employees.find((e) => e.id === childSub.employeeId || e.employeeId === childSub.employeeId)?.name ||
        childSub.employeeId;
    }

    return {
      asset,
      assignedDate: activeAssignment?.assignDate || '—',
      assignmentId: activeAssignment?.id || '',
      custodyLevel: activeAssignment?.custodyLevel || 'Primary',
      subAssignedToName: subHolderName,
      subAssignmentId: childSub?.id,
    };
  });

  const scopedTickets = getTicketsForEmployee(tickets, session);
  const scopedMaintenance = maintenance.filter((m) => ownedAssetIds.has(m.assetId));

  return {
    employee,
    entity,
    ownedAssets,
    assets: ticketSelectableAssets,
    tickets: scopedTickets,
    maintenance: scopedMaintenance,
    openTicketsCount: scopedTickets.filter((t) => t.status === 'Open' || t.status === 'Requested').length,
  };
}

// =========================================================================
// WORK ORDER MINUTE MATH & ADMIN SLOT LOCKING
// =========================================================================

export function formatMinutesToTime(totalMinutes: number): string {
  const safe = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMinutes)));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function computeWorkOrderEndTime(startTime: string, durationMins: number): string | null {
  const start = parseTimeToMinutes(startTime);
  if (start === null || !Number.isFinite(durationMins) || durationMins < 1) return null;
  const end = start + Math.round(durationMins);
  if (end > 24 * 60) return null;
  if (end === 24 * 60) return '23:59';
  return formatMinutesToTime(end);
}

export function hasAdminSlotOverlap(params: {
  candidateDate: string;
  candidateStartTime: string;
  candidateDurationMins: number;
  tickets: readonly SupportTicket[];
  ignoreTicketId?: string;
}): { overlapping: boolean; conflictingTicket?: SupportTicket } {
  const { candidateDate, candidateStartTime, candidateDurationMins, tickets, ignoreTicketId } = params;
  const candStart = parseTimeToMinutes(candidateStartTime);
  if (candStart === null || !Number.isFinite(candidateDurationMins) || candidateDurationMins < 1) {
    return { overlapping: false };
  }
  const candEnd = candStart + Math.round(candidateDurationMins);

  for (const t of tickets) {
    if (ignoreTicketId && t.id === ignoreTicketId) continue;
    if (t.status === 'Closed' || t.status === 'Rejected') continue;
    if (!t.workOrderDate || !t.workOrderStartTime || !t.workOrderDurationMins) continue;
    if (t.workOrderDate !== candidateDate) continue;

    const woStart = parseTimeToMinutes(t.workOrderStartTime);
    if (woStart === null) continue;
    const woEnd = woStart + Math.round(t.workOrderDurationMins);

    // Intervals [candStart, candEnd) and [woStart, woEnd) overlap if candStart < woEnd && woStart < candEnd
    if (candStart < woEnd && woStart < candEnd) {
      return { overlapping: true, conflictingTicket: t };
    }
  }
  return { overlapping: false };
}

export function isWorkOrderOverrunning(ticket: SupportTicket, now: Date = new Date()): boolean {
  if (ticket.status === 'Closed' || ticket.status === 'Rejected') return false;
  if (!ticket.workOrderDate || !ticket.workOrderStartTime || !ticket.workOrderDurationMins) {
    return false;
  }
  const woStart = parseTimeToMinutes(ticket.workOrderStartTime);
  if (woStart === null) return false;
  const woEndMins = woStart + Math.round(ticket.workOrderDurationMins);
  const endDate = new Date(`${ticket.workOrderDate}T00:00:00Z`);
  if (Number.isNaN(endDate.getTime())) return false;
  const endMs = endDate.getTime() + woEndMins * 60_000;
  return now.getTime() > endMs;
}

export function resolveEffectiveTicketStatus(ticket: SupportTicket, now: Date = new Date()): TicketStatus {
  if (ticket.status === 'Approved' && isWorkOrderOverrunning(ticket, now)) {
    return 'Open';
  }
  return ticket.status;
}

export function sortTicketsFcfs(tickets: readonly SupportTicket[]): SupportTicket[] {
  return [...tickets].sort((a, b) => {
    const qA = typeof a.queueOrder === 'number' && a.queueOrder > 0 ? a.queueOrder : Number.MAX_SAFE_INTEGER;
    const qB = typeof b.queueOrder === 'number' && b.queueOrder > 0 ? b.queueOrder : Number.MAX_SAFE_INTEGER;
    if (qA !== qB) return qA - qB;
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });
}

export function reorderTicketQueueList(
  tickets: readonly SupportTicket[],
  orderedTicketIds: readonly string[]
): SupportTicket[] {
  const rankMap = new Map<string, number>();
  orderedTicketIds.forEach((id, idx) => rankMap.set(id, idx + 1));
  let fallbackOrder = orderedTicketIds.length + 1;

  const updated = sortTicketsFcfs(tickets).map((t) => {
    const nextRank = rankMap.get(t.id) ?? fallbackOrder++;
    return { ...t, queueOrder: nextRank };
  });
  return sortTicketsFcfs(updated);
}

// =========================================================================
// VALIDATION & LIFECYCLE TRANSITIONS
// =========================================================================

export function validateTicketInput(
  input: TicketFormInput,
  assignedAssets: Asset[],
  session: SessionUser | null,
  resolvedEmployee?: Employee | null,
  options?: {
    dateStr?: string;
    holidays?: readonly PublicHoliday[];
    existingTickets?: readonly SupportTicket[];
    employees?: readonly Employee[];
    resolvedEntity?: PersonnelEntity | null;
  }
): { valid: boolean; errors: TicketValidationErrors } {
  const errors: TicketValidationErrors = {};
  const isMgr = Boolean(
    session &&
      (session.role === 'Manager' ||
        session.role === 'Department Manager' ||
        isManagerSession(session, options?.employees || []))
  );

  if (!session || !canUserRaiseTicket(session)) {
    errors.form = 'Only an authorized user account can create a support ticket.';
  } else if (
    session.role === 'Employee' &&
    (!session.employeeId || resolvedEmployee === null)
  ) {
    errors.form = 'Your account is not linked to an Employee record. Contact an administrator.';
  } else if (
    isSelfServiceEntityRole(session.role) &&
    session.role !== 'Employee' &&
    !session.entityId &&
    !session.employeeId &&
    options?.resolvedEntity === null
  ) {
    errors.form = `Your ${session.role} account is not linked to a personnel record. Contact an administrator.`;
  } else if (assignedAssets.length === 0) {
    errors.form = 'No assets are currently assigned to you.';
  }

  // Day-of-week & Indian National Holiday validation
  if (!errors.form && options?.dateStr) {
    const scheduleCheck = canRaiseTicketOnDate({
      role: session?.role,
      isManager: isMgr,
      dateStr: options.dateStr,
      holidays: options.holidays || [],
    });
    if (!scheduleCheck.allowed) {
      errors.requestedDate = scheduleCheck.reason;
      errors.form = scheduleCheck.reason;
    }
  }

  // Admin Booked Work Order Slot Locking for Employees & Entity users (and requested slot overlap)
  if (
    !errors.form &&
    !isMgr &&
    input.requestedDate &&
    input.requestedStartTime &&
    options?.existingTickets
  ) {
    const dur = Number(input.requestedDurationMins) || 30;
    const overlap = hasAdminSlotOverlap({
      candidateDate: input.requestedDate,
      candidateStartTime: input.requestedStartTime,
      candidateDurationMins: dur,
      tickets: options.existingTickets,
    });
    if (overlap.overlapping) {
      const conf = overlap.conflictingTicket!;
      const msg = `Admin is booked on ${conf.workOrderDate} from ${conf.workOrderStartTime} to ${conf.workOrderEndTime}. Choose a non-overlapping slot.`;
      errors.requestedStartTime = msg;
      errors.form = msg;
    }
  }

  const rawAssetId = typeof input.assetId === 'string' ? input.assetId.trim() : '';
  if (!rawAssetId) {
    errors.assetId = 'Please select an assigned asset for this ticket.';
  } else if (rawAssetId.includes(',') || rawAssetId.includes(' ')) {
    errors.assetId = 'A ticket must be linked to exactly one asset.';
  } else if (!assignedAssets.some((a) => a.id === rawAssetId)) {
    errors.assetId = 'Selected asset is not currently assigned to your account.';
  }

  const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
  if (!subject) {
    errors.subject = 'Subject is required.';
  } else if (subject.length < 5) {
    errors.subject = 'Subject must be at least 5 characters.';
  } else if (subject.length > 100) {
    errors.subject = 'Subject cannot exceed 100 characters.';
  }

  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (!description) {
    errors.description = 'Description is required.';
  } else if (description.length < 10) {
    errors.description = 'Description must be at least 10 characters.';
  } else if (description.length > 1000) {
    errors.description = 'Description cannot exceed 1000 characters.';
  }

  const priority = typeof input.priority === 'string' ? input.priority.trim() : '';
  if (priority !== 'Low' && priority !== 'Medium' && priority !== 'High') {
    errors.priority = 'Please select a ticket priority (Low, Medium, or High).';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function createSupportTicketRecord(params: {
  input: TicketFormInput;
  session: SessionUser | null;
  employees: Employee[];
  entities?: readonly PersonnelEntity[];
  assets: Asset[];
  assignments: Assignment[];
  existingTickets?: SupportTicket[];
  holidays?: PublicHoliday[];
  now?: Date;
}): { ok: true; ticket: SupportTicket } | { ok: false; errors: TicketValidationErrors } {
  const {
    input,
    session,
    employees,
    entities = [],
    assets,
    assignments,
    existingTickets = [],
    holidays = [],
    now = new Date(),
  } = params;

  const resolvedEmployee = resolveEmployeeForSession(session, employees);
  const resolvedEntity = resolveEntityForSession(session, entities);
  const assignedAssets = getAssignedAssetsForEmployee(session, employees, assets, assignments, entities);
  const fallbackDateStr = now.toISOString().split('T')[0];
  const checkDateStr =
    input.requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(input.requestedDate)
      ? input.requestedDate
      : fallbackDateStr;

  const validation = validateTicketInput(input, assignedAssets, session, resolvedEmployee, {
    dateStr: checkDateStr,
    holidays,
    existingTickets,
    employees,
    resolvedEntity,
  });

  const targetAsset = assets.find((a) => a.id === input.assetId.trim());
  const isMgr = Boolean(
    session &&
      (session.role === 'Manager' || session.role === 'Department Manager' || Boolean(session.isManager))
  );
  const holderId = resolvedEntity?.id || session?.entityId || session?.employeeId || resolvedEmployee?.id;
  const ownsAssetAtSaveTime = Boolean(
    session &&
      ((holderId &&
        isAssetOwnedBy(targetAsset, holderId, assignments, employees, entities)) ||
        (isMgr && targetAsset && targetAsset.status !== 'Disposed'))
  );

  if (!validation.valid || !session || (!resolvedEmployee && !resolvedEntity && !isMgr) || !ownsAssetAtSaveTime) {
    return {
      ok: false,
      errors: validation.valid
        ? {
            ...validation.errors,
            assetId: 'Selected asset is not currently assigned to your account.',
          }
        : validation.errors,
    };
  }

  const maxQueue = existingTickets.reduce(
    (max, t) => Math.max(max, typeof t.queueOrder === 'number' ? t.queueOrder : 0),
    existingTickets.length
  );

  const id =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `tkt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const ownerEmployeeId = (
    resolvedEntity?.id ||
    session.entityId ||
    session.employeeId ||
    resolvedEmployee?.id ||
    session.id
  ).trim();

  const ticket: SupportTicket = {
    id,
    employeeId: ownerEmployeeId,
    assetId: input.assetId.trim(),
    subject: input.subject.trim(),
    description: input.description.trim(),
    priority: input.priority as TicketPriority,
    status: 'Requested',
    createdAt: now.toISOString(),
    queueOrder: maxQueue + 1,
    createdByRole: isMgr ? 'Manager' : session.role || 'Employee',
    requestedDate: checkDateStr,
    requestedStartTime: input.requestedStartTime || undefined,
    requestedDurationMins: input.requestedDurationMins || undefined,
    approvalStatus: 'Pending',
  };

  return { ok: true, ticket };
}

export interface TicketStatusSummary {
  total: number;
  requested: number;
  open: number;
  approved: number;
  rejected: number;
  closed: number;
  pendingApproval: number;
  requestedPct: number;
  openPct: number;
  approvedPct: number;
  rejectedPct: number;
  closedPct: number;
}

export function computeTicketStatusSummary(tickets: SupportTicket[]): TicketStatusSummary {
  const total = tickets.length;
  const requested = tickets.filter((t) => t.status === 'Requested').length;
  const open = tickets.filter((t) => t.status === 'Open').length;
  const approved = tickets.filter((t) => t.status === 'Approved').length;
  const rejected = tickets.filter((t) => t.status === 'Rejected').length;
  const closed = tickets.filter((t) => t.status === 'Closed').length;
  const pendingApproval = tickets.filter((t) => t.approvalStatus === 'Pending').length;

  const pct = (count: number) => (total === 0 ? 0 : Math.round((count / total) * 100));

  return {
    total,
    requested,
    open,
    approved,
    rejected,
    closed,
    pendingApproval,
    requestedPct: pct(requested),
    openPct: pct(open),
    approvedPct: pct(approved),
    rejectedPct: pct(rejected),
    closedPct: pct(closed),
  };
}

export function filterTickets(
  tickets: SupportTicket[],
  query: string,
  statusFilter: TicketStatus | 'ALL',
  employees: Employee[],
  assets: Asset[],
  entities: readonly PersonnelEntity[] = []
): SupportTicket[] {
  const q = query.trim().toLowerCase();
  const ordered = sortTicketsFcfs(tickets);
  return ordered.filter((t) => {
    if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
    if (!q) return true;
    const emp = employees.find((e) => e.id === t.employeeId || e.employeeId === t.employeeId);
    const ent = !emp
      ? entities.find((e) => e.id === t.employeeId || e.entityCode.toUpperCase() === t.employeeId.toUpperCase())
      : undefined;
    const asset = assets.find((a) => a.id === t.assetId);
    return (
      t.id.toLowerCase().includes(q) ||
      t.subject.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.assetId.toLowerCase().includes(q) ||
      (emp?.name.toLowerCase().includes(q) ?? false) ||
      (emp?.employeeId.toLowerCase().includes(q) ?? false) ||
      (ent?.name.toLowerCase().includes(q) ?? false) ||
      (ent?.entityCode.toLowerCase().includes(q) ?? false) ||
      (asset?.name.toLowerCase().includes(q) ?? false)
    );
  });
}

export function transitionTicketStatus(params: {
  ticket: SupportTicket;
  action: 'approve' | 'reject' | 'close';
  session: SessionUser | null;
  reason?: string;
  workOrderDate?: string;
  workOrderStartTime?: string;
  workOrderDurationMins?: number;
  allTickets?: readonly SupportTicket[];
  now?: Date;
}): { ok: true; ticket: SupportTicket } | { ok: false; error: string } {
  const {
    ticket,
    action,
    session,
    reason,
    workOrderDate,
    workOrderStartTime,
    workOrderDurationMins,
    allTickets = [],
    now = new Date(),
  } = params;

  const isAdminOrMgr =
    session &&
    (session.role === 'Administrator' ||
      session.role === 'Super Admin' ||
      session.role === 'Manager' ||
      session.role === 'Department Manager' ||
      Boolean(session.isManager));

  const isOwner =
    session &&
    ((session.employeeId && ticket.employeeId === session.employeeId) ||
      (session.entityId && ticket.employeeId === session.entityId) ||
      ticket.employeeId === session.id);

  if (action === 'close') {
    if (!session || (!isAdminOrMgr && !isOwner)) {
      return { ok: false, error: 'Only an Administrator, Manager, or the ticket owner can close this ticket.' };
    }
    const ts = now.toISOString();
    return {
      ok: true,
      ticket: {
        ...ticket,
        status: 'Closed',
        closedBy: session.fullName,
        closedAt: ts,
      },
    };
  }

  if (!session || (session.role !== 'Administrator' && session.role !== 'Super Admin')) {
    return { ok: false, error: 'Only an Administrator can update ticket approval status.' };
  }

  const timestamp = now.toISOString();

  if (action === 'approve') {
    let nextWorkDate = workOrderDate;
    let nextWorkStart = workOrderStartTime;
    let nextDuration = workOrderDurationMins;
    let nextEndTime: string | undefined;

    if (nextWorkDate || nextWorkStart || nextDuration !== undefined) {
      if (!nextWorkDate || !nextWorkStart || !nextDuration || nextDuration < 1) {
        return {
          ok: false,
          error: 'Work Order requires a valid date, start time, and duration in minutes (min 1).',
        };
      }
      const computedEnd = computeWorkOrderEndTime(nextWorkStart, nextDuration);
      if (!computedEnd) {
        return {
          ok: false,
          error: 'Invalid Work Order start time or minute duration extends past midnight.',
        };
      }
      if (allTickets.length > 0) {
        const overlap = hasAdminSlotOverlap({
          candidateDate: nextWorkDate,
          candidateStartTime: nextWorkStart,
          candidateDurationMins: nextDuration,
          tickets: allTickets,
          ignoreTicketId: ticket.id,
        });
        if (overlap.overlapping) {
          return {
            ok: false,
            error: `Admin is already booked on ${overlap.conflictingTicket?.workOrderDate} (${overlap.conflictingTicket?.workOrderStartTime}–${overlap.conflictingTicket?.workOrderEndTime}).`,
          };
        }
      }
      nextEndTime = computedEnd;
    }

    return {
      ok: true,
      ticket: {
        ...ticket,
        status: 'Approved',
        approvalStatus: 'Approved',
        approvedBy: session.fullName,
        approvedAt: timestamp,
        rejectionReason: undefined,
        workOrderDate: nextWorkDate ?? ticket.workOrderDate,
        workOrderStartTime: nextWorkStart ?? ticket.workOrderStartTime,
        workOrderDurationMins: nextDuration ?? ticket.workOrderDurationMins,
        workOrderEndTime: nextEndTime ?? ticket.workOrderEndTime,
      },
    };
  }

  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  if (!trimmedReason) {
    return { ok: false, error: 'A rejection reason is required.' };
  }
  return {
    ok: true,
    ticket: {
      ...ticket,
      status: 'Rejected',
      approvalStatus: 'Rejected',
      approvedBy: session.fullName,
      approvedAt: timestamp,
      rejectionReason: trimmedReason,
    },
  };
}

export function confirmWorkOrderByEmployee(params: {
  ticket: SupportTicket;
  session: SessionUser | null;
  now?: Date;
}): { ok: true; ticket: SupportTicket } | { ok: false; error: string } {
  const { ticket, session, now = new Date() } = params;
  if (!session) {
    return { ok: false, error: 'Authentication required.' };
  }
  const isOwner =
    (session.employeeId && ticket.employeeId === session.employeeId) ||
    (session.entityId && ticket.employeeId === session.entityId) ||
    ticket.employeeId === session.id;
  if (!isOwner && session.role !== 'Administrator' && session.role !== 'Super Admin') {
    return { ok: false, error: 'Only the requesting Employee can confirm this Work Order.' };
  }
  if (!ticket.workOrderDate || !ticket.workOrderStartTime || !ticket.workOrderDurationMins) {
    return { ok: false, error: 'Work Order has not been generated by Admin yet.' };
  }
  return {
    ok: true,
    ticket: {
      ...ticket,
      employeeConfirmed: true,
      employeeConfirmedAt: now.toISOString(),
    },
  };
}

export function getTicketsForEmployee(
  tickets: SupportTicket[],
  session: SessionUser | null
): SupportTicket[] {
  if (!session || !canUserRaiseTicket(session)) {
    return [];
  }
  const candidate = new Set<string>();
  if (session.employeeId) candidate.add(session.employeeId);
  if (session.entityId) candidate.add(session.entityId);
  candidate.add(session.id);
  return sortTicketsFcfs(tickets.filter((t) => candidate.has(t.employeeId)));
}

export function cancelOwnOpenTicket(params: {
  ticket: SupportTicket;
  session: SessionUser | null;
}): { ok: true; ticket: SupportTicket } | { ok: false; error: string } {
  const { ticket, session } = params;
  if (!session || !canUserRaiseTicket(session)) {
    return { ok: false, error: 'Only the owning Employee or Manager can cancel a ticket.' };
  }
  const owns =
    (session.employeeId && ticket.employeeId === session.employeeId) ||
    (session.entityId && ticket.employeeId === session.entityId) ||
    ticket.employeeId === session.id;
  if (!owns) {
    return { ok: false, error: 'You cannot cancel another employee’s ticket.' };
  }
  if (ticket.status !== 'Open' && ticket.status !== 'Requested') {
    return { ok: false, error: 'Only Requested or Open tickets can be cancelled.' };
  }
  return {
    ok: true,
    ticket: {
      ...ticket,
      status: 'Closed',
      closedBy: session.fullName,
      closedAt: new Date().toISOString(),
    },
  };
}

export function formatTicketTimestamp(isoString: string): {
  date: string;
  time: string;
  full: string;
} {
  if (!isoString || typeof isoString !== 'string') {
    return { date: '—', time: '—', full: '—' };
  }
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) {
    return { date: isoString, time: '', full: isoString };
  }
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
  const time = d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  return {
    date,
    time,
    full: `${date} · ${time}`,
  };
}
