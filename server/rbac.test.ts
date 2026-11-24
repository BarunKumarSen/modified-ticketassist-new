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

test('SQLite hashes passwords securely and JWT login/logout/RBAC enforce permissions', async () => {
  const { db, baseUrl, close } = await startTestServer();
  try {
    // 1. Verify stored password in SQLite is hashed with scrypt, never plain text
    const adminRow = db
      .prepare(`SELECT password FROM Users WHERE login_id = 'admin'`)
      .get() as { password: string };
    assert.ok(adminRow.password.startsWith('scrypt$'));
    assert.equal(adminRow.password.includes('71537(Lost{MacalliceRost@$$@MoonCrypto}Verse)17571'), false);

    // 2. Unauthenticated requests return 401
    const unauth = await apiJson(baseUrl, 'GET', '/api/attendance');
    assert.equal(unauth.status, 401);

    // 3. Invalid login gives generic 401 without revealing which field failed
    const badPw = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'admin',
      password: 'WrongPassword@1',
    });
    const badId = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'unknown_user',
      password: 'WrongPassword@1',
    });
    assert.equal(badPw.status, 401);
    assert.equal(badId.status, 401);
    assert.equal(badPw.data.error, badId.data.error);

    // 4. Super Admin login succeeds and returns permissions without password
    const adminLogin = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'admin',
      password: '71537(Lost{MacalliceRost@$$@MoonCrypto}Verse)17571',
    });
    assert.equal(adminLogin.status, 200);
    assert.ok(adminLogin.data.token);
    assert.equal(adminLogin.data.user.role, 'Super Admin');
    assert.equal('password' in adminLogin.data.user, false);
    assert.ok(adminLogin.data.user.permissions.includes('role.manage'));

    const adminToken = adminLogin.data.token as string;

    // 5. Super Admin creates a custom user with employee.view only (NO attendance.view)
    const createEmpViewOnly = await apiJson(baseUrl, 'POST', '/api/users', adminToken, {
      loginId: 'empview',
      password: 'User@1234',
      fullName: 'Viewer Only',
      email: 'viewer@company.com',
      roleId: 'role_employee',
      employeeId: 'EMP003',
      active: true,
      customPermissions: ['employee.view'],
    });
    assert.equal(createEmpViewOnly.status, 201);

    // Also create a user with Role Auditor and remove attendance.view via role edit later
    const createCustomOnlyEmpView = await apiJson(baseUrl, 'POST', '/api/users', adminToken, {
      loginId: 'noatt',
      password: 'User@1234',
      fullName: 'No Attendance User',
      email: 'noatt@company.com',
      roleId: 'role_auditor',
      active: true,
      customPermissions: ['user.create'],
    });
    assert.equal(createCustomOnlyEmpView.status, 201);
    assert.ok(createCustomOnlyEmpView.data.user.permissions.includes('user.create'));

    // Update role_auditor to remove attendance.view -> verify user loses attendance.view dynamically
    const roleUpdate = await apiJson(
      baseUrl,
      'PUT',
      '/api/roles/role_auditor/permissions',
      adminToken,
      { permissions: ['employee.view'] }
    );
    assert.equal(roleUpdate.status, 200);

    const noAttLogin = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'noatt',
      password: 'User@1234',
    });
    assert.equal(noAttLogin.status, 200);
    assert.equal(noAttLogin.data.user.permissions.includes('attendance.view'), false);
    assert.ok(noAttLogin.data.user.permissions.includes('employee.view'));
    assert.ok(noAttLogin.data.user.permissions.includes('user.create'));

    // Direct API request to /api/attendance MUST return 403 Access Denied
    const blockedAtt = await apiJson(baseUrl, 'GET', '/api/attendance', noAttLogin.data.token);
    assert.equal(blockedAtt.status, 403);
    assert.equal(blockedAtt.data.error, 'Access Denied');

    // Direct API request to /api/employees succeeds (employee.view), but POST /api/employees returns 403
    const allowedEmpList = await apiJson(baseUrl, 'GET', '/api/employees', noAttLogin.data.token);
    assert.equal(allowedEmpList.status, 200);
    const blockedEmpCreate = await apiJson(baseUrl, 'POST', '/api/employees', noAttLogin.data.token, {
      employeeId: 'EMP-999',
      name: 'Blocked',
      email: 'b@company.com',
    });
    assert.equal(blockedEmpCreate.status, 403);

    // 6. Logout revokes JWT token immediately
    const logoutRes = await apiJson(baseUrl, 'POST', '/api/auth/logout', noAttLogin.data.token);
    assert.equal(logoutRes.status, 200);
    const afterLogout = await apiJson(baseUrl, 'GET', '/api/auth/me', noAttLogin.data.token);
    assert.equal(afterLogout.status, 401);
  } finally {
    await close();
  }
});

