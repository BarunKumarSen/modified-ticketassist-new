import type {
  Employee,
  PersonnelEntity,
  PersonnelEntityType,
  Vendor,
} from '../types/asset';
import { toCSV } from './assetMath';
import { parseCsvRows } from './employeeImport';
import {
  normalizeEntityIdInput,
  validatePersonnelEntityInput,
} from './entityValidation';

export type DirectoryDuplicatePolicy = 'skip' | 'update';

export interface ParsedPersonnelImportRow {
  rowNumber: number;
  entityType: PersonnelEntityType;
  entityCode: string;
  name: string;
  email: string;
  phone: string;
  center: string;
  department: string;
  designation: string;
  address: string;
  aadhaarCard: string;
  panCard: string;
  joiningDate: string;
  projectName: string;
  jobNumber: string;
  reportingManagerName: string;
  reportingManagerEmail: string;
  status: 'Active' | 'Inactive';
}

export interface DirectoryImportErrorRow {
  rowNumber: number;
  code?: string;
  name?: string;
  reason: string;
}

export interface PersonnelImportPlan {
  totalRows: number;
  validRows: ParsedPersonnelImportRow[];
  errors: DirectoryImportErrorRow[];
}

export interface ParsedVendorImportRow {
  rowNumber: number;
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  gst: string;
}

export interface VendorImportPlan {
  totalRows: number;
  validRows: ParsedVendorImportRow[];
  errors: DirectoryImportErrorRow[];
}

