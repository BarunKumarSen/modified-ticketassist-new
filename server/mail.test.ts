import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openDatabase, listEmailLogsFromDb, listEmailAuditLogsFromDb } from '../src/db/sqlite.ts';
import { createApiApp } from './app.ts';
import {
  buildProfessionalEmail,
  COMPANY_LOGO_CID,
  COMPANY_NAME,
} from './emailTemplates.ts';
import { setMailTransportForTest } from './mailer.ts';
import { processMailQueueOnce } from './mailQueue.ts';

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
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
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

async function flushQueue(db: ReturnType<typeof openDatabase>) {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await processMailQueueOnce(db);
}

test('buildProfessionalEmail renders Median Research branding, CID logo, employee/center details, and approval links', () => {
  const result = buildProfessionalEmail({
    subject: '[Approval Required] Leave Request',
    headline: 'Leave Request Awaiting Your Approval',
    recipientName: 'Tanvir Rahman',
    summaryText: 'Rahim Ahmed requested 2 days of annual leave.',
    employee: {
      employeeId: 'EMP-1001',
      name: 'Rahim Ahmed',
      email: 'rahim@medianresearch.com',
      department: 'IT',
      center: 'Dhaka HQ',
      branch: 'Dhaka HQ',
      reportingManagerName: 'Tanvir Rahman',
      reportingManagerEmail: 'tanvir.mgr@medianresearch.com',
    },
    details: [
      { label: 'Leave Type', value: 'Annual' },
      { label: 'Days', value: '2' },
    ],
    approveUrl: 'https://portal.example.com/api/approvals/respond?token=abc&action=approve',
    rejectUrl: 'https://portal.example.com/api/approvals/respond?token=abc&action=reject',
    ctaLabel: 'Open Portal',
    ctaUrl: 'https://portal.example.com',
  });

  assert.ok(result.htmlBody.includes('Median Research &amp; Consulting Pvt Ltd'));
  assert.ok(result.textBody.includes(COMPANY_NAME));
  assert.ok(result.htmlBody.includes(`cid:${COMPANY_LOGO_CID}`));
  assert.ok(result.htmlBody.includes('Rahim Ahmed (EMP-1001)'));
  assert.ok(result.htmlBody.includes('Dhaka HQ'));
  assert.ok(result.htmlBody.includes('Approve Request'));
  assert.ok(result.htmlBody.includes('Reject Request'));
  assert.ok(result.textBody.includes('Approve Request: https://portal.example.com/api/approvals/respond?token=abc&action=approve'));
});

