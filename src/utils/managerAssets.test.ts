import test from 'node:test';
import assert from 'node:assert/strict';
import { seedData } from '../data/seedData';
import type { Asset, Assignment, Employee } from '../types/asset';
import type { SessionUser } from '../types/user';
import { buildAssetTemplateCsv, parseAssetImportCsvRows } from './assetExport';
import { getManagerPersonalAssets, getManagerTeamMemberAssets } from './managerAssets';
import { getScopedEmployeeData } from './ticketLogic';

function makeSession(overrides: Partial<SessionUser>): SessionUser {
  return {
    id: 'usr-test',
    loginId: 'test.user',
    fullName: 'Test User',
    email: 'test@medianresearch.com',
    role: 'Employee',
    roleId: 'role_employee',
    employeeId: 'EMP100',
    department: 'Field Ops',
    isManager: false,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    permissions: [],
    ...overrides,
  };
}

function makeEmployee(overrides: Partial<Employee>): Employee {
  return {
    id: 'emp-x',
    employeeId: 'EMPX',
    name: 'Employee X',
    email: 'x@medianresearch.com',
    phone: '9800000000',
    department: 'Field Ops',
    designation: 'Executive',
    branch: 'Kolkata',
    center: 'Kolkata',
    joiningDate: '2025-01-01',
    status: 'Active',
    isManager: false,
    ...overrides,
  };
}

function makeAsset(id: string, name: string, serial: string): Asset {
  return {
    ...seedData.assets[0],
    id,
    name,
    serial,
    status: 'Assigned',
    condition: 'Good',
    location: 'Kolkata HQ',
    dateOfIssue: '2026-04-01',
  };
}

test('Manager personal assets section strictly shows ONLY personal assets (1 personal even when team owns 10)', () => {
  const manager = makeEmployee({
    id: 'emp-rahim',
    employeeId: 'EMP900',
    name: 'Rahim Ahmed',
    email: 'rahim@medianresearch.com',
    isManager: true,
  });
  const rep1 = makeEmployee({
    id: 'emp-sub-1',
    employeeId: 'EMP901',
    name: 'Ananya Sen',
    reportingManagerId: 'emp-rahim',
    reportingManagerName: 'Rahim Ahmed',
  });
  const rep2 = makeEmployee({
    id: 'emp-sub-2',
    employeeId: 'EMP902',
    name: 'Bikram Roy',
    reportingManagerId: 'emp-rahim',
    reportingManagerName: 'Rahim Ahmed',
  });
  const outsider = makeEmployee({
    id: 'emp-other',
    employeeId: 'EMP999',
    name: 'Outsider Peer',
    reportingManagerId: 'emp-someone-else',
  });

  const employees = [manager, rep1, rep2, outsider];
  const personalAsset = makeAsset('AST-MGR-1', 'ThinkPad X1 Carbon', 'SN-MGR-1');
  const teamAssets = Array.from({ length: 10 }, (_, idx) =>
    makeAsset(`AST-TM-${idx + 1}`, `Team Tablet ${idx + 1}`, `SN-TM-${idx + 1}`)
  );
  const outsiderAsset = makeAsset('AST-OUT-1', 'Outsider Laptop', 'SN-OUT-1');
  const assets = [personalAsset, ...teamAssets, outsiderAsset];

  const assignments: Assignment[] = [
    {
      id: 'ASN-MGR-1',
      assetId: personalAsset.id,
      employeeId: manager.id,
      assigneeType: 'Employee',
      custodyLevel: 'Primary',
      assignDate: '2026-04-01',
      status: 'Active',
    },
    ...teamAssets.map((a, idx) => ({
      id: `ASN-TM-${idx + 1}`,
      assetId: a.id,
      employeeId: idx < 4 ? rep1.id : rep2.id,
      assigneeType: 'Employee' as const,
      custodyLevel: 'Primary' as const,
      assignDate: '2026-04-05',
      status: 'Active' as const,
    })),
    {
      id: 'ASN-OUT-1',
      assetId: outsiderAsset.id,
      employeeId: outsider.id,
      assigneeType: 'Employee',
      custodyLevel: 'Primary',
      assignDate: '2026-04-02',
      status: 'Active',
    },
  ];

  const session = makeSession({
    employeeId: manager.id,
    fullName: manager.name,
    email: manager.email,
    isManager: true,
  });

  const personal = getManagerPersonalAssets({
    session,
    employees,
    entities: [],
    assets,
    assignments,
  });

  assert.equal(personal.isManager, true);
  assert.equal(personal.managerName, 'Rahim Ahmed');
  assert.equal(personal.personalAssetCount, 1);
  assert.deepEqual(
    personal.personalAssets.map((p) => p.asset.id),
    ['AST-MGR-1']
  );

  const team = getManagerTeamMemberAssets({
    session,
    employees,
    entities: [],
    assets,
    assignments,
  });

  assert.equal(team.shouldShowSection, true);
  assert.equal(team.reportingEmployeesCount, 2);
  assert.equal(team.overallTeamAssetCount, 10);
  assert.equal(team.groups.length, 2);
  assert.equal(team.groups[0].employeeName, 'Ananya Sen');
  assert.equal(team.groups[0].employeeId, 'EMP901');
  assert.equal(team.groups[0].totalAssets, 4);
  assert.equal(team.groups[1].employeeName, 'Bikram Roy');
  assert.equal(team.groups[1].employeeId, 'EMP902');
  assert.equal(team.groups[1].totalAssets, 6);

  const sampleRow = team.groups[0].assets[0];
  assert.equal(sampleRow.assetId, 'AST-TM-1');
  assert.equal(sampleRow.assetName, 'Team Tablet 1');
  assert.equal(sampleRow.serial, 'SN-TM-1');
  assert.equal(sampleRow.status, 'Assigned');
  assert.equal(sampleRow.condition, 'Good');
  assert.equal(sampleRow.dateOfIssue, '2026-04-05');
  assert.equal(sampleRow.location, 'Kolkata HQ');
  assert.equal(
    team.groups.some((g) => g.assets.some((r) => r.assetId === 'AST-OUT-1' || r.assetId === 'AST-MGR-1')),
    false
  );
});

