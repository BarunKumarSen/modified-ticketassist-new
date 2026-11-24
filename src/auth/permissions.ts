export const ALL_PERMISSIONS = [
  // Attendance Permissions
  'attendance.view',
  'attendance.create',
  'attendance.edit',
  'attendance.delete',
  'attendance.report',
  'attendance.export',
  // Employee Permissions
  'employee.view',
  'employee.create',
  'employee.edit',
  'employee.delete',
  // User Management Permissions
  'user.view',
  'user.create',
  'user.edit',
  'user.delete',
  'role.manage',
] as const;

export type PermissionName = (typeof ALL_PERMISSIONS)[number];

export type RoleName =
  | 'Super Admin'
  | 'HR Manager'
  | 'Department Manager'
  | 'Auditor'
  | 'Employee'
  | 'Consultant'
  | 'Retainer'
  | 'Freelancer'
  | 'Young Research Program'
  | 'Intern';

export interface PermissionDefinition {
  id: string;
  name: PermissionName;
  category: 'Attendance' | 'Employee' | 'User Management';
  description: string;
}

export interface RoleDefinition {
  id: string;
  name: RoleName;
  description: string;
  permissions: PermissionName[];
}

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  {
    id: 'perm_attendance_view',
    name: 'attendance.view',
    category: 'Attendance',
    description: 'View attendance records, dashboard statistics, and leave history',
  },
  {
    id: 'perm_attendance_create',
    name: 'attendance.create',
    category: 'Attendance',
    description: 'Perform employee check-in/check-out and submit attendance or leave entries',
  },
  {
    id: 'perm_attendance_edit',
    name: 'attendance.edit',
    category: 'Attendance',
    description: 'Edit attendance records, approve corrections, and approve/reject leave requests',
  },
  {
    id: 'perm_attendance_delete',
    name: 'attendance.delete',
    category: 'Attendance',
    description: 'Delete attendance entries (logged to audit trail)',
  },
  {
    id: 'perm_attendance_report',
    name: 'attendance.report',
    category: 'Attendance',
    description: 'Access daily and monthly attendance reports and analytics',
  },
  {
    id: 'perm_attendance_export',
    name: 'attendance.export',
    category: 'Attendance',
    description: 'Export attendance reports to Excel and PDF formats',
  },
  {
    id: 'perm_employee_view',
    name: 'employee.view',
    category: 'Employee',
    description: 'View employee directory and profiles',
  },
  {
    id: 'perm_employee_create',
    name: 'employee.create',
    category: 'Employee',
    description: 'Create new employee records and import employee lists',
  },
  {
    id: 'perm_employee_edit',
    name: 'employee.edit',
    category: 'Employee',
    description: 'Edit existing employee records',
  },
  {
    id: 'perm_employee_delete',
    name: 'employee.delete',
    category: 'Employee',
    description: 'Delete employee records',
  },
  {
    id: 'perm_user_view',
    name: 'user.view',
    category: 'User Management',
    description: 'View system users and their assigned roles/permissions',
  },
  {
    id: 'perm_user_create',
    name: 'user.create',
    category: 'User Management',
    description: 'Create new system users with roles and custom permissions',
  },
  {
    id: 'perm_user_edit',
    name: 'user.edit',
    category: 'User Management',
    description: 'Edit system users, roles, status, and custom permissions',
  },
  {
    id: 'perm_user_delete',
    name: 'user.delete',
    category: 'User Management',
    description: 'Delete system user accounts',
  },
  {
    id: 'perm_role_manage',
    name: 'role.manage',
    category: 'User Management',
    description: 'Manage role permission templates and view system audit controls',
  },
];

export const PREDEFINED_ROLES: RoleDefinition[] = [
  {
    id: 'role_super_admin',
    name: 'Super Admin',
    description: 'Full system access with all attendance, employee, and RBAC permissions enabled.',
    permissions: [...ALL_PERMISSIONS],
  },
  {
    id: 'role_hr_manager',
    name: 'HR Manager',
    description:
      'View and manage employees, manage attendance & leave records, and generate/export reports.',
    permissions: [
      'employee.view',
      'employee.create',
      'employee.edit',
      'attendance.view',
      'attendance.create',
      'attendance.edit',
      'attendance.report',
      'attendance.export',
    ],
  },
  {
    id: 'role_dept_manager',
    name: 'Department Manager',
    description:
      'View employees and attendance in own department, approve attendance corrections, and view reports.',
    permissions: [
      'employee.view',
      'attendance.view',
      'attendance.edit',
      'attendance.report',
    ],
  },
  {
    id: 'role_auditor',
    name: 'Auditor',
    description: 'Read-only audit access to employee records, attendance logs, and reports.',
    permissions: [
      'employee.view',
      'attendance.view',
      'attendance.report',
      'attendance.export',
    ],
  },
  {
    id: 'role_employee',
    name: 'Employee',
    description:
      'Self-service access to check-in, check-out, own attendance history, and own leave records.',
    permissions: ['attendance.view', 'attendance.create'],
  },
  {
    id: 'role_consultant',
    name: 'Consultant',
    description:
      'External or advisory Consultant with asset custody, IT/HR/POSH policy acknowledgment, ticketing, and optional Manager privileges.',
    permissions: ['attendance.view', 'attendance.create'],
  },
  {
    id: 'role_retainer',
    name: 'Retainer',
    description:
      'Retainer personnel with assigned asset custody, policy acknowledgment, and support ticketing.',
    permissions: ['attendance.view', 'attendance.create'],
  },
  {
    id: 'role_freelancer',
    name: 'Freelancer',
    description:
      'Field Freelancer with IT equipment allotment tracking, policy acknowledgment, and support ticketing.',
    permissions: ['attendance.view', 'attendance.create'],
  },
  {
    id: 'role_yrp',
    name: 'Young Research Program',
    description:
      'Young Research Program (YRP) member with assigned assets, policy acknowledgment, and support ticketing.',
    permissions: ['attendance.view', 'attendance.create'],
  },
  {
    id: 'role_intern',
    name: 'Intern',
    description:
      'Intern with assigned assets, policy acknowledgment, and support ticketing.',
    permissions: ['attendance.view', 'attendance.create'],
  },
];

export function isValidPermission(value: string): value is PermissionName {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}

export function resolveEffectivePermissions(
  rolePermissions: readonly PermissionName[],
  customPermissions: readonly PermissionName[] = []
): PermissionName[] {
  const merged = new Set<PermissionName>();
  for (const p of rolePermissions) {
    if (isValidPermission(p)) merged.add(p);
  }
  for (const p of customPermissions) {
    if (isValidPermission(p)) merged.add(p);
  }
  return Array.from(merged);
}

export function hasPermission(
  user: { role?: string; permissions?: readonly string[] } | null | undefined,
  permission: PermissionName
): boolean {
  if (!user) return false;
  if (user.role === 'Super Admin' || user.role === 'Administrator') {
    return true;
  }
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

export function hasAnyPermission(
  user: { role?: string; permissions?: readonly string[] } | null | undefined,
  permissions: readonly PermissionName[]
): boolean {
  if (!user) return false;
  if (user.role === 'Super Admin' || user.role === 'Administrator') {
    return true;
  }
  return permissions.some((p) => hasPermission(user, p));
}
