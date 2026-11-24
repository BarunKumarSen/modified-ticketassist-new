import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiClient, ApiError, getStoredToken, setStoredToken } from '../api/client';
import {
  hasAnyPermission as checkAnyPermission,
  hasPermission as checkPermission,
  type PermissionName,
} from './permissions';
import type { ThemePalette } from '../types/asset';
import type { PermissionRecord, RoleRecord, SessionUser } from '../types/user';
import { normalizeThemePalette, THEME_PALETTES } from '../utils/assetMath';

export type AuthResult =
  | { ok: true; session: SessionUser }
  | { ok: false; error: string };

const VISITOR_STORAGE_KEY = 'median.visitorKey';
const THEME_STORAGE_KEY = 'median.theme';

export function getOrCreateVisitorKey(): string {
  try {
    if (typeof window === 'undefined') return 'server-visitor';
    let key = window.localStorage.getItem(VISITOR_STORAGE_KEY);
    if (!key) {
      const rand =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      key = `vis-${rand}`;
      window.localStorage.setItem(VISITOR_STORAGE_KEY, key);
    }
    return key;
  } catch {
    return 'browser-visitor';
  }
}

export function applyThemeToDocument(theme: ThemePalette): void {
  if (typeof document === 'undefined') return;
  const normalized = normalizeThemePalette(theme);
  const tokens = THEME_PALETTES[normalized];
  const root = document.documentElement;
  root.setAttribute('data-theme', tokens.dataTheme);
  if (normalized === 'Dark Mode') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, normalized);
  } catch {
    // Ignore storage quota errors
  }
}

interface SessionContextValue {
  session: SessionUser | null;
  authLoading: boolean;
  users: SessionUser[];
  roles: RoleRecord[];
  permissionsCatalog: PermissionRecord[];
  theme: ThemePalette;
  setThemePreference: (theme: ThemePalette, persistToUser?: boolean) => Promise<void>;
  login: (loginId: string, password: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
  refreshRbacData: () => Promise<void>;
  hasPermission: (permission: PermissionName) => boolean;
  hasAnyPermission: (permissions: readonly PermissionName[]) => boolean;
  setUsers: React.Dispatch<React.SetStateAction<SessionUser[]>>;
  setRoles: React.Dispatch<React.SetStateAction<RoleRecord[]>>;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<SessionUser | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(() => Boolean(getStoredToken()));
  const [users, setUsers] = useState<SessionUser[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [permissionsCatalog, setPermissionsCatalog] = useState<PermissionRecord[]>([]);
  const [theme, setTheme] = useState<ThemePalette>(() => {
    try {
      const saved = typeof window !== 'undefined' ? window.localStorage.getItem(THEME_STORAGE_KEY) : null;
      return normalizeThemePalette(saved);
    } catch {
      return 'Corporate Blue';
    }
  });

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  const setThemePreference = useCallback(
    async (nextTheme: ThemePalette, persistToUser = true) => {
      const normalized = normalizeThemePalette(nextTheme);
      setTheme(normalized);
      applyThemeToDocument(normalized);
      if (persistToUser && session) {
        try {
          const res = await apiClient.updateMyTheme(normalized);
          if (res.user) setSession(res.user);
        } catch {
          // Non-fatal if offline
        }
      }
    },
    [session]
  );

  // Record a unique daily site visit per browser key on initial app load
  useEffect(() => {
    const vKey = getOrCreateVisitorKey();
    void apiClient.recordSiteVisit(vKey).catch(() => undefined);
  }, []);

  // Live online user presence heartbeat every 30s while authenticated
  useEffect(() => {
    if (!session) return;
    const vKey = getOrCreateVisitorKey();
    void apiClient.sendPresenceHeartbeat(vKey).catch(() => undefined);
    const timer = window.setInterval(() => {
      void apiClient.sendPresenceHeartbeat(vKey).catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [session?.id]);

  const loadRbacForSession = useCallback(async (activeSession: SessionUser) => {
    try {
      const rolesRes = await apiClient.listRoles();
      setRoles(rolesRes.roles);
    } catch {
      setRoles([]);
    }

    if (
      checkAnyPermission(activeSession, [
        'user.view',
        'user.create',
        'user.edit',
        'role.manage',
      ])
    ) {
      try {
        const permRes = await apiClient.listPermissions();
        setPermissionsCatalog(permRes.permissions);
      } catch {
        setPermissionsCatalog([]);
      }
    } else {
      setPermissionsCatalog([]);
    }

    if (checkPermission(activeSession, 'user.view')) {
      try {
        const usersRes = await apiClient.listUsers();
        setUsers(usersRes.users);
      } catch {
        setUsers([]);
      }
    } else {
      setUsers([]);
    }
  }, []);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setAuthLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { user } = await apiClient.me();
        if (cancelled) return;
        setSession(user);
        if (user.themePreference) {
          setTheme(normalizeThemePalette(user.themePreference));
        }
        await loadRbacForSession(user);
      } catch {
        if (cancelled) return;
        setStoredToken(null);
        setSession(null);
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadRbacForSession]);

  const login = useCallback(
    async (loginId: string, password: string): Promise<AuthResult> => {
      try {
        const vKey = getOrCreateVisitorKey();
        const { token, user } = await apiClient.login(loginId, password, vKey);
        setStoredToken(token);
        setSession(user);
        if (user.themePreference) {
          setTheme(normalizeThemePalette(user.themePreference));
        }
        await loadRbacForSession(user);
        return { ok: true, session: user };
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : 'Unable to sign in right now. Please try again.';
        return { ok: false, error: message };
      }
    },
    [loadRbacForSession]
  );

  const logout = useCallback(async () => {
    const tokenToRevoke = getStoredToken();
    setStoredToken(null);
    setSession(null);
    setUsers([]);
    setRoles([]);
    setPermissionsCatalog([]);
    if (!tokenToRevoke) return;
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenToRevoke}` },
      });
    } catch {
      // Ignore network errors on sign out
    }
  }, []);

  const refreshRbacData = useCallback(async () => {
    if (!session) return;
    const { user } = await apiClient.me();
    setSession(user);
    if (user.themePreference) {
      setTheme(normalizeThemePalette(user.themePreference));
    }
    await loadRbacForSession(user);
  }, [session, loadRbacForSession]);

  const hasPermission = useCallback(
    (permission: PermissionName) => checkPermission(session, permission),
    [session]
  );

  const hasAnyPermission = useCallback(
    (permissions: readonly PermissionName[]) => checkAnyPermission(session, permissions),
    [session]
  );

  return (
    <SessionContext.Provider
      value={{
        session,
        authLoading,
        users,
        roles,
        permissionsCatalog,
        theme,
        setThemePreference,
        login,
        logout,
        refreshRbacData,
        hasPermission,
        hasAnyPermission,
        setUsers,
        setRoles,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
};

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return ctx;
}
