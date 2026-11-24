import type { Employee } from '../src/types/asset.ts';

export const COMPANY_NAME = 'Median Research & Consulting Pvt Ltd';
export const COMPANY_LOGO_CID = 'median-company-logo';
export const COMPANY_WEB_LOGO_PATH = '/assets/aistudio/Median_logo_Final_Small__1__69ba70f6.jpg';
export const COMPANY_SUPPORT_EMAIL = process.env.MAIL_FROM || 'barunkumarsenbks1997@gmail.com';

export interface EmailTemplatePayload {
  subject: string;
  headline: string;
  recipientName: string;
  recipientGreetingRole?: string;
  summaryText: string;
  employee?: Pick<
    Employee,
    'employeeId' | 'name' | 'email' | 'department' | 'center' | 'branch' | 'reportingManagerName' | 'reportingManagerEmail'
  > | null;
  centerOverride?: string;
  details: Array<{ label: string; value: string }>;
  ctaLabel?: string;
  ctaUrl?: string;
  approveUrl?: string;
  rejectUrl?: string;
  footerNote?: string;
}

function escapeHtml(val: string): string {
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildProfessionalEmail(payload: EmailTemplatePayload): {
  subject: string;
  htmlBody: string;
  textBody: string;
} {
  const emp = payload.employee;
  const resolvedCenter =
    payload.centerOverride || emp?.center || emp?.branch || 'Mumbai';

  const employeeBlockHtml = emp
    ? `
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;">
        <tr>
          <td style="padding:14px 16px;">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#64748B;margin-bottom:8px;">
              Employee &amp; Center Information
            </div>
            <table width="100%" cellpadding="4" cellspacing="0" style="font-size:13px;color:#1E293B;">
              <tr>
                <td width="42%" style="color:#64748B;">Employee Name</td>
                <td style="font-weight:600;color:#0F172A;">${escapeHtml(emp.name)} (${escapeHtml(emp.employeeId)})</td>
              </tr>
              <tr>
                <td style="color:#64748B;">Employee Email</td>
                <td>${escapeHtml(emp.email)}</td>
              </tr>
              <tr>
                <td style="color:#64748B;">Department / Center</td>
                <td>${escapeHtml(emp.department)} · ${escapeHtml(resolvedCenter)}</td>
              </tr>
              ${
                emp.reportingManagerName || emp.reportingManagerEmail
                  ? `<tr>
                      <td style="color:#64748B;">Reporting Manager</td>
                      <td>${escapeHtml(emp.reportingManagerName || 'Manager')} (${escapeHtml(emp.reportingManagerEmail || '')})</td>
                    </tr>`
                  : ''
              }
            </table>
          </td>
        </tr>
      </table>`
    : `
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;">
        <tr>
          <td style="padding:12px 16px;font-size:13px;color:#1E293B;">
            <strong style="color:#64748B;">Center:</strong> ${escapeHtml(resolvedCenter)}
          </td>
        </tr>
      </table>`;

  const detailsRowsHtml = payload.details
    .map(
      (d) => `
      <tr>
        <td width="42%" style="padding:7px 0;border-bottom:1px solid #F1F5F9;font-size:13px;color:#64748B;">${escapeHtml(d.label)}</td>
        <td style="padding:7px 0;border-bottom:1px solid #F1F5F9;font-size:13px;font-weight:600;color:#0F172A;">${escapeHtml(d.value)}</td>
      </tr>`
    )
    .join('');

  const approvalButtonsHtml =
    payload.approveUrl && payload.rejectUrl
      ? `
      <table cellpadding="0" cellspacing="0" style="margin:22px 0 8px 0;">
        <tr>
          <td style="padding-right:10px;">
            <a href="${escapeHtml(payload.approveUrl)}"
               style="display:inline-block;background:#16A34A;color:#FFFFFF;font-size:13px;font-weight:600;text-decoration:none;padding:11px 20px;border-radius:8px;">
              Approve Request
            </a>
          </td>
          <td>
            <a href="${escapeHtml(payload.rejectUrl)}"
               style="display:inline-block;background:#DC2626;color:#FFFFFF;font-size:13px;font-weight:600;text-decoration:none;padding:11px 20px;border-radius:8px;">
              Reject Request
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:6px 0 0 0;font-size:12px;color:#64748B;">
        These approval links are single-use and valid for 72 hours. Clicking a link updates records immediately and notifies the employee.
      </p>`
      : '';

  const ctaButtonHtml = payload.ctaUrl
    ? `
      <div style="margin:20px 0 4px 0;">
        <a href="${escapeHtml(payload.ctaUrl)}"
           style="display:inline-block;background:#4A146B;color:#FFFFFF;font-size:13px;font-weight:600;text-decoration:none;padding:10px 18px;border-radius:8px;">
          ${escapeHtml(payload.ctaLabel || 'Open Asset & HR Portal')}
        </a>
      </div>`
    : '';

  const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(payload.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0F172A;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:28px 12px;background:#F1F5F9;">
    <tr>
      <td align="center">
        <table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:14px;overflow:hidden;">
          <tr>
            <td style="padding:20px 26px;background:#FFFFFF;border-bottom:3px solid #D97706;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <img src="cid:${COMPANY_LOGO_CID}" alt="${escapeHtml(COMPANY_NAME)}" width="150" style="display:block;max-height:52px;width:auto;object-fit:contain;" />
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <div style="font-size:13px;font-weight:700;color:#4A146B;">${escapeHtml(COMPANY_NAME)}</div>
                    <div style="font-size:11px;color:#64748B;">Median Asset &amp; HR Suite</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:26px;">
              <h1 style="margin:0 0 10px 0;font-size:20px;line-height:1.3;color:#0F172A;">${escapeHtml(payload.headline)}</h1>
              <p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#334155;">
                Hello ${escapeHtml(payload.recipientName)},
              </p>
              <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#334155;">
                ${escapeHtml(payload.summaryText)}
              </p>

              ${employeeBlockHtml}

              ${
                payload.details.length > 0
                  ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0;">
                      ${detailsRowsHtml}
                    </table>`
                  : ''
              }

              ${approvalButtonsHtml}
              ${ctaButtonHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 26px;background:#F8FAFC;border-top:1px solid #E2E8F0;font-size:12px;line-height:1.5;color:#64748B;">
              <strong style="color:#334155;">${escapeHtml(COMPANY_NAME)} · © ${new Date().getFullYear()}</strong><br />
              Median Asset &amp; HR Suite · Center: ${escapeHtml(resolvedCenter)}<br />
              For support, contact <a href="mailto:${escapeHtml(COMPANY_SUPPORT_EMAIL)}" style="color:#4A146B;text-decoration:none;">${escapeHtml(COMPANY_SUPPORT_EMAIL)}</a>.
              ${payload.footerNote ? `<div style="margin-top:6px;color:#94A3B8;">${escapeHtml(payload.footerNote)}</div>` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textLines: string[] = [
    COMPANY_NAME,
    '='.repeat(COMPANY_NAME.length),
    '',
    payload.headline,
    '',
    `Hello ${payload.recipientName},`,
    '',
    payload.summaryText,
    '',
  ];

  if (emp) {
    textLines.push(
      `Employee: ${emp.name} (${emp.employeeId})`,
      `Email: ${emp.email}`,
      `Department: ${emp.department}`,
      `Center: ${resolvedCenter}`
    );
    if (emp.reportingManagerName || emp.reportingManagerEmail) {
      textLines.push(
        `Reporting Manager: ${emp.reportingManagerName || 'Manager'} <${emp.reportingManagerEmail || ''}>`
      );
    }
    textLines.push('');
  }

  for (const d of payload.details) {
    textLines.push(`${d.label}: ${d.value}`);
  }

  if (payload.approveUrl && payload.rejectUrl) {
    textLines.push('', `Approve Request: ${payload.approveUrl}`, `Reject Request: ${payload.rejectUrl}`);
  }
  if (payload.ctaUrl) {
    textLines.push('', `${payload.ctaLabel || 'Open Portal'}: ${payload.ctaUrl}`);
  }

  textLines.push(
    '',
    '--',
    `${COMPANY_NAME} · Contact: ${COMPANY_SUPPORT_EMAIL}`
  );

  return {
    subject: payload.subject,
    htmlBody,
    textBody: textLines.join('\n'),
  };
}

export function renderApprovalOutcomeHtml(params: {
  ok: boolean;
  title: string;
  message: string;
  statusLabel: string;
  details?: Array<{ label: string; value: string }>;
  portalUrl?: string;
}): string {
  const badgeBg = params.ok
    ? params.statusLabel === 'Approved'
      ? '#DCFCE7'
      : '#FEE2E2'
    : '#FEF3C7';
  const badgeColor = params.ok
    ? params.statusLabel === 'Approved'
      ? '#166534'
      : '#991B1B'
    : '#92400E';

  const detailsRows = (params.details || [])
    .map(
      (d) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #F1F5F9;color:#64748B;font-size:13px;">${escapeHtml(d.label)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #F1F5F9;color:#0F172A;font-weight:600;font-size:13px;">${escapeHtml(d.value)}</td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(params.title)} · ${escapeHtml(COMPANY_NAME)}</title>
</head>
<body style="margin:0;padding:32px 16px;background:#F5F6F2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0F172A;">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,0.06);">
    <div style="padding:20px 24px;border-bottom:3px solid #D97706;display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <img src="${COMPANY_WEB_LOGO_PATH}" alt="${escapeHtml(COMPANY_NAME)}" style="height:44px;width:auto;object-fit:contain;" />
      <span style="display:inline-block;padding:4px 10px;border-radius:6px;background:${badgeBg};color:${badgeColor};font-size:12px;font-weight:700;">
        ${escapeHtml(params.statusLabel)}
      </span>
    </div>
    <div style="padding:24px;">
      <h1 style="margin:0 0 10px 0;font-size:20px;color:#0F172A;">${escapeHtml(params.title)}</h1>
      <p style="margin:0 0 18px 0;font-size:14px;line-height:1.6;color:#475569;">${escapeHtml(params.message)}</p>
      ${
        detailsRows
          ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">${detailsRows}</table>`
          : ''
      }
      <a href="${escapeHtml(params.portalUrl || '/')}"
         style="display:inline-block;background:#4A146B;color:#FFFFFF;font-size:13px;font-weight:600;text-decoration:none;padding:10px 18px;border-radius:8px;">
        Return to ${escapeHtml(COMPANY_NAME)} Portal
      </a>
    </div>
    <div style="padding:14px 24px;background:#F8FAFC;border-top:1px solid #E2E8F0;font-size:12px;color:#64748B;">
      ${escapeHtml(COMPANY_NAME)} · Support: ${escapeHtml(COMPANY_SUPPORT_EMAIL)}
    </div>
  </div>
</body>
</html>`;
}
