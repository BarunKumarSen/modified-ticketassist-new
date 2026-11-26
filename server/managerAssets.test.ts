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

test('Manager & Employee RBAC asset isolation and full Asset Entry template persistence in SQLite', async () => {
  const { db, baseUrl, close } = await startTestServer();
  try {
    const adminLogin = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'admin',
      password: '71537(Lost{MacalliceRost@$$@MoonCrypto}Verse)17571',
    });
    assert.equal(adminLogin.status, 200);
    const adminToken = adminLogin.data.token as string;

    // 1. Create a Manager (Employee portal manager) and 2 direct reports + 1 non-reporting peer
    const mgrRes = await apiJson(baseUrl, 'POST', '/api/employees', adminToken, {
      employeeId: '00700',
      name: 'Manager Rahim',
      personalEmail: 'mgr.rahim.personal@example.com',
      officialEmail: 'mgr.rahim@medianresearch.com',
      personalEmailVerified: true,
      officialEmailVerified: true,
      panCard: 'ABCDE1234F',
      voterIdCard: 'ABC1234567',
      aadhaarCard: '123456789012',
      department: 'Field Ops',
      designation: 'Regional Manager',
      center: 'Kolkata',
      isManager: true,
      password: 'Mgr@12345',
    });
    assert.equal(mgrRes.status, 201);
    const mgrId = mgrRes.data.employee.id as string;

    const subARes = await apiJson(baseUrl, 'POST', '/api/employees', adminToken, {
      employeeId: '00701',
      name: 'Direct Report Alpha',
      personalEmail: 'alpha.personal@example.com',
      officialEmail: 'alpha@medianresearch.com',
      personalEmailVerified: true,
      officialEmailVerified: true,
      panCard: 'ABCDE1235F',
      voterIdCard: 'ABC1234568',
      aadhaarCard: '123456789013',
      department: 'Field Ops',
      designation: 'Field Officer',
      center: 'Kolkata',
      reportingManagerId: mgrId,
      password: 'Emp@12345',
    });
    assert.equal(subARes.status, 201);
    const subAId = subARes.data.employee.id as string;

    const subBRes = await apiJson(baseUrl, 'POST', '/api/employees', adminToken, {
      employeeId: '00702',
      name: 'Direct Report Beta',
      personalEmail: 'beta.personal@example.com',
      officialEmail: 'beta@medianresearch.com',
      personalEmailVerified: true,
      officialEmailVerified: true,
      panCard: 'ABCDE1236F',
      voterIdCard: 'ABC1234569',
      aadhaarCard: '123456789014',
      department: 'Field Ops',
      designation: 'Surveyor',
      center: 'Delhi Center',
      reportingManagerId: mgrId,
      password: 'Emp@12345',
    });
    assert.equal(subBRes.status, 201);
    const subBId = subBRes.data.employee.id as string;

    const peerRes = await apiJson(baseUrl, 'POST', '/api/employees', adminToken, {
      employeeId: '00703',
      name: 'Unrelated Peer',
      personalEmail: 'peer.personal@example.com',
      officialEmail: 'peer@medianresearch.com',
      personalEmailVerified: true,
      officialEmailVerified: true,
      panCard: 'ABCDE1237F',
      voterIdCard: 'ABC1234570',
      aadhaarCard: '123456789015',
      department: 'Field Ops',
      designation: 'Analyst',
      center: 'Mumbai',
      password: 'Emp@12345',
    });
    assert.equal(peerRes.status, 201);
    const peerId = peerRes.data.employee.id as string;

    // 2. Create assets via enhanced Asset Entry endpoint including all 33 fields + 6 person assignment fields
    const mgrAssetRes = await apiJson(baseUrl, 'POST', '/api/assets', adminToken, {
      id: 'AST7001',
      name: 'Manager MacBook Pro',
      category: 'Laptop',
      brand: 'Apple',
      model: 'M3 Pro',
      serial: 'SN-MGR-7001',
      department: 'Field Ops',
      location: 'Kolkata Center',
      status: 'Assigned',
      condition: 'New',
      cost: 185000,
      currentValue: 185000,
      rmnNumber: 'RMN-7001',
      partNumber: 'PN-7001',
      eanNumber: '8901000007001',
      imei1: '111111111117001',
      imei2: '222222222227001',
      snidNumber: 'SNID-7001',
      purchaseDate: '2026-03-01',
      vendor: 'Dell India',
      vendorSupplierName: 'Apple Enterprise Direct',
      invoiceNumber: 'INV-7001',
      warrantyMonths: 36,
      warrantyExpiry: '2029-03-01',
      projectName: 'Core Leadership',
      projectNo: 'JOB-7001',
      eicName: 'Manager Rahim',
      assignedFlp: '',
      flpId: '',
      dateOfIssue: '2026-03-05',
      dateOfReturn: '',
      accessoriesIssued: 'MagSafe Charger, USB-C Hub',
      lastVerificationDate: '2026-04-01',
      remarks: 'Manager primary workstation',
      employeeName: 'Manager Rahim',
      consultantName: '',
      retainerName: '',
      freelancerName: '',
      yrpName: '',
      internName: '',
    });
    assert.equal(mgrAssetRes.status, 201);
    assert.equal(mgrAssetRes.data.asset.employeeName, 'Manager Rahim');
    assert.equal(mgrAssetRes.data.asset.status, 'Assigned');

    // Create 2 team assets and 1 unrelated peer asset
    const teamAsset1 = await apiJson(baseUrl, 'POST', '/api/assets', adminToken, {
      id: 'AST7002',
      name: 'Field Tablet Alpha',
      category: 'Tablet',
      brand: 'Samsung',
      model: 'Tab A9+',
      serial: 'SN-TEAM-7002',
      department: 'Field Ops',
      location: 'Kolkata Center',
      status: 'Available',
      condition: 'Good',
      cost: 24000,
      purchaseDate: '2026-03-10',
      warrantyMonths: 24,
      warrantyExpiry: '2028-03-10',
    });
    assert.equal(teamAsset1.status, 201);
    await apiJson(baseUrl, 'POST', '/api/assignments', adminToken, {
      assetId: 'AST7002',
      employeeId: subAId,
      assigneeType: 'Employee',
      assignDate: '2026-03-12',
      condition: 'Good',
    });

    const teamAsset2 = await apiJson(baseUrl, 'POST', '/api/assets', adminToken, {
      id: 'AST7003',
      name: 'Field Tablet Beta',
      category: 'Tablet',
      brand: 'Lenovo',
      model: 'M11',
      serial: 'SN-TEAM-7003',
      department: 'Field Ops',
      location: 'Delhi Center',
      status: 'Available',
      condition: 'Fair',
      cost: 19000,
      purchaseDate: '2026-03-11',
      warrantyMonths: 24,
      warrantyExpiry: '2028-03-11',
      employeeName: 'Direct Report Beta',
      consultantName: 'Consultant Preview',
      retainerName: 'Retainer Preview',
      freelancerName: 'Freelancer Preview',
      yrpName: 'YRP Preview',
      internName: 'Intern Preview',
    });
    assert.equal(teamAsset2.status, 201);
    assert.equal(teamAsset2.data.asset.consultantName, 'Consultant Preview');
    assert.equal(teamAsset2.data.asset.internName, 'Intern Preview');

    const peerAsset = await apiJson(baseUrl, 'POST', '/api/assets', adminToken, {
      id: 'AST7999',
      name: 'Peer Laptop',
      category: 'Laptop',
      brand: 'HP',
      model: 'ProBook',
      serial: 'SN-PEER-7999',
      department: 'Field Ops',
      location: 'Mumbai Center',
      status: 'Available',
      condition: 'Good',
      cost: 65000,
      purchaseDate: '2026-03-11',
      warrantyMonths: 24,
      warrantyExpiry: '2028-03-11',
    });
    assert.equal(peerAsset.status, 201);
    await apiJson(baseUrl, 'POST', '/api/assignments', adminToken, {
      assetId: 'AST7999',
      employeeId: peerId,
      assigneeType: 'Employee',
      assignDate: '2026-03-12',
      condition: 'Good',
    });

    // 3. Manager logs in -> sees own asset (AST7001) + direct reports' assets (AST7002, AST7003), NOT AST7999
    const mgrLogin = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: mgrRes.data.employee.employeeId,
      password: 'Mgr@12345',
    });
    assert.equal(mgrLogin.status, 200);
    const mgrToken = mgrLogin.data.token as string;
    const mgrWorkspace = await apiJson(baseUrl, 'GET', '/api/workspace/state', mgrToken);
    assert.equal(mgrWorkspace.status, 200);
    const mgrAssetIds = (mgrWorkspace.data.state.assets as Array<{ id: string }>).map((a) => a.id);
    assert.equal(mgrAssetIds.includes('AST7001'), true);
    assert.equal(mgrAssetIds.includes('AST7002'), true);
    assert.equal(mgrAssetIds.includes('AST7003'), true);
    assert.equal(mgrAssetIds.includes('AST7999'), false);
    assert.equal(subBId.length > 0, true);

    // 4. Direct report Alpha logs in -> sees ONLY own asset (AST7002), NOT manager's or Beta's asset
    const empLogin = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: subARes.data.employee.employeeId,
      password: 'Emp@12345',
    });
    assert.equal(empLogin.status, 200);
    const empToken = empLogin.data.token as string;
    const empWorkspace = await apiJson(baseUrl, 'GET', '/api/workspace/state', empToken);
    assert.equal(empWorkspace.status, 200);
    const empAssetIds = (empWorkspace.data.state.assets as Array<{ id: string }>).map((a) => a.id);
    assert.deepEqual(empAssetIds, ['AST7002']);

    // 5. Regular Employee cannot create/delete assets
    const empCreateAttempt = await apiJson(baseUrl, 'POST', '/api/assets', empToken, {
      name: 'Unauthorized Laptop',
      category: 'Laptop',
      serial: 'SN-UNAUTH',
      cost: 1000,
    });
    assert.equal(empCreateAttempt.status, 403);
  } finally {
    await close();
    db.close();
  }
});
