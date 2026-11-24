import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { seedData } from '../data/seedData.ts';
import { DEFAULT_INDIAN_CENTER, normalizeCenterName } from '../data/indianCenters.ts';
import type {
  Asset,
  AssetOSState,
  AssetReturn,
  AssetStatus,
  AssetTransfer,
  AssigneeEntityType,
  Assignment,
  BulkDirectoryImportResult,
  CompanySettings,
  DepartmentDesignation,
  DisposalRecord,
  Employee,
  EmploymentCategory,
  EmploymentConversionRecord,
  ExpenseCategoryRecord,
  ExpenseRecord,
  FreelancerAccessoryItem,
  FreelancerAllotmentRecord,
  HistoryEntry,
  MaintenanceRecord,
  PaymentModeRecord,
  PersonnelEntity,
  SupportTicket,
  SystemAuditLog,
  Vendor,
} from '../types/asset.ts';
import type { EmployeeCenterRecord } from '../types/policy.ts';
import type { SessionUser } from '../types/user.ts';
import { calculateBookValue, generateNextId, normalizeThemePalette } from '../utils/assetMath.ts';
import {
  buildVendorImportPlan,
  type DirectoryDuplicatePolicy,
} from '../utils/directoryImportExport.ts';
import {
  resolveCenterOfficeInfo,
  validateFreelancerAllotmentInput,
} from '../utils/entityValidation.ts';
import { isAdminRole } from '../utils/hierarchyLogic.ts';
import { resolveEffectiveTicketStatus, sortTicketsFcfs } from '../utils/ticketLogic.ts';

export interface AuditActorContext {
  userId: string;
  userName: string;
  userRole: string;
  ipAddress: string;
}

export function writeSystemAuditLog(
  db: DatabaseSync,
  params: {
    module: string;
    entityType: string;
    entityId: string;
    action: string;
    actor: AuditActorContext;
    beforeObj?: unknown;
    afterObj?: unknown;
    details: string;
  }
): SystemAuditLog {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const beforeJson = params.beforeObj !== undefined && params.beforeObj !== null ? JSON.stringify(params.beforeObj) : null;
  const afterJson = params.afterObj !== undefined && params.afterObj !== null ? JSON.stringify(params.afterObj) : null;

  db.prepare(
    `INSERT INTO System_Audit_Logs (
      id, module, entity_type, entity_id, action, actor_user_id, actor_name,
      actor_role, ip_address, before_json, after_json, details, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.module,
    params.entityType,
    params.entityId,
    params.action,
    params.actor.userId,
    params.actor.userName,
    params.actor.userRole,
    params.actor.ipAddress || '127.0.0.1',
    beforeJson,
    afterJson,
    params.details,
    createdAt
  );

  return {
    id,
    module: params.module,
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    actorUserId: params.actor.userId,
    actorName: params.actor.userName,
    actorRole: params.actor.userRole,
    ipAddress: params.actor.ipAddress || '127.0.0.1',
    beforeJson,
    afterJson,
    details: params.details,
    createdAt,
  };
}

export function listSystemAuditLogsFromDb(db: DatabaseSync, limit = 250): SystemAuditLog[] {
  const rows = db
    .prepare(
      `SELECT id, module, entity_type, entity_id, action, actor_user_id, actor_name,
              actor_role, ip_address, before_json, after_json, details, created_at
       FROM System_Audit_Logs
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(limit) as Array<{
    id: string;
    module: string;
    entity_type: string;
    entity_id: string;
    action: string;
    actor_user_id: string;
    actor_name: string;
    actor_role: string;
    ip_address: string;
    before_json: string | null;
    after_json: string | null;
    details: string;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    module: r.module,
    entityType: r.entity_type,
    entityId: r.entity_id,
    action: r.action,
    actorUserId: r.actor_user_id,
    actorName: r.actor_name,
    actorRole: r.actor_role,
    ipAddress: r.ip_address,
    beforeJson: r.before_json,
    afterJson: r.after_json,
    details: r.details,
    createdAt: r.created_at,
  }));
}

function mapAssetRow(r: Record<string, unknown>): Asset {
  return {
    id: String(r.id),
    name: String(r.name),
    category: String(r.category),
    subcategory: String(r.subcategory || ''),
    brand: String(r.brand || ''),
    model: r.model ? String(r.model) : undefined,
    serial: String(r.serial),
    rmnNumber: r.rmn_number ? String(r.rmn_number) : undefined,
    partNumber: r.part_number ? String(r.part_number) : undefined,
    eanNumber: r.ean_number ? String(r.ean_number) : undefined,
    imei1: r.imei1 ? String(r.imei1) : undefined,
    imei2: r.imei2 ? String(r.imei2) : undefined,
    snidNumber: r.snid_number ? String(r.snid_number) : undefined,
    purchaseDate: String(r.purchase_date || ''),
    cost: Number(r.cost) || 0,
    vendor: String(r.vendor || ''),
    vendorSupplierName: r.vendor_supplier_name ? String(r.vendor_supplier_name) : undefined,
    invoiceNumber: r.invoice_number ? String(r.invoice_number) : undefined,
    warrantyMonths: Number(r.warranty_months) || 0,
    warrantyExpiry: String(r.warranty_expiry || ''),
    department: String(r.department || 'IT'),
    location: String(r.location || 'Floor 1'),
    condition: (r.condition as Asset['condition']) || 'Good',
    status: (r.status as AssetStatus) || 'Available',
    depMethod: (r.dep_method as Asset['depMethod']) || 'SLM',
    usefulLife: Number(r.useful_life) || 5,
    salvageValue: Number(r.salvage_value) || 0,
    currentValue: Number(r.current_value) || 0,
    description: String(r.description || ''),
    image: r.image ? String(r.image) : undefined,
    projectName: r.project_name ? String(r.project_name) : undefined,
    projectNo: r.project_no ? String(r.project_no) : undefined,
    eicName: r.eic_name ? String(r.eic_name) : undefined,
    assignedFlp: r.assigned_flp ? String(r.assigned_flp) : undefined,
    flpId: r.flp_id ? String(r.flp_id) : undefined,
    dateOfIssue: r.date_of_issue ? String(r.date_of_issue) : undefined,
    dateOfReturn: r.date_of_return ? String(r.date_of_return) : undefined,
    accessoriesIssued: r.accessories_issued ? String(r.accessories_issued) : undefined,
    lastVerificationDate: r.last_verification_date ? String(r.last_verification_date) : undefined,
    remarks: r.remarks ? String(r.remarks) : undefined,
  };
}

function insertAssetStmt(db: DatabaseSync) {
  return db.prepare(`
    INSERT OR REPLACE INTO Assets (
      id, name, category, subcategory, brand, model, serial,
      rmn_number, part_number, ean_number, imei1, imei2, snid_number,
      purchase_date, cost, vendor, vendor_supplier_name,
      invoice_number, warranty_months, warranty_expiry, department, location, condition, status,
      dep_method, useful_life, salvage_value, current_value, description, image,
      project_name, project_no, eic_name, assigned_flp, flp_id,
      date_of_issue, date_of_return, accessories_issued, last_verification_date, remarks
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
}

function runInsertAsset(stmt: ReturnType<DatabaseSync['prepare']>, a: Asset) {
  stmt.run(
    a.id,
    a.name,
    a.category,
    a.subcategory || '',
    a.brand || '',
    a.model || '',
    a.serial,
    a.rmnNumber || '',
    a.partNumber || '',
    a.eanNumber || '',
    a.imei1 || '',
    a.imei2 || '',
    a.snidNumber || '',
    a.purchaseDate || '',
    Number(a.cost) || 0,
    a.vendor || '',
    a.vendorSupplierName || '',
    a.invoiceNumber || '',
    Number(a.warrantyMonths) || 0,
    a.warrantyExpiry || '',
    a.department || 'IT',
    a.location || 'Floor 1',
    a.condition || 'Good',
    a.status || 'Available',
    a.depMethod || 'SLM',
    Number(a.usefulLife) || 5,
    Number(a.salvageValue) || 0,
    Number(a.currentValue) || 0,
    a.description || '',
    a.image || '',
    a.projectName || '',
    a.projectNo || '',
    a.eicName || '',
    a.assignedFlp || '',
    a.flpId || '',
    a.dateOfIssue || '',
    a.dateOfReturn || '',
    a.accessoriesIssued || '',
    a.lastVerificationDate || '',
    a.remarks || ''
  );
}

function ensureColumn(db: DatabaseSync, tableName: string, colName: string, colDef: string) {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === colName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${colDef}`);
  }
}

export function seedWorkspaceTablesIfNeeded(db: DatabaseSync): void {
  const tktCols = db.prepare(`PRAGMA table_info(Support_Tickets)`).all() as Array<{ name: string }>;
  const tktColSet = new Set(tktCols.map((c) => c.name));
  if (!tktColSet.has('booked_slot_id')) db.exec(`ALTER TABLE Support_Tickets ADD COLUMN booked_slot_id TEXT`);
  if (!tktColSet.has('approval_status')) db.exec(`ALTER TABLE Support_Tickets ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'Pending'`);
  if (!tktColSet.has('approved_by')) db.exec(`ALTER TABLE Support_Tickets ADD COLUMN approved_by TEXT`);
  if (!tktColSet.has('approved_at')) db.exec(`ALTER TABLE Support_Tickets ADD COLUMN approved_at TEXT`);
  if (!tktColSet.has('rejection_reason')) db.exec(`ALTER TABLE Support_Tickets ADD COLUMN rejection_reason TEXT`);
  if (!tktColSet.has('queue_order')) db.exec(`ALTER TABLE Support_Tickets ADD COLUMN queue_order INTEGER NOT NULL DEFAULT 0`);
  if (!tktColSet.has('created_by_role')) db.exec(`ALTER TABLE Support_Tickets ADD COLUMN created_by_role TEXT`);
  if (!tktColSet.has('requested_date')) db.exec(`ALTER TABLE Support_Tickets ADD COLUMN requested_date TEXT`);
  if (!tktColSet.has('requested_start_time')) db.exec(`ALTER TABLE Support_Tickets ADD COLUMN requested_start_time TEXT`);
  if (!tktColSet.has('requested_duration_mins')) db.exec(`ALTER TABLE Support_Tickets ADD COLUMN requested_duration_mins INTEGER`);
  if (!tktColSet.has('work_order_date')) db.exec(`ALTER TABLE Support_Tickets ADD COLUMN work_order_date TEXT`);
  if (!tktColSet.has('work_order_start_time')) db.exec(`ALTER TABLE Support_Tickets ADD COLUMN work_order_start_time TEXT`);
  if (!tktColSet.has('work_order_duration_mins')) db.exec(`ALTER TABLE Support_Tickets ADD COLUMN work_order_duration_mins INTEGER`);
  if (!tktColSet.has('work_order_end_time')) db.exec(`ALTER TABLE Support_Tickets ADD COLUMN work_order_end_time TEXT`);
  if (!tktColSet.has('employee_confirmed')) db.exec(`ALTER TABLE Support_Tickets ADD COLUMN employee_confirmed INTEGER NOT NULL DEFAULT 0`);
  if (!tktColSet.has('employee_confirmed_at')) db.exec(`ALTER TABLE Support_Tickets ADD COLUMN employee_confirmed_at TEXT`);
  if (!tktColSet.has('work_order_mail_sent_at')) db.exec(`ALTER TABLE Support_Tickets ADD COLUMN work_order_mail_sent_at TEXT`);
  if (!tktColSet.has('closed_by')) db.exec(`ALTER TABLE Support_Tickets ADD COLUMN closed_by TEXT`);
  if (!tktColSet.has('closed_at')) db.exec(`ALTER TABLE Support_Tickets ADD COLUMN closed_at TEXT`);

  // Idempotent extended Asset columns
  ensureColumn(db, 'Assets', 'rmn_number', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'Assets', 'part_number', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'Assets', 'ean_number', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'Assets', 'imei1', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'Assets', 'imei2', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'Assets', 'snid_number', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'Assets', 'vendor_supplier_name', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'Assets', 'project_name', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'Assets', 'project_no', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'Assets', 'eic_name', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'Assets', 'assigned_flp', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'Assets', 'flp_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'Assets', 'date_of_issue', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'Assets', 'date_of_return', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'Assets', 'accessories_issued', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'Assets', 'last_verification_date', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'Assets', 'remarks', "TEXT NOT NULL DEFAULT ''");

  // Idempotent custody chain columns on Assignments
  ensureColumn(db, 'Assignments', 'assignee_type', "TEXT NOT NULL DEFAULT 'Employee'");
  ensureColumn(db, 'Assignments', 'assigned_by_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'Assignments', 'assigned_by_role', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'Assignments', 'parent_assignment_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'Assignments', 'custody_level', "TEXT NOT NULL DEFAULT 'Primary'");
  ensureColumn(db, 'Assignments', 'return_date', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'Assignments', 'project_name', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'Assignments', 'project_no', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'Assignments', 'eic_name', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'Assignments', 'allotment_id', "TEXT NOT NULL DEFAULT ''");

  db.exec(`
    CREATE TABLE IF NOT EXISTS Freelancer_Allotments (
      id TEXT PRIMARY KEY,
      assignment_id TEXT NOT NULL,
      asset_ids_json TEXT NOT NULL DEFAULT '[]',
      flp_id TEXT NOT NULL,
      flp_name TEXT NOT NULL,
      flp_code TEXT NOT NULL,
      flp_address TEXT NOT NULL DEFAULT '',
      aadhaar_no TEXT NOT NULL DEFAULT '',
      pan_no TEXT NOT NULL DEFAULT '',
      mobile_no TEXT NOT NULL DEFAULT '',
      center_name TEXT NOT NULL DEFAULT 'Kolkata',
      center_address TEXT NOT NULL DEFAULT '',
      center_phone TEXT NOT NULL DEFAULT '',
      executive_name TEXT NOT NULL DEFAULT '',
      executive_emp_id TEXT NOT NULL DEFAULT '',
      job_number TEXT NOT NULL DEFAULT '',
      issue_date TEXT NOT NULL,
      accessories_json TEXT NOT NULL DEFAULT '[]',
      remarks TEXT NOT NULL DEFAULT '',
      witness1_name TEXT NOT NULL DEFAULT '',
      witness2_name TEXT NOT NULL DEFAULT '',
      allotment_date TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS Expense_Categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS Payment_Modes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const expCatCount = (db.prepare(`SELECT COUNT(*) as c FROM Expense_Categories`).get() as { c: number }).c;
  if (expCatCount === 0) {
    const nowIso = new Date().toISOString();
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO Expense_Categories (id, name, description, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`
    );
    for (const [id, name, desc] of [
      ['ECAT-01', 'Insurance', 'Asset insurance premiums & protection coverage'],
      ['ECAT-02', 'Repair', 'Hardware repairs, spare parts & diagnostics'],
      ['ECAT-03', 'Software', 'Software licenses, SaaS & renewals'],
      ['ECAT-04', 'Misc', 'Miscellaneous operational expenses'],
      ['ECAT-05', 'Equipment Purchase', 'Direct IT equipment & accessory purchases'],
      ['ECAT-06', 'Travel & Logistics', 'Device courier, transit & field logistics'],
      ['ECAT-07', 'AMC / Support', 'Annual maintenance & support contracts'],
    ]) {
      stmt.run(id, name, desc, nowIso, nowIso);
    }
  }

  const payModeCount = (db.prepare(`SELECT COUNT(*) as c FROM Payment_Modes`).get() as { c: number }).c;
  if (payModeCount === 0) {
    const nowIso = new Date().toISOString();
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO Payment_Modes (id, name, description, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`
    );
    for (const [id, name, desc] of [
      ['PMODE-01', 'Cash', 'Petty cash / office cash voucher'],
      ['PMODE-02', 'Bank Transfer', 'NEFT / RTGS / IMPS bank transfer'],
      ['PMODE-03', 'Corporate Card', 'Company corporate credit/debit card'],
      ['PMODE-04', 'Cheque', 'Account payee cheque'],
      ['PMODE-05', 'UPI', 'Unified Payments Interface'],
      ['PMODE-06', 'Online Payment', 'Netbanking / payment gateway'],
    ]) {
      stmt.run(id, name, desc, nowIso, nowIso);
    }
  }

  const settingsRow = db.prepare(`SELECT seed_initialized FROM App_Settings WHERE id = 'default'`).get() as
    | { seed_initialized: number }
    | undefined;
  if (settingsRow && settingsRow.seed_initialized === 1) {
    return;
  }

  const nowIso = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT OR IGNORE INTO App_Settings (
        id, settings_json, categories_json, departments_json, locations_json, seed_initialized, updated_at
      ) VALUES ('default', ?, ?, ?, ?, 1, ?)`
    ).run(
      JSON.stringify(seedData.settings),
      JSON.stringify(seedData.categories),
      JSON.stringify(seedData.departments),
      JSON.stringify(seedData.locations),
      nowIso
    );

    const assetCount = (db.prepare(`SELECT COUNT(*) as c FROM Assets`).get() as { c: number }).c;
    if (assetCount === 0) {
      const stmt = insertAssetStmt(db);
      for (const a of seedData.assets) runInsertAsset(stmt, a);
    }

    const vendorCount = (db.prepare(`SELECT COUNT(*) as c FROM Vendors`).get() as { c: number }).c;
    if (vendorCount === 0) {
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO Vendors (id, name, contact_person, phone, email, address, gst, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const v of seedData.vendors) {
        stmt.run(v.id, v.name, v.contactPerson || '', v.phone || '', v.email || '', v.address || '', v.gst || '', v.remarks || '');
      }
    }

    const asnCount = (db.prepare(`SELECT COUNT(*) as c FROM Assignments`).get() as { c: number }).c;
    if (asnCount === 0) {
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO Assignments (id, asset_id, employee_id, assign_date, condition, assigned_by, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const a of seedData.assignments) {
        stmt.run(a.id, a.assetId, a.employeeId, a.assignDate, a.condition || 'Good', a.assignedBy || '', a.notes || '', a.status || 'Active');
      }
    }

    const retCount = (db.prepare(`SELECT COUNT(*) as c FROM Asset_Returns`).get() as { c: number }).c;
    if (retCount === 0) {
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO Asset_Returns (id, return_date, employee_id, asset_id, condition, damage, remarks) VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const r of seedData.returns) {
        stmt.run(r.id, r.date, r.employeeId, r.assetId, r.condition, r.damage, r.remarks || '');
      }
    }

    const trfCount = (db.prepare(`SELECT COUNT(*) as c FROM Asset_Transfers`).get() as { c: number }).c;
    if (trfCount === 0) {
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO Asset_Transfers (id, transfer_date, asset_id, from_dept, to_dept, from_emp, to_emp, new_location, reason, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const t of seedData.transfers) {
        stmt.run(t.id, t.date, t.assetId, t.fromDept, t.toDept, t.fromEmp, t.toEmp, t.newLocation || '', t.reason || '', t.remarks || '');
      }
    }

    const mntCount = (db.prepare(`SELECT COUNT(*) as c FROM Maintenance_Records`).get() as { c: number }).c;
    if (mntCount === 0) {
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO Maintenance_Records (id, asset_id, type, cost, vendor, status, service_date, next_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const m of seedData.maintenance) {
        stmt.run(m.id, m.assetId, m.type, Number(m.cost) || 0, m.vendor || '', m.status, m.serviceDate, m.nextDate || '', m.notes || '');
      }
    }

    const dspCount = (db.prepare(`SELECT COUNT(*) as c FROM Disposals`).get() as { c: number }).c;
    if (dspCount === 0) {
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO Disposals (id, asset_id, disposal_date, salvage_recovered, reason, notes) VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const d of seedData.disposals) {
        stmt.run(d.id, d.assetId, d.disposalDate, Number(d.salvageRecovered) || 0, d.reason || '', d.notes || '');
      }
    }

    const expCount = (db.prepare(`SELECT COUNT(*) as c FROM Expenses`).get() as { c: number }).c;
    if (expCount === 0) {
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO Expenses (id, expense_date, category, paid_to, amount, mode, remarks) VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const e of seedData.expenses) {
        stmt.run(e.id, e.date, e.category, e.paidTo, Number(e.amount) || 0, e.mode, e.remarks || '');
      }
    }

    const tktCount = (db.prepare(`SELECT COUNT(*) as c FROM Support_Tickets`).get() as { c: number }).c;
    if (tktCount === 0) {
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO Support_Tickets (id, employee_id, asset_id, subject, description, priority, status, created_at, queue_order, booked_slot_id, approval_status, approved_by, approved_at, rejection_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      seedData.tickets.forEach((t, idx) => {
        stmt.run(
          t.id,
          t.employeeId,
          t.assetId,
          t.subject,
          t.description,
          t.priority || 'Medium',
          t.status || 'Requested',
          t.createdAt,
          t.queueOrder ?? idx + 1,
          t.bookedSlotId || null,
          t.approvalStatus || 'Pending',
          t.approvedBy || null,
          t.approvedAt || null,
          t.rejectionReason || null
        );
      });
    }

    const histCount = (db.prepare(`SELECT COUNT(*) as c FROM Asset_History`).get() as { c: number }).c;
    if (histCount === 0) {
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO Asset_History (id, asset_id, event_date, activity, details, seq_order) VALUES (?, ?, ?, ?, ?, ?)`
      );
      seedData.history.forEach((h, idx) => {
        stmt.run(h.id || crypto.randomUUID(), h.assetId, h.date, h.activity, h.details, seedData.history.length - idx);
      });
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getWorkspaceSettingsFromDb(db: DatabaseSync): {
  settings: CompanySettings;
  categories: string[];
  departments: string[];
  locations: string[];
} {
  const row = db
    .prepare(`SELECT settings_json, categories_json, departments_json, locations_json FROM App_Settings WHERE id = 'default'`)
    .get() as
    | {
        settings_json: string;
        categories_json: string;
        departments_json: string;
        locations_json: string;
      }
    | undefined;

  if (!row) {
    return {
      settings: {
        ...seedData.settings,
        theme: normalizeThemePalette(seedData.settings.theme),
      },
      categories: seedData.categories,
      departments: seedData.departments,
      locations: seedData.locations,
    };
  }

  const parsedSettings = { ...seedData.settings, ...JSON.parse(row.settings_json) } as CompanySettings;
  return {
    settings: {
      ...parsedSettings,
      theme: normalizeThemePalette(parsedSettings.theme),
    },
    categories: JSON.parse(row.categories_json),
    departments: JSON.parse(row.departments_json),
    locations: JSON.parse(row.locations_json),
  };
}

export function updateWorkspaceSettingsInDb(
  db: DatabaseSync,
  updates: {
    settings?: CompanySettings;
    categories?: string[];
    departments?: string[];
    locations?: string[];
  },
  actor: AuditActorContext
) {
  const current = getWorkspaceSettingsFromDb(db);
  const nextSettings = updates.settings ? { ...current.settings, ...updates.settings } : current.settings;
  const nextCategories = updates.categories ?? current.categories;
  const nextDepartments = updates.departments ?? current.departments;
  const nextLocations = updates.locations ?? current.locations;
  const nowIso = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO App_Settings (id, settings_json, categories_json, departments_json, locations_json, seed_initialized, updated_at)
       VALUES ('default', ?, ?, ?, ?, 1, ?)
       ON CONFLICT(id) DO UPDATE SET
         settings_json = excluded.settings_json,
         categories_json = excluded.categories_json,
         departments_json = excluded.departments_json,
         locations_json = excluded.locations_json,
         updated_at = excluded.updated_at`
    ).run(
      JSON.stringify(nextSettings),
      JSON.stringify(nextCategories),
      JSON.stringify(nextDepartments),
      JSON.stringify(nextLocations),
      nowIso
    );

    writeSystemAuditLog(db, {
      module: 'Settings',
      entityType: 'App_Settings',
      entityId: 'default',
      action: 'SETTINGS_UPDATED',
      actor,
      beforeObj: current,
      afterObj: { settings: nextSettings, categories: nextCategories, departments: nextDepartments, locations: nextLocations },
      details: 'Updated application settings / master lists',
    });

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return getWorkspaceSettingsFromDb(db);
}

