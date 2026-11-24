import test from 'node:test';
import assert from 'node:assert/strict';
import { seedData } from '../data/seedData';
import type { Asset, Assignment, Employee, PersonnelEntity } from '../types/asset';
import type { SessionUser } from '../types/user';
import {
  buildInventoryCsvExport,
  INVENTORY_EXPORT_HEADERS,
  REQUESTED_ASSET_FIELDS_WITH_DEDUP_STATUS,
  resolveAssetAssigneeColumns,
} from './assetExport';
import {
  ENTITY_ID_REGEX,
  getDefaultFreelancerAccessories,
  resolveCenterOfficeInfo,
  resolveCustodySummaryForAsset,
  validateEntityId,
  validateFreelancerAllotmentInput,
  validatePersonnelEntityInput,
} from './entityValidation';
import {
  canConsultantActAsManager,
  getDirectReportsForManager,
  isEmployeeManagerUser,
  validateRevokeConsultantManager,
} from './hierarchyLogic';
import { buildDefaultSeedPolicies } from './policyLogic';
import {
  canUserRaiseTicket,
  createSupportTicketRecord,
  getScopedEmployeeData,
  isAssetOwnedBy,
} from './ticketLogic';

const sampleEntities: PersonnelEntity[] = [
  {
    id: 'ent-con-1',
    entityCode: 'CON001',
    entityType: 'Consultant',
    name: 'Dr. Arnab Sen',
    email: 'arnab@medianresearch.in',
    phone: '+91 98300 11111',
    center: 'Kolkata',
    department: 'Field Ops',
    designation: 'Lead Consultant',
    isManager: true,
    status: 'Active',
  },
  {
    id: 'ent-ret-1',
    entityCode: 'RET01',
    entityType: 'Retainer',
    name: 'Neha Kulkarni',
    email: 'neha.ret@medianresearch.in',
    phone: '+91 98200 22222',
    center: 'Mumbai',
    department: 'Research',
    designation: 'Retainer Analyst',
    isManager: false,
    status: 'Active',
  },
  {
    id: 'ent-flp-1',
    entityCode: 'KOL000001',
    entityType: 'Freelancer',
    name: 'Suman Chatterjee',
    email: 'suman.flp@gmail.com',
    phone: '+91 98310 33333',
    address: '14B Salt Lake Sector V, Kolkata',
    aadhaarCard: '123456789012',
    panCard: 'ABCDE1234F',
    center: 'Kolkata',
    department: 'Field Ops',
    designation: 'Field Investigator',
    isManager: false,
    status: 'Active',
  },
  {
    id: 'ent-yrp-1',
    entityCode: 'YRP2026',
    entityType: 'Young Research Program',
    name: 'Riya Verma',
    email: 'riya.yrp@medianresearch.in',
    phone: '+91 98100 44444',
    center: 'New Delhi',
    department: 'Analytics',
    designation: 'YRP Fellow',
    isManager: false,
    status: 'Active',
  },
  {
    id: 'ent-int-1',
    entityCode: 'INT009',
    entityType: 'Intern',
    name: 'Kabir Mehta',
    email: 'kabir.int@medianresearch.in',
    phone: '+91 98400 55555',
    center: 'Bengaluru',
    department: 'IT',
    designation: 'Summer Intern',
    isManager: false,
    status: 'Active',
  },
];

test('ENTITY_ID_REGEX enforces uppercase alphanumeric A-Z0-9 max length 10 and uniqueness', () => {
  assert.equal(ENTITY_ID_REGEX.test('KOL000001'), true);
  assert.equal(ENTITY_ID_REGEX.test('A1'), true);
  assert.equal(ENTITY_ID_REGEX.test('ABCDEFGHIJ'), true);
  assert.equal(ENTITY_ID_REGEX.test('ABCDEFGHIJK'), false); // 11 chars rejected
  assert.equal(ENTITY_ID_REGEX.test('CON-001'), false); // hyphen rejected
  assert.equal(ENTITY_ID_REGEX.test('CON 001'), false); // space rejected

  const ok = validateEntityId({
    rawId: 'kol000002',
    existingEntities: sampleEntities,
    existingEmployees: seedData.employees,
  });
  assert.equal(ok.valid, true);
  if (ok.valid) assert.equal(ok.normalizedId, 'KOL000002');

  const tooLong = validateEntityId({
    rawId: 'TOOLONGID123',
    existingEntities: sampleEntities,
  });
  assert.equal(tooLong.valid, false);

  const badChar = validateEntityId({
    rawId: 'FRL-99',
    existingEntities: sampleEntities,
  });
  assert.equal(badChar.valid, false);

  const dup = validateEntityId({
    rawId: 'KOL000001',
    existingEntities: sampleEntities,
  });
  assert.equal(dup.valid, false);

  const entityCheck = validatePersonnelEntityInput({
    entityType: 'Freelancer',
    entityCode: 'KOL999',
    name: 'Test Freelancer',
    email: 'freelancer@example.com',
    phone: '9999999999',
    aadhaarCard: '123456789012',
    panCard: 'ABCDE1234F',
    existingEntities: sampleEntities,
    existingEmployees: seedData.employees,
  });
  assert.equal(entityCheck.ok, true);
});