test('Reporting manager emails, one-click approval workflow, holiday center targeting, and audit trail', async () => {
  const sentMessages: Array<{ to: string; subject: string; html: string; text: string }> = [];
  setMailTransportForTest(async (msg) => {
    sentMessages.push({ to: msg.to, subject: msg.subject, html: msg.html, text: msg.text });
    return { messageId: `<mock-${sentMessages.length}@median.local>` };
  });

  const { db, baseUrl, close } = await startTestServer();
  try {
    const adminLogin = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'admin',
      password: '71537(Lost{MacalliceRost@$$@MoonCrypto}Verse)17571',
    });
    assert.equal(adminLogin.status, 200);
    const adminToken = adminLogin.data.token as string;

    // 1. Creating a new 5-digit employee queues Account Created (with password) & Reporting Manager emails (NOT auto-sent!)
    const newEmpRes = await apiJson(baseUrl, 'POST', '/api/employees', adminToken, {
      employeeId: '20991',
      name: 'Nadia Islam',
      personalEmail: 'nadia.personal@medianresearch.com',
      officialEmail: 'nadia.islam@medianresearch.com',
      personalEmailVerified: true,
      officialEmailVerified: true,
      panCard: 'ABCDE2099F',
      voterIdCard: 'VOT2099123',
      aadhaarCard: '209912345678',
      password: 'Nadia@1234',
      department: 'Research',
      designation: 'Senior Analyst',
      center: 'Dhaka HQ',
      reportingManagerName: 'Farhan Kabir',
      reportingManagerEmail: 'farhan.kabir@medianresearch.com',
      status: 'Active',
    });
    assert.equal(newEmpRes.status, 201);
    assert.equal(newEmpRes.data.employee.employeeId, 'EMP-20991');
    // Zero automatic background sending!
    assert.equal(sentMessages.length, 0);

    // Clicking manual Mail send dispatches account email containing login ID & password
    const accSendRes = await apiJson(
      baseUrl,
      'POST',
      `/api/mail/send/${newEmpRes.data.queuedAccountMailId}`,
      adminToken
    );
    assert.equal(accSendRes.status, 200);
    assert.equal(accSendRes.data.message, 'Email Sent Successfully');
    assert.ok(
      sentMessages.some(
        (m) =>
          m.to === 'nadia.islam@medianresearch.com' &&
          m.text.includes('EMP-20991') &&
          m.text.includes('Nadia@1234')
      )
    );

    await flushQueue(db);

    assert.ok(
      sentMessages.some(
        (m) =>
          m.to === 'farhan.kabir@medianresearch.com' &&
          m.subject.includes('Nadia Islam') &&
          m.subject.includes('New Employee')
      )
    );

    // 2. Employee login -> late check-in triggers Late Attendance email queued for manual dispatch
    const rahimLogin = await apiJson(baseUrl, 'POST', '/api/auth/login', undefined, {
      loginId: 'rahim',
      password: 'Rahim@123',
    });
    assert.equal(rahimLogin.status, 200);
    const rahimToken = rahimLogin.data.token as string;

    const lateCheckIn = await apiJson(baseUrl, 'POST', '/api/attendance/check-in', rahimToken, {
      date: '2026-08-18',
      checkInTime: '10:05',
      remarks: 'Traffic jam',
    });
    assert.equal(lateCheckIn.status, 201);
    assert.ok(lateCheckIn.data.record.lateMinutes > 0);
    await flushQueue(db);

    assert.ok(
      sentMessages.some(
        (m) =>
          m.subject.includes('Late Attendance Alert') &&
          m.subject.includes('Rahim Ahmed')
      )
    );

    // 3. Employee submits leave request -> queues manager email with single-use Approve/Reject link
    const leaveRes = await apiJson(baseUrl, 'POST', '/api/leaves', rahimToken, {
      leaveType: 'Annual',
      startDate: '2026-11-24',
      endDate: '2026-11-25',
      reason: 'Family wedding out of Dhaka',
    });
    assert.equal(leaveRes.status, 201);
    await flushQueue(db);

    const leaveManagerMail = sentMessages.find(
      (m) => m.subject.includes('Leave Request') && m.subject.includes('Rahim Ahmed')
    );
    assert.ok(leaveManagerMail);
    const approveMatch = leaveManagerMail.html.match(
      /href="([^"]*\/api\/approvals\/respond\?token=[^"&]+&amp;action=approve)"/
    );
    assert.ok(approveMatch, 'Manager email must contain Approve URL');
    const approvePathUrl = approveMatch[1].replace(/&amp;/g, '&');

    // Click Approve link -> returns branded 200 HTML, updates leave status, notifies employee
    const approvalRes = await fetch(approvePathUrl);
    assert.equal(approvalRes.status, 200);
    const approvalHtml = await approvalRes.text();
    assert.ok(approvalHtml.includes('Median Research &amp; Consulting Pvt Ltd'));
    assert.ok(approvalHtml.includes('Approved'));
    await flushQueue(db);

    assert.ok(
      sentMessages.some(
        (m) => m.subject.includes('[Leave Approved]') && m.html.includes('Approved')
      )
    );

    // Replaying the same single-use approval token must return 409 Conflict
    const replayRes = await fetch(approvePathUrl);
    assert.equal(replayRes.status, 409);

    // Invalid approval query returns 400
    const badApprovalRes = await fetch(`${baseUrl}/api/approvals/respond?token=invalid&action=maybe`);
    assert.equal(badApprovalRes.status, 400);

    // 4. Regularization, WFH, and Profile Change requests queue manager approval emails and notify employees upon decision
    const regRes = await apiJson(baseUrl, 'POST', '/api/attendance/regularizations', rahimToken, {
      targetDate: '2026-08-18',
      requestedCheckIn: '09:15',
      requestedCheckOut: '17:30',
      reason: 'Biometric terminal offline at gate',
    });
    assert.equal(regRes.status, 201);

    const wfhRes = await apiJson(baseUrl, 'POST', '/api/attendance/wfh', rahimToken, {
      targetDate: '2026-11-19',
      endDate: '2026-11-19',
      reason: 'Deep focus report drafting',
    });
    assert.equal(wfhRes.status, 201);

    const profRes = await apiJson(
      baseUrl,
      'POST',
      '/api/employees/EMP001/profile-change-requests',
      rahimToken,
      {
        reason: 'Updated personal phone number',
        payload: { phone: '+880-1711-009988' },
      }
    );
    assert.equal(profRes.status, 201);
    await flushQueue(db);

    assert.ok(sentMessages.some((m) => m.subject.includes('Attendance Regularization Request')));
    assert.ok(sentMessages.some((m) => m.subject.includes('Work From Home (WFH) Request')));
    assert.ok(sentMessages.some((m) => m.subject.includes('Employee Profile Change Request')));

    // Admin approves WFH request -> notifies employee
    const reviewWfh = await apiJson(
      baseUrl,
      'PUT',
      `/api/workflow-requests/${wfhRes.data.request.id}`,
      adminToken,
      { status: 'Approved', reviewNotes: 'Approved for report sprint' }
    );
    assert.equal(reviewWfh.status, 200);
    await flushQueue(db);

    assert.ok(sentMessages.some((m) => m.subject.includes('[Work From Home (WFH) Approved]')));

    // 5. Holiday published for Dhaka HQ notifies only active Dhaka HQ employees (not Sylhet)
    const beforeHolidayCount = sentMessages.length;
    const holidayRes = await apiJson(baseUrl, 'POST', '/api/holidays', adminToken, {
      title: 'Dhaka Center Safety Drill Day',
      holidayDate: '2026-11-28',
      center: 'Dhaka HQ',
      description: 'Dhaka center closed for annual audit & drill.',
    });
    assert.equal(holidayRes.status, 201);
    assert.ok(holidayRes.data.notifiedCount >= 1);
    await flushQueue(db);

    const holidayEmails = sentMessages
      .slice(beforeHolidayCount)
      .filter((m) => m.subject.includes('Dhaka Center Safety Drill Day'));
    assert.ok(holidayEmails.some((m) => m.to === 'nadia.islam@medianresearch.com'));
    assert.equal(
      holidayEmails.some((m) => m.to === 'karim@company.com'),
      false,
      'Sylhet employee should not receive Dhaka HQ-only holiday email'
    );

    // Audit trail captures enqueued, sent, and manager approval decisions
    const auditLogs = listEmailAuditLogsFromDb(db);
    assert.ok(auditLogs.some((a) => a.eventType === 'MANAGER_APPROVED_VIA_EMAIL'));
    assert.ok(auditLogs.some((a) => a.eventType === 'EMAIL_SENT'));
  } finally {
    setMailTransportForTest(null);
    await close();
  }
});