export function listAssetsFromDb(db: DatabaseSync): Asset[] {
  const rows = db.prepare(`SELECT * FROM Assets ORDER BY id DESC`).all() as Array<Record<string, unknown>>;
  return rows.map(mapAssetRow);
}

export function addAssetHistoryInDb(
  db: DatabaseSync,
  entry: Omit<HistoryEntry, 'id'> & { id?: string }
): HistoryEntry {
  const maxOrderRow = db.prepare(`SELECT COALESCE(MAX(seq_order), 0) as m FROM Asset_History`).get() as { m: number };
  const id = entry.id || crypto.randomUUID();
  db.prepare(
    `INSERT INTO Asset_History (id, asset_id, event_date, activity, details, seq_order) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, entry.assetId, entry.date, entry.activity, entry.details, (maxOrderRow?.m || 0) + 1);
  return { id, ...entry };
}

export function listAssetHistoryFromDb(db: DatabaseSync): HistoryEntry[] {
  const rows = db
    .prepare(`SELECT id, asset_id, event_date, activity, details FROM Asset_History ORDER BY seq_order DESC, event_date DESC`)
    .all() as Array<{ id: string; asset_id: string; event_date: string; activity: HistoryEntry['activity']; details: string }>;
  return rows.map((r) => ({
    id: r.id,
    assetId: r.asset_id,
    date: r.event_date,
    activity: r.activity,
    details: r.details,
  }));
}

export function listExpenseCategoriesFromDb(
  db: DatabaseSync,
  activeOnly = false
): ExpenseCategoryRecord[] {
  const hasTbl = Boolean(
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Expense_Categories' LIMIT 1`).get()
  );
  if (!hasTbl) return [];
  const rows = db
    .prepare(
      `SELECT * FROM Expense_Categories ${activeOnly ? 'WHERE is_active = 1' : ''} ORDER BY name ASC`
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    description: r.description ? String(r.description) : '',
    active: Number(r.is_active) === 1,
    createdAt: r.created_at ? String(r.created_at) : undefined,
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
  }));
}

export function listPaymentModesFromDb(
  db: DatabaseSync,
  activeOnly = false
): PaymentModeRecord[] {
  const hasTbl = Boolean(
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Payment_Modes' LIMIT 1`).get()
  );
  if (!hasTbl) return [];
  const rows = db
    .prepare(
      `SELECT * FROM Payment_Modes ${activeOnly ? 'WHERE is_active = 1' : ''} ORDER BY name ASC`
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    description: r.description ? String(r.description) : '',
    active: Number(r.is_active) === 1,
    createdAt: r.created_at ? String(r.created_at) : undefined,
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
  }));
}

export function listWorkspaceStateFromDb(
  db: DatabaseSync,
  scopedEmployees: Employee[],
  viewer?: SessionUser
): AssetOSState {
  const cfg = getWorkspaceSettingsFromDb(db);
  const assets = listAssetsFromDb(db);
  const vendors = (db.prepare(`SELECT * FROM Vendors ORDER BY id DESC`).all() as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    contactPerson: String(r.contact_person || ''),
    phone: String(r.phone || ''),
    email: String(r.email || ''),
    address: String(r.address || ''),
    gst: String(r.gst || ''),
    remarks: r.remarks ? String(r.remarks) : undefined,
  }));
  const assignments: Assignment[] = (
    db.prepare(`SELECT * FROM Assignments ORDER BY assign_date DESC, id DESC`).all() as Array<Record<string, unknown>>
  ).map((r) => ({
    id: String(r.id),
    assetId: String(r.asset_id),
    employeeId: String(r.employee_id),
    assigneeType: ((r.assignee_type ? String(r.assignee_type) : 'Employee') as AssigneeEntityType),
    assignedById: r.assigned_by_id ? String(r.assigned_by_id) : undefined,
    assignedByRole: r.assigned_by_role ? String(r.assigned_by_role) : undefined,
    parentAssignmentId: r.parent_assignment_id ? String(r.parent_assignment_id) : undefined,
    custodyLevel: (r.custody_level === 'Sub-Assigned' ? 'Sub-Assigned' : 'Primary') as Assignment['custodyLevel'],
    assignDate: String(r.assign_date),
    returnDate: r.return_date ? String(r.return_date) : undefined,
    condition: (r.condition as Asset['condition']) || 'Good',
    assignedBy: r.assigned_by ? String(r.assigned_by) : undefined,
    notes: r.notes ? String(r.notes) : undefined,
    projectName: r.project_name ? String(r.project_name) : undefined,
    projectNo: r.project_no ? String(r.project_no) : undefined,
    eicName: r.eic_name ? String(r.eic_name) : undefined,
    allotmentId: r.allotment_id ? String(r.allotment_id) : undefined,
    status: (r.status as Assignment['status']) || 'Active',
  }));
  const returns = (db.prepare(`SELECT * FROM Asset_Returns ORDER BY return_date DESC, id DESC`).all() as Array<Record<string, unknown>>).map(
    (r) => ({
      id: String(r.id),
      date: String(r.return_date),
      employeeId: String(r.employee_id),
      assetId: String(r.asset_id),
      condition: (r.condition as Asset['condition']) || 'Good',
      damage: (r.damage as AssetReturn['damage']) || 'No Damage',
      remarks: r.remarks ? String(r.remarks) : undefined,
    })
  );
  const transfers = (db.prepare(`SELECT * FROM Asset_Transfers ORDER BY transfer_date DESC, id DESC`).all() as Array<Record<string, unknown>>).map(
    (r) => ({
      id: String(r.id),
      date: String(r.transfer_date),
      assetId: String(r.asset_id),
      fromDept: String(r.from_dept || ''),
      toDept: String(r.to_dept || ''),
      fromEmp: String(r.from_emp || ''),
      toEmp: String(r.to_emp || ''),
      newLocation: r.new_location ? String(r.new_location) : undefined,
      reason: String(r.reason || ''),
      remarks: r.remarks ? String(r.remarks) : undefined,
    })
  );
  const maintenance = (
    db.prepare(`SELECT * FROM Maintenance_Records ORDER BY service_date DESC, id DESC`).all() as Array<Record<string, unknown>>
  ).map((r) => ({
    id: String(r.id),
    assetId: String(r.asset_id),
    type: (r.type as MaintenanceRecord['type']) || 'Preventive',
    cost: Number(r.cost) || 0,
    vendor: String(r.vendor || ''),
    status: (r.status as MaintenanceRecord['status']) || 'Open',
    serviceDate: String(r.service_date),
    nextDate: String(r.next_date || ''),
    notes: String(r.notes || ''),
  }));
  const disposals = (db.prepare(`SELECT * FROM Disposals ORDER BY disposal_date DESC, id DESC`).all() as Array<Record<string, unknown>>).map(
    (r) => ({
      id: String(r.id),
      assetId: String(r.asset_id),
      disposalDate: String(r.disposal_date),
      salvageRecovered: Number(r.salvage_recovered) || 0,
      reason: String(r.reason || ''),
      notes: String(r.notes || ''),
    })
  );
  const expenses = (db.prepare(`SELECT * FROM Expenses ORDER BY expense_date DESC, id DESC`).all() as Array<Record<string, unknown>>).map(
    (r) => ({
      id: String(r.id),
      date: String(r.expense_date),
      category: (r.category as ExpenseRecord['category']) || 'Misc',
      paidTo: String(r.paid_to || ''),
      amount: Number(r.amount) || 0,
      mode: (r.mode as ExpenseRecord['mode']) || 'Cash',
      remarks: String(r.remarks || ''),
    })
  );
  const rawTicketRows = db
    .prepare(`SELECT * FROM Support_Tickets ORDER BY CASE WHEN queue_order > 0 THEN queue_order ELSE 999999 END ASC, created_at ASC`)
    .all() as Array<Record<string, unknown>>;

  const markOverrunStmt = db.prepare(`UPDATE Support_Tickets SET status = 'Open' WHERE id = ? AND status = 'Approved'`);
  const mappedTickets: SupportTicket[] = rawTicketRows.map((r) => {
    const ticket: SupportTicket = {
      id: String(r.id),
      employeeId: String(r.employee_id),
      assetId: String(r.asset_id),
      subject: String(r.subject),
      description: String(r.description),
      priority: (r.priority as SupportTicket['priority']) || 'Medium',
      status: (r.status as SupportTicket['status']) || 'Requested',
      createdAt: String(r.created_at),
      queueOrder: r.queue_order !== null && r.queue_order !== undefined ? Number(r.queue_order) : undefined,
      createdByRole: r.created_by_role ? String(r.created_by_role) : undefined,
      requestedDate: r.requested_date ? String(r.requested_date) : undefined,
      requestedStartTime: r.requested_start_time ? String(r.requested_start_time) : undefined,
      requestedDurationMins:
        r.requested_duration_mins !== null && r.requested_duration_mins !== undefined
          ? Number(r.requested_duration_mins)
          : undefined,
      bookedSlotId: r.booked_slot_id ? String(r.booked_slot_id) : undefined,
      workOrderDate: r.work_order_date ? String(r.work_order_date) : undefined,
      workOrderStartTime: r.work_order_start_time ? String(r.work_order_start_time) : undefined,
      workOrderDurationMins:
        r.work_order_duration_mins !== null && r.work_order_duration_mins !== undefined
          ? Number(r.work_order_duration_mins)
          : undefined,
      workOrderEndTime: r.work_order_end_time ? String(r.work_order_end_time) : undefined,
      employeeConfirmed: Boolean(r.employee_confirmed),
      employeeConfirmedAt: r.employee_confirmed_at ? String(r.employee_confirmed_at) : undefined,
      workOrderMailSentAt: r.work_order_mail_sent_at ? String(r.work_order_mail_sent_at) : undefined,
      approvalStatus: (r.approval_status as SupportTicket['approvalStatus']) || 'Pending',
      approvedBy: r.approved_by ? String(r.approved_by) : undefined,
      approvedAt: r.approved_at ? String(r.approved_at) : undefined,
      rejectionReason: r.rejection_reason ? String(r.rejection_reason) : undefined,
      closedBy: r.closed_by ? String(r.closed_by) : undefined,
      closedAt: r.closed_at ? String(r.closed_at) : undefined,
    };
    const effective = resolveEffectiveTicketStatus(ticket);
    if (effective !== ticket.status) {
      markOverrunStmt.run(ticket.id);
      return { ...ticket, status: effective };
    }
    return ticket;
  });

  const tickets = sortTicketsFcfs(mappedTickets);
  const designations: DepartmentDesignation[] = (
    db
      .prepare(`SELECT id, department_name, designation_name, created_at FROM Department_Designations ORDER BY department_name ASC, designation_name ASC`)
      .all() as Array<{ id: string; department_name: string; designation_name: string; created_at: string }>
  ).map((d) => ({
    id: d.id,
    departmentName: d.department_name,
    designationName: d.designation_name,
    createdAt: d.created_at,
  }));
  const history = listAssetHistoryFromDb(db);
  const entities = listPersonnelEntitiesSafe(db);
  const freelancerAllotments = listFreelancerAllotmentsFromDb(db);
  const expenseCategories = listExpenseCategoriesFromDb(db, false);
  const paymentModes = listPaymentModesFromDb(db, false);

  const isPrivilegedViewer =
    !viewer ||
    isAdminRole(viewer.role) ||
    viewer.role === 'Manager' ||
    viewer.role === 'HR Manager' ||
    viewer.role === 'Auditor' ||
    Boolean(viewer.permissions?.includes('role.manage'));

  const hasConvTbl = Boolean(
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Employment_Conversions' LIMIT 1`).get()
  );
  const employmentConversions: EmploymentConversionRecord[] =
    isPrivilegedViewer && hasConvTbl
      ? (
          db
            .prepare(`SELECT * FROM Employment_Conversions ORDER BY converted_at DESC LIMIT 200`)
            .all() as Array<Record<string, unknown>>
        ).map((r) => ({
          id: String(r.id),
          profileId: String(r.profile_id),
          fromType: String(r.from_category) as EmploymentCategory,
          toType: String(r.to_category) as EmploymentCategory,
          fromCode: String(r.from_code),
          toCode: String(r.to_code),
          personName: String(r.person_name),
          reason: String(r.reason || ''),
          convertedBy: String(r.converted_by || ''),
          convertedAt: String(r.converted_at || ''),
        }))
      : [];

  if (!isPrivilegedViewer && viewer) {
    const allowedHolderKeys = new Set<string>();
    for (const key of [viewer.id, viewer.employeeId, viewer.entityId]) {
      if (key && key.trim()) allowedHolderKeys.add(key.trim().toUpperCase());
    }
    for (const emp of scopedEmployees) {
      if (emp.id) allowedHolderKeys.add(emp.id.trim().toUpperCase());
      if (emp.employeeId) allowedHolderKeys.add(emp.employeeId.trim().toUpperCase());
    }

    const scopedAssignments = assignments.filter(
      (a) =>
        allowedHolderKeys.has((a.employeeId || '').trim().toUpperCase()) ||
        allowedHolderKeys.has((a.assignedById || '').trim().toUpperCase())
    );
    const scopedAssignmentIds = new Set(scopedAssignments.map((a) => a.id));
    const scopedAssetIds = new Set(scopedAssignments.map((a) => a.assetId));

    const scopedTickets = tickets.filter(
      (t) =>
        allowedHolderKeys.has((t.employeeId || '').trim().toUpperCase()) ||
        scopedAssetIds.has(t.assetId)
    );
    const scopedAllotments = freelancerAllotments.filter(
      (al) =>
        allowedHolderKeys.has((al.flpId || '').trim().toUpperCase()) ||
        allowedHolderKeys.has((al.flpCode || '').trim().toUpperCase()) ||
        allowedHolderKeys.has((al.executiveEmpId || '').trim().toUpperCase()) ||
        scopedAssignmentIds.has(al.assignmentId)
    );
    const scopedReturns = returns.filter((r) =>
      allowedHolderKeys.has((r.employeeId || '').trim().toUpperCase())
    );
    const scopedTransfers = transfers.filter((t) => scopedAssetIds.has(t.assetId));

    return {
      settings: cfg.settings,
      users: [],
      assets: assets.filter((a) => scopedAssetIds.has(a.id)),
      employees: scopedEmployees,
      entities,
      vendors: [],
      assignments: scopedAssignments,
      freelancerAllotments: scopedAllotments,
      returns: scopedReturns,
      transfers: scopedTransfers,
      maintenance: [],
      disposals: [],
      expenses: [],
      expenseCategories,
      paymentModes,
      employmentConversions: [],
      tickets: scopedTickets,
      history: history.filter((h) => scopedAssetIds.has(h.assetId)),
      categories: cfg.categories,
      departments: cfg.departments,
      designations,
      locations: cfg.locations,
    };
  }

  return {
    settings: cfg.settings,
    users: [],
    assets,
    employees: scopedEmployees,
    entities,
    vendors,
    assignments,
    freelancerAllotments,
    returns,
    transfers,
    maintenance,
    disposals,
    expenses,
    expenseCategories,
    paymentModes,
    employmentConversions,
    tickets,
    history,
    categories: cfg.categories,
    departments: cfg.departments,
    designations,
    locations: cfg.locations,
  };
}