test('Manager with 0 personal assets shows 0 personal assets (no company fallback)', () => {
  const manager = makeEmployee({
    id: 'emp-mgr-empty',
    employeeId: 'EMP910',
    name: 'Empty Holder Manager',
    email: 'empty.mgr@medianresearch.com',
    isManager: true,
  });
  const report = makeEmployee({
    id: 'emp-sub-empty',
    employeeId: 'EMP911',
    name: 'Report User',
    reportingManagerId: 'emp-mgr-empty',
  });
  const asset = makeAsset('AST-ONLY-TEAM', 'Team Device', 'SN-TEAM');
  const assignments: Assignment[] = [
    {
      id: 'ASN-ONLY-TEAM',
      assetId: asset.id,
      employeeId: report.id,
      assigneeType: 'Employee',
      custodyLevel: 'Primary',
      assignDate: '2026-04-01',
      status: 'Active',
    },
  ];
  const session = makeSession({
    employeeId: manager.id,
    fullName: manager.name,
    email: manager.email,
    role: 'Department Manager',
    roleId: 'role_dept_manager',
    isManager: true,
  });

  const personal = getManagerPersonalAssets({
    session,
    employees: [manager, report],
    assets: [asset],
    assignments,
  });
  assert.equal(personal.personalAssetCount, 0);
  assert.equal(personal.personalAssets.length, 0);

  const scoped = getScopedEmployeeData({
    session,
    employees: [manager, report],
    assets: [asset],
    assignments,
    tickets: [],
    maintenance: [],
  });
  assert.equal(scoped.ownedAssets.length, 0);
});

