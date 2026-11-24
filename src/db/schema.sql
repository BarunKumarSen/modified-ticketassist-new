-- Median Asset & HR Suite Employee & Attendance RBAC Relational Schema (SQLite / ANSI SQL)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS Roles (
  id TEXT PRIMARY KEY,
  role_name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS Permissions (
  id TEXT PRIMARY KEY,
  permission_name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT 'General',
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS Role_Permissions (
  role_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES Roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES Permissions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Users (
  id TEXT PRIMARY KEY,
  login_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role_id TEXT NOT NULL,
  employee_id TEXT,
  department TEXT,
  theme_preference TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY (role_id) REFERENCES Roles(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS User_Permissions (
  user_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  PRIMARY KEY (user_id, permission_id),
  FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES Permissions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Employees (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  department TEXT NOT NULL,
  designation TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT 'Mumbai',
  center TEXT NOT NULL DEFAULT 'Mumbai',
  is_manager INTEGER NOT NULL DEFAULT 0,
  reporting_manager_id TEXT NOT NULL DEFAULT '',
  reporting_manager_name TEXT NOT NULL DEFAULT '',
  reporting_manager_email TEXT NOT NULL DEFAULT '',
  joining_date TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Active',
  personal_email TEXT NOT NULL DEFAULT '',
  official_email TEXT NOT NULL DEFAULT '',
  personal_email_verified INTEGER NOT NULL DEFAULT 0,
  official_email_verified INTEGER NOT NULL DEFAULT 0,
  uan_number TEXT NOT NULL DEFAULT '',
  pan_card TEXT NOT NULL DEFAULT '',
  voter_id_card TEXT NOT NULL DEFAULT '',
  aadhaar_card TEXT NOT NULL DEFAULT '',
  leave_carry_forward INTEGER NOT NULL DEFAULT 0,
  profile_id TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS Attendance (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  attendance_date TEXT NOT NULL,
  check_in_time TEXT,
  check_out_time TEXT,
  status TEXT NOT NULL CHECK (status IN ('Present', 'Late', 'Half Day', 'On Leave', 'Absent')),
  late_minutes INTEGER NOT NULL DEFAULT 0,
  work_hours REAL NOT NULL DEFAULT 0,
  remarks TEXT NOT NULL DEFAULT '',
  correction_status TEXT NOT NULL DEFAULT 'None' CHECK (correction_status IN ('None', 'Pending', 'Approved')),
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (employee_id, attendance_date)
);

CREATE TABLE IF NOT EXISTS Leave_Requests (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  leave_type TEXT NOT NULL CHECK (leave_type IN ('Annual', 'Sick', 'Casual', 'Unpaid')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  manager_id TEXT DEFAULT '',
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_remarks TEXT DEFAULT '',
  overridden_by TEXT,
  overridden_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Employee_Centers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  state_region TEXT NOT NULL DEFAULT '',
  official_address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Policies (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '1.0',
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  file_size INTEGER NOT NULL DEFAULT 0,
  content_base64 TEXT NOT NULL,
  uploaded_by TEXT NOT NULL DEFAULT 'System Administrator',
  uploaded_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  history_json TEXT NOT NULL DEFAULT '[]',
  visible_roles_json TEXT NOT NULL DEFAULT '["Employee","Consultant","Retainer","Freelancer","Young Research Program","Intern"]'
);

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

CREATE TABLE IF NOT EXISTS Attendance_Audit_Logs (
  id TEXT PRIMARY KEY,
  attendance_id TEXT,
  employee_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  details TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Public_Holidays (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  holiday_date TEXT NOT NULL,
  center TEXT NOT NULL DEFAULT 'All Centers',
  description TEXT NOT NULL DEFAULT '',
  is_national INTEGER NOT NULL DEFAULT 0,
  origin_key TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS National_Holiday_Overrides (
  id TEXT PRIMARY KEY,
  origin_key TEXT NOT NULL,
  year INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('edited', 'deleted')),
  title TEXT,
  holiday_date TEXT,
  center TEXT,
  description TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (origin_key, year)
);

CREATE TABLE IF NOT EXISTS Department_Designations (
  id TEXT PRIMARY KEY,
  department_name TEXT NOT NULL,
  designation_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (department_name, designation_name)
);

CREATE TABLE IF NOT EXISTS Workflow_Requests (
  id TEXT PRIMARY KEY,
  request_type TEXT NOT NULL CHECK (request_type IN ('regularization', 'wfh', 'profile_change')),
  employee_id TEXT NOT NULL,
  target_date TEXT NOT NULL,
  end_date TEXT,
  requested_check_in TEXT,
  requested_check_out TEXT,
  payload_json TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Approval_Requests (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('leave', 'regularization', 'wfh', 'profile_change')),
  entity_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  manager_name TEXT NOT NULL,
  manager_email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  actioned_at TEXT,
  actioned_by TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Email_Logs (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT NOT NULL DEFAULT '',
  recipient_role TEXT NOT NULL DEFAULT 'Employee',
  employee_id TEXT,
  employee_name TEXT,
  manager_name TEXT,
  manager_email TEXT,
  center TEXT,
  subject TEXT NOT NULL,
  html_body TEXT NOT NULL,
  text_body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Queued', 'Sending', 'Sent', 'Failed', 'Retry')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  next_retry_at TEXT,
  last_error TEXT,
  message_id TEXT,
  related_entity_type TEXT,
  related_entity_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS Mail_Config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  app_name TEXT NOT NULL DEFAULT 'Median Asset & HR Suite',
  from_email TEXT NOT NULL DEFAULT 'barunkumarsenbks1997@gmail.com',
  smtp_host TEXT NOT NULL DEFAULT 'smtp.gmail.com',
  smtp_port INTEGER NOT NULL DEFAULT 587,
  encryption TEXT NOT NULL DEFAULT 'tls',
  imap_host TEXT NOT NULL DEFAULT 'imap.gmail.com',
  imap_port INTEGER NOT NULL DEFAULT 993,
  username TEXT NOT NULL DEFAULT '',
  app_password TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Mail_Change_Otps (
  id TEXT PRIMARY KEY,
  old_email TEXT NOT NULL,
  new_email TEXT NOT NULL,
  otp_code TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  consumed INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Email_Audit_Logs (
  id TEXT PRIMARY KEY,
  email_log_id TEXT,
  approval_request_id TEXT,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  status TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS App_Settings (
  id TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL,
  categories_json TEXT NOT NULL,
  departments_json TEXT NOT NULL,
  locations_json TEXT NOT NULL,
  seed_initialized INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  subcategory TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  serial TEXT NOT NULL,
  rmn_number TEXT NOT NULL DEFAULT '',
  part_number TEXT NOT NULL DEFAULT '',
  ean_number TEXT NOT NULL DEFAULT '',
  imei1 TEXT NOT NULL DEFAULT '',
  imei2 TEXT NOT NULL DEFAULT '',
  snid_number TEXT NOT NULL DEFAULT '',
  purchase_date TEXT NOT NULL DEFAULT '',
  cost REAL NOT NULL DEFAULT 0,
  vendor TEXT NOT NULL DEFAULT '',
  vendor_supplier_name TEXT NOT NULL DEFAULT '',
  invoice_number TEXT NOT NULL DEFAULT '',
  warranty_months INTEGER NOT NULL DEFAULT 0,
  warranty_expiry TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT 'IT',
  location TEXT NOT NULL DEFAULT 'Floor 1',
  condition TEXT NOT NULL DEFAULT 'Good',
  status TEXT NOT NULL DEFAULT 'Available',
  dep_method TEXT NOT NULL DEFAULT 'SLM',
  useful_life INTEGER NOT NULL DEFAULT 5,
  salvage_value REAL NOT NULL DEFAULT 0,
  current_value REAL NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  project_name TEXT NOT NULL DEFAULT '',
  project_no TEXT NOT NULL DEFAULT '',
  eic_name TEXT NOT NULL DEFAULT '',
  assigned_flp TEXT NOT NULL DEFAULT '',
  flp_id TEXT NOT NULL DEFAULT '',
  date_of_issue TEXT NOT NULL DEFAULT '',
  date_of_return TEXT NOT NULL DEFAULT '',
  accessories_issued TEXT NOT NULL DEFAULT '',
  last_verification_date TEXT NOT NULL DEFAULT '',
  remarks TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS Vendors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_person TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  gst TEXT NOT NULL DEFAULT '',
  remarks TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS Assignments (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  assignee_type TEXT NOT NULL DEFAULT 'Employee',
  assigned_by_id TEXT NOT NULL DEFAULT '',
  assigned_by_role TEXT NOT NULL DEFAULT '',
  parent_assignment_id TEXT NOT NULL DEFAULT '',
  custody_level TEXT NOT NULL DEFAULT 'Primary',
  assign_date TEXT NOT NULL,
  return_date TEXT NOT NULL DEFAULT '',
  condition TEXT NOT NULL DEFAULT 'Good',
  assigned_by TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  project_name TEXT NOT NULL DEFAULT '',
  project_no TEXT NOT NULL DEFAULT '',
  eic_name TEXT NOT NULL DEFAULT '',
  allotment_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Active'
);

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

CREATE TABLE IF NOT EXISTS Asset_Returns (
  id TEXT PRIMARY KEY,
  return_date TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  condition TEXT NOT NULL DEFAULT 'Good',
  damage TEXT NOT NULL DEFAULT 'No Damage',
  remarks TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS Asset_Transfers (
  id TEXT PRIMARY KEY,
  transfer_date TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  from_dept TEXT NOT NULL DEFAULT '',
  to_dept TEXT NOT NULL DEFAULT '',
  from_emp TEXT NOT NULL DEFAULT '',
  to_emp TEXT NOT NULL DEFAULT '',
  new_location TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  remarks TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS Maintenance_Records (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  type TEXT NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  vendor TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  service_date TEXT NOT NULL,
  next_date TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS Disposals (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  disposal_date TEXT NOT NULL,
  salvage_recovered REAL NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS Expenses (
  id TEXT PRIMARY KEY,
  expense_date TEXT NOT NULL,
  category TEXT NOT NULL,
  paid_to TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  mode TEXT NOT NULL,
  remarks TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS Support_Tickets (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'Medium',
  status TEXT NOT NULL DEFAULT 'Requested',
  created_at TEXT NOT NULL,
  queue_order INTEGER NOT NULL DEFAULT 0,
  created_by_role TEXT,
  requested_date TEXT,
  requested_start_time TEXT,
  requested_duration_mins INTEGER,
  booked_slot_id TEXT,
  work_order_date TEXT,
  work_order_start_time TEXT,
  work_order_duration_mins INTEGER,
  work_order_end_time TEXT,
  employee_confirmed INTEGER NOT NULL DEFAULT 0,
  employee_confirmed_at TEXT,
  work_order_mail_sent_at TEXT,
  approval_status TEXT NOT NULL DEFAULT 'Pending',
  approved_by TEXT,
  approved_at TEXT,
  rejection_reason TEXT,
  closed_by TEXT,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS Asset_History (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  event_date TEXT NOT NULL,
  activity TEXT NOT NULL,
  details TEXT NOT NULL,
  seq_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS Attachments (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  content_base64 TEXT NOT NULL DEFAULT '',
  uploaded_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS System_Audit_Logs (
  id TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL DEFAULT '',
  ip_address TEXT NOT NULL DEFAULT '127.0.0.1',
  before_json TEXT,
  after_json TEXT,
  details TEXT NOT NULL,
  created_at TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS Site_Visits (
  id TEXT PRIMARY KEY,
  visitor_key TEXT NOT NULL,
  visit_date TEXT NOT NULL,
  visit_month TEXT NOT NULL,
  visit_year TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT '',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 1,
  UNIQUE (visitor_key, visit_date)
);

CREATE TABLE IF NOT EXISTS User_Presence (
  user_id TEXT PRIMARY KEY,
  login_id TEXT NOT NULL DEFAULT '',
  user_name TEXT NOT NULL DEFAULT '',
  role_name TEXT NOT NULL DEFAULT '',
  last_seen_at TEXT NOT NULL,
  is_online INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS Employment_Conversions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  from_category TEXT NOT NULL,
  to_category TEXT NOT NULL,
  from_code TEXT NOT NULL,
  to_code TEXT NOT NULL,
  from_record_id TEXT NOT NULL,
  to_record_id TEXT NOT NULL,
  person_name TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  converted_by TEXT NOT NULL,
  converted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Revoked_Tokens (
  jti TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  revoked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS App_Meta (
  meta_key TEXT PRIMARY KEY,
  meta_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attendance_date ON Attendance(attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON Attendance(employee_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_leave_employee ON Leave_Requests(employee_id, start_date);
CREATE INDEX IF NOT EXISTS idx_audit_created ON Attendance_Audit_Logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_holidays_date ON Public_Holidays(holiday_date);
CREATE INDEX IF NOT EXISTS idx_workflow_employee ON Workflow_Requests(employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_entity ON Approval_Requests(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON Email_Logs(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_email_logs_created ON Email_Logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_audit_created ON Email_Audit_Logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_dept_status ON Assets(department, status);
CREATE INDEX IF NOT EXISTS idx_assignments_emp_status ON Assignments(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_asset_history_asset ON Asset_History(asset_id, seq_order DESC);
CREATE INDEX IF NOT EXISTS idx_system_audit_created ON System_Audit_Logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_audit_module ON System_Audit_Logs(module, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_personnel_entities_type ON Personnel_Entities(entity_type, status);
CREATE INDEX IF NOT EXISTS idx_freelancer_allotments_flp ON Freelancer_Allotments(flp_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_policy_acks_policy ON Policy_Acknowledgments(policy_id, user_id);
CREATE INDEX IF NOT EXISTS idx_site_visits_date ON Site_Visits(visit_date, visit_month, visit_year);
CREATE INDEX IF NOT EXISTS idx_user_presence_seen ON User_Presence(is_online, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_emp_conversions_profile ON Employment_Conversions(profile_id, converted_at DESC);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_exp ON Revoked_Tokens(expires_at);