function listPersonnelEntitiesSafe(db: DatabaseSync): PersonnelEntity[] {
  const tbl = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Personnel_Entities' LIMIT 1`)
    .get() as { name: string } | undefined;
  if (!tbl) return [];
  const rows = db
    .prepare(`SELECT * FROM Personnel_Entities ORDER BY entity_type ASC, entity_code ASC`)
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    entityCode: String(r.entity_code),
    entityType: String(r.entity_type) as PersonnelEntity['entityType'],
    name: String(r.name),
    email: String(r.email || ''),
    personalEmail: r.personal_email ? String(r.personal_email) : '',
    officialEmail: r.official_email ? String(r.official_email) : '',
    phone: String(r.phone || ''),
    whatsappNo: r.whatsapp_no ? String(r.whatsapp_no) : '',
    fatherHusbandName: r.father_husband_name ? String(r.father_husband_name) : '',
    address: r.address ? String(r.address) : '',
    center: normalizeCenterName(String(r.center || 'Kolkata')),
    department: String(r.department || 'Operations'),
    designation: String(r.designation || ''),
    isManager: Boolean(r.is_manager),
    reportingManagerId: r.reporting_manager_id ? String(r.reporting_manager_id) : '',
    reportingManagerName: r.reporting_manager_name ? String(r.reporting_manager_name) : '',
    reportingManagerEmail: r.reporting_manager_email ? String(r.reporting_manager_email) : '',
    aadhaarCard: r.aadhaar_card ? String(r.aadhaar_card) : '',
    panCard: r.pan_card ? String(r.pan_card) : '',
    projectName: r.project_name ? String(r.project_name) : '',
    projectNo: r.project_no ? String(r.project_no) : '',
    eicName: r.eic_name ? String(r.eic_name) : '',
    bankName: r.bank_name ? String(r.bank_name) : '',
    bankBranch: r.bank_branch ? String(r.bank_branch) : '',
    bankAccountType: r.bank_account_type ? String(r.bank_account_type) : 'Savings',
    bankAccountNo: r.bank_account_no ? String(r.bank_account_no) : '',
    ifscCode: r.ifsc_code ? String(r.ifsc_code) : '',
    joiningDate: r.joining_date ? String(r.joining_date) : '',
    status: r.status === 'Inactive' ? 'Inactive' : 'Active',
    remarks: r.remarks ? String(r.remarks) : '',
    createdAt: r.created_at ? String(r.created_at) : undefined,
  }));
}

export function listFreelancerAllotmentsFromDb(db: DatabaseSync): FreelancerAllotmentRecord[] {
  const tbl = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Freelancer_Allotments' LIMIT 1`)
    .get() as { name: string } | undefined;
  if (!tbl) return [];
  const rows = db
    .prepare(`SELECT * FROM Freelancer_Allotments ORDER BY created_at DESC`)
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => {
    let assetIds: string[] = [];
    let accessories: FreelancerAccessoryItem[] = [];
    try {
      assetIds = JSON.parse(String(r.asset_ids_json || '[]'));
    } catch {
      assetIds = [];
    }
    try {
      accessories = JSON.parse(String(r.accessories_json || '[]'));
    } catch {
      accessories = [];
    }
    return {
      id: String(r.id),
      assignmentId: String(r.assignment_id),
      assetIds,
      flpId: String(r.flp_id),
      flpName: String(r.flp_name),
      flpCode: String(r.flp_code),
      flpAddress: String(r.flp_address || ''),
      aadhaarNo: String(r.aadhaar_no || ''),
      panNo: String(r.pan_no || ''),
      mobileNo: String(r.mobile_no || ''),
      centerName: String(r.center_name || 'Kolkata'),
      centerAddress: String(r.center_address || ''),
      centerPhone: String(r.center_phone || ''),
      executiveName: String(r.executive_name || ''),
      executiveEmpId: String(r.executive_emp_id || ''),
      jobNumber: String(r.job_number || ''),
      issueDate: String(r.issue_date || ''),
      accessories,
      remarks: r.remarks ? String(r.remarks) : '',
      witness1Name: r.witness1_name ? String(r.witness1_name) : '',
      witness2Name: r.witness2_name ? String(r.witness2_name) : '',
      allotmentDate: String(r.allotment_date || r.issue_date || ''),
      createdAt: r.created_at ? String(r.created_at) : undefined,
    };
  });
}

