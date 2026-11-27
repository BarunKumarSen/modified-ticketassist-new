import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { validatePasswordStrength } from '../auth/authLogic.ts';
import {
  PERMISSION_DEFINITIONS,
  PREDEFINED_ROLES,
  isValidPermission,
  resolveEffectivePermissions,
  type PermissionName,
} from '../auth/permissions.ts';
import {
  DEFAULT_INDIAN_CENTER,
  INDIAN_CENTERS,
  LEGACY_CENTER_NAMES,
  LEGACY_TO_INDIAN_CENTER_MAP,
  normalizeCenterName,
} from '../data/indianCenters.ts';
import { seedData, SEED_ADMIN_EMAIL, SEED_ADMIN_ID, SEED_ADMIN_LOGIN_ID, SEED_ADMIN_PASSWORD } from '../data/seedData.ts';
import type {
  BulkDirectoryImportResult,
  BulkEmployeeImportResult,
  DepartmentDesignation,
  Employee,
  EmploymentCategory,
  EmploymentConversionRecord,
  PersonnelEntity,
  PersonnelEntityType,
  VisitorAnalyticsSummary,
} from '../types/asset.ts';
import type {
  EmployeeCenterRecord,
  PolicyAcknowledgmentRecord,
  PolicyCategory,
  PolicyDocumentRecord,
  PolicyVersionHistoryEntry,
} from '../types/policy.ts';
import { formatFiveDigitEmployeeId, generateNextId } from '../utils/assetMath.ts';
import {
  buildPersonnelImportPlan,
  type DirectoryDuplicatePolicy,
} from '../utils/directoryImportExport.ts';
import {
  buildEmployeeImportPlan,
  type EmployeeImportDuplicatePolicy,
} from '../utils/employeeImport.ts';
import {
  DEFAULT_CENTER_OFFICES,
  ENTITY_ID_REGEX,
  normalizeEntityIdInput,
  PERSONNEL_ENTITY_TYPES,
  validateEntityId,
  validatePersonnelEntityInput,
} from '../utils/entityValidation.ts';
import {
  buildRolledNationalHolidays,
  type NationalHolidayOverrideRecord,
} from '../utils/holidayRollover.ts';
import { isAdminRole, validateManagerMapping, validateRevokeConsultantManager } from '../utils/hierarchyLogic.ts';
import {
  buildDefaultSeedPolicies,
  bumpPolicyVersion,
  canRoleCategoryViewPolicy,
  isValidPdfBase64,
  parsePolicyHistory,
  parseVisibleRoles,
} from '../utils/policyLogic.ts';
import {
  type AuditActorContext,
  seedWorkspaceTablesIfNeeded,
  writeSystemAuditLog,
} from './workspaceStore.ts';
import type {
  ApprovalEntityType,
  EmailAuditRecord,
  EmailDashboardSummary,
  EmailDeliveryStatus,
  EmailLogRecord,
  EmployeeMailReportRow,
  ManagerMailReportRow,
} from '../types/mail.ts';
import type {
  AttendanceAuditLog,
  AttendanceRecord,
  AttendanceStatus,
  LeaveRecord,
  LeaveStatus,
  LeaveType,
  PublicHoliday,
  WorkflowRequestRecord,
  WorkflowRequestStatus,
  WorkflowRequestType,
} from '../types/attendance.ts';
import type { PermissionRecord, RoleRecord, SessionUser } from '../types/user.ts';
import {
  calculateLateMinutes,
  calculateLeaveDays,
  calculateWorkHours,
  deriveAttendanceStatusOnCheckIn,
  getDateRangeList,
} from '../utils/attendanceLogic.ts';
import { hashPassword, initSecurityForDatabase, verifyPassword } from '../../server/security.ts';

export type AppDatabase = DatabaseSync;

const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'data', 'assetos.db');
const SCHEMA_SQL_PATH = path.resolve(process.cwd(), 'src', 'db', 'schema.sql');
export const PRODUCTION_CLEAN_META_KEY = 'production_clean_state';

/** Returns true if a table with the given name exists in the SQLite database. */
function tableExists(db: AppDatabase, tableName: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
    .get(tableName) as { name: string } | undefined;
  return Boolean(row);
}

/** Returns true when this database has been prepared as a clean production deployment (no demo data re-seeding). */
export function isProductionCleanDatabase(db: AppDatabase): boolean {
  if (!tableExists(db, 'App_Meta')) return false;
  const row = db
    .prepare(`SELECT meta_value FROM App_Meta WHERE meta_key = ? LIMIT 1`)
    .get(PRODUCTION_CLEAN_META_KEY) as { meta_value: string } | undefined;
  return row?.meta_value === '1';
}

/** Returns true if a column with the given name exists on the given table. */
function columnExists(db: AppDatabase, tableName: string, columnName: string): boolean {
  if (!tableExists(db, tableName)) return false;
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === columnName);
}

/**
 * Guarantees Employee_Centers has every column this codebase expects. Defensive against
 * legacy databases whose schema predates the Indian-centers refactor. Safe to call on
 * every startup — idempotent.
 */
