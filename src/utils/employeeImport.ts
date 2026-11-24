import type { Employee } from '../types/asset.ts';
import { normalizeEmployeeId, validateEmployeeId } from './assetMath.ts';

export type EmployeeImportDuplicatePolicy = 'skip' | 'update';

export interface ParsedEmployeeImportRow {
  rowNumber: number;
  employeeId: string;
  name: string;
  email: string;
  department: string;
  designation: string;
  phone: string;
  branch: string;
  center: string;
  reportingManagerName: string;
  reportingManagerEmail: string;
  joiningDate: string;
  status: 'Active' | 'Inactive';
}

export interface EmployeeImportRowError {
  rowNumber: number;
  employeeId?: string;
  name?: string;
  reason: string;
}

export interface EmployeeImportPlan {
  totalRows: number;
  validRows: ParsedEmployeeImportRow[];
  errors: EmployeeImportRowError[];
}

/**
 * RFC-4180 compliant CSV parser handling UTF-8 BOM, CRLF/LF, commas inside quotes,
 * and escaped double-quotes ("").
 */
export function parseCsvRows(csvText: string): string[][] {
  const clean = csvText.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field.trim());
        field = '';
      } else if (ch === '\r') {
        if (clean[i + 1] === '\n') i++;
        row.push(field.trim());
        if (row.some((c) => c !== '')) {
          rows.push(row);
        }
        row = [];
        field = '';
      } else if (ch === '\n') {
        row.push(field.trim());
        if (row.some((c) => c !== '')) {
          rows.push(row);
        }
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
  }

  row.push(field.trim());
  if (row.some((c) => c !== '')) {
    rows.push(row);
  }

  return rows;
}

type CanonicalField =
  | 'employeeId'
  | 'name'
  | 'email'
  | 'department'
  | 'designation'
  | 'phone'
  | 'branch'
  | 'center'
  | 'reportingManagerName'
  | 'reportingManagerEmail'
  | 'joiningDate'
  | 'status';

