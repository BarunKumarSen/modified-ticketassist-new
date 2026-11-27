import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, isProductionCleanDatabase } from '../src/db/sqlite.ts';
import {
  createVerifiedDatabaseBackup,
  prepareDatabaseForProduction,
} from '../src/db/productionCleanup.ts';
import { listWorkspaceStateFromDb } from '../src/db/workspaceStore.ts';
import { createApiApp } from './app.ts';
import { SEED_ADMIN_LOGIN_ID, SEED_ADMIN_PASSWORD } from '../src/data/seedData.ts';

async function startTestServer(db: ReturnType<typeof openDatabase>) {
  const app = createApiApp(db, { enableBackgroundWorker: false });
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address() as import('node:net').AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('Production cleanup removes all demo/employee records, preserves config/RBAC, blocks demo re-seeding, and supports fresh onboarding', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assetos-clean-test-'));
  const dbPath = path.join(tempDir, 'assetos.db');

  try {
    // 1. Initialize a seeded database first (simulating pre-cleanup production DB)
    const db1 = openDatabase(dbPath);
    const preEmps = (db1.prepare(`SELECT COUNT(*) as c FROM Employees`).get() as { c: number }).c;
    const preAssets = (db1.prepare(`SELECT COUNT(*) as c FROM Assets`).get() as { c: number }).c;
    const preUsers = (db1.prepare(`SELECT COUNT(*) as c FROM Users`).get() as { c: number }).c;
    assert.ok(preEmps > 0, 'Expected seeded employees before cleanup');
    assert.ok(preAssets > 0, 'Expected seeded assets before cleanup');
    assert.ok(preUsers > 1, 'Expected seeded demo users before cleanup');
    db1.close();

    // 2. Take verified backup BEFORE cleanup
    const backup = createVerifiedDatabaseBackup(dbPath, path.join(tempDir, 'backups'));
    assert.ok(fs.existsSync(backup.backupPath));
    assert.ok(backup.sizeBytes > 0);
    assert.equal(backup.integrity, 'ok');

    // 3. Execute production cleanup
    const db2 = openDatabase(dbPath);
    const report = prepareDatabaseForProduction(db2, {
      backupPath: backup.backupPath,
      backupSizeBytes: backup.sizeBytes,
      backupIntegrity: backup.integrity,
    });
    assert.equal(report.foreignKeyViolations, 0);
    assert.equal(report.integrityCheck, 'ok');
    assert.equal(report.sampleDepartmentsCleared, true);
    assert.equal(isProductionCleanDatabase(db2), true);

    // Verify all employee/demo/operational tables are 0
    for (const tbl of [
      'Employees',
      'Personnel_Entities',
      'Attendance',
      'Attendance_Audit_Logs',
      'Leave_Requests',
      'Workflow_Requests',
      'Approval_Requests',
      'Assets',
      'Assignments',
      'Freelancer_Allotments',
      'Asset_Returns',
      'Asset_Transfers',
      'Maintenance_Records',
      'Disposals',
      'Asset_History',
      'Support_Tickets',
      'Vendors',
      'Expenses',
      'Department_Designations',
      'Attachments',
      'Policy_Acknowledgments',
      'Email_Logs',
      'Email_Audit_Logs',
      'System_Audit_Logs',
      'Site_Visits',
      'User_Presence',
    ]) {
      assert.equal(report.afterCounts[tbl], 0, `Expected ${tbl} to have 0 rows after cleanup`);
    }

    // Verify preserved system configuration, RBAC, policies, and Super Admin
    assert.equal(report.afterCounts.Users, 1);
    assert.ok((report.afterCounts.Roles ?? 0) >= 10);
    assert.ok((report.afterCounts.Permissions ?? 0) >= 15);
    assert.ok((report.afterCounts.Role_Permissions ?? 0) >= 40);
    assert.equal(report.afterCounts.App_Settings, 1);
    assert.equal(report.afterCounts.Mail_Config, 1);
    assert.equal(report.afterCounts.Policies, 3);
    assert.ok((report.afterCounts.Public_Holidays ?? 0) > 0);
    const customHolidaysRemaining = (
      db2.prepare(`SELECT COUNT(*) as c FROM Public_Holidays WHERE COALESCE(is_national, 0) = 0`).get() as { c: number }
    ).c;
    assert.equal(customHolidaysRemaining, 0);
    db2.close();

    // 4. Re-open database (simulating server restart) and verify NO demo data is re-seeded
    const db3 = openDatabase(dbPath);
    const wsState = listWorkspaceStateFromDb(db3, []);
    assert.equal(wsState.assets.length, 0);
    assert.equal(wsState.vendors.length, 0);
    assert.equal(wsState.assignments.length, 0);
    assert.equal(wsState.expenses.length, 0);
    assert.equal(wsState.tickets.length, 0);
    assert.equal(wsState.departments.length, 0);
    assert.equal(wsState.settings.companyName, 'Median Research & Consulting Pvt Ltd');
    assert.equal((db3.prepare(`SELECT COUNT(*) as c FROM Employees`).get() as { c: number }).c, 0);
    assert.equal((db3.prepare(`SELECT COUNT(*) as c FROM Users`).get() as { c: number }).c, 1);

    // 5. Verify HTTP auth & fresh employee/asset onboarding on cleaned DB
    const srv = await startTestServer(db3);
    try {
      // Demo user login must fail
      const demoLoginRes = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginId: 'rahim', password: 'Rahim@123' }),
      });
      assert.equal(demoLoginRes.status, 401);

      // Admin login must succeed
      const adminLoginRes = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginId: SEED_ADMIN_LOGIN_ID, password: SEED_ADMIN_PASSWORD }),
      });
      assert.equal(adminLoginRes.status, 200);
      const { token } = (await adminLoginRes.json()) as { token: string };
      assert.ok(token);

      // Create fresh department, employee, and asset
      const deptRes = await fetch(`${srv.baseUrl}/api/departments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ departmentName: 'Research' }),
      });
      assert.equal(deptRes.status, 201);

      const assetRes = await fetch(`${srv.baseUrl}/api/assets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: 'ThinkPad X1 Carbon',
          category: 'Laptop',
          serial: 'PROD-SN-001',
          cost: 1800,
          department: 'Research',
          location: 'Floor 1',
          condition: 'Good',
          status: 'Available',
        }),
      });
      assert.equal(assetRes.status, 201);

      const wsRes = await fetch(`${srv.baseUrl}/api/workspace/state`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(wsRes.status, 200);
      const wsBody = (await wsRes.json()) as { state: { assets: unknown[]; employees: unknown[]; departments: string[] } };
      assert.equal(wsBody.state.assets.length, 1);
      assert.equal(wsBody.state.employees.length, 0);
      assert.deepEqual(wsBody.state.departments, ['Research']);
    } finally {
      await srv.close();
      db3.close();
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