function ensureEmployeeCentersSchema(db: AppDatabase): void {
  if (!tableExists(db, 'Employee_Centers')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS Employee_Centers (
        id TEXT PRIMARY KEY,
        city_name TEXT NOT NULL,
        state_name TEXT NOT NULL DEFAULT 'India',
        center_code TEXT NOT NULL DEFAULT 'IND',
        official_address TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
    `);
    return;
  }

  const legacyNameCol = ['name', 'city', 'location', 'cityName'].find((c) =>
    columnExists(db, 'Employee_Centers', c)
  );

  if (!columnExists(db, 'Employee_Centers', 'city_name')) {
    db.exec(`ALTER TABLE Employee_Centers ADD COLUMN city_name TEXT NOT NULL DEFAULT '';`);
    if (legacyNameCol) {
      db.exec(
        `UPDATE Employee_Centers SET city_name = COALESCE(NULLIF(TRIM(${legacyNameCol}), ''), 'Unknown') WHERE city_name = '';`
      );
    }
  }
  if (!columnExists(db, 'Employee_Centers', 'state_name')) {
    db.exec(`ALTER TABLE Employee_Centers ADD COLUMN state_name TEXT NOT NULL DEFAULT 'India';`);
  }
  if (!columnExists(db, 'Employee_Centers', 'center_code')) {
    db.exec(`ALTER TABLE Employee_Centers ADD COLUMN center_code TEXT NOT NULL DEFAULT 'IND';`);
  }
  if (!columnExists(db, 'Employee_Centers', 'official_address')) {
    db.exec(`ALTER TABLE Employee_Centers ADD COLUMN official_address TEXT NOT NULL DEFAULT '';`);
  }
  if (!columnExists(db, 'Employee_Centers', 'phone')) {
    db.exec(`ALTER TABLE Employee_Centers ADD COLUMN phone TEXT NOT NULL DEFAULT '';`);
  }
  if (!columnExists(db, 'Employee_Centers', 'is_active')) {
    db.exec(`ALTER TABLE Employee_Centers ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;`);
  }
  if (!columnExists(db, 'Employee_Centers', 'created_at')) {
    db.exec(`ALTER TABLE Employee_Centers ADD COLUMN created_at TEXT NOT NULL DEFAULT '';`);
  }
}

function backfillDefaultCenterOffices(db: AppDatabase): void {
  const updStmt = db.prepare(`
    UPDATE Employee_Centers
    SET official_address = CASE WHEN COALESCE(TRIM(official_address), '') = '' THEN ? ELSE official_address END,
        phone = CASE WHEN COALESCE(TRIM(phone), '') = '' THEN ? ELSE phone END
    WHERE LOWER(TRIM(city_name)) = LOWER(?)
  `);
  for (const [cityKey, office] of Object.entries(DEFAULT_CENTER_OFFICES)) {
    updStmt.run(office.address, office.phone, cityKey);
  }
}

function ensurePersonnelAndPolicyTables(db: AppDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS Policy_Acknowledgments (
      id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      user_role TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT '',
      entity_code TEXT NOT NULL DEFAULT '',
      acknowledged_at TEXT NOT NULL,
      UNIQUE (policy_id, policy_version, user_id)
    );
    CREATE TABLE IF NOT EXISTS Personnel_Entities (
      id TEXT PRIMARY KEY,
      entity_code TEXT NOT NULL UNIQUE,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('Consultant', 'Retainer', 'Freelancer', 'Young Research Program', 'Intern')),
      name TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      personal_email TEXT NOT NULL DEFAULT '',
      official_email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      whatsapp_no TEXT NOT NULL DEFAULT '',
      father_husband_name TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      center TEXT NOT NULL DEFAULT 'Kolkata',
      department TEXT NOT NULL DEFAULT 'Operations',
      designation TEXT NOT NULL DEFAULT '',
      is_manager INTEGER NOT NULL DEFAULT 0,
      reporting_manager_id TEXT NOT NULL DEFAULT '',
      reporting_manager_name TEXT NOT NULL DEFAULT '',
      reporting_manager_email TEXT NOT NULL DEFAULT '',
      aadhaar_card TEXT NOT NULL DEFAULT '',
      pan_card TEXT NOT NULL DEFAULT '',
      project_name TEXT NOT NULL DEFAULT '',
      project_no TEXT NOT NULL DEFAULT '',
      eic_name TEXT NOT NULL DEFAULT '',
      bank_name TEXT NOT NULL DEFAULT '',
      bank_branch TEXT NOT NULL DEFAULT '',
      bank_account_type TEXT NOT NULL DEFAULT 'Savings',
      bank_account_no TEXT NOT NULL DEFAULT '',
      ifsc_code TEXT NOT NULL DEFAULT '',
      joining_date TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Active',
      remarks TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      profile_id TEXT NOT NULL DEFAULT ''
    );
  `);
}

function ensureDefaultPoliciesSeeded(db: AppDatabase): void {
  const nowIso = new Date().toISOString();
  const findExisting = db.prepare(`SELECT id FROM Policies WHERE id = ? LIMIT 1`);
  const findDeleted = db.prepare(
    `SELECT id FROM System_Audit_Logs WHERE entity_type = 'Policy' AND entity_id = ? AND action = 'POLICY_DELETED' LIMIT 1`
  );
  const insertPolicy = db.prepare(`
    INSERT OR IGNORE INTO Policies (
      id, category, title, description, version, file_name, mime_type,
      content_base64, file_size, uploaded_by, uploaded_at, updated_at, history_json
    ) VALUES (?, ?, ?, ?, ?, ?, 'application/pdf', ?, ?, ?, ?, ?, ?)
  `);

  for (const pol of buildDefaultSeedPolicies()) {
    if (findExisting.get(pol.id)) continue;
    if (findDeleted.get(pol.id)) continue;
    const history: PolicyVersionHistoryEntry[] = [
      {
        version: pol.version,
        fileName: pol.fileName,
        fileSize: pol.fileSize,
        uploadedBy: 'System Administrator',
        uploadedAt: nowIso,
        notes: 'Initial default policy document',
      },
    ];
    insertPolicy.run(
      pol.id,
      pol.category,
      pol.title,
      pol.description,
      pol.version,
      pol.fileName,
      pol.contentBase64,
      pol.fileSize,
      'System Administrator',
      nowIso,
      nowIso,
      JSON.stringify(history)
    );
  }
}

function ensureSchemaAndMigrations(db: AppDatabase): void {
  const empCols = db.prepare(`PRAGMA table_info(Employees)`).all() as Array<{ name: string }>;
  const empColNames = new Set(empCols.map((c) => c.name));
  if (!empColNames.has('center')) {
    db.exec(`ALTER TABLE Employees ADD COLUMN center TEXT NOT NULL DEFAULT 'Mumbai';`);
    db.exec(`UPDATE Employees SET center = COALESCE(NULLIF(branch, ''), 'Mumbai');`);
  }
  if (!empColNames.has('reporting_manager_name')) {
    db.exec(`ALTER TABLE Employees ADD COLUMN reporting_manager_name TEXT NOT NULL DEFAULT '';`);
  }
  if (!empColNames.has('reporting_manager_email')) {
    db.exec(`ALTER TABLE Employees ADD COLUMN reporting_manager_email TEXT NOT NULL DEFAULT '';`);
  }
  if (!empColNames.has('address')) {
    db.exec(`ALTER TABLE Employees ADD COLUMN address TEXT NOT NULL DEFAULT '';`);
  }
  if (!empColNames.has('remarks')) {
    db.exec(`ALTER TABLE Employees ADD COLUMN remarks TEXT NOT NULL DEFAULT '';`);
  }
  if (!empColNames.has('is_manager')) {
    db.exec(`ALTER TABLE Employees ADD COLUMN is_manager INTEGER NOT NULL DEFAULT 0;`);
  }
  if (!empColNames.has('reporting_manager_id')) {
    db.exec(`ALTER TABLE Employees ADD COLUMN reporting_manager_id TEXT NOT NULL DEFAULT '';`);
  }
  if (!empColNames.has('personal_email')) {
    db.exec(`ALTER TABLE Employees ADD COLUMN personal_email TEXT NOT NULL DEFAULT '';`);
  }
  if (!empColNames.has('official_email')) {
    db.exec(`ALTER TABLE Employees ADD COLUMN official_email TEXT NOT NULL DEFAULT '';`);
    db.exec(`UPDATE Employees SET official_email = COALESCE(NULLIF(email, ''), '') WHERE official_email = '';`);
  }
  if (!empColNames.has('personal_email_verified')) {
    db.exec(`ALTER TABLE Employees ADD COLUMN personal_email_verified INTEGER NOT NULL DEFAULT 0;`);
  }
  if (!empColNames.has('official_email_verified')) {
    db.exec(`ALTER TABLE Employees ADD COLUMN official_email_verified INTEGER NOT NULL DEFAULT 0;`);
    db.exec(`UPDATE Employees SET official_email_verified = 1 WHERE official_email != '' AND official_email_verified = 0;`);
  }
  if (!empColNames.has('uan_number')) {
    db.exec(`ALTER TABLE Employees ADD COLUMN uan_number TEXT NOT NULL DEFAULT '';`);
  }
  if (!empColNames.has('pan_card')) {
    db.exec(`ALTER TABLE Employees ADD COLUMN pan_card TEXT NOT NULL DEFAULT '';`);
  }
  if (!empColNames.has('voter_id_card')) {
    db.exec(`ALTER TABLE Employees ADD COLUMN voter_id_card TEXT NOT NULL DEFAULT '';`);
  }
  if (!empColNames.has('aadhaar_card')) {
    db.exec(`ALTER TABLE Employees ADD COLUMN aadhaar_card TEXT NOT NULL DEFAULT '';`);
  }
  if (!empColNames.has('leave_carry_forward')) {
    db.exec(`ALTER TABLE Employees ADD COLUMN leave_carry_forward INTEGER NOT NULL DEFAULT 0;`);
  }

  const holCols = db.prepare(`PRAGMA table_info(Public_Holidays)`).all() as Array<{ name: string }>;
  const holColNames = new Set(holCols.map((c) => c.name));
  if (!holColNames.has('is_national')) {
    db.exec(`ALTER TABLE Public_Holidays ADD COLUMN is_national INTEGER NOT NULL DEFAULT 0;`);
  }
  if (!holColNames.has('origin_key')) {
    db.exec(`ALTER TABLE Public_Holidays ADD COLUMN origin_key TEXT;`);
  }

  const leaveCols = db.prepare(`PRAGMA table_info(Leave_Requests)`).all() as Array<{ name: string }>;
  const leaveColNames = new Set(leaveCols.map((c) => c.name));
  if (!leaveColNames.has('manager_id')) {
    db.exec(`ALTER TABLE Leave_Requests ADD COLUMN manager_id TEXT;`);
  }
  if (!leaveColNames.has('review_remarks')) {
    db.exec(`ALTER TABLE Leave_Requests ADD COLUMN review_remarks TEXT;`);
  }
  if (!leaveColNames.has('overridden_by')) {
    db.exec(`ALTER TABLE Leave_Requests ADD COLUMN overridden_by TEXT;`);
  }
  if (!leaveColNames.has('overridden_at')) {
    db.exec(`ALTER TABLE Leave_Requests ADD COLUMN overridden_at TEXT;`);
  }

  // Ensure Employee_Centers has every column the codebase expects before any migration
  // query references them (prevents "no such column: city_name" on legacy databases).
  ensureEmployeeCentersSchema(db);
  ensurePersonnelAndPolicyTables(db);

  // Ensure newer enterprise columns exist idempotently on pre-existing DBs
  if (!columnExists(db, 'Users', 'theme_preference')) {
    db.exec(`ALTER TABLE Users ADD COLUMN theme_preference TEXT NOT NULL DEFAULT '';`);
  }
  if (!columnExists(db, 'Employees', 'profile_id')) {
    db.exec(`ALTER TABLE Employees ADD COLUMN profile_id TEXT NOT NULL DEFAULT '';`);
  }
  if (!columnExists(db, 'Personnel_Entities', 'profile_id')) {
    db.exec(`ALTER TABLE Personnel_Entities ADD COLUMN profile_id TEXT NOT NULL DEFAULT '';`);
  }
  if (!columnExists(db, 'Policies', 'visible_roles_json')) {
    db.exec(
      `ALTER TABLE Policies ADD COLUMN visible_roles_json TEXT NOT NULL DEFAULT '["Employee","Consultant","Retainer","Freelancer","Young Research Program","Intern"]';`
    );
  }
  db.exec(`UPDATE Employees SET profile_id = 'PRF-' || id WHERE COALESCE(TRIM(profile_id), '') = '';`);
  db.exec(`UPDATE Personnel_Entities SET profile_id = 'PRF-' || id WHERE COALESCE(TRIM(profile_id), '') = '';`);
  if (tableExists(db, 'Mail_Config')) {
    db.exec(`UPDATE Mail_Config SET app_name = 'Median Asset & HR Suite' WHERE app_name = 'AssetOS Mail';`);
  }

  // Always clean any legacy non-Indian center entries and seed Indian centers if empty
  const delLegacyCenter = db.prepare(`DELETE FROM Employee_Centers WHERE LOWER(TRIM(city_name)) = LOWER(?)`);
  for (const legacyName of LEGACY_CENTER_NAMES) {
    delLegacyCenter.run(legacyName);
  }
  const activeCenterCnt = (db.prepare(`SELECT COUNT(*) as c FROM Employee_Centers`).get() as { c: number }).c;
  if (activeCenterCnt === 0) {
    const nowIso = new Date().toISOString();
    const insertCenter = db.prepare(`
      INSERT OR IGNORE INTO Employee_Centers (id, city_name, state_name, center_code, official_address, phone, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `);
    for (const c of INDIAN_CENTERS) {
      const cityName = (c.name || '').trim();
      if (!cityName) continue;
      const stateName = (c.stateRegion || 'India').trim() || 'India';
      const centerCode =
        cityName.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'IND';
      const id = `ctr-${cityName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      const preset = DEFAULT_CENTER_OFFICES[cityName.toLowerCase()];
      insertCenter.run(id, cityName, stateName, centerCode, preset?.address || '', preset?.phone || '', nowIso);
    }
  }
  backfillDefaultCenterOffices(db);

  const versionRow = db.prepare(`PRAGMA user_version`).get() as { user_version: number } | undefined;
  const currentVersion = versionRow?.user_version ?? 0;

  if (currentVersion < 2) {
    // One-time migration: replace legacy centers with Indian locations and backfill manager hierarchy.
    const updateEmpCenter = db.prepare(
      `UPDATE Employees SET center = ? WHERE LOWER(TRIM(center)) = LOWER(?)`
    );
    const updateEmpBranch = db.prepare(
      `UPDATE Employees SET branch = ? WHERE LOWER(TRIM(branch)) = LOWER(?)`
    );
    const updateHolCenter = db.prepare(
      `UPDATE Public_Holidays SET center = ? WHERE LOWER(TRIM(center)) = LOWER(?)`
    );
    const updateMailCenter = db.prepare(
      `UPDATE Email_Logs SET center = ? WHERE LOWER(TRIM(center)) = LOWER(?)`
    );

    for (const [legacy, replacement] of Object.entries(LEGACY_TO_INDIAN_CENTER_MAP)) {
      updateEmpCenter.run(replacement, legacy);
      updateEmpBranch.run(replacement, legacy);
      updateHolCenter.run(replacement, legacy);
      updateMailCenter.run(replacement, legacy);
    }

    // Remove legacy center records from Employee_Centers
    const delLegacyCenter = db.prepare(`DELETE FROM Employee_Centers WHERE LOWER(TRIM(city_name)) = LOWER(?)`);
    for (const legacyName of LEGACY_CENTER_NAMES) {
      delLegacyCenter.run(legacyName);
    }

    // Update holiday seed titles if still referencing old Dhaka/Sylhet demo names
    db.prepare(
      `UPDATE Public_Holidays SET title = 'Mumbai Campus Maintenance Day', center = 'Mumbai', description = 'Regional center observance for Mumbai campus.' WHERE id = 'hol-02' AND title LIKE 'Dhaka HQ%'`
    ).run();
    db.prepare(
      `UPDATE Public_Holidays SET title = 'Bengaluru Regional Observance', center = 'Bengaluru', description = 'Regional holiday for Bengaluru operations office.' WHERE id = 'hol-03' AND title LIKE 'Sylhet%'`
    ).run();

    // Update App_Settings address if still pointing to Dhaka HQ
    const settingsRow = db.prepare(`SELECT settings_json FROM App_Settings WHERE id = 'default'`).get() as
      | { settings_json: string }
      | undefined;
    if (settingsRow?.settings_json) {
      try {
        const parsed = JSON.parse(settingsRow.settings_json) as Record<string, unknown>;
        if (typeof parsed.address === 'string' && parsed.address.includes('Dhaka')) {
          parsed.address = 'Mumbai HQ · Research & Consulting Operations';
          db.prepare(`UPDATE App_Settings SET settings_json = ? WHERE id = 'default'`).run(
            JSON.stringify(parsed)
          );
        }
      } catch {
        // Ignore invalid settings JSON
      }
    }

    // Backfill is_manager & reporting_manager_id on seeded employees
    const backfillMgr = db.prepare(`
      UPDATE Employees
      SET is_manager = CASE WHEN ? = 1 THEN 1 ELSE is_manager END,
          reporting_manager_id = CASE WHEN reporting_manager_id = '' THEN ? ELSE reporting_manager_id END,
          reporting_manager_name = CASE WHEN reporting_manager_name = '' OR reporting_manager_name = 'System Administrator' THEN ? ELSE reporting_manager_name END,
          reporting_manager_email = CASE WHEN reporting_manager_email = '' OR reporting_manager_email = ? THEN ? ELSE reporting_manager_email END
      WHERE id = ?
    `);
    for (const emp of seedData.employees) {
      backfillMgr.run(
        emp.isManager ? 1 : 0,
        emp.reportingManagerId || '',
        emp.reportingManagerName || 'System Administrator',
        SEED_ADMIN_EMAIL,
        emp.reportingManagerEmail || SEED_ADMIN_EMAIL,
        emp.id
      );
    }

    // Backfill Leave_Requests.manager_id from mapped employee reporting_manager_id
    db.exec(`
      UPDATE Leave_Requests
      SET manager_id = (
        SELECT NULLIF(e.reporting_manager_id, '')
        FROM Employees e
        WHERE e.id = Leave_Requests.employee_id
      )
      WHERE manager_id IS NULL
    `);

    // Seed Employee Centers if empty
    const centerCnt = (db.prepare(`SELECT COUNT(*) as c FROM Employee_Centers`).get() as { c: number }).c;
    if (centerCnt === 0) {
      const nowIso = new Date().toISOString();
      const insertCenter = db.prepare(`
        INSERT OR IGNORE INTO Employee_Centers (id, city_name, state_name, center_code, is_active, created_at)
        VALUES (?, ?, ?, ?, 1, ?)
      `);
      // ✅ FIXED: IndianCenterSeed exposes { id, name, stateRegion } — not { cityName, stateName, centerCode }.
      // Map correctly and derive center_code from the city name.
      for (const c of INDIAN_CENTERS) {
        const cityName = (c.name || '').trim();
        if (!cityName) continue;
        const stateName = (c.stateRegion || 'India').trim() || 'India';
        const centerCode =
          cityName.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'IND';
        const id = `ctr-${cityName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        insertCenter.run(id, cityName, stateName, centerCode, nowIso);
      }
    }

    // Seed Default Policies (HR Policy & POSH Policy) if empty
    const polCnt = (db.prepare(`SELECT COUNT(*) as c FROM Policies`).get() as { c: number }).c;
    if (polCnt === 0) {
      const nowIso = new Date().toISOString();
      const insertPolicy = db.prepare(`
        INSERT OR IGNORE INTO Policies (
          id, category, title, description, version, file_name, mime_type,
          content_base64, file_size, uploaded_by, uploaded_at, updated_at, history_json
        ) VALUES (?, ?, ?, ?, ?, ?, 'application/pdf', ?, ?, ?, ?, ?, ?)
      `);
      for (const pol of buildDefaultSeedPolicies()) {
        const history: PolicyVersionHistoryEntry[] = [
          {
            version: pol.version,
            fileName: pol.fileName,
            fileSize: pol.fileSize,
            uploadedBy: 'System Administrator',
            uploadedAt: nowIso,
            notes: 'Initial default policy document',
          },
        ];
        insertPolicy.run(
          pol.id,
          pol.category,
          pol.title,
          pol.description,
          pol.version,
          pol.fileName,
          pol.contentBase64,
          pol.fileSize,
          'System Administrator',
          nowIso,
          nowIso,
          JSON.stringify(history)
        );
      }
    }

    db.exec(`PRAGMA user_version = 2;`);
  }

  ensureDefaultPoliciesSeeded(db);
}

export function openDatabase(dbPath: string = DEFAULT_DB_PATH): AppDatabase {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  const schemaSql = fs.readFileSync(SCHEMA_SQL_PATH, 'utf8');
  db.exec(schemaSql);
  initSecurityForDatabase(db);
  ensureSchemaAndMigrations(db);
  seedDatabase(db);
  return db;
}

export function seedDatabase(db: AppDatabase): void {
  const insertPerm = db.prepare(`
    INSERT OR IGNORE INTO Permissions (id, permission_name, category, description)
    VALUES (?, ?, ?, ?)
  `);
  for (const perm of PERMISSION_DEFINITIONS) {
    insertPerm.run(perm.id, perm.name, perm.category, perm.description);
  }

  const permIdByName = new Map<string, string>();
  const permRows = db.prepare(`SELECT id, permission_name FROM Permissions`).all() as Array<{
    id: string;
    permission_name: string;
  }>;
  for (const row of permRows) {
    permIdByName.set(row.permission_name, row.id);
  }

  const insertRole = db.prepare(`
    INSERT OR IGNORE INTO Roles (id, role_name, description)
    VALUES (?, ?, ?)
  `);
  const insertRolePerm = db.prepare(`
    INSERT OR IGNORE INTO Role_Permissions (role_id, permission_id)
    VALUES (?, ?)
  `);

  for (const role of PREDEFINED_ROLES) {
    insertRole.run(role.id, role.name, role.description);
    const existingRolePermsCount = (
      db.prepare(`SELECT COUNT(*) as cnt FROM Role_Permissions WHERE role_id = ?`).get(role.id) as {
        cnt: number;
      }
    ).cnt;
    if (existingRolePermsCount === 0) {
      for (const permName of role.permissions) {
        const permId = permIdByName.get(permName);
        if (permId) insertRolePerm.run(role.id, permId);
      }
    }
  }

  const isCleanProd = isProductionCleanDatabase(db);

  // Seed Employees if empty (skipped in clean production mode)
  const empCount = (db.prepare(`SELECT COUNT(*) as cnt FROM Employees`).get() as { cnt: number }).cnt;
  if (!isCleanProd && empCount === 0) {
    const insertEmp = db.prepare(`
      INSERT OR IGNORE INTO Employees (
        id, employee_id, name, email, department, designation, phone, branch,
        center, is_manager, reporting_manager_id, reporting_manager_name, reporting_manager_email,
        joining_date, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const emp of seedData.employees) {
      const centerName = normalizeCenterName(emp.center || emp.branch || DEFAULT_INDIAN_CENTER);
      insertEmp.run(
        emp.id,
        emp.employeeId || emp.id,
        emp.name,
        emp.email,
        emp.department,
        emp.designation,
        emp.phone,
        centerName,
        centerName,
        emp.isManager ? 1 : 0,
        emp.reportingManagerId || '',
        emp.reportingManagerName || 'System Administrator',
        emp.reportingManagerEmail || SEED_ADMIN_EMAIL,
        emp.joiningDate || '',
        emp.status
      );
    }
  }

  // Seed initial users if empty (in clean production mode, only ensure Super Admin account exists)
  const userCount = (db.prepare(`SELECT COUNT(*) as cnt FROM Users`).get() as { cnt: number }).cnt;
  if (userCount === 0) {
    const insertUser = db.prepare(`
      INSERT INTO Users (id, login_id, name, email, password, role_id, employee_id, department, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const nowIso = '2026-01-01T00:00:00.000Z';

    insertUser.run(
      SEED_ADMIN_ID,
      SEED_ADMIN_LOGIN_ID,
      'System Administrator',
      SEED_ADMIN_EMAIL,
      hashPassword(SEED_ADMIN_PASSWORD),
      'role_super_admin',
      null,
      'Management',
      1,
      nowIso
    );

    if (!isCleanProd) {
      insertUser.run(
        '00000000-0000-4000-8000-000000000002',
        'hr.manager',
        'Nusrat Jahan',
        'nusrat.hr@company.com',
        hashPassword('Hr@12345'),
        'role_hr_manager',
        'EMP007',
        'HR',
        1,
        nowIso
      );

      insertUser.run(
        '00000000-0000-4000-8000-000000000003',
        'dept.manager',
        'Monirul Islam',
        'monirul.it@company.com',
        hashPassword('Dept@1234'),
        'role_dept_manager',
        'EMP008',
        'IT',
        1,
        nowIso
      );

      insertUser.run(
        '00000000-0000-4000-8000-000000000004',
        'rahim',
        'Rahim Ahmed',
        'rahim.a@example.com',
        hashPassword('Rahim@123'),
        'role_employee',
        'EMP001',
        'IT',
        1,
        nowIso
      );

      insertUser.run(
        '00000000-0000-4000-8000-000000000005',
        'karim',
        'Karim Uddin',
        'karim.u@example.com',
        hashPassword('Karim@123'),
        'role_employee',
        'EMP002',
        'HR',
        1,
        nowIso
      );
    }
  } else if ((SEED_ADMIN_PASSWORD as string) !== 'Admin@123') {
    const adminRow = db
      .prepare(`SELECT id, password FROM Users WHERE id = ? OR LOWER(login_id) = LOWER(?) LIMIT 1`)
      .get(SEED_ADMIN_ID, SEED_ADMIN_LOGIN_ID) as { id: string; password: string } | undefined;
    if (adminRow && verifyPassword('Admin@123', adminRow.password)) {
      db.prepare(`UPDATE Users SET password = ? WHERE id = ?`).run(
        hashPassword(SEED_ADMIN_PASSWORD),
        adminRow.id
      );
    }
  }

  // Seed sample Attendance & Leaves if empty (skipped in clean production mode)
  const attCount = (db.prepare(`SELECT COUNT(*) as cnt FROM Attendance`).get() as { cnt: number }).cnt;
  if (!isCleanProd && attCount === 0) {
    const today = new Date();
    const fmtDate = (d: Date) => d.toISOString().split('T')[0];
    const d1 = new Date(today.getTime() - 2 * 86400000);
    const d2 = new Date(today.getTime() - 1 * 86400000);
    const todayStr = fmtDate(today);
    const d1Str = fmtDate(d1);
    const d2Str = fmtDate(d2);

    const insertAtt = db.prepare(`
      INSERT OR IGNORE INTO Attendance (
        id, employee_id, attendance_date, check_in_time, check_out_time,
        status, late_minutes, work_hours, remarks, correction_status,
        created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const seedEntries: Array<{
      empId: string;
      date: string;
      inTime: string | null;
      outTime: string | null;
      status: AttendanceStatus;
      remarks: string;
    }> = [
      { empId: 'EMP001', date: d1Str, inTime: '09:12', outTime: '17:45', status: 'Present', remarks: 'On time' },
      { empId: 'EMP001', date: d2Str, inTime: '09:48', outTime: '18:05', status: 'Late', remarks: 'Traffic delay' },
      { empId: 'EMP002', date: d1Str, inTime: '09:05', outTime: '17:30', status: 'Present', remarks: '' },
      { empId: 'EMP002', date: d2Str, inTime: '09:18', outTime: '17:35', status: 'Present', remarks: '' },
      { empId: 'EMP002', date: todayStr, inTime: '09:10', outTime: null, status: 'Present', remarks: 'Morning shift' },
      { empId: 'EMP003', date: d1Str, inTime: '10:02', outTime: '18:10', status: 'Late', remarks: 'Client call' },
      { empId: 'EMP003', date: d2Str, inTime: null, outTime: null, status: 'On Leave', remarks: 'Approved casual leave' },
      { empId: 'EMP005', date: d1Str, inTime: '08:55', outTime: '17:20', status: 'Present', remarks: '' },
      { empId: 'EMP005', date: d2Str, inTime: '09:02', outTime: '17:40', status: 'Present', remarks: '' },
      { empId: 'EMP007', date: d2Str, inTime: '09:20', outTime: '18:00', status: 'Present', remarks: '' },
    ];

    for (const s of seedEntries) {
      const id = crypto.randomUUID();
      const lateMins = s.inTime ? calculateLateMinutes(s.inTime) : 0;
      const hours = s.inTime && s.outTime ? calculateWorkHours(s.inTime, s.outTime) : 0;
      const ts = `${s.date}T09:00:00.000Z`;
      insertAtt.run(
        id,
        s.empId,
        s.date,
        s.inTime,
        s.outTime,
        s.status,
        lateMins,
        hours,
        s.remarks,
        'None',
        SEED_ADMIN_ID,
        SEED_ADMIN_ID,
        ts,
        ts
      );
    }

    const insertLeave = db.prepare(`
      INSERT OR IGNORE INTO Leave_Requests (
        id, employee_id, manager_id, leave_type, start_date, end_date, days, reason, status, reviewed_by, reviewed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertLeave.run(
      crypto.randomUUID(),
      'EMP003',
      null,
      'Casual',
      d2Str,
      d2Str,
      1,
      'Personal family errand',
      'Approved',
      'Nusrat Jahan',
      `${d1Str}T14:00:00.000Z`,
      `${d1Str}T10:00:00.000Z`
    );

    insertLeave.run(
      crypto.randomUUID(),
      'EMP001',
      'EMP008',
      'Annual',
      fmtDate(new Date(today.getTime() + 4 * 86400000)),
      fmtDate(new Date(today.getTime() + 5 * 86400000)),
      2,
      'Planned family trip',
      'Pending',
      null,
      null,
      `${d2Str}T11:30:00.000Z`
    );

    db.prepare(`
      INSERT INTO Attendance_Audit_Logs (
        id, attendance_id, employee_id, action, actor_user_id, actor_name, before_json, after_json, details, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      null,
      'EMP003',
      'LEAVE_APPROVED',
      '00000000-0000-4000-8000-000000000002',
      'Nusrat Jahan',
      null,
      JSON.stringify({ date: d2Str, status: 'On Leave' }),
      `Approved Casual Leave for EMP003 on ${d2Str}`,
      `${d1Str}T14:00:00.000Z`
    );
  }

  // Seed custom/center Public Holidays if no custom holidays exist yet (skipped in clean production mode)
  const customHolCount = (
    db.prepare(`SELECT COUNT(*) as cnt FROM Public_Holidays WHERE COALESCE(is_national, 0) = 0`).get() as {
      cnt: number;
    }
  ).cnt;
  if (!isCleanProd && customHolCount === 0) {
    const now = new Date();
    const year = now.getFullYear();
    const monthStr = String(now.getMonth() + 1).padStart(2, '0');
    const nextMonthDate = new Date(Date.UTC(year, now.getMonth() + 1, 16));
    const nextYear = nextMonthDate.getUTCFullYear();
    const nextMonthStr = String(nextMonthDate.getUTCMonth() + 1).padStart(2, '0');

    const insertHoliday = db.prepare(`
      INSERT OR IGNORE INTO Public_Holidays (id, title, holiday_date, center, description, is_national, origin_key, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)
    `);
    const nowIso = now.toISOString();
    insertHoliday.run(
      'hol-01',
      'Median Foundation & Research Day',
      `${year}-${monthStr}-18`,
      'All Centers',
      'Annual company-wide research symposium and foundation holiday.',
      'System Administrator',
      nowIso
    );
    insertHoliday.run(
      'hol-02',
      'Mumbai Campus Maintenance Day',
      `${year}-${monthStr}-22`,
      'Mumbai',
      'Regional center observance for Mumbai campus.',
      'System Administrator',
      nowIso
    );
    insertHoliday.run(
      'hol-03',
      'Bengaluru Regional Observance',
      `${year}-${monthStr}-26`,
      'Bengaluru',
      'Regional holiday for Bengaluru operations office.',
      'Nusrat Jahan',
      nowIso
    );
    insertHoliday.run(
      'hol-04',
      'Victory Day Observance',
      `${nextYear}-${nextMonthStr}-16`,
      'All Centers',
      'Center-wide observance across regional offices.',
      'System Administrator',
      nowIso
    );
  }

  // Always ensure rolled Indian National Holidays are synchronized through year + 2
  const currentYear = new Date().getFullYear();
  syncNationalHolidaysForRange(db, 2025, currentYear + 2);

  // Seed default Department_Designations if empty (skipped in clean production mode)
  const desigCount = (db.prepare(`SELECT COUNT(*) as cnt FROM Department_Designations`).get() as { cnt: number }).cnt;
  if (!isCleanProd && desigCount === 0) {
    const nowIso = new Date().toISOString();
    const insertDesig = db.prepare(`
      INSERT OR IGNORE INTO Department_Designations (id, department_name, designation_name, created_at)
      VALUES (?, ?, ?, ?)
    `);
    const defaultsByDept: Record<string, string[]> = {
      IT: ['Software Engineer', 'Systems Engineer', 'IT Support Specialist', 'Senior Analyst'],
      HR: ['HR Executive', 'Talent Specialist', 'HR Manager'],
      Finance: ['Accountant', 'Financial Analyst', 'Finance Controller'],
      Operations: ['Operations Executive', 'Senior Associate', 'Operations Lead'],
      Sales: ['Sales Executive', 'Account Manager'],
      Marketing: ['Marketing Associate', 'Growth Specialist'],
    };
    for (const [deptName, desigs] of Object.entries(defaultsByDept)) {
      for (const desigName of desigs) {
        insertDesig.run(crypto.randomUUID(), deptName, desigName, nowIso);
      }
    }
    const empPairs = db
      .prepare(`SELECT DISTINCT department, designation FROM Employees WHERE department != '' AND designation != ''`)
      .all() as Array<{ department: string; designation: string }>;
    for (const pair of empPairs) {
      insertDesig.run(crypto.randomUUID(), pair.department.trim(), pair.designation.trim(), nowIso);
    }
  }

  // Seed default Mail_Config if missing
  const mailCfgCnt = (db.prepare(`SELECT COUNT(*) as cnt FROM Mail_Config WHERE id = 'default'`).get() as { cnt: number }).cnt;
  if (mailCfgCnt === 0) {
    const defaultFrom = process.env.MAIL_FROM || process.env.MAIL_USERNAME || 'barunkumarsenbks1997@gmail.com';
    db.prepare(`
      INSERT OR IGNORE INTO Mail_Config (
        id, app_name, from_email, smtp_host, smtp_port, encryption, imap_host, imap_port, username, app_password, updated_at
      ) VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      process.env.MAIL_APP_NAME || 'Median Asset & HR Suite',
      defaultFrom,
      process.env.MAIL_HOST || 'smtp.gmail.com',
      Number(process.env.MAIL_PORT || 587) || 587,
      (process.env.MAIL_ENCRYPTION || 'tls').toLowerCase(),
      process.env.IMAP_HOST || 'imap.gmail.com',
      Number(process.env.IMAP_PORT || 993) || 993,
      process.env.MAIL_USERNAME || defaultFrom,
      process.env.MAIL_PASSWORD || '',
      new Date().toISOString()
    );
  }

  seedWorkspaceTablesIfNeeded(db);
}

interface RawUserRow {
  id: string;
  login_id: string;
  name: string;
  email: string;
  password: string;
  role_id: string;
  role_name: string;
  employee_id: string | null;
  department: string | null;
  theme_preference?: string | null;
  active: number;
  created_at: string;
}

function hydrateSessionUser(db: AppDatabase, row: RawUserRow): SessionUser {
  const rolePerms = (
    db
      .prepare(
        `SELECT p.permission_name
         FROM Role_Permissions rp
         JOIN Permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = ?`
      )
      .all(row.role_id) as Array<{ permission_name: string }>
  )
    .map((r) => r.permission_name)
    .filter(isValidPermission);

  const customPerms = (
    db
      .prepare(
        `SELECT p.permission_name
         FROM User_Permissions up
         JOIN Permissions p ON p.id = up.permission_id
         WHERE up.user_id = ?`
      )
      .all(row.id) as Array<{ permission_name: string }>
  )
    .map((r) => r.permission_name)
    .filter(isValidPermission);

  let resolvedDept = row.department || undefined;
  let isManager = row.role_name === 'Department Manager' || row.role_name === 'Manager';
  let resolvedEntityType: SessionUser['entityType'];
  let resolvedEntityId: string | undefined;

  if (row.employee_id) {
    const empRow = db
      .prepare(`SELECT id, department, is_manager FROM Employees WHERE id = ? OR employee_id = ?`)
      .get(row.employee_id, row.employee_id) as
      | { id: string; department: string; is_manager?: number }
      | undefined;
    if (empRow) {
      if (!resolvedDept) {
        resolvedDept = empRow.department;
      }
      if (empRow.is_manager === 1) {
        isManager = true;
      } else if (empRow.id) {
        const drCnt = (
          db
            .prepare(`SELECT COUNT(*) as c FROM Employees WHERE reporting_manager_id = ?`)
            .get(empRow.id) as { c: number }
        ).c;
        if (drCnt > 0) isManager = true;
      }
    } else if (tableExists(db, 'Personnel_Entities')) {
      const entRow = db
        .prepare(
          `SELECT id, entity_type, department, is_manager
           FROM Personnel_Entities
           WHERE id = ? OR UPPER(entity_code) = UPPER(?)
           LIMIT 1`
        )
        .get(row.employee_id, row.employee_id) as
        | { id: string; entity_type: PersonnelEntityType; department: string; is_manager?: number }
        | undefined;
      if (entRow) {
        resolvedEntityId = entRow.id;
        resolvedEntityType = entRow.entity_type;
        if (!resolvedDept) resolvedDept = entRow.department;
        if (entRow.entity_type === 'Consultant' && entRow.is_manager === 1) {
          isManager = true;
        }
      }
    }
  }

  if (!resolvedEntityId && tableExists(db, 'Personnel_Entities') && PERSONNEL_ENTITY_TYPES.includes(row.role_name as PersonnelEntityType)) {
    const entByEmail = db
      .prepare(`SELECT id, entity_type, department, is_manager FROM Personnel_Entities WHERE LOWER(email) = LOWER(?) LIMIT 1`)
      .get(row.email) as
      | { id: string; entity_type: PersonnelEntityType; department: string; is_manager?: number }
      | undefined;
    if (entByEmail) {
      resolvedEntityId = entByEmail.id;
      resolvedEntityType = entByEmail.entity_type;
      if (!resolvedDept) resolvedDept = entByEmail.department;
      if (entByEmail.entity_type === 'Consultant' && entByEmail.is_manager === 1) {
        isManager = true;
      }
    }
  }

  return {
    id: row.id,
    loginId: row.login_id,
    fullName: row.name,
    email: row.email,
    role: row.role_name as SessionUser['role'],
    roleId: row.role_id,
    permissions: resolveEffectivePermissions(rolePerms, customPerms),
    customPermissions: customPerms,
    employeeId: row.employee_id || undefined,
    entityType: resolvedEntityType,
    entityId: resolvedEntityId,
    department: resolvedDept,
    isManager,
    themePreference: row.theme_preference || undefined,
    active: row.active === 1,
    createdAt: row.created_at,
  };
}

export function getUserAuthRowByLoginOrEmail(
  db: AppDatabase,
  loginOrEmail: string
): { user: SessionUser; passwordHash: string } | null {
  const normalized = loginOrEmail.trim().toLowerCase();
  if (!normalized) return null;

  const row = db
    .prepare(
      `SELECT u.*, r.role_name
       FROM Users u
       JOIN Roles r ON r.id = u.role_id
       WHERE LOWER(u.login_id) = ? OR LOWER(u.email) = ?
       LIMIT 1`
    )
    .get(normalized, normalized) as RawUserRow | undefined;

  if (!row) return null;
  return {
    user: hydrateSessionUser(db, row),
    passwordHash: row.password,
  };
}

export function getSessionUserById(db: AppDatabase, userId: string): SessionUser | null {
  const row = db
    .prepare(
      `SELECT u.*, r.role_name
       FROM Users u
       JOIN Roles r ON r.id = u.role_id
       WHERE u.id = ?
       LIMIT 1`
    )
    .get(userId) as RawUserRow | undefined;

  if (!row) return null;
  return hydrateSessionUser(db, row);
}

export function listUsersWithPermissions(db: AppDatabase): SessionUser[] {
  const rows = db
    .prepare(
      `SELECT u.*, r.role_name
       FROM Users u
       JOIN Roles r ON r.id = u.role_id
       ORDER BY u.created_at ASC, u.name ASC`
    )
    .all() as unknown as RawUserRow[];

  return rows.map((r) => hydrateSessionUser(db, r));
}

export function listPermissions(db: AppDatabase): PermissionRecord[] {
  const rows = db
    .prepare(`SELECT id, permission_name, category, description FROM Permissions ORDER BY category, permission_name`)
    .all() as Array<{
    id: string;
    permission_name: PermissionName;
    category: PermissionRecord['category'];
    description: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    permissionName: r.permission_name,
    category: r.category,
    description: r.description,
  }));
}

export function listRolesWithPermissions(db: AppDatabase): RoleRecord[] {
  const roles = db
    .prepare(`SELECT id, role_name, description FROM Roles ORDER BY id`)
    .all() as Array<{ id: string; role_name: string; description: string }>;

  return roles.map((role) => {
    const perms = (
      db
        .prepare(
          `SELECT p.permission_name
           FROM Role_Permissions rp
           JOIN Permissions p ON p.id = rp.permission_id
           WHERE rp.role_id = ?`
        )
        .all(role.id) as Array<{ permission_name: string }>
    )
      .map((p) => p.permission_name)
      .filter(isValidPermission);

    return {
      id: role.id,
      roleName: role.role_name,
      description: role.description,
      permissions: perms,
    };
  });
}

export function updateRolePermissionsInDb(
  db: AppDatabase,
  roleId: string,
  permissions: PermissionName[]
): RoleRecord | null {
  const role = db.prepare(`SELECT id FROM Roles WHERE id = ?`).get(roleId) as { id: string } | undefined;
  if (!role) return null;

  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM Role_Permissions WHERE role_id = ?`).run(roleId);
    const findPerm = db.prepare(`SELECT id FROM Permissions WHERE permission_name = ?`);
    const insertRp = db.prepare(`INSERT OR IGNORE INTO Role_Permissions (role_id, permission_id) VALUES (?, ?)`);
    for (const permName of permissions) {
      if (!isValidPermission(permName)) continue;
      const pRow = findPerm.get(permName) as { id: string } | undefined;
      if (pRow) insertRp.run(roleId, pRow.id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return listRolesWithPermissions(db).find((r) => r.id === roleId) || null;
}

export function createUserInDb(
  db: AppDatabase,
  params: {
    loginId: string;
    password: string;
    fullName: string;
    email: string;
    roleId: string;
    employeeId?: string;
    department?: string;
    active?: boolean;
    customPermissions?: PermissionName[];
  }
): SessionUser {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const empId = params.employeeId?.trim() || null;

  let dept = params.department?.trim() || null;
  if (!dept && empId) {
    const empRow = db.prepare(`SELECT department FROM Employees WHERE id = ? OR employee_id = ?`).get(empId, empId) as
      | { department: string }
      | undefined;
    dept = empRow?.department || null;
  }

  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO Users (id, login_id, name, email, password, role_id, employee_id, department, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      params.loginId.trim(),
      params.fullName.trim(),
      params.email.trim(),
      hashPassword(params.password),
      params.roleId,
      empId,
      dept,
      params.active === false ? 0 : 1,
      createdAt
    );

    if (Array.isArray(params.customPermissions)) {
      const findPerm = db.prepare(`SELECT id FROM Permissions WHERE permission_name = ?`);
      const insertUp = db.prepare(`INSERT OR IGNORE INTO User_Permissions (user_id, permission_id) VALUES (?, ?)`);
      for (const pName of params.customPermissions) {
        if (!isValidPermission(pName)) continue;
        const pRow = findPerm.get(pName) as { id: string } | undefined;
        if (pRow) insertUp.run(id, pRow.id);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return getSessionUserById(db, id)!;
}

export function updateUserInDb(
  db: AppDatabase,
  userId: string,
  params: {
    loginId: string;
    password?: string;
    fullName: string;
    email: string;
    roleId: string;
    employeeId?: string;
    department?: string;
    active: boolean;
    customPermissions?: PermissionName[];
  }
): SessionUser | null {
  const existing = db.prepare(`SELECT id, password FROM Users WHERE id = ?`).get(userId) as
    | { id: string; password: string }
    | undefined;
  if (!existing) return null;

  const empId = params.employeeId?.trim() || null;
  let dept = params.department?.trim() || null;
  if (!dept && empId) {
    const empRow = db.prepare(`SELECT department FROM Employees WHERE id = ? OR employee_id = ?`).get(empId, empId) as
      | { department: string }
      | undefined;
    dept = empRow?.department || null;
  }

  const nextPassword = params.password ? hashPassword(params.password) : existing.password;

  db.exec('BEGIN');
  try {
    db.prepare(
      `UPDATE Users
       SET login_id = ?, name = ?, email = ?, password = ?, role_id = ?, employee_id = ?, department = ?, active = ?
       WHERE id = ?`
    ).run(
      params.loginId.trim(),
      params.fullName.trim(),
      params.email.trim(),
      nextPassword,
      params.roleId,
      empId,
      dept,
      params.active ? 1 : 0,
      userId
    );

    if (Array.isArray(params.customPermissions)) {
      db.prepare(`DELETE FROM User_Permissions WHERE user_id = ?`).run(userId);
      const findPerm = db.prepare(`SELECT id FROM Permissions WHERE permission_name = ?`);
      const insertUp = db.prepare(`INSERT OR IGNORE INTO User_Permissions (user_id, permission_id) VALUES (?, ?)`);
      for (const pName of params.customPermissions) {
        if (!isValidPermission(pName)) continue;
        const pRow = findPerm.get(pName) as { id: string } | undefined;
        if (pRow) insertUp.run(userId, pRow.id);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  if (params.password) {
    console.info(`[AssetOS Auth] Password updated via user profile for loginId=${params.loginId.trim()}`);
  }
  return getSessionUserById(db, userId);
}

export function resetUserPasswordInDb(
  db: AppDatabase,
  userId: string,
  newPassword: string
): SessionUser | null {
  const existing = db.prepare(`SELECT id, login_id FROM Users WHERE id = ?`).get(userId) as
    | { id: string; login_id: string }
    | undefined;
  if (!existing) return null;
  db.prepare(`UPDATE Users SET password = ? WHERE id = ?`).run(hashPassword(newPassword), userId);
  console.info(`[AssetOS Auth] Password reset for loginId=${existing.login_id}`);
  return getSessionUserById(db, userId);
}

function syncLinkedUserPasswordInActiveTx(
  db: AppDatabase,
  params: {
    recordId: string;
    previousCode: string;
    nextCode: string;
    entityTypeLabel: string;
    fullName: string;
    previousEmail: string;
    nextEmail: string;
    roleId: string;
    department: string;
    active: boolean;
    password: string;
    actor: AuditActorContext;
  }
):
  | { ok: true; passwordUpdated: boolean; userAccountCreated: boolean }
  | { ok: false; code: number; error: string } {
  const pwErr = validatePasswordStrength(params.password);
  if (pwErr) {
    return { ok: false, code: 400, error: pwErr };
  }

  const linkedUsers = db
    .prepare(
      `SELECT id, login_id, email, employee_id
       FROM Users
       WHERE employee_id = ?
          OR employee_id = ?
          OR LOWER(login_id) = LOWER(?)
          OR LOWER(login_id) = LOWER(?)
          OR LOWER(login_id) = LOWER(?)`
    )
    .all(
      params.recordId,
      params.previousCode,
      params.previousCode,
      params.recordId,
      params.nextCode
    ) as Array<{ id: string; login_id: string; email: string; employee_id: string | null }>;

  const hashedPassword = hashPassword(params.password);

  if (linkedUsers.length > 0) {
    const updatePwStmt = db.prepare(`UPDATE Users SET password = ? WHERE id = ?`);
    for (const u of linkedUsers) {
      updatePwStmt.run(hashedPassword, u.id);
    }

    const cleanNextEmail = params.nextEmail.trim();
    const cleanPrevEmail = params.previousEmail.trim();
    if (
      linkedUsers.length === 1 &&
      cleanNextEmail &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanNextEmail) &&
      cleanNextEmail.toLowerCase() !== linkedUsers[0].email.toLowerCase() &&
      cleanPrevEmail.toLowerCase() === linkedUsers[0].email.toLowerCase()
    ) {
      const emailConflict = db
        .prepare(`SELECT id FROM Users WHERE LOWER(email) = LOWER(?) AND id != ? LIMIT 1`)
        .get(cleanNextEmail, linkedUsers[0].id) as { id: string } | undefined;
      if (!emailConflict) {
        db.prepare(`UPDATE Users SET email = ? WHERE id = ?`).run(cleanNextEmail, linkedUsers[0].id);
      }
    }

    const loginIds = linkedUsers.map((u) => u.login_id);
    writeSystemAuditLog(db, {
      module: 'Auth',
      entityType: params.entityTypeLabel,
      entityId: params.recordId,
      action: 'PASSWORD_UPDATED',
      actor: params.actor,
      beforeObj: null,
      afterObj: {
        updatedUserIds: linkedUsers.map((u) => u.id),
        loginIds,
      },
      details: `Updated login password for ${params.entityTypeLabel} ${params.fullName} (${params.nextCode}) [loginIds=${loginIds.join(', ')}]`,
    });
    console.info(
      `[AssetOS Auth] Password updated for ${params.entityTypeLabel} (${params.nextCode}) -> user loginIds=[${loginIds.join(', ')}]`
    );
    return { ok: true, passwordUpdated: true, userAccountCreated: false };
  }

  const resolvedEmail = params.nextEmail.trim();
  if (!resolvedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resolvedEmail)) {
    return {
      ok: false,
      code: 400,
      error: `A valid Email ID is required to enable portal login password for ${params.entityTypeLabel} (${params.nextCode}).`,
    };
  }

  const desiredLoginId = params.nextCode.trim();
  const conflictLogin = db
    .prepare(`SELECT id, login_id FROM Users WHERE LOWER(login_id) = LOWER(?) LIMIT 1`)
    .get(desiredLoginId) as { id: string; login_id: string } | undefined;
  if (conflictLogin) {
    return {
      ok: false,
      code: 409,
      error: `Login ID "${desiredLoginId}" is already registered to another user login.`,
    };
  }

  const conflictEmail = db
    .prepare(`SELECT id, login_id FROM Users WHERE LOWER(email) = LOWER(?) LIMIT 1`)
    .get(resolvedEmail) as { id: string; login_id: string } | undefined;
  if (conflictEmail) {
    return {
      ok: false,
      code: 409,
      error: `Email "${resolvedEmail}" is already registered to another user login ("${conflictEmail.login_id}").`,
    };
  }

  const newUserId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO Users (id, login_id, name, email, password, role_id, employee_id, department, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newUserId,
    desiredLoginId,
    params.fullName.trim(),
    resolvedEmail,
    hashedPassword,
    params.roleId,
    params.recordId,
    params.department.trim() || null,
    params.active ? 1 : 0,
    createdAt
  );

  writeSystemAuditLog(db, {
    module: 'Auth',
    entityType: params.entityTypeLabel,
    entityId: params.recordId,
    action: 'USER_PASSWORD_PROVISIONED',
    actor: params.actor,
    beforeObj: null,
    afterObj: {
      userId: newUserId,
      loginId: desiredLoginId,
      roleId: params.roleId,
    },
    details: `Provisioned portal login and password for ${params.entityTypeLabel} ${params.fullName} (${desiredLoginId})`,
  });
  console.info(
    `[AssetOS Auth] Provisioned user login and password for ${params.entityTypeLabel} (${desiredLoginId})`
  );
  return { ok: true, passwordUpdated: true, userAccountCreated: true };
}

export function deleteUserInDb(db: AppDatabase, userId: string): boolean {
  const res = db.prepare(`DELETE FROM Users WHERE id = ?`).run(userId);
  return res.changes > 0;
}

export function listEmployeesFromDb(db: AppDatabase): Employee[] {
  const rows = db.prepare(`SELECT * FROM Employees ORDER BY employee_id ASC`).all() as Array<{
    id: string;
    employee_id: string;
    name: string;
    email: string;
    personal_email?: string;
    official_email?: string;
    personal_email_verified?: number;
    official_email_verified?: number;
    uan_number?: string;
    pan_card?: string;
    voter_id_card?: string;
    aadhaar_card?: string;
    leave_carry_forward?: number;
    department: string;
    designation: string;
    phone: string;
    branch: string;
    center: string;
    is_manager?: number;
    reporting_manager_id?: string;
    reporting_manager_name: string;
    reporting_manager_email: string;
    joining_date: string;
    address?: string;
    remarks?: string;
    status: 'Active' | 'Inactive';
    profile_id?: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employee_id,
    name: r.name,
    email: r.official_email || r.email,
    personalEmail: r.personal_email || '',
    officialEmail: r.official_email || r.email || '',
    personalEmailVerified: Boolean(r.personal_email_verified),
    officialEmailVerified: Boolean(r.official_email_verified),
    uanNumber: r.uan_number || '',
    panCard: r.pan_card || '',
    voterIdCard: r.voter_id_card || '',
    aadhaarCard: r.aadhaar_card || '',
    leaveCarryForward: Number(r.leave_carry_forward) || 0,
    department: r.department,
    designation: r.designation,
    phone: r.phone,
    branch: normalizeCenterName(r.branch || r.center || DEFAULT_INDIAN_CENTER),
    center: normalizeCenterName(r.center || r.branch || DEFAULT_INDIAN_CENTER),
    isManager: Boolean(r.is_manager),
    reportingManagerId: r.reporting_manager_id || '',
    reportingManagerName: r.reporting_manager_name || '',
    reportingManagerEmail: r.reporting_manager_email || '',
    joiningDate: r.joining_date || undefined,
    address: r.address || '',
    remarks: r.remarks || '',
    status: r.status,
    profileId: r.profile_id || `PRF-${r.id}`,
  }));
}

const DEFAULT_SYSTEM_ACTOR: AuditActorContext = {
  userId: 'system',
  userName: 'System',
  userRole: 'System',
  ipAddress: '127.0.0.1',
};

export function createEmployeeInDb(
  db: AppDatabase,
  emp: Omit<Employee, 'id' | 'employeeId'> & { id?: string; employeeId?: string },
  actor: AuditActorContext = DEFAULT_SYSTEM_ACTOR
): { ok: true; employee: Employee } | { ok: false; code: number; error: string } {
  const allExisting = listEmployeesFromDb(db);
  const existingIds = allExisting.flatMap((e) => [e.id, e.employeeId]);

  const rawCode = (emp.employeeId || emp.id || '').trim().toUpperCase();
  const code = rawCode || generateNextId('EMP', existingIds, 3);
  const id = (emp.id || code).trim();

  const duplicate = allExisting.find(
    (e) => e.id.toUpperCase() === id.toUpperCase() || e.employeeId.toUpperCase() === code.toUpperCase()
  );
  if (duplicate) {
    return {
      ok: false,
      code: 409,
      error: `Employee ID "${code}" already exists for ${duplicate.name}. Existing employees are never overwritten automatically.`,
    };
  }

  let resolvedReportingMgrId = (emp.reportingManagerId || '').trim();
  let resolvedReportingMgrName = (emp.reportingManagerName || '').trim();
  let resolvedReportingMgrEmail = (emp.reportingManagerEmail || '').trim();

  if (resolvedReportingMgrId) {
    const validation = validateManagerMapping({
      employees: allExisting,
      entities: listPersonnelEntitiesFromDb(db),
      employeeId: id,
      reportingManagerId: resolvedReportingMgrId,
    });
    if (!validation.ok) {
      return { ok: false, code: 400, error: validation.error };
    }
    if (validation.manager) {
      resolvedReportingMgrId = validation.manager.id;
      resolvedReportingMgrName = validation.manager.name;
      resolvedReportingMgrEmail = validation.manager.email;
    } else if (validation.consultantManager) {
      resolvedReportingMgrId = validation.consultantManager.id;
      resolvedReportingMgrName = validation.consultantManager.name;
      resolvedReportingMgrEmail = validation.consultantManager.email;
    }
  }

  const resolvedCenter = normalizeCenterName(emp.center || emp.branch || DEFAULT_INDIAN_CENTER);
  const resolvedBranch = normalizeCenterName(emp.branch || resolvedCenter || DEFAULT_INDIAN_CENTER);
  const resolvedOfficialEmail = (emp.officialEmail || emp.email || '').trim();
  const resolvedPersonalEmail = (emp.personalEmail || '').trim();
  const resolvedPrimaryEmail = (emp.email || resolvedOfficialEmail || resolvedPersonalEmail).trim();

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO Employees (
        id, employee_id, name, email, personal_email, official_email,
        personal_email_verified, official_email_verified,
        uan_number, pan_card, voter_id_card, aadhaar_card, leave_carry_forward,
        department, designation, phone, branch,
        center, is_manager, reporting_manager_id, reporting_manager_name, reporting_manager_email,
        joining_date, status, address, remarks, profile_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      code,
      emp.name.trim(),
      resolvedPrimaryEmail,
      resolvedPersonalEmail,
      resolvedOfficialEmail,
      emp.personalEmailVerified ? 1 : 0,
      emp.officialEmailVerified ? 1 : 0,
      (emp.uanNumber || '').trim(),
      (emp.panCard || '').trim().toUpperCase(),
      (emp.voterIdCard || '').trim().toUpperCase(),
      (emp.aadhaarCard || '').trim(),
      Number(emp.leaveCarryForward) || 0,
      (emp.department || 'IT').trim(),
      (emp.designation || 'Associate').trim(),
      (emp.phone || '').trim(),
      resolvedBranch,
      resolvedCenter,
      emp.isManager ? 1 : 0,
      resolvedReportingMgrId,
      resolvedReportingMgrName,
      resolvedReportingMgrEmail,
      emp.joiningDate || '',
      emp.status === 'Inactive' ? 'Inactive' : 'Active',
      (emp.address || '').trim(),
      (emp.remarks || '').trim(),
      (emp.profileId || `PRF-${id}`).trim()
    );

    const deptTrim = (emp.department || 'IT').trim();
    const desigTrim = (emp.designation || 'Associate').trim();
    if (deptTrim && desigTrim) {
      db.prepare(
        `INSERT OR IGNORE INTO Department_Designations (id, department_name, designation_name, created_at)
         VALUES (?, ?, ?, ?)`
      ).run(crypto.randomUUID(), deptTrim, desigTrim, new Date().toISOString());
    }

    const created = listEmployeesFromDb(db).find((e) => e.id === id)!;
    writeSystemAuditLog(db, {
      module: 'Employee',
      entityType: 'Employee',
      entityId: created.id,
      action: 'EMPLOYEE_CREATED',
      actor,
      beforeObj: null,
      afterObj: created,
      details: `Created employee ${created.name} (${created.employeeId}) in ${created.department}`,
    });

    db.exec('COMMIT');
    return { ok: true, employee: created };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function updateEmployeeInDb(
  db: AppDatabase,
  id: string,
  patch: Partial<Employee> & { password?: string },
  actor: AuditActorContext = DEFAULT_SYSTEM_ACTOR
):
  | { ok: true; employee: Employee; passwordUpdated?: boolean; userAccountCreated?: boolean }
  | { ok: false; code: number; error: string } {
  if (
    patch.password !== undefined &&
    patch.password !== null &&
    typeof patch.password !== 'string'
  ) {
    return { ok: false, code: 400, error: 'Password must be a valid string.' };
  }
  const rawPassword = typeof patch.password === 'string' ? patch.password : '';
  if (rawPassword.length > 0) {
    const pwErr = validatePasswordStrength(rawPassword);
    if (pwErr) {
      return { ok: false, code: 400, error: pwErr };
    }
  }
  const { password: _ignoredPassword, ...cleanPatch } = patch;

  const allEmployees = listEmployeesFromDb(db);
  const existing = allEmployees.find((e) => e.id === id || e.employeeId === id);
  if (!existing) return { ok: false, code: 404, error: 'Employee not found.' };

  const nextIsManager =
    typeof cleanPatch.isManager === 'boolean' ? cleanPatch.isManager : Boolean(existing.isManager);

  let nextReportingManagerId =
    cleanPatch.reportingManagerId !== undefined
      ? (cleanPatch.reportingManagerId || '').trim()
      : existing.reportingManagerId || '';
  let nextReportingManagerName = (cleanPatch.reportingManagerName ?? existing.reportingManagerName ?? '').trim();
  let nextReportingManagerEmail = (cleanPatch.reportingManagerEmail ?? existing.reportingManagerEmail ?? '').trim();

  if (cleanPatch.reportingManagerId !== undefined) {
    if (!nextReportingManagerId) {
      nextReportingManagerId = '';
      if (cleanPatch.reportingManagerName === undefined) nextReportingManagerName = '';
      if (cleanPatch.reportingManagerEmail === undefined) nextReportingManagerEmail = '';
    } else {
      const validation = validateManagerMapping({
        employees: allEmployees,
        entities: listPersonnelEntitiesFromDb(db),
        employeeId: existing.id,
        reportingManagerId: nextReportingManagerId,
      });
      if (!validation.ok) {
        return { ok: false, code: 400, error: validation.error };
      }
      if (validation.manager) {
        nextReportingManagerId = validation.manager.id;
        nextReportingManagerName = validation.manager.name;
        nextReportingManagerEmail = validation.manager.email;
      } else if (validation.consultantManager) {
        nextReportingManagerId = validation.consultantManager.id;
        nextReportingManagerName = validation.consultantManager.name;
        nextReportingManagerEmail = validation.consultantManager.email;
      }
    }
  }

  const resolvedCenter = normalizeCenterName(
    cleanPatch.center ?? existing.center ?? cleanPatch.branch ?? existing.branch ?? DEFAULT_INDIAN_CENTER
  );
  const resolvedBranch = normalizeCenterName(
    cleanPatch.branch ?? existing.branch ?? resolvedCenter ?? DEFAULT_INDIAN_CENTER
  );

  const nextOfficialEmail = (cleanPatch.officialEmail ?? cleanPatch.email ?? existing.officialEmail ?? existing.email).trim();
  const nextPersonalEmail = (cleanPatch.personalEmail ?? existing.personalEmail ?? '').trim();

  const updatedPayload: Employee = {
    ...existing,
    ...cleanPatch,
    id: existing.id,
    employeeId: existing.employeeId,
    name: (cleanPatch.name ?? existing.name).trim(),
    email: (cleanPatch.email ?? nextOfficialEmail ?? existing.email).trim(),
    personalEmail: nextPersonalEmail,
    officialEmail: nextOfficialEmail,
    personalEmailVerified:
      typeof cleanPatch.personalEmailVerified === 'boolean'
        ? cleanPatch.personalEmailVerified
        : Boolean(existing.personalEmailVerified),
    officialEmailVerified:
      typeof cleanPatch.officialEmailVerified === 'boolean'
        ? cleanPatch.officialEmailVerified
        : Boolean(existing.officialEmailVerified),
    uanNumber: (cleanPatch.uanNumber ?? existing.uanNumber ?? '').trim(),
    panCard: (cleanPatch.panCard ?? existing.panCard ?? '').trim().toUpperCase(),
    voterIdCard: (cleanPatch.voterIdCard ?? existing.voterIdCard ?? '').trim().toUpperCase(),
    aadhaarCard: (cleanPatch.aadhaarCard ?? existing.aadhaarCard ?? '').trim(),
    leaveCarryForward:
      cleanPatch.leaveCarryForward !== undefined
        ? Number(cleanPatch.leaveCarryForward) || 0
        : Number(existing.leaveCarryForward) || 0,
    department: (cleanPatch.department ?? existing.department).trim(),
    designation: (cleanPatch.designation ?? existing.designation).trim(),
    phone: (cleanPatch.phone ?? existing.phone ?? '').trim(),
    branch: resolvedBranch,
    center: resolvedCenter,
    isManager: nextIsManager,
    reportingManagerId: nextReportingManagerId,
    reportingManagerName: nextReportingManagerName,
    reportingManagerEmail: nextReportingManagerEmail,
    joiningDate: cleanPatch.joiningDate ?? existing.joiningDate ?? '',
    address: (cleanPatch.address ?? existing.address ?? '').trim(),
    remarks: (cleanPatch.remarks ?? existing.remarks ?? '').trim(),
    status: cleanPatch.status === 'Inactive' ? 'Inactive' : cleanPatch.status === 'Active' ? 'Active' : existing.status,
  };

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `UPDATE Employees SET
        name = ?,
        email = ?,
        personal_email = ?,
        official_email = ?,
        personal_email_verified = ?,
        official_email_verified = ?,
        uan_number = ?,
        pan_card = ?,
        voter_id_card = ?,
        aadhaar_card = ?,
        leave_carry_forward = ?,
        department = ?,
        designation = ?,
        phone = ?,
        branch = ?,
        center = ?,
        is_manager = ?,
        reporting_manager_id = ?,
        reporting_manager_name = ?,
        reporting_manager_email = ?,
        joining_date = ?,
        status = ?,
        address = ?,
        remarks = ?
       WHERE id = ?`
    ).run(
      updatedPayload.name,
      updatedPayload.email,
      updatedPayload.personalEmail || '',
      updatedPayload.officialEmail || updatedPayload.email,
      updatedPayload.personalEmailVerified ? 1 : 0,
      updatedPayload.officialEmailVerified ? 1 : 0,
      updatedPayload.uanNumber || '',
      updatedPayload.panCard || '',
      updatedPayload.voterIdCard || '',
      updatedPayload.aadhaarCard || '',
      updatedPayload.leaveCarryForward || 0,
      updatedPayload.department,
      updatedPayload.designation,
      updatedPayload.phone,
      updatedPayload.branch,
      updatedPayload.center || updatedPayload.branch,
      updatedPayload.isManager ? 1 : 0,
      updatedPayload.reportingManagerId || '',
      updatedPayload.reportingManagerName || '',
      updatedPayload.reportingManagerEmail || '',
      updatedPayload.joiningDate || '',
      updatedPayload.status,
      updatedPayload.address || '',
      updatedPayload.remarks || '',
      existing.id
    );

    if (existing.isManager && !updatedPayload.isManager) {
      db.prepare(
        `UPDATE Employees
         SET reporting_manager_id = '', reporting_manager_name = '', reporting_manager_email = ''
         WHERE reporting_manager_id = ?`
      ).run(existing.id);
    } else if (updatedPayload.isManager) {
      db.prepare(
        `UPDATE Employees
         SET reporting_manager_name = ?, reporting_manager_email = ?
         WHERE reporting_manager_id = ?`
      ).run(updatedPayload.name, updatedPayload.email, existing.id);
    }

    const saved = listEmployeesFromDb(db).find((e) => e.id === existing.id)!;
    writeSystemAuditLog(db, {
      module: 'Employee',
      entityType: 'Employee',
      entityId: saved.id,
      action: 'EMPLOYEE_UPDATED',
      actor,
      beforeObj: existing,
      afterObj: saved,
      details: `Updated employee ${saved.name} (${saved.employeeId})`,
    });

    let passwordUpdated = false;
    let userAccountCreated = false;
    if (rawPassword.length > 0) {
      const syncRes = syncLinkedUserPasswordInActiveTx(db, {
        recordId: saved.id,
        previousCode: existing.employeeId,
        nextCode: saved.employeeId,
        entityTypeLabel: 'Employee',
        fullName: saved.name,
        previousEmail: existing.officialEmail || existing.email || existing.personalEmail || '',
        nextEmail: saved.officialEmail || saved.email || saved.personalEmail || '',
        roleId: saved.isManager ? 'role_dept_manager' : 'role_employee',
        department: saved.department,
        active: saved.status === 'Active',
        password: rawPassword,
        actor,
      });
      if (!syncRes.ok) {
        db.exec('ROLLBACK');
        return syncRes;
      }
      passwordUpdated = syncRes.passwordUpdated;
      userAccountCreated = syncRes.userAccountCreated;
    }

    db.exec('COMMIT');
    return { ok: true, employee: saved, passwordUpdated, userAccountCreated };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function deleteEmployeeInDb(
  db: AppDatabase,
  id: string,
  actor: AuditActorContext = DEFAULT_SYSTEM_ACTOR
): { ok: true } | { ok: false; code: number; error: string } {
  const existing = listEmployeesFromDb(db).find((e) => e.id === id || e.employeeId === id);
  if (!existing) {
    return { ok: false, code: 404, error: 'Employee not found.' };
  }

  const activeAssignments = db
    .prepare(`SELECT COUNT(*) as c FROM Assignments WHERE (employee_id = ? OR employee_id = ?) AND status = 'Active'`)
    .get(existing.id, existing.employeeId) as { c: number };

  if (activeAssignments.c > 0) {
    return {
      ok: false,
      code: 409,
      error: `Cannot delete ${existing.name} (${existing.employeeId}): employee has ${activeAssignments.c} active asset assignment(s). Return or transfer assigned assets first.`,
    };
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`DELETE FROM Employees WHERE id = ?`).run(existing.id);
    writeSystemAuditLog(db, {
      module: 'Employee',
      entityType: 'Employee',
      entityId: existing.id,
      action: 'EMPLOYEE_DELETED',
      actor,
      beforeObj: existing,
      afterObj: null,
      details: `Manually deleted employee ${existing.name} (${existing.employeeId})`,
    });
    db.exec('COMMIT');
    return { ok: true };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function bulkImportEmployeesInDb(
  db: AppDatabase,
  params: {
    csvText: string;
    duplicatePolicy?: EmployeeImportDuplicatePolicy;
    actor?: AuditActorContext;
    defaultManagerEmail?: string;
  }
): BulkEmployeeImportResult {
  const actor = params.actor || DEFAULT_SYSTEM_ACTOR;
  const duplicatePolicy: EmployeeImportDuplicatePolicy = params.duplicatePolicy || 'skip';
  const existingEmployees = listEmployeesFromDb(db);
  const plan = buildEmployeeImportPlan({
    csvText: params.csvText,
    existingEmployees,
    duplicatePolicy,
    defaultManagerEmail: params.defaultManagerEmail,
  });

  const byCode = new Map(existingEmployees.map((e) => [e.employeeId.toUpperCase(), e]));
  const errors = [...plan.errors];
  const createdEmployees: Employee[] = [];
  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = plan.errors.filter((e) => e.reason.startsWith('Skipped:')).length;

  db.exec('BEGIN IMMEDIATE');
  try {
    const insertStmt = db.prepare(`
      INSERT INTO Employees (
        id, employee_id, name, email, department, designation, phone, branch,
        center, reporting_manager_name, reporting_manager_email, joining_date, status, address, remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '')
    `);
    const updateStmt = db.prepare(`
      UPDATE Employees SET
        name = ?, email = ?, department = ?, designation = ?, phone = ?,
        branch = ?, center = ?, reporting_manager_name = ?, reporting_manager_email = ?,
        joining_date = ?, status = ?
      WHERE id = ?
    `);

    for (const row of plan.validRows) {
      const normalizedCenter = normalizeCenterName(row.center || row.branch);
      const existing = byCode.get(row.employeeId.toUpperCase());
      if (existing) {
        if (duplicatePolicy === 'update') {
          updateStmt.run(
            row.name,
            row.email,
            row.department,
            row.designation,
            row.phone,
            normalizedCenter,
            normalizedCenter,
            row.reportingManagerName,
            row.reportingManagerEmail,
            row.joiningDate,
            row.status,
            existing.id
          );
          updatedCount++;
        } else {
          skippedCount++;
          errors.push({
            rowNumber: row.rowNumber,
            employeeId: row.employeeId,
            name: row.name,
            reason: `Skipped: Employee ID "${row.employeeId}" already exists (existing record preserved).`,
          });
        }
        continue;
      }

      insertStmt.run(
        row.employeeId,
        row.employeeId,
        row.name,
        row.email,
        row.department,
        row.designation,
        row.phone,
        normalizedCenter,
        normalizedCenter,
        row.reportingManagerName,
        row.reportingManagerEmail,
        row.joiningDate,
        row.status
      );
      const createdEmp: Employee = {
        id: row.employeeId,
        employeeId: row.employeeId,
        name: row.name,
        email: row.email,
        department: row.department,
        designation: row.designation,
        phone: row.phone,
        branch: normalizedCenter,
        center: normalizedCenter,
        reportingManagerName: row.reportingManagerName,
        reportingManagerEmail: row.reportingManagerEmail,
        joiningDate: row.joiningDate || undefined,
        status: row.status,
      };
      byCode.set(row.employeeId.toUpperCase(), createdEmp);
      createdEmployees.push(createdEmp);
      createdCount++;
    }

    const failedCount = errors.filter((e) => !e.reason.startsWith('Skipped:')).length;

    writeSystemAuditLog(db, {
      module: 'Employee',
      entityType: 'EmployeeBulkImport',
      entityId: 'bulk-import',
      action: 'EMPLOYEE_BULK_IMPORTED',
      actor,
      afterObj: {
        totalRows: plan.totalRows,
        createdCount,
        updatedCount,
        skippedCount,
        failedCount,
        duplicatePolicy,
      },
      details: `Bulk imported employees: ${createdCount} created, ${updatedCount} updated, ${skippedCount} skipped, ${failedCount} failed (policy=${duplicatePolicy})`,
    });

    db.exec('COMMIT');

    return {
      totalRows: plan.totalRows,
      createdCount,
      updatedCount,
      skippedCount,
      failedCount,
      errors,
      employees: listEmployeesFromDb(db),
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function writeAuditLog(
  db: AppDatabase,
  params: {
    attendanceId?: string | null;
    employeeId: string;
    action: string;
    actorUserId: string;
    actorName: string;
    beforeObj?: unknown;
    afterObj?: unknown;
    details: string;
  }
): void {
  db.prepare(
    `INSERT INTO Attendance_Audit_Logs (
      id, attendance_id, employee_id, action, actor_user_id, actor_name, before_json, after_json, details, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    params.attendanceId ?? null,
    params.employeeId,
    params.action,
    params.actorUserId,
    params.actorName,
    params.beforeObj ? JSON.stringify(params.beforeObj) : null,
    params.afterObj ? JSON.stringify(params.afterObj) : null,
    params.details,
    new Date().toISOString()
  );
}

interface RawAttendanceRow {
  id: string;
  employee_id: string;
  emp_code: string | null;
  emp_name: string | null;
  emp_dept: string | null;
  emp_desig: string | null;
  attendance_date: string;
  check_in_time: string | null;
  check_out_time: string | null;
  status: AttendanceStatus;
  late_minutes: number;
  work_hours: number;
  remarks: string;
  correction_status: AttendanceRecord['correctionStatus'];
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

function mapAttendanceRow(r: RawAttendanceRow): AttendanceRecord {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeCode: r.emp_code || r.employee_id,
    employeeName: r.emp_name || r.employee_id,
    department: r.emp_dept || undefined,
    designation: r.emp_desig || undefined,
    attendanceDate: r.attendance_date,
    checkInTime: r.check_in_time,
    checkOutTime: r.check_out_time,
    status: r.status,
    lateMinutes: Number(r.late_minutes) || 0,
    workHours: Number(r.work_hours) || 0,
    remarks: r.remarks || '',
    correctionStatus: r.correction_status || 'None',
    createdBy: r.created_by,
    updatedBy: r.updated_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listAttendanceFromDb(db: AppDatabase): AttendanceRecord[] {
  const rows = db
    .prepare(
      `SELECT a.*, e.employee_id as emp_code, e.name as emp_name, e.department as emp_dept, e.designation as emp_desig
       FROM Attendance a
       LEFT JOIN Employees e ON e.id = a.employee_id
       ORDER BY a.attendance_date DESC, e.name ASC`
    )
    .all() as unknown as RawAttendanceRow[];

  return rows.map(mapAttendanceRow);
}

export function getAttendanceById(db: AppDatabase, id: string): AttendanceRecord | null {
  const row = db
    .prepare(
      `SELECT a.*, e.employee_id as emp_code, e.name as emp_name, e.department as emp_dept, e.designation as emp_desig
       FROM Attendance a
       LEFT JOIN Employees e ON e.id = a.employee_id
       WHERE a.id = ?`
    )
    .get(id) as RawAttendanceRow | undefined;
  return row ? mapAttendanceRow(row) : null;
}

export function checkInEmployeeInDb(
  db: AppDatabase,
  params: {
    employeeId: string;
    date: string;
    checkInTime: string;
    remarks?: string;
    actor: SessionUser;
  }
): { ok: true; record: AttendanceRecord } | { ok: false; error: string } {
  const existing = db
    .prepare(`SELECT * FROM Attendance WHERE employee_id = ? AND attendance_date = ?`)
    .get(params.employeeId, params.date) as { id: string; check_in_time: string | null } | undefined;

  if (existing && existing.check_in_time) {
    return { ok: false, error: `Already checked in for ${params.date} at ${existing.check_in_time}.` };
  }

  const lateMinutes = calculateLateMinutes(params.checkInTime);
  const status = deriveAttendanceStatusOnCheckIn(params.checkInTime);
  const nowIso = new Date().toISOString();
  const id = existing?.id || crypto.randomUUID();

  if (existing) {
    db.prepare(
      `UPDATE Attendance
       SET check_in_time = ?, status = ?, late_minutes = ?, remarks = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      params.checkInTime,
      status,
      lateMinutes,
      params.remarks?.trim() || '',
      params.actor.id,
      nowIso,
      id
    );
  } else {
    db.prepare(
      `INSERT INTO Attendance (
        id, employee_id, attendance_date, check_in_time, check_out_time,
        status, late_minutes, work_hours, remarks, correction_status,
        created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, 0, ?, 'None', ?, ?, ?, ?)`
    ).run(
      id,
      params.employeeId,
      params.date,
      params.checkInTime,
      status,
      lateMinutes,
      params.remarks?.trim() || '',
      params.actor.id,
      params.actor.id,
      nowIso,
      nowIso
    );
  }

  const saved = getAttendanceById(db, id)!;
  writeAuditLog(db, {
    attendanceId: id,
    employeeId: params.employeeId,
    action: 'CHECK_IN',
    actorUserId: params.actor.id,
    actorName: params.actor.fullName,
    afterObj: saved,
    details: `Checked in on ${params.date} at ${params.checkInTime} (${status}${lateMinutes > 0 ? `, ${lateMinutes}m late` : ''})`,
  });

  return { ok: true, record: saved };
}

export function checkOutEmployeeInDb(
  db: AppDatabase,
  params: {
    employeeId: string;
    date: string;
    checkOutTime: string;
    remarks?: string;
    actor: SessionUser;
  }
): { ok: true; record: AttendanceRecord } | { ok: false; error: string } {
  const existing = db
    .prepare(`SELECT * FROM Attendance WHERE employee_id = ? AND attendance_date = ?`)
    .get(params.employeeId, params.date) as
    | { id: string; check_in_time: string | null; check_out_time: string | null; remarks: string }
    | undefined;

  if (!existing || !existing.check_in_time) {
    return { ok: false, error: `No check-in found for ${params.date}. Please check in first.` };
  }
  if (existing.check_out_time) {
    return { ok: false, error: `Already checked out for ${params.date} at ${existing.check_out_time}.` };
  }

  const before = getAttendanceById(db, existing.id);
  const workHours = calculateWorkHours(existing.check_in_time, params.checkOutTime);
  const mergedRemarks = params.remarks?.trim() || existing.remarks || '';
  const nowIso = new Date().toISOString();

  db.prepare(
    `UPDATE Attendance
     SET check_out_time = ?, work_hours = ?, remarks = ?, updated_by = ?, updated_at = ?
     WHERE id = ?`
  ).run(params.checkOutTime, workHours, mergedRemarks, params.actor.id, nowIso, existing.id);

  const saved = getAttendanceById(db, existing.id)!;
  writeAuditLog(db, {
    attendanceId: existing.id,
    employeeId: params.employeeId,
    action: 'CHECK_OUT',
    actorUserId: params.actor.id,
    actorName: params.actor.fullName,
    beforeObj: before,
    afterObj: saved,
    details: `Checked out on ${params.date} at ${params.checkOutTime} (${workHours} hrs)`,
  });

  return { ok: true, record: saved };
}

export function createOrUpdateManualAttendanceInDb(
  db: AppDatabase,
  params: {
    id?: string;
    employeeId: string;
    attendanceDate: string;
    checkInTime: string | null;
    checkOutTime: string | null;
    status: AttendanceStatus;
    remarks: string;
    correctionStatus?: AttendanceRecord['correctionStatus'];
    actor: SessionUser;
  }
): AttendanceRecord {
  const nowIso = new Date().toISOString();
  const lateMinutes = params.checkInTime ? calculateLateMinutes(params.checkInTime) : 0;
  const workHours =
    params.checkInTime && params.checkOutTime
      ? calculateWorkHours(params.checkInTime, params.checkOutTime)
      : 0;

  if (params.id) {
    const before = getAttendanceById(db, params.id);
    db.prepare(
      `UPDATE Attendance
       SET check_in_time = ?, check_out_time = ?, status = ?, late_minutes = ?, work_hours = ?,
           remarks = ?, correction_status = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      params.checkInTime,
      params.checkOutTime,
      params.status,
      lateMinutes,
      workHours,
      params.remarks.trim(),
      params.correctionStatus || 'Approved',
      params.actor.id,
      nowIso,
      params.id
    );
    const saved = getAttendanceById(db, params.id)!;
    writeAuditLog(db, {
      attendanceId: params.id,
      employeeId: saved.employeeId,
      action: params.correctionStatus === 'Approved' ? 'CORRECTION_APPROVED' : 'ATTENDANCE_EDITED',
      actorUserId: params.actor.id,
      actorName: params.actor.fullName,
      beforeObj: before,
      afterObj: saved,
      details: `Updated attendance for ${saved.employeeId} on ${saved.attendanceDate} -> ${saved.status}`,
    });
    return saved;
  }

  const existing = db
    .prepare(`SELECT id FROM Attendance WHERE employee_id = ? AND attendance_date = ?`)
    .get(params.employeeId, params.attendanceDate) as { id: string } | undefined;

  const id = existing?.id || crypto.randomUUID();
  const before = existing ? getAttendanceById(db, existing.id) : null;

  if (existing) {
    db.prepare(
      `UPDATE Attendance
       SET check_in_time = ?, check_out_time = ?, status = ?, late_minutes = ?, work_hours = ?,
           remarks = ?, correction_status = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      params.checkInTime,
      params.checkOutTime,
      params.status,
      lateMinutes,
      workHours,
      params.remarks.trim(),
      params.correctionStatus || 'None',
      params.actor.id,
      nowIso,
      id
    );
  } else {
    db.prepare(
      `INSERT INTO Attendance (
        id, employee_id, attendance_date, check_in_time, check_out_time,
        status, late_minutes, work_hours, remarks, correction_status,
        created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      params.employeeId,
      params.attendanceDate,
      params.checkInTime,
      params.checkOutTime,
      params.status,
      lateMinutes,
      workHours,
      params.remarks.trim(),
      params.correctionStatus || 'None',
      params.actor.id,
      params.actor.id,
      nowIso,
      nowIso
    );
  }

  const saved = getAttendanceById(db, id)!;
  writeAuditLog(db, {
    attendanceId: id,
    employeeId: params.employeeId,
    action: existing ? 'ATTENDANCE_UPDATED' : 'ATTENDANCE_CREATED',
    actorUserId: params.actor.id,
    actorName: params.actor.fullName,
    beforeObj: before,
    afterObj: saved,
    details: `${existing ? 'Updated' : 'Recorded'} ${params.status} for ${params.employeeId} on ${params.attendanceDate}`,
  });

  return saved;
}

export function deleteAttendanceInDb(
  db: AppDatabase,
  id: string,
  actor: SessionUser
): boolean {
  const before = getAttendanceById(db, id);
  if (!before) return false;
  const res = db.prepare(`DELETE FROM Attendance WHERE id = ?`).run(id);
  if (res.changes > 0) {
    writeAuditLog(db, {
      attendanceId: id,
      employeeId: before.employeeId,
      action: 'ATTENDANCE_DELETED',
      actorUserId: actor.id,
      actorName: actor.fullName,
      beforeObj: before,
      afterObj: null,
      details: `Deleted attendance record on ${before.attendanceDate} for ${before.employeeId}`,
    });
    return true;
  }
  return false;
}

export function listLeavesFromDb(db: AppDatabase): LeaveRecord[] {
  const rows = db
    .prepare(
      `SELECT l.*, e.employee_id as emp_code, e.name as emp_name, e.department as emp_dept,
              m.name as mgr_name
       FROM Leave_Requests l
       LEFT JOIN Employees e ON e.id = l.employee_id
       LEFT JOIN Employees m ON m.id = COALESCE(NULLIF(l.manager_id, ''), NULLIF(e.reporting_manager_id, ''))
       ORDER BY l.created_at DESC`
    )
    .all() as Array<{
    id: string;
    employee_id: string;
    manager_id?: string | null;
    mgr_name?: string | null;
    emp_code: string | null;
    emp_name: string | null;
    emp_dept: string | null;
    leave_type: LeaveType;
    start_date: string;
    end_date: string;
    days: number;
    reason: string;
    status: LeaveStatus;
    reviewed_by: string | null;
    reviewed_at: string | null;
    review_remarks?: string | null;
    overridden_by?: string | null;
    overridden_at?: string | null;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employee_id,
    employeeCode: r.emp_code || r.employee_id,
    employeeName: r.emp_name || r.employee_id,
    department: r.emp_dept || undefined,
    managerId: r.manager_id || null,
    managerName: r.mgr_name || null,
    leaveType: r.leave_type,
    startDate: r.start_date,
    endDate: r.end_date,
    days: r.days,
    reason: r.reason,
    status: r.status,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
    reviewRemarks: r.review_remarks || null,
    overriddenBy: r.overridden_by || null,
    overriddenAt: r.overridden_at || null,
    createdAt: r.created_at,
  }));
}

export function createLeaveInDb(
  db: AppDatabase,
  params: {
    employeeId: string;
    leaveType: LeaveType;
    startDate: string;
    endDate: string;
    reason: string;
    actor: SessionUser;
    overrideDays?: number;
  }
): { ok: true; leave: LeaveRecord } | { ok: false; error: string } {
  const calendarDays = calculateLeaveDays(params.startDate, params.endDate);
  if (calendarDays <= 0) {
    return { ok: false, error: 'End date must be on or after start date.' };
  }
  const days =
    typeof params.overrideDays === 'number' && params.overrideDays >= 0
      ? params.overrideDays
      : calendarDays;
  if (days <= 0) {
    return { ok: false, error: 'Selected dates only fall on holidays (0 chargeable leave days).' };
  }
  if (!params.reason.trim() || params.reason.trim().length < 5) {
    return { ok: false, error: 'Please provide a leave reason (at least 5 characters).' };
  }

  const empRow = db
    .prepare(`SELECT reporting_manager_id FROM Employees WHERE id = ?`)
    .get(params.employeeId) as { reporting_manager_id?: string } | undefined;
  const managerId = empRow?.reporting_manager_id?.trim() || null;

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO Leave_Requests (
      id, employee_id, manager_id, leave_type, start_date, end_date, days, reason, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?)`
  ).run(
    id,
    params.employeeId,
    managerId,
    params.leaveType,
    params.startDate,
    params.endDate,
    days,
    params.reason.trim(),
    createdAt
  );

  writeAuditLog(db, {
    attendanceId: null,
    employeeId: params.employeeId,
    action: 'LEAVE_REQUESTED',
    actorUserId: params.actor.id,
    actorName: params.actor.fullName,
    afterObj: { leaveType: params.leaveType, startDate: params.startDate, endDate: params.endDate, days, managerId },
    details: `Submitted ${params.leaveType} leave request (${params.startDate} to ${params.endDate}, ${days}d)`,
  });

  return { ok: true, leave: listLeavesFromDb(db).find((l) => l.id === id)! };
}

export function reviewLeaveInDb(
  db: AppDatabase,
  params: {
    leaveId: string;
    status: 'Approved' | 'Rejected';
    actor: SessionUser;
    remarks?: string;
    isOverride?: boolean;
  }
): LeaveRecord | null {
  const existing = listLeavesFromDb(db).find((l) => l.id === params.leaveId);
  if (!existing) return null;
  const nowIso = new Date().toISOString();
  const cleanRemarks =
    params.remarks !== undefined ? params.remarks.trim() || null : existing.reviewRemarks || null;
  const isOverride = Boolean(params.isOverride);

  db.prepare(
    `UPDATE Leave_Requests
     SET status = ?,
         reviewed_by = ?,
         reviewed_at = ?,
         review_remarks = ?,
         overridden_by = CASE WHEN ? = 1 THEN ? ELSE overridden_by END,
         overridden_at = CASE WHEN ? = 1 THEN ? ELSE overridden_at END
     WHERE id = ?`
  ).run(
    params.status,
    params.actor.fullName,
    nowIso,
    cleanRemarks,
    isOverride ? 1 : 0,
    params.actor.fullName,
    isOverride ? 1 : 0,
    nowIso,
    params.leaveId
  );

  const dates = getDateRangeList(existing.startDate, existing.endDate);
  if (params.status === 'Approved') {
    for (const dateStr of dates) {
      createOrUpdateManualAttendanceInDb(db, {
        employeeId: existing.employeeId,
        attendanceDate: dateStr,
        checkInTime: null,
        checkOutTime: null,
        status: 'On Leave',
        remarks: `${existing.leaveType} Leave: ${existing.reason}`,
        correctionStatus: 'Approved',
        actor: params.actor,
      });
    }
  } else if (isOverride && existing.status === 'Approved' && params.status === 'Rejected') {
    const clearLeaveAtt = db.prepare(
      `DELETE FROM Attendance WHERE employee_id = ? AND attendance_date = ? AND status = 'On Leave' AND check_in_time IS NULL`
    );
    for (const dateStr of dates) {
      clearLeaveAtt.run(existing.employeeId, dateStr);
    }
  }

  writeAuditLog(db, {
    attendanceId: null,
    employeeId: existing.employeeId,
    action: isOverride
      ? 'LEAVE_OVERRIDDEN'
      : params.status === 'Approved'
      ? 'LEAVE_APPROVED'
      : 'LEAVE_REJECTED',
    actorUserId: params.actor.id,
    actorName: params.actor.fullName,
    beforeObj: existing,
    afterObj: { status: params.status, remarks: cleanRemarks, overridden: isOverride },
    details: `${isOverride ? 'Overrode -> ' : ''}${params.status} ${existing.leaveType} leave (${existing.startDate} to ${existing.endDate}) for ${existing.employeeId}${cleanRemarks ? ` · Remarks: ${cleanRemarks}` : ''}`,
  });

  return listLeavesFromDb(db).find((l) => l.id === params.leaveId) || null;
}

export function listAuditLogsFromDb(db: AppDatabase): AttendanceAuditLog[] {
  const rows = db
    .prepare(
      `SELECT l.*, e.name as emp_name
       FROM Attendance_Audit_Logs l
       LEFT JOIN Employees e ON e.id = l.employee_id
       ORDER BY l.created_at DESC
       LIMIT 200`
    )
    .all() as Array<{
    id: string;
    attendance_id: string | null;
    employee_id: string;
    emp_name: string | null;
    action: string;
    actor_user_id: string;
    actor_name: string;
    before_json: string | null;
    after_json: string | null;
    details: string;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    attendanceId: r.attendance_id,
    employeeId: r.employee_id,
    employeeName: r.emp_name || r.employee_id,
    action: r.action,
    actorUserId: r.actor_user_id,
    actorName: r.actor_name,
    beforeJson: r.before_json,
    afterJson: r.after_json,
    details: r.details,
    createdAt: r.created_at,
  }));
}

// =========================================================================
// PUBLIC HOLIDAYS & AUTO-UPDATING INDIAN NATIONAL CALENDAR
// =========================================================================

export function syncNationalHolidaysForRange(
  db: AppDatabase,
  startYear: number,
  endYear: number
): void {
  const overrideRows = db
    .prepare(`SELECT * FROM National_Holiday_Overrides`)
    .all() as Array<{
    id: string;
    origin_key: string;
    year: number;
    action: 'edited' | 'deleted';
    title: string | null;
    holiday_date: string | null;
    center: string | null;
    description: string | null;
    updated_at: string;
  }>;

  const overrides: NationalHolidayOverrideRecord[] = overrideRows.map((r) => ({
    id: r.id,
    originKey: r.origin_key,
    year: Number(r.year),
    action: r.action,
    title: r.title || undefined,
    holidayDate: r.holiday_date || undefined,
    center: r.center || undefined,
    description: r.description ?? undefined,
    updatedAt: r.updated_at,
  }));

  const rolled = buildRolledNationalHolidays({ startYear, endYear, overrides });
  const expectedIds = new Set(rolled.map((h) => h.id));

  const existingNatRows = db
    .prepare(`SELECT id FROM Public_Holidays WHERE is_national = 1`)
    .all() as Array<{ id: string }>;

  const delStmt = db.prepare(`DELETE FROM Public_Holidays WHERE id = ?`);
  for (const row of existingNatRows) {
    if (!expectedIds.has(row.id)) {
      delStmt.run(row.id);
    }
  }

  const upsertStmt = db.prepare(`
    INSERT INTO Public_Holidays (id, title, holiday_date, center, description, is_national, origin_key, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      holiday_date = excluded.holiday_date,
      center = excluded.center,
      description = excluded.description,
      is_national = 1,
      origin_key = excluded.origin_key
  `);

  for (const h of rolled) {
    upsertStmt.run(
      h.id,
      h.title,
      h.holidayDate,
      h.center,
      h.description,
      h.originKey || null,
      h.createdBy || 'System Calendar',
      h.createdAt
    );
  }
}

export function listPublicHolidaysFromDb(db: AppDatabase): PublicHoliday[] {
  const rows = db
    .prepare(`SELECT * FROM Public_Holidays ORDER BY holiday_date ASC, title ASC`)
    .all() as Array<{
    id: string;
    title: string;
    holiday_date: string;
    center: string;
    description: string;
    is_national?: number;
    origin_key?: string | null;
    created_by: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    holidayDate: r.holiday_date,
    center: r.center,
    description: r.description,
    isNational: Boolean(r.is_national),
    originKey: r.origin_key || null,
    createdBy: r.created_by,
    createdAt: r.created_at,
  }));
}

export function createPublicHolidayInDb(
  db: AppDatabase,
  params: {
    title: string;
    holidayDate: string;
    center: string;
    description?: string;
    isNational?: boolean;
    createdBy?: string;
  }
): PublicHoliday {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const isNat = params.isNational ? 1 : 0;
  const originKey = params.isNational ? `CUSTOM_NAT_${id.slice(0, 8)}` : null;
  db.prepare(
    `INSERT INTO Public_Holidays (id, title, holiday_date, center, description, is_national, origin_key, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.title.trim(),
    params.holidayDate,
    params.center.trim() || 'All Centers',
    (params.description || '').trim(),
    isNat,
    originKey,
    params.createdBy || null,
    createdAt
  );
  return listPublicHolidaysFromDb(db).find((h) => h.id === id)!;
}

export function updatePublicHolidayInDb(
  db: AppDatabase,
  id: string,
  params: {
    title?: string;
    holidayDate?: string;
    center?: string;
    description?: string;
  }
): PublicHoliday | null {
  const existing = db
    .prepare(`SELECT * FROM Public_Holidays WHERE id = ? LIMIT 1`)
    .get(id) as
    | {
        id: string;
        title: string;
        holiday_date: string;
        center: string;
        description: string;
        is_national: number;
        origin_key: string | null;
      }
    | undefined;
  if (!existing) return null;

  const nextTitle = (params.title ?? existing.title).trim();
  const nextDate = (params.holidayDate ?? existing.holiday_date).trim();
  const nextCenter = (params.center ?? existing.center).trim() || 'All Centers';
  const nextDesc = (params.description ?? existing.description).trim();
  const nowIso = new Date().toISOString();

  db.prepare(
    `UPDATE Public_Holidays SET title = ?, holiday_date = ?, center = ?, description = ? WHERE id = ?`
  ).run(nextTitle, nextDate, nextCenter, nextDesc, id);

  if (existing.is_national && existing.origin_key) {
    const year = Number((existing.holiday_date || nextDate).slice(0, 4)) || new Date().getFullYear();
    db.prepare(`
      INSERT INTO National_Holiday_Overrides (id, origin_key, year, action, title, holiday_date, center, description, updated_at)
      VALUES (?, ?, ?, 'edited', ?, ?, ?, ?, ?)
      ON CONFLICT(origin_key, year) DO UPDATE SET
        action = 'edited',
        title = excluded.title,
        holiday_date = excluded.holiday_date,
        center = excluded.center,
        description = excluded.description,
        updated_at = excluded.updated_at
    `).run(crypto.randomUUID(), existing.origin_key, year, nextTitle, nextDate, nextCenter, nextDesc, nowIso);

    syncNationalHolidaysForRange(db, 2025, Math.max(year + 2, new Date().getFullYear() + 2));
  }

  return listPublicHolidaysFromDb(db).find((h) => h.id === id) || null;
}

export function deletePublicHolidayInDb(db: AppDatabase, id: string): boolean {
  const existing = db
    .prepare(`SELECT id, holiday_date, is_national, origin_key FROM Public_Holidays WHERE id = ? LIMIT 1`)
    .get(id) as
    | { id: string; holiday_date: string; is_national: number; origin_key: string | null }
    | undefined;
  if (!existing) return false;

  const res = db.prepare(`DELETE FROM Public_Holidays WHERE id = ?`).run(id);
  if (existing.is_national && existing.origin_key) {
    const year = Number(existing.holiday_date.slice(0, 4)) || new Date().getFullYear();
    db.prepare(`
      INSERT INTO National_Holiday_Overrides (id, origin_key, year, action, updated_at)
      VALUES (?, ?, ?, 'deleted', ?)
      ON CONFLICT(origin_key, year) DO UPDATE SET
        action = 'deleted',
        updated_at = excluded.updated_at
    `).run(crypto.randomUUID(), existing.origin_key, year, new Date().toISOString());

    syncNationalHolidaysForRange(db, 2025, Math.max(year + 2, new Date().getFullYear() + 2));
  }
  return res.changes > 0;
}

// =========================================================================
// DEPARTMENTS & MAPPED DESIGNATIONS MASTER DATA
// =========================================================================

export function listDepartmentsAndDesignationsFromDb(db: AppDatabase): {
  departments: string[];
  designations: DepartmentDesignation[];
} {
  const settingsRow = db
    .prepare(`SELECT departments_json FROM App_Settings WHERE id = 'default' LIMIT 1`)
    .get() as { departments_json?: string } | undefined;
  let configuredDepts: string[] = [];
  if (settingsRow?.departments_json) {
    try {
      const parsed = JSON.parse(settingsRow.departments_json);
      if (Array.isArray(parsed)) {
        configuredDepts = parsed.map((d) => String(d).trim()).filter(Boolean);
      }
    } catch {
      // Ignore parse error
    }
  }

  const desigRows = db
    .prepare(
      `SELECT id, department_name, designation_name, created_at
       FROM Department_Designations
       ORDER BY department_name ASC, designation_name ASC`
    )
    .all() as Array<{
    id: string;
    department_name: string;
    designation_name: string;
    created_at: string;
  }>;

  const designations: DepartmentDesignation[] = desigRows.map((d) => ({
    id: d.id,
    departmentName: d.department_name,
    designationName: d.designation_name,
    createdAt: d.created_at,
  }));

  const deptSet = new Set<string>(configuredDepts);
  for (const d of designations) {
    if (d.departmentName) deptSet.add(d.departmentName);
  }

  return {
    departments: Array.from(deptSet),
    designations,
  };
}

export function createDepartmentInDb(
  db: AppDatabase,
  departmentName: string,
  actor: AuditActorContext = DEFAULT_SYSTEM_ACTOR
): { ok: true; departments: string[] } | { ok: false; code: number; error: string } {
  const clean = departmentName.trim();
  if (!clean) {
    return { ok: false, code: 400, error: 'Department name is required.' };
  }
  const current = listDepartmentsAndDesignationsFromDb(db).departments;
  if (current.some((d) => d.toLowerCase() === clean.toLowerCase())) {
    return { ok: false, code: 409, error: `Department "${clean}" already exists.` };
  }
  const next = [...current, clean];
  db.prepare(`UPDATE App_Settings SET departments_json = ?, updated_at = ? WHERE id = 'default'`).run(
    JSON.stringify(next),
    new Date().toISOString()
  );
  writeSystemAuditLog(db, {
    module: 'Settings',
    entityType: 'Department',
    entityId: clean,
    action: 'DEPARTMENT_CREATED',
    actor,
    afterObj: { departmentName: clean },
    details: `Created department "${clean}"`,
  });
  return { ok: true, departments: next };
}

export function createDesignationInDb(
  db: AppDatabase,
  params: { departmentName: string; designationName: string },
  actor: AuditActorContext = DEFAULT_SYSTEM_ACTOR
): { ok: true; designation: DepartmentDesignation } | { ok: false; code: number; error: string } {
  const dept = params.departmentName.trim();
  const desig = params.designationName.trim();
  if (!dept || !desig) {
    return { ok: false, code: 400, error: 'Department and Designation name are both required.' };
  }

  const existingDepts = listDepartmentsAndDesignationsFromDb(db).departments;
  if (!existingDepts.some((d) => d.toLowerCase() === dept.toLowerCase())) {
    const nextDepts = [...existingDepts, dept];
    db.prepare(`UPDATE App_Settings SET departments_json = ?, updated_at = ? WHERE id = 'default'`).run(
      JSON.stringify(nextDepts),
      new Date().toISOString()
    );
  }

  const existing = db
    .prepare(
      `SELECT id FROM Department_Designations WHERE LOWER(department_name) = LOWER(?) AND LOWER(designation_name) = LOWER(?) LIMIT 1`
    )
    .get(dept, desig) as { id: string } | undefined;
  if (existing) {
    return { ok: false, code: 409, error: `Designation "${desig}" already exists in ${dept}.` };
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO Department_Designations (id, department_name, designation_name, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(id, dept, desig, createdAt);

  writeSystemAuditLog(db, {
    module: 'Settings',
    entityType: 'Designation',
    entityId: id,
    action: 'DESIGNATION_CREATED',
    actor,
    afterObj: { departmentName: dept, designationName: desig },
    details: `Created designation "${desig}" under department "${dept}"`,
  });

  return {
    ok: true,
    designation: { id, departmentName: dept, designationName: desig, createdAt },
  };
}

export function deleteDesignationInDb(
  db: AppDatabase,
  id: string,
  actor: AuditActorContext = DEFAULT_SYSTEM_ACTOR
): boolean {
  const existing = db
    .prepare(`SELECT * FROM Department_Designations WHERE id = ? LIMIT 1`)
    .get(id) as { id: string; department_name: string; designation_name: string } | undefined;
  if (!existing) return false;
  const res = db.prepare(`DELETE FROM Department_Designations WHERE id = ?`).run(id);
  if (res.changes > 0) {
    writeSystemAuditLog(db, {
      module: 'Settings',
      entityType: 'Designation',
      entityId: id,
      action: 'DESIGNATION_DELETED',
      actor,
      beforeObj: existing,
      details: `Deleted designation "${existing.designation_name}" from "${existing.department_name}"`,
    });
    return true;
  }
  return false;
}

// =========================================================================
// WORKFLOW REQUESTS (REGULARIZATION, WFH, PROFILE CHANGES)
// =========================================================================

export function listWorkflowRequestsFromDb(db: AppDatabase): WorkflowRequestRecord[] {
  const rows = db
    .prepare(
      `SELECT w.*, e.employee_id as emp_code, e.name as emp_name, e.email as emp_email,
              e.department as emp_dept, e.center as emp_center,
              e.reporting_manager_name as mgr_name, e.reporting_manager_email as mgr_email
       FROM Workflow_Requests w
       LEFT JOIN Employees e ON e.id = w.employee_id
       ORDER BY w.created_at DESC`
    )
    .all() as Array<{
    id: string;
    request_type: WorkflowRequestType;
    employee_id: string;
    emp_code: string | null;
    emp_name: string | null;
    emp_email: string | null;
    emp_dept: string | null;
    emp_center: string | null;
    mgr_name: string | null;
    mgr_email: string | null;
    target_date: string;
    end_date: string | null;
    requested_check_in: string | null;
    requested_check_out: string | null;
    payload_json: string | null;
    reason: string;
    status: WorkflowRequestStatus;
    reviewed_by: string | null;
    reviewed_at: string | null;
    review_notes: string | null;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    requestType: r.request_type,
    employeeId: r.employee_id,
    employeeCode: r.emp_code || r.employee_id,
    employeeName: r.emp_name || r.employee_id,
    employeeEmail: r.emp_email || '',
    department: r.emp_dept || undefined,
    center: r.emp_center || undefined,
    reportingManagerName: r.mgr_name || undefined,
    reportingManagerEmail: r.mgr_email || undefined,
    targetDate: r.target_date,
    endDate: r.end_date,
    requestedCheckIn: r.requested_check_in,
    requestedCheckOut: r.requested_check_out,
    payloadJson: r.payload_json,
    reason: r.reason,
    status: r.status,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
    reviewNotes: r.review_notes,
    createdAt: r.created_at,
  }));
}

export function createWorkflowRequestInDb(
  db: AppDatabase,
  params: {
    requestType: WorkflowRequestType;
    employeeId: string;
    targetDate: string;
    endDate?: string | null;
    requestedCheckIn?: string | null;
    requestedCheckOut?: string | null;
    payload?: Record<string, unknown> | null;
    reason: string;
    actor: SessionUser;
  }
): { ok: true; request: WorkflowRequestRecord } | { ok: false; error: string } {
  const reason = params.reason.trim();
  if (reason.length < 4) {
    return { ok: false, error: 'Please provide a reason (at least 4 characters).' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.targetDate)) {
    return { ok: false, error: 'Valid target date (YYYY-MM-DD) is required.' };
  }
  if (params.requestType === 'wfh' && params.endDate) {
    if (calculateLeaveDays(params.targetDate, params.endDate) <= 0) {
      return { ok: false, error: 'WFH end date must be on or after start date.' };
    }
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO Workflow_Requests (
      id, request_type, employee_id, target_date, end_date, requested_check_in,
      requested_check_out, payload_json, reason, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?)`
  ).run(
    id,
    params.requestType,
    params.employeeId,
    params.targetDate,
    params.endDate || null,
    params.requestedCheckIn || null,
    params.requestedCheckOut || null,
    params.payload ? JSON.stringify(params.payload) : null,
    reason,
    createdAt
  );

  writeAuditLog(db, {
    attendanceId: null,
    employeeId: params.employeeId,
    action: `${params.requestType.toUpperCase()}_REQUESTED`,
    actorUserId: params.actor.id,
    actorName: params.actor.fullName,
    afterObj: {
      targetDate: params.targetDate,
      endDate: params.endDate,
      requestedCheckIn: params.requestedCheckIn,
      requestedCheckOut: params.requestedCheckOut,
      payload: params.payload,
    },
    details: `Submitted ${params.requestType} request for ${params.targetDate}: ${reason}`,
  });

  return { ok: true, request: listWorkflowRequestsFromDb(db).find((w) => w.id === id)! };
}

export function reviewWorkflowRequestInDb(
  db: AppDatabase,
  params: {
    requestId: string;
    status: 'Approved' | 'Rejected';
    actorName: string;
    actorUserId?: string;
    reviewNotes?: string;
  }
): WorkflowRequestRecord | null {
  const existing = listWorkflowRequestsFromDb(db).find((w) => w.id === params.requestId);
  if (!existing) return null;

  const nowIso = new Date().toISOString();
  db.prepare(
    `UPDATE Workflow_Requests
     SET status = ?, reviewed_by = ?, reviewed_at = ?, review_notes = ?
     WHERE id = ?`
  ).run(
    params.status,
    params.actorName,
    nowIso,
    (params.reviewNotes || '').trim() || null,
    params.requestId
  );

  const syntheticActor: SessionUser = {
    id: params.actorUserId || SEED_ADMIN_ID,
    loginId: 'approval-workflow',
    fullName: params.actorName,
    email: SEED_ADMIN_EMAIL,
    role: 'Super Admin',
    permissions: [],
    active: true,
    createdAt: nowIso,
  };

  if (params.status === 'Approved') {
    if (existing.requestType === 'regularization') {
      createOrUpdateManualAttendanceInDb(db, {
        employeeId: existing.employeeId,
        attendanceDate: existing.targetDate,
        checkInTime: existing.requestedCheckIn || '09:15',
        checkOutTime: existing.requestedCheckOut || '17:30',
        status: 'Present',
        remarks: `Regularized: ${existing.reason}`,
        correctionStatus: 'Approved',
        actor: syntheticActor,
      });
    } else if (existing.requestType === 'wfh') {
      const end = existing.endDate || existing.targetDate;
      const dates = getDateRangeList(existing.targetDate, end);
      for (const dateStr of dates) {
        createOrUpdateManualAttendanceInDb(db, {
          employeeId: existing.employeeId,
          attendanceDate: dateStr,
          checkInTime: existing.requestedCheckIn || '09:15',
          checkOutTime: existing.requestedCheckOut || '17:30',
          status: 'Present',
          remarks: `Work From Home (Approved): ${existing.reason}`,
          correctionStatus: 'Approved',
          actor: syntheticActor,
        });
      }
    } else if (existing.requestType === 'profile_change' && existing.payloadJson) {
      try {
        const changes = JSON.parse(existing.payloadJson) as Partial<Employee>;
        const currentEmp = listEmployeesFromDb(db).find((e) => e.id === existing.employeeId);
        if (currentEmp) {
          updateEmployeeInDb(
            db,
            currentEmp.id,
            {
              name: typeof changes.name === 'string' && changes.name.trim() ? changes.name.trim() : currentEmp.name,
              phone: typeof changes.phone === 'string' ? changes.phone.trim() : currentEmp.phone,
              email: typeof changes.email === 'string' && changes.email.trim() ? changes.email.trim() : currentEmp.email,
              center: typeof changes.center === 'string' && changes.center.trim() ? changes.center.trim() : currentEmp.center,
              branch: typeof changes.center === 'string' && changes.center.trim() ? changes.center.trim() : currentEmp.branch,
              department:
                typeof changes.department === 'string' && changes.department.trim()
                  ? changes.department.trim()
                  : currentEmp.department,
              designation:
                typeof changes.designation === 'string' && changes.designation.trim()
                  ? changes.designation.trim()
                  : currentEmp.designation,
            },
            {
              userId: syntheticActor.id,
              userName: params.actorName,
              userRole: 'Workflow Approver',
              ipAddress: '127.0.0.1',
            }
          );
        }
      } catch {
        // Ignore invalid JSON payload
      }
    }
  }

  writeAuditLog(db, {
    attendanceId: null,
    employeeId: existing.employeeId,
    action: `${existing.requestType.toUpperCase()}_${params.status.toUpperCase()}`,
    actorUserId: syntheticActor.id,
    actorName: params.actorName,
    beforeObj: existing,
    afterObj: { status: params.status },
    details: `${params.status} ${existing.requestType} request on ${existing.targetDate} for ${existing.employeeId}`,
  });

  return listWorkflowRequestsFromDb(db).find((w) => w.id === params.requestId) || null;
}

// =========================================================================
// EMAIL APPROVAL TOKENS (SINGLE-USE CRYPTOGRAPHIC HASHED TOKENS)
// =========================================================================

export function hashApprovalToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function createApprovalTokenInDb(
  db: AppDatabase,
  params: {
    entityType: ApprovalEntityType;
    entityId: string;
    employeeId: string;
    managerName: string;
    managerEmail: string;
    ttlHours?: number;
  }
): { rawToken: string; approvalId: string } {
  const rawToken = crypto.randomBytes(24).toString('hex');
  const tokenHash = hashApprovalToken(rawToken);
  const approvalId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + (params.ttlHours ?? 72) * 3600 * 1000).toISOString();

  db.prepare(
    `INSERT INTO Approval_Requests (
      id, token_hash, entity_type, entity_id, employee_id, manager_name,
      manager_email, status, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?)`
  ).run(
    approvalId,
    tokenHash,
    params.entityType,
    params.entityId,
    params.employeeId,
    params.managerName,
    params.managerEmail,
    expiresAt,
    createdAt
  );

  writeEmailAuditLogInDb(db, {
    approvalRequestId: approvalId,
    eventType: 'APPROVAL_TOKEN_ISSUED',
    actor: params.managerEmail,
    status: 'Pending',
    details: `Issued secure approval link for ${params.entityType} (${params.entityId}) to ${params.managerName} <${params.managerEmail}>`,
  });

  return { rawToken, approvalId };
}

export function consumeApprovalTokenInDb(
  db: AppDatabase,
  params: {
    rawToken: string;
    action: 'approve' | 'reject';
    notes?: string;
  }
):
  | {
      ok: true;
      entityType: ApprovalEntityType;
      entityId: string;
      employeeId: string;
      managerName: string;
      managerEmail: string;
      status: 'Approved' | 'Rejected';
      approvalId: string;
    }
  | { ok: false; code: number; error: string; alreadyProcessed?: boolean; status?: string } {
  const tokenHash = hashApprovalToken(params.rawToken);
  const row = db
    .prepare(`SELECT * FROM Approval_Requests WHERE token_hash = ? LIMIT 1`)
    .get(tokenHash) as
    | {
        id: string;
        entity_type: ApprovalEntityType;
        entity_id: string;
        employee_id: string;
        manager_name: string;
        manager_email: string;
        status: 'Pending' | 'Approved' | 'Rejected';
        expires_at: string;
      }
    | undefined;

  if (!row) {
    return { ok: false, code: 404, error: 'Invalid or unknown approval token.' };
  }
  if (row.status !== 'Pending') {
    return {
      ok: false,
      code: 409,
      error: `This request has already been ${row.status.toLowerCase()}.`,
      alreadyProcessed: true,
      status: row.status,
    };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, code: 410, error: 'This approval link has expired.' };
  }

  const nextStatus: 'Approved' | 'Rejected' = params.action === 'approve' ? 'Approved' : 'Rejected';
  const nowIso = new Date().toISOString();

  db.exec('BEGIN');
  try {
    db.prepare(
      `UPDATE Approval_Requests
       SET status = ?, actioned_at = ?, actioned_by = ?
       WHERE id = ?`
    ).run(nextStatus, nowIso, `${row.manager_name} <${row.manager_email}>`, row.id);

    if (row.entity_type === 'leave') {
      const syntheticActor: SessionUser = {
        id: SEED_ADMIN_ID,
        loginId: row.manager_email,
        fullName: `${row.manager_name} (Email Approval)`,
        email: row.manager_email,
        role: 'Super Admin',
        permissions: [],
        active: true,
        createdAt: nowIso,
      };
      reviewLeaveInDb(db, {
        leaveId: row.entity_id,
        status: nextStatus,
        actor: syntheticActor,
      });
    } else {
      reviewWorkflowRequestInDb(db, {
        requestId: row.entity_id,
        status: nextStatus,
        actorName: `${row.manager_name} (Email Approval)`,
        reviewNotes: params.notes,
      });
    }

    writeEmailAuditLogInDb(db, {
      approvalRequestId: row.id,
      eventType: `MANAGER_${nextStatus.toUpperCase()}_VIA_EMAIL`,
      actor: `${row.manager_name} <${row.manager_email}>`,
      status: nextStatus,
      details: `${row.manager_name} ${nextStatus.toLowerCase()} ${row.entity_type} (${row.entity_id}) via secure email link.`,
    });

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return {
    ok: true,
    entityType: row.entity_type,
    entityId: row.entity_id,
    employeeId: row.employee_id,
    managerName: row.manager_name,
    managerEmail: row.manager_email,
    status: nextStatus,
    approvalId: row.id,
  };
}

// =========================================================================
// EMAIL LOGS, DEDUPLICATION, RETRY QUEUE & AUDIT LOGS
// =========================================================================

export function writeEmailAuditLogInDb(
  db: AppDatabase,
  params: {
    emailLogId?: string | null;
    approvalRequestId?: string | null;
    eventType: string;
    actor: string;
    status: string;
    details: string;
  }
): void {
  db.prepare(
    `INSERT INTO Email_Audit_Logs (
      id, email_log_id, approval_request_id, event_type, actor, status, details, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    params.emailLogId ?? null,
    params.approvalRequestId ?? null,
    params.eventType,
    params.actor,
    params.status,
    params.details,
    new Date().toISOString()
  );
}

interface RawEmailLogRow {
  id: string;
  dedupe_key: string;
  event_type: string;
  recipient_email: string;
  recipient_name: string;
  recipient_role: 'Manager' | 'Employee' | 'System';
  employee_id: string | null;
  emp_code: string | null;
  employee_name: string | null;
  manager_name: string | null;
  manager_email: string | null;
  center: string | null;
  subject: string;
  html_body: string;
  text_body: string;
  status: EmailDeliveryStatus;
  attempts: number;
  max_attempts: number;
  next_retry_at: string | null;
  last_error: string | null;
  message_id: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
}

function mapEmailLogRow(r: RawEmailLogRow): EmailLogRecord {
  return {
    id: r.id,
    dedupeKey: r.dedupe_key,
    eventType: r.event_type,
    recipientEmail: r.recipient_email,
    recipientName: r.recipient_name,
    recipientRole: r.recipient_role,
    employeeId: r.employee_id,
    employeeCode: r.emp_code || r.employee_id,
    employeeName: r.employee_name,
    managerName: r.manager_name,
    managerEmail: r.manager_email,
    center: r.center,
    subject: r.subject,
    htmlBody: r.html_body,
    textBody: r.text_body,
    status: r.status,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    nextRetryAt: r.next_retry_at,
    lastError: r.last_error,
    messageId: r.message_id,
    relatedEntityType: r.related_entity_type,
    relatedEntityId: r.related_entity_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    sentAt: r.sent_at,
  };
}

export function enqueueEmailInDb(
  db: AppDatabase,
  params: {
    dedupeKey: string;
    eventType: string;
    recipientEmail: string;
    recipientName: string;
    recipientRole: 'Manager' | 'Employee' | 'System';
    employeeId?: string | null;
    employeeName?: string | null;
    managerName?: string | null;
    managerEmail?: string | null;
    center?: string | null;
    subject: string;
    htmlBody: string;
    textBody: string;
    relatedEntityType?: string | null;
    relatedEntityId?: string | null;
    maxAttempts?: number;
  }
): { enqueued: boolean; log: EmailLogRecord } {
  const existing = db
    .prepare(
      `SELECT l.*, e.employee_id as emp_code
       FROM Email_Logs l
       LEFT JOIN Employees e ON e.id = l.employee_id
       WHERE l.dedupe_key = ?
       LIMIT 1`
    )
    .get(params.dedupeKey) as RawEmailLogRow | undefined;

  if (existing) {
    writeEmailAuditLogInDb(db, {
      emailLogId: existing.id,
      eventType: 'DUPLICATE_SKIPPED',
      actor: 'mail-queue',
      status: existing.status,
      details: `Deduplicated ${params.eventType} email to ${params.recipientEmail} (key: ${params.dedupeKey})`,
    });
    return { enqueued: false, log: mapEmailLogRow(existing) };
  }

  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO Email_Logs (
      id, dedupe_key, event_type, recipient_email, recipient_name, recipient_role,
      employee_id, employee_name, manager_name, manager_email, center,
      subject, html_body, text_body, status, attempts, max_attempts,
      next_retry_at, related_entity_type, related_entity_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Queued', 0, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.dedupeKey,
    params.eventType,
    params.recipientEmail,
    params.recipientName,
    params.recipientRole,
    params.employeeId ?? null,
    params.employeeName ?? null,
    params.managerName ?? null,
    params.managerEmail ?? null,
    params.center ?? null,
    params.subject,
    params.htmlBody,
    params.textBody,
    params.maxAttempts ?? 1,
    nowIso,
    params.relatedEntityType ?? null,
    params.relatedEntityId ?? null,
    nowIso,
    nowIso
  );

  writeEmailAuditLogInDb(db, {
    emailLogId: id,
    eventType: 'EMAIL_QUEUED',
    actor: 'system',
    status: 'Queued',
    details: `Queued ${params.eventType} to ${params.recipientEmail} ("${params.subject}")`,
  });

  const saved = db
    .prepare(
      `SELECT l.*, e.employee_id as emp_code
       FROM Email_Logs l
       LEFT JOIN Employees e ON e.id = l.employee_id
       WHERE l.id = ?`
    )
    .get(id) as unknown as RawEmailLogRow;

  return { enqueued: true, log: mapEmailLogRow(saved) };
}

export function getEmailLogByIdFromDb(db: AppDatabase, emailLogId: string): EmailLogRecord | null {
  const row = db
    .prepare(
      `SELECT l.*, e.employee_id as emp_code
       FROM Email_Logs l
       LEFT JOIN Employees e ON e.id = l.employee_id
       WHERE l.id = ? LIMIT 1`
    )
    .get(emailLogId) as RawEmailLogRow | undefined;
  return row ? mapEmailLogRow(row) : null;
}

export function claimDueMailJobsFromDb(db: AppDatabase, limit = 10): EmailLogRecord[] {
  const nowIso = new Date().toISOString();
  const rows = db
    .prepare(
      `SELECT l.*, e.employee_id as emp_code
       FROM Email_Logs l
       LEFT JOIN Employees e ON e.id = l.employee_id
       WHERE l.status = 'Queued'
       ORDER BY l.created_at ASC
       LIMIT ?`
    )
    .all(limit) as unknown as RawEmailLogRow[];

  const claimStmt = db.prepare(
    `UPDATE Email_Logs SET status = 'Sending', updated_at = ? WHERE id = ? AND status = 'Queued'`
  );
  const claimed: EmailLogRecord[] = [];
  for (const row of rows) {
    const res = claimStmt.run(nowIso, row.id);
    if (res.changes > 0) {
      claimed.push(mapEmailLogRow({ ...row, status: 'Sending' }));
    }
  }
  return claimed;
}

export function markEmailSentInDb(
  db: AppDatabase,
  emailLogId: string,
  messageId: string
): void {
  const nowIso = new Date().toISOString();
  const row = db.prepare(`SELECT recipient_email, event_type, attempts FROM Email_Logs WHERE id = ?`).get(emailLogId) as
    | { recipient_email: string; event_type: string; attempts: number }
    | undefined;
  db.prepare(
    `UPDATE Email_Logs
     SET status = 'Sent', attempts = attempts + 1, message_id = ?, last_error = NULL,
         next_retry_at = NULL, sent_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(messageId, nowIso, nowIso, emailLogId);

  if (row) {
    writeEmailAuditLogInDb(db, {
      emailLogId,
      eventType: 'EMAIL_SENT',
      actor: 'smtp-manual',
      status: 'Sent',
      details: `Delivered ${row.event_type} to ${row.recipient_email} (Message-ID: ${messageId})`,
    });
  }
}

export function deleteFailedEmailLogFromDb(
  db: AppDatabase,
  emailLogId: string,
  errorMessage: string,
  actor = 'smtp-manual'
): boolean {
  const row = db
    .prepare(`SELECT recipient_email, event_type, subject FROM Email_Logs WHERE id = ?`)
    .get(emailLogId) as
    | { recipient_email: string; event_type: string; subject: string }
    | undefined;

  if (row) {
    writeEmailAuditLogInDb(db, {
      emailLogId,
      eventType: 'EMAIL_FAILED_PURGED',
      actor,
      status: 'Failed',
      details: `Email delivery failed for ${row.recipient_email} (${row.event_type}): ${errorMessage}. Immediately deleted from mail queue (no retry).`,
    });
  }

  const res = db.prepare(`DELETE FROM Email_Logs WHERE id = ?`).run(emailLogId);
  return res.changes > 0;
}

export function markEmailRetryOrFailedInDb(
  db: AppDatabase,
  emailLogId: string,
  errorMessage: string
): 'Failed' {
  // Zero retry policy: failed deliveries are immediately purged from the mail queue
  deleteFailedEmailLogFromDb(db, emailLogId, errorMessage, 'smtp-manual');
  return 'Failed';
}

export function retryEmailNowInDb(db: AppDatabase, emailLogId: string, actorName: string): EmailLogRecord | null {
  const nowIso = new Date().toISOString();
  const res = db
    .prepare(
      `UPDATE Email_Logs
       SET status = 'Queued', next_retry_at = ?, max_attempts = 1, updated_at = ?
       WHERE id = ?`
    )
    .run(nowIso, nowIso, emailLogId);
  if (res.changes === 0) return null;

  writeEmailAuditLogInDb(db, {
    emailLogId,
    eventType: 'MANUAL_MAIL_TRIGGERED',
    actor: actorName,
    status: 'Queued',
    details: `Manual mail send triggered by ${actorName}`,
  });

  return getEmailLogByIdFromDb(db, emailLogId);
}

// =========================================================================
// MAIL SERVER CONFIGURATION & ADMIN SENDER CHANGE OTP
// =========================================================================

export interface MailConfigRow {
  id: string;
  appName: string;
  fromEmail: string;
  smtpHost: string;
  smtpPort: number;
  encryption: 'tls' | 'ssl' | 'none';
  imapHost: string;
  imapPort: number;
  username: string;
  appPassword: string;
  updatedAt: string;
}

export function getMailConfigFromDb(db: AppDatabase): MailConfigRow | null {
  const row = db
    .prepare(`SELECT * FROM Mail_Config WHERE id = 'default' LIMIT 1`)
    .get() as
    | {
        id: string;
        app_name: string;
        from_email: string;
        smtp_host: string;
        smtp_port: number;
        encryption: string;
        imap_host: string;
        imap_port: number;
        username: string;
        app_password: string;
        updated_at: string;
      }
    | undefined;
  if (!row) return null;
  const encRaw = (row.encryption || 'tls').toLowerCase();
  const encryption: 'tls' | 'ssl' | 'none' =
    encRaw === 'ssl' ? 'ssl' : encRaw === 'none' ? 'none' : 'tls';
  return {
    id: row.id,
    appName: row.app_name || 'Median Asset & HR Suite',
    fromEmail: row.from_email || 'barunkumarsenbks1997@gmail.com',
    smtpHost: row.smtp_host || 'smtp.gmail.com',
    smtpPort: Number(row.smtp_port) || 587,
    encryption,
    imapHost: row.imap_host || 'imap.gmail.com',
    imapPort: Number(row.imap_port) || 993,
    username: row.username || row.from_email || '',
    appPassword: row.app_password || '',
    updatedAt: row.updated_at,
  };
}

export function saveMailConfigInDb(
  db: AppDatabase,
  cfg: {
    appName: string;
    fromEmail: string;
    smtpHost: string;
    smtpPort: number;
    encryption: 'tls' | 'ssl' | 'none';
    imapHost: string;
    imapPort: number;
    username?: string;
    appPassword: string;
  },
  actor: AuditActorContext = DEFAULT_SYSTEM_ACTOR
): MailConfigRow {
  const nowIso = new Date().toISOString();
  const cleanEmail = cfg.fromEmail.trim();
  const cleanUser = (cfg.username || cleanEmail).trim();

  db.prepare(`
    INSERT INTO Mail_Config (
      id, app_name, from_email, smtp_host, smtp_port, encryption, imap_host, imap_port, username, app_password, updated_at
    ) VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      app_name = excluded.app_name,
      from_email = excluded.from_email,
      smtp_host = excluded.smtp_host,
      smtp_port = excluded.smtp_port,
      encryption = excluded.encryption,
      imap_host = excluded.imap_host,
      imap_port = excluded.imap_port,
      username = excluded.username,
      app_password = excluded.app_password,
      updated_at = excluded.updated_at
  `).run(
    cfg.appName.trim() || 'Median Asset & HR Suite',
    cleanEmail,
    cfg.smtpHost.trim(),
    Number(cfg.smtpPort) || 587,
    cfg.encryption || 'tls',
    cfg.imapHost.trim(),
    Number(cfg.imapPort) || 993,
    cleanUser,
    cfg.appPassword,
    nowIso
  );

  // Sync company settings email as well
  const settingsRow = db
    .prepare(`SELECT settings_json FROM App_Settings WHERE id = 'default' LIMIT 1`)
    .get() as { settings_json?: string } | undefined;
  if (settingsRow?.settings_json) {
    try {
      const parsed = JSON.parse(settingsRow.settings_json) as Record<string, unknown>;
      parsed.email = cleanEmail;
      db.prepare(`UPDATE App_Settings SET settings_json = ?, updated_at = ? WHERE id = 'default'`).run(
        JSON.stringify(parsed),
        nowIso
      );
    } catch {
      // Ignore parse error
    }
  }

  writeSystemAuditLog(db, {
    module: 'Mail',
    entityType: 'MailConfig',
    entityId: 'default',
    action: 'MAIL_CONFIG_UPDATED',
    actor,
    afterObj: { appName: cfg.appName, fromEmail: cleanEmail, smtpHost: cfg.smtpHost, imapHost: cfg.imapHost },
    details: `Updated Admin automated sender mail configuration to ${cleanEmail}`,
  });

  return getMailConfigFromDb(db)!;
}

export function createMailChangeOtpInDb(
  db: AppDatabase,
  params: {
    oldEmail: string;
    newEmail: string;
    otpCode: string;
    ttlMinutes?: number;
  }
): { id: string; oldEmail: string; newEmail: string; otpCode: string; expiresAt: string } {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + (params.ttlMinutes ?? 15) * 60_000).toISOString();

  db.prepare(`UPDATE Mail_Change_Otps SET consumed = 1 WHERE consumed = 0`).run();
  db.prepare(`
    INSERT INTO Mail_Change_Otps (id, old_email, new_email, otp_code, verified, consumed, expires_at, created_at)
    VALUES (?, ?, ?, ?, 0, 0, ?, ?)
  `).run(id, params.oldEmail.trim(), params.newEmail.trim(), params.otpCode.trim(), expiresAt, createdAt);

  return {
    id,
    oldEmail: params.oldEmail.trim(),
    newEmail: params.newEmail.trim(),
    otpCode: params.otpCode.trim(),
    expiresAt,
  };
}

export function verifyMailChangeOtpInDb(
  db: AppDatabase,
  params: { otpId?: string; otpCode: string }
): { ok: true; id: string; oldEmail: string; newEmail: string } | { ok: false; error: string } {
  const row = (params.otpId
    ? db.prepare(`SELECT * FROM Mail_Change_Otps WHERE id = ? LIMIT 1`).get(params.otpId)
    : db
        .prepare(`SELECT * FROM Mail_Change_Otps WHERE consumed = 0 ORDER BY created_at DESC LIMIT 1`)
        .get()) as
    | {
        id: string;
        old_email: string;
        new_email: string;
        otp_code: string;
        verified: number;
        consumed: number;
        expires_at: string;
      }
    | undefined;

  if (!row || row.consumed === 1) {
    return { ok: false, error: 'No active OTP request found. Please request a new 6-digit OTP.' };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'OTP has expired. Please request a new 6-digit OTP.' };
  }
  if (row.otp_code.trim() !== params.otpCode.trim()) {
    return { ok: false, error: 'Invalid 6-digit OTP entered.' };
  }

  db.prepare(`UPDATE Mail_Change_Otps SET verified = 1 WHERE id = ?`).run(row.id);
  return {
    ok: true,
    id: row.id,
    oldEmail: row.old_email,
    newEmail: row.new_email,
  };
}

export function getVerifiedMailChangeOtpInDb(
  db: AppDatabase,
  otpId?: string
): { id: string; oldEmail: string; newEmail: string } | null {
  const row = (otpId
    ? db.prepare(`SELECT * FROM Mail_Change_Otps WHERE id = ? LIMIT 1`).get(otpId)
    : db
        .prepare(`SELECT * FROM Mail_Change_Otps WHERE verified = 1 AND consumed = 0 ORDER BY created_at DESC LIMIT 1`)
        .get()) as
    | {
        id: string;
        old_email: string;
        new_email: string;
        verified: number;
        consumed: number;
        expires_at: string;
      }
    | undefined;
  if (!row || row.consumed === 1 || row.verified !== 1) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return {
    id: row.id,
    oldEmail: row.old_email,
    newEmail: row.new_email,
  };
}

export function consumeMailChangeOtpInDb(db: AppDatabase, otpId: string): void {
  db.prepare(`UPDATE Mail_Change_Otps SET consumed = 1 WHERE id = ?`).run(otpId);
}

export function listEmailLogsFromDb(db: AppDatabase, statusFilter?: string): EmailLogRecord[] {
  const rows = statusFilter
    ? (db
        .prepare(
          `SELECT l.*, e.employee_id as emp_code
           FROM Email_Logs l
           LEFT JOIN Employees e ON e.id = l.employee_id
           WHERE l.status = ?
           ORDER BY l.created_at DESC
           LIMIT 300`
        )
        .all(statusFilter) as unknown as RawEmailLogRow[])
    : (db
        .prepare(
          `SELECT l.*, e.employee_id as emp_code
           FROM Email_Logs l
           LEFT JOIN Employees e ON e.id = l.employee_id
           ORDER BY l.created_at DESC
           LIMIT 300`
        )
        .all() as unknown as RawEmailLogRow[]);
  return rows.map(mapEmailLogRow);
}

export function listEmailAuditLogsFromDb(db: AppDatabase): EmailAuditRecord[] {
  const rows = db
    .prepare(`SELECT * FROM Email_Audit_Logs ORDER BY created_at DESC LIMIT 300`)
    .all() as Array<{
    id: string;
    email_log_id: string | null;
    approval_request_id: string | null;
    event_type: string;
    actor: string;
    status: string;
    details: string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    emailLogId: r.email_log_id,
    approvalRequestId: r.approval_request_id,
    eventType: r.event_type,
    actor: r.actor,
    status: r.status,
    details: r.details,
    createdAt: r.created_at,
  }));
}

export function getEmailDashboardSummaryAndReportsFromDb(db: AppDatabase): {
  summary: EmailDashboardSummary;
  managerReports: ManagerMailReportRow[];
  employeeReports: EmployeeMailReportRow[];
} {
  const logs = listEmailLogsFromDb(db);
  const summary: EmailDashboardSummary = {
    total: logs.length,
    sent: logs.filter((l) => l.status === 'Sent').length,
    failed: logs.filter((l) => l.status === 'Failed').length,
    queued: logs.filter((l) => l.status === 'Queued' || l.status === 'Sending').length,
    retrying: logs.filter((l) => l.status === 'Retry').length,
  };

  const mgrMap = new Map<string, ManagerMailReportRow>();
  const empMap = new Map<string, EmployeeMailReportRow>();

  for (const log of logs) {
    if (log.managerEmail) {
      const key = log.managerEmail.toLowerCase();
      const prev = mgrMap.get(key) || {
        managerName: log.managerName || log.managerEmail,
        managerEmail: log.managerEmail,
        total: 0,
        sent: 0,
        failed: 0,
        queued: 0,
        lastActivityAt: log.updatedAt,
      };
      prev.total++;
      if (log.status === 'Sent') prev.sent++;
      else if (log.status === 'Failed') prev.failed++;
      else prev.queued++;
      if (log.updatedAt > prev.lastActivityAt) prev.lastActivityAt = log.updatedAt;
      mgrMap.set(key, prev);
    }

    if (log.employeeId || log.employeeName) {
      const key = (log.employeeId || log.employeeName || log.recipientEmail).toLowerCase();
      const prev = empMap.get(key) || {
        employeeId: log.employeeId || '—',
        employeeCode: log.employeeCode || log.employeeId || '—',
        employeeName: log.employeeName || log.recipientName || 'Employee',
        employeeEmail:
          log.recipientRole === 'Employee' ? log.recipientEmail : '',
        center: log.center || DEFAULT_INDIAN_CENTER,
        total: 0,
        sent: 0,
        failed: 0,
        queued: 0,
        lastActivityAt: log.updatedAt,
      };
      if (!prev.employeeEmail && log.recipientRole === 'Employee') {
        prev.employeeEmail = log.recipientEmail;
      }
      prev.total++;
      if (log.status === 'Sent') prev.sent++;
      else if (log.status === 'Failed') prev.failed++;
      else prev.queued++;
      if (log.updatedAt > prev.lastActivityAt) prev.lastActivityAt = log.updatedAt;
      empMap.set(key, prev);
    }
  }

  return {
    summary,
    managerReports: Array.from(mgrMap.values()).sort((a, b) => b.total - a.total),
    employeeReports: Array.from(empMap.values()).sort((a, b) => b.total - a.total),
  };
}

// =========================================================================
// EMPLOYEE CENTERS MASTER DATA (INDIAN LOCATIONS)
// =========================================================================

export function listEmployeeCentersFromDb(db: AppDatabase): EmployeeCenterRecord[] {
  const rows = db
    .prepare(
      `SELECT id, city_name, state_name, center_code, official_address, phone, is_active, created_at
       FROM Employee_Centers
       WHERE is_active = 1
       ORDER BY city_name ASC`
    )
    .all() as Array<{
    id: string;
    city_name: string;
    state_name: string;
    center_code: string;
    official_address?: string;
    phone?: string;
    is_active: number;
    created_at: string;
  }>;

  return rows.map((r) => {
    const preset = DEFAULT_CENTER_OFFICES[r.city_name.trim().toLowerCase()];
    return {
      id: r.id,
      name: r.city_name,
      stateRegion: r.state_name,
      centerCode: r.center_code,
      officialAddress: (r.official_address || '').trim() || preset?.address || '',
      phone: (r.phone || '').trim() || preset?.phone || '',
      isActive: r.is_active === 1,
      createdAt: r.created_at,
    };
  });
}

export function createEmployeeCenterInDb(
  db: AppDatabase,
  params: {
    cityName: string;
    stateName?: string;
    centerCode?: string;
    officialAddress?: string;
    phone?: string;
  },
  actor: AuditActorContext = DEFAULT_SYSTEM_ACTOR
): { ok: true; center: EmployeeCenterRecord } | { ok: false; code: number; error: string } {
  const cityName = params.cityName.trim();
  if (!cityName) {
    return { ok: false, code: 400, error: 'City / Location name is required.' };
  }
  const existing = db
    .prepare(`SELECT id FROM Employee_Centers WHERE LOWER(city_name) = LOWER(?) LIMIT 1`)
    .get(cityName) as { id: string } | undefined;
  if (existing) {
    return { ok: false, code: 409, error: `Center "${cityName}" already exists.` };
  }

  const stateName = (params.stateName || 'India').trim();
  const centerCode = (
    params.centerCode?.trim() || cityName.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'IND'
  ).toUpperCase();
  const officialAddress = (params.officialAddress || '').trim();
  const phone = (params.phone || '').trim();
  const id = `ctr-${cityName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomBytes(2).toString('hex')}`;
  const nowIso = new Date().toISOString();

  db.prepare(
    `INSERT INTO Employee_Centers (id, city_name, state_name, center_code, official_address, phone, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
  ).run(id, cityName, stateName, centerCode, officialAddress, phone, nowIso);

  const created = listEmployeeCentersFromDb(db).find((c) => c.id === id)!;
  writeSystemAuditLog(db, {
    module: 'Settings',
    entityType: 'EmployeeCenter',
    entityId: created.id,
    action: 'CENTER_CREATED',
    actor,
    afterObj: created,
    details: `Added Employee Center ${created.name} (${created.stateRegion})`,
  });

  return { ok: true, center: created };
}

export function updateEmployeeCenterInDb(
  db: AppDatabase,
  id: string,
  params: {
    cityName?: string;
    stateName?: string;
    centerCode?: string;
    officialAddress?: string;
    phone?: string;
  },
  actor: AuditActorContext = DEFAULT_SYSTEM_ACTOR
): { ok: true; center: EmployeeCenterRecord } | { ok: false; code: number; error: string } {
  const existing = listEmployeeCentersFromDb(db).find((c) => c.id === id);
  if (!existing) {
    return { ok: false, code: 404, error: 'Employee Center not found.' };
  }
  const nextCity = (params.cityName ?? existing.name).trim();
  if (!nextCity) {
    return { ok: false, code: 400, error: 'City / Location name cannot be empty.' };
  }
  const nextState = (params.stateName ?? existing.stateRegion).trim() || 'India';
  const nextCode = (params.centerCode ?? existing.centerCode ?? 'IND').trim().toUpperCase();
  const nextAddress = (params.officialAddress ?? existing.officialAddress ?? '').trim();
  const nextPhone = (params.phone ?? existing.phone ?? '').trim();

  db.prepare(
    `UPDATE Employee_Centers
     SET city_name = ?, state_name = ?, center_code = ?, official_address = ?, phone = ?
     WHERE id = ?`
  ).run(nextCity, nextState, nextCode, nextAddress, nextPhone, id);

  const updated = listEmployeeCentersFromDb(db).find((c) => c.id === id)!;
  writeSystemAuditLog(db, {
    module: 'Settings',
    entityType: 'EmployeeCenter',
    entityId: id,
    action: 'CENTER_UPDATED',
    actor,
    beforeObj: existing,
    afterObj: updated,
    details: `Updated Employee Center ${updated.name} office address/details`,
  });

  return { ok: true, center: updated };
}

export function bulkImportEmployeeCentersInDb(
  db: AppDatabase,
  rawText: string,
  replaceExisting = false,
  actor: AuditActorContext = DEFAULT_SYSTEM_ACTOR
): { addedCount: number; skippedCount: number; centers: EmployeeCenterRecord[] } {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let addedCount = 0;
  let skippedCount = 0;
  const nowIso = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    if (replaceExisting && lines.length > 0) {
      db.prepare(`DELETE FROM Employee_Centers`).run();
    }
    const findStmt = db.prepare(`SELECT id FROM Employee_Centers WHERE LOWER(city_name) = LOWER(?) LIMIT 1`);
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO Employee_Centers (id, city_name, state_name, center_code, is_active, created_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `);

    for (const line of lines) {
      const parts = line.split(',').map((p) => p.trim()).filter(Boolean);
      const cityName = parts[0];
      if (!cityName || cityName.toLowerCase() === 'city' || cityName.toLowerCase() === 'location') {
        continue;
      }
      if (findStmt.get(cityName)) {
        skippedCount++;
        continue;
      }
      const stateName = parts[1] || 'India';
      const centerCode = (
        parts[2] || cityName.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'IND'
      ).toUpperCase();
      const id = `ctr-${cityName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomBytes(2).toString('hex')}`;
      insertStmt.run(id, cityName, stateName, centerCode, nowIso);
      addedCount++;
    }

    writeSystemAuditLog(db, {
      module: 'Settings',
      entityType: 'EmployeeCenterBulk',
      entityId: 'centers-import',
      action: 'CENTERS_IMPORTED',
      actor,
      afterObj: { addedCount, skippedCount, replaceExisting },
      details: `Imported Indian Employee Centers: ${addedCount} added, ${skippedCount} skipped`,
    });

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { addedCount, skippedCount, centers: listEmployeeCentersFromDb(db) };
}

export function deleteEmployeeCenterInDb(
  db: AppDatabase,
  id: string,
  actor: AuditActorContext = DEFAULT_SYSTEM_ACTOR
): boolean {
  const existing = listEmployeeCentersFromDb(db).find((c) => c.id === id);
  if (!existing) return false;
  const res = db.prepare(`DELETE FROM Employee_Centers WHERE id = ?`).run(id);
  if (res.changes > 0) {
    writeSystemAuditLog(db, {
      module: 'Settings',
      entityType: 'EmployeeCenter',
      entityId: id,
      action: 'CENTER_DELETED',
      actor,
      beforeObj: existing,
      details: `Deleted Employee Center ${existing.name}`,
    });
    return true;
  }
  return false;
}

// =========================================================================
// EMPLOYEE POLICIES MODULE (PDF DOCUMENTS + VERSION CONTROL)
// =========================================================================

interface RawPolicyRow {
  id: string;
  category: string;
  title: string;
  description: string;
  version: string;
  file_name: string;
  mime_type: string;
  content_base64: string;
  file_size: number;
  uploaded_by: string;
  uploaded_at: string;
  updated_at: string;
  history_json: string;
  visible_roles_json?: string;
}

function mapPolicyRow(r: RawPolicyRow): PolicyDocumentRecord {
  return {
    id: r.id,
    category: (r.category || 'HR Policy') as PolicyCategory,
    title: r.title,
    description: r.description || '',
    version: r.version,
    fileName: r.file_name,
    mimeType: r.mime_type || 'application/pdf',
    fileSize: Number(r.file_size) || 0,
    uploadedBy: r.uploaded_by,
    uploadedAt: r.uploaded_at,
    updatedAt: r.updated_at,
    history: parsePolicyHistory(r.history_json),
    visibleRoles: parseVisibleRoles(r.visible_roles_json),
  };
}

export function resolveUserEmploymentCategory(user: SessionUser): EmploymentCategory {
  if (user.entityType) return user.entityType;
  if (
    user.role === 'Consultant' ||
    user.role === 'Retainer' ||
    user.role === 'Freelancer' ||
    user.role === 'Young Research Program' ||
    user.role === 'Intern'
  ) {
    return user.role;
  }
  return 'Employee';
}

export function canUserViewPolicy(
  user: SessionUser,
  policy: Pick<PolicyDocumentRecord, 'visibleRoles'>
): boolean {
  const isPrivileged =
    isAdminRole(user.role) || user.role === 'HR Manager' || user.permissions?.includes('role.manage');
  return canRoleCategoryViewPolicy(policy.visibleRoles, resolveUserEmploymentCategory(user), Boolean(isPrivileged));
}

export function listPoliciesFromDb(db: AppDatabase): PolicyDocumentRecord[] {
  const rows = db
    .prepare(
      `SELECT id, category, title, description, version, file_name, mime_type,
              '' as content_base64, file_size, uploaded_by, uploaded_at, updated_at, history_json, visible_roles_json
       FROM Policies
       ORDER BY CASE category WHEN 'HR Policy' THEN 0 WHEN 'POSH Policy' THEN 1 WHEN 'IT Policy' THEN 2 ELSE 3 END, updated_at DESC`
    )
    .all() as unknown as RawPolicyRow[];
  return rows.map(mapPolicyRow);
}

export function getPolicyByIdFromDb(db: AppDatabase, id: string): PolicyDocumentRecord | null {
  const row = db
    .prepare(
      `SELECT id, category, title, description, version, file_name, mime_type,
              '' as content_base64, file_size, uploaded_by, uploaded_at, updated_at, history_json, visible_roles_json
       FROM Policies WHERE id = ? LIMIT 1`
    )
    .get(id) as unknown as RawPolicyRow | undefined;
  return row ? mapPolicyRow(row) : null;
}

export function getPolicyPdfBufferFromDb(
  db: AppDatabase,
  id: string
): { buffer: Buffer; fileName: string; title: string } | null {
  const row = db
    .prepare(`SELECT title, file_name, content_base64 FROM Policies WHERE id = ? LIMIT 1`)
    .get(id) as { title: string; file_name: string; content_base64: string } | undefined;
  if (!row || !row.content_base64) return null;
  const cleaned = row.content_base64.replace(/^data:application\/pdf;base64,/, '').trim();
  return {
    buffer: Buffer.from(cleaned, 'base64'),
    fileName: row.file_name || 'policy.pdf',
    title: row.title || 'Policy Document',
  };
}

export function createPolicyInDb(
  db: AppDatabase,
  params: {
    category: string;
    title: string;
    description?: string;
    version?: string;
    fileName: string;
    contentBase64: string;
    notes?: string;
    uploadedBy: string;
    visibleRoles?: EmploymentCategory[];
  },
  actor: AuditActorContext = DEFAULT_SYSTEM_ACTOR
): { ok: true; policy: PolicyDocumentRecord } | { ok: false; code: number; error: string } {
  const title = params.title.trim();
  const category = (params.category || 'HR Policy').trim();
  const fileName = params.fileName.trim() || `${category.replace(/\s+/g, '-')}.pdf`;
  const cleanedB64 = params.contentBase64.replace(/^data:application\/pdf;base64,/, '').trim();

  if (!title) {
    return { ok: false, code: 400, error: 'Policy title is required.' };
  }
  if (!isValidPdfBase64(cleanedB64)) {
    return { ok: false, code: 400, error: 'Please upload a valid PDF document (%PDF header required).' };
  }

  const fileSize = Buffer.from(cleanedB64, 'base64').length;
  const version = (params.version || '1.0').trim().replace(/^v/i, '') || '1.0';
  const nowIso = new Date().toISOString();
  const id = `pol-${crypto.randomUUID().slice(0, 8)}`;
  const visibleRoles = parseVisibleRoles(params.visibleRoles);
  const history: PolicyVersionHistoryEntry[] = [
    {
      version,
      fileName,
      fileSize,
      uploadedBy: params.uploadedBy,
      uploadedAt: nowIso,
      notes: params.notes?.trim() || 'Uploaded policy PDF',
    },
  ];

  db.prepare(
    `INSERT INTO Policies (
      id, category, title, description, version, file_name, mime_type,
      content_base64, file_size, uploaded_by, uploaded_at, updated_at, history_json, visible_roles_json
    ) VALUES (?, ?, ?, ?, ?, ?, 'application/pdf', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    category,
    title,
    (params.description || '').trim(),
    version,
    fileName,
    cleanedB64,
    fileSize,
    params.uploadedBy,
    nowIso,
    nowIso,
    JSON.stringify(history),
    JSON.stringify(visibleRoles)
  );

  const created = getPolicyByIdFromDb(db, id)!;
  writeSystemAuditLog(db, {
    module: 'Settings',
    entityType: 'Policy',
    entityId: created.id,
    action: 'POLICY_UPLOADED',
    actor,
    afterObj: {
      id: created.id,
      category: created.category,
      title: created.title,
      version: created.version,
      visibleRoles: created.visibleRoles,
    },
    details: `Uploaded ${created.category}: ${created.title} (v${created.version})`,
  });

  return { ok: true, policy: created };
}

export function updatePolicyInDb(
  db: AppDatabase,
  id: string,
  params: {
    category?: string;
    title?: string;
    description?: string;
    fileName?: string;
    contentBase64?: string;
    versionBump?: 'minor' | 'major';
    notes?: string;
    updatedBy: string;
    visibleRoles?: EmploymentCategory[];
  },
  actor: AuditActorContext = DEFAULT_SYSTEM_ACTOR
): { ok: true; policy: PolicyDocumentRecord } | { ok: false; code: number; error: string } {
  const existingRow = db.prepare(`SELECT * FROM Policies WHERE id = ? LIMIT 1`).get(id) as
    | RawPolicyRow
    | undefined;
  if (!existingRow) {
    return { ok: false, code: 404, error: 'Policy document not found.' };
  }

  const nowIso = new Date().toISOString();
  const nextTitle = params.title !== undefined ? params.title.trim() || existingRow.title : existingRow.title;
  const nextCategory = params.category !== undefined ? params.category.trim() || existingRow.category : existingRow.category;
  const nextDesc = params.description !== undefined ? params.description.trim() : existingRow.description;
  const nextVisibleRoles =
    params.visibleRoles !== undefined
      ? parseVisibleRoles(params.visibleRoles)
      : parseVisibleRoles(existingRow.visible_roles_json);

  let nextB64 = existingRow.content_base64;
  let nextFileName = existingRow.file_name;
  let nextFileSize = existingRow.file_size;
  let nextVersion = existingRow.version;
  let nextUploadedBy = existingRow.uploaded_by;
  let nextUploadedAt = existingRow.uploaded_at;
  const history = parsePolicyHistory(existingRow.history_json);

  if (params.contentBase64 && params.contentBase64.trim()) {
    const cleanedB64 = params.contentBase64.replace(/^data:application\/pdf;base64,/, '').trim();
    if (!isValidPdfBase64(cleanedB64)) {
      return { ok: false, code: 400, error: 'Replacement file must be a valid PDF document.' };
    }
    nextB64 = cleanedB64;
    nextFileName = params.fileName?.trim() || existingRow.file_name;
    nextFileSize = Buffer.from(cleanedB64, 'base64').length;
    nextVersion = bumpPolicyVersion(existingRow.version, params.versionBump || 'minor');
    nextUploadedBy = params.updatedBy;
    nextUploadedAt = nowIso;
    history.unshift({
      version: nextVersion,
      fileName: nextFileName,
      fileSize: nextFileSize,
      uploadedBy: params.updatedBy,
      uploadedAt: nowIso,
      notes: params.notes?.trim() || `Replaced PDF (v${nextVersion})`,
    });
  } else if (params.notes?.trim() || nextTitle !== existingRow.title || nextDesc !== existingRow.description) {
    nextVersion = bumpPolicyVersion(existingRow.version, params.versionBump || 'minor');
    nextUploadedBy = params.updatedBy;
    history.unshift({
      version: nextVersion,
      fileName: nextFileName,
      fileSize: nextFileSize,
      uploadedBy: params.updatedBy,
      uploadedAt: nowIso,
      notes: params.notes?.trim() || 'Updated policy metadata',
    });
  }

  db.prepare(
    `UPDATE Policies
     SET category = ?, title = ?, description = ?, version = ?, file_name = ?,
         content_base64 = ?, file_size = ?, uploaded_by = ?, uploaded_at = ?, updated_at = ?, history_json = ?, visible_roles_json = ?
     WHERE id = ?`
  ).run(
    nextCategory,
    nextTitle,
    nextDesc,
    nextVersion,
    nextFileName,
    nextB64,
    nextFileSize,
    nextUploadedBy,
    nextUploadedAt,
    nowIso,
    JSON.stringify(history),
    JSON.stringify(nextVisibleRoles),
    id
  );

  const updated = getPolicyByIdFromDb(db, id)!;
  writeSystemAuditLog(db, {
    module: 'Settings',
    entityType: 'Policy',
    entityId: updated.id,
    action: params.contentBase64 ? 'POLICY_REPLACED' : 'POLICY_UPDATED',
    actor,
    beforeObj: { id: existingRow.id, version: existingRow.version, fileName: existingRow.file_name },
    afterObj: { id: updated.id, version: updated.version, fileName: updated.fileName, visibleRoles: updated.visibleRoles },
    details: `${params.contentBase64 ? 'Replaced PDF' : 'Updated'} policy ${updated.title} (${updated.category}) -> v${updated.version}`,
  });

  return { ok: true, policy: updated };
}

export function deletePolicyInDb(
  db: AppDatabase,
  id: string,
  actor: AuditActorContext = DEFAULT_SYSTEM_ACTOR
): boolean {
  const existing = getPolicyByIdFromDb(db, id);
  if (!existing) return false;
  const res = db.prepare(`DELETE FROM Policies WHERE id = ?`).run(id);
  if (res.changes > 0) {
    writeSystemAuditLog(db, {
      module: 'Settings',
      entityType: 'Policy',
      entityId: id,
      action: 'POLICY_DELETED',
      actor,
      beforeObj: { id: existing.id, category: existing.category, title: existing.title, version: existing.version },
      details: `Deleted policy ${existing.title} (${existing.category}, v${existing.version})`,
    });
    return true;
  }
  return false;
}

export function listPolicyAcknowledgmentsFromDb(
  db: AppDatabase,
  policyId?: string
): PolicyAcknowledgmentRecord[] {
  const rows = (policyId
    ? db
        .prepare(`SELECT * FROM Policy_Acknowledgments WHERE policy_id = ? ORDER BY acknowledged_at DESC`)
        .all(policyId)
    : db
        .prepare(`SELECT * FROM Policy_Acknowledgments ORDER BY acknowledged_at DESC`)
        .all()) as Array<{
    id: string;
    policy_id: string;
    policy_version: string;
    user_id: string;
    user_name: string;
    user_role: string;
    entity_type: string;
    entity_code: string;
    acknowledged_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    policyId: r.policy_id,
    policyVersion: r.policy_version,
    userId: r.user_id,
    userName: r.user_name,
    userRole: r.user_role,
    entityType: r.entity_type || undefined,
    entityCode: r.entity_code || undefined,
    acknowledgedAt: r.acknowledged_at,
  }));
}

export function acknowledgePolicyInDb(
  db: AppDatabase,
  policyId: string,
  user: SessionUser,
  actor: AuditActorContext = DEFAULT_SYSTEM_ACTOR
): { ok: true; acknowledgment: PolicyAcknowledgmentRecord } | { ok: false; code: number; error: string } {
  const policy = getPolicyByIdFromDb(db, policyId);
  if (!policy) {
    return { ok: false, code: 404, error: 'Policy document not found.' };
  }

  const nowIso = new Date().toISOString();
  const id = `ack-${crypto.randomUUID().slice(0, 8)}`;
  const entityType = user.entityType || user.role;
  const entityCode = user.entityId || user.employeeId || user.loginId;

  db.prepare(`
    INSERT INTO Policy_Acknowledgments (
      id, policy_id, policy_version, user_id, user_name, user_role, entity_type, entity_code, acknowledged_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(policy_id, policy_version, user_id) DO UPDATE SET
      user_name = excluded.user_name,
      user_role = excluded.user_role,
      entity_type = excluded.entity_type,
      entity_code = excluded.entity_code,
      acknowledged_at = excluded.acknowledged_at
  `).run(
    id,
    policy.id,
    policy.version,
    user.id,
    user.fullName,
    user.role,
    entityType,
    entityCode,
    nowIso
  );

  const row = db
    .prepare(
      `SELECT * FROM Policy_Acknowledgments WHERE policy_id = ? AND policy_version = ? AND user_id = ? LIMIT 1`
    )
    .get(policy.id, policy.version, user.id) as {
    id: string;
    policy_id: string;
    policy_version: string;
    user_id: string;
    user_name: string;
    user_role: string;
    entity_type: string;
    entity_code: string;
    acknowledged_at: string;
  };

  const acknowledgment: PolicyAcknowledgmentRecord = {
    id: row.id,
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    userId: row.user_id,
    userName: row.user_name,
    userRole: row.user_role,
    entityType: row.entity_type || undefined,
    entityCode: row.entity_code || undefined,
    acknowledgedAt: row.acknowledged_at,
  };

  writeSystemAuditLog(db, {
    module: 'Settings',
    entityType: 'PolicyAcknowledgment',
    entityId: policy.id,
    action: 'POLICY_ACKNOWLEDGED',
    actor,
    afterObj: acknowledgment,
    details: `${user.fullName} (${user.role}) acknowledged ${policy.category}: ${policy.title} v${policy.version}`,
  });

  return { ok: true, acknowledgment };
}

// =========================================================================
// NEW USER MODULES (CONSULTANT, RETAINER, FREELANCER/FLP, YRP, INTERN)
// =========================================================================

const ENTITY_TYPE_TO_ROLE_ID: Record<PersonnelEntityType, string> = {
  Consultant: 'role_consultant',
  Retainer: 'role_retainer',
  Freelancer: 'role_freelancer',
  'Young Research Program': 'role_yrp',
  Intern: 'role_intern',
};

function mapPersonnelEntityRow(r: Record<string, unknown>): PersonnelEntity {
  return {
    id: String(r.id),
    entityCode: String(r.entity_code),
    entityType: String(r.entity_type) as PersonnelEntityType,
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
    profileId: r.profile_id ? String(r.profile_id) : `PRF-${String(r.id)}`,
  };
}

export function listPersonnelEntitiesFromDb(
  db: AppDatabase,
  entityType?: PersonnelEntityType
): PersonnelEntity[] {
  if (!tableExists(db, 'Personnel_Entities')) return [];
  const rows = (entityType
    ? db
        .prepare(`SELECT * FROM Personnel_Entities WHERE entity_type = ? ORDER BY entity_code ASC`)
        .all(entityType)
    : db
        .prepare(`SELECT * FROM Personnel_Entities ORDER BY entity_type ASC, entity_code ASC`)
        .all()) as Array<Record<string, unknown>>;
  return rows.map(mapPersonnelEntityRow);
}

export function createPersonnelEntityInDb(
  db: AppDatabase,
  input: Omit<PersonnelEntity, 'id' | 'createdAt'> & { id?: string; password?: string },
  actor: AuditActorContext = DEFAULT_SYSTEM_ACTOR
): { ok: true; entity: PersonnelEntity; user?: SessionUser } | { ok: false; code: number; error: string } {
  const existingEntities = listPersonnelEntitiesFromDb(db);
  const existingEmployees = listEmployeesFromDb(db);

  if (!PERSONNEL_ENTITY_TYPES.includes(input.entityType)) {
    return { ok: false, code: 400, error: 'Invalid personnel module type.' };
  }

  const check = validatePersonnelEntityInput({
    entityType: input.entityType,
    entityCode: input.entityCode,
    name: input.name,
    email: input.email || input.officialEmail || input.personalEmail || '',
    phone: input.phone,
    aadhaarCard: input.aadhaarCard,
    panCard: input.panCard,
    existingEntities,
    existingEmployees,
  });

  if (!check.ok) {
    const isConflict = check.error.toLowerCase().includes('already') || check.error.toLowerCase().includes('conflict');
    return { ok: false, code: isConflict ? 409 : 400, error: check.error };
  }

  const code = check.normalizedCode;
  const id = code;
  const nowIso = new Date().toISOString();
  const resolvedCenter = normalizeCenterName(input.center || 'Kolkata');
  const resolvedEmail = (input.email || input.officialEmail || input.personalEmail || '').trim();
  const canBeMgr = input.entityType === 'Consultant' && Boolean(input.isManager);
  const profileId = (input.profileId || `PRF-${id}`).trim();

  const rawPassword = typeof input.password === 'string' ? input.password : '';
  if (rawPassword) {
    const existingUsers = listUsersWithPermissions(db);
    if (existingUsers.some((u) => u.loginId.toLowerCase() === code.toLowerCase())) {
      return { ok: false, code: 409, error: `Login ID "${code}" already exists in User accounts.` };
    }
    if (resolvedEmail && existingUsers.some((u) => u.email.toLowerCase() === resolvedEmail.toLowerCase())) {
      return { ok: false, code: 409, error: `Email "${resolvedEmail}" is already registered to a User login.` };
    }
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO Personnel_Entities (
        id, entity_code, entity_type, name, email, personal_email, official_email,
        phone, whatsapp_no, father_husband_name, address, center, department, designation,
        is_manager, reporting_manager_id, reporting_manager_name, reporting_manager_email,
        aadhaar_card, pan_card, project_name, project_no, eic_name,
        bank_name, bank_branch, bank_account_type, bank_account_no, ifsc_code,
        joining_date, status, remarks, created_at, profile_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      code,
      input.entityType,
      input.name.trim(),
      resolvedEmail,
      (input.personalEmail || '').trim(),
      (input.officialEmail || resolvedEmail).trim(),
      (input.phone || '').trim(),
      (input.whatsappNo || '').trim(),
      (input.fatherHusbandName || '').trim(),
      (input.address || '').trim(),
      resolvedCenter,
      (input.department || (input.entityType === 'Freelancer' ? 'Field Operations' : 'Research')).trim(),
      (input.designation || input.entityType).trim(),
      canBeMgr ? 1 : 0,
      (input.reportingManagerId || '').trim(),
      (input.reportingManagerName || '').trim(),
      (input.reportingManagerEmail || '').trim(),
      (input.aadhaarCard || '').replace(/\s+/g, ''),
      (input.panCard || '').trim().toUpperCase(),
      (input.projectName || '').trim(),
      (input.projectNo || '').trim(),
      (input.eicName || '').trim(),
      (input.bankName || '').trim(),
      (input.bankBranch || '').trim(),
      (input.bankAccountType || 'Savings').trim(),
      (input.bankAccountNo || '').trim(),
      (input.ifscCode || '').trim().toUpperCase(),
      (input.joiningDate || '').trim(),
      input.status === 'Inactive' ? 'Inactive' : 'Active',
      (input.remarks || '').trim(),
      nowIso,
      profileId
    );

    const created = listPersonnelEntitiesFromDb(db).find((e) => e.id === id)!;
    writeSystemAuditLog(db, {
      module: 'Personnel',
      entityType: input.entityType,
      entityId: created.id,
      action: 'ENTITY_CREATED',
      actor,
      beforeObj: null,
      afterObj: created,
      details: `Created ${input.entityType} ${created.name} (${created.entityCode})`,
    });

    db.exec('COMMIT');

    let createdUser: SessionUser | undefined;
    if (rawPassword && resolvedEmail) {
      createdUser = createUserInDb(db, {
        loginId: code,
        password: rawPassword,
        fullName: created.name,
        email: resolvedEmail,
        roleId: ENTITY_TYPE_TO_ROLE_ID[created.entityType],
        employeeId: created.id,
        department: created.department,
        active: created.status === 'Active',
      });
    }

    return { ok: true, entity: created, user: createdUser };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function updatePersonnelEntityInDb(
  db: AppDatabase,
  id: string,
  patch: Partial<PersonnelEntity> & { password?: string },
  actor: AuditActorContext = DEFAULT_SYSTEM_ACTOR
):
  | { ok: true; entity: PersonnelEntity; passwordUpdated?: boolean; userAccountCreated?: boolean }
  | { ok: false; code: number; error: string } {
  if (
    patch.password !== undefined &&
    patch.password !== null &&
    typeof patch.password !== 'string'
  ) {
    return { ok: false, code: 400, error: 'Password must be a valid string.' };
  }
  const rawPassword = typeof patch.password === 'string' ? patch.password : '';
  if (rawPassword.length > 0) {
    const pwErr = validatePasswordStrength(rawPassword);
    if (pwErr) {
      return { ok: false, code: 400, error: pwErr };
    }
  }
  const { password: _ignoredPassword, ...cleanPatch } = patch;

  const existingEntities = listPersonnelEntitiesFromDb(db);
  const existingEmployees = listEmployeesFromDb(db);
  const existing = existingEntities.find(
    (e) => e.id === id || e.entityCode.toUpperCase() === id.trim().toUpperCase()
  );
  if (!existing) {
    return { ok: false, code: 404, error: 'Personnel record not found.' };
  }

  const nextCodeRaw = cleanPatch.entityCode ?? existing.entityCode;
  const idCheck = validateEntityId({
    rawId: nextCodeRaw,
    existingEntities,
    existingEmployees,
    excludeEntityId: existing.id,
  });
  if (!idCheck.valid) {
    const isConflict = idCheck.error.toLowerCase().includes('already') || idCheck.error.toLowerCase().includes('conflict');
    return { ok: false, code: isConflict ? 409 : 400, error: idCheck.error };
  }

  const nextIsManager =
    existing.entityType === 'Consultant'
      ? typeof cleanPatch.isManager === 'boolean'
        ? cleanPatch.isManager
        : existing.isManager
      : false;

  const nextEmail = (cleanPatch.email ?? existing.email).trim();
  const nextOfficialEmail = (cleanPatch.officialEmail ?? existing.officialEmail ?? '').trim();
  const nextPersonalEmail = (cleanPatch.personalEmail ?? existing.personalEmail ?? '').trim();

  const updated: PersonnelEntity = {
    ...existing,
    ...cleanPatch,
    id: existing.id,
    entityType: existing.entityType,
    entityCode: idCheck.normalizedId,
    name: (cleanPatch.name ?? existing.name).trim(),
    email: nextEmail,
    personalEmail: nextPersonalEmail,
    officialEmail: nextOfficialEmail,
    phone: (cleanPatch.phone ?? existing.phone ?? '').trim(),
    whatsappNo: (cleanPatch.whatsappNo ?? existing.whatsappNo ?? '').trim(),
    fatherHusbandName: (cleanPatch.fatherHusbandName ?? existing.fatherHusbandName ?? '').trim(),
    address: (cleanPatch.address ?? existing.address ?? '').trim(),
    center: normalizeCenterName(cleanPatch.center ?? existing.center),
    department: (cleanPatch.department ?? existing.department).trim(),
    designation: (cleanPatch.designation ?? existing.designation).trim(),
    isManager: nextIsManager,
    aadhaarCard: (cleanPatch.aadhaarCard ?? existing.aadhaarCard ?? '').replace(/\s+/g, ''),
    panCard: (cleanPatch.panCard ?? existing.panCard ?? '').trim().toUpperCase(),
    projectName: (cleanPatch.projectName ?? existing.projectName ?? '').trim(),
    projectNo: (cleanPatch.projectNo ?? existing.projectNo ?? '').trim(),
    eicName: (cleanPatch.eicName ?? existing.eicName ?? '').trim(),
    bankName: (cleanPatch.bankName ?? existing.bankName ?? '').trim(),
    bankBranch: (cleanPatch.bankBranch ?? existing.bankBranch ?? '').trim(),
    bankAccountType: (cleanPatch.bankAccountType ?? existing.bankAccountType ?? 'Savings').trim(),
    bankAccountNo: (cleanPatch.bankAccountNo ?? existing.bankAccountNo ?? '').trim(),
    ifscCode: (cleanPatch.ifscCode ?? existing.ifscCode ?? '').trim().toUpperCase(),
    joiningDate: (cleanPatch.joiningDate ?? existing.joiningDate ?? '').trim(),
    status: cleanPatch.status === 'Inactive' ? 'Inactive' : cleanPatch.status === 'Active' ? 'Active' : existing.status,
    remarks: (cleanPatch.remarks ?? existing.remarks ?? '').trim(),
  };

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      UPDATE Personnel_Entities SET
        entity_code = ?, name = ?, email = ?, personal_email = ?, official_email = ?,
        phone = ?, whatsapp_no = ?, father_husband_name = ?, address = ?, center = ?,
        department = ?, designation = ?, is_manager = ?,
        reporting_manager_id = ?, reporting_manager_name = ?, reporting_manager_email = ?,
        aadhaar_card = ?, pan_card = ?, project_name = ?, project_no = ?, eic_name = ?,
        bank_name = ?, bank_branch = ?, bank_account_type = ?, bank_account_no = ?, ifsc_code = ?,
        joining_date = ?, status = ?, remarks = ?
      WHERE id = ?
    `).run(
      updated.entityCode,
      updated.name,
      updated.email,
      updated.personalEmail || '',
      updated.officialEmail || '',
      updated.phone,
      updated.whatsappNo || '',
      updated.fatherHusbandName || '',
      updated.address || '',
      updated.center,
      updated.department,
      updated.designation,
      updated.isManager ? 1 : 0,
      updated.reportingManagerId || '',
      updated.reportingManagerName || '',
      updated.reportingManagerEmail || '',
      updated.aadhaarCard || '',
      updated.panCard || '',
      updated.projectName || '',
      updated.projectNo || '',
      updated.eicName || '',
      updated.bankName || '',
      updated.bankBranch || '',
      updated.bankAccountType || 'Savings',
      updated.bankAccountNo || '',
      updated.ifscCode || '',
      updated.joiningDate || '',
      updated.status,
      updated.remarks || '',
      existing.id
    );

    if (updated.isManager) {
      db.prepare(
        `UPDATE Employees
         SET reporting_manager_name = ?, reporting_manager_email = ?
         WHERE reporting_manager_id = ?`
      ).run(updated.name, updated.email, existing.id);
    }

    const saved = listPersonnelEntitiesFromDb(db).find((e) => e.id === existing.id)!;
    writeSystemAuditLog(db, {
      module: 'Personnel',
      entityType: saved.entityType,
      entityId: saved.id,
      action: 'ENTITY_UPDATED',
      actor,
      beforeObj: existing,
      afterObj: saved,
      details: `Updated ${saved.entityType} ${saved.name} (${saved.entityCode})`,
    });

    let passwordUpdated = false;
    let userAccountCreated = false;
    if (rawPassword.length > 0) {
      const syncRes = syncLinkedUserPasswordInActiveTx(db, {
        recordId: saved.id,
        previousCode: existing.entityCode,
        nextCode: saved.entityCode,
        entityTypeLabel: saved.entityType,
        fullName: saved.name,
        previousEmail: existing.officialEmail || existing.email || existing.personalEmail || '',
        nextEmail: saved.officialEmail || saved.email || saved.personalEmail || '',
        roleId: ENTITY_TYPE_TO_ROLE_ID[saved.entityType],
        department: saved.department,
        active: saved.status === 'Active',
        password: rawPassword,
        actor,
      });
      if (!syncRes.ok) {
        db.exec('ROLLBACK');
        return syncRes;
      }
      passwordUpdated = syncRes.passwordUpdated;
      userAccountCreated = syncRes.userAccountCreated;
    }

    db.exec('COMMIT');
    return { ok: true, entity: saved, passwordUpdated, userAccountCreated };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function toggleConsultantManagerInDb(
  db: AppDatabase,
  id: string,
  isManager: boolean,
  forceUnassign = false,
  actor: AuditActorContext = DEFAULT_SYSTEM_ACTOR
): { ok: true; entity: PersonnelEntity } | { ok: false; code: number; error: string; activeReportCount?: number } {
  const existingEntities = listPersonnelEntitiesFromDb(db);
  const existingEmployees = listEmployeesFromDb(db);
  const consultant = existingEntities.find(
    (e) => e.id === id || e.entityCode.toUpperCase() === id.trim().toUpperCase()
  );
  if (!consultant) {
    return { ok: false, code: 404, error: 'Consultant not found.' };
  }
  if (consultant.entityType !== 'Consultant') {
    return { ok: false, code: 400, error: 'Manager privileges can only be toggled for Consultants.' };
  }

  if (!isManager) {
    const check = validateRevokeConsultantManager({
      consultant,
      employees: existingEmployees,
      entities: existingEntities,
      forceUnassign,
    });
    if (!check.ok) {
      return {
        ok: false,
        code: 409,
        error: check.error,
        activeReportCount: check.activeReportCount,
      };
    }
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`UPDATE Personnel_Entities SET is_manager = ? WHERE id = ?`).run(
      isManager ? 1 : 0,
      consultant.id
    );
    if (!isManager && forceUnassign) {
      db.prepare(
        `UPDATE Employees
         SET reporting_manager_id = '', reporting_manager_name = '', reporting_manager_email = ''
         WHERE reporting_manager_id = ? OR reporting_manager_id = ?`
      ).run(consultant.id, consultant.entityCode);
    }

    const updated = listPersonnelEntitiesFromDb(db).find((e) => e.id === consultant.id)!;
    writeSystemAuditLog(db, {
      module: 'Personnel',
      entityType: 'Consultant',
      entityId: consultant.id,
      action: isManager ? 'CONSULTANT_MANAGER_GRANTED' : 'CONSULTANT_MANAGER_REVOKED',
      actor,
      beforeObj: { isManager: consultant.isManager },
      afterObj: { isManager: updated.isManager, forceUnassign },
      details: `${isManager ? 'Granted' : 'Revoked'} Manager privileges for Consultant ${consultant.name} (${consultant.entityCode}) while preserving role = Consultant`,
    });

    db.exec('COMMIT');
    return { ok: true, entity: updated };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function deletePersonnelEntityInDb(
  db: AppDatabase,
  id: string,
  actor: AuditActorContext = DEFAULT_SYSTEM_ACTOR
): { ok: true } | { ok: false; code: number; error: string } {
  const existing = listPersonnelEntitiesFromDb(db).find(
    (e) => e.id === id || e.entityCode.toUpperCase() === id.trim().toUpperCase()
  );
  if (!existing) {
    return { ok: false, code: 404, error: 'Personnel record not found.' };
  }

  const activeAssignments = db
    .prepare(
      `SELECT COUNT(*) as c FROM Assignments WHERE (employee_id = ? OR employee_id = ?) AND status = 'Active'`
    )
    .get(existing.id, existing.entityCode) as { c: number };
  if (activeAssignments.c > 0) {
    return {
      ok: false,
      code: 409,
      error: `Cannot delete ${existing.name} (${existing.entityCode}): active asset assignment(s) exist. Return assets first.`,
    };
  }

  const directReports = (
    db
      .prepare(`SELECT COUNT(*) as c FROM Employees WHERE reporting_manager_id = ? OR reporting_manager_id = ?`)
      .get(existing.id, existing.entityCode) as { c: number }
  ).c;
  if (directReports > 0) {
    return {
      ok: false,
      code: 409,
      error: `Cannot delete ${existing.name}: ${directReports} employee(s) currently report to this manager.`,
    };
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`DELETE FROM Personnel_Entities WHERE id = ?`).run(existing.id);
    writeSystemAuditLog(db, {
      module: 'Personnel',
      entityType: existing.entityType,
      entityId: existing.id,
      action: 'ENTITY_DELETED',
      actor,
      beforeObj: existing,
      details: `Deleted ${existing.entityType} ${existing.name} (${existing.entityCode})`,
    });
    db.exec('COMMIT');
    return { ok: true };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function assignTeamMembersToManagerInDb(
  db: AppDatabase,
  params: {
    managerId: string;
    addEmployeeIds?: string[];
    removeEmployeeIds?: string[];
  },
  actor: AuditActorContext = DEFAULT_SYSTEM_ACTOR
): { ok: true; updatedCount: number } | { ok: false; code: number; error: string } {
  const allEmployees = listEmployeesFromDb(db);
  const allEntities = listPersonnelEntitiesFromDb(db);
  const empMgr = allEmployees.find(
    (e) => e.id === params.managerId || e.employeeId === params.managerId
  );
  const conMgr = !empMgr
    ? allEntities.find(
        (e) => e.id === params.managerId || e.entityCode.toUpperCase() === params.managerId.trim().toUpperCase()
      )
    : undefined;

  if (!empMgr && !conMgr) {
    return { ok: false, code: 404, error: 'Manager profile not found.' };
  }
  if (empMgr && !empMgr.isManager) {
    return { ok: false, code: 400, error: `${empMgr.name} does not have Manager privileges.` };
  }
  if (conMgr && (conMgr.entityType !== 'Consultant' || !conMgr.isManager)) {
    return { ok: false, code: 400, error: `${conMgr.name} does not have Consultant Manager privileges.` };
  }

  const mgrId = empMgr?.id || conMgr!.id;
  const mgrName = empMgr?.name || conMgr!.name;
  const mgrEmail = empMgr?.email || conMgr!.email;

  const toAdd = Array.isArray(params.addEmployeeIds) ? params.addEmployeeIds : [];
  const toRemove = Array.isArray(params.removeEmployeeIds) ? params.removeEmployeeIds : [];

  for (const empId of toAdd) {
    const check = validateManagerMapping({
      employees: allEmployees,
      entities: allEntities,
      employeeId: empId,
      reportingManagerId: mgrId,
    });
    if (!check.ok) {
      return { ok: false, code: 400, error: check.error };
    }
  }

  let updatedCount = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    const setStmt = db.prepare(
      `UPDATE Employees
       SET reporting_manager_id = ?, reporting_manager_name = ?, reporting_manager_email = ?
       WHERE id = ? OR employee_id = ?`
    );
    const clrStmt = db.prepare(
      `UPDATE Employees
       SET reporting_manager_id = '', reporting_manager_name = '', reporting_manager_email = ''
       WHERE (id = ? OR employee_id = ?) AND reporting_manager_id = ?`
    );

    for (const empId of toAdd) {
      const res = setStmt.run(mgrId, mgrName, mgrEmail, empId, empId);
      updatedCount += Number(res.changes || 0);
    }
    for (const empId of toRemove) {
      const res = clrStmt.run(empId, empId, mgrId);
      updatedCount += Number(res.changes || 0);
    }

    writeSystemAuditLog(db, {
      module: 'Personnel',
      entityType: 'TeamMapping',
      entityId: mgrId,
      action: 'TEAM_UPDATED',
      actor,
      afterObj: { managerId: mgrId, addEmployeeIds: toAdd, removeEmployeeIds: toRemove },
      details: `Updated team roster for ${mgrName} (${mgrId}): +${toAdd.length} / -${toRemove.length}`,
    });

    db.exec('COMMIT');
    return { ok: true, updatedCount };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function updateUserThemePreferenceInDb(
  db: AppDatabase,
  userId: string,
  themePreference: string
): SessionUser | null {
  db.prepare(`UPDATE Users SET theme_preference = ? WHERE id = ?`).run(
    themePreference.trim(),
    userId
  );
  return getSessionUserById(db, userId);
}

export function bulkImportPersonnelEntitiesInDb(
  db: AppDatabase,
  params: {
    csvText: string;
    entityType: PersonnelEntityType;
    duplicatePolicy?: DirectoryDuplicatePolicy;
    actor?: AuditActorContext;
  }
): BulkDirectoryImportResult & { entities: PersonnelEntity[] } {
  const actor = params.actor || DEFAULT_SYSTEM_ACTOR;
  const duplicatePolicy: DirectoryDuplicatePolicy = params.duplicatePolicy || 'skip';
  const existingEntities = listPersonnelEntitiesFromDb(db);
  const existingEmployees = listEmployeesFromDb(db);
  const plan = buildPersonnelImportPlan({
    csvText: params.csvText,
    entityType: params.entityType,
    existingEntities,
    existingEmployees,
    duplicatePolicy,
  });

  const byCode = new Map(existingEntities.map((e) => [e.entityCode.toUpperCase(), e]));
  const errors = [...plan.errors];
  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = plan.errors.filter((e) => e.reason.startsWith('Skipped:')).length;
  const nowIso = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    const insertStmt = db.prepare(`
      INSERT INTO Personnel_Entities (
        id, entity_code, entity_type, name, email, personal_email, official_email,
        phone, whatsapp_no, father_husband_name, address, center, department, designation,
        is_manager, reporting_manager_id, reporting_manager_name, reporting_manager_email,
        aadhaar_card, pan_card, project_name, project_no, eic_name,
        bank_name, bank_branch, bank_account_type, bank_account_no, ifsc_code,
        joining_date, status, remarks, created_at, profile_id
      ) VALUES (?, ?, ?, ?, ?, '', ?, ?, '', '', ?, ?, ?, ?, 0, '', ?, ?, ?, ?, ?, ?, '', '', '', 'Savings', '', '', ?, ?, '', ?, ?)
    `);
    const updateStmt = db.prepare(`
      UPDATE Personnel_Entities SET
        name = ?, email = ?, official_email = ?, phone = ?, address = ?,
        center = ?, department = ?, designation = ?, aadhaar_card = ?, pan_card = ?,
        project_name = ?, project_no = ?, reporting_manager_name = ?, reporting_manager_email = ?,
        joining_date = ?, status = ?
      WHERE id = ?
    `);

    for (const row of plan.validRows) {
      const normalizedCenter = normalizeCenterName(row.center || 'Kolkata');
      const existing = byCode.get(row.entityCode.toUpperCase());
      if (existing) {
        if (duplicatePolicy === 'update') {
          updateStmt.run(
            row.name,
            row.email,
            row.email,
            row.phone,
            row.address,
            normalizedCenter,
            row.department,
            row.designation,
            row.aadhaarCard.replace(/\s+/g, ''),
            row.panCard.toUpperCase(),
            row.projectName,
            row.jobNumber,
            row.reportingManagerName,
            row.reportingManagerEmail,
            row.joiningDate,
            row.status,
            existing.id
          );
          updatedCount++;
        } else {
          skippedCount++;
          errors.push({
            rowNumber: row.rowNumber,
            code: row.entityCode,
            name: row.name,
            reason: `Skipped: Code "${row.entityCode}" already exists.`,
          });
        }
        continue;
      }

      const code = row.entityCode.toUpperCase();
      insertStmt.run(
        code,
        code,
        params.entityType,
        row.name,
        row.email,
        row.email,
        row.phone,
        row.address,
        normalizedCenter,
        row.department,
        row.designation,
        row.reportingManagerName,
        row.reportingManagerEmail,
        row.aadhaarCard.replace(/\s+/g, ''),
        row.panCard.toUpperCase(),
        row.projectName,
        row.jobNumber,
        row.joiningDate,
        row.status,
        nowIso,
        `PRF-${code}`
      );
      createdCount++;
    }

    const failedCount = errors.filter((e) => !e.reason.startsWith('Skipped:')).length;

    writeSystemAuditLog(db, {
      module: 'Personnel',
      entityType: params.entityType,
      entityId: 'bulk-import',
      action: 'ENTITY_BULK_IMPORTED',
      actor,
      afterObj: {
        entityType: params.entityType,
        totalRows: plan.totalRows,
        createdCount,
        updatedCount,
        skippedCount,
        failedCount,
      },
      details: `Bulk imported ${params.entityType}: ${createdCount} created, ${updatedCount} updated, ${skippedCount} skipped, ${failedCount} failed`,
    });

    db.exec('COMMIT');
    return {
      directoryLabel: params.entityType,
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
      entities: listPersonnelEntitiesFromDb(db),
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function listEmploymentConversionsFromDb(db: AppDatabase): EmploymentConversionRecord[] {
  if (!tableExists(db, 'Employment_Conversions')) return [];
  const rows = db
    .prepare(`SELECT * FROM Employment_Conversions ORDER BY converted_at DESC LIMIT 200`)
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
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
  }));
}

const PERSONNEL_ROLE_IDS = new Set([
  'role_employee',
  'role_dept_manager',
  'role_consultant',
  'role_retainer',
  'role_freelancer',
  'role_yrp',
  'role_intern',
]);

export function convertEmploymentTypeInDb(
  db: AppDatabase,
  params: {
    sourceCategory: EmploymentCategory;
    sourceId: string;
    targetCategory: EmploymentCategory;
    newCode?: string;
    department?: string;
    designation?: string;
    reason?: string;
  },
  actor: AuditActorContext = DEFAULT_SYSTEM_ACTOR
):
  | {
      ok: true;
      conversion: EmploymentConversionRecord;
      targetId: string;
      targetCode: string;
    }
  | { ok: false; code: number; error: string } {
  const { sourceCategory, sourceId, targetCategory } = params;
  if (sourceCategory === targetCategory) {
    return { ok: false, code: 400, error: 'Target employment category must differ from current category.' };
  }

  const allEmployees = listEmployeesFromDb(db);
  const allEntities = listPersonnelEntitiesFromDb(db);

  let sourceEmp: Employee | undefined;
  let sourceEnt: PersonnelEntity | undefined;
  if (sourceCategory === 'Employee') {
    sourceEmp = allEmployees.find(
      (e) => e.id === sourceId || e.employeeId.toUpperCase() === sourceId.trim().toUpperCase()
    );
    if (!sourceEmp) {
      return { ok: false, code: 404, error: 'Source Employee record not found.' };
    }
  } else {
    sourceEnt = allEntities.find(
      (e) =>
        e.entityType === sourceCategory &&
        (e.id === sourceId || e.entityCode.toUpperCase() === sourceId.trim().toUpperCase())
    );
    if (!sourceEnt) {
      return { ok: false, code: 404, error: `Source ${sourceCategory} record not found.` };
    }
  }

  const fromId = sourceEmp?.id || sourceEnt!.id;
  const fromCode = sourceEmp?.employeeId || sourceEnt!.entityCode;
  const profileId = (sourceEmp?.profileId || sourceEnt?.profileId || `PRF-${fromId}`).trim();
  const personName = sourceEmp?.name || sourceEnt!.name;

  // Determine target ID/code
  let toCode = '';
  if (targetCategory === 'Employee') {
    const rawNew = (params.newCode || '').trim().toUpperCase();
    if (rawNew) {
      const candidate = /^\d{1,5}$/.test(rawNew) ? formatFiveDigitEmployeeId(rawNew) : rawNew;
      if (!/^[A-Z0-9-]{3,16}$/.test(candidate)) {
        return {
          ok: false,
          code: 400,
          error: 'Target Employee ID must be a 5-digit number or 3–16 alphanumeric code.',
        };
      }
      if (
        allEmployees.some((e) => e.id.toUpperCase() === candidate || e.employeeId.toUpperCase() === candidate)
      ) {
        return { ok: false, code: 409, error: `Employee ID "${candidate}" already exists.` };
      }
      toCode = candidate;
    } else {
      const existingEmpIds = allEmployees.flatMap((e) => [e.id, e.employeeId]);
      toCode = generateNextId('EMP', existingEmpIds, 4);
    }
  } else {
    const rawNew = normalizeEntityIdInput(params.newCode || '');
    if (rawNew) {
      if (!ENTITY_ID_REGEX.test(rawNew)) {
        return {
          ok: false,
          code: 400,
          error: 'Target code must contain only CAPITAL LETTERS (A-Z) and NUMBERS (0-9) up to 10 characters.',
        };
      }
      const dupEnt = allEntities.find((e) => e.entityCode.toUpperCase() === rawNew);
      const dupEmp = allEmployees.find(
        (e) => e.id !== fromId && (e.id.toUpperCase() === rawNew || e.employeeId.toUpperCase() === rawNew)
      );
      if (dupEnt || dupEmp) {
        return { ok: false, code: 409, error: `Code "${rawNew}" is already in use.` };
      }
      toCode = rawNew;
    } else {
      const prefixMap: Record<PersonnelEntityType, string> = {
        Consultant: 'CON',
        Retainer: 'RET',
        Freelancer: 'FRL',
        'Young Research Program': 'YRP',
        Intern: 'INT',
      };
      const prefix = prefixMap[targetCategory];
      const taken = new Set([
        ...allEntities.map((e) => e.entityCode.toUpperCase()),
        ...allEmployees.map((e) => e.employeeId.toUpperCase()),
      ]);
      let seq = 1;
      while (taken.has(`${prefix}${String(seq).padStart(4, '0')}`)) {
        seq++;
      }
      toCode = `${prefix}${String(seq).padStart(4, '0')}`;
    }
  }

  const toRecordId = toCode;
  const nowIso = new Date().toISOString();
  const nextDept = (params.department || sourceEmp?.department || sourceEnt?.department || 'Operations').trim();
  const nextDesig = (params.designation || sourceEmp?.designation || sourceEnt?.designation || targetCategory).trim();
  const nextCenter = normalizeCenterName(sourceEmp?.center || sourceEmp?.branch || sourceEnt?.center || 'Kolkata');
  const nextEmail = (sourceEmp?.officialEmail || sourceEmp?.email || sourceEnt?.officialEmail || sourceEnt?.email || '').trim();
  const nextPersonalEmail = (sourceEmp?.personalEmail || sourceEnt?.personalEmail || '').trim();
  const nextPhone = (sourceEmp?.phone || sourceEnt?.phone || '').trim();
  const nextAddress = (sourceEmp?.address || sourceEnt?.address || '').trim();
  const nextPan = (sourceEmp?.panCard || sourceEnt?.panCard || '').trim().toUpperCase();
  const nextAadhaar = (sourceEmp?.aadhaarCard || sourceEnt?.aadhaarCard || '').trim();
  const nextJoin = (sourceEmp?.joiningDate || sourceEnt?.joiningDate || '').trim();
  const nextStatus = (sourceEmp?.status || sourceEnt?.status || 'Active') as 'Active' | 'Inactive';
  const nextRemarks = (sourceEmp?.remarks || sourceEnt?.remarks || '').trim();
  const nextIsManager =
    targetCategory === 'Consultant' || targetCategory === 'Employee'
      ? Boolean(sourceEmp?.isManager || sourceEnt?.isManager)
      : false;
  const nextMgrId = (sourceEmp?.reportingManagerId || sourceEnt?.reportingManagerId || '').trim();
  const nextMgrName = (sourceEmp?.reportingManagerName || sourceEnt?.reportingManagerName || '').trim();
  const nextMgrEmail = (sourceEmp?.reportingManagerEmail || sourceEnt?.reportingManagerEmail || '').trim();

  const conversion: EmploymentConversionRecord = {
    id: `CNV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    profileId,
    fromType: sourceCategory,
    toType: targetCategory,
    fromCode,
    toCode,
    personName,
    reason: (params.reason || '').trim(),
    convertedBy: actor.userName,
    convertedAt: nowIso,
  };

  db.exec('BEGIN IMMEDIATE');
  try {
    if (targetCategory === 'Employee') {
      db.prepare(`
        INSERT INTO Employees (
          id, employee_id, name, email, personal_email, official_email,
          personal_email_verified, official_email_verified,
          uan_number, pan_card, voter_id_card, aadhaar_card, leave_carry_forward,
          department, designation, phone, branch, center, is_manager,
          reporting_manager_id, reporting_manager_name, reporting_manager_email,
          joining_date, status, address, remarks, profile_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        toRecordId,
        toCode,
        personName,
        nextEmail || nextPersonalEmail || `${toCode.toLowerCase()}@company.com`,
        nextPersonalEmail,
        nextEmail,
        sourceEmp?.personalEmailVerified ? 1 : 0,
        nextEmail ? 1 : 0,
        sourceEmp?.uanNumber || '',
        nextPan,
        sourceEmp?.voterIdCard || '',
        nextAadhaar,
        Number(sourceEmp?.leaveCarryForward) || 0,
        nextDept,
        nextDesig,
        nextPhone,
        nextCenter,
        nextCenter,
        nextIsManager ? 1 : 0,
        nextMgrId,
        nextMgrName,
        nextMgrEmail,
        nextJoin,
        nextStatus,
        nextAddress,
        nextRemarks,
        profileId
      );
    } else {
      db.prepare(`
        INSERT INTO Personnel_Entities (
          id, entity_code, entity_type, name, email, personal_email, official_email,
          phone, whatsapp_no, father_husband_name, address, center, department, designation,
          is_manager, reporting_manager_id, reporting_manager_name, reporting_manager_email,
          aadhaar_card, pan_card, project_name, project_no, eic_name,
          bank_name, bank_branch, bank_account_type, bank_account_no, ifsc_code,
          joining_date, status, remarks, created_at, profile_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        toRecordId,
        toCode,
        targetCategory,
        personName,
        nextEmail || nextPersonalEmail,
        nextPersonalEmail,
        nextEmail,
        nextPhone,
        sourceEnt?.whatsappNo || '',
        sourceEnt?.fatherHusbandName || '',
        nextAddress,
        nextCenter,
        nextDept,
        nextDesig,
        nextIsManager ? 1 : 0,
        nextMgrId,
        nextMgrName,
        nextMgrEmail,
        nextAadhaar,
        nextPan,
        sourceEnt?.projectName || '',
        sourceEnt?.projectNo || '',
        sourceEnt?.eicName || '',
        sourceEnt?.bankName || '',
        sourceEnt?.bankBranch || '',
        sourceEnt?.bankAccountType || 'Savings',
        sourceEnt?.bankAccountNo || '',
        sourceEnt?.ifscCode || '',
        nextJoin,
        nextStatus,
        nextRemarks,
        nowIso,
        profileId
      );
    }

    // Re-point linked records cleanly so attendance, leaves, assignments, returns, tickets, approvals & workflows remain intact
    db.prepare(`UPDATE Attendance SET employee_id = ? WHERE employee_id = ? OR employee_id = ?`).run(
      toRecordId,
      fromId,
      fromCode
    );
    db.prepare(`UPDATE Leave_Requests SET employee_id = ? WHERE employee_id = ? OR employee_id = ?`).run(
      toRecordId,
      fromId,
      fromCode
    );
    db.prepare(`UPDATE Leave_Requests SET manager_id = ? WHERE manager_id = ? OR manager_id = ?`).run(
      toRecordId,
      fromId,
      fromCode
    );
    db.prepare(`UPDATE Workflow_Requests SET employee_id = ? WHERE employee_id = ? OR employee_id = ?`).run(
      toRecordId,
      fromId,
      fromCode
    );
    db.prepare(`UPDATE Approval_Requests SET employee_id = ? WHERE employee_id = ? OR employee_id = ?`).run(
      toRecordId,
      fromId,
      fromCode
    );
    db.prepare(
      `UPDATE Assignments SET employee_id = ?, assignee_type = ? WHERE employee_id = ? OR employee_id = ?`
    ).run(toRecordId, targetCategory, fromId, fromCode);
    db.prepare(`UPDATE Assignments SET assigned_by_id = ? WHERE assigned_by_id = ? OR assigned_by_id = ?`).run(
      toRecordId,
      fromId,
      fromCode
    );
    db.prepare(`UPDATE Asset_Returns SET employee_id = ? WHERE employee_id = ? OR employee_id = ?`).run(
      toRecordId,
      fromId,
      fromCode
    );
    db.prepare(`UPDATE Support_Tickets SET employee_id = ? WHERE employee_id = ? OR employee_id = ?`).run(
      toRecordId,
      fromId,
      fromCode
    );
    db.prepare(`UPDATE Email_Logs SET employee_id = ? WHERE employee_id = ? OR employee_id = ?`).run(
      toRecordId,
      fromId,
      fromCode
    );
    db.prepare(
      `UPDATE Employees SET reporting_manager_id = ? WHERE reporting_manager_id = ? OR reporting_manager_id = ?`
    ).run(toRecordId, fromId, fromCode);
    db.prepare(
      `UPDATE Personnel_Entities SET reporting_manager_id = ? WHERE reporting_manager_id = ? OR reporting_manager_id = ?`
    ).run(toRecordId, fromId, fromCode);
    db.prepare(
      `UPDATE Freelancer_Allotments SET flp_id = ?, flp_code = CASE WHEN ? = 'Freelancer' THEN ? ELSE flp_code END WHERE flp_id = ? OR flp_id = ?`
    ).run(toRecordId, targetCategory, toCode, fromId, fromCode);

    const targetRoleId =
      targetCategory === 'Employee'
        ? nextIsManager
          ? 'role_dept_manager'
          : 'role_employee'
        : ENTITY_TYPE_TO_ROLE_ID[targetCategory];

    const linkedUsers = db
      .prepare(`SELECT id, role_id FROM Users WHERE employee_id = ? OR employee_id = ?`)
      .all(fromId, fromCode) as Array<{ id: string; role_id: string }>;

    for (const u of linkedUsers) {
      const nextRole = PERSONNEL_ROLE_IDS.has(u.role_id) ? targetRoleId : u.role_id;
      db.prepare(`UPDATE Users SET employee_id = ?, role_id = ?, department = ? WHERE id = ?`).run(
        toRecordId,
        nextRole,
        nextDept,
        u.id
      );
      db.prepare(
        `UPDATE Policy_Acknowledgments SET entity_type = ?, entity_code = ? WHERE user_id = ?`
      ).run(targetCategory, toCode, u.id);
    }

    if (sourceCategory === 'Employee') {
      db.prepare(`DELETE FROM Employees WHERE id = ?`).run(fromId);
    } else {
      db.prepare(`DELETE FROM Personnel_Entities WHERE id = ?`).run(fromId);
    }

    db.prepare(`
      INSERT INTO Employment_Conversions (
        id, profile_id, from_category, to_category, from_code, to_code,
        from_record_id, to_record_id, person_name, reason, converted_by, converted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      conversion.id,
      conversion.profileId,
      conversion.fromType,
      conversion.toType,
      conversion.fromCode,
      conversion.toCode,
      fromId,
      toRecordId,
      conversion.personName,
      conversion.reason || '',
      conversion.convertedBy,
      conversion.convertedAt
    );

    writeSystemAuditLog(db, {
      module: 'Personnel',
      entityType: 'EmploymentConversion',
      entityId: conversion.id,
      action: 'EMPLOYMENT_CONVERTED',
      actor,
      beforeObj: { category: sourceCategory, id: fromId, code: fromCode, profileId },
      afterObj: { category: targetCategory, id: toRecordId, code: toCode, profileId },
      details: `Converted ${personName} (${profileId}) from ${sourceCategory} [${fromCode}] to ${targetCategory} [${toCode}]`,
    });

    db.exec('COMMIT');
    return { ok: true, conversion, targetId: toRecordId, targetCode: toCode };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function recordSiteVisitInDb(
  db: AppDatabase,
  params: { visitorKey: string; userId?: string }
): void {
  const key = (params.visitorKey || '').trim().slice(0, 128);
  if (!key) return;
  const now = new Date();
  const nowIso = now.toISOString();
  const visitDate = nowIso.slice(0, 10);
  const visitMonth = visitDate.slice(0, 7);
  const visitYear = visitDate.slice(0, 4);

  db.prepare(`
    INSERT INTO Site_Visits (id, visitor_key, visit_date, visit_month, visit_year, user_id, first_seen_at, last_seen_at, hit_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(visitor_key, visit_date) DO UPDATE SET
      user_id = CASE WHEN excluded.user_id != '' THEN excluded.user_id ELSE Site_Visits.user_id END,
      last_seen_at = excluded.last_seen_at,
      hit_count = Site_Visits.hit_count + 1
  `).run(
    crypto.randomUUID(),
    key,
    visitDate,
    visitMonth,
    visitYear,
    (params.userId || '').trim(),
    nowIso,
    nowIso
  );
}

export function upsertUserPresenceInDb(
  db: AppDatabase,
  user: Pick<SessionUser, 'id' | 'loginId' | 'fullName' | 'role'>
): void {
  const nowIso = new Date().toISOString();
  db.prepare(`
    INSERT INTO User_Presence (user_id, login_id, user_name, role_name, last_seen_at, is_online)
    VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT(user_id) DO UPDATE SET
      login_id = excluded.login_id,
      user_name = excluded.user_name,
      role_name = excluded.role_name,
      last_seen_at = excluded.last_seen_at,
      is_online = 1
  `).run(user.id, user.loginId, user.fullName, user.role, nowIso);
}

export function markUserOfflineInDb(db: AppDatabase, userId: string): void {
  db.prepare(`UPDATE User_Presence SET is_online = 0, last_seen_at = ? WHERE user_id = ?`).run(
    new Date().toISOString(),
    userId
  );
}

export function getVisitorAnalyticsSummaryFromDb(db: AppDatabase): VisitorAnalyticsSummary {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const monthStr = todayStr.slice(0, 7);
  const yearStr = todayStr.slice(0, 4);
  const onlineCutoffIso = new Date(now.getTime() - 2 * 60 * 1000).toISOString();

  const totalVisitors =
    (db.prepare(`SELECT COUNT(*) as c FROM Site_Visits`).get() as { c: number } | undefined)?.c || 0;
  const todayVisitors =
    (
      db
        .prepare(`SELECT COUNT(DISTINCT visitor_key) as c FROM Site_Visits WHERE visit_date = ?`)
        .get(todayStr) as { c: number } | undefined
    )?.c || 0;
  const monthlyVisitors =
    (
      db
        .prepare(`SELECT COUNT(DISTINCT visitor_key) as c FROM Site_Visits WHERE visit_month = ?`)
        .get(monthStr) as { c: number } | undefined
    )?.c || 0;
  const yearlyVisitors =
    (
      db
        .prepare(`SELECT COUNT(DISTINCT visitor_key) as c FROM Site_Visits WHERE visit_year = ?`)
        .get(yearStr) as { c: number } | undefined
    )?.c || 0;
  const onlineUsers =
    (
      db
        .prepare(`SELECT COUNT(*) as c FROM User_Presence WHERE is_online = 1 AND last_seen_at >= ?`)
        .get(onlineCutoffIso) as { c: number } | undefined
    )?.c || 0;
  const loggedInUsers =
    (
      db
        .prepare(`SELECT COUNT(*) as c FROM User_Presence WHERE is_online = 1`)
        .get() as { c: number } | undefined
    )?.c || 0;

  return {
    totalVisitors,
    todayVisitors,
    monthlyVisitors,
    yearlyVisitors,
    loggedInUsers,
    onlineUsers,
    dateStr: todayStr,
  };
}