import type {
  Asset,
  AssetCondition,
  AssetStatus,
  Assignment,
  Employee,
  PersonnelEntity,
  PersonnelEntityType,
} from '../types/asset';
import { calculateBookValue, calculateWarrantyExpiry } from './assetMath';
import { parseCsvRows } from './employeeImport';

/**
 * Existing Asset schema fields that MUST NOT be duplicated when integrating
 * the requested Add Asset fields list.
 */
export const EXISTING_ASSET_SCHEMA_FIELDS = [
  'Asset ID',
  'Brand',
  'Model',
  'Serial Number',
  'Purchase Date',
  'Purchase Cost (₹)',
  'Vendor / Supplier',
  'Invoice No.',
  'Warranty Expiry',
  'Department',
  'Office / Location',
  'Device Condition',
  'Current Status',
] as const;

export interface ExtendedAssetFieldSpec {
  key: keyof Asset;
  label: string;
  type: 'text' | 'date';
  placeholder?: string;
}

/**
 * Only the non-duplicate missing fields added to the Asset schema & Add Asset modal.
 */
export const EXTENDED_ASSET_FIELDS: readonly ExtendedAssetFieldSpec[] = [
  { key: 'rmnNumber', label: 'RMN Number', type: 'text', placeholder: 'e.g. RMN-9021' },
  { key: 'partNumber', label: 'Part Number', type: 'text', placeholder: 'e.g. PN-2026-X' },
  { key: 'eanNumber', label: 'EAN Number', type: 'text', placeholder: 'e.g. 8901234567890' },
  { key: 'imei1', label: 'IMEI / Device ID 1', type: 'text', placeholder: '15-digit IMEI 1' },
  { key: 'imei2', label: 'IMEI / Device ID 2', type: 'text', placeholder: '15-digit IMEI 2' },
  { key: 'snidNumber', label: 'SNID Number', type: 'text', placeholder: 'e.g. SNID-1104' },
  { key: 'vendorSupplierName', label: 'Vendor / Supplier Name', type: 'text', placeholder: 'Supplier legal name' },
  { key: 'projectName', label: 'PROJECT NAME', type: 'text', placeholder: 'e.g. National Field Study' },
  { key: 'projectNo', label: 'PROJECT NO', type: 'text', placeholder: 'e.g. JOB-2026-04' },
  { key: 'eicName', label: 'Assigned Employee', type: 'text', placeholder: 'Employee Name' },
  { key: 'assignedFlp', label: 'Assigned Freelancer', type: 'text', placeholder: 'Freelancer Name' },
  { key: 'flpId', label: 'Freelancer ID', type: 'text', placeholder: 'e.g. KOL000001' },
  { key: 'dateOfIssue', label: 'Date of Issue', type: 'date' },
  { key: 'dateOfReturn', label: 'Date of Return', type: 'date' },
  { key: 'accessoriesIssued', label: 'Accessories Issued', type: 'text', placeholder: 'Charger, SIM Card, Cover' },
  { key: 'lastVerificationDate', label: 'Last Verification Date', type: 'date' },
  { key: 'remarks', label: 'Remarks', type: 'text', placeholder: 'Operational notes' },
] as const;

