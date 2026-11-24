import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_INDIAN_CENTER,
  INDIAN_CENTERS,
  LEGACY_CENTER_NAMES,
  filterCenters,
  normalizeCenterName,
} from '../data/indianCenters';
import {
  canManagePolicies,
  canModifyManagerFields,
  canUserApproveLeave,
  getDirectReportsForManager,
  isEmployeeManagerUser,
  validateManagerMapping,
} from './hierarchyLogic';
import {
  buildDefaultSeedPolicies,
  buildPolicyPdfBytes,
  bumpPolicyVersion,
  formatFileSize,
  isValidPdfBase64,
  isValidPdfBytes,
} from './policyLogic';
import type { Employee } from '../types/asset';

const SAMPLE_EMPLOYEES: Employee[] = [
  {
    id: 'EMP001',
    employeeId: 'EMP001',
    name: 'Aarav Sharma',
    phone: '9876543210',
    email: 'aarav@medianresearch.com',
    department: 'Engineering',
    designation: 'Engineering Manager',
    center: 'Mumbai',
    branch: 'Mumbai',
    isManager: true,
    reportingManagerId: '',
    reportingManagerName: '',
    reportingManagerEmail: '',
    joiningDate: '2024-01-10',
    address: 'Mumbai',
    remarks: '',
    status: 'Active',
  },
  {
    id: 'EMP002',
    employeeId: 'EMP002',
    name: 'Priya Nair',
    phone: '9876543211',
    email: 'priya@medianresearch.com',
    department: 'Engineering',
    designation: 'Software Engineer',
    center: 'Bengaluru',
    branch: 'Bengaluru',
    isManager: false,
    reportingManagerId: 'EMP001',
    reportingManagerName: 'Aarav Sharma',
    reportingManagerEmail: 'aarav@medianresearch.com',
    joiningDate: '2024-05-12',
    address: 'Bengaluru',
    remarks: '',
    status: 'Active',
  },
  {
    id: 'EMP003',
    employeeId: 'EMP003',
    name: 'Rohan Verma',
    phone: '9876543212',
    email: 'rohan@medianresearch.com',
    department: 'Operations',
    designation: 'Team Lead',
    center: 'New Delhi',
    branch: 'New Delhi',
    isManager: true,
    reportingManagerId: 'EMP001',
    reportingManagerName: 'Aarav Sharma',
    reportingManagerEmail: 'aarav@medianresearch.com',
    joiningDate: '2024-02-20',
    address: 'New Delhi',
    remarks: '',
    status: 'Active',
  },
  {
    id: 'EMP004',
    employeeId: 'EMP004',
    name: 'Neha Kulkarni',
    phone: '9876543213',
    email: 'neha@medianresearch.com',
    department: 'Operations',
    designation: 'Analyst',
    center: 'Pune',
    branch: 'Pune',
    isManager: false,
    reportingManagerId: 'EMP003',
    reportingManagerName: 'Rohan Verma',
    reportingManagerEmail: 'rohan@medianresearch.com',
    joiningDate: '2025-01-05',
    address: 'Pune',
    remarks: '',
    status: 'Active',
  },
];

test('indianCenters excludes legacy centers and supports search filtering', () => {
  assert.equal(DEFAULT_INDIAN_CENTER, 'Mumbai');
  assert.ok(INDIAN_CENTERS.length > 100);
  for (const legacy of LEGACY_CENTER_NAMES) {
    assert.equal(
      INDIAN_CENTERS.some((c) => c.name.toLowerCase() === legacy.toLowerCase()),
      false
    );
  }
  assert.equal(normalizeCenterName('Dhaka HQ'), 'Mumbai');
  assert.equal(normalizeCenterName('Sylhet'), 'Bengaluru');
  assert.equal(normalizeCenterName('Chittagong'), 'Chennai');
  assert.equal(normalizeCenterName(''), 'Mumbai');

  const maharashtra = filterCenters(INDIAN_CENTERS, 'Maharashtra');
  assert.ok(maharashtra.some((c) => c.name === 'Mumbai'));
  assert.ok(maharashtra.some((c) => c.name === 'Pune'));
});

