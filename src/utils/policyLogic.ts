import type { PolicyVersionHistoryEntry } from '../types/policy';
import { ALL_EMPLOYMENT_CATEGORIES, type EmploymentCategory } from '../types/asset';

function escapePdfText(text: string): string {
  return text
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * Generates a self-contained multi-line PDF 1.4 document with clean readable typography.
 */
export function buildPolicyPdfBytes(params: {
  title: string;
  category: string;
  version: string;
  effectiveDate: string;
  companyName?: string;
  sections: Array<{ heading: string; lines: string[] }>;
}): Uint8Array {
  const {
    title,
    category,
    version,
    effectiveDate,
    companyName = 'Median Research & Consulting Pvt Ltd',
    sections,
  } = params;

  const streamOps: string[] = [
    'BT',
    '/F1 14 Tf',
    '48 748 Td',
    `(${escapePdfText(companyName)}) Tj`,
    '/F1 12 Tf',
    '0 -20 Td',
    `(${escapePdfText(`${title} (${category})`)}) Tj`,
    '/F2 9 Tf',
    '0 -16 Td',
    `(${escapePdfText(`Version: v${version}   |   Effective Date: ${effectiveDate}`)}) Tj`,
    '0 -14 Td',
    `(${escapePdfText('='.repeat(78))}) Tj`,
  ];

  let lineCount = 0;
  for (const section of sections) {
    if (lineCount > 40) break;
    streamOps.push('/F1 10 Tf', '0 -20 Td', `(${escapePdfText(section.heading)}) Tj`);
    lineCount += 1;
    streamOps.push('/F2 9 Tf');
    for (const line of section.lines) {
      if (lineCount > 40) break;
      streamOps.push('0 -14 Td', `(${escapePdfText(line)}) Tj`);
      lineCount += 1;
    }
  }

  streamOps.push('ET');
  const contentStream = streamOps.join('\n');

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n',
    '6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}

export function isValidPdfBytes(bytes: Uint8Array): boolean {
  if (!bytes || bytes.length < 8) return false;
  const header = new TextDecoder('ascii').decode(bytes.slice(0, 5));
  return header === '%PDF-';
}

export function isValidPdfBase64(base64: string): boolean {
  if (!base64 || typeof base64 !== 'string') return false;
  try {
    const cleaned = base64.replace(/^data:application\/pdf;base64,/, '').trim();
    const buf = Buffer.from(cleaned, 'base64');
    return isValidPdfBytes(new Uint8Array(buf));
  } catch {
    return false;
  }
}

export function bumpPolicyVersion(currentVersion: string, bump: 'minor' | 'major' = 'minor'): string {
  const cleaned = currentVersion.trim().replace(/^v/i, '');
  const match = cleaned.match(/^(\d+)\.(\d+)$/);
  if (!match) return '1.1';
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (bump === 'major') return `${major + 1}.0`;
  return `${major}.${minor + 1}`;
}

export function parsePolicyHistory(jsonStr?: string | null): PolicyVersionHistoryEntry[] {
  if (!jsonStr) return [];
  try {
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? (parsed as PolicyVersionHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function buildDefaultSeedPolicies(): Array<{
  id: string;
  category: string;
  title: string;
  description: string;
  version: string;
  fileName: string;
  contentBase64: string;
  fileSize: number;
}> {
  const hrPdf = buildPolicyPdfBytes({
    title: 'Human Resources & Employee Conduct Policy',
    category: 'HR Policy',
    version: '1.0',
    effectiveDate: '2026-01-01',
    sections: [
      {
        heading: '1. Purpose & Scope',
        lines: [
          'This HR Policy establishes uniform employment standards across all Indian offices and',
          'centers of Median Research & Consulting Pvt Ltd.',
        ],
      },
      {
        heading: '2. Working Hours & Attendance',
        lines: [
          'Standard office shift starts at 09:30 IST. Employees must record daily Check-In and',
          'Check-Out via the Attendance Portal. Missed punches require reporting manager approval.',
        ],
      },
      {
        heading: '3. Leave Entitlement & Reporting Manager Approval',
        lines: [
          'Employees are eligible for Annual, Casual, and Sick Leave as per statutory guidelines.',
          'All leave applications are routed automatically to the assigned Reporting Manager.',
        ],
      },
      {
        heading: '4. Asset Stewardship & Confidentiality',
        lines: [
          'Company-issued laptops, monitors, and peripherals remain property of Median Research.',
          'All client and internal research data must be handled under strict NDA compliance.',
        ],
      },
    ],
  });

  const poshPdf = buildPolicyPdfBytes({
    title: 'Prevention of Sexual Harassment (POSH) Policy',
    category: 'POSH Policy',
    version: '1.0',
    effectiveDate: '2026-01-01',
    sections: [
      {
        heading: '1. Zero-Tolerance Commitment',
        lines: [
          'Median Research & Consulting Pvt Ltd is committed to providing a safe, respectful, and',
          'dignified workplace free from sexual harassment across all Indian centers and remote teams.',
        ],
      },
      {
        heading: '2. Applicability (POSH Act, 2013)',
        lines: [
          'Applies to all employees, managers, contractors, interns, and visitors across all work',
          'locations, client sites, offsites, and virtual communication channels.',
        ],
      },
      {
        heading: '3. Internal Complaints Committee (ICC)',
        lines: [
          'An empowered Internal Complaints Committee reviews all complaints confidentially and',
          'impartially within statutory timelines prescribed under the POSH Act.',
        ],
      },
      {
        heading: '4. Reporting Procedure & Non-Retaliation',
        lines: [
          'Complaints may be submitted confidentially to icc@medianresearch.com within 90 days.',
          'Strict protection against retaliation is guaranteed for complainants and witnesses.',
        ],
      },
    ],
  });

  const itPdf = buildPolicyPdfBytes({
    title: 'Information Technology (IT) & Cyber Security Policy',
    category: 'IT Policy',
    version: '1.0',
    effectiveDate: '2026-01-01',
    sections: [
      {
        heading: '1. Applicability & Scope',
        lines: [
          'Applies to all Employees, Managers, Consultants, Retainers, Freelancers, Young',
          'Research Program (YRP) members, and Interns using Median Research IT assets or data.',
        ],
      },
      {
        heading: '2. Acceptable Use & Device Custody',
        lines: [
          'Issued laptops, tablets, smartphones, and SIM cards remain company property and must',
          'not be shared, modified, jailbroken, or used with unauthorized third-party software.',
        ],
      },
      {
        heading: '3. Data Protection, Passwords & Incident Reporting',
        lines: [
          'Device passcodes and enterprise logins must never be disclosed. Loss, theft, or',
          'physical damage of equipment must be reported via Support Tickets within 2 hours.',
        ],
      },
      {
        heading: '4. Return of Equipment & Compliance',
        lines: [
          'All hardware, chargers, SIM cards, and accessories must be returned in good condition',
          'with fieldwork data cleared upon project completion, exit, or Admin request.',
        ],
      },
    ],
  });

  return [
    {
      id: 'pol-hr-default',
      category: 'HR Policy',
      title: 'HR Policy Handbook',
      description:
        'Standard employment guidelines, working hours, leave approval hierarchy, and workplace code of conduct.',
      version: '1.0',
      fileName: 'Median-HR-Policy-v1.0.pdf',
      contentBase64: Buffer.from(hrPdf).toString('base64'),
      fileSize: hrPdf.length,
    },
    {
      id: 'pol-posh-default',
      category: 'POSH Policy',
      title: 'POSH Policy & Workplace Safety Charter',
      description:
        'Prevention of Sexual Harassment (POSH Act, 2013) compliance policy, ICC escalation procedure, and zero-tolerance standards.',
      version: '1.0',
      fileName: 'Median-POSH-Policy-v1.0.pdf',
      contentBase64: Buffer.from(poshPdf).toString('base64'),
      fileSize: poshPdf.length,
    },
    {
      id: 'pol-it-default',
      category: 'IT Policy',
      title: 'IT Security & Equipment Usage Policy',
      description:
        'Mandatory IT asset custody, acceptable use, device security, incident reporting, and return policy across all staff, consultants, retainers, freelancers, YRP, and interns.',
      version: '1.0',
      fileName: 'Median-IT-Policy-v1.0.pdf',
      contentBase64: Buffer.from(itPdf).toString('base64'),
      fileSize: itPdf.length,
    },
  ];
}

export function parseVisibleRoles(raw: unknown): EmploymentCategory[] {
  if (Array.isArray(raw)) {
    const valid = raw
      .map((item) => String(item).trim())
      .filter((item): item is EmploymentCategory =>
        (ALL_EMPLOYMENT_CATEGORIES as readonly string[]).includes(item)
      );
    return valid.length > 0 ? Array.from(new Set(valid)) : [...ALL_EMPLOYMENT_CATEGORIES];
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return parseVisibleRoles(JSON.parse(raw));
    } catch {
      return [...ALL_EMPLOYMENT_CATEGORIES];
    }
  }
  return [...ALL_EMPLOYMENT_CATEGORIES];
}

export function canRoleCategoryViewPolicy(
  visibleRoles: readonly EmploymentCategory[] | undefined,
  userCategory: EmploymentCategory,
  isPrivilegedViewer = false
): boolean {
  if (isPrivilegedViewer) return true;
  if (!visibleRoles || visibleRoles.length === 0) return true;
  return visibleRoles.includes(userCategory);
}

