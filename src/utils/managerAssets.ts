import type {
  Asset,
  AssetCondition,
  AssetStatus,
  Assignment,
  Employee,
  PersonnelEntity,
} from '../types/asset';
import type { SessionUser } from '../types/user';
import { normalizeEmployeeId } from './assetMath';
import {
  getDirectReportsForManager,
  isEmployeeManagerUser,
  resolveEmployeeByIdentifier,
  resolveEntityByIdentifier,
} from './hierarchyLogic';
import { isAssetOwnedBy, type OwnedAssetSummary } from './ticketLogic';

export interface ManagerPersonalAssetsResult {
  isManager: boolean;
  managerName: string;
  managerCode: string;
  personalAssets: OwnedAssetSummary[];
  personalAssetCount: number;
}

export interface TeamMemberAssetRow {
  employeeRecordId: string;
  employeeName: string;
  employeeId: string;
  department: string;
  designation: string;
  assetId: string;
  assetName: string;
  category: string;
  brand: string;
  model: string;
  serial: string;
  status: AssetStatus;
  condition: AssetCondition;
  dateOfIssue: string;
  location: string;
}

export interface TeamMemberAssetGroup {
  employeeRecordId: string;
  employeeName: string;
  employeeId: string;
  department: string;
  designation: string;
  totalAssets: number;
  assets: TeamMemberAssetRow[];
}

export interface ManagerTeamMemberAssetsResult {
  isManager: boolean;
  shouldShowSection: boolean;
  reportingEmployeesCount: number;
  overallTeamAssetCount: number;
  groups: TeamMemberAssetGroup[];
}

function collectHolderCandidateIds(
  employee?: Employee | null,
  entity?: PersonnelEntity | null,
  session?: SessionUser | null
): Set<string> {
  const keys = new Set<string>();
  const add = (val?: string | null) => {
    const trimmed = typeof val === 'string' ? val.trim() : '';
    if (!trimmed) return;
    keys.add(trimmed.toUpperCase());
    keys.add(normalizeEmployeeId(trimmed));
  };
  if (employee) {
    add(employee.id);
    add(employee.employeeId);
  }
  if (entity) {
    add(entity.id);
    add(entity.entityCode);
  }
  if (session) {
    add(session.employeeId);
    add(session.entityId);
  }
  return keys;
}

/**
 * Strictly computes the assets directly and actively assigned to the manager themselves.
 * NEVER includes team member assets and NEVER falls back to company-wide assets.
 */
export function getManagerPersonalAssets(params: {
  session: SessionUser | null;
  employees: readonly Employee[];
  entities?: readonly PersonnelEntity[];
  assets: readonly Asset[];
  assignments: readonly Assignment[];
}): ManagerPersonalAssetsResult {
  const { session, employees, entities = [], assets, assignments } = params;
  if (!session) {
    return {
      isManager: false,
      managerName: '',
      managerCode: '',
      personalAssets: [],
      personalAssetCount: 0,
    };
  }

  const isManager = isEmployeeManagerUser(session, employees, entities);
  const empById = resolveEmployeeByIdentifier(employees, session.employeeId);
  const empByEmail =
    !empById && session.email
      ? employees.find((e) => e.email.toLowerCase() === session.email.toLowerCase())
      : undefined;
  const employee = empById || empByEmail || null;

  const entById = resolveEntityByIdentifier(entities, session.entityId || session.employeeId);
  const entByEmail =
    !entById && session.email
      ? entities.find((e) => e.email.toLowerCase() === session.email.toLowerCase())
      : undefined;
  const entity = entById || entByEmail || null;

  const managerName = employee?.name || entity?.name || session.fullName;
  const managerCode = employee?.employeeId || entity?.entityCode || session.employeeId || '';
  const holderId = entity?.id || employee?.id || session.entityId || session.employeeId;

  if (!holderId) {
    return {
      isManager,
      managerName,
      managerCode,
      personalAssets: [],
      personalAssetCount: 0,
    };
  }

  const candidateIds = collectHolderCandidateIds(employee, entity, session);
  const mutableEmployees = employees as Employee[];
  const mutableAssignments = assignments as Assignment[];

  const directlyOwnedAssets = assets.filter((asset) =>
    isAssetOwnedBy(asset, holderId, mutableAssignments, mutableEmployees, entities)
  );

  const personalAssets: OwnedAssetSummary[] = directlyOwnedAssets.map((asset) => {
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
        entities.find((e) => e.id === childSub.employeeId || e.entityCode === childSub.employeeId)
          ?.name ||
        employees.find((e) => e.id === childSub.employeeId || e.employeeId === childSub.employeeId)
          ?.name ||
        childSub.employeeId;
    }

    return {
      asset,
      assignedDate: activeAssignment?.assignDate || asset.dateOfIssue || '—',
      assignmentId: activeAssignment?.id || '',
      custodyLevel: activeAssignment?.custodyLevel || 'Primary',
      subAssignedToName: subHolderName,
      subAssignmentId: childSub?.id,
    };
  });

  return {
    isManager,
    managerName,
    managerCode,
    personalAssets,
    personalAssetCount: personalAssets.length,
  };
}