export const REQUESTED_ASSET_FIELDS_WITH_DEDUP_STATUS: Array<{
  label: string;
  status: 'existing-escaped' | 'added';
  mappedProperty: keyof Asset;
}> = [
  { label: 'Asset ID', status: 'existing-escaped', mappedProperty: 'id' },
  { label: 'Brand', status: 'existing-escaped', mappedProperty: 'brand' },
  { label: 'Model', status: 'existing-escaped', mappedProperty: 'model' },
  { label: 'RMN Number', status: 'added', mappedProperty: 'rmnNumber' },
  { label: 'Part Number', status: 'added', mappedProperty: 'partNumber' },
  { label: 'Serial Number', status: 'existing-escaped', mappedProperty: 'serial' },
  { label: 'EAN Number', status: 'added', mappedProperty: 'eanNumber' },
  { label: 'IMEI / Device ID 1', status: 'added', mappedProperty: 'imei1' },
  { label: 'IMEI / Device ID 2', status: 'added', mappedProperty: 'imei2' },
  { label: 'SNID Number', status: 'added', mappedProperty: 'snidNumber' },
  { label: 'Purchase Date', status: 'existing-escaped', mappedProperty: 'purchaseDate' },
  { label: 'Purchase Cost (₹)', status: 'existing-escaped', mappedProperty: 'cost' },
  { label: 'Vendor / Supplier', status: 'existing-escaped', mappedProperty: 'vendor' },
  { label: 'Vendor / Supplier Name', status: 'added', mappedProperty: 'vendorSupplierName' },
  { label: 'Invoice No.', status: 'existing-escaped', mappedProperty: 'invoiceNumber' },
  { label: 'Warranty Expiry', status: 'existing-escaped', mappedProperty: 'warrantyExpiry' },
  { label: 'PROJECT NAME', status: 'added', mappedProperty: 'projectName' },
  { label: 'PROJECT NO', status: 'added', mappedProperty: 'projectNo' },
  { label: 'Assigned Employee', status: 'added', mappedProperty: 'eicName' },
  { label: 'Assigned Freelancer', status: 'added', mappedProperty: 'assignedFlp' },
  { label: 'Freelancer ID', status: 'added', mappedProperty: 'flpId' },
  { label: 'Department', status: 'existing-escaped', mappedProperty: 'department' },
  { label: 'Office / Location', status: 'existing-escaped', mappedProperty: 'location' },
  { label: 'Date of Issue', status: 'added', mappedProperty: 'dateOfIssue' },
  { label: 'Date of Return', status: 'added', mappedProperty: 'dateOfReturn' },
  { label: 'Device Condition', status: 'existing-escaped', mappedProperty: 'condition' },
  { label: 'Current Status', status: 'existing-escaped', mappedProperty: 'status' },
  { label: 'Accessories Issued', status: 'added', mappedProperty: 'accessoriesIssued' },
  { label: 'Last Verification Date', status: 'added', mappedProperty: 'lastVerificationDate' },
  { label: 'Remarks', status: 'added', mappedProperty: 'remarks' },
];

export const INVENTORY_EXPORT_HEADERS = [
  'Asset ID',
  'Employee Name',
  'Consultant Name',
  'Retainer Name',
  'Freelancer Name',
  'Young Research Program Name',
  'Intern Name',
  'Name',
  'Category',
  'Brand',
  'Serial',
  'Department',
  'Location',
  'Status',
  'Condition',
  'Cost',
  'Book Value',
  'Model',
  'RMN Number',
  'Part Number',
  'EAN Number',
  'IMEI / Device ID 1',
  'IMEI / Device ID 2',
  'SNID Number',
  'Purchase Date',
  'Vendor / Supplier',
  'Vendor / Supplier Name',
  'Invoice No.',
  'Warranty Expiry',
  'PROJECT NAME',
  'PROJECT NO',
  'Assigned Employee',
  'Assigned Freelancer',
  'Freelancer ID',
  'Date of Issue',
  'Date of Return',
  'Accessories Issued',
  'Last Verification Date',
  'Remarks',
] as const;

export interface ResolvedAssigneeColumns {
  employeeName: string;
  consultantName: string;
  retainerName: string;
  freelancerName: string;
  freelancerCode: string;
  yrpName: string;
  internName: string;
  issueDate: string;
  returnDate: string;
  projectName: string;
  projectNo: string;
  eicName: string;
}

