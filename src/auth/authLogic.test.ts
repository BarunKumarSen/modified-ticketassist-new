import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INACTIVE_USER_ERROR,
  INVALID_CREDENTIALS_ERROR,
  SESSION_STORAGE_KEY,
  USERS_STORAGE_KEY,
  authenticateUser,
  clearSessionFromStorage,
  loadSessionFromStorage,
  loadUsersFromStorage,
  saveSessionToStorage,
  saveSystemUserRecord,
  toSessionUser,
  validateSystemUserInput,
  type StorageLike,
} from './authLogic';
import {
  SEED_ADMIN_LOGIN_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_ROLE,
  SEED_ADMIN_USER,
} from '../data/seedData';
import type { SystemUser } from '../types/user';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, val: string) => {
      map.set(key, val);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

test('loadUsersFromStorage seeds default Administrator under assetos.users on first load', () => {
  const storage = createMemoryStorage();
  const users = loadUsersFromStorage(storage);

  assert.equal(users.length, 1);
  assert.equal(users[0].loginId, SEED_ADMIN_LOGIN_ID);
  assert.equal(users[0].password, SEED_ADMIN_PASSWORD);
  assert.equal(users[0].role, SEED_ADMIN_ROLE);
  assert.equal(users[0].active, true);

  const rawStored = storage.getItem(USERS_STORAGE_KEY);
  assert.ok(rawStored);
  const parsed = JSON.parse(rawStored);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].loginId, 'admin');
});

test('authenticateUser matches loginId case-insensitively and strips password from session', () => {
  const users: SystemUser[] = [SEED_ADMIN_USER];
  const res = authenticateUser(users, '  ADMIN  ', SEED_ADMIN_PASSWORD);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.session.loginId, 'admin');
    assert.equal(res.session.role, 'Administrator');
    assert.equal('password' in res.session, false);
  }
});

test('authenticateUser gives identical generic error whether loginId or password is wrong', () => {
  const users: SystemUser[] = [SEED_ADMIN_USER];

  const wrongId = authenticateUser(users, 'nonexistent', SEED_ADMIN_PASSWORD);
  const wrongPw = authenticateUser(users, 'admin', 'WrongPass@1');
  const emptyFields = authenticateUser(users, '', '');

  assert.equal(wrongId.ok, false);
  assert.equal(wrongPw.ok, false);
  assert.equal(emptyFields.ok, false);
  if (!wrongId.ok && !wrongPw.ok && !emptyFields.ok) {
    assert.equal(wrongId.error, INVALID_CREDENTIALS_ERROR);
    assert.equal(wrongPw.error, INVALID_CREDENTIALS_ERROR);
    assert.equal(emptyFields.error, INVALID_CREDENTIALS_ERROR);
  }
});

test('authenticateUser blocks inactive users without leaking credentials on wrong password', () => {
  const inactiveUser: SystemUser = {
    ...SEED_ADMIN_USER,
    id: '00000000-0000-4000-8000-000000000002',
    loginId: 'jdoe',
    password: 'User@1234',
    role: 'Employee',
    active: false,
  };

  const wrongPw = authenticateUser([inactiveUser], 'jdoe', 'badpass');
  assert.equal(wrongPw.ok, false);
  if (!wrongPw.ok) {
    assert.equal(wrongPw.error, INVALID_CREDENTIALS_ERROR);
  }

  const rightPw = authenticateUser([inactiveUser], 'JDOE', 'User@1234');
  assert.equal(rightPw.ok, false);
  if (!rightPw.ok) {
    assert.equal(rightPw.error, INACTIVE_USER_ERROR);
  }
});

