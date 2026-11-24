import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEmployeeImportPlan,
  generateEmployeeImportTemplateCsv,
  parseCsvRows,
} from './employeeImport.ts';

test('parseCsvRows parses BOM, CRLF, quoted commas, and escaped quotes per RFC-4180', () => {
  const csv = [
    '\uFEFF"ID","Name","Email","Department","Designation","Center"',
    'EMP010,"Rahman, Ayesha",ayesha@company.com,IT,"Lead ""Cloud"" Architect",Dhaka HQ',
  ].join('\r\n');

  const rows = parseCsvRows(csv);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], ['ID', 'Name', 'Email', 'Department', 'Designation', 'Center']);
  assert.deepEqual(rows[1], [
    'EMP010',
    'Rahman, Ayesha',
    'ayesha@company.com',
    'IT',
    'Lead "Cloud" Architect',
    'Dhaka HQ',
  ]);
});

test('buildEmployeeImportPlan supports exported 10-column employee CSVs and skips duplicates by default', () => {
  const exportedStyleCsv = [
    'ID,Name,Email,Department,Designation,Center,Reporting Manager,Manager Email,Mobile,Status',
    'EMP001,Md. Rahim Uddin,rahim@company.com,IT,Software Engineer,Dhaka HQ,Tariq,tariq@company.com,01700000001,Active',
    'EMP055,Farhana Akter,farhana@company.com,HR,HR Specialist,Sylhet,Nusrat,nusrat@company.com,01800000002,Active',
  ].join('\n');

  const plan = buildEmployeeImportPlan({
    csvText: exportedStyleCsv,
    existingEmployees: [
      { id: 'EMP001', employeeId: 'EMP001', email: 'rahim@company.com' },
      { id: 'EMP005', employeeId: 'EMP005', email: 'karim@company.com' },
    ],
    duplicatePolicy: 'skip',
  });

  assert.equal(plan.totalRows, 2);
  assert.equal(plan.validRows.length, 1);
  assert.equal(plan.validRows[0].employeeId, 'EMP055');
  assert.equal(plan.validRows[0].name, 'Farhana Akter');
  assert.equal(plan.errors.length, 1);
  assert.match(plan.errors[0].reason, /already exists/i);
});

test('buildEmployeeImportPlan auto-generates global non-colliding IDs when ID column is omitted and flags bad rows', () => {
  const csv = [
    'Name,Email,Department,Designation,Mobile,Branch',
    'Tanvir Ahmed,tanvir@company.com,Finance,Analyst,01911223344,Chittagong',
    ',missingname@company.com,IT,Dev,01700000000,Dhaka HQ',
    'Bad Email,not-an-email,IT,Dev,01700000000,Dhaka HQ',
    'Zarin Tasnim,zarin@company.com,IT,QA Engineer,01611223344,Dhaka HQ',
  ].join('\n');

  const plan = buildEmployeeImportPlan({
    csvText: csv,
    existingEmployees: [
      { id: 'EMP001', employeeId: 'EMP001', email: 'rahim@company.com' },
      { id: 'EMP012', employeeId: 'EMP012', email: 'other@company.com' },
    ],
  });

  assert.equal(plan.totalRows, 4);
  assert.equal(plan.validRows.length, 2);
  assert.equal(plan.validRows[0].employeeId, 'EMP013');
  assert.equal(plan.validRows[1].employeeId, 'EMP014');
  assert.equal(plan.errors.length, 2);
  assert.match(plan.errors[0].reason, /Name is required/i);
  assert.match(plan.errors[1].reason, /Valid Email is required/i);
});

test('generateEmployeeImportTemplateCsv produces a valid round-trip template', () => {
  const template = generateEmployeeImportTemplateCsv();
  const plan = buildEmployeeImportPlan({
    csvText: template,
    existingEmployees: [],
  });
  assert.equal(plan.errors.length, 0);
  assert.equal(plan.validRows.length, 2);
  assert.equal(plan.validRows[0].employeeId, 'EMP101');
  assert.equal(plan.validRows[1].employeeId, 'EMP102');
});
