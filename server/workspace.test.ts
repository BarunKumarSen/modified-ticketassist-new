import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openDatabase } from '../src/db/sqlite.ts';
import { createApiApp } from './app.ts';

async function startTestServer() {
  const db = openDatabase(':memory:');
  const app = createApiApp(db);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Failed to bind test server');
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  return {
    db,
    baseUrl,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

async function apiJson(
  baseUrl: string,
  method: string,
  path: string,
  token?: string,
  body?: unknown
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

test('Employee creation rejects duplicate IDs (never overwrites), bulk import respects global IDs, and asset deletion never removes employees', async () => {
  const { db, baseUrl, close } = await startTestServer();
  try {
    const adminLogin = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'admin',
      password: '71537(Lost{MacalliceRost@$$@MoonCrypto}Verse)17571',
    });
    assert.equal(adminLogin.status, 200);
    const adminToken = adminLogin.data.token as string;

    const initialEmps = await apiJson(baseUrl, 'GET', '/api/employees', adminToken);
    assert.equal(initialEmps.status, 200);
    const initialCount = initialEmps.data.employees.length as number;
    assert.ok(initialCount >= 3);

    // 1. Non-5-digit employee ID MUST fail with 400; duplicate 5-digit ID MUST fail with 409 and preserve original record
    const badIdCreate = await apiJson(baseUrl, 'POST', '/api/employees', adminToken, {
      employeeId: 'EMP001',
      name: 'Attempted Overwrite',
      personalEmail: 'attempt.p@company.com',
      officialEmail: 'overwrite@company.com',
      personalEmailVerified: true,
      officialEmailVerified: true,
      panCard: 'ABCDE1234F',
      voterIdCard: 'VOT1234567',
      aadhaarCard: '123456789012',
      password: 'Emp@12345',
      department: 'IT',
      designation: 'Hacker',
    });
    assert.equal(badIdCreate.status, 400);

    const emp1After = (
      await apiJson(baseUrl, 'GET', '/api/employees', adminToken)
    ).data.employees.find((e: { id: string }) => e.id === 'EMP001');
    assert.notEqual(emp1After.name, 'Attempted Overwrite');

    // 2. Scoped Manager bulk employee import without ID column must allocate global non-colliding IDs
    // Grant employee.create to a scoped IT Department Manager so we verify global ID allocation across scoped visibility
    const scopedMgrRes = await apiJson(baseUrl, 'POST', '/api/users', adminToken, {
      loginId: 'it.mgr.import',
      password: 'Dept@1234',
      fullName: 'IT Scoped Importer',
      email: 'it.mgr.import@company.com',
      roleId: 'role_dept_manager',
      department: 'IT',
      active: true,
      customPermissions: ['employee.create'],
    });
    assert.equal(scopedMgrRes.status, 201);

    const deptLogin = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'it.mgr.import',
      password: 'Dept@1234',
    });
    assert.equal(deptLogin.status, 200);
    const deptToken = deptLogin.data.token as string;

    const bulkCsv = [
      'Name,Email,Department,Designation,Mobile,Branch',
      'Nadia Islam,nadia@company.com,IT,Systems Engineer,01799887766,Dhaka HQ',
      'EMP001-Dup,dup@company.com,IT,Dev,01700000000,Dhaka HQ',
      ',missing@company.com,IT,Dev,01700000000,Dhaka HQ',
    ].join('\n');

    const bulkRes = await apiJson(baseUrl, 'POST', '/api/employees/bulk-import', deptToken, {
      csvText: bulkCsv,
      duplicatePolicy: 'skip',
    });
    assert.equal(bulkRes.status, 201);
    assert.equal(bulkRes.data.createdCount, 2); // Nadia + EMP001-Dup (auto-ID)
    assert.equal(bulkRes.data.failedCount, 1);

    // Ensure out-of-scope employees (e.g. EMP002 HR) were NOT overwritten or deleted
    const allAfterImport = await apiJson(baseUrl, 'GET', '/api/employees', adminToken);
    assert.equal(allAfterImport.data.employees.length, initialCount + 2);
    assert.ok(allAfterImport.data.employees.some((e: { id: string }) => e.id === 'EMP002'));

    // 3. Duplicate ID in bulk import with default 'skip' policy MUST NOT overwrite existing EMP001
    const dupBulkCsv = [
      'ID,Name,Email,Department,Designation,Center',
      'EMP001,Wrong Name,wrong@company.com,IT,Intern,Dhaka HQ',
      'EMP201,Sadia Afrin,sadia201@company.com,Finance,Accountant,Dhaka HQ',
    ].join('\n');
    const dupBulkRes = await apiJson(baseUrl, 'POST', '/api/employees/bulk-import', adminToken, {
      csvText: dupBulkCsv,
    });
    assert.equal(dupBulkRes.status, 201);
    assert.equal(dupBulkRes.data.createdCount, 1);
    assert.equal(dupBulkRes.data.skippedCount, 1);

    const emp1Verified = db
      .prepare(`SELECT name FROM Employees WHERE id = 'EMP001'`)
      .get() as { name: string };
    assert.notEqual(emp1Verified.name, 'Wrong Name');

    // 4. Asset deletion MUST NEVER delete employee records
    const wsBefore = await apiJson(baseUrl, 'GET', '/api/workspace/state', adminToken);
    const firstAssetId = wsBefore.data.state.assets[0].id as string;
    const empCountBeforeAssetDel = wsBefore.data.state.employees.length as number;

    const delAssetRes = await apiJson(
      baseUrl,
      'DELETE',
      `/api/assets/${encodeURIComponent(firstAssetId)}`,
      adminToken
    );
    assert.equal(delAssetRes.status, 200);

    const wsAfter = await apiJson(baseUrl, 'GET', '/api/workspace/state', adminToken);
    assert.equal(wsAfter.data.state.employees.length, empCountBeforeAssetDel);

    // 5. Deleting an employee with an active assignment MUST be blocked with 409
    const activeAsn = wsAfter.data.state.assignments.find(
      (a: { status: string }) => a.status === 'Active'
    );
    assert.ok(activeAsn);
    const blockedDelEmp = await apiJson(
      baseUrl,
      'DELETE',
      `/api/employees/${encodeURIComponent(activeAsn.employeeId)}`,
      adminToken
    );
    assert.equal(blockedDelEmp.status, 409);

    // Unassigned employee EMP201 can be explicitly deleted
    const delUnassigned = await apiJson(
      baseUrl,
      'DELETE',
      '/api/employees/EMP201',
      adminToken
    );
    assert.equal(delUnassigned.status, 200);
  } finally {
    await close();
  }
});