function normalizeHeaderKey(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function generateDirectoryTemplateCsv(
  moduleType: PersonnelEntityType | 'Vendor'
): string {
  if (moduleType === 'Vendor') {
    return [
      'Vendor Code,Vendor Name,Contact Person,Phone,Email,Address,GSTIN',
      'VEN1001,Acme Solutions Pvt Ltd,Rajesh Kumar,9876543210,sales@acmesolutions.in,Kolkata Sector V,19AABCA1234D1Z5',
      'VEN1002,Metro Digital Services,Priya Nair,9820011223,billing@metrodigital.in,Mumbai Andheri East,27AABCM5678E1Z2',
    ].join('\n');
  }

  const sampleCodes: Record<PersonnelEntityType, string> = {
    Consultant: 'CON1001',
    Retainer: 'RET1001',
    Freelancer: 'KOL1001',
    'Young Research Program': 'YRP1001',
    Intern: 'INT1001',
  };
  const code = sampleCodes[moduleType] || 'MEM1001';

  return [
    'Code,Name,Email,Mobile,Center,Department,Designation,Address,Aadhaar,PAN,Joining Date,Project Name,Job Number,Reporting Manager,Manager Email,Status',
    `${code},Ananya Sen,ananya.sen@company.com,9830011223,Kolkata,Research,${moduleType},Salt Lake Sector V Kolkata,123456789012,ABCDE1234F,2026-01-15,National Field Study,JOB-2026-01,System Administrator,admin@company.com,Active`,
  ].join('\n');
}

export function buildDirectoryExportCsv(
  moduleType: PersonnelEntityType | 'Vendor',
  records: readonly PersonnelEntity[] | readonly Vendor[]
): string {
  if (moduleType === 'Vendor') {
    const vendors = records as readonly Vendor[];
    return toCSV(
      ['Vendor Code', 'Vendor Name', 'Contact Person', 'Phone', 'Email', 'Address', 'GSTIN'],
      vendors.map((v) => [
        v.id,
        v.name,
        v.contactPerson,
        v.phone,
        v.email,
        v.address,
        v.gst,
      ])
    );
  }

  const entities = (records as readonly PersonnelEntity[]).filter(
    (e) => e.entityType === moduleType
  );
  return toCSV(
    [
      'Code',
      'Category',
      'Name',
      'Email',
      'Mobile',
      'Center',
      'Department',
      'Designation',
      'Address',
      'Aadhaar',
      'PAN',
      'Joining Date',
      'Project Name',
      'Job Number',
      'Reporting Manager',
      'Manager Email',
      'Status',
    ],
    entities.map((e) => [
      e.entityCode || '',
      e.entityType || '',
      e.name || '',
      e.email || '',
      e.phone || '',
      e.center || '',
      e.department || '',
      e.designation || '',
      e.address || '',
      e.aadhaarCard || '',
      e.panCard || '',
      e.joiningDate || '',
      e.projectName || '',
      e.projectNo || '',
      e.reportingManagerName || '',
      e.reportingManagerEmail || '',
      e.status || '',
    ])
  );
}

const PERSONNEL_HEADER_MAP: Record<string, keyof ParsedPersonnelImportRow> = {
  code: 'entityCode',
  id: 'entityCode',
  'entity code': 'entityCode',
  'consultant id': 'entityCode',
  'retainer id': 'entityCode',
  'freelancer id': 'entityCode',
  'freelancer code': 'entityCode',
  'yrp id': 'entityCode',
  'intern id': 'entityCode',
  name: 'name',
  'full name': 'name',
  email: 'email',
  'email id': 'email',
  phone: 'phone',
  mobile: 'phone',
  'mobile no': 'phone',
  center: 'center',
  branch: 'center',
  department: 'department',
  dept: 'department',
  designation: 'designation',
  role: 'designation',
  address: 'address',
  aadhaar: 'aadhaarCard',
  'aadhaar card': 'aadhaarCard',
  'aadhaar no': 'aadhaarCard',
  pan: 'panCard',
  'pan card': 'panCard',
  'pan no': 'panCard',
  'joining date': 'joiningDate',
  'join date': 'joiningDate',
  'project name': 'projectName',
  'job number': 'jobNumber',
  'project no': 'jobNumber',
  'reporting manager': 'reportingManagerName',
  'reporting manager name': 'reportingManagerName',
  'manager email': 'reportingManagerEmail',
  'reporting manager email': 'reportingManagerEmail',
  status: 'status',
};

export function buildPersonnelImportPlan(params: {
  csvText: string;
  entityType: PersonnelEntityType;
  existingEntities: readonly PersonnelEntity[];
  existingEmployees: readonly Employee[];
  duplicatePolicy?: DirectoryDuplicatePolicy;
}): PersonnelImportPlan {
  const rows = parseCsvRows(params.csvText);
  if (rows.length < 2) {
    return {
      totalRows: 0,
      validRows: [],
      errors: [
        {
          rowNumber: 1,
          reason: 'CSV must include a header row and at least one data row.',
        },
      ],
    };
  }

  const colMap = new Map<keyof ParsedPersonnelImportRow, number>();
  rows[0].forEach((header, idx) => {
    const mapped = PERSONNEL_HEADER_MAP[normalizeHeaderKey(header)];
    if (mapped && !colMap.has(mapped)) colMap.set(mapped, idx);
  });

  if (!colMap.has('entityCode') || !colMap.has('name') || !colMap.has('email')) {
    return {
      totalRows: rows.length - 1,
      validRows: [],
      errors: [
        {
          rowNumber: 1,
          reason: 'CSV must include "Code", "Name", and "Email" columns. Download Template CSV for the required format.',
        },
      ],
    };
  }

  const getCell = (cols: string[], key: keyof ParsedPersonnelImportRow) => {
    const idx = colMap.get(key);
    return idx !== undefined ? (cols[idx] ?? '').trim() : '';
  };

  const duplicatePolicy = params.duplicatePolicy || 'skip';
  const seenCodes = new Set<string>();
  const validRows: ParsedPersonnelImportRow[] = [];
  const errors: DirectoryImportErrorRow[] = [];

  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    if (cols.every((c) => !c.trim())) continue;
    const rowNumber = i + 1;

    const entityCode = normalizeEntityIdInput(getCell(cols, 'entityCode'));
    const name = getCell(cols, 'name');
    const email = getCell(cols, 'email');
    const phone = getCell(cols, 'phone');
    const center = getCell(cols, 'center') || 'Kolkata';
    const department = getCell(cols, 'department') || 'Research';
    const designation = getCell(cols, 'designation') || params.entityType;
    const address = getCell(cols, 'address');
    const aadhaarCard = getCell(cols, 'aadhaarCard');
    const panCard = getCell(cols, 'panCard').toUpperCase();
    const joiningDate = getCell(cols, 'joiningDate');
    const projectName = getCell(cols, 'projectName');
    const jobNumber = getCell(cols, 'jobNumber');
    const reportingManagerName = getCell(cols, 'reportingManagerName') || 'System Administrator';
    const reportingManagerEmail = getCell(cols, 'reportingManagerEmail');
    const rawStatus = getCell(cols, 'status').toLowerCase();
    const status: 'Active' | 'Inactive' = rawStatus === 'inactive' ? 'Inactive' : 'Active';

    if (seenCodes.has(entityCode)) {
      errors.push({
        rowNumber,
        code: entityCode,
        name,
        reason: `Duplicate code "${entityCode}" appears multiple times in the CSV.`,
      });
      continue;
    }

    const existingSameCode = params.existingEntities.find(
      (e) => e.entityCode.trim().toUpperCase() === entityCode
    );
    if (existingSameCode && duplicatePolicy === 'skip') {
      errors.push({
        rowNumber,
        code: entityCode,
        name,
        reason: `Skipped: Code "${entityCode}" already exists.`,
      });
      continue;
    }

    const validation = validatePersonnelEntityInput({
      entityType: params.entityType,
      entityCode,
      name,
      email,
      phone,
      aadhaarCard,
      panCard,
      existingEntities: params.existingEntities,
      existingEmployees: params.existingEmployees,
      excludeEntityId: existingSameCode?.id,
    });

    if (!validation.ok) {
      errors.push({
        rowNumber,
        code: entityCode || undefined,
        name: name || undefined,
        reason: validation.error,
      });
      continue;
    }

    seenCodes.add(validation.normalizedCode);
    validRows.push({
      rowNumber,
      entityType: params.entityType,
      entityCode: validation.normalizedCode,
      name,
      email,
      phone,
      center,
      department,
      designation,
      address,
      aadhaarCard,
      panCard,
      joiningDate,
      projectName,
      jobNumber,
      reportingManagerName,
      reportingManagerEmail,
      status,
    });
  }

  return {
    totalRows: rows.length - 1,
    validRows,
    errors,
  };
}