/**
 * Computes assets assigned to employees reporting directly to the logged-in manager,
 * grouped by employee. Strictly hidden when the user is not a manager or has 0 reporting employees.
 */
export function getManagerTeamMemberAssets(params: {
  session: SessionUser | null;
  employees: readonly Employee[];
  entities?: readonly PersonnelEntity[];
  assets: readonly Asset[];
  assignments: readonly Assignment[];
}): ManagerTeamMemberAssetsResult {
  const { session, employees, entities = [], assets, assignments } = params;
  if (!session) {
    return {
      isManager: false,
      shouldShowSection: false,
      reportingEmployeesCount: 0,
      overallTeamAssetCount: 0,
      groups: [],
    };
  }

  const isManager = isEmployeeManagerUser(session, employees, entities);
  if (!isManager) {
    return {
      isManager: false,
      shouldShowSection: false,
      reportingEmployeesCount: 0,
      overallTeamAssetCount: 0,
      groups: [],
    };
  }

  const linkedEmp =
    resolveEmployeeByIdentifier(employees, session.employeeId) ||
    (session.email
      ? employees.find((e) => e.email.toLowerCase() === session.email.toLowerCase())
      : undefined);
  const linkedEnt =
    resolveEntityByIdentifier(entities, session.entityId || session.employeeId) ||
    (session.email
      ? entities.find((e) => e.email.toLowerCase() === session.email.toLowerCase())
      : undefined);

  const managerLookupId = linkedEmp?.id || linkedEnt?.id || session.entityId || session.employeeId;
  const reportingEmployees = getDirectReportsForManager(
    employees,
    managerLookupId,
    linkedEmp?.email || linkedEnt?.email || session.email,
    entities
  );

  if (reportingEmployees.length === 0) {
    return {
      isManager: true,
      shouldShowSection: false,
      reportingEmployeesCount: 0,
      overallTeamAssetCount: 0,
      groups: [],
    };
  }

  const assetById = new Map(assets.map((a) => [a.id, a]));
  const groups: TeamMemberAssetGroup[] = [];

  for (const emp of reportingEmployees) {
    const empKeys = collectHolderCandidateIds(emp);
    const seenAssetIds = new Set<string>();
    const rows: TeamMemberAssetRow[] = [];

    for (const asn of assignments) {
      if (asn.status !== 'Active') continue;
      const asnKeyNorm = normalizeEmployeeId(asn.employeeId);
      const asnKeyUpper = asn.employeeId.trim().toUpperCase();
      if (!empKeys.has(asnKeyNorm) && !empKeys.has(asnKeyUpper)) continue;

      const asset = assetById.get(asn.assetId);
      if (!asset || asset.status === 'Disposed') continue;
      if (seenAssetIds.has(asset.id)) continue;
      seenAssetIds.add(asset.id);

      rows.push({
        employeeRecordId: emp.id,
        employeeName: emp.name,
        employeeId: emp.employeeId || emp.id,
        department: emp.department || '—',
        designation: emp.designation || '—',
        assetId: asset.id,
        assetName: asset.name,
        category: asset.category,
        brand: asset.brand || '—',
        model: asset.model || '—',
        serial: asset.serial,
        status: asset.status,
        condition: asset.condition,
        dateOfIssue: asn.assignDate || asset.dateOfIssue || '—',
        location: asset.location || '—',
      });
    }

    if (rows.length > 0) {
      groups.push({
        employeeRecordId: emp.id,
        employeeName: emp.name,
        employeeId: emp.employeeId || emp.id,
        department: emp.department || '—',
        designation: emp.designation || '—',
        totalAssets: rows.length,
        assets: rows,
      });
    }
  }

  groups.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  const overallTeamAssetCount = groups.reduce((sum, g) => sum + g.totalAssets, 0);

  return {
    isManager: true,
    shouldShowSection: true,
    reportingEmployeesCount: reportingEmployees.length,
    overallTeamAssetCount,
    groups,
  };
}
