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

test('Upgrades 1-15: Bulk imports, manual Vendor/Expense codes, Masters, Policy visibility, Visitor analytics, Interchangeable conversion, Attendance register, Theme & Concurrent Multi-Role Load', async () => {
  const { db, baseUrl, close } = await startTestServer();
  try {
    // 0. Login as Super Admin
    const adminLogin = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'admin',
      password: '71537(Lost{MacalliceRost@$$@MoonCrypto}Verse)17571',
    });
    assert.equal(adminLogin.status, 200);
    const adminToken = adminLogin.data.token as string;

    // -----------------------------------------------------------------------
    // 1. Bulk Directory CSV Imports (Consultant & Vendor)
    // -----------------------------------------------------------------------
    const conCsv = [
      'Entity Code,Name,Email,Phone,Center,Department,Designation,Status',
      'CON101,Dr. Meera Nair,meera.con@median.in,9830099111,Kolkata,Research,Lead Consultant,Active',
      'CON102,Arindam Roy,arindam.con@median.in,9830099222,Mumbai,Field Operations,Field Consultant,Active',
      'bad-code!,Invalid Code,bad@median.in,9000000000,Kolkata,Research,Consultant,Active',
    ].join('\n');

    const conImport = await apiJson(baseUrl, 'POST', '/api/entities/bulk-import', adminToken, {
      entityType: 'Consultant',
      csvText: conCsv,
      duplicatePolicy: 'skip',
    });
    assert.equal(conImport.status, 201);
    assert.equal(conImport.data.createdCount, 2);
    assert.equal(conImport.data.failedCount, 1);

    // -----------------------------------------------------------------------
    // 2. Manual Vendor Code + Duplicate Conflict Guard + Vendor Bulk Import
    // -----------------------------------------------------------------------
    const vMissingId = await apiJson(baseUrl, 'POST', '/api/vendors', adminToken, {
      id: '',
      name: 'Missing Code Vendor',
    });
    assert.equal(vMissingId.status, 400);

    const vCreated = await apiJson(baseUrl, 'POST', '/api/vendors', adminToken, {
      id: 'vnd-kol-01',
      name: 'Eastern Infotech Supplies',
      contactPerson: 'Suman Dutta',
      phone: '9830011220',
      email: 'sales@easterninfo.in',
      address: 'Salt Lake Sector V, Kolkata',
      gst: '19AABCE1234F1Z5',
    });
    assert.equal(vCreated.status, 201);
    assert.equal(vCreated.data.vendor.id, 'VND-KOL-01');

    const vDuplicate = await apiJson(baseUrl, 'POST', '/api/vendors', adminToken, {
      id: 'VND-KOL-01',
      name: 'Duplicate Vendor',
    });
    assert.equal(vDuplicate.status, 409);

    const vendorCsv = [
      'Vendor Code,Vendor Name,Contact Person,Phone,Email,Address,GSTIN',
      'VND-MUM-02,Apex Peripherals,Rohan Kulkarni,9820011223,billing@apex.in,Andheri East Mumbai,27AAACA1234B1Z2',
      'VND-KOL-01,Duplicate Skip,Should Skip,9000000001,skip@easterninfo.in,Kolkata,19AABCE1234F1Z5',
    ].join('\n');
    const vImport = await apiJson(baseUrl, 'POST', '/api/vendors/bulk-import', adminToken, {
      csvText: vendorCsv,
      duplicatePolicy: 'skip',
    });
    assert.equal(vImport.status, 201);
    assert.equal(vImport.data.createdCount, 1);
    assert.equal(vImport.data.skippedCount, 1);

    // -----------------------------------------------------------------------
    // 3. Expense Category Master, Payment Mode Master & Manual Expense Number
    // -----------------------------------------------------------------------
    const catCreate = await apiJson(baseUrl, 'POST', '/api/expense-categories', adminToken, {
      name: 'Field Tablet Sim Recharge',
      description: 'Monthly 4G data plans for fieldwork tablets',
      active: true,
    });
    assert.equal(catCreate.status, 201);
    const catId = catCreate.data.category.id as string;

    const modeCreate = await apiJson(baseUrl, 'POST', '/api/payment-modes', adminToken, {
      name: 'Corporate UPI',
      description: 'Median corporate UPI handle',
      active: true,
    });
    assert.equal(modeCreate.status, 201);
    const modeId = modeCreate.data.mode.id as string;

    const expCreated = await apiJson(baseUrl, 'POST', '/api/expenses', adminToken, {
      id: 'exp-2026-091',
      date: '2026-04-10',
      category: 'Field Tablet Sim Recharge',
      paidTo: 'Airtel Business',
      amount: 4500,
      mode: 'Corporate UPI',
      remarks: '15 SIM recharges for Kolkata survey',
    });
    assert.equal(expCreated.status, 201);
    assert.equal(expCreated.data.expense.id, 'EXP-2026-091');

    // Duplicate manual expense number -> 409
    const expDup = await apiJson(baseUrl, 'POST', '/api/expenses', adminToken, {
      id: 'EXP-2026-091',
      date: '2026-04-11',
      category: 'Field Tablet Sim Recharge',
      paidTo: 'Jio Business',
      amount: 1200,
      mode: 'Corporate UPI',
    });
    assert.equal(expDup.status, 409);

    // Deleting category in use -> 409 conflict
    const catDelBlocked = await apiJson(
      baseUrl,
      'DELETE',
      `/api/expense-categories/${catId}`,
      adminToken
    );
    assert.equal(catDelBlocked.status, 409);

    // Deactivate Payment Mode -> new expense using inactive mode must fail 400
    const modeDeact = await apiJson(
      baseUrl,
      'PUT',
      `/api/payment-modes/${modeId}/toggle`,
      adminToken,
      { active: false }
    );
    assert.equal(modeDeact.status, 200);
    assert.equal(modeDeact.data.mode.active, false);

    const expInactiveMode = await apiJson(baseUrl, 'POST', '/api/expenses', adminToken, {
      id: 'EXP-2026-092',
      date: '2026-04-11',
      category: 'Field Tablet Sim Recharge',
      paidTo: 'Airtel Business',
      amount: 500,
      mode: 'Corporate UPI',
    });
    assert.equal(expInactiveMode.status, 400);

    // Unused category can be created, edited, and deleted cleanly
    const tempCat = await apiJson(baseUrl, 'POST', '/api/expense-categories', adminToken, {
      name: 'Temp Courier',
    });
    assert.equal(tempCat.status, 201);
    const tempCatEdit = await apiJson(
      baseUrl,
      'PUT',
      `/api/expense-categories/${tempCat.data.category.id}`,
      adminToken,
      { name: 'Temp SpeedPost', description: 'Updated desc' }
    );
    assert.equal(tempCatEdit.status, 200);
    assert.equal(tempCatEdit.data.category.name, 'Temp SpeedPost');
    const tempCatDel = await apiJson(
      baseUrl,
      'DELETE',
      `/api/expense-categories/${tempCat.data.category.id}`,
      adminToken
    );
    assert.equal(tempCatDel.status, 200);

    // -----------------------------------------------------------------------
    // 4. Create login users across all 6 roles & verify Company Policy Visibility
    // -----------------------------------------------------------------------
    const samplePdfBase64 = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF').toString('base64');
    const scopedPolicy = await apiJson(baseUrl, 'POST', '/api/policies', adminToken, {
      category: 'Company Policy',
      title: 'Field Consultant & Freelancer Honorarium Policy',
      description: 'Applies strictly to Consultants and Freelancers only.',
      version: '1.0',
      fileName: 'Field-Honorarium-Policy.pdf',
      contentBase64: samplePdfBase64,
      visibleRoles: ['Consultant', 'Freelancer'],
    });
    assert.equal(scopedPolicy.status, 201);
    assert.deepEqual(scopedPolicy.data.policy.visibleRoles, ['Consultant', 'Freelancer']);
    const scopedPolicyId = scopedPolicy.data.policy.id as string;

    // Create entities with logins for all 5 non-employee categories + 1 Employee login
    const conUserRes = await apiJson(baseUrl, 'POST', '/api/entities', adminToken, {
      entityType: 'Consultant',
      entityCode: 'CON201',
      name: 'Consultant One',
      email: 'con201@median.in',
      center: 'Kolkata',
      password: 'Role@12345',
    });
    assert.equal(conUserRes.status, 201);

    const retUserRes = await apiJson(baseUrl, 'POST', '/api/entities', adminToken, {
      entityType: 'Retainer',
      entityCode: 'RET201',
      name: 'Retainer One',
      email: 'ret201@median.in',
      center: 'Mumbai',
      password: 'Role@12345',
    });
    assert.equal(retUserRes.status, 201);

    const frlUserRes = await apiJson(baseUrl, 'POST', '/api/entities', adminToken, {
      entityType: 'Freelancer',
      entityCode: 'FRL201',
      name: 'Freelancer One',
      email: 'frl201@median.in',
      phone: '9831100201',
      center: 'Kolkata',
      password: 'Role@12345',
    });
    assert.equal(frlUserRes.status, 201);

    const yrpUserRes = await apiJson(baseUrl, 'POST', '/api/entities', adminToken, {
      entityType: 'Young Research Program',
      entityCode: 'YRP201',
      name: 'YRP Scholar',
      email: 'yrp201@median.in',
      center: 'New Delhi',
      password: 'Role@12345',
    });
    assert.equal(yrpUserRes.status, 201);

    const intUserRes = await apiJson(baseUrl, 'POST', '/api/entities', adminToken, {
      entityType: 'Intern',
      entityCode: 'INT201',
      name: 'Intern Scholar',
      email: 'int201@median.in',
      center: 'Bengaluru',
      password: 'Role@12345',
    });
    assert.equal(intUserRes.status, 201);

    const empUserCreate = await apiJson(baseUrl, 'POST', '/api/users', adminToken, {
      loginId: 'emp001.portal',
      password: 'Role@12345',
      fullName: 'Employee Portal User',
      email: 'emp001.portal@median.in',
      roleId: 'role_employee',
      employeeId: 'EMP001',
      department: 'IT',
      active: true,
    });
    assert.equal(empUserCreate.status, 201);

    // Concurrent multi-role logins
    const roleLogins = await Promise.all([
      apiJson(baseUrl, 'POST', '/api/auth/login', undefined, { loginId: 'admin', password: '71537(Lost{MacalliceRost@$$@MoonCrypto}Verse)17571', visitorKey: 'v-admin' }),
      apiJson(baseUrl, 'POST', '/api/auth/login', undefined, { loginId: 'emp001.portal', password: 'Role@12345', visitorKey: 'v-emp' }),
      apiJson(baseUrl, 'POST', '/api/auth/login', undefined, { loginId: 'CON201', password: 'Role@12345', visitorKey: 'v-con' }),
      apiJson(baseUrl, 'POST', '/api/auth/login', undefined, { loginId: 'RET201', password: 'Role@12345', visitorKey: 'v-ret' }),
      apiJson(baseUrl, 'POST', '/api/auth/login', undefined, { loginId: 'FRL201', password: 'Role@12345', visitorKey: 'v-frl' }),
      apiJson(baseUrl, 'POST', '/api/auth/login', undefined, { loginId: 'YRP201', password: 'Role@12345', visitorKey: 'v-yrp' }),
      apiJson(baseUrl, 'POST', '/api/auth/login', undefined, { loginId: 'INT201', password: 'Role@12345', visitorKey: 'v-int' }),
    ]);

    for (const r of roleLogins) {
      assert.equal(r.status, 200);
    }

    const [
      admTok,
      empTok,
      conTok,
      retTok,
      frlTok,
      yrpTok,
      intTok,
    ] = roleLogins.map((r) => r.data.token as string);

    // Authorized roles see the scoped Company Policy; unauthorized roles get filtered out & 403 on file/ack
    const [conPol, frlPol, retPol, yrpPol, intPol, empPol] = await Promise.all([
      apiJson(baseUrl, 'GET', '/api/policies', conTok),
      apiJson(baseUrl, 'GET', '/api/policies', frlTok),
      apiJson(baseUrl, 'GET', '/api/policies', retTok),
      apiJson(baseUrl, 'GET', '/api/policies', yrpTok),
      apiJson(baseUrl, 'GET', '/api/policies', intTok),
      apiJson(baseUrl, 'GET', '/api/policies', empTok),
    ]);

    assert.ok(conPol.data.policies.some((p: { id: string }) => p.id === scopedPolicyId));
    assert.ok(frlPol.data.policies.some((p: { id: string }) => p.id === scopedPolicyId));
    assert.ok(!retPol.data.policies.some((p: { id: string }) => p.id === scopedPolicyId));
    assert.ok(!yrpPol.data.policies.some((p: { id: string }) => p.id === scopedPolicyId));
    assert.ok(!intPol.data.policies.some((p: { id: string }) => p.id === scopedPolicyId));
    assert.ok(!empPol.data.policies.some((p: { id: string }) => p.id === scopedPolicyId));

    const retAckDenied = await apiJson(baseUrl, 'POST', `/api/policies/${scopedPolicyId}/acknowledge`, retTok);
    assert.equal(retAckDenied.status, 403);
    const conAckOk = await apiJson(baseUrl, 'POST', `/api/policies/${scopedPolicyId}/acknowledge`, conTok);
    assert.equal(conAckOk.status, 200);

    // -----------------------------------------------------------------------
    // 5. Visitor Analytics Deduplication & Live Presence
    // -----------------------------------------------------------------------
    await apiJson(baseUrl, 'POST', '/api/analytics/visit', undefined, { visitorKey: 'browser-guest-1' });
    const vFirst = await apiJson(baseUrl, 'GET', '/api/analytics/visitors', admTok);
    assert.equal(vFirst.status, 200);
    const baselineToday = vFirst.data.summary.todayVisitors;
    assert.ok(baselineToday >= 8); // 7 users + 1 guest
    assert.ok(vFirst.data.summary.loggedInUsers >= 7);
    assert.ok(vFirst.data.summary.onlineUsers >= 7);

    // Repeating same visitorKey same day must NOT inflate todayVisitors / totalVisitors
    await apiJson(baseUrl, 'POST', '/api/analytics/visit', undefined, { visitorKey: 'browser-guest-1' });
    const vAfterDup = await apiJson(baseUrl, 'GET', '/api/analytics/visitors', admTok);
    assert.equal(vAfterDup.data.summary.todayVisitors, baselineToday);

    // Logging out Intern must decrement loggedInUsers & onlineUsers
    const intLogout = await apiJson(baseUrl, 'POST', '/api/auth/logout', intTok);
    assert.equal(intLogout.status, 200);
    const vAfterLogout = await apiJson(baseUrl, 'GET', '/api/analytics/visitors', admTok);
    assert.equal(vAfterLogout.data.summary.loggedInUsers, vFirst.data.summary.loggedInUsers - 1);

    // -----------------------------------------------------------------------
    // 6. Interchangeable Employment Model (Preserving profileId & History)
    // -----------------------------------------------------------------------
    // Convert INT201 (Intern) -> Young Research Program -> Consultant -> Employee
    const cnv1 = await apiJson(baseUrl, 'POST', '/api/workforce/convert', admTok, {
      sourceCategory: 'Intern',
      sourceId: 'INT201',
      targetCategory: 'Young Research Program',
      newCode: 'YRP901',
      department: 'Research',
      designation: 'Research Associate',
      reason: 'Completed internship with distinction',
    });
    assert.equal(cnv1.status, 201);
    assert.equal(cnv1.data.targetCode, 'YRP901');
    const originalProfileId = cnv1.data.conversion.profileId as string;
    assert.ok(originalProfileId.startsWith('PRF-'));

    const cnv2 = await apiJson(baseUrl, 'POST', '/api/workforce/convert', admTok, {
      sourceCategory: 'Young Research Program',
      sourceId: 'YRP901',
      targetCategory: 'Consultant',
      newCode: 'CON901',
      reason: 'Promoted to Consultant role',
    });
    assert.equal(cnv2.status, 201);
    assert.equal(cnv2.data.conversion.profileId, originalProfileId);

    // Assign AST0201 or create asset and sub-assign/assign before final conversion to Employee
    const cnv3 = await apiJson(baseUrl, 'POST', '/api/workforce/convert', admTok, {
      sourceCategory: 'Consultant',
      sourceId: 'CON901',
      targetCategory: 'Employee',
      newCode: '00901',
      department: 'Research',
      designation: 'Research Analyst',
      reason: 'Confirmed full-time payroll',
    });
    assert.equal(cnv3.status, 201);
    assert.equal(cnv3.data.targetCode, 'EMP-00901');
    assert.equal(cnv3.data.conversion.profileId, originalProfileId);

    const conversionsList = await apiJson(baseUrl, 'GET', '/api/workforce/conversions', admTok);
    assert.equal(conversionsList.status, 200);
    const chain = conversionsList.data.conversions.filter(
      (c: { profileId: string }) => c.profileId === originalProfileId
    );
    assert.equal(chain.length, 3);

    // -----------------------------------------------------------------------
    // 7. Monthly Attendance Register (Late > 09:30, Early Exit < 18:00, Overtime > 8h)
    // -----------------------------------------------------------------------
    const attMonth = '2026-04';
    // Normal day 2026-04-06 (Monday): 09:15 - 18:15 (9h = +60m overtime, not late, not early exit)
    const attNormal = await apiJson(baseUrl, 'POST', '/api/attendance', admTok, {
      employeeId: 'EMP-00901',
      attendanceDate: '2026-04-06',
      status: 'Present',
      checkInTime: '09:15',
      checkOutTime: '18:15',
      remarks: 'Full shift + 1h OT',
    });
    assert.equal(attNormal.status, 201);

    // Late + Early Exit day 2026-04-07 (Tuesday): 10:00 - 17:00 (30m late, 60m early exit, 7h worked)
    const attLateEarly = await apiJson(baseUrl, 'POST', '/api/attendance', admTok, {
      employeeId: 'EMP-00901',
      attendanceDate: '2026-04-07',
      status: 'Present',
      checkInTime: '10:00',
      checkOutTime: '17:00',
      remarks: 'Traffic delay & personal errand',
    });
    assert.equal(attLateEarly.status, 201);

    const regRes = await apiJson(
      baseUrl,
      'GET',
      `/api/attendance/register?month=${attMonth}&employeeId=EMP-00901`,
      admTok
    );
    assert.equal(regRes.status, 200);
    assert.equal(regRes.data.register.rows.length, 1);
    const empReg = regRes.data.register.rows[0];
    assert.equal(empReg.presentDays, 2);
    assert.equal(empReg.lateDays, 1);
    assert.equal(empReg.earlyExitCount, 1);
    assert.equal(empReg.totalWorkHours, 16);
    assert.equal(empReg.overtimeHours, 1);
    assert.equal(regRes.data.register.summary.totalLateArrivals, 1);
    assert.equal(regRes.data.register.summary.totalEarlyExits, 1);

    // -----------------------------------------------------------------------
    // 8. Theme Preference Persistence Across All 4 Palettes
    // -----------------------------------------------------------------------
    for (const themeName of ['Emerald Green', 'Royal Purple', 'Dark Mode', 'Corporate Blue']) {
      const th = await apiJson(baseUrl, 'PUT', '/api/auth/theme', empTok, { theme: themeName });
      assert.equal(th.status, 200);
      assert.equal(th.data.theme, themeName);
      assert.equal(th.data.user.themePreference, themeName);
    }
    const meAfterTheme = await apiJson(baseUrl, 'GET', '/api/auth/me', empTok);
    assert.equal(meAfterTheme.status, 200);
    assert.equal(meAfterTheme.data.user.themePreference, 'Corporate Blue');

    // Legacy theme input normalizes cleanly to Corporate Blue
    const legacyTheme = await apiJson(baseUrl, 'PUT', '/api/auth/theme', empTok, {
      theme: 'Classic Olive',
    });
    assert.equal(legacyTheme.status, 200);
    assert.equal(legacyTheme.data.theme, 'Corporate Blue');

    // -----------------------------------------------------------------------
    // 9. Concurrent Multi-Role Load Burst (Zero 500s, < 3000ms batch)
    // -----------------------------------------------------------------------
    const activeTokens = [admTok, empTok, conTok, retTok, frlTok, yrpTok];
    const startMs = Date.now();
    const burstReqs: Promise<{ status: number; data: unknown }>[] = [];
    for (let round = 0; round < 5; round++) {
      for (const tok of activeTokens) {
        burstReqs.push(apiJson(baseUrl, 'GET', '/api/workspace/state', tok));
        burstReqs.push(apiJson(baseUrl, 'GET', '/api/policies', tok));
        burstReqs.push(apiJson(baseUrl, 'GET', '/api/analytics/visitors', tok));
        burstReqs.push(apiJson(baseUrl, 'POST', '/api/analytics/heartbeat', tok, { visitorKey: `burst-${round}` }));
      }
    }
    const burstResults = await Promise.all(burstReqs);
    const elapsedMs = Date.now() - startMs;
    assert.ok(burstResults.length === 120);
    for (const res of burstResults) {
      assert.equal(res.status, 200, `Unexpected non-200 status in concurrent burst: ${res.status}`);
    }
    assert.ok(elapsedMs < 5000, `Concurrent 120-request multi-role burst took too long: ${elapsedMs}ms`);
  } finally {
    await close();
    db.close();
  }
});
