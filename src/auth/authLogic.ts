import type { SessionUser, SystemUser } from '../types/user';
import { SEED_USERS } from '../data/seedData';

export const USERS_STORAGE_KEY = 'assetos.users';
export const SESSION_STORAGE_KEY = 'assetos.session';
export const INVALID_CREDENTIALS_ERROR = 'Invalid login ID or password.';
export const INACTIVE_USER_ERROR = 'Your account is inactive. Please contact an administrator.';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function getDefaultStorage(): StorageLike | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
}

export function generateUserId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `usr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeLoginId(loginId: string): string {
  return loginId.trim().toLowerCase();
}

export function toSessionUser(user: SystemUser): SessionUser {
  const { password: _password, ...safeUser } = user;
  return { ...safeUser, permissions: safeUser.permissions ?? [] };
}

export function loadUsersFromStorage(storage: StorageLike | null = getDefaultStorage()): SystemUser[] {
  const seeded = SEED_USERS.map((u) => ({ ...u }));
  if (!storage) return seeded;

  try {
    const raw = storage.getItem(USERS_STORAGE_KEY);
    if (!raw) {
      storage.setItem(USERS_STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      storage.setItem(USERS_STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    const valid = parsed.filter(
      (u): u is SystemUser =>
        Boolean(u) &&
        typeof u.id === 'string' &&
        typeof u.loginId === 'string' &&
        typeof u.password === 'string' &&
        typeof u.fullName === 'string' &&
        typeof u.email === 'string' &&
        typeof u.role === 'string' &&
        typeof u.active === 'boolean' &&
        typeof u.createdAt === 'string'
    );
    if (valid.length === 0) {
      storage.setItem(USERS_STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    return valid;
  } catch {
    try {
      storage.setItem(USERS_STORAGE_KEY, JSON.stringify(seeded));
    } catch {
      // Ignore storage write errors
    }
    return seeded;
  }
}

export function saveUsersToStorage(
  users: SystemUser[],
  storage: StorageLike | null = getDefaultStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
  } catch {
    // Ignore storage quota errors
  }
}

export type AuthResult =
  | { ok: true; session: SessionUser }
  | { ok: false; error: string };

export function authenticateUser(
  users: SystemUser[],
  loginIdInput: string,
  passwordInput: string
): AuthResult {
  const normalizedInput = normalizeLoginId(loginIdInput);
  if (!normalizedInput || !passwordInput) {
    return { ok: false, error: INVALID_CREDENTIALS_ERROR };
  }

  const matched = users.find((u) => normalizeLoginId(u.loginId) === normalizedInput);
  if (!matched || matched.password !== passwordInput) {
    return { ok: false, error: INVALID_CREDENTIALS_ERROR };
  }

  if (!matched.active) {
    return { ok: false, error: INACTIVE_USER_ERROR };
  }

  return { ok: true, session: toSessionUser(matched) };
}

export function saveSessionToStorage(
  session: SessionUser,
  storage: StorageLike | null = getDefaultStorage()
): void {
  if (!storage) return;
  const safeSession = toSessionUser(session as SystemUser);
  try {
    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(safeSession));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearSessionFromStorage(
  storage: StorageLike | null = getDefaultStorage()
): void {
  if (!storage) return;
  try {
    storage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function loadSessionFromStorage(
  users: SystemUser[],
  storage: StorageLike | null = getDefaultStorage()
): SessionUser | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionUser> | null;
    if (!parsed || typeof parsed.id !== 'string') {
      clearSessionFromStorage(storage);
      return null;
    }

    const matched = users.find((u) => u.id === parsed.id);
    if (!matched || !matched.active) {
      clearSessionFromStorage(storage);
      return null;
    }

    const safeSession = toSessionUser(matched);
    saveSessionToStorage(safeSession, storage);
    return safeSession;
  } catch {
    clearSessionFromStorage(storage);
    return null;
  }
}

export interface SystemUserFormInput {
  loginId: string;
  password: string;
  fullName: string;
  email: string;
  role: SystemUser['role'];
  employeeId?: string;
  active: boolean;
}

export interface SystemUserValidationErrors {
  form?: string;
  loginId?: string;
  password?: string;
  fullName?: string;
  email?: string;
  role?: string;
  employeeId?: string;
}

const VALID_ROLES: ReadonlySet<SystemUser['role']> = new Set([
  'Super Admin',
  'HR Manager',
  'Department Manager',
  'Administrator',
  'Manager',
  'Auditor',
  'Employee',
]);

export function validateSystemUserInput(
  input: SystemUserFormInput,
  existingUsers: SystemUser[],
  editingUser?: SystemUser
): { valid: boolean; errors: SystemUserValidationErrors } {
  const errors: SystemUserValidationErrors = {};

  const loginId = typeof input.loginId === 'string' ? input.loginId.trim() : '';
  const normalizedLogin = normalizeLoginId(loginId);
  if (!loginId) {
    errors.loginId = 'Login ID is required.';
  } else if (loginId.length < 3 || loginId.length > 30) {
    errors.loginId = 'Login ID must be 3–30 characters.';
  } else if (!/^[a-zA-Z0-9._-]+$/.test(loginId)) {
    errors.loginId = 'Login ID may only contain letters, digits, dots (.), underscores (_), and hyphens (-).';
  } else if (
    existingUsers.some(
      (u) => (!editingUser || u.id !== editingUser.id) && normalizeLoginId(u.loginId) === normalizedLogin
    )
  ) {
    errors.loginId = `Login ID "${loginId}" is already in use.`;
  }

  const password = typeof input.password === 'string' ? input.password : '';
  if (!editingUser && !password) {
    errors.password = 'Password is required.';
  } else if (password.length > 0) {
    const hasLetter = /[a-zA-Z]/.test(password);
    const hasDigit = /\d/.test(password);
    const hasSpecial = /[^a-zA-Z0-9]/.test(password);
    if (password.length < 8 || !hasLetter || !hasDigit || !hasSpecial) {
      errors.password =
        'Password must be at least 8 characters and include a letter, a digit, and a special character.';
    }
  }

  const fullName = typeof input.fullName === 'string' ? input.fullName.trim() : '';
  if (!fullName) {
    errors.fullName = 'Full Name is required.';
  }

  const email = typeof input.email === 'string' ? input.email.trim() : '';
  const normalizedEmail = email.toLowerCase();
  if (!email) {
    errors.email = 'Email is required.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'Please enter a valid email address.';
  } else if (
    existingUsers.some(
      (u) => (!editingUser || u.id !== editingUser.id) && u.email.trim().toLowerCase() === normalizedEmail
    )
  ) {
    errors.email = `Email "${email}" is already in use.`;
  }

  if (!VALID_ROLES.has(input.role)) {
    errors.role = 'Please select a valid user role.';
  }

  const employeeId = typeof input.employeeId === 'string' ? input.employeeId.trim() : '';
  if (input.role === 'Employee' && !employeeId) {
    errors.employeeId = 'Please select a linked Employee record.';
  }

  if (editingUser) {
    const otherActiveAdmins = existingUsers.filter(
      (u) => u.id !== editingUser.id && u.role === 'Administrator' && u.active
    );
    const wouldLeaveNoActiveAdmin =
      editingUser.role === 'Administrator' &&
      editingUser.active &&
      (input.role !== 'Administrator' || !input.active) &&
      otherActiveAdmins.length === 0;
    if (wouldLeaveNoActiveAdmin) {
      errors.form = 'At least one active Administrator account must remain in the system.';
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function saveSystemUserRecord(params: {
  input: SystemUserFormInput;
  existingUsers: SystemUser[];
  editingUser?: SystemUser;
  now?: Date;
}):
  | { ok: true; users: SystemUser[]; savedUser: SystemUser; isEdit: boolean }
  | { ok: false; errors: SystemUserValidationErrors } {
  const { input, existingUsers, editingUser, now = new Date() } = params;
  const validation = validateSystemUserInput(input, existingUsers, editingUser);
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }

  const trimmedEmployeeId = typeof input.employeeId === 'string' ? input.employeeId.trim() : '';

  if (editingUser) {
    const updatedUser: SystemUser = {
      ...editingUser,
      loginId: input.loginId.trim(),
      password: input.password ? input.password : editingUser.password,
      fullName: input.fullName.trim(),
      email: input.email.trim(),
      role: input.role,
      employeeId: trimmedEmployeeId || undefined,
      active: input.active,
    };
    return {
      ok: true,
      users: existingUsers.map((u) => (u.id === editingUser.id ? updatedUser : u)),
      savedUser: updatedUser,
      isEdit: true,
    };
  }

  const newUser: SystemUser = {
    id: generateUserId(),
    loginId: input.loginId.trim(),
    password: input.password,
    fullName: input.fullName.trim(),
    email: input.email.trim(),
    role: input.role,
    employeeId: trimmedEmployeeId || undefined,
    active: input.active,
    createdAt: now.toISOString(),
  };

  return {
    ok: true,
    users: [...existingUsers, newUser],
    savedUser: newUser,
    isEdit: false,
  };
}

