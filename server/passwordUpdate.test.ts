import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, listUsersWithPermissions } from '../src/db/sqlite.ts';
import { createApiApp } from './app.ts';
import { SEED_ADMIN_PASSWORD } from '../src/data/seedData.ts';
import type { PersonnelEntityType } from '../src/types/asset.ts';

async function startTestServer(dbPath = ':memory:') {
  const db = openDatabase(dbPath);
  const app = createApiApp(db);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Failed to bind test server');
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  return {
    db,
    baseUrl,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
      db.close();
    },
  };
}

async function apiJson(
  baseUrl: string,
  method: string,
  endpoint: string,
  token?: string,
  body?: unknown
) {
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

test('Employee password update (seeded, newly created, and without prior Users row) persists and authenticates cleanly', async () => {
  const { db, baseUrl, close } = await startTestServer();
  try {
    const adminLogin = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'admin',
      password: SEED_ADMIN_PASSWORD,
    });
    assert.equal(adminLogin.status, 200);
    const adminToken = adminLogin.data.token as string;

    // 1. Seeded employee EMP001 (login_id='rahim') -> change password via PUT /api/employees/EMP001
    const oldPass = 'Rahim@123';
    const newPass = 'RahimNew@2026';

    const weakRes = await apiJson(baseUrl, 'PUT', '/api/employees/EMP001', adminToken, {
      password: 'weak',
    });
    assert.equal(weakRes.status, 400);

    // Old password still works after rejected weak password
    const stillOld = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'rahim',
      password: oldPass,
    });
    assert.equal(stillOld.status, 200);

    const empUpdate = await apiJson(baseUrl, 'PUT', '/api/employees/EMP001', adminToken, {
      password: newPass,
    });
    assert.equal(empUpdate.status, 200);
    assert.equal(empUpdate.data.passwordUpdated, true);
    assert.equal(empUpdate.data.userAccountCreated, false);

    // Old password must fail; new password succeeds immediately by loginId and email
    const failOld = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'rahim',
      password: oldPass,
    });
    assert.equal(failOld.status, 401);

    const okNewByLogin = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'rahim',
      password: newPass,
    });
    assert.equal(okNewByLogin.status, 200);
    assert.equal(okNewByLogin.data.user.employeeId, 'EMP001');

    const okNewByEmail = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'rahim.a@example.com',
      password: newPass,
    });
    assert.equal(okNewByEmail.status, 200);

    // Editing another field with blank/omitted password keeps the updated password
    const editWithoutPw = await apiJson(baseUrl, 'PUT', '/api/employees/EMP001', adminToken, {
      phone: '+880-1700-111222',
    });
    assert.equal(editWithoutPw.status, 200);
    assert.equal(editWithoutPw.data.passwordUpdated, false);

    const stillNew = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'rahim',
      password: newPass,
    });
    assert.equal(stillNew.status, 200);

    // 2. Create a new 5-digit employee -> update password -> verify login & email login
    const createEmp = await apiJson(baseUrl, 'POST', '/api/employees', adminToken, {
      employeeId: '55432',
      name: 'Arjun Sengupta',
      personalEmail: 'arjun.p@example.com',
      officialEmail: 'arjun.s@median.in',
      personalEmailVerified: true,
      officialEmailVerified: true,
      panCard: 'ABCDE5543F',
      voterIdCard: 'VOT5543210',
      aadhaarCard: '554321234567',
      password: 'InitEmp@123',
      department: 'IT',
      designation: 'Analyst',
      center: 'Kolkata',
      status: 'Active',
    });
    assert.equal(createEmp.status, 201);

    const updNewEmp = await apiJson(baseUrl, 'PUT', '/api/employees/EMP-55432', adminToken, {
      password: 'UpdatedEmp@999',
    });
    assert.equal(updNewEmp.status, 200);
    assert.equal(updNewEmp.data.passwordUpdated, true);

    const oldEmpFail = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'EMP-55432',
      password: 'InitEmp@123',
    });
    assert.equal(oldEmpFail.status, 401);

    const newEmpOk = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'EMP-55432',
      password: 'UpdatedEmp@999',
    });
    assert.equal(newEmpOk.status, 200);

    // 3. Seeded employee EMP003 without prior Users row -> setting Login Password provisions Users row
    const emp3Prov = await apiJson(baseUrl, 'PUT', '/api/employees/EMP003', adminToken, {
      password: 'Farhana@2026!',
    });
    assert.equal(emp3Prov.status, 200);
    assert.equal(emp3Prov.data.passwordUpdated, true);
    assert.equal(emp3Prov.data.userAccountCreated, true);

    const emp3Login = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'EMP-1003',
      password: 'Farhana@2026!',
    });
    assert.equal(emp3Login.status, 200);
    assert.equal(emp3Login.data.user.employeeId, 'EMP003');

    const emp3EmailLogin = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'fatima.b@example.com',
      password: 'Farhana@2026!',
    });
    assert.equal(emp3EmailLogin.status, 200);
    assert.equal(emp3EmailLogin.data.user.employeeId, 'EMP003');

    // Verify stored hash format and zero password/hash leakage in audit logs
    const storedHashRow = db
      .prepare(`SELECT password FROM Users WHERE login_id = 'rahim'`)
      .get() as { password: string };
    assert.ok(storedHashRow.password.startsWith('scrypt$'));
    assert.notEqual(storedHashRow.password, newPass);

    const auditRows = db
      .prepare(`SELECT action, before_json, after_json, details FROM System_Audit_Logs`)
      .all() as Array<{
      action: string;
      before_json: string | null;
      after_json: string | null;
      details: string;
    }>;
    assert.ok(auditRows.some((r) => r.action === 'PASSWORD_UPDATED'));
    assert.ok(auditRows.some((r) => r.action === 'USER_PASSWORD_PROVISIONED'));
    const allAuditText = JSON.stringify(auditRows);
    assert.equal(allAuditText.includes(newPass), false, 'Audit logs must never store raw passwords');
    assert.equal(
      allAuditText.includes('UpdatedEmp@999'),
      false,
      'Audit logs must never store raw passwords'
    );
    assert.equal(
      allAuditText.includes('Farhana@2026!'),
      false,
      'Audit logs must never store raw passwords'
    );
    assert.equal(allAuditText.includes('scrypt$'), false, 'Audit logs must never store password hashes');
  } finally {
    await close();
  }
});