export function resolveAssetAssigneeColumns(params: {
  asset: Asset;
  assignments: readonly Assignment[];
  employees: readonly Employee[];
  entities: readonly PersonnelEntity[];
}): ResolvedAssigneeColumns {
  const { asset, assignments, employees, entities } = params;
  const assetAssignments = assignments.filter((a) => a.assetId === asset.id);
  const activeAssignments = assetAssignments.filter((a) => a.status === 'Active');

  const out: ResolvedAssigneeColumns = {
    employeeName: '',
    consultantName: '',
    retainerName: '',
    freelancerName: '',
    freelancerCode: '',
    yrpName: '',
    internName: '',
    issueDate: asset.dateOfIssue || '',
    returnDate: asset.dateOfReturn || '',
    projectName: asset.projectName || '',
    projectNo: asset.projectNo || '',
    eicName: asset.eicName || '',
  };

  for (const asn of activeAssignments) {
    const emp = employees.find(
      (e) => e.id === asn.employeeId || e.employeeId.toUpperCase() === asn.employeeId.toUpperCase()
    );
    const ent = entities.find(
      (e) => e.id === asn.employeeId || e.entityCode.toUpperCase() === asn.employeeId.toUpperCase()
    );

    const detectedType: 'Employee' | PersonnelEntityType =
      asn.assigneeType || (ent ? ent.entityType : 'Employee');

    if (detectedType === 'Employee' && emp) {
      out.employeeName = emp.name;
    } else if (detectedType === 'Consultant' && (ent || emp)) {
      out.consultantName = (ent || emp)!.name;
    } else if (detectedType === 'Retainer' && (ent || emp)) {
      out.retainerName = (ent || emp)!.name;
    } else if (detectedType === 'Freelancer' && (ent || emp)) {
      out.freelancerName = (ent || emp)!.name;
      if (ent) out.freelancerCode = ent.entityCode;
    } else if (detectedType === 'Young Research Program' && (ent || emp)) {
      out.yrpName = (ent || emp)!.name;
    } else if (detectedType === 'Intern' && (ent || emp)) {
      out.internName = (ent || emp)!.name;
    }

    if (!out.issueDate && asn.assignDate) out.issueDate = asn.assignDate;
    if (!out.projectName && asn.projectName) out.projectName = asn.projectName;
    if (!out.projectNo && asn.projectNo) out.projectNo = asn.projectNo;
    if (!out.eicName && asn.eicName) out.eicName = asn.eicName;
  }

  if (!out.employeeName && asset.employeeName) {
    out.employeeName = asset.employeeName;
  }
  if (!out.consultantName && asset.consultantName) {
    out.consultantName = asset.consultantName;
  }
  if (!out.retainerName && asset.retainerName) {
    out.retainerName = asset.retainerName;
  }
  if (!out.freelancerName && (asset.freelancerName || asset.assignedFlp)) {
    out.freelancerName = asset.freelancerName || asset.assignedFlp || '';
  }
  if (!out.freelancerCode && asset.flpId) {
    out.freelancerCode = asset.flpId;
  }
  if (!out.yrpName && asset.yrpName) {
    out.yrpName = asset.yrpName;
  }
  if (!out.internName && asset.internName) {
    out.internName = asset.internName;
  }

  if (!out.returnDate) {
    const latestReturned = assetAssignments.find((a) => a.status === 'Returned' && a.returnDate);
    if (latestReturned?.returnDate) out.returnDate = latestReturned.returnDate;
  }

  return out;
}