test('session storage never stores password and invalidates tampered or inactive sessions', () => {
  const storage = createMemoryStorage();
  const users = loadUsersFromStorage(storage);
  const safeSession = toSessionUser(users[0]);

  // Defensive check: even if password were present on an object passed in, saveSessionToStorage strips it
  saveSessionToStorage({ ...safeSession, password: 'secret' } as unknown as typeof safeSession, storage);
  const raw = storage.getItem(SESSION_STORAGE_KEY);
  assert.ok(raw);
  assert.equal(raw.includes('secret'), false);
  assert.equal(raw.includes(SEED_ADMIN_PASSWORD), false);

  // Tampering role in localStorage cannot escalate or alter role because loadSessionFromStorage resolves from users
  storage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({ ...safeSession, role: 'Employee' })
  );
  const loaded = loadSessionFromStorage(users, storage);
  assert.ok(loaded);
  assert.equal(loaded.role, 'Administrator');

  // Deactivating the user invalidates stored session
  const deactivated = [{ ...users[0], active: false }];
  assert.equal(loadSessionFromStorage(deactivated, storage), null);
  assert.equal(storage.getItem(SESSION_STORAGE_KEY), null);

  // Clear session removes key
  saveSessionToStorage(safeSession, storage);
  clearSessionFromStorage(storage);
  assert.equal(storage.getItem(SESSION_STORAGE_KEY), null);
});

test('validateSystemUserInput and saveSystemUserRecord support creating and editing employee/user roles', () => {
  const initialUsers: SystemUser[] = [{ ...SEED_ADMIN_USER }];

  // Duplicate loginId & weak password rejected on create
  const invalidCreate = validateSystemUserInput(
    {
      loginId: 'ADMIN',
      password: 'weak',
      fullName: 'Rahim Ahmed',
      email: SEED_ADMIN_USER.email.toUpperCase(),
      role: 'Employee',
      employeeId: '',
      active: true,
    },
    initialUsers
  );
  assert.equal(invalidCreate.valid, false);
  assert.ok(invalidCreate.errors.loginId);
  assert.ok(invalidCreate.errors.password);
  assert.ok(invalidCreate.errors.email);
  assert.ok(invalidCreate.errors.employeeId);

  // Create Employee user
  const created = saveSystemUserRecord({
    input: {
      loginId: 'rahim',
      password: 'Rahim@123',
      fullName: 'Rahim Ahmed',
      email: 'rahim@company.com',
      role: 'Employee',
      employeeId: 'EMP001',
      active: true,
    },
    existingUsers: initialUsers,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.isEdit, false);
  assert.equal(created.users.length, 2);
  assert.equal(created.savedUser.role, 'Employee');
  assert.equal(created.savedUser.employeeId, 'EMP001');

  // Edit Employee user in future to act as Manager while keeping password blank (preserved)
  const promoted = saveSystemUserRecord({
    input: {
      loginId: 'rahim',
      password: '',
      fullName: 'Rahim Ahmed',
      email: 'rahim@company.com',
      role: 'Manager',
      employeeId: 'EMP001',
      active: true,
    },
    existingUsers: created.users,
    editingUser: created.savedUser,
  });
  assert.equal(promoted.ok, true);
  if (!promoted.ok) return;
  assert.equal(promoted.isEdit, true);
  assert.equal(promoted.savedUser.id, created.savedUser.id);
  assert.equal(promoted.savedUser.password, 'Rahim@123');
  assert.equal(promoted.savedUser.role, 'Manager');
  assert.equal(promoted.savedUser.employeeId, 'EMP001');

  // Cannot demote or deactivate the sole remaining active Administrator
  const demoteAdmin = saveSystemUserRecord({
    input: {
      loginId: SEED_ADMIN_USER.loginId,
      password: '',
      fullName: SEED_ADMIN_USER.fullName,
      email: SEED_ADMIN_USER.email,
      role: 'Manager',
      active: true,
    },
    existingUsers: promoted.users,
    editingUser: SEED_ADMIN_USER,
  });
  assert.equal(demoteAdmin.ok, false);
  if (!demoteAdmin.ok) {
    assert.ok(demoteAdmin.errors.form);
  }
});
