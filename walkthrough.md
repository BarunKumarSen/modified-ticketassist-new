# Security Summary

## Authentication, Session Integrity & Role-Based Access Control (RBAC)
- **Password Hashing & Token Security**: Credentials are salted and hashed with Node `crypto` (`scryptSync`) and verified via timing-safe comparison. Sessions issue HMAC-SHA256 signed JWTs (`server/security.ts`) with explicit JTI/token revocation stored in SQLite on logout (`POST /api/auth/logout`).
- **Brute-Force Rate Limiting**: `POST /api/auth/login` tracks per-IP/identifier failure windows (`5m` window, `15` max failures) and enforces `429 Too Many Requests` lockouts.
- **Permission & Hierarchy Enforcement**:
  - `requireAuth` and `requirePermission` / `requireAnyPermission` (`server/middleware/rbac.ts`) validate bearer JWTs against active SQLite user state (`role`, `permissions`, `active`).
  - Non-admin self-service portals (`Employee`, `Consultant`, `Retainer`, `Freelancer`, `Young Research Program`, `Intern`) are scoped in `filterEmployeesForUser`, `listWorkspaceStateFromDb`, `/api/attendance`, `/api/leaves`, and `/api/policies` to strictly prevent horizontal or vertical privilege escalation.
- **Policy Visibility Enforcement**:
  - Admins define per-policy `visible_roles` across the 6 employment categories (`Employee`, `Consultant`, `Retainer`, `Freelancer`, `Young Research Program`, `Intern`) via `Company Policy` controls.
  - Enforcement happens server-side via `canUserViewPolicy` across `GET /api/policies`, `GET /api/policies/:id/file`, and `POST /api/policies/:id/acknowledge` (unauthorized access returns `403 Access Denied`).

## Data Integrity, Injection Prevention & Export Safety
- **Parameterized SQLite Queries**: All reads, writes, transactions (`BEGIN IMMEDIATE ... COMMIT / ROLLBACK`), conversions (`Employment_Conversions`), visitor analytics (`Site_Visits`, `User_Presence`), and master catalogs (`Expense_Categories`, `Payment_Modes`, `Vendors`, `Expenses`) exclusively use prepared statements (`db.prepare(...).run/get/all(...)`) — zero interpolated SQL strings.
- **Manual Code Duplicate Protection**:
  - `Vendors` (`Vendor Code`) and `Expenses` (`Expense Number`) require manual alphanumeric codes (`^[A-Z0-9_-]{2,24}$`), normalized to uppercase and validated case-insensitively (`409 Conflict` on duplicate).
  - Inactive `Expense_Categories` and `Payment_Modes` are blocked from new expense entry (`400`), and referenced masters cannot be hard-deleted (`409`), preserving ledger referential integrity.
- **CSV Import / Export Hardening**: RFC-4180 CSV parser handles BOM, CRLF, and quoted commas; all CSV downloads (`attendanceExport.ts`, `assetExport.ts`, `employeeImport.ts`) escape formula-injection prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`).

---

## PoC Verification

### 1. Security & Functional Regression Tests (`node:test` on In-Memory SQLite + Live HTTP Server)
- **Command Executed**: `npx --yes tsx --test src/utils/*.test.ts src/auth/*.test.ts server/*.test.ts`
- **Result**: **61 / 61 tests passed (0 failed)** across unit, RBAC, mail, entity/allotment, attendance/holiday, and 15-upgrade end-to-end suites.
- **Verified Security Boundaries**:
  - Unauthorized category accessing restricted `Company Policy` file/acknowledgment endpoint (`/api/policies/:id/acknowledge`) returns HTTP `403`.
  - Duplicate manual `Vendor Code` (`POST /api/vendors`) and duplicate manual `Expense Number` (`POST /api/expenses`) return HTTP `409`.
  - Deactivated `Payment Mode` rejected on new `Expense` creation (`400`); active-usage `Expense Category` deletion blocked (`409`).
  - Global Entity ID regex (`^[A-Z0-9]{1,10}$`) enforced on direct creation and bulk CSV import.
  - Sub-assigning an asset to a `Freelancer` without a completed `Freelancer Allotment` record returns HTTP `400`; returning a `Primary` assignment while `Sub-Assigned` returns HTTP `400`.
  - Consultant-Manager revocation blocked (`409`) when active team members exist unless `forceUnassign: true`.

### 2. Concurrent Multi-Role Login & Load Test
- **Scenario (`server/upgrades15.test.ts`)**:
  - Simultaneous `Promise.all` authentication across **7 distinct roles**: `Super Admin`, `Employee`, `Consultant`, `Retainer`, `Freelancer`, `Young Research Program`, and `Intern` — verifying `200 OK` on all 7 concurrent logins and accurate `User_Presence` + `Site_Visits` deduplication counts.
  - **120-request concurrent API burst** (`5 rounds × 6 active role sessions × 4 endpoints`: `/api/workspace/state`, `/api/policies`, `/api/analytics/visitors`, `/api/analytics/heartbeat`) executed in parallel via `Promise.all`.
- **Observed Outcome**: **120 / 120 HTTP 200 OK**, zero SQLite lock errors or HTTP 5xx responses, zero cross-tenant data leakage across scoped responses.