export function createAssetInDb(
  db: DatabaseSync,
  payload: Omit<Asset, 'id'> & { id?: string },
  actor: AuditActorContext
): Asset {
  const existingIds = (db.prepare(`SELECT id FROM Assets`).all() as Array<{ id: string }>).map((r) => r.id);
  const id = payload.id && !existingIds.includes(payload.id) ? payload.id : generateNextId('AST', existingIds, 4);
  const today = new Date().toISOString().split('T')[0];
  const currentVal =
    payload.currentValue ??
    calculateBookValue({
      cost: Number(payload.cost) || 0,
      purchaseDate: payload.purchaseDate || today,
      usefulLife: Number(payload.usefulLife) || 5,
      salvageValue: Number(payload.salvageValue) || 0,
      method: payload.depMethod || 'SLM',
    });
  const asset: Asset = {
    ...payload,
    id,
    currentValue: currentVal,
    status: payload.status || 'Available',
  };
  const cfg = getWorkspaceSettingsFromDb(db);

  db.exec('BEGIN IMMEDIATE');
  try {
    runInsertAsset(insertAssetStmt(db), asset);
    addAssetHistoryInDb(db, {
      assetId: asset.id,
      date: asset.purchaseDate || today,
      activity: 'Purchased',
      details: `Purchased for ${cfg.settings.currency}${Number(asset.cost).toLocaleString()}. Serial No: ${asset.serial}. Brand: ${asset.brand || '—'}`,
    });
    writeSystemAuditLog(db, {
      module: 'Asset',
      entityType: 'Asset',
      entityId: asset.id,
      action: 'ASSET_CREATED',
      actor,
      beforeObj: null,
      afterObj: asset,
      details: `Created asset ${asset.name} (${asset.id}) in ${asset.department}`,
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return asset;
}

export function updateAssetInDb(
  db: DatabaseSync,
  id: string,
  payload: Partial<Asset>,
  actor: AuditActorContext
): Asset | null {
  const existing = listAssetsFromDb(db).find((a) => a.id === id);
  if (!existing) return null;
  const updated: Asset = { ...existing, ...payload, id };
  const today = new Date().toISOString().split('T')[0];

  db.exec('BEGIN IMMEDIATE');
  try {
    runInsertAsset(insertAssetStmt(db), updated);
    addAssetHistoryInDb(db, {
      assetId: updated.id,
      date: today,
      activity: 'Updated',
      details: `Asset details updated (${updated.name}).`,
    });
    writeSystemAuditLog(db, {
      module: 'Asset',
      entityType: 'Asset',
      entityId: updated.id,
      action: 'ASSET_UPDATED',
      actor,
      beforeObj: existing,
      afterObj: updated,
      details: `Updated asset ${updated.name} (${updated.id})`,
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return updated;
}

export function deleteAssetInDb(db: DatabaseSync, id: string, actor: AuditActorContext): boolean {
  const existing = listAssetsFromDb(db).find((a) => a.id === id);
  if (!existing) return false;
  db.exec('BEGIN IMMEDIATE');
  try {
    // Only delete from Assets; NEVER touch Employees table!
    db.prepare(`DELETE FROM Assets WHERE id = ?`).run(id);
    writeSystemAuditLog(db, {
      module: 'Asset',
      entityType: 'Asset',
      entityId: id,
      action: 'ASSET_DELETED',
      actor,
      beforeObj: existing,
      afterObj: null,
      details: `Deleted asset ${existing.name} (${id}); employee records untouched.`,
    });
    db.exec('COMMIT');
    return true;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function bulkUpdateAssetsInDb(
  db: DatabaseSync,
  params: {
    assetIds: string[];
    status?: AssetStatus;
    department?: string;
    notes?: string;
  },
  actor: AuditActorContext
): { updatedAssets: Asset[]; updatedCount: number } {
  const uniqueIds = Array.from(new Set(params.assetIds.map((id) => id.trim()).filter(Boolean)));
  const allAssets = listAssetsFromDb(db);
  const byId = new Map(allAssets.map((a) => [a.id, a]));
  const today = new Date().toISOString().split('T')[0];
  const updatedAssets: Asset[] = [];

  db.exec('BEGIN IMMEDIATE');
  try {
    const updateStmt = db.prepare(`UPDATE Assets SET status = ?, department = ? WHERE id = ?`);

    for (const id of uniqueIds) {
      const prev = byId.get(id);
      if (!prev) continue;
      const nextStatus = params.status ?? prev.status;
      const nextDepartment = params.department ?? prev.department;
      if (nextStatus === prev.status && nextDepartment === prev.department) {
        continue;
      }

      updateStmt.run(nextStatus, nextDepartment, id);
      const nextAsset: Asset = { ...prev, status: nextStatus, department: nextDepartment };
      updatedAssets.push(nextAsset);

      const changes: string[] = [];
      if (nextStatus !== prev.status) changes.push(`Status: ${prev.status} -> ${nextStatus}`);
      if (nextDepartment !== prev.department) changes.push(`Department: ${prev.department} -> ${nextDepartment}`);
      if (params.notes?.trim()) changes.push(`Note: ${params.notes.trim()}`);

      addAssetHistoryInDb(db, {
        assetId: id,
        date: today,
        activity: 'Updated',
        details: `Batch update by ${actor.userName}: ${changes.join(' · ')}`,
      });
    }

    if (params.department) {
      const cfg = getWorkspaceSettingsFromDb(db);
      if (!cfg.departments.includes(params.department)) {
        db.prepare(`UPDATE App_Settings SET departments_json = ?, updated_at = ? WHERE id = 'default'`).run(
          JSON.stringify([...cfg.departments, params.department]),
          new Date().toISOString()
        );
      }
    }

    writeSystemAuditLog(db, {
      module: 'Asset',
      entityType: 'Asset',
      entityId: updatedAssets.map((a) => a.id).join(','),
      action: 'ASSET_BULK_UPDATED',
      actor,
      beforeObj: updatedAssets.map((a) => byId.get(a.id)),
      afterObj: updatedAssets,
      details: `Batch updated ${updatedAssets.length} asset(s)${params.status ? ` [status=${params.status}]` : ''}${params.department ? ` [department=${params.department}]` : ''}`,
    });

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { updatedAssets, updatedCount: updatedAssets.length };
}

export function exportFullBackupFromDb(db: DatabaseSync, actor: AuditActorContext) {
  const cfg = getWorkspaceSettingsFromDb(db);
  const employees = db.prepare(`SELECT * FROM Employees ORDER BY employee_id ASC`).all();
  const assets = db.prepare(`SELECT * FROM Assets ORDER BY id ASC`).all();
  const vendors = db.prepare(`SELECT * FROM Vendors ORDER BY id ASC`).all();
  const assignments = db.prepare(`SELECT * FROM Assignments ORDER BY assign_date DESC`).all();
  const returns = db.prepare(`SELECT * FROM Asset_Returns ORDER BY return_date DESC`).all();
  const transfers = db.prepare(`SELECT * FROM Asset_Transfers ORDER BY transfer_date DESC`).all();
  const maintenance = db.prepare(`SELECT * FROM Maintenance_Records ORDER BY service_date DESC`).all();
  const disposals = db.prepare(`SELECT * FROM Disposals ORDER BY disposal_date DESC`).all();
  const expenses = db.prepare(`SELECT * FROM Expenses ORDER BY expense_date DESC`).all();
  const tickets = db.prepare(`SELECT * FROM Support_Tickets ORDER BY created_at DESC`).all();
  const history = db.prepare(`SELECT * FROM Asset_History ORDER BY seq_order DESC`).all();
  const roles = db.prepare(`SELECT * FROM Roles`).all();
  const permissions = db.prepare(`SELECT * FROM Permissions`).all();
  const rolePermissions = db.prepare(`SELECT * FROM Role_Permissions`).all();
  const users = db
    .prepare(`SELECT id, login_id, name, email, password, role_id, employee_id, department, active, created_at FROM Users`)
    .all();
  const userPermissions = db.prepare(`SELECT * FROM User_Permissions`).all();
  const attendance = db.prepare(`SELECT * FROM Attendance`).all();
  const leaves = db.prepare(`SELECT * FROM Leave_Requests`).all();
  const holidays = db.prepare(`SELECT * FROM Public_Holidays`).all();
  const workflowRequests = db.prepare(`SELECT * FROM Workflow_Requests`).all();
  const attendanceAuditLogs = db.prepare(`SELECT * FROM Attendance_Audit_Logs`).all();
  const systemAuditLogs = db.prepare(`SELECT * FROM System_Audit_Logs`).all();
  const emailLogs = db.prepare(`SELECT * FROM Email_Logs`).all();
  const emailAuditLogs = db.prepare(`SELECT * FROM Email_Audit_Logs`).all();
  const attachments = db.prepare(`SELECT * FROM Attachments`).all();
  const hasTable = (name: string) =>
    Boolean(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`).get(name));
  const personnelEntities = hasTable('Personnel_Entities')
    ? db.prepare(`SELECT * FROM Personnel_Entities ORDER BY entity_type ASC, entity_code ASC`).all()
    : [];
  const freelancerAllotments = hasTable('Freelancer_Allotments')
    ? db.prepare(`SELECT * FROM Freelancer_Allotments ORDER BY created_at DESC`).all()
    : [];
  const policyAcknowledgments = hasTable('Policy_Acknowledgments')
    ? db.prepare(`SELECT * FROM Policy_Acknowledgments ORDER BY acknowledged_at DESC`).all()
    : [];

  const expenseCategories = hasTable('Expense_Categories')
    ? db.prepare(`SELECT * FROM Expense_Categories ORDER BY name ASC`).all()
    : [];
  const paymentModes = hasTable('Payment_Modes')
    ? db.prepare(`SELECT * FROM Payment_Modes ORDER BY name ASC`).all()
    : [];
  const employmentConversions = hasTable('Employment_Conversions')
    ? db.prepare(`SELECT * FROM Employment_Conversions ORDER BY converted_at DESC`).all()
    : [];

  writeSystemAuditLog(db, {
    module: 'Backup',
    entityType: 'System',
    entityId: 'full-backup',
    action: 'BACKUP_EXPORTED',
    actor,
    details: `Exported enterprise backup (${employees.length} employees, ${personnelEntities.length} entities, ${assets.length} assets, ${users.length} users)`,
  });

  return {
    format: 'median-asset-hr-suite-backup',
    version: 4,
    exportedAt: new Date().toISOString(),
    exportedBy: actor.userName,
    settings: cfg.settings,
    categories: cfg.categories,
    departments: cfg.departments,
    locations: cfg.locations,
    employees,
    personnelEntities,
    employmentConversions,
    assets,
    vendors,
    assignments,
    freelancerAllotments,
    returns,
    transfers,
    maintenance,
    disposals,
    expenses,
    expenseCategories,
    paymentModes,
    tickets,
    history,
    roles,
    permissions,
    rolePermissions,
    users,
    userPermissions,
    attendance,
    leaves,
    holidays,
    policyAcknowledgments,
    workflowRequests,
    attendanceAuditLogs,
    systemAuditLogs,
    emailLogs,
    emailAuditLogs,
    attachments,
  };
}

export function restoreFullBackupInDb(
  db: DatabaseSync,
  payload: Record<string, unknown>,
  mode: 'merge' | 'replace',
  actor: AuditActorContext
): { restoredCounts: Record<string, number> } {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Backup JSON payload must be an object.');
  }

  const rawEmployees = Array.isArray(payload.employees) ? (payload.employees as Array<Record<string, unknown>>) : [];
  const rawAssets = Array.isArray(payload.assets) ? (payload.assets as Array<Record<string, unknown>>) : [];

  if (!Array.isArray(payload.employees) && !Array.isArray(payload.assets)) {
    throw new Error('Invalid backup structure: missing employees or assets arrays.');
  }

  const counts: Record<string, number> = {
    employees: 0,
    assets: 0,
    vendors: 0,
    assignments: 0,
    returns: 0,
    transfers: 0,
    maintenance: 0,
    disposals: 0,
    expenses: 0,
    tickets: 0,
    history: 0,
    users: 0,
    attendance: 0,
    leaves: 0,
    holidays: 0,
    attachments: 0,
  };

  db.exec('BEGIN IMMEDIATE');
  try {
    // Merge settings & master lists safely
    const currentCfg = getWorkspaceSettingsFromDb(db);
    const nextSettings =
      payload.settings && typeof payload.settings === 'object'
        ? { ...currentCfg.settings, ...(payload.settings as Partial<CompanySettings>) }
        : currentCfg.settings;
    const mergeUniqueStrings = (existing: string[], incoming: unknown) =>
      Array.isArray(incoming)
        ? Array.from(new Set([...(mode === 'replace' ? [] : existing), ...incoming.map((v) => String(v)).filter(Boolean)]))
        : existing;

    db.prepare(
      `INSERT INTO App_Settings (id, settings_json, categories_json, departments_json, locations_json, seed_initialized, updated_at)
       VALUES ('default', ?, ?, ?, ?, 1, ?)
       ON CONFLICT(id) DO UPDATE SET
         settings_json = excluded.settings_json,
         categories_json = excluded.categories_json,
         departments_json = excluded.departments_json,
         locations_json = excluded.locations_json,
         updated_at = excluded.updated_at`
    ).run(
      JSON.stringify(nextSettings),
      JSON.stringify(mergeUniqueStrings(currentCfg.categories, payload.categories)),
      JSON.stringify(mergeUniqueStrings(currentCfg.departments, payload.departments)),
      JSON.stringify(mergeUniqueStrings(currentCfg.locations, payload.locations)),
      new Date().toISOString()
    );

    // IMPORTANT: Even during restore, NEVER delete existing employees unless mode === 'replace' is explicitly chosen AND backup has employees!
    // By default ('merge'), employees and all modules are non-destructively restored/upserted.
    if (mode === 'replace') {
      db.exec(`DELETE FROM Assets`);
      db.exec(`DELETE FROM Vendors`);
      db.exec(`DELETE FROM Assignments`);
      db.exec(`DELETE FROM Asset_Returns`);
      db.exec(`DELETE FROM Asset_Transfers`);
      db.exec(`DELETE FROM Maintenance_Records`);
      db.exec(`DELETE FROM Disposals`);
      db.exec(`DELETE FROM Expenses`);
      db.exec(`DELETE FROM Support_Tickets`);
      db.exec(`DELETE FROM Asset_History`);
      if (rawEmployees.length > 0) {
        db.exec(`DELETE FROM Employees`);
      }
    }

    const upsertEmp = db.prepare(`
      INSERT INTO Employees (
        id, employee_id, name, email, department, designation, phone, branch,
        center, is_manager, reporting_manager_id, reporting_manager_name, reporting_manager_email,
        joining_date, status, address, remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        employee_id = excluded.employee_id,
        name = excluded.name,
        email = excluded.email,
        department = excluded.department,
        designation = excluded.designation,
        phone = excluded.phone,
        branch = excluded.branch,
        center = excluded.center,
        is_manager = excluded.is_manager,
        reporting_manager_id = excluded.reporting_manager_id,
        reporting_manager_name = excluded.reporting_manager_name,
        reporting_manager_email = excluded.reporting_manager_email,
        joining_date = excluded.joining_date,
        status = excluded.status,
        address = excluded.address,
        remarks = excluded.remarks
    `);

    for (const e of rawEmployees) {
      const id = String(e.id || e.employee_id || e.employeeId || '').trim();
      const empCode = String(e.employee_id || e.employeeId || id).trim().toUpperCase();
      if (!id || !empCode || !e.name) continue;
      // Avoid UNIQUE(employee_id) collision under a different id
      const clash = db
        .prepare(`SELECT id FROM Employees WHERE UPPER(employee_id) = ? AND id != ?`)
        .get(empCode, id) as { id: string } | undefined;
      if (clash) continue;

      const center = normalizeCenterName(String(e.center || e.branch || DEFAULT_INDIAN_CENTER));
      upsertEmp.run(
        id,
        empCode,
        String(e.name),
        String(e.email || `${empCode.toLowerCase()}@company.com`),
        String(e.department || 'IT'),
        String(e.designation || 'Staff'),
        String(e.phone || ''),
        normalizeCenterName(String(e.branch || center)),
        center,
        e.is_manager === 1 || e.isManager === true ? 1 : 0,
        String(e.reporting_manager_id || e.reportingManagerId || ''),
        String(e.reporting_manager_name || e.reportingManagerName || ''),
        String(e.reporting_manager_email || e.reportingManagerEmail || ''),
        String(e.joining_date || e.joiningDate || ''),
        e.status === 'Inactive' ? 'Inactive' : 'Active',
        String(e.address || ''),
        String(e.remarks || '')
      );
      counts.employees++;
    }

    const assetStmt = insertAssetStmt(db);
    for (const a of rawAssets) {
      if (!a.id || !a.name) continue;
      runInsertAsset(assetStmt, {
        id: String(a.id),
        name: String(a.name),
        category: String(a.category || 'Laptop'),
        subcategory: String(a.subcategory || ''),
        brand: String(a.brand || ''),
        model: a.model ? String(a.model) : undefined,
        serial: String(a.serial || `SN-${a.id}`),
        purchaseDate: String(a.purchase_date || a.purchaseDate || ''),
        cost: Number(a.cost) || 0,
        vendor: String(a.vendor || ''),
        invoiceNumber: a.invoice_number || a.invoiceNumber ? String(a.invoice_number || a.invoiceNumber) : undefined,
        warrantyMonths: Number(a.warranty_months ?? a.warrantyMonths) || 0,
        warrantyExpiry: String(a.warranty_expiry || a.warrantyExpiry || ''),
        department: String(a.department || 'IT'),
        location: String(a.location || 'Floor 1'),
        condition: (a.condition as Asset['condition']) || 'Good',
        status: (a.status as AssetStatus) || 'Available',
        depMethod: ((a.dep_method || a.depMethod) as Asset['depMethod']) || 'SLM',
        usefulLife: Number(a.useful_life ?? a.usefulLife) || 5,
        salvageValue: Number(a.salvage_value ?? a.salvageValue) || 0,
        currentValue: Number(a.current_value ?? a.currentValue ?? a.cost) || 0,
        description: String(a.description || ''),
        image: a.image ? String(a.image) : undefined,
      });
      counts.assets++;
    }

    if (Array.isArray(payload.vendors)) {
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO Vendors (id, name, contact_person, phone, email, address, gst, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const v of payload.vendors as Array<Record<string, unknown>>) {
        if (!v.id || !v.name) continue;
        stmt.run(
          String(v.id),
          String(v.name),
          String(v.contact_person || v.contactPerson || ''),
          String(v.phone || ''),
          String(v.email || ''),
          String(v.address || ''),
          String(v.gst || ''),
          String(v.remarks || '')
        );
        counts.vendors++;
      }
    }

    if (Array.isArray(payload.assignments)) {
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO Assignments (
          id, asset_id, employee_id, assignee_type, assigned_by_id, assigned_by_role,
          parent_assignment_id, custody_level, assign_date, return_date,
          condition, assigned_by, notes, project_name, project_no, eic_name, allotment_id, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const x of payload.assignments as Array<Record<string, unknown>>) {
        if (!x.id) continue;
        stmt.run(
          String(x.id),
          String(x.asset_id || x.assetId || ''),
          String(x.employee_id || x.employeeId || ''),
          String(x.assignee_type || x.assigneeType || 'Employee'),
          String(x.assigned_by_id || x.assignedById || ''),
          String(x.assigned_by_role || x.assignedByRole || ''),
          String(x.parent_assignment_id || x.parentAssignmentId || ''),
          String(x.custody_level || x.custodyLevel || 'Primary'),
          String(x.assign_date || x.assignDate || ''),
          String(x.return_date || x.returnDate || ''),
          String(x.condition || 'Good'),
          String(x.assigned_by || x.assignedBy || ''),
          String(x.notes || ''),
          String(x.project_name || x.projectName || ''),
          String(x.project_no || x.projectNo || ''),
          String(x.eic_name || x.eicName || ''),
          String(x.allotment_id || x.allotmentId || ''),
          String(x.status || 'Active')
        );
        counts.assignments++;
      }
    }

    if (Array.isArray(payload.personnelEntities)) {
      const hasPe = Boolean(
        db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Personnel_Entities' LIMIT 1`).get()
      );
      if (hasPe) {
        const stmt = db.prepare(
          `INSERT OR REPLACE INTO Personnel_Entities (
            id, entity_code, entity_type, name, email, personal_email, official_email,
            phone, whatsapp_no, father_husband_name, address, center, department, designation,
            is_manager, reporting_manager_id, reporting_manager_name, reporting_manager_email,
            aadhaar_card, pan_card, project_name, project_no, eic_name,
            bank_name, bank_branch, bank_account_type, bank_account_no, ifsc_code,
            joining_date, status, remarks, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const pe of payload.personnelEntities as Array<Record<string, unknown>>) {
          if (!pe.id || !pe.entity_code || !pe.name) continue;
          stmt.run(
            String(pe.id),
            String(pe.entity_code || pe.entityCode),
            String(pe.entity_type || pe.entityType || 'Consultant'),
            String(pe.name),
            String(pe.email || ''),
            String(pe.personal_email || pe.personalEmail || ''),
            String(pe.official_email || pe.officialEmail || ''),
            String(pe.phone || ''),
            String(pe.whatsapp_no || pe.whatsappNo || ''),
            String(pe.father_husband_name || pe.fatherHusbandName || ''),
            String(pe.address || ''),
            String(pe.center || 'Kolkata'),
            String(pe.department || 'Operations'),
            String(pe.designation || ''),
            pe.is_manager === 1 || pe.isManager === true ? 1 : 0,
            String(pe.reporting_manager_id || pe.reportingManagerId || ''),
            String(pe.reporting_manager_name || pe.reportingManagerName || ''),
            String(pe.reporting_manager_email || pe.reportingManagerEmail || ''),
            String(pe.aadhaar_card || pe.aadhaarCard || ''),
            String(pe.pan_card || pe.panCard || ''),
            String(pe.project_name || pe.projectName || ''),
            String(pe.project_no || pe.projectNo || ''),
            String(pe.eic_name || pe.eicName || ''),
            String(pe.bank_name || pe.bankName || ''),
            String(pe.bank_branch || pe.bankBranch || ''),
            String(pe.bank_account_type || pe.bankAccountType || 'Savings'),
            String(pe.bank_account_no || pe.bankAccountNo || ''),
            String(pe.ifsc_code || pe.ifscCode || ''),
            String(pe.joining_date || pe.joiningDate || ''),
            pe.status === 'Inactive' ? 'Inactive' : 'Active',
            String(pe.remarks || ''),
            String(pe.created_at || pe.createdAt || new Date().toISOString())
          );
        }
      }
    }

    if (Array.isArray(payload.freelancerAllotments)) {
      const hasFa = Boolean(
        db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Freelancer_Allotments' LIMIT 1`).get()
      );
      if (hasFa) {
        const stmt = db.prepare(
          `INSERT OR REPLACE INTO Freelancer_Allotments (
            id, assignment_id, asset_ids_json, flp_id, flp_name, flp_code, flp_address,
            aadhaar_no, pan_no, mobile_no, center_name, center_address, center_phone,
            executive_name, executive_emp_id, job_number, issue_date, accessories_json,
            remarks, witness1_name, witness2_name, allotment_date, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const fa of payload.freelancerAllotments as Array<Record<string, unknown>>) {
          if (!fa.id || !fa.assignment_id) continue;
          stmt.run(
            String(fa.id),
            String(fa.assignment_id || fa.assignmentId || ''),
            typeof fa.asset_ids_json === 'string' ? fa.asset_ids_json : JSON.stringify(fa.assetIds || []),
            String(fa.flp_id || fa.flpId || ''),
            String(fa.flp_name || fa.flpName || ''),
            String(fa.flp_code || fa.flpCode || ''),
            String(fa.flp_address || fa.flpAddress || ''),
            String(fa.aadhaar_no || fa.aadhaarNo || ''),
            String(fa.pan_no || fa.panNo || ''),
            String(fa.mobile_no || fa.mobileNo || ''),
            String(fa.center_name || fa.centerName || 'Kolkata'),
            String(fa.center_address || fa.centerAddress || ''),
            String(fa.center_phone || fa.centerPhone || ''),
            String(fa.executive_name || fa.executiveName || ''),
            String(fa.executive_emp_id || fa.executiveEmpId || ''),
            String(fa.job_number || fa.jobNumber || ''),
            String(fa.issue_date || fa.issueDate || ''),
            typeof fa.accessories_json === 'string' ? fa.accessories_json : JSON.stringify(fa.accessories || []),
            String(fa.remarks || ''),
            String(fa.witness1_name || fa.witness1Name || ''),
            String(fa.witness2_name || fa.witness2Name || ''),
            String(fa.allotment_date || fa.allotmentDate || ''),
            String(fa.created_at || fa.createdAt || new Date().toISOString())
          );
        }
      }
    }

    if (Array.isArray(payload.returns)) {
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO Asset_Returns (id, return_date, employee_id, asset_id, condition, damage, remarks) VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const x of payload.returns as Array<Record<string, unknown>>) {
        if (!x.id) continue;
        stmt.run(
          String(x.id),
          String(x.return_date || x.date || ''),
          String(x.employee_id || x.employeeId || ''),
          String(x.asset_id || x.assetId || ''),
          String(x.condition || 'Good'),
          String(x.damage || 'No Damage'),
          String(x.remarks || '')
        );
        counts.returns++;
      }
    }

    if (Array.isArray(payload.transfers)) {
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO Asset_Transfers (id, transfer_date, asset_id, from_dept, to_dept, from_emp, to_emp, new_location, reason, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const x of payload.transfers as Array<Record<string, unknown>>) {
        if (!x.id) continue;
        stmt.run(
          String(x.id),
          String(x.transfer_date || x.date || ''),
          String(x.asset_id || x.assetId || ''),
          String(x.from_dept || x.fromDept || ''),
          String(x.to_dept || x.toDept || ''),
          String(x.from_emp || x.fromEmp || ''),
          String(x.to_emp || x.toEmp || ''),
          String(x.new_location || x.newLocation || ''),
          String(x.reason || ''),
          String(x.remarks || '')
        );
        counts.transfers++;
      }
    }

    if (Array.isArray(payload.maintenance)) {
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO Maintenance_Records (id, asset_id, type, cost, vendor, status, service_date, next_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const x of payload.maintenance as Array<Record<string, unknown>>) {
        if (!x.id) continue;
        stmt.run(
          String(x.id),
          String(x.asset_id || x.assetId || ''),
          String(x.type || 'Preventive'),
          Number(x.cost) || 0,
          String(x.vendor || ''),
          String(x.status || 'Open'),
          String(x.service_date || x.serviceDate || ''),
          String(x.next_date || x.nextDate || ''),
          String(x.notes || '')
        );
        counts.maintenance++;
      }
    }

    if (Array.isArray(payload.disposals)) {
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO Disposals (id, asset_id, disposal_date, salvage_recovered, reason, notes) VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const x of payload.disposals as Array<Record<string, unknown>>) {
        if (!x.id) continue;
        stmt.run(
          String(x.id),
          String(x.asset_id || x.assetId || ''),
          String(x.disposal_date || x.disposalDate || ''),
          Number(x.salvage_recovered ?? x.salvageRecovered) || 0,
          String(x.reason || ''),
          String(x.notes || '')
        );
        counts.disposals++;
      }
    }

    if (Array.isArray(payload.expenses)) {
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO Expenses (id, expense_date, category, paid_to, amount, mode, remarks) VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const x of payload.expenses as Array<Record<string, unknown>>) {
        if (!x.id) continue;
        stmt.run(
          String(x.id),
          String(x.expense_date || x.date || ''),
          String(x.category || 'Misc'),
          String(x.paid_to || x.paidTo || ''),
          Number(x.amount) || 0,
          String(x.mode || 'Cash'),
          String(x.remarks || '')
        );
        counts.expenses++;
      }
    }

    if (Array.isArray(payload.tickets)) {
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO Support_Tickets (id, employee_id, asset_id, subject, description, priority, status, created_at, booked_slot_id, approval_status, approved_by, approved_at, rejection_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const x of payload.tickets as Array<Record<string, unknown>>) {
        if (!x.id) continue;
        stmt.run(
          String(x.id),
          String(x.employee_id || x.employeeId || ''),
          String(x.asset_id || x.assetId || ''),
          String(x.subject || ''),
          String(x.description || ''),
          String(x.priority || 'Medium'),
          String(x.status || 'Open'),
          String(x.created_at || x.createdAt || new Date().toISOString()),
          x.booked_slot_id || x.bookedSlotId ? String(x.booked_slot_id || x.bookedSlotId) : null,
          String(x.approval_status || x.approvalStatus || 'Pending'),
          x.approved_by || x.approvedBy ? String(x.approved_by || x.approvedBy) : null,
          x.approved_at || x.approvedAt ? String(x.approved_at || x.approvedAt) : null,
          x.rejection_reason || x.rejectionReason ? String(x.rejection_reason || x.rejectionReason) : null
        );
        counts.tickets++;
      }
    }

    if (Array.isArray(payload.history)) {
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO Asset_History (id, asset_id, event_date, activity, details, seq_order) VALUES (?, ?, ?, ?, ?, ?)`
      );
      (payload.history as Array<Record<string, unknown>>).forEach((h, i) => {
        if (!h.asset_id && !h.assetId) return;
        stmt.run(
          String(h.id || crypto.randomUUID()),
          String(h.asset_id || h.assetId),
          String(h.event_date || h.date || ''),
          String(h.activity || 'Updated'),
          String(h.details || ''),
          Number(h.seq_order) || i + 1
        );
        counts.history++;
      });
    }

    if (Array.isArray(payload.roles)) {
      const stmt = db.prepare(`INSERT OR IGNORE INTO Roles (id, role_name, description) VALUES (?, ?, ?)`);
      for (const r of payload.roles as Array<Record<string, unknown>>) {
        if (!r.id || !r.role_name) continue;
        stmt.run(String(r.id), String(r.role_name), String(r.description || ''));
      }
    }

    if (Array.isArray(payload.rolePermissions)) {
      const stmt = db.prepare(`INSERT OR IGNORE INTO Role_Permissions (role_id, permission_id) VALUES (?, ?)`);
      for (const rp of payload.rolePermissions as Array<Record<string, unknown>>) {
        if (!rp.role_id || !rp.permission_id) continue;
        stmt.run(String(rp.role_id), String(rp.permission_id));
      }
    }

    if (Array.isArray(payload.users)) {
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO Users (id, login_id, name, email, password, role_id, employee_id, department, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const u of payload.users as Array<Record<string, unknown>>) {
        if (!u.id || !u.login_id || !u.password || !u.role_id) continue;
        stmt.run(
          String(u.id),
          String(u.login_id),
          String(u.name || u.login_id),
          String(u.email || `${u.login_id}@company.com`),
          String(u.password),
          String(u.role_id),
          u.employee_id ? String(u.employee_id) : null,
          u.department ? String(u.department) : null,
          u.active === 0 || u.active === false ? 0 : 1,
          String(u.created_at || new Date().toISOString())
        );
        counts.users++;
      }
    }

    if (Array.isArray(payload.userPermissions)) {
      const stmt = db.prepare(`INSERT OR IGNORE INTO User_Permissions (user_id, permission_id) VALUES (?, ?)`);
      for (const up of payload.userPermissions as Array<Record<string, unknown>>) {
        if (!up.user_id || !up.permission_id) continue;
        stmt.run(String(up.user_id), String(up.permission_id));
      }
    }

    if (Array.isArray(payload.attendance)) {
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO Attendance (id, employee_id, attendance_date, check_in_time, check_out_time, status, late_minutes, work_hours, remarks, correction_status, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const a of payload.attendance as Array<Record<string, unknown>>) {
        if (!a.id || !a.employee_id || !a.attendance_date) continue;
        stmt.run(
          String(a.id),
          String(a.employee_id),
          String(a.attendance_date),
          a.check_in_time ? String(a.check_in_time) : null,
          a.check_out_time ? String(a.check_out_time) : null,
          String(a.status || 'Present'),
          Number(a.late_minutes) || 0,
          Number(a.work_hours) || 0,
          String(a.remarks || ''),
          String(a.correction_status || 'None'),
          a.created_by ? String(a.created_by) : null,
          a.updated_by ? String(a.updated_by) : null,
          String(a.created_at || new Date().toISOString()),
          String(a.updated_at || new Date().toISOString())
        );
        counts.attendance++;
      }
    }

    if (Array.isArray(payload.leaves)) {
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO Leave_Requests (id, employee_id, leave_type, start_date, end_date, days, reason, status, reviewed_by, reviewed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const l of payload.leaves as Array<Record<string, unknown>>) {
        if (!l.id || !l.employee_id) continue;
        stmt.run(
          String(l.id),
          String(l.employee_id),
          String(l.leave_type || 'Casual'),
          String(l.start_date || ''),
          String(l.end_date || ''),
          Number(l.days) || 1,
          String(l.reason || 'Restored'),
          String(l.status || 'Pending'),
          l.reviewed_by ? String(l.reviewed_by) : null,
          l.reviewed_at ? String(l.reviewed_at) : null,
          String(l.created_at || new Date().toISOString())
        );
        counts.leaves++;
      }
    }

    if (Array.isArray(payload.holidays)) {
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO Public_Holidays (id, title, holiday_date, center, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const h of payload.holidays as Array<Record<string, unknown>>) {
        if (!h.id || !h.title || !h.holiday_date) continue;
        stmt.run(
          String(h.id),
          String(h.title),
          String(h.holiday_date),
          String(h.center || 'All Centers'),
          String(h.description || ''),
          h.created_by ? String(h.created_by) : null,
          String(h.created_at || new Date().toISOString())
        );
        counts.holidays++;
      }
    }

    if (Array.isArray(payload.attachments)) {
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO Attachments (id, entity_type, entity_id, file_name, mime_type, content_base64, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const att of payload.attachments as Array<Record<string, unknown>>) {
        if (!att.id || !att.file_name) continue;
        stmt.run(
          String(att.id),
          String(att.entity_type || 'General'),
          String(att.entity_id || ''),
          String(att.file_name),
          String(att.mime_type || 'application/octet-stream'),
          String(att.content_base64 || ''),
          String(att.uploaded_by || ''),
          String(att.created_at || new Date().toISOString())
        );
        counts.attachments++;
      }
    }

    if (Array.isArray(payload.workflowRequests)) {
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO Workflow_Requests (id, request_type, employee_id, target_date, end_date, requested_check_in, requested_check_out, payload_json, reason, status, reviewed_by, reviewed_at, review_notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const wr of payload.workflowRequests as Array<Record<string, unknown>>) {
        if (!wr.id || !wr.employee_id) continue;
        stmt.run(
          String(wr.id),
          String(wr.request_type || 'regularization'),
          String(wr.employee_id),
          String(wr.target_date || ''),
          wr.end_date ? String(wr.end_date) : null,
          wr.requested_check_in ? String(wr.requested_check_in) : null,
          wr.requested_check_out ? String(wr.requested_check_out) : null,
          wr.payload_json ? String(wr.payload_json) : null,
          String(wr.reason || ''),
          String(wr.status || 'Pending'),
          wr.reviewed_by ? String(wr.reviewed_by) : null,
          wr.reviewed_at ? String(wr.reviewed_at) : null,
          wr.review_notes ? String(wr.review_notes) : null,
          String(wr.created_at || new Date().toISOString())
        );
      }
    }

    if (Array.isArray(payload.systemAuditLogs)) {
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO System_Audit_Logs (id, module, entity_type, entity_id, action, actor_user_id, actor_name, actor_role, ip_address, before_json, after_json, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const lg of payload.systemAuditLogs as Array<Record<string, unknown>>) {
        if (!lg.id || !lg.action) continue;
        stmt.run(
          String(lg.id),
          String(lg.module || 'System'),
          String(lg.entity_type || 'System'),
          String(lg.entity_id || ''),
          String(lg.action),
          String(lg.actor_user_id || 'system'),
          String(lg.actor_name || 'System'),
          String(lg.actor_role || ''),
          String(lg.ip_address || '127.0.0.1'),
          lg.before_json ? String(lg.before_json) : null,
          lg.after_json ? String(lg.after_json) : null,
          String(lg.details || ''),
          String(lg.created_at || new Date().toISOString())
        );
      }
    }

    writeSystemAuditLog(db, {
      module: 'Backup',
      entityType: 'System',
      entityId: 'full-restore',
      action: 'BACKUP_RESTORED',
      actor,
      afterObj: counts,
      details: `Restored backup (${mode} mode): ${counts.employees} employees, ${counts.assets} assets, ${counts.users} users`,
    });

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { restoredCounts: counts };
}

export function addQuickOptionInDb(
  db: DatabaseSync,
  kind: 'category' | 'department' | 'location',
  value: string,
  actor: AuditActorContext
) {
  const trimmed = value.trim();
  const cfg = getWorkspaceSettingsFromDb(db);
  if (!trimmed) return cfg;
  const listKey = kind === 'category' ? 'categories' : kind === 'department' ? 'departments' : 'locations';
  if (cfg[listKey].includes(trimmed)) return cfg;
  return updateWorkspaceSettingsInDb(
    db,
    { [listKey]: [...cfg[listKey], trimmed] },
    actor
  );
}

export function importAssetsInDb(
  db: DatabaseSync,
  items: Array<Omit<Asset, 'id'>>,
  actor: AuditActorContext
): Asset[] {
  const existingIds = (db.prepare(`SELECT id FROM Assets`).all() as Array<{ id: string }>).map((r) => r.id);
  const created: Asset[] = [];
  const today = new Date().toISOString().split('T')[0];

  db.exec('BEGIN IMMEDIATE');
  try {
    const stmt = insertAssetStmt(db);
    for (const item of items) {
      const id = generateNextId('AST', existingIds, 4);
      existingIds.push(id);
      const ast: Asset = { ...item, id };
      runInsertAsset(stmt, ast);
      addAssetHistoryInDb(db, {
        assetId: id,
        date: ast.purchaseDate || today,
        activity: 'Purchased',
        details: `Imported via CSV (${ast.name}, S/N: ${ast.serial})`,
      });
      created.push(ast);
    }

    writeSystemAuditLog(db, {
      module: 'Asset',
      entityType: 'AssetBulkImport',
      entityId: 'asset-import',
      action: 'ASSET_BULK_IMPORTED',
      actor,
      afterObj: { count: created.length, assetIds: created.map((c) => c.id) },
      details: `Imported ${created.length} asset(s) via CSV; employee records untouched.`,
    });

    db.exec('COMMIT');
    return created;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export interface FreelancerAllotmentPayload {
  flpId?: string;
  flpName: string;
  flpCode: string;
  flpAddress: string;
  aadhaarNo: string;
  panNo: string;
  mobileNo: string;
  centerName: string;
  centerAddress?: string;
  centerPhone?: string;
  executiveName: string;
  executiveEmpId: string;
  jobNumber: string;
  issueDate: string;
  accessories: FreelancerAccessoryItem[];
  remarks?: string;
  witness1Name?: string;
  witness2Name?: string;
}

interface ResolvedAssigneeTarget {
  id: string;
  code: string;
  name: string;
  department: string;
  assigneeType: AssigneeEntityType;
  projectName?: string;
  projectNo?: string;
  eicName?: string;
  entity?: PersonnelEntity;
}

function resolveAssigneeTarget(
  db: DatabaseSync,
  assigneeId: string,
  expectedType?: AssigneeEntityType
): ResolvedAssigneeTarget | null {
  const key = (assigneeId || '').trim();
  if (!key) return null;

  if (!expectedType || expectedType === 'Employee') {
    const emp = db
      .prepare(`SELECT id, employee_id, name, department FROM Employees WHERE id = ? OR employee_id = ? LIMIT 1`)
      .get(key, key) as
      | { id: string; employee_id: string; name: string; department: string }
      | undefined;
    if (emp) {
      return {
        id: emp.id,
        code: emp.employee_id,
        name: emp.name,
        department: emp.department || 'IT',
        assigneeType: 'Employee',
      };
    }
  }

  const entities = listPersonnelEntitiesSafe(db);
  const ent = entities.find(
    (e) =>
      (e.id === key || e.entityCode.toUpperCase() === key.toUpperCase()) &&
      (!expectedType || expectedType === 'Employee' || e.entityType === expectedType)
  );
  if (ent) {
    return {
      id: ent.id,
      code: ent.entityCode,
      name: ent.name,
      department: ent.department || 'Field Operations',
      assigneeType: ent.entityType,
      projectName: ent.projectName,
      projectNo: ent.projectNo,
      eicName: ent.eicName,
      entity: ent,
    };
  }
  return null;
}

function listEmployeeCentersSafe(db: DatabaseSync): EmployeeCenterRecord[] {
  const tbl = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Employee_Centers' LIMIT 1`)
    .get() as { name: string } | undefined;
  if (!tbl) return [];
  const rows = db
    .prepare(`SELECT id, city_name, state_name, center_code, official_address, phone, is_active, created_at FROM Employee_Centers WHERE is_active = 1`)
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.city_name || ''),
    stateRegion: String(r.state_name || ''),
    centerCode: r.center_code ? String(r.center_code) : undefined,
    officialAddress: r.official_address ? String(r.official_address) : undefined,
    phone: r.phone ? String(r.phone) : undefined,
    isActive: Number(r.is_active) === 1,
    createdAt: String(r.created_at || ''),
  }));
}

function insertFreelancerAllotmentInsideTx(
  db: DatabaseSync,
  params: {
    assignmentId: string;
    assetId: string;
    target: ResolvedAssigneeTarget;
    allotment: FreelancerAllotmentPayload;
  }
): FreelancerAllotmentRecord {
  const existingIds = (
    db.prepare(`SELECT id FROM Freelancer_Allotments`).all() as Array<{ id: string }>
  ).map((r) => r.id);
  const id = generateNextId('ALLOT', existingIds, 4);
  const centers = listEmployeeCentersSafe(db);
  const centerInfo = resolveCenterOfficeInfo(params.allotment.centerName, centers);
  const createdAt = new Date().toISOString();

  const record: FreelancerAllotmentRecord = {
    id,
    assignmentId: params.assignmentId,
    assetIds: [params.assetId],
    flpId: params.target.id,
    flpName: params.allotment.flpName.trim(),
    flpCode: params.allotment.flpCode.trim().toUpperCase(),
    flpAddress: params.allotment.flpAddress.trim(),
    aadhaarNo: params.allotment.aadhaarNo.trim(),
    panNo: params.allotment.panNo.trim().toUpperCase(),
    mobileNo: params.allotment.mobileNo.trim(),
    centerName: centerInfo.name,
    centerAddress: params.allotment.centerAddress?.trim() || centerInfo.address,
    centerPhone: params.allotment.centerPhone?.trim() || centerInfo.phone,
    executiveName: params.allotment.executiveName.trim(),
    executiveEmpId: params.allotment.executiveEmpId.trim(),
    jobNumber: params.allotment.jobNumber.trim(),
    issueDate: params.allotment.issueDate.trim(),
    accessories: Array.isArray(params.allotment.accessories) ? params.allotment.accessories : [],
    remarks: params.allotment.remarks?.trim() || '',
    witness1Name: params.allotment.witness1Name?.trim() || '',
    witness2Name: params.allotment.witness2Name?.trim() || '',
    allotmentDate: params.allotment.issueDate.trim(),
    createdAt,
  };

  db.prepare(`
    INSERT INTO Freelancer_Allotments (
      id, assignment_id, asset_ids_json, flp_id, flp_name, flp_code, flp_address,
      aadhaar_no, pan_no, mobile_no, center_name, center_address, center_phone,
      executive_name, executive_emp_id, job_number, issue_date, accessories_json,
      remarks, witness1_name, witness2_name, allotment_date, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.assignmentId,
    JSON.stringify(record.assetIds),
    record.flpId,
    record.flpName,
    record.flpCode,
    record.flpAddress,
    record.aadhaarNo,
    record.panNo,
    record.mobileNo,
    record.centerName,
    record.centerAddress,
    record.centerPhone,
    record.executiveName,
    record.executiveEmpId,
    record.jobNumber,
    record.issueDate,
    JSON.stringify(record.accessories),
    record.remarks || '',
    record.witness1Name || '',
    record.witness2Name || '',
    record.allotmentDate,
    createdAt
  );

  return record;
}

export function assignAssetInDb(
  db: DatabaseSync,
  payload: {
    assetId: string;
    employeeId: string;
    assigneeType?: AssigneeEntityType;
    assignDate: string;
    condition: Asset['condition'];
    notes: string;
    projectName?: string;
    projectNo?: string;
    eicName?: string;
    allotment?: FreelancerAllotmentPayload;
  },
  actor: AuditActorContext
): { assignment: Assignment; asset: Asset; allotment?: FreelancerAllotmentRecord } {
  const asset = listAssetsFromDb(db).find((a) => a.id === payload.assetId);
  if (!asset) throw new Error('Asset not found.');
  if (asset.status === 'Disposed') throw new Error('Cannot assign a Disposed asset.');
  if (asset.status === 'Under Maintenance') {
    throw new Error('Cannot assign an asset currently Under Maintenance.');
  }

  const existingActivePrimary = db
    .prepare(
      `SELECT id FROM Assignments
       WHERE asset_id = ? AND status = 'Active'
         AND COALESCE(NULLIF(custody_level, ''), 'Primary') = 'Primary'
       LIMIT 1`
    )
    .get(asset.id) as { id: string } | undefined;
  if (existingActivePrimary) {
    throw new Error(
      `Asset ${asset.id} already has an active Primary assignment (${existingActivePrimary.id}). Use Transfer, Return, or Sub-Assignment instead.`
    );
  }

  const target = resolveAssigneeTarget(db, payload.employeeId, payload.assigneeType);
  if (!target) {
    throw new Error('Selected assignee (Employee / Personnel Entity) was not found.');
  }

  if (target.assigneeType === 'Freelancer') {
    if (!payload.allotment) {
      throw new Error(
        'Freelancer Allotment Request Form details must be completed before assigning an asset to a Freelancer.'
      );
    }
    const check = validateFreelancerAllotmentInput({
      flpId: target.id,
      flpName: payload.allotment.flpName || target.name,
      flpCode: payload.allotment.flpCode || target.code,
      flpAddress: payload.allotment.flpAddress || target.entity?.address || '',
      aadhaarNo: payload.allotment.aadhaarNo || target.entity?.aadhaarCard || '',
      panNo: payload.allotment.panNo || target.entity?.panCard || '',
      mobileNo: payload.allotment.mobileNo || target.entity?.phone || '',
      centerName: payload.allotment.centerName || target.entity?.center || 'Kolkata',
      executiveName: payload.allotment.executiveName || actor.userName,
      executiveEmpId: payload.allotment.executiveEmpId || actor.userId,
      jobNumber: payload.allotment.jobNumber || target.projectNo || '',
      issueDate: payload.allotment.issueDate || payload.assignDate,
      assetIds: [asset.id],
      accessories: payload.allotment.accessories,
    });
    if (!check.ok) {
      throw new Error(check.error);
    }
  }

  const existingIds = (db.prepare(`SELECT id FROM Assignments`).all() as Array<{ id: string }>).map((r) => r.id);
  const id = generateNextId('ASN', existingIds, 4);
  const projName = (payload.projectName ?? target.projectName ?? asset.projectName ?? '').trim();
  const projNo = (payload.projectNo ?? target.projectNo ?? asset.projectNo ?? '').trim();
  const eic = (payload.eicName ?? target.eicName ?? asset.eicName ?? '').trim();

  db.exec('BEGIN IMMEDIATE');
  try {
    let createdAllotment: FreelancerAllotmentRecord | undefined;
    if (target.assigneeType === 'Freelancer' && payload.allotment) {
      createdAllotment = insertFreelancerAllotmentInsideTx(db, {
        assignmentId: id,
        assetId: asset.id,
        target,
        allotment: payload.allotment,
      });
    }

    const assignment: Assignment = {
      id,
      assetId: asset.id,
      employeeId: target.id,
      assigneeType: target.assigneeType,
      assignedById: actor.userId,
      assignedByRole: actor.userRole,
      custodyLevel: 'Primary',
      assignDate: payload.assignDate,
      condition: payload.condition || 'Good',
      assignedBy: actor.userName,
      notes: payload.notes || '',
      projectName: projName || undefined,
      projectNo: projNo || undefined,
      eicName: eic || undefined,
      allotmentId: createdAllotment?.id,
      status: 'Active',
    };

    const accessoriesSummary = createdAllotment
      ? createdAllotment.accessories.map((a) => `${a.name} x${a.qty}`).join(', ')
      : asset.accessoriesIssued || '';

    db.prepare(`
      UPDATE Assets
      SET status = 'Assigned',
          department = ?,
          project_name = ?,
          project_no = ?,
          eic_name = ?,
          assigned_flp = ?,
          flp_id = ?,
          date_of_issue = ?,
          date_of_return = '',
          accessories_issued = ?
      WHERE id = ?
    `).run(
      target.department || asset.department,
      projName,
      projNo,
      eic,
      target.assigneeType === 'Freelancer' ? target.name : asset.assignedFlp || '',
      target.assigneeType === 'Freelancer' ? target.code : asset.flpId || '',
      payload.assignDate,
      accessoriesSummary,
      asset.id
    );

    db.prepare(`
      INSERT INTO Assignments (
        id, asset_id, employee_id, assignee_type, assigned_by_id, assigned_by_role,
        parent_assignment_id, custody_level, assign_date, return_date,
        condition, assigned_by, notes, project_name, project_no, eic_name, allotment_id, status
      ) VALUES (?, ?, ?, ?, ?, ?, '', 'Primary', ?, '', ?, ?, ?, ?, ?, ?, ?, 'Active')
    `).run(
      id,
      assignment.assetId,
      assignment.employeeId,
      target.assigneeType,
      actor.userId,
      actor.userRole,
      assignment.assignDate,
      assignment.condition || 'Good',
      actor.userName,
      assignment.notes || '',
      projName,
      projNo,
      eic,
      createdAllotment?.id || ''
    );

    addAssetHistoryInDb(db, {
      assetId: asset.id,
      date: payload.assignDate,
      activity: 'Assigned',
      details: `Primary Assigned to ${target.assigneeType} ${target.name} (ID: ${target.code}) by ${actor.userName}.${createdAllotment ? ` Allotment Form: ${createdAllotment.id}.` : ''}${payload.notes ? ` Remarks: ${payload.notes}` : ''}`,
    });

    writeSystemAuditLog(db, {
      module: 'Asset',
      entityType: 'Assignment',
      entityId: id,
      action: 'ASSET_ASSIGNED',
      actor,
      afterObj: { assignment, allotmentId: createdAllotment?.id },
      details: `Assigned ${asset.name} (${asset.id}) to ${target.assigneeType} ${target.name} (${target.code})`,
    });

    db.exec('COMMIT');
    return {
      assignment,
      asset: listAssetsFromDb(db).find((a) => a.id === asset.id)!,
      allotment: createdAllotment,
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function subAssignAssetInDb(
  db: DatabaseSync,
  payload: {
    assetId: string;
    parentAssignmentId?: string;
    assigneeId: string;
    assigneeType?: AssigneeEntityType;
    assignDate: string;
    condition?: Asset['condition'];
    notes?: string;
    projectName?: string;
    projectNo?: string;
    eicName?: string;
    allotment?: FreelancerAllotmentPayload;
  },
  actor: AuditActorContext & { employeeId?: string; entityId?: string }
): { assignment: Assignment; asset: Asset; allotment?: FreelancerAllotmentRecord } {
  const asset = listAssetsFromDb(db).find((a) => a.id === payload.assetId);
  if (!asset) throw new Error('Asset not found.');
  if (asset.status === 'Disposed') throw new Error('Cannot sub-assign a Disposed asset.');

  const activeRows = db
    .prepare(`SELECT * FROM Assignments WHERE asset_id = ? AND status = 'Active'`)
    .all(asset.id) as Array<Record<string, unknown>>;

  const parentRow = payload.parentAssignmentId
    ? activeRows.find((r) => String(r.id) === payload.parentAssignmentId)
    : activeRows.find((r) => String(r.custody_level || 'Primary') === 'Primary');

  if (!parentRow) {
    throw new Error('Asset must have an active Primary assignment before it can be sub-assigned.');
  }

  const existingSub = activeRows.find((r) => String(r.custody_level) === 'Sub-Assigned');
  if (existingSub) {
    throw new Error(
      `Asset ${asset.id} is already sub-assigned (${String(existingSub.id)}). Return the active sub-assignment first.`
    );
  }

  const isAdminActor = actor.userRole === 'Super Admin' || actor.userRole === 'Administrator';
  const parentHolderId = String(parentRow.employee_id);
  const callerIds = new Set(
    [actor.userId, actor.employeeId, actor.entityId]
      .filter((x): x is string => Boolean(x && x.trim()))
      .map((x) => x.toUpperCase())
  );
  if (!isAdminActor && !callerIds.has(parentHolderId.toUpperCase())) {
    throw new Error(
      'Access Denied: Only an Administrator or the current Primary custody holder can sub-assign this asset.'
    );
  }

  const target = resolveAssigneeTarget(db, payload.assigneeId, payload.assigneeType);
  if (!target) {
    throw new Error('Target Consultant / Retainer / Freelancer / YRP / Intern / Employee was not found.');
  }
  if (target.id.toUpperCase() === parentHolderId.toUpperCase()) {
    throw new Error('Cannot sub-assign an asset to the current Primary custody holder.');
  }

  if (target.assigneeType === 'Freelancer') {
    if (!payload.allotment) {
      throw new Error(
        'Freelancer Allotment Request Form details must be completed before sub-assigning an asset to a Freelancer.'
      );
    }
    const check = validateFreelancerAllotmentInput({
      flpId: target.id,
      flpName: payload.allotment.flpName || target.name,
      flpCode: payload.allotment.flpCode || target.code,
      flpAddress: payload.allotment.flpAddress || target.entity?.address || '',
      aadhaarNo: payload.allotment.aadhaarNo || target.entity?.aadhaarCard || '',
      panNo: payload.allotment.panNo || target.entity?.panCard || '',
      mobileNo: payload.allotment.mobileNo || target.entity?.phone || '',
      centerName: payload.allotment.centerName || target.entity?.center || 'Kolkata',
      executiveName: payload.allotment.executiveName || actor.userName,
      executiveEmpId: payload.allotment.executiveEmpId || actor.employeeId || actor.userId,
      jobNumber: payload.allotment.jobNumber || target.projectNo || '',
      issueDate: payload.allotment.issueDate || payload.assignDate,
      assetIds: [asset.id],
      accessories: payload.allotment.accessories,
    });
    if (!check.ok) {
      throw new Error(check.error);
    }
  }

  const existingIds = (db.prepare(`SELECT id FROM Assignments`).all() as Array<{ id: string }>).map((r) => r.id);
  const id = generateNextId('ASN', existingIds, 4);
  const projName = (payload.projectName ?? target.projectName ?? asset.projectName ?? '').trim();
  const projNo = (payload.projectNo ?? target.projectNo ?? asset.projectNo ?? '').trim();
  const eic = (payload.eicName ?? target.eicName ?? asset.eicName ?? '').trim();

  db.exec('BEGIN IMMEDIATE');
  try {
    let createdAllotment: FreelancerAllotmentRecord | undefined;
    if (target.assigneeType === 'Freelancer' && payload.allotment) {
      createdAllotment = insertFreelancerAllotmentInsideTx(db, {
        assignmentId: id,
        assetId: asset.id,
        target,
        allotment: payload.allotment,
      });
    }

    const assignment: Assignment = {
      id,
      assetId: asset.id,
      employeeId: target.id,
      assigneeType: target.assigneeType,
      assignedById: parentHolderId,
      assignedByRole: actor.userRole,
      parentAssignmentId: String(parentRow.id),
      custodyLevel: 'Sub-Assigned',
      assignDate: payload.assignDate,
      condition: payload.condition || asset.condition || 'Good',
      assignedBy: actor.userName,
      notes: payload.notes || '',
      projectName: projName || undefined,
      projectNo: projNo || undefined,
      eicName: eic || undefined,
      allotmentId: createdAllotment?.id,
      status: 'Active',
    };

    const accessoriesSummary = createdAllotment
      ? createdAllotment.accessories.map((a) => `${a.name} x${a.qty}`).join(', ')
      : asset.accessoriesIssued || '';

    db.prepare(`
      UPDATE Assets
      SET status = 'Assigned',
          project_name = ?,
          project_no = ?,
          eic_name = ?,
          assigned_flp = ?,
          flp_id = ?,
          date_of_issue = ?,
          date_of_return = '',
          accessories_issued = ?
      WHERE id = ?
    `).run(
      projName,
      projNo,
      eic,
      target.assigneeType === 'Freelancer' ? target.name : asset.assignedFlp || '',
      target.assigneeType === 'Freelancer' ? target.code : asset.flpId || '',
      payload.assignDate,
      accessoriesSummary,
      asset.id
    );

    db.prepare(`
      INSERT INTO Assignments (
        id, asset_id, employee_id, assignee_type, assigned_by_id, assigned_by_role,
        parent_assignment_id, custody_level, assign_date, return_date,
        condition, assigned_by, notes, project_name, project_no, eic_name, allotment_id, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Sub-Assigned', ?, '', ?, ?, ?, ?, ?, ?, ?, 'Active')
    `).run(
      id,
      assignment.assetId,
      assignment.employeeId,
      target.assigneeType,
      parentHolderId,
      actor.userRole,
      String(parentRow.id),
      assignment.assignDate,
      assignment.condition || 'Good',
      actor.userName,
      assignment.notes || '',
      projName,
      projNo,
      eic,
      createdAllotment?.id || ''
    );

    addAssetHistoryInDb(db, {
      assetId: asset.id,
      date: payload.assignDate,
      activity: 'Assigned',
      details: `Sub-Assigned to ${target.assigneeType} ${target.name} (ID: ${target.code}) under custody of ${actor.userName}.${createdAllotment ? ` Allotment Form: ${createdAllotment.id}.` : ''}${payload.notes ? ` Remarks: ${payload.notes}` : ''}`,
    });

    writeSystemAuditLog(db, {
      module: 'Asset',
      entityType: 'SubAssignment',
      entityId: id,
      action: 'ASSET_SUB_ASSIGNED',
      actor,
      afterObj: { assignment, allotmentId: createdAllotment?.id },
      details: `Sub-assigned ${asset.name} (${asset.id}) to ${target.assigneeType} ${target.name} (${target.code})`,
    });

    db.exec('COMMIT');
    return {
      assignment,
      asset: listAssetsFromDb(db).find((a) => a.id === asset.id)!,
      allotment: createdAllotment,
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function deleteAssignmentInDb(db: DatabaseSync, id: string, actor: AuditActorContext): boolean {
  const existing = db.prepare(`SELECT * FROM Assignments WHERE id = ?`).get(id);
  if (!existing) return false;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`DELETE FROM Assignments WHERE id = ?`).run(id);
    writeSystemAuditLog(db, {
      module: 'Asset',
      entityType: 'Assignment',
      entityId: id,
      action: 'ASSIGNMENT_DELETED',
      actor,
      beforeObj: existing,
      details: `Deleted assignment ${id}`,
    });
    db.exec('COMMIT');
    return true;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function returnAssetInDb(
  db: DatabaseSync,
  payload: {
    assetId: string;
    employeeId: string;
    assignmentId?: string;
    custodyLevel?: 'Primary' | 'Sub-Assigned';
    date: string;
    condition: Asset['condition'];
    damage: AssetReturn['damage'];
    remarks: string;
  },
  actor: AuditActorContext
): { assetReturn: AssetReturn; asset: Asset } {
  const asset = listAssetsFromDb(db).find((a) => a.id === payload.assetId);
  if (!asset) throw new Error('Asset not found.');

  const activeRows = db
    .prepare(`SELECT * FROM Assignments WHERE asset_id = ? AND status = 'Active'`)
    .all(asset.id) as Array<Record<string, unknown>>;

  const targetRow = payload.assignmentId
    ? activeRows.find((r) => String(r.id) === payload.assignmentId)
    : payload.custodyLevel === 'Sub-Assigned'
    ? activeRows.find((r) => String(r.custody_level) === 'Sub-Assigned')
    : activeRows.find((r) => String(r.custody_level || 'Primary') === 'Primary') || activeRows[0];

  const isSubReturn =
    Boolean(targetRow && String(targetRow.custody_level) === 'Sub-Assigned') ||
    payload.custodyLevel === 'Sub-Assigned';

  if (!isSubReturn) {
    const activeChild = activeRows.find((r) => String(r.custody_level) === 'Sub-Assigned');
    if (activeChild) {
      throw new Error(
        `Cannot return Primary assignment while asset ${asset.id} is actively sub-assigned (${String(activeChild.id)}). Return the sub-assignment first.`
      );
    }
  }

  const returnHolderId = targetRow ? String(targetRow.employee_id) : payload.employeeId;
  const resolvedTarget = resolveAssigneeTarget(db, returnHolderId);

  const existingIds = (db.prepare(`SELECT id FROM Asset_Returns`).all() as Array<{ id: string }>).map((r) => r.id);
  const id = generateNextId('RET', existingIds, 4);
  const assetReturn: AssetReturn = {
    id,
    date: payload.date,
    employeeId: resolvedTarget?.id || returnHolderId,
    assetId: asset.id,
    condition: payload.condition,
    damage: payload.damage,
    remarks: payload.remarks || '',
  };

  db.exec('BEGIN IMMEDIATE');
  try {
    if (isSubReturn && targetRow) {
      db.prepare(`UPDATE Assignments SET status = 'Returned', return_date = ? WHERE id = ?`).run(
        payload.date,
        String(targetRow.id)
      );
      const clearFlp = String(targetRow.assignee_type || '') === 'Freelancer';
      db.prepare(`
        UPDATE Assets
        SET status = 'Assigned',
            condition = ?,
            date_of_return = ?,
            assigned_flp = CASE WHEN ? THEN '' ELSE assigned_flp END,
            flp_id = CASE WHEN ? THEN '' ELSE flp_id END
        WHERE id = ?
      `).run(payload.condition, payload.date, clearFlp ? 1 : 0, clearFlp ? 1 : 0, asset.id);
    } else {
      db.prepare(`
        UPDATE Assets
        SET status = 'Available',
            condition = ?,
            date_of_return = ?,
            assigned_flp = '',
            flp_id = ''
        WHERE id = ?
      `).run(payload.condition, payload.date, asset.id);
      if (targetRow) {
        db.prepare(`UPDATE Assignments SET status = 'Returned', return_date = ? WHERE id = ?`).run(
          payload.date,
          String(targetRow.id)
        );
      } else {
        db.prepare(`UPDATE Assignments SET status = 'Returned', return_date = ? WHERE asset_id = ? AND status = 'Active'`).run(
          payload.date,
          asset.id
        );
      }
    }

    db.prepare(
      `INSERT INTO Asset_Returns (id, return_date, employee_id, asset_id, condition, damage, remarks) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, assetReturn.date, assetReturn.employeeId, assetReturn.assetId, assetReturn.condition, assetReturn.damage, assetReturn.remarks || '');

    addAssetHistoryInDb(db, {
      assetId: asset.id,
      date: payload.date,
      activity: 'Returned',
      details: `${isSubReturn ? 'Sub-assignment returned' : 'Returned'} by ${resolvedTarget?.name || 'Holder'}. Condition: ${payload.condition}. Damage: ${payload.damage}. Remarks: ${payload.remarks || '—'}`,
    });

    writeSystemAuditLog(db, {
      module: 'Asset',
      entityType: 'AssetReturn',
      entityId: id,
      action: isSubReturn ? 'SUB_ASSIGNMENT_RETURNED' : 'ASSET_RETURNED',
      actor,
      afterObj: assetReturn,
      details: `${isSubReturn ? 'Returned sub-assignment for' : 'Returned'} asset ${asset.name} (${asset.id})`,
    });

    db.exec('COMMIT');
    return { assetReturn, asset: listAssetsFromDb(db).find((a) => a.id === asset.id)! };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function deleteReturnInDb(db: DatabaseSync, id: string, actor: AuditActorContext): boolean {
  const existing = db.prepare(`SELECT * FROM Asset_Returns WHERE id = ?`).get(id);
  if (!existing) return false;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`DELETE FROM Asset_Returns WHERE id = ?`).run(id);
    writeSystemAuditLog(db, {
      module: 'Asset',
      entityType: 'AssetReturn',
      entityId: id,
      action: 'RETURN_DELETED',
      actor,
      beforeObj: existing,
      details: `Deleted return record ${id}`,
    });
    db.exec('COMMIT');
    return true;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function transferAssetInDb(
  db: DatabaseSync,
  payload: {
    assetId: string;
    currentEmployeeId: string;
    newEmployeeId: string;
    date: string;
    newLocation: string;
    reason: string;
    remarks: string;
  },
  actor: AuditActorContext
): { transfer: AssetTransfer; assignment: Assignment; asset: Asset } {
  const asset = listAssetsFromDb(db).find((a) => a.id === payload.assetId);
  if (!asset) throw new Error('Asset not found.');
  const oldEmp = db
    .prepare(`SELECT id, name, department FROM Employees WHERE id = ? OR employee_id = ? LIMIT 1`)
    .get(payload.currentEmployeeId, payload.currentEmployeeId) as
    | { id: string; name: string; department: string }
    | undefined;
  const newEmp = db
    .prepare(`SELECT id, name, department FROM Employees WHERE id = ? OR employee_id = ? LIMIT 1`)
    .get(payload.newEmployeeId, payload.newEmployeeId) as
    | { id: string; name: string; department: string }
    | undefined;
  if (!newEmp) throw new Error('Target employee not found.');

  const trfIds = (db.prepare(`SELECT id FROM Asset_Transfers`).all() as Array<{ id: string }>).map((r) => r.id);
  const asnIds = (db.prepare(`SELECT id FROM Assignments`).all() as Array<{ id: string }>).map((r) => r.id);
  const trfId = generateNextId('TRF', trfIds, 4);
  const asnId = generateNextId('ASN', asnIds, 4);

  const transfer: AssetTransfer = {
    id: trfId,
    date: payload.date,
    assetId: asset.id,
    fromDept: oldEmp?.department || asset.department,
    toDept: newEmp.department || asset.department,
    fromEmp: oldEmp?.name || 'Unknown',
    toEmp: newEmp.name,
    newLocation: payload.newLocation || asset.location,
    reason: payload.reason,
    remarks: payload.remarks,
  };

  const assignment: Assignment = {
    id: asnId,
    assetId: asset.id,
    employeeId: newEmp.id,
    assignDate: payload.date,
    condition: 'Good',
    assignedBy: actor.userName,
    notes: payload.remarks,
    status: 'Active',
  };

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`UPDATE Assets SET status = 'Assigned', department = ?, location = ? WHERE id = ?`).run(
      newEmp.department || asset.department,
      payload.newLocation || asset.location,
      asset.id
    );
    db.prepare(`UPDATE Assignments SET status = 'Transferred' WHERE asset_id = ? AND status = 'Active'`).run(asset.id);
    db.prepare(
      `INSERT INTO Assignments (id, asset_id, employee_id, assign_date, condition, assigned_by, notes, status) VALUES (?, ?, ?, ?, 'Good', ?, ?, 'Active')`
    ).run(asnId, asset.id, newEmp.id, payload.date, actor.userName, payload.remarks || '');
    db.prepare(
      `INSERT INTO Asset_Transfers (id, transfer_date, asset_id, from_dept, to_dept, from_emp, to_emp, new_location, reason, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      trfId,
      transfer.date,
      transfer.assetId,
      transfer.fromDept,
      transfer.toDept,
      transfer.fromEmp,
      transfer.toEmp,
      transfer.newLocation || '',
      transfer.reason,
      transfer.remarks || ''
    );

    addAssetHistoryInDb(db, {
      assetId: asset.id,
      date: payload.date,
      activity: 'Transferred',
      details: `Transferred from ${transfer.fromEmp} to ${transfer.toEmp} (Reason: ${payload.reason}). Transferred by ${actor.userName}`,
    });

    writeSystemAuditLog(db, {
      module: 'Asset',
      entityType: 'AssetTransfer',
      entityId: trfId,
      action: 'ASSET_TRANSFERRED',
      actor,
      afterObj: transfer,
      details: `Transferred asset ${asset.name} (${asset.id}) from ${transfer.fromEmp} to ${transfer.toEmp}`,
    });

    db.exec('COMMIT');
    return { transfer, assignment, asset: listAssetsFromDb(db).find((a) => a.id === asset.id)! };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function deleteTransferInDb(db: DatabaseSync, id: string, actor: AuditActorContext): boolean {
  const existing = db.prepare(`SELECT * FROM Asset_Transfers WHERE id = ?`).get(id);
  if (!existing) return false;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`DELETE FROM Asset_Transfers WHERE id = ?`).run(id);
    writeSystemAuditLog(db, {
      module: 'Asset',
      entityType: 'AssetTransfer',
      entityId: id,
      action: 'TRANSFER_DELETED',
      actor,
      beforeObj: existing,
      details: `Deleted transfer record ${id}`,
    });
    db.exec('COMMIT');
    return true;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function saveMaintenanceInDb(
  db: DatabaseSync,
  payload: Omit<MaintenanceRecord, 'id'> & { id?: string },
  actor: AuditActorContext
): MaintenanceRecord {
  const cfg = getWorkspaceSettingsFromDb(db);
  const existingIds = (db.prepare(`SELECT id FROM Maintenance_Records`).all() as Array<{ id: string }>).map((r) => r.id);
  const id = payload.id || generateNextId('MNT', existingIds, 4);
  const nextAssetStatus: AssetStatus =
    payload.status === 'Open' || payload.status === 'In Progress' ? 'Under Maintenance' : 'Available';

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`UPDATE Assets SET status = ? WHERE id = ? AND status != 'Disposed'`).run(nextAssetStatus, payload.assetId);
    db.prepare(
      `INSERT OR REPLACE INTO Maintenance_Records (id, asset_id, type, cost, vendor, status, service_date, next_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      payload.assetId,
      payload.type,
      Number(payload.cost) || 0,
      payload.vendor || '',
      payload.status,
      payload.serviceDate,
      payload.nextDate || '',
      payload.notes || ''
    );
    if (!payload.id) {
      addAssetHistoryInDb(db, {
        assetId: payload.assetId,
        date: payload.serviceDate,
        activity: 'Maintenance',
        details: `${payload.type} maintenance logged (${payload.status}). Cost: ${cfg.settings.currency}${Number(payload.cost).toLocaleString()}`,
      });
    }
    writeSystemAuditLog(db, {
      module: 'Maintenance',
      entityType: 'MaintenanceRecord',
      entityId: id,
      action: payload.id ? 'MAINTENANCE_UPDATED' : 'MAINTENANCE_CREATED',
      actor,
      afterObj: { ...payload, id },
      details: `${payload.id ? 'Updated' : 'Logged'} maintenance ${id} for asset ${payload.assetId}`,
    });
    db.exec('COMMIT');
    return { ...payload, id };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function deleteMaintenanceInDb(db: DatabaseSync, id: string, actor: AuditActorContext): boolean {
  const existing = db.prepare(`SELECT * FROM Maintenance_Records WHERE id = ?`).get(id);
  if (!existing) return false;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`DELETE FROM Maintenance_Records WHERE id = ?`).run(id);
    writeSystemAuditLog(db, {
      module: 'Maintenance',
      entityType: 'MaintenanceRecord',
      entityId: id,
      action: 'MAINTENANCE_DELETED',
      actor,
      beforeObj: existing,
      details: `Deleted maintenance record ${id}`,
    });
    db.exec('COMMIT');
    return true;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function disposeAssetInDb(
  db: DatabaseSync,
  payload: Omit<DisposalRecord, 'id'>,
  actor: AuditActorContext
): DisposalRecord {
  const cfg = getWorkspaceSettingsFromDb(db);
  const existingIds = (db.prepare(`SELECT id FROM Disposals`).all() as Array<{ id: string }>).map((r) => r.id);
  const id = generateNextId('DSP', existingIds, 4);
  const record: DisposalRecord = { ...payload, id };

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`UPDATE Assets SET status = 'Disposed', current_value = 0 WHERE id = ?`).run(payload.assetId);
    db.prepare(
      `INSERT INTO Disposals (id, asset_id, disposal_date, salvage_recovered, reason, notes) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, payload.assetId, payload.disposalDate, Number(payload.salvageRecovered) || 0, payload.reason || '', payload.notes || '');
    addAssetHistoryInDb(db, {
      assetId: payload.assetId,
      date: payload.disposalDate,
      activity: 'Disposed',
      details: `Asset decommissioned (${payload.reason}). Salvage: ${cfg.settings.currency}${payload.salvageRecovered}`,
    });
    writeSystemAuditLog(db, {
      module: 'Asset',
      entityType: 'DisposalRecord',
      entityId: id,
      action: 'ASSET_DISPOSED',
      actor,
      afterObj: record,
      details: `Disposed asset ${payload.assetId} (${payload.reason})`,
    });
    db.exec('COMMIT');
    return record;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function saveVendorInDb(
  db: DatabaseSync,
  payload: Omit<Vendor, 'id'> & { id?: string; isEdit?: boolean },
  actor: AuditActorContext
): Vendor {
  const id = (payload.id || '').trim().toUpperCase();
  if (!id) {
    throw new Error('VALIDATION:Manual Vendor Code is required.');
  }
  if (!/^[A-Z0-9_-]{2,24}$/.test(id)) {
    throw new Error('VALIDATION:Vendor Code must be 2–24 characters using A-Z, 0-9, underscore, or hyphen.');
  }
  if (!payload.name || !payload.name.trim()) {
    throw new Error('VALIDATION:Vendor Name is required.');
  }

  const existing = db
    .prepare(`SELECT * FROM Vendors WHERE UPPER(id) = UPPER(?) LIMIT 1`)
    .get(id) as Record<string, unknown> | undefined;

  if (!payload.isEdit && existing) {
    throw new Error(`CONFLICT:Vendor Code "${id}" already exists. Please enter a unique Vendor Code.`);
  }
  if (payload.isEdit && !existing) {
    throw new Error(`NOT_FOUND:Vendor "${id}" was not found.`);
  }

  const record: Vendor = {
    id,
    name: payload.name.trim(),
    contactPerson: (payload.contactPerson || '').trim(),
    phone: (payload.phone || '').trim(),
    email: (payload.email || '').trim(),
    address: (payload.address || '').trim(),
    gst: (payload.gst || '').trim().toUpperCase(),
    remarks: (payload.remarks || '').trim(),
  };

  db.exec('BEGIN IMMEDIATE');
  try {
    if (payload.isEdit) {
      db.prepare(
        `UPDATE Vendors SET name = ?, contact_person = ?, phone = ?, email = ?, address = ?, gst = ?, remarks = ? WHERE UPPER(id) = UPPER(?)`
      ).run(record.name, record.contactPerson, record.phone, record.email, record.address, record.gst, record.remarks || '', id);
    } else {
      db.prepare(
        `INSERT INTO Vendors (id, name, contact_person, phone, email, address, gst, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, record.name, record.contactPerson, record.phone, record.email, record.address, record.gst, record.remarks || '');
    }
    writeSystemAuditLog(db, {
      module: 'Vendor',
      entityType: 'Vendor',
      entityId: id,
      action: payload.isEdit ? 'VENDOR_UPDATED' : 'VENDOR_CREATED',
      actor,
      beforeObj: existing || null,
      afterObj: record,
      details: `${payload.isEdit ? 'Updated' : 'Created'} vendor ${record.name} (${id})`,
    });
    db.exec('COMMIT');
    return record;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function bulkImportVendorsInDb(
  db: DatabaseSync,
  params: {
    csvText: string;
    duplicatePolicy?: DirectoryDuplicatePolicy;
    actor: AuditActorContext;
  }
): BulkDirectoryImportResult & { vendors: Vendor[] } {
  const existingVendors = (
    db.prepare(`SELECT * FROM Vendors ORDER BY id DESC`).all() as Array<Record<string, unknown>>
  ).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    contactPerson: String(r.contact_person || ''),
    phone: String(r.phone || ''),
    email: String(r.email || ''),
    address: String(r.address || ''),
    gst: String(r.gst || ''),
    remarks: r.remarks ? String(r.remarks) : undefined,
  }));

  const duplicatePolicy = params.duplicatePolicy || 'skip';
  const plan = buildVendorImportPlan({
    csvText: params.csvText,
    existingVendors,
    duplicatePolicy,
  });

  const existingIds = new Set(existingVendors.map((v) => v.id.trim().toUpperCase()));
  const errors = [...plan.errors];
  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = plan.errors.filter((e) => e.reason.startsWith('Skipped:')).length;

  db.exec('BEGIN IMMEDIATE');
  try {
    const insertStmt = db.prepare(
      `INSERT INTO Vendors (id, name, contact_person, phone, email, address, gst, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, '')`
    );
    const updateStmt = db.prepare(
      `UPDATE Vendors SET name = ?, contact_person = ?, phone = ?, email = ?, address = ?, gst = ? WHERE UPPER(id) = UPPER(?)`
    );

    for (const row of plan.validRows) {
      if (existingIds.has(row.id)) {
        if (duplicatePolicy === 'update') {
          updateStmt.run(
            row.name,
            row.contactPerson,
            row.phone,
            row.email,
            row.address,
            row.gst,
            row.id
          );
          updatedCount++;
        } else {
          skippedCount++;
          errors.push({
            rowNumber: row.rowNumber,
            code: row.id,
            name: row.name,
            reason: `Skipped: Vendor Code "${row.id}" already exists.`,
          });
        }
        continue;
      }

      insertStmt.run(
        row.id,
        row.name,
        row.contactPerson,
        row.phone,
        row.email,
        row.address,
        row.gst
      );
      existingIds.add(row.id);
      createdCount++;
    }

    const failedCount = errors.filter((e) => !e.reason.startsWith('Skipped:')).length;

    writeSystemAuditLog(db, {
      module: 'Vendor',
      entityType: 'VendorBulkImport',
      entityId: 'vendor-bulk-import',
      action: 'VENDOR_BULK_IMPORTED',
      actor: params.actor,
      afterObj: {
        totalRows: plan.totalRows,
        createdCount,
        updatedCount,
        skippedCount,
        failedCount,
      },
      details: `Bulk imported vendors: ${createdCount} created, ${updatedCount} updated, ${skippedCount} skipped, ${failedCount} failed`,
    });

    db.exec('COMMIT');
    const vendors = (
      db.prepare(`SELECT * FROM Vendors ORDER BY id DESC`).all() as Array<Record<string, unknown>>
    ).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      contactPerson: String(r.contact_person || ''),
      phone: String(r.phone || ''),
      email: String(r.email || ''),
      address: String(r.address || ''),
      gst: String(r.gst || ''),
      remarks: r.remarks ? String(r.remarks) : undefined,
    }));

    return {
      directoryLabel: 'Vendor',
      totalRows: plan.totalRows,
      createdCount,
      updatedCount,
      skippedCount,
      failedCount,
      errors: errors.map((e) => ({
        rowNumber: e.rowNumber,
        employeeId: e.code,
        name: e.name,
        reason: e.reason,
      })),
      vendors,
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function deleteVendorInDb(db: DatabaseSync, id: string, actor: AuditActorContext): boolean {
  const existing = db.prepare(`SELECT * FROM Vendors WHERE id = ?`).get(id);
  if (!existing) return false;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`DELETE FROM Vendors WHERE id = ?`).run(id);
    writeSystemAuditLog(db, {
      module: 'Vendor',
      entityType: 'Vendor',
      entityId: id,
      action: 'VENDOR_DELETED',
      actor,
      beforeObj: existing,
      details: `Deleted vendor ${id}`,
    });
    db.exec('COMMIT');
    return true;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function createExpenseCategoryInDb(
  db: DatabaseSync,
  payload: { name: string; description?: string; active?: boolean },
  actor: AuditActorContext
): ExpenseCategoryRecord {
  const name = (payload.name || '').trim();
  if (!name) throw new Error('VALIDATION:Expense Category name is required.');
  const dup = db
    .prepare(`SELECT id FROM Expense_Categories WHERE LOWER(name) = LOWER(?) LIMIT 1`)
    .get(name) as { id: string } | undefined;
  if (dup) throw new Error(`CONFLICT:Expense Category "${name}" already exists.`);

  const id = `ECAT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const nowIso = new Date().toISOString();
  const active = payload.active !== false;
  db.prepare(
    `INSERT INTO Expense_Categories (id, name, description, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, name, (payload.description || '').trim(), active ? 1 : 0, nowIso, nowIso);

  const record: ExpenseCategoryRecord = {
    id,
    name,
    description: (payload.description || '').trim(),
    active,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  writeSystemAuditLog(db, {
    module: 'Expense',
    entityType: 'ExpenseCategory',
    entityId: id,
    action: 'EXPENSE_CATEGORY_CREATED',
    actor,
    afterObj: record,
    details: `Created Expense Category "${name}"`,
  });
  return record;
}

export function updateExpenseCategoryInDb(
  db: DatabaseSync,
  id: string,
  payload: { name?: string; description?: string; active?: boolean },
  actor: AuditActorContext
): ExpenseCategoryRecord {
  const existing = db
    .prepare(`SELECT * FROM Expense_Categories WHERE id = ? LIMIT 1`)
    .get(id) as Record<string, unknown> | undefined;
  if (!existing) throw new Error('NOT_FOUND:Expense Category not found.');

  const prevName = String(existing.name);
  const nextName = payload.name !== undefined ? payload.name.trim() : prevName;
  if (!nextName) throw new Error('VALIDATION:Expense Category name is required.');
  const dup = db
    .prepare(`SELECT id FROM Expense_Categories WHERE LOWER(name) = LOWER(?) AND id != ? LIMIT 1`)
    .get(nextName, id) as { id: string } | undefined;
  if (dup) throw new Error(`CONFLICT:Expense Category "${nextName}" already exists.`);

  const nextDesc =
    payload.description !== undefined ? payload.description.trim() : String(existing.description || '');
  const nextActive = payload.active !== undefined ? payload.active : Number(existing.is_active) === 1;
  const nowIso = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `UPDATE Expense_Categories SET name = ?, description = ?, is_active = ?, updated_at = ? WHERE id = ?`
    ).run(nextName, nextDesc, nextActive ? 1 : 0, nowIso, id);
    if (nextName !== prevName) {
      db.prepare(`UPDATE Expenses SET category = ? WHERE LOWER(category) = LOWER(?)`).run(nextName, prevName);
    }
    const updated: ExpenseCategoryRecord = {
      id,
      name: nextName,
      description: nextDesc,
      active: nextActive,
      createdAt: String(existing.created_at || nowIso),
      updatedAt: nowIso,
    };
    writeSystemAuditLog(db, {
      module: 'Expense',
      entityType: 'ExpenseCategory',
      entityId: id,
      action: 'EXPENSE_CATEGORY_UPDATED',
      actor,
      beforeObj: existing,
      afterObj: updated,
      details: `Updated Expense Category "${prevName}" -> "${nextName}"`,
    });
    db.exec('COMMIT');
    return updated;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function toggleExpenseCategoryActiveInDb(
  db: DatabaseSync,
  id: string,
  active: boolean,
  actor: AuditActorContext
): ExpenseCategoryRecord {
  return updateExpenseCategoryInDb(db, id, { active }, actor);
}

export function deleteExpenseCategoryInDb(
  db: DatabaseSync,
  id: string,
  actor: AuditActorContext
): boolean {
  const existing = db
    .prepare(`SELECT * FROM Expense_Categories WHERE id = ? LIMIT 1`)
    .get(id) as Record<string, unknown> | undefined;
  if (!existing) return false;
  const usageCount =
    (
      db
        .prepare(`SELECT COUNT(*) as c FROM Expenses WHERE LOWER(category) = LOWER(?)`)
        .get(String(existing.name)) as { c: number }
    )?.c || 0;
  if (usageCount > 0) {
    throw new Error(
      `CONFLICT:Expense Category "${String(existing.name)}" is used by ${usageCount} expense record(s). Deactivate it instead.`
    );
  }
  db.prepare(`DELETE FROM Expense_Categories WHERE id = ?`).run(id);
  writeSystemAuditLog(db, {
    module: 'Expense',
    entityType: 'ExpenseCategory',
    entityId: id,
    action: 'EXPENSE_CATEGORY_DELETED',
    actor,
    beforeObj: existing,
    details: `Deleted Expense Category "${String(existing.name)}"`,
  });
  return true;
}

export function createPaymentModeInDb(
  db: DatabaseSync,
  payload: { name: string; description?: string; active?: boolean },
  actor: AuditActorContext
): PaymentModeRecord {
  const name = (payload.name || '').trim();
  if (!name) throw new Error('VALIDATION:Payment Mode name is required.');
  const dup = db
    .prepare(`SELECT id FROM Payment_Modes WHERE LOWER(name) = LOWER(?) LIMIT 1`)
    .get(name) as { id: string } | undefined;
  if (dup) throw new Error(`CONFLICT:Payment Mode "${name}" already exists.`);

  const id = `PMODE-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const nowIso = new Date().toISOString();
  const active = payload.active !== false;
  db.prepare(
    `INSERT INTO Payment_Modes (id, name, description, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, name, (payload.description || '').trim(), active ? 1 : 0, nowIso, nowIso);

  const record: PaymentModeRecord = {
    id,
    name,
    description: (payload.description || '').trim(),
    active,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  writeSystemAuditLog(db, {
    module: 'Expense',
    entityType: 'PaymentMode',
    entityId: id,
    action: 'PAYMENT_MODE_CREATED',
    actor,
    afterObj: record,
    details: `Created Payment Mode "${name}"`,
  });
  return record;
}

export function updatePaymentModeInDb(
  db: DatabaseSync,
  id: string,
  payload: { name?: string; description?: string; active?: boolean },
  actor: AuditActorContext
): PaymentModeRecord {
  const existing = db
    .prepare(`SELECT * FROM Payment_Modes WHERE id = ? LIMIT 1`)
    .get(id) as Record<string, unknown> | undefined;
  if (!existing) throw new Error('NOT_FOUND:Payment Mode not found.');

  const prevName = String(existing.name);
  const nextName = payload.name !== undefined ? payload.name.trim() : prevName;
  if (!nextName) throw new Error('VALIDATION:Payment Mode name is required.');
  const dup = db
    .prepare(`SELECT id FROM Payment_Modes WHERE LOWER(name) = LOWER(?) AND id != ? LIMIT 1`)
    .get(nextName, id) as { id: string } | undefined;
  if (dup) throw new Error(`CONFLICT:Payment Mode "${nextName}" already exists.`);

  const nextDesc =
    payload.description !== undefined ? payload.description.trim() : String(existing.description || '');
  const nextActive = payload.active !== undefined ? payload.active : Number(existing.is_active) === 1;
  const nowIso = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `UPDATE Payment_Modes SET name = ?, description = ?, is_active = ?, updated_at = ? WHERE id = ?`
    ).run(nextName, nextDesc, nextActive ? 1 : 0, nowIso, id);
    if (nextName !== prevName) {
      db.prepare(`UPDATE Expenses SET mode = ? WHERE LOWER(mode) = LOWER(?)`).run(nextName, prevName);
    }
    const updated: PaymentModeRecord = {
      id,
      name: nextName,
      description: nextDesc,
      active: nextActive,
      createdAt: String(existing.created_at || nowIso),
      updatedAt: nowIso,
    };
    writeSystemAuditLog(db, {
      module: 'Expense',
      entityType: 'PaymentMode',
      entityId: id,
      action: 'PAYMENT_MODE_UPDATED',
      actor,
      beforeObj: existing,
      afterObj: updated,
      details: `Updated Payment Mode "${prevName}" -> "${nextName}"`,
    });
    db.exec('COMMIT');
    return updated;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function togglePaymentModeActiveInDb(
  db: DatabaseSync,
  id: string,
  active: boolean,
  actor: AuditActorContext
): PaymentModeRecord {
  return updatePaymentModeInDb(db, id, { active }, actor);
}

export function deletePaymentModeInDb(
  db: DatabaseSync,
  id: string,
  actor: AuditActorContext
): boolean {
  const existing = db
    .prepare(`SELECT * FROM Payment_Modes WHERE id = ? LIMIT 1`)
    .get(id) as Record<string, unknown> | undefined;
  if (!existing) return false;
  const usageCount =
    (
      db
        .prepare(`SELECT COUNT(*) as c FROM Expenses WHERE LOWER(mode) = LOWER(?)`)
        .get(String(existing.name)) as { c: number }
    )?.c || 0;
  if (usageCount > 0) {
    throw new Error(
      `CONFLICT:Payment Mode "${String(existing.name)}" is used by ${usageCount} expense record(s). Deactivate it instead.`
    );
  }
  db.prepare(`DELETE FROM Payment_Modes WHERE id = ?`).run(id);
  writeSystemAuditLog(db, {
    module: 'Expense',
    entityType: 'PaymentMode',
    entityId: id,
    action: 'PAYMENT_MODE_DELETED',
    actor,
    beforeObj: existing,
    details: `Deleted Payment Mode "${String(existing.name)}"`,
  });
  return true;
}

export function saveExpenseInDb(
  db: DatabaseSync,
  payload: Omit<ExpenseRecord, 'id'> & { id?: string; isEdit?: boolean },
  actor: AuditActorContext
): ExpenseRecord {
  const id = (payload.id || '').trim().toUpperCase();
  if (!id) {
    throw new Error('VALIDATION:Manual Expense Number is required.');
  }
  if (!/^[A-Z0-9_-]{2,24}$/.test(id)) {
    throw new Error('VALIDATION:Expense Number must be 2–24 characters using A-Z, 0-9, underscore, or hyphen.');
  }
  if (!payload.paidTo || !payload.paidTo.trim()) {
    throw new Error('VALIDATION:Paid To is required.');
  }
  if (!(Number(payload.amount) > 0)) {
    throw new Error('VALIDATION:Amount must be greater than zero.');
  }

  const existing = db
    .prepare(`SELECT * FROM Expenses WHERE UPPER(id) = UPPER(?) LIMIT 1`)
    .get(id) as Record<string, unknown> | undefined;

  if (!payload.isEdit && existing) {
    throw new Error(`CONFLICT:Expense Number "${id}" already exists. Please enter a unique Expense Number.`);
  }
  if (payload.isEdit && !existing) {
    throw new Error(`NOT_FOUND:Expense "${id}" was not found.`);
  }

  const categories = listExpenseCategoriesFromDb(db, false);
  const modes = listPaymentModesFromDb(db, false);
  const reqCat = (payload.category || '').trim();
  const reqMode = (payload.mode || '').trim();

  const matchedCat = categories.find((c) => c.name.toLowerCase() === reqCat.toLowerCase());
  const matchedMode = modes.find((m) => m.name.toLowerCase() === reqMode.toLowerCase());

  if (categories.length > 0 && (!matchedCat || (!matchedCat.active && existing?.category !== matchedCat.name))) {
    throw new Error(`VALIDATION:Selected Expense Category "${reqCat}" is invalid or inactive.`);
  }
  if (modes.length > 0 && (!matchedMode || (!matchedMode.active && existing?.mode !== matchedMode.name))) {
    throw new Error(`VALIDATION:Selected Payment Mode "${reqMode}" is invalid or inactive.`);
  }

  const record: ExpenseRecord = {
    id,
    date: (payload.date || new Date().toISOString().slice(0, 10)).trim(),
    category: matchedCat ? matchedCat.name : reqCat || 'Misc',
    paidTo: payload.paidTo.trim(),
    amount: Number(payload.amount) || 0,
    mode: matchedMode ? matchedMode.name : reqMode || 'Cash',
    remarks: (payload.remarks || '').trim(),
  };

  db.exec('BEGIN IMMEDIATE');
  try {
    if (payload.isEdit) {
      db.prepare(
        `UPDATE Expenses SET expense_date = ?, category = ?, paid_to = ?, amount = ?, mode = ?, remarks = ? WHERE UPPER(id) = UPPER(?)`
      ).run(record.date, record.category, record.paidTo, record.amount, record.mode, record.remarks, id);
    } else {
      db.prepare(
        `INSERT INTO Expenses (id, expense_date, category, paid_to, amount, mode, remarks) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(id, record.date, record.category, record.paidTo, record.amount, record.mode, record.remarks);
    }
    writeSystemAuditLog(db, {
      module: 'Expense',
      entityType: 'ExpenseRecord',
      entityId: id,
      action: payload.isEdit ? 'EXPENSE_UPDATED' : 'EXPENSE_CREATED',
      actor,
      beforeObj: existing || null,
      afterObj: record,
      details: `${payload.isEdit ? 'Updated' : 'Created'} expense ${id} (${record.category}, ${record.amount})`,
    });
    db.exec('COMMIT');
    return record;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function deleteExpenseInDb(db: DatabaseSync, id: string, actor: AuditActorContext): boolean {
  const existing = db.prepare(`SELECT * FROM Expenses WHERE id = ?`).get(id);
  if (!existing) return false;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`DELETE FROM Expenses WHERE id = ?`).run(id);
    writeSystemAuditLog(db, {
      module: 'Expense',
      entityType: 'ExpenseRecord',
      entityId: id,
      action: 'EXPENSE_DELETED',
      actor,
      beforeObj: existing,
      details: `Deleted expense ${id}`,
    });
    db.exec('COMMIT');
    return true;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function listAllTicketsFromDb(db: DatabaseSync): SupportTicket[] {
  const rows = db
    .prepare(`SELECT * FROM Support_Tickets ORDER BY CASE WHEN queue_order > 0 THEN queue_order ELSE 999999 END ASC, created_at ASC`)
    .all() as Array<Record<string, unknown>>;
  const markOverrunStmt = db.prepare(`UPDATE Support_Tickets SET status = 'Open' WHERE id = ? AND status = 'Approved'`);
  const tickets = rows.map((r) => {
    const ticket: SupportTicket = {
      id: String(r.id),
      employeeId: String(r.employee_id),
      assetId: String(r.asset_id),
      subject: String(r.subject),
      description: String(r.description),
      priority: (r.priority as SupportTicket['priority']) || 'Medium',
      status: (r.status as SupportTicket['status']) || 'Requested',
      createdAt: String(r.created_at),
      queueOrder: r.queue_order !== null && r.queue_order !== undefined ? Number(r.queue_order) : undefined,
      createdByRole: r.created_by_role ? String(r.created_by_role) : undefined,
      requestedDate: r.requested_date ? String(r.requested_date) : undefined,
      requestedStartTime: r.requested_start_time ? String(r.requested_start_time) : undefined,
      requestedDurationMins:
        r.requested_duration_mins !== null && r.requested_duration_mins !== undefined
          ? Number(r.requested_duration_mins)
          : undefined,
      bookedSlotId: r.booked_slot_id ? String(r.booked_slot_id) : undefined,
      workOrderDate: r.work_order_date ? String(r.work_order_date) : undefined,
      workOrderStartTime: r.work_order_start_time ? String(r.work_order_start_time) : undefined,
      workOrderDurationMins:
        r.work_order_duration_mins !== null && r.work_order_duration_mins !== undefined
          ? Number(r.work_order_duration_mins)
          : undefined,
      workOrderEndTime: r.work_order_end_time ? String(r.work_order_end_time) : undefined,
      employeeConfirmed: Boolean(r.employee_confirmed),
      employeeConfirmedAt: r.employee_confirmed_at ? String(r.employee_confirmed_at) : undefined,
      workOrderMailSentAt: r.work_order_mail_sent_at ? String(r.work_order_mail_sent_at) : undefined,
      approvalStatus: (r.approval_status as SupportTicket['approvalStatus']) || 'Pending',
      approvedBy: r.approved_by ? String(r.approved_by) : undefined,
      approvedAt: r.approved_at ? String(r.approved_at) : undefined,
      rejectionReason: r.rejection_reason ? String(r.rejection_reason) : undefined,
      closedBy: r.closed_by ? String(r.closed_by) : undefined,
      closedAt: r.closed_at ? String(r.closed_at) : undefined,
    };
    const effective = resolveEffectiveTicketStatus(ticket);
    if (effective !== ticket.status) {
      markOverrunStmt.run(ticket.id);
      return { ...ticket, status: effective };
    }
    return ticket;
  });
  return sortTicketsFcfs(tickets);
}

export function createTicketInDb(
  db: DatabaseSync,
  ticket: SupportTicket,
  actor: AuditActorContext
): SupportTicket {
  const maxRow = db
    .prepare(`SELECT COALESCE(MAX(queue_order), 0) as m, COUNT(*) as c FROM Support_Tickets`)
    .get() as { m: number; c: number };
  const nextOrder = ticket.queueOrder && ticket.queueOrder > 0 ? ticket.queueOrder : Math.max(maxRow.m, maxRow.c) + 1;

  const normalized: SupportTicket = {
    ...ticket,
    priority: ticket.priority || 'Medium',
    status: ticket.status || 'Requested',
    queueOrder: nextOrder,
    approvalStatus: ticket.approvalStatus || 'Pending',
  };
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT OR REPLACE INTO Support_Tickets (
        id, employee_id, asset_id, subject, description, priority, status, created_at,
        queue_order, created_by_role, requested_date, requested_start_time, requested_duration_mins,
        booked_slot_id, work_order_date, work_order_start_time, work_order_duration_mins, work_order_end_time,
        employee_confirmed, employee_confirmed_at, work_order_mail_sent_at,
        approval_status, approved_by, approved_at, rejection_reason, closed_by, closed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      normalized.id,
      normalized.employeeId,
      normalized.assetId,
      normalized.subject,
      normalized.description,
      normalized.priority,
      normalized.status,
      normalized.createdAt,
      normalized.queueOrder || 1,
      normalized.createdByRole || null,
      normalized.requestedDate || null,
      normalized.requestedStartTime || null,
      normalized.requestedDurationMins ?? null,
      normalized.bookedSlotId || null,
      normalized.workOrderDate || null,
      normalized.workOrderStartTime || null,
      normalized.workOrderDurationMins ?? null,
      normalized.workOrderEndTime || null,
      normalized.employeeConfirmed ? 1 : 0,
      normalized.employeeConfirmedAt || null,
      normalized.workOrderMailSentAt || null,
      normalized.approvalStatus,
      normalized.approvedBy || null,
      normalized.approvedAt || null,
      normalized.rejectionReason || null,
      normalized.closedBy || null,
      normalized.closedAt || null
    );
    writeSystemAuditLog(db, {
      module: 'Ticket',
      entityType: 'SupportTicket',
      entityId: normalized.id,
      action: 'TICKET_CREATED',
      actor,
      afterObj: normalized,
      details: `Raised support ticket ${normalized.id}: ${normalized.subject}`,
    });
    db.exec('COMMIT');
    return normalized;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function updateTicketInDb(
  db: DatabaseSync,
  id: string,
  patch: Partial<SupportTicket>,
  actor: AuditActorContext
): SupportTicket | null {
  const existing = listAllTicketsFromDb(db).find((t) => t.id === id);
  if (!existing) return null;
  const draft: SupportTicket = {
    ...existing,
    ...patch,
    id: existing.id,
  };
  const updated: SupportTicket = {
    ...draft,
    status: resolveEffectiveTicketStatus(draft),
  };

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `UPDATE Support_Tickets SET
        status = ?,
        priority = ?,
        queue_order = ?,
        requested_date = ?,
        requested_start_time = ?,
        requested_duration_mins = ?,
        booked_slot_id = ?,
        work_order_date = ?,
        work_order_start_time = ?,
        work_order_duration_mins = ?,
        work_order_end_time = ?,
        employee_confirmed = ?,
        employee_confirmed_at = ?,
        work_order_mail_sent_at = ?,
        approval_status = ?,
        approved_by = ?,
        approved_at = ?,
        rejection_reason = ?,
        closed_by = ?,
        closed_at = ?
       WHERE id = ?`
    ).run(
      updated.status,
      updated.priority || 'Medium',
      updated.queueOrder ?? 0,
      updated.requestedDate || null,
      updated.requestedStartTime || null,
      updated.requestedDurationMins ?? null,
      updated.bookedSlotId || null,
      updated.workOrderDate || null,
      updated.workOrderStartTime || null,
      updated.workOrderDurationMins ?? null,
      updated.workOrderEndTime || null,
      updated.employeeConfirmed ? 1 : 0,
      updated.employeeConfirmedAt || null,
      updated.workOrderMailSentAt || null,
      updated.approvalStatus || 'Pending',
      updated.approvedBy || null,
      updated.approvedAt || null,
      updated.rejectionReason || null,
      updated.closedBy || null,
      updated.closedAt || null,
      id
    );
    writeSystemAuditLog(db, {
      module: 'Ticket',
      entityType: 'SupportTicket',
      entityId: id,
      action: 'TICKET_UPDATED',
      actor,
      beforeObj: existing,
      afterObj: updated,
      details: `Updated ticket ${id} status to ${updated.status}`,
    });
    db.exec('COMMIT');
    return updated;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function reorderTicketsInDb(
  db: DatabaseSync,
  orderedTicketIds: string[],
  actor: AuditActorContext
): SupportTicket[] {
  const existing = listAllTicketsFromDb(db);
  const rankMap = new Map<string, number>();
  orderedTicketIds.forEach((id, idx) => rankMap.set(id, idx + 1));
  let fallbackOrder = orderedTicketIds.length + 1;

  db.exec('BEGIN IMMEDIATE');
  try {
    const stmt = db.prepare(`UPDATE Support_Tickets SET queue_order = ? WHERE id = ?`);
    for (const t of existing) {
      const rank = rankMap.get(t.id) ?? fallbackOrder++;
      stmt.run(rank, t.id);
    }
    writeSystemAuditLog(db, {
      module: 'Ticket',
      entityType: 'SupportTicketQueue',
      entityId: 'queue',
      action: 'TICKETS_REORDERED',
      actor,
      afterObj: orderedTicketIds,
      details: `Manually reordered Admin Support Ticket Queue (${orderedTicketIds.length} tickets)`,
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return listAllTicketsFromDb(db);
}