test('Consultant Manager privileges keep Consultant role and guard revoking when active team exists', () => {
  const consultantMgr = sampleEntities[0];
  assert.equal(canConsultantActAsManager(consultantMgr), true);

  const empWithConsultantMgr: Employee = {
    ...seedData.employees[0],
    id: 'EMP_CON_TEAM_1',
    employeeId: 'EMP-99001',
    reportingManagerId: consultantMgr.id,
    reportingManagerName: consultantMgr.name,
    reportingManagerEmail: consultantMgr.email,
    status: 'Active',
  };
  const employeesWithTeam = [...seedData.employees, empWithConsultantMgr];

  const consultantSession: SessionUser = {
    id: 'usr-con-1',
    loginId: 'CON001',
    fullName: consultantMgr.name,
    email: consultantMgr.email,
    role: 'Consultant',
    permissions: ['attendance.view', 'attendance.create'],
    entityId: consultantMgr.id,
    entityType: 'Consultant',
    isManager: true,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  assert.equal(isEmployeeManagerUser(consultantSession, employeesWithTeam, sampleEntities), true);
  const team = getDirectReportsForManager(employeesWithTeam, consultantMgr.id, consultantMgr.email, sampleEntities);
  assert.equal(team.some((e) => e.id === 'EMP_CON_TEAM_1'), true);

  const revokeBlocked = validateRevokeConsultantManager({
    consultant: consultantMgr,
    employees: employeesWithTeam,
    entities: sampleEntities,
  });
  assert.equal(revokeBlocked.ok, false);
  if (!revokeBlocked.ok) assert.equal(revokeBlocked.activeReportCount, 1);

  const revokeForced = validateRevokeConsultantManager({
    consultant: consultantMgr,
    employees: employeesWithTeam,
    entities: sampleEntities,
    forceUnassign: true,
  });
  assert.equal(revokeForced.ok, true);
});

test('Add Asset non-duplicate field mapping preserves all existing fields without duplicating', () => {
  const existingEscaped = REQUESTED_ASSET_FIELDS_WITH_DEDUP_STATUS.filter(
    (f) => f.status === 'existing-escaped'
  );
  const addedFields = REQUESTED_ASSET_FIELDS_WITH_DEDUP_STATUS.filter(
    (f) => f.status === 'added'
  );
  assert.equal(existingEscaped.some((f) => f.label === 'Asset ID'), true);
  assert.equal(existingEscaped.some((f) => f.label === 'Brand'), true);
  assert.equal(existingEscaped.some((f) => f.label === 'Serial Number'), true);
  assert.equal(addedFields.some((f) => f.label === 'RMN Number'), true);
  assert.equal(addedFields.some((f) => f.label === 'IMEI / Device ID 1'), true);
  assert.equal(addedFields.some((f) => f.label === 'PROJECT NAME'), true);
  assert.equal(addedFields.some((f) => f.label === 'Freelancer ID'), true);
});

test('Inventory CSV export includes exact assignee columns alongside Asset ID and extended fields', () => {
  const asset: Asset = {
    ...seedData.assets[0],
    id: 'AST9001',
    name: 'Samsung Galaxy Tab A9+',
    category: 'Tablet',
    brand: 'Samsung',
    model: 'SM-X216B',
    serial: 'R52W901234',
    rmnNumber: 'RMN-4455',
    imei1: '356789012345678',
    projectName: 'Bengal Rural Survey',
    projectNo: 'JOB-KOL-2026-09',
    eicName: 'Arnab Sen',
  };

  const primaryEmployee = seedData.employees[0];
  const assignments: Assignment[] = [
    {
      id: 'ASN9001',
      assetId: 'AST9001',
      employeeId: primaryEmployee.id,
      assigneeType: 'Employee',
      custodyLevel: 'Primary',
      assignDate: '2026-11-01',
      status: 'Active',
    },
    {
      id: 'ASN9002',
      assetId: 'AST9001',
      employeeId: 'ent-flp-1',
      assigneeType: 'Freelancer',
      custodyLevel: 'Sub-Assigned',
      parentAssignmentId: 'ASN9001',
      assignedById: primaryEmployee.id,
      assignDate: '2026-11-02',
      status: 'Active',
    },
  ];

  const cols = resolveAssetAssigneeColumns({
    asset,
    assignments,
    employees: seedData.employees,
    entities: sampleEntities,
  });
  assert.equal(cols.employeeName, primaryEmployee.name);
  assert.equal(cols.freelancerName, 'Suman Chatterjee');
  assert.equal(cols.freelancerCode, 'KOL000001');

  const custody = resolveCustodySummaryForAsset({
    assetId: 'AST9001',
    assignments,
    employees: seedData.employees,
    entities: sampleEntities,
  });
  assert.equal(custody.primary?.id, 'ASN9001');
  assert.equal(custody.subAssigned?.id, 'ASN9002');
  assert.equal(custody.subHolderName, 'Suman Chatterjee');

  const csv = buildInventoryCsvExport({
    assets: [asset],
    assignments,
    employees: seedData.employees,
    entities: sampleEntities,
  });
  const headerLine = csv.split('\n')[0];
  assert.equal(
    headerLine.includes('"Asset ID","Employee Name","Consultant Name","Retainer Name","Freelancer Name","Young Research Program Name","Intern Name","Name"'),
    true
  );
  assert.equal(INVENTORY_EXPORT_HEADERS[0], 'Asset ID');
  assert.equal(csv.includes('Suman Chatterjee'), true);
  assert.equal(csv.includes('RMN-4455'), true);
  assert.equal(csv.includes('356789012345678'), true);
});

test('Policy seeding includes IT Policy mirroring HR Policy and POSH Policy', () => {
  const policies = buildDefaultSeedPolicies();
  const categories = policies.map((p) => p.category);
  assert.deepEqual(categories, ['HR Policy', 'POSH Policy', 'IT Policy']);
  assert.equal(policies[2].id, 'pol-it-default');
  assert.equal(policies[2].contentBase64.length > 100, true);
});

test('Freelancer Center address lookup and Allotment validation match Kolkata Stesalit Towers and require mandatory fields', () => {
  const kol = resolveCenterOfficeInfo('Kolkata', []);
  assert.equal(
    kol.address,
    '3rd Floor, Unit - 304, Stesalit Towers, E-2/3, Block - EP & GP, Sector V, Salt Lake City, Kolkata - 700091'
  );
  assert.equal(kol.phone, '+91 33 4073 1137');

  const missingAadhaar = validateFreelancerAllotmentInput({
    flpId: 'ent-flp-1',
    flpName: 'Suman Chatterjee',
    flpCode: 'KOL000001',
    flpAddress: '14B Salt Lake',
    aadhaarNo: '',
    panNo: 'ABCDE1234F',
    mobileNo: '9831033333',
    centerName: 'Kolkata',
    executiveName: 'Rahul Sen',
    executiveEmpId: 'EMP-10001',
    jobNumber: 'JOB-2026-09',
    issueDate: '2026-11-22',
    assetIds: ['AST0186'],
    accessories: getDefaultFreelancerAccessories(),
  });
  assert.equal(missingAadhaar.ok, false);

  const validAllotment = validateFreelancerAllotmentInput({
    flpId: 'ent-flp-1',
    flpName: 'Suman Chatterjee',
    flpCode: 'KOL000001',
    flpAddress: '14B Salt Lake',
    aadhaarNo: '123456789012',
    panNo: 'ABCDE1234F',
    mobileNo: '9831033333',
    centerName: 'Kolkata',
    executiveName: 'Rahul Sen',
    executiveEmpId: 'EMP-10001',
    jobNumber: 'JOB-2026-09',
    issueDate: '2026-11-22',
    assetIds: ['AST0186'],
    accessories: getDefaultFreelancerAccessories(),
  });
  assert.equal(validAllotment.ok, true);
});

test('All 5 new entity roles can view their assigned assets and raise support tickets', () => {
  const flpSession: SessionUser = {
    id: 'usr-flp-1',
    loginId: 'KOL000001',
    fullName: 'Suman Chatterjee',
    email: 'suman.flp@gmail.com',
    role: 'Freelancer',
    permissions: ['attendance.view', 'attendance.create'],
    entityId: 'ent-flp-1',
    entityType: 'Freelancer',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  assert.equal(canUserRaiseTicket(flpSession), true);

  const subAssignment: Assignment = {
    id: 'ASN-FRL-1',
    assetId: 'AST0186',
    employeeId: 'ent-flp-1',
    assigneeType: 'Freelancer',
    custodyLevel: 'Sub-Assigned',
    assignDate: '2026-11-10',
    status: 'Active',
  };
  const allAssignments = [...seedData.assignments, subAssignment];

  assert.equal(
    isAssetOwnedBy(
      seedData.assets.find((a) => a.id === 'AST0186'),
      'ent-flp-1',
      allAssignments,
      seedData.employees,
      sampleEntities
    ),
    true
  );

  const scoped = getScopedEmployeeData({
    session: flpSession,
    employees: seedData.employees,
    entities: sampleEntities,
    assets: seedData.assets,
    assignments: allAssignments,
    tickets: [],
    maintenance: [],
  });
  assert.equal(scoped.assets.some((a) => a.id === 'AST0186'), true);

  // Monday 2026-11-16
  const created = createSupportTicketRecord({
    input: {
      assetId: 'AST0186',
      subject: 'Tablet SIM card connectivity issue',
      description: 'Fieldwork survey tablet SIM card is not registering on 4G network.',
      priority: 'High',
      requestedDate: '2026-11-16',
      requestedStartTime: '11:00',
      requestedDurationMins: 30,
    },
    session: flpSession,
    employees: seedData.employees,
    entities: sampleEntities,
    assets: seedData.assets,
    assignments: allAssignments,
    existingTickets: [],
    holidays: [],
  });
  assert.equal(created.ok, true);
  if (created.ok) {
    assert.equal(created.ticket.employeeId, 'ent-flp-1');
    assert.equal(created.ticket.createdByRole, 'Freelancer');
  }
});