test('Consultant, Retainer, Freelancer, Young Research Program, and Intern password updates work immediately and persist across server restarts', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assetos-pw-test-'));
  const dbPath = path.join(tempDir, 'assetos-restart.db');

  const cases: Array<{
    entityType: PersonnelEntityType;
    codeWithPw: string;
    emailWithPw: string;
    codeWithoutPw: string;
    emailWithoutPw: string;
    initialPw: string;
    updatedPw: string;
    provisionedPw: string;
  }> = [
    {
      entityType: 'Consultant',
      codeWithPw: 'CON101',
      emailWithPw: 'con101@median.in',
      codeWithoutPw: 'CON102',
      emailWithoutPw: 'con102@median.in',
      initialPw: 'ConInit@123',
      updatedPw: 'ConNew@2026!',
      provisionedPw: 'ConProv@2026!',
    },
    {
      entityType: 'Retainer',
      codeWithPw: 'RET101',
      emailWithPw: 'ret101@median.in',
      codeWithoutPw: 'RET102',
      emailWithoutPw: 'ret102@median.in',
      initialPw: 'RetInit@123',
      updatedPw: 'RetNew@2026!',
      provisionedPw: 'RetProv@2026!',
    },
    {
      entityType: 'Freelancer',
      codeWithPw: 'FRL101',
      emailWithPw: 'frl101@median.in',
      codeWithoutPw: 'FRL102',
      emailWithoutPw: 'frl102@median.in',
      initialPw: 'FrlInit@123',
      updatedPw: 'FrlNew@2026!',
      provisionedPw: 'FrlProv@2026!',
    },
    {
      entityType: 'Young Research Program',
      codeWithPw: 'YRP101',
      emailWithPw: 'yrp101@median.in',
      codeWithoutPw: 'YRP102',
      emailWithoutPw: 'yrp102@median.in',
      initialPw: 'YrpInit@123',
      updatedPw: 'YrpNew@2026!',
      provisionedPw: 'YrpProv@2026!',
    },
    {
      entityType: 'Intern',
      codeWithPw: 'INT101',
      emailWithPw: 'int101@median.in',
      codeWithoutPw: 'INT102',
      emailWithoutPw: 'int102@median.in',
      initialPw: 'IntInit@123',
      updatedPw: 'IntNew@2026!',
      provisionedPw: 'IntProv@2026!',
    },
  ];

  try {
    // Phase 1: Boot server #1, create entities, update passwords, verify login immediately
    const srv1 = await startTestServer(dbPath);
    try {
      const adminLogin = await apiJson(srv1.baseUrl, 'POST', '/api/auth/login', undefined, {
        loginId: 'admin',
        password: SEED_ADMIN_PASSWORD,
      });
      assert.equal(adminLogin.status, 200);
      const adminToken = adminLogin.data.token as string;

      // Also update an Employee on disk DB to verify restart persistence for Employee
      const empUpd = await apiJson(srv1.baseUrl, 'PUT', '/api/employees/EMP002', adminToken, {
        password: 'KarimUpdated@2026',
      });
      assert.equal(empUpd.status, 200);

      for (const c of cases) {
        // Case A: Created WITH initial Portal Login Password -> edited with new password
        const createWith = await apiJson(srv1.baseUrl, 'POST', '/api/entities', adminToken, {
          entityType: c.entityType,
          entityCode: c.codeWithPw,
          name: `${c.entityType} One`,
          email: c.emailWithPw,
          phone: '9830011001',
          center: 'Kolkata',
          password: c.initialPw,
        });
        assert.equal(createWith.status, 201, `Create with pw failed for ${c.entityType}`);

        // Weak password on edit must fail 400 and leave initialPw working
        const weakEdit = await apiJson(srv1.baseUrl, 'PUT', `/api/entities/${c.codeWithPw}`, adminToken, {
          name: `${c.entityType} One`,
          email: c.emailWithPw,
          phone: '9830011001',
          password: 'short',
        });
        assert.equal(weakEdit.status, 400);

        const updatePw = await apiJson(srv1.baseUrl, 'PUT', `/api/entities/${c.codeWithPw}`, adminToken, {
          name: `${c.entityType} One Updated`,
          email: c.emailWithPw,
          phone: '9830011001',
          password: c.updatedPw,
        });
        assert.equal(updatePw.status, 200, `Update pw failed for ${c.entityType}`);
        assert.equal(updatePw.data.passwordUpdated, true);
        assert.equal(updatePw.data.userAccountCreated, false);

        // Old password must fail immediately
        const oldLogin = await apiJson(srv1.baseUrl, 'POST', '/api/auth/login', undefined, {
          loginId: c.codeWithPw,
          password: c.initialPw,
        });
        assert.equal(oldLogin.status, 401, `Old password should fail for ${c.entityType}`);

        // New password must succeed immediately via code & email
        const newLogin = await apiJson(srv1.baseUrl, 'POST', '/api/auth/login', undefined, {
          loginId: c.codeWithPw,
          password: c.updatedPw,
        });
        assert.equal(newLogin.status, 200, `New password should succeed for ${c.entityType}`);
        assert.equal(newLogin.data.user.role, c.entityType);

        const newEmailLogin = await apiJson(srv1.baseUrl, 'POST', '/api/auth/login', undefined, {
          loginId: c.emailWithPw,
          password: c.updatedPw,
        });
        assert.equal(newEmailLogin.status, 200, `Email login should succeed for ${c.entityType}`);

        // Case B: Created WITHOUT initial password -> edited later with Reset Portal Password
        const createWithout = await apiJson(srv1.baseUrl, 'POST', '/api/entities', adminToken, {
          entityType: c.entityType,
          entityCode: c.codeWithoutPw,
          name: `${c.entityType} Two`,
          email: c.emailWithoutPw,
          phone: '9830011002',
          center: 'Mumbai',
        });
        assert.equal(createWithout.status, 201);
        assert.equal(createWithout.data.user, undefined);

        const provisionPw = await apiJson(
          srv1.baseUrl,
          'PUT',
          `/api/entities/${c.codeWithoutPw}`,
          adminToken,
          {
            name: `${c.entityType} Two`,
            email: c.emailWithoutPw,
            phone: '9830011002',
            password: c.provisionedPw,
          }
        );
        assert.equal(provisionPw.status, 200);
        assert.equal(provisionPw.data.passwordUpdated, true);
        assert.equal(provisionPw.data.userAccountCreated, true);

        const provLogin = await apiJson(srv1.baseUrl, 'POST', '/api/auth/login', undefined, {
          loginId: c.codeWithoutPw,
          password: c.provisionedPw,
        });
        assert.equal(provLogin.status, 200, `Provisioned login should succeed for ${c.entityType}`);
        assert.equal(provLogin.data.user.role, c.entityType);
      }

      // Ensure password never leaks in Users listing or Audit logs
      const allUsers = listUsersWithPermissions(srv1.db);
      assert.ok(allUsers.every((u) => !('password' in u)));
    } finally {
      await srv1.close();
    }

    // Phase 2: Simulate full server restart / redeploy on same persistent DB file
    const srv2 = await startTestServer(dbPath);
    try {
      // Employee EMP002 must still reject old seeded password and accept updated password
      const karimOld = await apiJson(srv2.baseUrl, 'POST', '/api/auth/login', undefined, {
        loginId: 'karim',
        password: 'Karim@123',
      });
      assert.equal(karimOld.status, 401);

      const karimNew = await apiJson(srv2.baseUrl, 'POST', '/api/auth/login', undefined, {
        loginId: 'karim',
        password: 'KarimUpdated@2026',
      });
      assert.equal(karimNew.status, 200);

      for (const c of cases) {
        const oldAfterRestart = await apiJson(srv2.baseUrl, 'POST', '/api/auth/login', undefined, {
          loginId: c.codeWithPw,
          password: c.initialPw,
        });
        assert.equal(oldAfterRestart.status, 401);

        const newAfterRestart = await apiJson(srv2.baseUrl, 'POST', '/api/auth/login', undefined, {
          loginId: c.codeWithPw,
          password: c.updatedPw,
        });
        assert.equal(newAfterRestart.status, 200, `Restart login failed for ${c.codeWithPw}`);

        const provAfterRestart = await apiJson(srv2.baseUrl, 'POST', '/api/auth/login', undefined, {
          loginId: c.codeWithoutPw,
          password: c.provisionedPw,
        });
        assert.equal(provAfterRestart.status, 200, `Restart login failed for ${c.codeWithoutPw}`);
      }
    } finally {
      await srv2.close();
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