test('Batch asset update updates status/department atomically with audit logs, and Enterprise Backup/Restore preserves and restores all modules', async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const adminLogin = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'admin',
      password: '71537(Lost{MacalliceRost@$$@MoonCrypto}Verse)17571',
    });
    const adminToken = adminLogin.data.token as string;

    const wsRes = await apiJson(baseUrl, 'GET', '/api/workspace/state', adminToken);
    assert.equal(wsRes.status, 200);
    const assets = wsRes.data.state.assets as Array<{ id: string; status: string; department: string }>;
    assert.ok(assets.length >= 2);
    const targetIds = [assets[0].id, assets[1].id];
    const empCountBefore = wsRes.data.state.employees.length as number;

    // 1. Batch update status + department
    const batchRes = await apiJson(baseUrl, 'POST', '/api/assets/bulk-update', adminToken, {
      assetIds: targetIds,
      status: 'Under Maintenance',
      department: 'Operations',
      notes: 'Scheduled quarterly audit',
    });
    assert.equal(batchRes.status, 200);
    assert.equal(batchRes.data.updatedCount, 2);

    const wsAfterBatch = await apiJson(baseUrl, 'GET', '/api/workspace/state', adminToken);
    for (const id of targetIds) {
      const updated = wsAfterBatch.data.state.assets.find((a: { id: string }) => a.id === id);
      assert.equal(updated.status, 'Under Maintenance');
      assert.equal(updated.department, 'Operations');
    }
    assert.equal(wsAfterBatch.data.state.employees.length, empCountBefore);

    // 2. Create a custom 5-digit employee, export full enterprise backup, delete employee, restore in merge mode
    const createdEmp = await apiJson(baseUrl, 'POST', '/api/employees', adminToken, {
      employeeId: '30501',
      name: 'Backup Verify Employee',
      personalEmail: 'backup.personal@company.com',
      officialEmail: 'backup.verify@company.com',
      personalEmailVerified: true,
      officialEmailVerified: true,
      uanNumber: '100998877665',
      panCard: 'ABCDE3050F',
      voterIdCard: 'VOT3050123',
      aadhaarCard: '305012345678',
      password: 'Backup@1234',
      department: 'Operations',
      designation: 'Auditor',
      center: 'Dhaka HQ',
    });
    assert.equal(createdEmp.status, 201);
    assert.equal(createdEmp.data.employee.employeeId, 'EMP-30501');

    // Duplicate 5-digit employee creation MUST fail with 409
    const dup5Digit = await apiJson(baseUrl, 'POST', '/api/employees', adminToken, {
      employeeId: 'EMP-30501',
      name: 'Duplicate 30501',
      personalEmail: 'dup30501.p@company.com',
      officialEmail: 'dup30501.o@company.com',
      personalEmailVerified: true,
      officialEmailVerified: true,
      panCard: 'ABCDE9999F',
      voterIdCard: 'VOT9999999',
      aadhaarCard: '999912345678',
      password: 'Dup@12345',
      department: 'Operations',
      designation: 'Auditor',
    });
    assert.equal(dup5Digit.status, 409);

    // Newly created employee can immediately log in using EMP-30501 + password
    const newEmpLogin = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'EMP-30501',
      password: 'Backup@1234',
    });
    assert.equal(newEmpLogin.status, 200);

    const exportRes = await apiJson(baseUrl, 'GET', '/api/backup/export', adminToken);
    assert.equal(exportRes.status, 200);
    const backup = exportRes.data.backup;
    assert.ok(Array.isArray(backup.employees));
    assert.ok(Array.isArray(backup.assets));
    assert.ok(Array.isArray(backup.users));
    assert.ok(Array.isArray(backup.roles));
    assert.ok(Array.isArray(backup.permissions));
    assert.ok(Array.isArray(backup.attendance));
    assert.ok(Array.isArray(backup.systemAuditLogs));
    assert.ok(Array.isArray(backup.attachments));
    assert.ok(backup.settings);

    // Explicitly delete EMP-30501, then create another unrelated employee EMP-30601
    const del305 = await apiJson(baseUrl, 'DELETE', '/api/employees/EMP-30501', adminToken);
    assert.equal(del305.status, 200);

    const create306 = await apiJson(baseUrl, 'POST', '/api/employees', adminToken, {
      employeeId: '30601',
      name: 'Newer Employee Kept On Merge',
      personalEmail: 'kept306.p@company.com',
      officialEmail: 'kept306@company.com',
      personalEmailVerified: true,
      officialEmailVerified: true,
      panCard: 'ABCDE3060F',
      voterIdCard: 'VOT3060123',
      aadhaarCard: '306012345678',
      password: 'Kept@12345',
      department: 'IT',
      designation: 'Engineer',
    });
    assert.equal(create306.status, 201);
    assert.equal(create306.data.employee.employeeId, 'EMP-30601');

    // Restore backup in SAFE MERGE mode -> EMP-30501 comes back AND EMP-30601 stays intact!
    const restoreRes = await apiJson(baseUrl, 'POST', '/api/backup/restore', adminToken, {
      backup,
      mode: 'merge',
    });
    assert.equal(restoreRes.status, 200);

    const empsFinal = await apiJson(baseUrl, 'GET', '/api/employees', adminToken);
    const empIds = new Set(empsFinal.data.employees.map((e: { id: string }) => e.id));
    assert.ok(empIds.has('EMP-30501'), 'EMP-30501 should be restored from backup');
    assert.ok(empIds.has('EMP-30601'), 'EMP-30601 should be preserved during merge restore');

    // Verify System Audit Logs captured employee create, batch update, delete, backup export, restore
    const auditRes = await apiJson(baseUrl, 'GET', '/api/audit-logs', adminToken);
    assert.equal(auditRes.status, 200);
    const actions = new Set(auditRes.data.logs.map((l: { action: string }) => l.action));
    assert.ok(actions.has('ASSET_BULK_UPDATED'));
    assert.ok(actions.has('EMPLOYEE_CREATED'));
    assert.ok(actions.has('EMPLOYEE_DELETED'));
    assert.ok(actions.has('BACKUP_EXPORTED'));
    assert.ok(actions.has('BACKUP_RESTORED'));
  } finally {
    await close();
  }
});