function escapeCsvCell(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildInventoryCsvExport(params: {
  assets: readonly Asset[];
  assignments: readonly Assignment[];
  employees: readonly Employee[];
  entities: readonly PersonnelEntity[];
}): string {
  const { assets, assignments, employees, entities } = params;
  const rows = assets.map((asset) => {
    const bookVal = calculateBookValue({
      cost: asset.cost,
      purchaseDate: asset.purchaseDate,
      usefulLife: asset.usefulLife,
      salvageValue: asset.salvageValue,
      method: asset.depMethod,
    });
    const assignees = resolveAssetAssigneeColumns({
      asset,
      assignments,
      employees,
      entities,
    });

    return [
      asset.id,
      assignees.employeeName,
      assignees.consultantName,
      assignees.retainerName,
      assignees.freelancerName,
      assignees.yrpName,
      assignees.internName,
      asset.name,
      asset.category,
      asset.brand,
      asset.serial,
      asset.department,
      asset.location,
      asset.status,
      asset.condition,
      asset.cost,
      bookVal,
      asset.model || '',
      asset.rmnNumber || '',
      asset.partNumber || '',
      asset.eanNumber || '',
      asset.imei1 || '',
      asset.imei2 || '',
      asset.snidNumber || '',
      asset.purchaseDate || '',
      asset.vendor || '',
      asset.vendorSupplierName || '',
      asset.invoiceNumber || '',
      asset.warrantyExpiry || '',
      assignees.projectName,
      assignees.projectNo,
      assignees.eicName,
      assignees.freelancerName || asset.assignedFlp || '',
      assignees.freelancerCode || asset.flpId || '',
      assignees.issueDate,
      assignees.returnDate,
      asset.accessoriesIssued || '',
      asset.lastVerificationDate || '',
      asset.remarks || '',
    ].map(escapeCsvCell);
  });

  return [
    INVENTORY_EXPORT_HEADERS.map(escapeCsvCell).join(','),
    ...rows.map((r) => r.join(',')),
  ].join('\n');
}

export function buildAssetTemplateCsv(): string {
  const today = new Date().toISOString().split('T')[0];
  const sampleRow = [
    '', // Asset ID (auto-generated if blank)
    'Rahim Ahmed', // Employee Name
    '', // Consultant Name
    '', // Retainer Name
    '', // Freelancer Name
    '', // Young Research Program Name
    '', // Intern Name
    'Dell Latitude 5440', // Name / Asset Name
    'Laptop', // Category
    'Dell', // Brand
    'SN-LAT5440-1001', // Serial
    'IT', // Department
    'Floor 1', // Location
    'Assigned', // Status
    'New', // Condition
    '85000', // Cost
    '85000', // Book Value
    'Latitude 5440', // Model
    'RMN-5440-IN', // RMN Number
    'PN-LAT-01', // Part Number
    '8901234567890', // EAN Number
    '', // IMEI / Device ID 1
    '', // IMEI / Device ID 2
    'SNID-9081', // SNID Number
    today, // Purchase Date
    'Infosystem Pvt Ltd', // Vendor / Supplier
    'Infosystem Pvt Ltd', // Vendor / Supplier Name
    'INV-2026-101', // Invoice No.
    calculateWarrantyExpiry(today, 36), // Warranty Expiry
    'National Field Study', // PROJECT NAME
    'JOB-2026-01', // PROJECT NO
    'Rahim Ahmed', // Assigned Employee
    '', // Assigned Freelancer
    '', // Freelancer ID
    today, // Date of Issue
    '', // Date of Return
    'Laptop Bag, Charger', // Accessories Issued
    today, // Last Verification Date
    'Asset entry template sample row', // Remarks
  ].map(escapeCsvCell);

  return [
    INVENTORY_EXPORT_HEADERS.map(escapeCsvCell).join(','),
    sampleRow.join(','),
  ].join('\n');
}

function normalizeCsvHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const VALID_STATUSES = new Set<AssetStatus>([
  'Available',
  'Assigned',
  'Under Maintenance',
  'Disposed',
]);

const VALID_CONDITIONS = new Set<AssetCondition>([
  'New',
  'Good',
  'Fair',
  'Damaged',
  'Poor',
]);

export function parseAssetImportCsvRows(
  csvText: string
): Array<Omit<Asset, 'id'> & { id?: string }> {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) return [];

  const headerRow = rows[0].map((h) => normalizeCsvHeader(h));
  const headerIndex = new Map<string, number>();
  headerRow.forEach((key, idx) => {
    if (key && !headerIndex.has(key)) headerIndex.set(key, idx);
  });

  const hasTemplateHeaders =
    headerIndex.has('asset name') ||
    headerIndex.has('name') ||
    headerIndex.has('serial number') ||
    headerIndex.has('serial');

  const today = new Date().toISOString().split('T')[0];
  const items: Array<Omit<Asset, 'id'> & { id?: string }> = [];

  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i].map((c) => c.trim());
    if (cols.every((c) => !c)) continue;

    if (!hasTemplateHeaders) {
      if (!cols[0]) continue;
      const cost = parseFloat(cols[4]) || 0;
      items.push({
        name: cols[0],
        category: cols[1] || 'Laptop',
        subcategory: '',
        brand: cols[2] || '',
        serial: cols[3] || `SN-${Date.now()}-${i}`,
        purchaseDate: today,
        cost,
        vendor: '',
        warrantyMonths: 24,
        warrantyExpiry: calculateWarrantyExpiry(today, 24),
        department: cols[5] || 'IT',
        location: 'Floor 1',
        condition: 'Good',
        status: 'Available',
        depMethod: 'SLM',
        usefulLife: 5,
        salvageValue: 0,
        currentValue: cost,
        description: 'Imported via CSV',
      });
      continue;
    }

    const pick = (...aliases: string[]): string => {
      for (const alias of aliases) {
        const idx = headerIndex.get(normalizeCsvHeader(alias));
        if (idx !== undefined && cols[idx] !== undefined && cols[idx] !== '') {
          return cols[idx];
        }
      }
      return '';
    };

    const name = pick('Asset Name', 'Name');
    if (!name) continue;

    const rawId = pick('Asset ID');
    const rawStatus = pick('Status', 'Current Status') as AssetStatus;
    const rawCondition = pick('Condition', 'Device Condition') as AssetCondition;
    const cost = parseFloat(pick('Cost', 'Purchase Cost', 'Purchase Cost (₹)')) || 0;
    const bookValRaw = parseFloat(pick('Book Value', 'Current Value'));
    const purchaseDate = pick('Purchase Date') || today;
    const warrantyExpiry =
      pick('Warranty Expiry') || calculateWarrantyExpiry(purchaseDate, 24);
    const serial = pick('Serial Number', 'Serial') || `SN-${Date.now()}-${i}`;
    const employeeName = pick('Employee Name') || undefined;
    const consultantName = pick('Consultant Name') || undefined;
    const retainerName = pick('Retainer Name') || undefined;
    const freelancerName = pick('Freelancer Name') || undefined;
    const yrpName = pick('Young Research Program Name', 'YRP Name') || undefined;
    const internName = pick('Intern Name') || undefined;
    const assignedFlp = pick('Assigned Freelancer') || freelancerName || undefined;

    items.push({
      id: rawId ? rawId.toUpperCase() : undefined,
      name,
      category: pick('Category') || 'Laptop',
      subcategory: pick('Sub Category', 'Subcategory') || '',
      brand: pick('Brand') || '',
      model: pick('Model', 'Model Number') || undefined,
      serial,
      rmnNumber: pick('RMN Number') || undefined,
      partNumber: pick('Part Number') || undefined,
      eanNumber: pick('EAN Number') || undefined,
      imei1: pick('IMEI / Device ID 1', 'IMEI 1') || undefined,
      imei2: pick('IMEI / Device ID 2', 'IMEI 2') || undefined,
      snidNumber: pick('SNID Number') || undefined,
      purchaseDate,
      cost,
      vendor: pick('Vendor / Supplier', 'Vendor') || '',
      vendorSupplierName: pick('Vendor / Supplier Name') || undefined,
      invoiceNumber: pick('Invoice No.', 'Invoice No', 'Invoice Number') || undefined,
      warrantyMonths: parseInt(pick('Warranty (Months)', 'Warranty Months'), 10) || 24,
      warrantyExpiry,
      department: pick('Department') || 'IT',
      location: pick('Location', 'Office / Location') || 'Floor 1',
      condition: VALID_CONDITIONS.has(rawCondition) ? rawCondition : 'Good',
      status: VALID_STATUSES.has(rawStatus) ? rawStatus : 'Available',
      depMethod: 'SLM',
      usefulLife: 5,
      salvageValue: 0,
      currentValue: Number.isFinite(bookValRaw) ? bookValRaw : cost,
      description: pick('Description') || 'Imported via CSV',
      projectName: pick('PROJECT NAME', 'Project Name') || undefined,
      projectNo: pick('PROJECT NO', 'Project No') || undefined,
      eicName: pick('Assigned Employee') || employeeName || undefined,
      assignedFlp,
      flpId: pick('Freelancer ID') || undefined,
      dateOfIssue: pick('Date of Issue') || undefined,
      dateOfReturn: pick('Date of Return') || undefined,
      accessoriesIssued: pick('Accessories Issued') || undefined,
      lastVerificationDate: pick('Last Verification Date') || undefined,
      remarks: pick('Remarks') || undefined,
      employeeName,
      consultantName,
      retainerName,
      freelancerName,
      yrpName,
      internName,
    });
  }

  return items;
}