function normalizeHeaderKey(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const HEADER_ALIAS_MAP: Record<string, CanonicalField> = {
  id: 'employeeId',
  'emp id': 'employeeId',
  'employee id': 'employeeId',
  'employee code': 'employeeId',
  code: 'employeeId',
  name: 'name',
  'full name': 'name',
  'employee name': 'name',
  email: 'email',
  'email address': 'email',
  'employee email': 'email',
  department: 'department',
  dept: 'department',
  designation: 'designation',
  role: 'designation',
  title: 'designation',
  'job title': 'designation',
  phone: 'phone',
  mobile: 'phone',
  'mobile number': 'phone',
  'phone number': 'phone',
  contact: 'phone',
  branch: 'branch',
  center: 'center',
  location: 'center',
  office: 'center',
  'reporting manager': 'reportingManagerName',
  'reporting manager name': 'reportingManagerName',
  'manager name': 'reportingManagerName',
  manager: 'reportingManagerName',
  'manager email': 'reportingManagerEmail',
  'reporting manager email': 'reportingManagerEmail',
  'joining date': 'joiningDate',
  'join date': 'joiningDate',
  status: 'status',
};

function generateUniqueEmployeeCode(usedCodes: Set<string>, startNumRef: { value: number }): string {
  while (true) {
    const candidate = `EMP${String(startNumRef.value).padStart(3, '0')}`;
    startNumRef.value++;
    if (!usedCodes.has(candidate)) {
      usedCodes.add(candidate);
      return candidate;
    }
  }
}

export function buildEmployeeImportPlan(params: {
  csvText: string;
  existingEmployees: Pick<Employee, 'id' | 'employeeId' | 'email'>[];
  duplicatePolicy?: EmployeeImportDuplicatePolicy;
  defaultManagerEmail?: string;
}): EmployeeImportPlan {
  const rows = parseCsvRows(params.csvText);
  if (rows.length < 2) {
    return {
      totalRows: 0,
      validRows: [],
      errors: [
        {
          rowNumber: 1,
          reason: 'CSV must include a header row and at least one employee data row.',
        },
      ],
    };
  }

  const headerRow = rows[0];
  const colMap = new Map<CanonicalField, number>();
  headerRow.forEach((rawHeader, idx) => {
    const key = normalizeHeaderKey(rawHeader);
    const mapped = HEADER_ALIAS_MAP[key];
    if (mapped && !colMap.has(mapped)) {
      colMap.set(mapped, idx);
    }
  });

  // Fallback for headerless-style legacy CSVs if Name wasn't detected in header row
  const hasMappedName = colMap.has('name');
  const hasMappedEmail = colMap.has('email');
  if (!hasMappedName || !hasMappedEmail) {
    // Recognize legacy 6-col header like "Name,Email,Department,Designation,Phone,Branch"
    // or return clear header guidance
    return {
      totalRows: rows.length - 1,
      validRows: [],
      errors: [
        {
          rowNumber: 1,
          reason:
            'Missing required column headers "Name" and "Email". Download the Employee CSV Template or export existing employees for the supported format.',
        },
      ],
    };
  }

  const usedCodes = new Set(
    params.existingEmployees.flatMap((e) => [
      normalizeEmployeeId(e.employeeId || ''),
      normalizeEmployeeId(e.id || ''),
    ]).filter(Boolean)
  );
  let maxEmpNum = 0;
  for (const code of usedCodes) {
    const match = code.match(/^EMP-?(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxEmpNum) maxEmpNum = n;
    }
  }
  const nextCounter = { value: maxEmpNum + 1 };

  const duplicatePolicy = params.duplicatePolicy || 'skip';
  const seenInBatch = new Set<string>();
  const validRows: ParsedEmployeeImportRow[] = [];
  const errors: EmployeeImportRowError[] = [];

  const getCell = (cols: string[], field: CanonicalField): string => {
    const idx = colMap.get(field);
    return idx !== undefined ? (cols[idx] ?? '').trim() : '';
  };

  for (let i = 1; i < rows.length; i++) {
    const rowNumber = i + 1;
    const cols = rows[i];
    if (cols.every((c) => !c.trim())) continue;

    const rawCode = getCell(cols, 'employeeId');
    const name = getCell(cols, 'name');
    const email = getCell(cols, 'email');
    const department = getCell(cols, 'department') || 'IT';
    const designation = getCell(cols, 'designation') || 'Associate';
    const phone = getCell(cols, 'phone') || '';
    const branchCell = getCell(cols, 'branch');
    const centerCell = getCell(cols, 'center');
    const center = centerCell || branchCell || 'Mumbai';
    const branch = branchCell || center;
    const reportingManagerName = getCell(cols, 'reportingManagerName') || 'System Administrator';
    const reportingManagerEmail =
      getCell(cols, 'reportingManagerEmail') || params.defaultManagerEmail || '';
    const joiningDate = getCell(cols, 'joiningDate') || '';
    const rawStatus = getCell(cols, 'status').toLowerCase();
    const status: 'Active' | 'Inactive' = rawStatus === 'inactive' ? 'Inactive' : 'Active';

    if (!name) {
      errors.push({ rowNumber, employeeId: rawCode || undefined, reason: 'Employee Name is required.' });
      continue;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push({
        rowNumber,
        employeeId: rawCode || undefined,
        name,
        reason: `Valid Email is required (got "${email || 'empty'}").`,
      });
      continue;
    }
    if (
      reportingManagerEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reportingManagerEmail)
    ) {
      errors.push({
        rowNumber,
        employeeId: rawCode || undefined,
        name,
        reason: `Invalid Reporting Manager Email "${reportingManagerEmail}".`,
      });
      continue;
    }

    let employeeId = rawCode ? normalizeEmployeeId(rawCode) : '';
    if (employeeId) {
      if (seenInBatch.has(employeeId)) {
        errors.push({
          rowNumber,
          employeeId,
          name,
          reason: `Duplicate Employee ID "${employeeId}" appears multiple times in the CSV.`,
        });
        continue;
      }

      const idFormatErr = validateEmployeeId(employeeId, []);
      if (idFormatErr) {
        errors.push({ rowNumber, employeeId, name, reason: idFormatErr });
        continue;
      }

      const existsInDb = usedCodes.has(employeeId);
      if (existsInDb && duplicatePolicy === 'skip') {
        errors.push({
          rowNumber,
          employeeId,
          name,
          reason: `Skipped: Employee ID "${employeeId}" already exists (existing record preserved).`,
        });
        continue;
      }
      usedCodes.add(employeeId);
    } else {
      employeeId = generateUniqueEmployeeCode(usedCodes, nextCounter);
    }

    seenInBatch.add(employeeId);
    validRows.push({
      rowNumber,
      employeeId,
      name,
      email,
      department,
      designation,
      phone,
      branch,
      center,
      reportingManagerName,
      reportingManagerEmail,
      joiningDate,
      status,
    });
  }

  return {
    totalRows: rows.length - 1,
    validRows,
    errors,
  };
}

export function generateEmployeeImportTemplateCsv(): string {
  return [
    'ID,Name,Email,Department,Designation,Center,Reporting Manager,Manager Email,Mobile,Status',
    'EMP101,Ayesha Rahman,ayesha.r@company.com,IT,Software Engineer,Mumbai,Monirul Islam,monirul.it@company.com,01711001122,Active',
    'EMP102,Tariq Hasan,tariq.h@company.com,HR,Talent Specialist,Bengaluru,Nusrat Jahan,nusrat.hr@company.com,01822003344,Active',
  ].join('\n');
}