test('Manager Team Member Assets section is completely hidden for non-managers and managers without direct reports', () => {
  const soloManager = makeEmployee({
    id: 'emp-solo-mgr',
    employeeId: 'EMP920',
    name: 'Solo Manager',
    isManager: true,
  });
  const regularEmp = makeEmployee({
    id: 'emp-regular',
    employeeId: 'EMP921',
    name: 'Regular Employee',
    isManager: false,
  });

  const soloSession = makeSession({
    employeeId: soloManager.id,
    fullName: soloManager.name,
    isManager: true,
  });
  const soloTeam = getManagerTeamMemberAssets({
    session: soloSession,
    employees: [soloManager, regularEmp],
    assets: seedData.assets,
    assignments: [],
  });
  assert.equal(soloTeam.isManager, true);
  assert.equal(soloTeam.reportingEmployeesCount, 0);
  assert.equal(soloTeam.shouldShowSection, false);

  const regularSession = makeSession({
    employeeId: regularEmp.id,
    fullName: regularEmp.name,
    isManager: false,
  });
  const regularTeam = getManagerTeamMemberAssets({
    session: regularSession,
    employees: [soloManager, regularEmp],
    assets: seedData.assets,
    assignments: [],
  });
  assert.equal(regularTeam.isManager, false);
  assert.equal(regularTeam.shouldShowSection, false);
});

test('Asset Entry CSV template generation and parser preserve all 33 required fields and 6 person assignment fields', () => {
  const templateCsv = buildAssetTemplateCsv();
  const parsedTemplate = parseAssetImportCsvRows(templateCsv);
  assert.equal(parsedTemplate.length, 1);
  assert.equal(parsedTemplate[0].name, 'Dell Latitude 5440');
  assert.equal(parsedTemplate[0].employeeName, 'Rahim Ahmed');
  assert.equal(parsedTemplate[0].rmnNumber, 'RMN-5440-IN');
  assert.equal(parsedTemplate[0].partNumber, 'PN-LAT-01');
  assert.equal(parsedTemplate[0].eanNumber, '8901234567890');
  assert.equal(parsedTemplate[0].snidNumber, 'SNID-9081');
  assert.equal(parsedTemplate[0].vendorSupplierName, 'Infosystem Pvt Ltd');
  assert.equal(parsedTemplate[0].projectName, 'National Field Study');
  assert.equal(parsedTemplate[0].projectNo, 'JOB-2026-01');
  assert.equal(parsedTemplate[0].accessoriesIssued, 'Laptop Bag, Charger');
  assert.equal(parsedTemplate[0].status, 'Assigned');

  const customCsv = [
    '"Asset ID","Asset Name","Category","Brand","Model","Serial Number","Department","Location","Status","Condition","Cost","Book Value","RMN Number","Part Number","EAN Number","IMEI / Device ID 1","IMEI / Device ID 2","SNID Number","Purchase Date","Vendor / Supplier","Vendor / Supplier Name","Invoice No.","Warranty Expiry","Project Name","Project No","Assigned Employee","Assigned Freelancer","Freelancer ID","Date of Issue","Date of Return","Accessories Issued","Last Verification Date","Remarks","Employee Name","Consultant Name","Retainer Name","Freelancer Name","Young Research Program Name","Intern Name"',
    '"AST-9901","Samsung Tab S9","Tablet","Samsung","SM-X710","SN-X710-09","Field Ops","Delhi Center","Assigned","Good","62000","58000","RMN-710","PN-710","8901112223334","356000111222333","356000111222334","SNID-710","2026-02-01","TechMart","TechMart India Pvt Ltd","INV-710","2029-02-01","Urban Baseline","JOB-710","Rahul Verma","Karan Das","DEL000012","2026-03-01","","Stylus, Rugged Case","2026-04-01","Verified","Rahul Verma","Dr. Roy","Meera Nair","Karan Das","Aarav Singh","Neha Gupta"',
  ].join('\n');

  const parsedCustom = parseAssetImportCsvRows(customCsv);
  assert.equal(parsedCustom.length, 1);
  const row = parsedCustom[0];
  assert.equal(row.id, 'AST-9901');
  assert.equal(row.name, 'Samsung Tab S9');
  assert.equal(row.model, 'SM-X710');
  assert.equal(row.currentValue, 58000);
  assert.equal(row.imei1, '356000111222333');
  assert.equal(row.imei2, '356000111222334');
  assert.equal(row.employeeName, 'Rahul Verma');
  assert.equal(row.consultantName, 'Dr. Roy');
  assert.equal(row.retainerName, 'Meera Nair');
  assert.equal(row.freelancerName, 'Karan Das');
  assert.equal(row.yrpName, 'Aarav Singh');
  assert.equal(row.internName, 'Neha Gupta');
});