test('Zero-retry immediate queue deletion on failure, manual Mail send, Admin Sender OTP/loopback migration, and mail RBAC', async () => {
  let failTransport = true;
  const loopbackCaptured: Array<{ from: string; to: string; text: string }> = [];
  setMailTransportForTest(async (msg) => {
    if (failTransport) {
      throw new Error('Simulated Gmail SMTP temporary 421 error');
    }
    loopbackCaptured.push({ from: msg.from, to: msg.to, text: msg.text });
    return { messageId: `<ok-${msg.to}@median.local>` };
  });

  const { db, baseUrl, close } = await startTestServer();
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

    // 1. Employee role must receive 403 on /api/mail/logs and /api/mail/reports
    const empLogsRes = await apiJson(baseUrl, 'GET', '/api/mail/logs', rahimToken);
    assert.equal(empLogsRes.status, 403);
    const empReportsRes = await apiJson(baseUrl, 'GET', '/api/mail/reports', rahimToken);
    assert.equal(empReportsRes.status, 403);

    // 2. Creating user + changing role + forgot-password queues account/role/reset emails (status Queued, zero auto-send)
    const createUserRes = await apiJson(baseUrl, 'POST', '/api/users', adminToken, {
      loginId: 'mailtester',
      password: 'User@1234',
      fullName: 'Mail Tester',
      email: 'mailtester@medianresearch.com',
      roleId: 'role_employee',
      employeeId: 'EMP003',
      active: true,
    });
    assert.equal(createUserRes.status, 201);

    let logs = listEmailLogsFromDb(db);
    const accountLog = logs.find((l) => l.eventType === 'ACCOUNT_CREATED');
    assert.ok(accountLog);
    assert.equal(accountLog.status, 'Queued');

    // 3. Manual Mail send on failing transport -> immediately deleted from Email_Logs (zero retries) + returns Email Delivery Failed
    const failSendRes = await apiJson(baseUrl, 'POST', `/api/mail/send/${accountLog.id}`, adminToken);
    assert.equal(failSendRes.status, 502);
    assert.equal(failSendRes.data.error, 'Email Delivery Failed');

    logs = listEmailLogsFromDb(db);
    assert.equal(logs.some((l) => l.id === accountLog.id), false, 'Failed email must be immediately purged from mail queue');
    const auditLogs = listEmailAuditLogsFromDb(db);
    assert.ok(auditLogs.some((a) => a.eventType === 'EMAIL_FAILED_PURGED'));

    // 4. Recover transport -> subsequent queued email dispatches cleanly via manual Mail trigger
    failTransport = false;
    const resetRes = await apiJson(baseUrl, 'POST', `/api/users/${createUserRes.data.user.id}/reset-password`, adminToken);
    assert.equal(resetRes.status, 200);
    logs = listEmailLogsFromDb(db);
    const resetLog = logs.find((l) => l.eventType === 'PASSWORD_RESET')!;
    assert.ok(resetLog);

    const manualSendRes = await apiJson(baseUrl, 'POST', `/api/mail/send/${resetLog.id}`, adminToken);
    assert.equal(manualSendRes.status, 200);
    assert.equal(manualSendRes.data.message, 'Email Sent Successfully');
    assert.equal(manualSendRes.data.log.status, 'Sent');

    // 5. Admin Sender Email Change Workflow (6-digit OTP + SMTP/IMAP + Live Loopback)
    const otpReqRes = await apiJson(baseUrl, 'POST', '/api/mail/sender-change/request-otp', adminToken, {
      newEmail: 'example@mail.com',
    });
    assert.equal(otpReqRes.status, 200);
    const otpMail = loopbackCaptured.find((m) =>
      m.text.includes('Hello Admin, to remove your mail ID from barunkumarsenbks1997@gmail.com to example@mail.com, please put your OTP here in the web application.')
    );
    assert.ok(otpMail, 'OTP email must contain exact prompt text sent to barunkumarsenbks1997@gmail.com');
    assert.equal(otpMail.to, 'barunkumarsenbks1997@gmail.com');

    const otpMatch = otpMail.text.match(/(\d{6})/);
    assert.ok(otpMatch);
    const otpCode = otpMatch[1];

    // Wrong OTP rejected
    const badOtpRes = await apiJson(baseUrl, 'POST', '/api/mail/sender-change/verify-otp', adminToken, {
      otpId: otpReqRes.data.otpId,
      otpCode: '000000',
    });
    assert.equal(badOtpRes.status, 400);

    // Valid OTP verified + sends confirmation email to old email
    const goodOtpRes = await apiJson(baseUrl, 'POST', '/api/mail/sender-change/verify-otp', adminToken, {
      otpId: otpReqRes.data.otpId,
      otpCode,
    });
    assert.equal(goodOtpRes.status, 200);
    assert.equal(goodOtpRes.data.confirmationSent, true);

    // Invalid mail server config does NOT save and returns exact error text
    const badCfgRes = await apiJson(baseUrl, 'POST', '/api/mail/sender-change/complete', adminToken, {
      otpId: otpReqRes.data.otpId,
      smtpHost: '',
      imapHost: 'imap.mail.com',
      appPassword: '',
      appName: 'AssetOS',
    });
    assert.equal(badCfgRes.status, 400);
    assert.equal(
      badCfgRes.data.error,
      'Wrong input provided. Please put the correct input in order to setup the Admin automated mail system.'
    );

    // Valid mail server config performs loopback test (example@mail.com -> example@mail.com) and saves
    const goodCfgRes = await apiJson(baseUrl, 'POST', '/api/mail/sender-change/complete', adminToken, {
      otpId: otpReqRes.data.otpId,
      smtpHost: 'smtp.mail.com',
      smtpPort: 587,
      encryption: 'tls',
      imapHost: 'imap.mail.com',
      imapPort: 993,
      appPassword: 'valid-app-password',
      appName: 'Median Custom Mail',
    });
    assert.equal(goodCfgRes.status, 200);
    assert.equal(goodCfgRes.data.message, 'The mail configuration for Admin is successful');
    assert.equal(goodCfgRes.data.status.from, 'example@mail.com');
    assert.equal(goodCfgRes.data.status.effectiveSource, 'database');
    assert.ok(
      loopbackCaptured.some(
        (m) =>
          m.from === 'example@mail.com' &&
          m.to === 'example@mail.com' &&
          m.text === 'The mail configuration for Admin is successful'
      )
    );

    const statusRes = await apiJson(baseUrl, 'GET', '/api/mail/status', adminToken);
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.data.status.from, 'example@mail.com');
    assert.equal(statusRes.data.status.configured, true);
  } finally {
    setMailTransportForTest(null);
    await close();
  }
});
