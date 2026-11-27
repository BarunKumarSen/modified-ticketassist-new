import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SEED_ADMIN_ID } from '../data/seedData.ts';
import { PRODUCTION_CLEAN_META_KEY, type AppDatabase } from './sqlite.ts';

export interface ProductionCleanupReport {
  executedAt: string;
  backupPath?: string;
  backupSizeBytes?: number;
  backupIntegrity?: string;
  beforeCounts: Record<string, number>;
  afterCounts: Record<string, number>;
  removedCounts: Record<string, number>;
  preservedTables: Record<string, number>;
  sampleDepartmentsCleared: boolean;
  sqliteSequenceReset: boolean;
  foreignKeyViolations: number;
  integrityCheck: string;
}

const TABLES_TO_EMPTY = [
  'Policy_Acknowledgments',
  'Freelancer_Allotments',
  'Approval_Requests',
  'Workflow_Requests',
  'Attendance_Audit_Logs',
  'Attendance',
  'Leave_Requests',
  'Employment_Conversions',
  'Personnel_Entities',
  'Asset_History',
  'Asset_Returns',
  'Asset_Transfers',
  'Maintenance_Records',
  'Disposals',
  'Assignments',
  'Support_Tickets',
  'Assets',
  'Vendors',
  'Expenses',
  'Attachments',
  'Email_Audit_Logs',
  'Email_Logs',
  'Mail_Change_Otps',
  'System_Audit_Logs',
  'Site_Visits',
  'User_Presence',
  'Revoked_Tokens',
  'Department_Designations',
  'National_Holiday_Overrides',
  'Employees',
] as const;

function getExistingTables(db: AppDatabase): string[] {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC`
    )
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

export function snapshotTableCounts(db: AppDatabase): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const tbl of getExistingTables(db)) {
    const row = db.prepare(`SELECT COUNT(*) as c FROM "${tbl}"`).get() as { c: number };
    counts[tbl] = Number(row.c || 0);
  }
  return counts;
}

export function createVerifiedDatabaseBackup(
  dbPath: string,
  backupDir: string = path.resolve(path.dirname(dbPath), 'backups')
): { backupPath: string; sizeBytes: number; integrity: string } {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file not found at ${dbPath}`);
  }
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `assetos-pre-cleanup-${stamp}.db`);

  // Use SQLite VACUUM INTO via a short-lived connection for a consistent snapshot
  const srcDb = new DatabaseSync(dbPath);
  try {
    const escapedPath = backupPath.replace(/'/g, "''");
    srcDb.exec(`VACUUM INTO '${escapedPath}';`);
  } finally {
    srcDb.close();
  }

  const stat = fs.statSync(backupPath);
  if (stat.size === 0) {
    throw new Error(`Created backup file is empty: ${backupPath}`);
  }

  const verifyDb = new DatabaseSync(backupPath, { readOnly: true });
  try {
    const chk = verifyDb.prepare(`PRAGMA integrity_check`).get() as { integrity_check: string };
    if (chk?.integrity_check !== 'ok') {
      throw new Error(`Backup integrity check failed: ${JSON.stringify(chk)}`);
    }
    return {
      backupPath,
      sizeBytes: stat.size,
      integrity: chk.integrity_check,
    };
  } finally {
    verifyDb.close();
  }
}

export function prepareDatabaseForProduction(
  db: AppDatabase,
  options?: { backupPath?: string; backupSizeBytes?: number; backupIntegrity?: string }
): ProductionCleanupReport {
  db.exec(`PRAGMA foreign_keys = ON;`);

  const existingTables = new Set(getExistingTables(db));
  const beforeCounts = snapshotTableCounts(db);
  const nowIso = new Date().toISOString();

  let sampleDepartmentsCleared = false;
  let sqliteSequenceReset = false;

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const tableName of TABLES_TO_EMPTY) {
      if (existingTables.has(tableName)) {
        db.exec(`DELETE FROM "${tableName}";`);
      }
    }

    // Remove sample/custom holidays while preserving rolled national holidays
    if (existingTables.has('Public_Holidays')) {
      db.exec(`DELETE FROM Public_Holidays WHERE COALESCE(is_national, 0) = 0;`);
    }

    // Remove all demo/non-admin users & their custom permissions while preserving Super Admin
    if (existingTables.has('User_Permissions')) {
      db.prepare(`DELETE FROM User_Permissions WHERE user_id != ?`).run(SEED_ADMIN_ID);
    }
    if (existingTables.has('Users')) {
      db.prepare(`DELETE FROM Users WHERE id != ?`).run(SEED_ADMIN_ID);
      db.prepare(`UPDATE Users SET employee_id = NULL, active = 1 WHERE id = ?`).run(SEED_ADMIN_ID);
    }

    // Clear sample departments list in App_Settings while preserving company branding/settings/categories/locations
    if (existingTables.has('App_Settings')) {
      db.prepare(
        `UPDATE App_Settings
         SET departments_json = '[]',
             seed_initialized = 1,
             updated_at = ?
         WHERE id = 'default'`
      ).run(nowIso);
      sampleDepartmentsCleared = true;
    }

    // Mark database as clean production state so future server restarts do not re-seed demo records
    if (existingTables.has('App_Meta')) {
      db.prepare(
        `INSERT INTO App_Meta (meta_key, meta_value, updated_at)
         VALUES (?, '1', ?)
         ON CONFLICT(meta_key) DO UPDATE SET
           meta_value = '1',
           updated_at = excluded.updated_at`
      ).run(PRODUCTION_CLEAN_META_KEY, nowIso);
    }

    // Reset SQLite auto-increment counters if sqlite_sequence exists
    const seqTable = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence' LIMIT 1`)
      .get() as { name: string } | undefined;
    if (seqTable) {
      db.exec(`DELETE FROM sqlite_sequence;`);
      sqliteSequenceReset = true;
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const fkViolations = db.prepare(`PRAGMA foreign_key_check`).all() as Array<unknown>;
  if (fkViolations.length > 0) {
    throw new Error(`Foreign key check failed after cleanup: ${JSON.stringify(fkViolations)}`);
  }

  db.exec(`VACUUM;`);
  const integrityRow = db.prepare(`PRAGMA integrity_check`).get() as { integrity_check: string };
  if (integrityRow?.integrity_check !== 'ok') {
    throw new Error(`Post-cleanup integrity check failed: ${JSON.stringify(integrityRow)}`);
  }

  const afterCounts = snapshotTableCounts(db);
  const removedCounts: Record<string, number> = {};
  const preservedTables: Record<string, number> = {};

  for (const [tbl, before] of Object.entries(beforeCounts)) {
    const after = afterCounts[tbl] ?? 0;
    const diff = Math.max(0, before - after);
    if (diff > 0) {
      removedCounts[tbl] = diff;
    }
    if (after > 0) {
      preservedTables[tbl] = after;
    }
  }

  return {
    executedAt: nowIso,
    backupPath: options?.backupPath,
    backupSizeBytes: options?.backupSizeBytes,
    backupIntegrity: options?.backupIntegrity,
    beforeCounts,
    afterCounts,
    removedCounts,
    preservedTables,
    sampleDepartmentsCleared,
    sqliteSequenceReset,
    foreignKeyViolations: fkViolations.length,
    integrityCheck: integrityRow.integrity_check,
  };
}