const VENDOR_HEADER_MAP: Record<string, keyof ParsedVendorImportRow> = {
  'vendor code': 'id',
  code: 'id',
  id: 'id',
  'vendor id': 'id',
  'vendor name': 'name',
  name: 'name',
  'contact person': 'contactPerson',
  contact: 'contactPerson',
  phone: 'phone',
  mobile: 'phone',
  email: 'email',
  address: 'address',
  gst: 'gst',
  gstin: 'gst',
  'tax id': 'gst',
};

export function buildVendorImportPlan(params: {
  csvText: string;
  existingVendors: readonly Vendor[];
  duplicatePolicy?: DirectoryDuplicatePolicy;
}): VendorImportPlan {
  const rows = parseCsvRows(params.csvText);
  if (rows.length < 2) {
    return {
      totalRows: 0,
      validRows: [],
      errors: [
        {
          rowNumber: 1,
          reason: 'CSV must include a header row and at least one vendor row.',
        },
      ],
    };
  }

  const colMap = new Map<keyof ParsedVendorImportRow, number>();
  rows[0].forEach((header, idx) => {
    const mapped = VENDOR_HEADER_MAP[normalizeHeaderKey(header)];
    if (mapped && !colMap.has(mapped)) colMap.set(mapped, idx);
  });

  if (!colMap.has('id') || !colMap.has('name')) {
    return {
      totalRows: rows.length - 1,
      validRows: [],
      errors: [
        {
          rowNumber: 1,
          reason: 'CSV must include manual "Vendor Code" and "Vendor Name" columns. Download Template CSV for the required format.',
        },
      ],
    };
  }

  const getCell = (cols: string[], key: keyof ParsedVendorImportRow) => {
    const idx = colMap.get(key);
    return idx !== undefined ? (cols[idx] ?? '').trim() : '';
  };

  const duplicatePolicy = params.duplicatePolicy || 'skip';
  const existingIds = new Set(params.existingVendors.map((v) => v.id.trim().toUpperCase()));
  const seenBatch = new Set<string>();
  const validRows: ParsedVendorImportRow[] = [];
  const errors: DirectoryImportErrorRow[] = [];

  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    if (cols.every((c) => !c.trim())) continue;
    const rowNumber = i + 1;

    const id = getCell(cols, 'id').toUpperCase();
    const name = getCell(cols, 'name');
    const contactPerson = getCell(cols, 'contactPerson');
    const phone = getCell(cols, 'phone');
    const email = getCell(cols, 'email');
    const address = getCell(cols, 'address');
    const gst = getCell(cols, 'gst').toUpperCase();

    if (!id) {
      errors.push({ rowNumber, name, reason: 'Manual Vendor Code is required.' });
      continue;
    }
    if (!/^[A-Z0-9_-]{2,24}$/.test(id)) {
      errors.push({
        rowNumber,
        code: id,
        name,
        reason: `Vendor Code "${id}" must be 2–24 alphanumeric characters (A-Z, 0-9, _, -).`,
      });
      continue;
    }
    if (!name) {
      errors.push({ rowNumber, code: id, reason: 'Vendor Name is required.' });
      continue;
    }
    if (seenBatch.has(id)) {
      errors.push({
        rowNumber,
        code: id,
        name,
        reason: `Duplicate Vendor Code "${id}" appears multiple times in the CSV.`,
      });
      continue;
    }
    if (existingIds.has(id) && duplicatePolicy === 'skip') {
      errors.push({
        rowNumber,
        code: id,
        name,
        reason: `Skipped: Vendor Code "${id}" already exists.`,
      });
      continue;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push({
        rowNumber,
        code: id,
        name,
        reason: `Invalid Email "${email}".`,
      });
      continue;
    }

    seenBatch.add(id);
    validRows.push({
      rowNumber,
      id,
      name,
      contactPerson,
      phone,
      email,
      address,
      gst,
    });
  }

  return {
    totalRows: rows.length - 1,
    validRows,
    errors,
  };
}
