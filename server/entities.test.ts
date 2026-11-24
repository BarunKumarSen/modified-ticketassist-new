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

test('Personnel entities ID validation, Consultant manager toggle + team building, IT Policy acknowledgments, hierarchical sub-assignments, Freelancer allotment, and ticketing', async () => {
  const { db, baseUrl, close } = await startTestServer();
  try {
    // 1. Login as Super Admin
    const adminLogin = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'admin',
      password: '71537(Lost{MacalliceRost@$$@MoonCrypto}Verse)17571',
    });
    assert.equal(adminLogin.status, 200);
    const adminToken = adminLogin.data.token as string;

    // 2. Global ID Validation: must reject non-alphanumeric or >10 char IDs across new modules
    for (const badCode of ['abc-1', 'TOOLONGID123', 'emp_1', 'A B']) {
      const badRes = await apiJson(baseUrl, 'POST', '/api/entities', adminToken, {
        entityType: 'Consultant',
        entityCode: badCode,
        name: 'Invalid Code Test',
        email: 'bad@median.in',
      });
      assert.equal(badRes.status, 400, `Expected 400 for invalid code "${badCode}"`);
    }

    // 3. Create Consultant with lowercase input (auto-uppercased to CON001) + login password
    const conRes = await apiJson(baseUrl, 'POST', '/api/entities', adminToken, {
      entityType: 'Consultant',
      entityCode: 'con001',
      name: 'Dr. Ananya Sen',
      email: 'ananya.con@median.in',
      phone: '9830011223',
      center: 'Kolkata',
      department: 'Research',
      designation: 'Principal Consultant',
      password: 'Con@12345',
    });
    assert.equal(conRes.status, 201);
    assert.equal(conRes.data.entity.entityCode, 'CON001');
    assert.equal(conRes.data.entity.entityType, 'Consultant');
    assert.equal(conRes.data.entity.isManager, false);

    // Create Retainer, YRP, Intern
    const retRes = await apiJson(baseUrl, 'POST', '/api/entities', adminToken, {
      entityType: 'Retainer',
      entityCode: 'RET01',
      name: 'Vikram Bose',
      email: 'vikram.ret@median.in',
      center: 'Mumbai',
    });
    assert.equal(retRes.status, 201);
    assert.equal(retRes.data.entity.entityCode, 'RET01');

    const yrpRes = await apiJson(baseUrl, 'POST', '/api/entities', adminToken, {
      entityType: 'Young Research Program',
      entityCode: 'YRP01',
      name: 'Riya Kapoor',
      email: 'riya.yrp@median.in',
      center: 'New Delhi',
    });
    assert.equal(yrpRes.status, 201);

    const intRes = await apiJson(baseUrl, 'POST', '/api/entities', adminToken, {
      entityType: 'Intern',
      entityCode: 'INT01',
      name: 'Karan Mehta',
      email: 'karan.int@median.in',
      center: 'Bengaluru',
    });
    assert.equal(intRes.status, 201);

    // Create Freelancer (FLP) with full onboarding details + login
    const flpRes = await apiJson(baseUrl, 'POST', '/api/entities', adminToken, {
      entityType: 'Freelancer',
      entityCode: 'KOL000001',
      name: 'Subhankar Paul',
      email: 'subhankar.flp@median.in',
      phone: '9831122334',
      whatsappNo: '9831122334',
      fatherHusbandName: 'Biplab Paul',
      address: '14/2 Salt Lake Sector 2, Kolkata - 700091',
      aadhaarCard: '123456789012',
      panCard: 'ABCDE1234F',
      center: 'Kolkata',
      department: 'Field Operations',
      projectName: 'Urban Mobility Survey',
      projectNo: 'PROJ-2026-88',
      eicName: 'Rajesh Sharma',
      bankName: 'HDFC Bank',
      bankBranch: 'Salt Lake Sector V',
      bankAccountType: 'Savings',
      bankAccountNo: '50100099887766',
      ifscCode: 'HDFC0000123',
      password: 'Flp@12345',
    });
    assert.equal(flpRes.status, 201);
    assert.equal(flpRes.data.entity.entityCode, 'KOL000001');
    assert.equal(flpRes.data.entity.entityType, 'Freelancer');

    // 4. Consultant Manager toggle ON (without changing role from Consultant) + Team building
    const grantMgr = await apiJson(
      baseUrl,
      'PUT',
      '/api/entities/CON001/manager-toggle',
      adminToken,
      { isManager: true }
    );
    assert.equal(grantMgr.status, 200);
    assert.equal(grantMgr.data.entity.entityType, 'Consultant');
    assert.equal(grantMgr.data.entity.isManager, true);

    const conLogin = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'CON001',
      password: 'Con@12345',
    });
    assert.equal(conLogin.status, 200);
    assert.equal(conLogin.data.user.role, 'Consultant');
    assert.equal(conLogin.data.user.isManager, true);
    const conToken = conLogin.data.token as string;

    // Assign EMP001 to Consultant-Manager team
    const teamAssign = await apiJson(baseUrl, 'POST', '/api/team/assign', conToken, {
      managerId: 'CON001',
      addEmployeeIds: ['EMP001'],
    });
    assert.equal(teamAssign.status, 200);
    assert.equal(teamAssign.data.updatedCount, 1);

    const teamView = await apiJson(baseUrl, 'GET', '/api/team/members', conToken);
    assert.equal(teamView.status, 200);
    assert.ok(teamView.data.members.some((m: { id: string }) => m.id === 'EMP001'));

    // Revoking Manager rights while EMP001 reports to CON001 must return 409 conflict unless forceUnassign
    const revokeBlocked = await apiJson(
      baseUrl,
      'PUT',
      '/api/entities/CON001/manager-toggle',
      adminToken,
      { isManager: false }
    );
    assert.equal(revokeBlocked.status, 409);
    assert.equal(revokeBlocked.data.activeReportCount, 1);

    const revokeForced = await apiJson(
      baseUrl,
      'PUT',
      '/api/entities/CON001/manager-toggle',
      adminToken,
      { isManager: false, forceUnassign: true }
    );
    assert.equal(revokeForced.status, 200);
    assert.equal(revokeForced.data.entity.isManager, false);

    // 5. IT Policy seeded alongside HR Policy & POSH Policy + Acknowledgment across new roles
    const polRes = await apiJson(baseUrl, 'GET', '/api/policies', conToken);
    assert.equal(polRes.status, 200);
    const itPolicy = polRes.data.policies.find((p: { category: string }) => p.category === 'IT Policy');
    assert.ok(itPolicy, 'Default IT Policy must be seeded');
    assert.ok(polRes.data.policies.some((p: { category: string }) => p.category === 'HR Policy'));
    assert.ok(polRes.data.policies.some((p: { category: string }) => p.category === 'POSH Policy'));

    const flpLogin = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'KOL000001',
      password: 'Flp@12345',
    });
    assert.equal(flpLogin.status, 200);
    assert.equal(flpLogin.data.user.role, 'Freelancer');
    const flpToken = flpLogin.data.token as string;

    const ackCon = await apiJson(
      baseUrl,
      'POST',
      `/api/policies/${itPolicy.id}/acknowledge`,
      conToken
    );
    assert.equal(ackCon.status, 200);
    const ackFlp = await apiJson(
      baseUrl,
      'POST',
      `/api/policies/${itPolicy.id}/acknowledge`,
      flpToken
    );
    assert.equal(ackFlp.status, 200);

    const ackList = await apiJson(
      baseUrl,
      'GET',
      `/api/policies/acknowledgments?policyId=${itPolicy.id}`,
      adminToken
    );
    assert.equal(ackList.status, 200);
    assert.equal(ackList.data.acknowledgments.length, 2);

    // 6. Asset creation with extended fields + Primary Assignment -> Sub-Assignment -> Allotment -> Return Chain
    const astRes = await apiJson(baseUrl, 'POST', '/api/assets', adminToken, {
      id: 'TAB9001',
      name: 'Samsung Galaxy Tab A9',
      category: 'Tablet',
      brand: 'Samsung',
      model: 'SM-X210',
      rmnNumber: 'RMN-881',
      partNumber: 'PN-4402',
      serial: 'SN-TAB-9001',
      eanNumber: '8806095123456',
      imei1: '351234567890123',
      imei2: '351234567890124',
      snidNumber: 'SNID-9910',
      purchaseDate: '2026-01-15',
      cost: 22500,
      vendor: 'TechSource India',
      vendorSupplierName: 'TechSource India Pvt Ltd',
      invoiceNumber: 'INV-2026-501',
      warrantyExpiry: '2028-01-15',
      department: 'Field Operations',
      location: 'Kolkata',
      condition: 'New',
      status: 'Available',
    });
    assert.equal(astRes.status, 201);
    assert.equal(astRes.data.asset.id, 'TAB9001');
    assert.equal(astRes.data.asset.imei1, '351234567890123');

    // Primary assign to EMP001
    const priRes = await apiJson(baseUrl, 'POST', '/api/assignments', adminToken, {
      assetId: 'TAB9001',
      employeeId: 'EMP001',
      assignDate: '2026-03-01',
      condition: 'Good',
      notes: 'Primary custodian for Eastern fieldwork',
    });
    assert.equal(priRes.status, 201);
    assert.equal(priRes.data.asset.status, 'Assigned');
    assert.equal(priRes.data.assignment.custodyLevel, 'Primary');

    // EMP001 login attempts Sub-Assign to Freelancer WITHOUT Allotment -> MUST FAIL 400
    // First find or create EMP001 login user
    const empUserRes = await apiJson(baseUrl, 'POST', '/api/users', adminToken, {
      loginId: 'emp001.user',
      password: 'Emp@12345',
      fullName: 'EMP001 Custodian',
      email: 'emp001.custodian@median.in',
      roleId: 'role_employee',
      employeeId: 'EMP001',
      department: 'IT',
      active: true,
    });
    assert.equal(empUserRes.status, 201);
    const empLogin = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'emp001.user',
      password: 'Emp@12345',
    });
    assert.equal(empLogin.status, 200);
    const empToken = empLogin.data.token as string;

    const subMissingAllotment = await apiJson(baseUrl, 'POST', '/api/sub-assignments', empToken, {
      assetId: 'TAB9001',
      assigneeId: 'KOL000001',
      assigneeType: 'Freelancer',
      assignDate: '2026-03-02',
    });
    assert.equal(subMissingAllotment.status, 400);

    // Sub-Assign WITH completed Freelancer Allotment Form -> MUST SUCCEED
    const subOk = await apiJson(baseUrl, 'POST', '/api/sub-assignments', empToken, {
      assetId: 'TAB9001',
      assigneeId: 'KOL000001',
      assigneeType: 'Freelancer',
      assignDate: '2026-03-02',
      condition: 'Good',
      notes: 'Issued for Kolkata fieldwork',
      allotment: {
        flpId: 'KOL000001',
        flpName: 'Subhankar Paul',
        flpCode: 'KOL000001',
        flpAddress: '14/2 Salt Lake Sector 2, Kolkata - 700091',
        aadhaarNo: '123456789012',
        panNo: 'ABCDE1234F',
        mobileNo: '9831122334',
        centerName: 'Kolkata',
        executiveName: 'EMP001 Custodian',
        executiveEmpId: 'EMP001',
        jobNumber: 'PROJ-2026-88',
        issueDate: '2026-03-02',
        accessories: [
          { name: 'Power Adaptor / Charger', qty: 1 },
          { name: 'SIM Card', qty: 1 },
          { name: 'Tablet Flip cover', qty: 1 },
        ],
        remarks: 'Checked screen & battery',
      },
    });
    assert.equal(subOk.status, 201);
    assert.equal(subOk.data.assignment.custodyLevel, 'Sub-Assigned');
    assert.ok(subOk.data.allotment?.id);
    assert.ok(
      subOk.data.allotment.centerAddress.includes('Stesalit Towers'),
      'Kolkata official Stesalit Towers address must auto-populate'
    );
    assert.equal(subOk.data.allotment.centerPhone, '+91 33 4073 1137');

    // Double sub-assignment must be blocked
    const doubleSub = await apiJson(baseUrl, 'POST', '/api/sub-assignments', empToken, {
      assetId: 'TAB9001',
      assigneeId: 'RET01',
      assigneeType: 'Retainer',
      assignDate: '2026-03-03',
    });
    assert.equal(doubleSub.status, 400);

    // Returning Primary while Sub-Assigned must be blocked
    const returnPrimaryBlocked = await apiJson(baseUrl, 'POST', '/api/returns', adminToken, {
      assetId: 'TAB9001',
      employeeId: 'EMP001',
      date: '2026-03-05',
      condition: 'Good',
      damage: 'No Damage',
      remarks: 'Attempted premature return',
    });
    assert.equal(returnPrimaryBlocked.status, 400);

    // 7. Freelancer raises Support Ticket for sub-assigned TAB9001 & confirms Admin Work Order
    const ticketRes = await apiJson(baseUrl, 'POST', '/api/tickets', flpToken, {
      assetId: 'TAB9001',
      subject: 'Tablet SIM APN Not Connecting',
      description: 'Field survey app cannot reach server on SIM data.',
      priority: 'High',
    });
    assert.equal(ticketRes.status, 201);
    assert.equal(ticketRes.data.ticket.employeeId, 'KOL000001');
    const ticketId = ticketRes.data.ticket.id as string;

    const tomorrowDate = new Date(Date.now() + 2 * 86400_000).toISOString().split('T')[0];
    const workOrderRes = await apiJson(
      baseUrl,
      'POST',
      `/api/tickets/${ticketId}/work-order`,
      adminToken,
      {
        workOrderDate: tomorrowDate,
        workOrderStartTime: '11:00',
        workOrderDurationMins: 30,
      }
    );
    assert.equal(workOrderRes.status, 200);
    assert.equal(workOrderRes.data.ticket.status, 'Approved');

    const confirmRes = await apiJson(
      baseUrl,
      'POST',
      `/api/tickets/${ticketId}/confirm`,
      flpToken
    );
    assert.equal(confirmRes.status, 200);
    assert.equal(confirmRes.data.ticket.employeeConfirmed, true);

    // 8. Return Sub-Assignment -> restores custody to Primary (Asset remains Assigned) -> Return Primary -> Asset becomes Available
    const subReturnRes = await apiJson(
      baseUrl,
      'POST',
      `/api/sub-assignments/${subOk.data.assignment.id}/return`,
      empToken,
      { date: '2026-03-15', condition: 'Good', damage: 'No Damage', remarks: 'Fieldwork completed' }
    );
    assert.equal(subReturnRes.status, 201);
    assert.equal(subReturnRes.data.asset.status, 'Assigned');
    assert.equal(subReturnRes.data.asset.dateOfReturn, '2026-03-15');

    const priReturnRes = await apiJson(baseUrl, 'POST', '/api/returns', adminToken, {
      assetId: 'TAB9001',
      employeeId: 'EMP001',
      date: '2026-03-16',
      condition: 'Good',
      damage: 'No Damage',
      remarks: 'Returned to central IT store',
    });
    assert.equal(priReturnRes.status, 201);
    assert.equal(priReturnRes.data.asset.status, 'Available');
    assert.equal(priReturnRes.data.asset.dateOfReturn, '2026-03-16');
  } finally {
    await close();
    db.close();
  }
});