test('Ticketing FCFS, National Holiday rollover/delete override, Work Order slot locking, Departments/Designations, and Leave accrual', async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const adminLogin = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'admin',
      password: '71537(Lost{MacalliceRost@$$@MoonCrypto}Verse)17571',
    });
    const adminToken = adminLogin.data.token as string;

    const rahimLogin = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'rahim',
      password: 'Rahim@123',
    });
    const rahimToken = rahimLogin.data.token as string;

    const mgrLogin = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'dept.manager',
      password: 'Dept@1234',
    });
    const mgrToken = mgrLogin.data.token as string;

    // 1. Dynamic Department & Mapped Designation CRUD
    const deptRes = await apiJson(baseUrl, 'POST', '/api/departments', adminToken, {
      name: 'Field Analytics',
    });
    assert.equal(deptRes.status, 201);
    assert.ok(deptRes.data.departments.includes('Field Analytics'));

    const desigRes = await apiJson(baseUrl, 'POST', '/api/designations', adminToken, {
      departmentName: 'Field Analytics',
      designationName: 'Principal Survey Analyst',
    });
    assert.equal(desigRes.status, 201);
    assert.equal(desigRes.data.designation.designationName, 'Principal Survey Analyst');

    // 2. Indian National Holidays auto-roll forward to 2028; deleting makes date immediately usable
    const hol2028 = await apiJson(baseUrl, 'GET', '/api/holidays?year=2028', adminToken);
    assert.equal(hol2028.status, 200);
    const republicDay2028 = hol2028.data.holidays.find(
      (h: { isNational?: boolean; holidayDate: string }) => h.isNational && h.holidayDate === '2028-01-26'
    );
    assert.ok(republicDay2028, 'Republic Day should auto-roll forward to 2028');

    // Get an asset assigned to EMP001
    const wsRes = await apiJson(baseUrl, 'GET', '/api/workspace/state', rahimToken);
    const activeAsn = (wsRes.data.state.assignments as Array<{ employeeId: string; assetId: string; status: string }>).find(
      (a) => a.status === 'Active' && (a.employeeId === 'EMP001' || a.employeeId === 'EMP-1001')
    );
    assert.ok(activeAsn, 'Expected active assignment for EMP001');
    const rahimAsset = (wsRes.data.state.assets as Array<{ id: string }>).find(
      (a) => a.id === activeAsn.assetId
    );
    assert.ok(rahimAsset, 'Expected assigned asset record for EMP001');

    // Employee blocked on Sunday (2026-08-16) and National Holiday (2028-01-26)
    const sundayBlocked = await apiJson(baseUrl, 'POST', '/api/tickets', rahimToken, {
      assetId: rahimAsset.id,
      subject: 'Sunday ticket attempt',
      description: 'Trying to raise a ticket on Sunday which should be blocked.',
      priority: 'Medium',
      requestedDate: '2026-08-16',
    });
    assert.equal(sundayBlocked.status, 400);
    assert.ok(String(sundayBlocked.data.error).includes('Sundays'));

    const holBlocked = await apiJson(baseUrl, 'POST', '/api/tickets', rahimToken, {
      assetId: rahimAsset.id,
      subject: 'National holiday attempt',
      description: 'Trying to raise a ticket on Republic Day 2028.',
      priority: 'Medium',
      requestedDate: '2028-01-26',
    });
    assert.equal(holBlocked.status, 400);
    assert.ok(String(holBlocked.data.error).includes('National Holiday'));

    // Manager IS allowed on Sunday (2026-08-16), but blocked on National Holiday
    const mgrSundayOk = await apiJson(baseUrl, 'POST', '/api/tickets', mgrToken, {
      assetId: rahimAsset.id,
      subject: 'Manager Sunday emergency',
      description: 'Manager raising emergency Sunday support ticket.',
      priority: 'High',
      requestedDate: '2026-08-16',
    });
    assert.equal(mgrSundayOk.status, 201);

    const mgrHolBlocked = await apiJson(baseUrl, 'POST', '/api/tickets', mgrToken, {
      assetId: rahimAsset.id,
      subject: 'Manager National holiday blocked',
      description: 'Manager trying on National Holiday 2028-01-26.',
      priority: 'High',
      requestedDate: '2028-01-26',
    });
    assert.equal(mgrHolBlocked.status, 400);
    assert.ok(String(mgrHolBlocked.data.error).includes('National Holiday'));

    // Admin deletes 2028 Republic Day -> immediately becomes a normal working day
    const delHol = await apiJson(baseUrl, 'DELETE', `/api/holidays/${republicDay2028.id}`, adminToken);
    assert.equal(delHol.status, 200);
    const postDelEmpTicket = await apiJson(baseUrl, 'POST', '/api/tickets', rahimToken, {
      assetId: rahimAsset.id,
      subject: 'Book on overridden working day',
      description: 'Raising ticket after Admin removed National Holiday.',
      priority: 'Medium',
      requestedDate: '2028-01-26',
      requestedStartTime: '09:00',
      requestedDurationMins: 30,
    });
    assert.equal(postDelEmpTicket.status, 201);
    assert.equal(postDelEmpTicket.data.ticket.status, 'Requested');

    // Admin schedules a Work Order (60 mins: 10:00 -> 11:00 on 2026-10-12)
    const empMondayTicket = await apiJson(baseUrl, 'POST', '/api/tickets', rahimToken, {
      assetId: rahimAsset.id,
      subject: 'Laptop battery diagnostics',
      description: 'Need Work Order diagnostics for battery calibration.',
      priority: 'Medium',
      requestedDate: '2026-10-12',
    });
    assert.equal(empMondayTicket.status, 201);

    const woRes = await apiJson(
      baseUrl,
      'POST',
      `/api/tickets/${empMondayTicket.data.ticket.id}/work-order`,
      adminToken,
      {
        workOrderDate: '2026-10-12',
        workOrderStartTime: '10:00',
        workOrderDurationMins: 60,
      }
    );
    assert.equal(woRes.status, 200);
    assert.equal(woRes.data.ticket.workOrderEndTime, '11:00');
    assert.equal(woRes.data.ticket.status, 'Open'); // 2026-10-12 is in past relative to Nov 2026 -> overrunning stays Open!

    // Overlapping Employee slot on 2026-10-12 10:30 must be blocked by Admin Slot Locking
    const overlapRes = await apiJson(baseUrl, 'POST', '/api/tickets', rahimToken, {
      assetId: rahimAsset.id,
      subject: 'Overlapping slot check',
      description: 'Should fail because Admin is booked 10:00-11:00.',
      priority: 'Low',
      requestedDate: '2026-10-12',
      requestedStartTime: '10:30',
      requestedDurationMins: 30,
    });
    assert.equal(overlapRes.status, 400);
    assert.ok(overlapRes.data.error.includes('Admin is booked'));

    // Employee confirms Work Order, then closes ticket even from Open state
    const confirmRes = await apiJson(
      baseUrl,
      'POST',
      `/api/tickets/${empMondayTicket.data.ticket.id}/confirm`,
      rahimToken
    );
    assert.equal(confirmRes.status, 200);
    assert.equal(confirmRes.data.ticket.employeeConfirmed, true);

    const closeRes = await apiJson(
      baseUrl,
      'POST',
      `/api/tickets/${empMondayTicket.data.ticket.id}/close`,
      rahimToken
    );
    assert.equal(closeRes.status, 200);
    assert.equal(closeRes.data.ticket.status, 'Closed');

    // Manual queue reorder by Admin
    const reorderRes = await apiJson(baseUrl, 'PUT', '/api/tickets/reorder', adminToken, {
      orderedIds: [empMondayTicket.data.ticket.id, postDelEmpTicket.data.ticket.id],
    });
    assert.equal(reorderRes.status, 200);
    assert.equal(reorderRes.data.tickets[0].id, empMondayTicket.data.ticket.id);

    // 3. Leave Accrual Balance endpoint
    const balRes = await apiJson(baseUrl, 'GET', '/api/leaves/balances?year=2026', adminToken);
    assert.equal(balRes.status, 200);
    assert.ok(Array.isArray(balRes.data.balances));
    assert.ok(balRes.data.balances.every((b: { maxCap: number }) => b.maxCap === 44));
  } finally {
    await close();
  }
});
