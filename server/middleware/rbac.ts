import type { NextFunction, Request, Response } from 'express';
import { hasAnyPermission, hasPermission, type PermissionName } from '../../src/auth/permissions.ts';
import { getSessionUserById, type AppDatabase } from '../../src/db/sqlite.ts';
import type { Employee } from '../../src/types/asset.ts';
import type { SessionUser } from '../../src/types/user.ts';
import { verifyJwt } from '../security.ts';

export interface AuthenticatedRequest extends Request {
  authUser?: SessionUser;
  authToken?: string;
}

export function requireAuth(db: AppDatabase) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const token = authHeader.slice('Bearer '.length).trim();
    const decoded = verifyJwt(token, db);
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired session token' });
    }

    const user = getSessionUserById(db, decoded.sub);
    if (!user || !user.active) {
      return res.status(401).json({ error: 'Account inactive or not found' });
    }

    req.authUser = user;
    req.authToken = token;
    return next();
  };
}

export function requirePermission(permission: PermissionName) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!hasPermission(req.authUser, permission)) {
      return res.status(403).json({
        error: 'Access Denied',
        message: `Missing required permission: ${permission}`,
        requiredPermission: permission,
      });
    }
    return next();
  };
}

export function requireAnyPermission(permissions: readonly PermissionName[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!hasAnyPermission(req.authUser, permissions)) {
      return res.status(403).json({
        error: 'Access Denied',
        message: `Missing one of required permissions: ${permissions.join(', ')}`,
      });
    }
    return next();
  };
}

export function isOrgWideAttendanceRole(user: SessionUser): boolean {
  return (
    user.role === 'Super Admin' ||
    user.role === 'Administrator' ||
    user.role === 'HR Manager' ||
    user.role === 'Auditor'
  );
}

export function canUserAccessEmployee(
  user: SessionUser,
  employee: Pick<Employee, 'id' | 'employeeId' | 'department'> & {
    reportingManagerId?: string;
    reportingManagerEmail?: string;
  }
): boolean {
  if (isOrgWideAttendanceRole(user)) {
    return true;
  }
  const userEmpKey = user.employeeId?.trim().toUpperCase();
  const userEntityKey = user.entityId?.trim().toUpperCase();
  const mgrKey = employee.reportingManagerId?.trim().toUpperCase();
  if (mgrKey && ((userEmpKey && mgrKey === userEmpKey) || (userEntityKey && mgrKey === userEntityKey))) {
    return true;
  }
  if (
    user.email &&
    employee.reportingManagerEmail &&
    employee.reportingManagerEmail.trim().toLowerCase() === user.email.trim().toLowerCase()
  ) {
    return true;
  }
  if (user.role === 'Department Manager' || user.role === 'Manager') {
    if (user.department && employee.department) {
      return user.department.trim().toLowerCase() === employee.department.trim().toLowerCase();
    }
    return false;
  }
  // Employee or custom role with employeeId: own record only
  if (userEmpKey) {
    return (
      employee.id.trim().toUpperCase() === userEmpKey ||
      (employee.employeeId || '').trim().toUpperCase() === userEmpKey
    );
  }
  return false;
}

export function filterEmployeesForUser<
  T extends Pick<Employee, 'id' | 'employeeId' | 'department'> & {
    reportingManagerId?: string;
    reportingManagerEmail?: string;
  }
>(
  user: SessionUser,
  employees: T[]
): T[] {
  return employees.filter((emp) => canUserAccessEmployee(user, emp));
}