test('Department Manager and Employee attendance scoping, check-in/out, leave approval, and audit logs', async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    // 1. Employee (rahim -> EMP001, IT) logs in
    const rahimLogin = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'rahim',
      password: 'Rahim@123',
    });
    assert.equal(rahimLogin.status, 200);
    const rahimToken = rahimLogin.data.token as string;

    // Rahim can check in & check out for today
    const checkIn = await apiJson(baseUrl, 'POST', '/api/attendance/check-in', rahimToken, {
      date: '2026-09-01',
      checkInTime: '09:40',
      remarks: 'Bus delay',
    });
    assert.equal(checkIn.status, 201);
    assert.equal(checkIn.data.record.status, 'Late');
    assert.equal(checkIn.data.record.lateMinutes, 10);

    const checkOut = await apiJson(baseUrl, 'POST', '/api/attendance/check-out', rahimToken, {
      date: '2026-09-01',
      checkOutTime: '17:40',
    });
    assert.equal(checkOut.status, 200);
    assert.equal(checkOut.data.record.workHours, 8);

    // Rahim CANNOT check in for Karim (EMP002) -> 403
    const otherCheckIn = await apiJson(baseUrl, 'POST', '/api/attendance/check-in', rahimToken, {
      employeeId: 'EMP002',
      date: '2026-09-01',
      checkInTime: '09:00',
    });
    assert.equal(otherCheckIn.status, 403);

    // Rahim CANNOT access daily reports or edit attendance -> 403
    const rahimReport = await apiJson(
      baseUrl,
      'GET',
      '/api/attendance/reports/daily?date=2026-09-01',
      rahimToken
    );
    assert.equal(rahimReport.status, 403);

    const rahimEdit = await apiJson(
      baseUrl,
      'PUT',
      `/api/attendance/${checkIn.data.record.id}`,
      rahimToken,
      { status: 'Present' }
    );
    assert.equal(rahimEdit.status, 403);

    // Rahim sees ONLY own attendance records
    const rahimHistory = await apiJson(baseUrl, 'GET', '/api/attendance', rahimToken);
    assert.equal(rahimHistory.status, 200);
    assert.ok(rahimHistory.data.records.every((r: { employeeId: string }) => r.employeeId === 'EMP001'));

    // Rahim submits leave request
    const rahimLeave = await apiJson(baseUrl, 'POST', '/api/leaves', rahimToken, {
      leaveType: 'Casual',
      startDate: '2026-09-05',
      endDate: '2026-09-06',
      reason: 'Family event out of town',
    });
    assert.equal(rahimLeave.status, 201);

    // 2. Department Manager (dept.manager -> IT) logs in
    const deptLogin = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'dept.manager',
      password: 'Dept@1234',
    });
    assert.equal(deptLogin.status, 200);
    const deptToken = deptLogin.data.token as string;

    // Dept Manager only sees IT employees
    const deptEmps = await apiJson(baseUrl, 'GET', '/api/employees', deptToken);
    assert.equal(deptEmps.status, 200);
    assert.ok(deptEmps.data.employees.length > 0);
    assert.ok(deptEmps.data.employees.every((e: { department: string }) => e.department === 'IT'));

    // Dept Manager CAN approve Rahim's (IT) attendance correction and leave
    const approveCorrection = await apiJson(
      baseUrl,
      'PUT',
      `/api/attendance/${checkIn.data.record.id}`,
      deptToken,
      { status: 'Present', remarks: 'Excused transit delay', correctionStatus: 'Approved' }
    );
    assert.equal(approveCorrection.status, 200);
    assert.equal(approveCorrection.data.record.status, 'Present');

    const approveLeave = await apiJson(
      baseUrl,
      'PUT',
      `/api/leaves/${rahimLeave.data.leave.id}`,
      deptToken,
      { status: 'Approved' }
    );
    assert.equal(approveLeave.status, 200);
    assert.equal(approveLeave.data.leave.status, 'Approved');

    // Dept Manager CANNOT edit HR employee's (EMP002) attendance -> 403
    const hrLogin = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'hr.manager',
      password: 'Hr@12345',
    });
    assert.equal(hrLogin.status, 200);
    const hrToken = hrLogin.data.token as string;

    const hrAttList = await apiJson(
      baseUrl,
      'GET',
      '/api/attendance?employeeId=EMP002',
      hrToken
    );
    assert.equal(hrAttList.status, 200);
    const emp002AttId = hrAttList.data.records[0].id as string;

    const deptBlockedEdit = await apiJson(
      baseUrl,
      'PUT',
      `/api/attendance/${emp002AttId}`,
      deptToken,
      { status: 'Late' }
    );
    assert.equal(deptBlockedEdit.status, 403);

    // 3. Audit logs recorded check-in, check-out, correction, and leave approval
    const auditRes = await apiJson(baseUrl, 'GET', '/api/attendance/audit-logs', hrToken);
    assert.equal(auditRes.status, 200);
    const actions = new Set(auditRes.data.logs.map((l: { action: string }) => l.action));
    assert.ok(actions.has('CHECK_IN'));
    assert.ok(actions.has('CHECK_OUT'));
    assert.ok(actions.has('CORRECTION_APPROVED'));
    assert.ok(actions.has('LEAVE_APPROVED'));
  } finally {
    await close();
  }
});
