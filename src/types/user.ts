import type { PermissionName, RoleName } from '../auth/permissions';

export type UserRole =
  | RoleName
  | 'Administrator'
  | 'Manager';

export interface RoleRecord {
  id: string;
  roleName: string;
  description: string;
  permissions: PermissionName[];
}

export interface PermissionRecord {
  id: string;
  permissionName: PermissionName;
  category: 'Attendance' | 'Employee' | 'User Management';
  description: string;
}

export interface SystemUser {
  id: string;
  loginId: string;
  password: string;
  fullName: string;
  email: string;
  role: UserRole;
  roleId?: string;
  permissions?: PermissionName[];
  customPermissions?: PermissionName[];
  employeeId?: string;
  department?: string;
  active: boolean;
  createdAt: string;
}

export type SessionUser = Omit<SystemUser, 'password'> & {
  permissions: PermissionName[];
  customPermissions?: PermissionName[];
  isManager?: boolean;
  entityType?: 'Employee' | 'Consultant' | 'Retainer' | 'Freelancer' | 'Young Research Program' | 'Intern';
  entityId?: string;
  themePreference?: string;
};
