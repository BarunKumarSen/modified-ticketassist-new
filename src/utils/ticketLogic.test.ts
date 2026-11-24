import test from 'node:test';
import assert from 'node:assert/strict';
import { seedData, SEED_ADMIN_USER } from '../data/seedData';
import { toSessionUser } from '../auth/authLogic';
import type { SessionUser, SystemUser } from '../types/user';
import {
  cancelOwnOpenTicket,
  computeTicketStatusSummary,
  computeWorkOrderEndTime,
  confirmWorkOrderByEmployee,
  createSupportTicketRecord,
  filterTickets,
  formatTicketTimestamp,
  getAssignedAssetsForEmployee,
  getScopedEmployeeData,
  getTicketsForEmployee,
  hasAdminSlotOverlap,
  isAssetAssignedToEmployee,
  isAssetOwnedBy,
  reorderTicketQueueList,
  resolveEffectiveTicketStatus,
  sortTicketsFcfs,
  transitionTicketStatus,
  validateTicketInput,
} from './ticketLogic';
import type { SupportTicket } from '../types/ticket';
import type { PublicHoliday } from '../types/attendance';

function makeEmployeeSession(employeeId?: string, loginId = 'rahim'): SessionUser {
  const user: SystemUser = {
    id: `usr-${loginId}`,
    loginId,
    password: 'User@1234',
    fullName: loginId === 'karim' ? 'Karim Uddin' : 'Rahim Ahmed',
    email: `${loginId}@example.com`,
    role: 'Employee',
    employeeId,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  return toSessionUser(user);
}

test('isAssetOwnedBy centralizes asset ownership checks for active non-disposed assignments', () => {
  const ast186 = seedData.assets.find((a) => a.id === 'AST0186')!; // assigned to EMP001
  const ast197 = seedData.assets.find((a) => a.id === 'AST0197')!; // assigned to EMP002
  const ast189 = seedData.assets.find((a) => a.id === 'AST0189')!; // returned by EMP012

  assert.equal(isAssetOwnedBy(ast186, 'EMP001', seedData.assignments, seedData.employees), true);
  assert.equal(isAssetOwnedBy(ast186, 'emp-1001', seedData.assignments, seedData.employees), true);
  // Employee A cannot own Employee B's asset
  assert.equal(isAssetOwnedBy(ast197, 'EMP001', seedData.assignments, seedData.employees), false);
  // Returned assignment is not owned
  assert.equal(isAssetOwnedBy(ast189, 'EMP012', seedData.assignments, seedData.employees), false);
  // Disposed asset is never owned
  assert.equal(
    isAssetOwnedBy(
      { id: ast186.id, status: 'Disposed' },
      'EMP001',
      seedData.assignments,
      seedData.employees
    ),
    false
  );
});

test('getScopedEmployeeData isolates Employee A from Employee B assets, maintenance, and tickets', () => {
  const empASession = makeEmployeeSession('EMP001', 'rahim');
  const empBSession = makeEmployeeSession('EMP002', 'karim');

  const tickets: SupportTicket[] = [
    {
      id: 'tkt-a-1',
      employeeId: 'EMP001',
      assetId: 'AST0186',
      subject: 'Issue for A',
      description: 'Detailed description for employee A asset.',
      priority: 'High',
      status: 'Open',
      createdAt: '2026-11-10T10:00:00.000Z',
      approvalStatus: 'Pending',
    },
    {
      id: 'tkt-b-1',
      employeeId: 'EMP002',
      assetId: 'AST0197',
      subject: 'Issue for B',
      description: 'Detailed description for employee B asset.',
      priority: 'Low',
      status: 'Open',
      createdAt: '2026-11-10T11:00:00.000Z',
      approvalStatus: 'Pending',
    },
  ];

  const scopedA = getScopedEmployeeData({
    session: empASession,
    employees: seedData.employees,
    assets: seedData.assets,
    assignments: seedData.assignments,
    tickets,
    maintenance: seedData.maintenance,
  });

  assert.equal(scopedA.employee?.id, 'EMP001');
  assert.deepEqual(
    scopedA.assets.map((a) => a.id),
    ['AST0186']
  );
  assert.deepEqual(
    scopedA.tickets.map((t) => t.id),
    ['tkt-a-1']
  );
  assert.equal(scopedA.openTicketsCount, 1);
  // None of Employee B's assets appear in A's scoped data
  assert.equal(
    scopedA.assets.some((a) => a.id === 'AST0197' || a.id === 'AST0200'),
    false
  );

  const scopedB = getScopedEmployeeData({
    session: empBSession,
    employees: seedData.employees,
    assets: seedData.assets,
    assignments: seedData.assignments,
    tickets,
    maintenance: seedData.maintenance,
  });
  assert.deepEqual(
    scopedB.assets.map((a) => a.id).sort(),
    ['AST0197', 'AST0200']
  );
  assert.deepEqual(
    scopedB.tickets.map((t) => t.id),
    ['tkt-b-1']
  );
});

test('getAssignedAssetsForEmployee and isAssetAssignedToEmployee filter strictly to logged-in employee', () => {
  const emp1Session = makeEmployeeSession('EMP001');
  const emp12Assets = getAssignedAssetsForEmployee(
    makeEmployeeSession('EMP012'),
    seedData.employees,
    seedData.assets,
    seedData.assignments
  );
  assert.deepEqual(
    emp12Assets.map((a) => a.id),
    ['AST0185']
  );

  assert.equal(
    isAssetAssignedToEmployee(
      'AST0186',
      emp1Session,
      seedData.employees,
      seedData.assets,
      seedData.assignments
    ),
    true
  );
  assert.equal(
    isAssetAssignedToEmployee(
      'AST0185',
      emp1Session,
      seedData.employees,
      seedData.assets,
      seedData.assignments
    ),
    false
  );
  assert.deepEqual(
    getAssignedAssetsForEmployee(
      toSessionUser(SEED_ADMIN_USER),
      seedData.employees,
      seedData.assets,
      seedData.assignments
    ),
    []
  );
});

test('validateTicketInput enforces asset ownership, priority, subject (5-100), and description (10-1000)', () => {
  const session = makeEmployeeSession('EMP001');
  const assigned = getAssignedAssetsForEmployee(
    session,
    seedData.employees,
    seedData.assets,
    seedData.assignments
  );

  // Missing asset & missing priority
  const missingFields = validateTicketInput(
    {
      assetId: '',
      priority: '',
      subject: 'Hi',
      description: 'Short',
    },
    assigned,
    session
  );
  assert.equal(missingFields.valid, false);
  assert.ok(missingFields.errors.assetId);
  assert.ok(missingFields.errors.priority);
  assert.ok(missingFields.errors.subject);
  assert.ok(missingFields.errors.description);

  // Employee A attempting to ticket Employee B's asset
  const otherEmployeeAsset = validateTicketInput(
    {
      assetId: 'AST0197',
      priority: 'High',
      subject: 'Keyboard issue',
      description: 'Several keys on the keyboard stopped working completely.',
    },
    assigned,
    session
  );
  assert.equal(otherEmployeeAsset.valid, false);
  assert.ok(otherEmployeeAsset.errors.assetId);

  // Subject > 100 chars rejected
  const longSubject = validateTicketInput(
    {
      assetId: 'AST0186',
      priority: 'Medium',
      subject: 'A'.repeat(101),
      description: 'Valid detailed description over ten chars.',
    },
    assigned,
    session
  );
  assert.equal(longSubject.valid, false);
  assert.ok(longSubject.errors.subject);

  // Valid input passes
  const validResult = validateTicketInput(
    {
      assetId: 'AST0186',
      priority: 'High',
      subject: 'Battery drains rapidly',
      description: 'MacBook Pro battery drops from 100% to 10% in 20 minutes.',
    },
    assigned,
    session
  );
  assert.equal(validResult.valid, true);
  assert.deepEqual(validResult.errors, {});
});

test('createSupportTicketRecord enforces role, ownership, UUID id, and writes employeeId from session', () => {
  const empSession = makeEmployeeSession('EMP001');
  const adminSession = toSessionUser(SEED_ADMIN_USER);

  // Non-employee blocked
  const adminAttempt = createSupportTicketRecord({
    input: {
      assetId: 'AST0186',
      priority: 'Low',
      subject: 'Admin test ticket',
      description: 'Testing whether non-employee is blocked.',
    },
    session: adminSession,
    employees: seedData.employees,
    assets: seedData.assets,
    assignments: seedData.assignments,
  });
  assert.equal(adminAttempt.ok, false);

  // Employee A cannot raise ticket on Employee B's asset AST0197
  const crossOwnerAttempt = createSupportTicketRecord({
    input: {
      assetId: 'AST0197',
      priority: 'High',
      subject: 'Other employee asset',
      description: 'Attempt to submit ticket against another employee asset.',
    },
    session: empSession,
    employees: seedData.employees,
    assets: seedData.assets,
    assignments: seedData.assignments,
  });
  assert.equal(crossOwnerAttempt.ok, false);
  if (!crossOwnerAttempt.ok) {
    assert.ok(crossOwnerAttempt.errors.assetId);
  }

  // Valid Employee ticket uses crypto.randomUUID and writes employeeId from session
  const created = createSupportTicketRecord({
    input: {
      assetId: 'AST0186',
      priority: 'High',
      subject: 'Screen flickering',
      description: 'External display flickers intermittently over USB-C.',
    },
    session: empSession,
    employees: seedData.employees,
    assets: seedData.assets,
    assignments: seedData.assignments,
    now: new Date('2026-11-13T10:00:00.000Z'),
  });
  assert.equal(created.ok, true);
  if (created.ok) {
    assert.match(
      created.ticket.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    assert.equal(created.ticket.employeeId, 'EMP001');
    assert.equal(created.ticket.assetId, 'AST0186');
    assert.equal(created.ticket.priority, 'High');
    assert.equal(created.ticket.status, 'Requested');
    assert.equal(created.ticket.approvalStatus, 'Pending');
  }
});

test('getTicketsForEmployee and cancelOwnOpenTicket enforce ownership and Open status', () => {
  const empA = makeEmployeeSession('EMP001', 'rahim');
  const empB = makeEmployeeSession('EMP002', 'karim');

  const tickets: SupportTicket[] = [
    {
      id: 'tkt-1',
      employeeId: 'EMP001',
      assetId: 'AST0186',
      subject: 'Trackpad issue',
      description: 'Trackpad unresponsive intermittently.',
      priority: 'Medium',
      status: 'Open',
      createdAt: '2026-11-10T10:00:00.000Z',
      approvalStatus: 'Pending',
    },
    {
      id: 'tkt-2',
      employeeId: 'EMP001',
      assetId: 'AST0186',
      subject: 'Approved ticket',
      description: 'Already approved by admin.',
      priority: 'Low',
      status: 'Approved',
      createdAt: '2026-11-11T10:00:00.000Z',
      approvalStatus: 'Approved',
    },
    {
      id: 'tkt-3',
      employeeId: 'EMP002',
      assetId: 'AST0197',
      subject: 'Other employee ticket',
      description: 'Belongs strictly to EMP002.',
      priority: 'High',
      status: 'Open',
      createdAt: '2026-11-12T10:00:00.000Z',
      approvalStatus: 'Pending',
    },
  ];

  // Employee A sees only EMP001 tickets
  assert.deepEqual(
    getTicketsForEmployee(tickets, empA).map((t) => t.id),
    ['tkt-1', 'tkt-2']
  );

  // Employee B cannot cancel Employee A's ticket
  const crossCancel = cancelOwnOpenTicket({ ticket: tickets[0], session: empB });
  assert.equal(crossCancel.ok, false);

  // Employee A cannot cancel an already Approved ticket
  const nonOpenCancel = cancelOwnOpenTicket({ ticket: tickets[1], session: empA });
  assert.equal(nonOpenCancel.ok, false);

  // Employee A can cancel their own Open ticket
  const validCancel = cancelOwnOpenTicket({ ticket: tickets[0], session: empA });
  assert.equal(validCancel.ok, true);
  if (validCancel.ok) {
    assert.equal(validCancel.ticket.status, 'Closed');
  }
});

test('computeTicketStatusSummary and transitionTicketStatus handle all statuses and Admin-only approvals', () => {
  const adminSession = toSessionUser(SEED_ADMIN_USER);
  const empSession = makeEmployeeSession('EMP001');
  const sample: SupportTicket[] = [
    {
      id: 'TKT0001',
      employeeId: 'EMP001',
      assetId: 'AST0186',
      subject: 'Issue 1',
      description: 'Detailed issue description 1',
      priority: 'High',
      status: 'Open',
      createdAt: '2026-11-10T10:00:00Z',
      approvalStatus: 'Pending',
    },
    {
      id: 'TKT0002',
      employeeId: 'EMP002',
      assetId: 'AST0197',
      subject: 'Issue 2',
      description: 'Detailed issue description 2',
      priority: 'Medium',
      status: 'Approved',
      createdAt: '2026-11-11T10:00:00Z',
      approvalStatus: 'Approved',
    },
    {
      id: 'TKT0003',
      employeeId: 'EMP002',
      assetId: 'AST0200',
      subject: 'Issue 3',
      description: 'Detailed issue description 3',
      priority: 'Low',
      status: 'Rejected',
      createdAt: '2026-11-12T10:00:00Z',
      approvalStatus: 'Rejected',
      rejectionReason: 'Duplicate request',
    },
    {
      id: 'TKT0004',
      employeeId: 'EMP003',
      assetId: 'AST0199',
      subject: 'Issue 4',
      description: 'Detailed issue description 4',
      priority: 'Low',
      status: 'Closed',
      createdAt: '2026-11-12T12:00:00Z',
      approvalStatus: 'Approved',
    },
  ];

  const summary = computeTicketStatusSummary(sample);
  assert.equal(summary.total, 4);
  assert.equal(summary.open, 1);
  assert.equal(summary.approved, 1);
  assert.equal(summary.rejected, 1);
  assert.equal(summary.closed, 1);

  assert.equal(filterTickets(sample, 'Karim', 'ALL', seedData.employees, seedData.assets).length, 2);

  // Employee cannot approve or reject
  assert.equal(
    transitionTicketStatus({ ticket: sample[0], action: 'approve', session: empSession }).ok,
    false
  );
  assert.equal(
    transitionTicketStatus({
      ticket: sample[0],
      action: 'reject',
      session: empSession,
      reason: 'Not needed',
    }).ok,
    false
  );

  // Admin reject requires reason
  assert.equal(
    transitionTicketStatus({
      ticket: sample[0],
      action: 'reject',
      session: adminSession,
      reason: ' ',
    }).ok,
    false
  );

  const approved = transitionTicketStatus({
    ticket: sample[0],
    action: 'approve',
    session: adminSession,
  });
  assert.equal(approved.ok, true);

  // Super Admin can also approve/reject tickets
  const superAdminSession: SessionUser = {
    ...adminSession,
    role: 'Super Admin',
  };
  const superApproved = transitionTicketStatus({
    ticket: sample[0],
    action: 'approve',
    session: superAdminSession,
  });
  assert.equal(superApproved.ok, true);
});

test('formatTicketTimestamp returns exact date and time strings and handles invalid input gracefully', () => {
  const valid = formatTicketTimestamp('2026-11-14T14:35:22.000Z');
  assert.match(valid.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(valid.time.length > 0 && valid.time !== '—');
  assert.equal(valid.full, `${valid.date} · ${valid.time}`);

  const empty = formatTicketTimestamp('');
  assert.deepEqual(empty, { date: '—', time: '—', full: '—' });

  const malformed = formatTicketTimestamp('not-a-timestamp');
  assert.deepEqual(malformed, { date: 'not-a-timestamp', time: '', full: 'not-a-timestamp' });
});

test('Employee Sunday/Holiday blocks, Manager 365-day access, FCFS queue & Work Order minute slot locking', () => {
  const empSession = makeEmployeeSession('EMP001');
  const adminSession = toSessionUser(SEED_ADMIN_USER);
  const managerSession: SessionUser = {
    id: 'usr-mgr',
    loginId: 'dept.manager',
    fullName: 'Monirul Islam',
    email: 'monirul.it@company.com',
    role: 'Department Manager',
    employeeId: 'EMP008',
    permissions: ['attendance.view', 'employee.view'],
    isManager: true,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  const holidays: PublicHoliday[] = [
    {
      id: 'nat-2026-IN_REPUBLIC_DAY',
      title: 'Republic Day',
      holidayDate: '2026-01-26',
      center: 'All Centers',
      description: 'Indian National Holiday',
      isNational: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  // Sunday (2026-11-15) blocked for Employee, allowed for Manager
  const sundayEmp = createSupportTicketRecord({
    input: {
      assetId: 'AST0186',
      priority: 'High',
      subject: 'Sunday ticket attempt',
      description: 'Testing Sunday restriction for employee.',
      requestedDate: '2026-11-15',
    },
    session: empSession,
    employees: seedData.employees,
    assets: seedData.assets,
    assignments: seedData.assignments,
    holidays,
    now: new Date('2026-11-15T10:00:00.000Z'),
  });
  assert.equal(sundayEmp.ok, false);

  const sundayMgr = createSupportTicketRecord({
    input: {
      assetId: 'AST0186',
      priority: 'High',
      subject: 'Manager Sunday ticket',
      description: 'Managers have 365-day ticket access except National Holidays.',
      requestedDate: '2026-11-15',
    },
    session: managerSession,
    employees: seedData.employees,
    assets: seedData.assets,
    assignments: seedData.assignments,
    holidays,
    now: new Date('2026-11-15T10:00:00.000Z'),
  });
  assert.equal(sundayMgr.ok, true);

  // National Holiday (2026-01-26) blocked for both Employee & Manager
  const holidayEmp = createSupportTicketRecord({
    input: {
      assetId: 'AST0186',
      priority: 'Medium',
      subject: 'Holiday ticket',
      description: 'Blocked on Indian National Holiday.',
      requestedDate: '2026-01-26',
    },
    session: empSession,
    employees: seedData.employees,
    assets: seedData.assets,
    assignments: seedData.assignments,
    holidays,
  });
  assert.equal(holidayEmp.ok, false);

  const holidayMgr = createSupportTicketRecord({
    input: {
      assetId: 'AST0186',
      priority: 'Medium',
      subject: 'Manager holiday ticket',
      description: 'Blocked on Indian National Holiday even for manager.',
      requestedDate: '2026-01-26',
    },
    session: managerSession,
    employees: seedData.employees,
    assets: seedData.assets,
    assignments: seedData.assignments,
    holidays,
  });
  assert.equal(holidayMgr.ok, false);

  // Deleting National Holiday immediately makes it a normal working day
  const unblockedEmp = createSupportTicketRecord({
    input: {
      assetId: 'AST0186',
      priority: 'Medium',
      subject: 'Holiday removed ticket',
      description: 'Should succeed once National Holiday is removed.',
      requestedDate: '2026-01-26',
    },
    session: empSession,
    employees: seedData.employees,
    assets: seedData.assets,
    assignments: seedData.assignments,
    holidays: [],
  });
  assert.equal(unblockedEmp.ok, true);

  // Minute-based Work Order creation, Admin slot overlap, Overrun Open status, Confirm, Close
  assert.equal(computeWorkOrderEndTime('10:00', 1), '10:01');
  assert.equal(computeWorkOrderEndTime('10:00', 60), '11:00');
  assert.equal(computeWorkOrderEndTime('10:00', 120), '12:00');

  assert.equal(unblockedEmp.ok, true);
  if (!unblockedEmp.ok) return;

  const approvedWO = transitionTicketStatus({
    ticket: unblockedEmp.ticket,
    action: 'approve',
    session: adminSession,
    workOrderDate: '2026-11-17',
    workOrderStartTime: '10:00',
    workOrderDurationMins: 60,
    allTickets: [unblockedEmp.ticket],
  });
  assert.equal(approvedWO.ok, true);
  if (!approvedWO.ok) return;
  assert.equal(approvedWO.ticket.workOrderEndTime, '11:00');
  assert.equal(approvedWO.ticket.workOrderDurationMins, 60);

  // Employee cannot book overlapping time frame on 2026-11-17 (10:30 for 30m overlaps 10:00-11:00)
  const overlapEmp = createSupportTicketRecord({
    input: {
      assetId: 'AST0186',
      priority: 'High',
      subject: 'Overlapping request',
      description: 'Employee booking overlapping Admin Work Order slot.',
      requestedDate: '2026-11-17',
      requestedStartTime: '10:30',
      requestedDurationMins: 30,
    },
    session: empSession,
    employees: seedData.employees,
    assets: seedData.assets,
    assignments: seedData.assignments,
    existingTickets: [approvedWO.ticket],
  });
  assert.equal(overlapEmp.ok, false);
  assert.equal(
    hasAdminSlotOverlap({
      candidateDate: '2026-11-17',
      candidateStartTime: '11:00',
      candidateDurationMins: 30,
      tickets: [approvedWO.ticket],
    }).overlapping,
    false
  );

  // Overrunning Work Order resolves to Open until closed
  assert.equal(
    resolveEffectiveTicketStatus(approvedWO.ticket, new Date('2026-11-17T12:00:00.000Z')),
    'Open'
  );

  // Employee confirms Work Order
  const confirmed = confirmWorkOrderByEmployee({ ticket: approvedWO.ticket, session: empSession });
  assert.equal(confirmed.ok, true);
  if (confirmed.ok) {
    assert.equal(confirmed.ticket.employeeConfirmed, true);
    // Employee can close ticket once completed
    const closedByEmp = transitionTicketStatus({
      ticket: confirmed.ticket,
      action: 'close',
      session: empSession,
    });
    assert.equal(closedByEmp.ok, true);
    if (closedByEmp.ok) {
      assert.equal(closedByEmp.ticket.status, 'Closed');
    }
  }

  // FCFS sorting and Admin manual reordering
  const t1: SupportTicket = { ...approvedWO.ticket, id: 't-1', queueOrder: 1, createdAt: '2026-11-10T09:00:00Z' };
  const t2: SupportTicket = { ...approvedWO.ticket, id: 't-2', queueOrder: 2, createdAt: '2026-11-10T10:00:00Z' };
  assert.deepEqual(sortTicketsFcfs([t2, t1]).map((t) => t.id), ['t-1', 't-2']);
  const reordered = reorderTicketQueueList([t1, t2], ['t-2', 't-1']);
  assert.deepEqual(reordered.map((t) => t.id), ['t-2', 't-1']);
  assert.equal(reordered[0].queueOrder, 1);
});

