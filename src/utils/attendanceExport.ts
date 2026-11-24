function escapeXml(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generates an Excel-compatible SpreadsheetML 2003 (.xls) workbook string.
 */
export function buildExcelSpreadsheetXml(params: {
  sheetName: string;
  headers: string[];
  rows: Array<Array<string | number | null | undefined>>;
}): string {
  const { sheetName, headers, rows } = params;
  const safeSheet = escapeXml(sheetName.slice(0, 31) || 'Attendance');

  const headerCells = headers
    .map(
      (h) =>
        `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`
    )
    .join('');

  const dataRows = rows
    .map((row) => {
      const cells = row
        .map((cell) => {
          const isNum = typeof cell === 'number' && Number.isFinite(cell);
          const type = isNum ? 'Number' : 'String';
          return `<Cell><Data ss:Type="${type}">${escapeXml(cell ?? '')}</Data></Cell>`;
        })
        .join('');
      return `<Row>${cells}</Row>`;
    })
    .join('\n');

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Header">
   <Font ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#3F3F46" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="${safeSheet}">
  <Table>
   <Row>${headerCells}</Row>
   ${dataRows}
  </Table>
 </Worksheet>
</Workbook>`;
}

function escapePdfText(text: string): string {
  return text
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * Generates a valid, self-contained PDF 1.4 document with tabular attendance report text.
 */
export function buildAttendancePdfBytes(params: {
  title: string;
  subtitle: string;
  headers: string[];
  rows: Array<Array<string | number | null | undefined>>;
}): Uint8Array {
  const { title, subtitle, headers, rows } = params;
  const colWidths = headers.map((h, i) => {
    const maxData = rows.reduce((max, r) => Math.max(max, String(r[i] ?? '').length), 0);
    return Math.min(22, Math.max(h.length, maxData) + 2);
  });

  const formatRow = (vals: Array<string | number | null | undefined>) =>
    vals
      .map((v, i) => String(v ?? '').slice(0, colWidths[i] - 1).padEnd(colWidths[i], ' '))
      .join(' ');

  const lines: string[] = [
    title,
    subtitle,
    '-'.repeat(92),
    formatRow(headers),
    '-'.repeat(92),
    ...rows.slice(0, 42).map((r) => formatRow(r)),
  ];

  if (rows.length > 42) {
    lines.push(`... (${rows.length - 42} additional rows omitted)`);
  }

  const streamOps: string[] = ['BT', '/F1 12 Tf', '40 755 Td', `(${escapePdfText(lines[0])}) Tj`];
  streamOps.push('/F1 9 Tf', '0 -16 Td', `(${escapePdfText(lines[1])}) Tj`, '/F2 8 Tf', '0 -18 Td');

  for (let i = 2; i < lines.length; i++) {
    streamOps.push(`(${escapePdfText(lines[i])}) Tj`, '0 -13 Td');
  }
  streamOps.push('ET');

  const contentStream = streamOps.join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n',
    '6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n',
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

export function downloadExcelReport(params: {
  filename: string;
  sheetName: string;
  headers: string[];
  rows: Array<Array<string | number | null | undefined>>;
}): void {
  const xml = buildExcelSpreadsheetXml(params);
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = params.filename.endsWith('.xls') ? params.filename : `${params.filename}.xls`;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadPdfReport(params: {
  filename: string;
  title: string;
  subtitle: string;
  headers: string[];
  rows: Array<Array<string | number | null | undefined>>;
}): void {
  const bytes = buildAttendancePdfBytes(params);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = params.filename.endsWith('.pdf') ? params.filename : `${params.filename}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeRegisterCsvCell(value: string | number | null | undefined): string {
  const raw = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildMonthlyRegisterTablePayload(register: {
  month: string;
  dates: string[];
  rows: Array<{
    employeeCode: string;
    employeeName: string;
    department: string;
    center: string;
    days: Record<string, { code: string }>;
    presentDays: number;
    lateDays: number;
    earlyExitCount: number;
    leaveDays: number;
    holidayDays: number;
    absentDays: number;
    totalWorkHours: number;
    overtimeHours: number;
    attendanceRatePct: number;
  }>;
}): {
  headers: string[];
  rows: Array<Array<string | number>>;
} {
  const dayHeaders = register.dates.map((d) => d.slice(-2));
  const headers = [
    'Code',
    'Name',
    'Department',
    'Center',
    ...dayHeaders,
    'Present',
    'Late',
    'Early Exit',
    'Leaves',
    'Holidays',
    'Absent',
    'Work Hrs',
    'OT Hrs',
    'Rate %',
  ];

  const rows = register.rows.map((r) => [
    r.employeeCode,
    r.employeeName,
    r.department,
    r.center,
    ...register.dates.map((d) => r.days[d]?.code || '—'),
    r.presentDays,
    r.lateDays,
    r.earlyExitCount,
    r.leaveDays,
    r.holidayDays,
    r.absentDays,
    r.totalWorkHours,
    r.overtimeHours,
    `${r.attendanceRatePct}%`,
  ]);

  return { headers, rows };
}

export function buildMonthlyRegisterCsv(
  register: Parameters<typeof buildMonthlyRegisterTablePayload>[0]
): string {
  const { headers, rows } = buildMonthlyRegisterTablePayload(register);
  return [
    headers.map(escapeRegisterCsvCell).join(','),
    ...rows.map((row) => row.map(escapeRegisterCsvCell).join(',')),
  ].join('\n');
}

export function downloadMonthlyRegisterExcel(
  register: Parameters<typeof buildMonthlyRegisterTablePayload>[0],
  companyName = 'Median Research & Consulting Pvt Ltd'
): void {
  const { headers, rows } = buildMonthlyRegisterTablePayload(register);
  downloadExcelReport({
    filename: `Median-Attendance-Register-${register.month}.xls`,
    sheetName: `Register ${register.month}`,
    headers,
    rows,
  });
  void companyName;
}

export function downloadMonthlyRegisterPdf(
  register: Parameters<typeof buildMonthlyRegisterTablePayload>[0]
): void {
  const summaryHeaders = [
    'Code',
    'Name',
    'Dept',
    'Pres',
    'Late',
    'EarlyEx',
    'Leave',
    'Hol',
    'Abs',
    'Hrs',
    'OT',
    'Rate',
  ];
  const summaryRows = register.rows.map((r) => [
    r.employeeCode,
    r.employeeName,
    r.department,
    r.presentDays,
    r.lateDays,
    r.earlyExitCount,
    r.leaveDays,
    r.holidayDays,
    r.absentDays,
    r.totalWorkHours,
    r.overtimeHours,
    `${r.attendanceRatePct}%`,
  ]);
  downloadPdfReport({
    filename: `Median-Attendance-Register-${register.month}.pdf`,
    title: 'Median Asset & HR Suite - Monthly Attendance Register',
    subtitle: `Month: ${register.month} | Standard Shift: 09:30 - 18:00 (OT > 8h)`,
    headers: summaryHeaders,
    rows: summaryRows,
  });
}