test('manager mapping enforces Admin privilege, Is Manager flag, and acyclic hierarchy', () => {
  assert.equal(canModifyManagerFields({ role: 'Super Admin' }), true);
  assert.equal(canModifyManagerFields({ role: 'Employee' }), false);
  assert.equal(canManagePolicies({ role: 'Administrator' }), true);
  assert.equal(canManagePolicies({ role: 'Employee' }), false);

  // Valid mapping to active manager
  const okRes = validateManagerMapping({
    employees: SAMPLE_EMPLOYEES,
    employeeId: 'EMP004',
    reportingManagerId: 'EMP001',
  });
  assert.equal(okRes.ok, true);

  // Reject self-reporting
  const selfRes = validateManagerMapping({
    employees: SAMPLE_EMPLOYEES,
    employeeId: 'EMP001',
    reportingManagerId: 'EMP001',
  });
  assert.equal(selfRes.ok, false);

  // Reject mapping to non-manager employee
  const nonMgrRes = validateManagerMapping({
    employees: SAMPLE_EMPLOYEES,
    employeeId: 'EMP004',
    reportingManagerId: 'EMP002',
  });
  assert.equal(nonMgrRes.ok, false);

  // Reject circular hierarchy (EMP001 -> EMP003 -> EMP001)
  const circularRes = validateManagerMapping({
    employees: SAMPLE_EMPLOYEES,
    employeeId: 'EMP001',
    reportingManagerId: 'EMP003',
  });
  assert.equal(circularRes.ok, false);

  // Direct reports resolution (1 Manager -> N Employees)
  const aaravReports = getDirectReportsForManager(SAMPLE_EMPLOYEES, 'EMP001');
  assert.deepEqual(
    aaravReports.map((e) => e.id).sort(),
    ['EMP002', 'EMP003']
  );

  assert.equal(
    isEmployeeManagerUser(
      { role: 'Employee', employeeId: 'EMP001', email: 'aarav@medianresearch.com', isManager: false },
      SAMPLE_EMPLOYEES
    ),
    true
  );
  assert.equal(
    isEmployeeManagerUser(
      { role: 'Employee', employeeId: 'EMP002', email: 'priya@medianresearch.com', isManager: false },
      SAMPLE_EMPLOYEES
    ),
    false
  );
});

test('leave approval routing allows mapped Reporting Manager and Admin override only', () => {
  const pendingLeave = {
    employeeId: 'EMP004',
    managerId: 'EMP003',
    department: 'Operations',
    status: 'Pending' as const,
  };

  // Mapped manager (EMP003) can approve Pending leave
  const mgrCheck = canUserApproveLeave({
    user: {
      role: 'Employee',
      employeeId: 'EMP003',
      email: 'rohan@medianresearch.com',
      isManager: true,
      permissions: ['attendance.view', 'attendance.create'],
    },
    leave: pendingLeave,
    targetEmployee: SAMPLE_EMPLOYEES[3],
    employees: SAMPLE_EMPLOYEES,
  });
  assert.equal(mgrCheck.allowed, true);
  assert.equal(mgrCheck.isOverride, false);

  // Unmapped manager (EMP001) cannot approve EMP004's leave directly
  const otherMgrCheck = canUserApproveLeave({
    user: {
      role: 'Employee',
      employeeId: 'EMP001',
      email: 'aarav@medianresearch.com',
      isManager: true,
      permissions: ['attendance.view', 'attendance.create'],
    },
    leave: pendingLeave,
    targetEmployee: SAMPLE_EMPLOYEES[3],
    employees: SAMPLE_EMPLOYEES,
  });
  assert.equal(otherMgrCheck.allowed, false);

  // Manager cannot override already decided leave; Admin CAN override
  const decidedLeave = { ...pendingLeave, status: 'Approved' as const };
  const mgrOverrideCheck = canUserApproveLeave({
    user: {
      role: 'Employee',
      employeeId: 'EMP003',
      email: 'rohan@medianresearch.com',
      isManager: true,
      permissions: ['attendance.view', 'attendance.create'],
    },
    leave: decidedLeave,
    targetEmployee: SAMPLE_EMPLOYEES[3],
    employees: SAMPLE_EMPLOYEES,
  });
  assert.equal(mgrOverrideCheck.allowed, false);

  const adminOverrideCheck = canUserApproveLeave({
    user: { role: 'Super Admin', email: 'admin@medianresearch.com', permissions: [] },
    leave: decidedLeave,
    targetEmployee: SAMPLE_EMPLOYEES[3],
    employees: SAMPLE_EMPLOYEES,
  });
  assert.equal(adminOverrideCheck.allowed, true);
  assert.equal(adminOverrideCheck.isOverride, true);
});

test('policyLogic generates valid default HR, POSH & IT PDFs and handles versioning', () => {
  const defaults = buildDefaultSeedPolicies();
  assert.equal(defaults.length, 3);
  assert.deepEqual(
    defaults.map((d) => d.category),
    ['HR Policy', 'POSH Policy', 'IT Policy']
  );
  for (const pol of defaults) {
    assert.equal(isValidPdfBase64(pol.contentBase64), true);
  }

  const customBytes = buildPolicyPdfBytes({
    title: 'Leave Policy',
    category: 'Leave Policy',
    version: '1.0',
    effectiveDate: '2026-01-01',
    sections: [{ heading: '1. Leave', lines: ['Standard leave rules.'] }],
  });
  assert.equal(isValidPdfBytes(customBytes), true);
  assert.equal(bumpPolicyVersion('1.0', 'minor'), '1.1');
  assert.equal(bumpPolicyVersion('1.4', 'major'), '2.0');
  assert.equal(formatFileSize(2048), '2.0 KB');
});
