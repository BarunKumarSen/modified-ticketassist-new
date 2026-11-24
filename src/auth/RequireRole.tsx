import React, { useEffect } from 'react';
import { ShieldAlert } from 'lucide-react';
import type { UserRole } from '../types/user';
import type { PermissionName } from './permissions';
import { useSession } from './SessionContext';

interface RequireRoleProps {
  roles: UserRole[];
  children: React.ReactNode;
  onUnauthorized?: () => void;
  showForbiddenFallback?: boolean;
}

interface RequirePermissionProps {
  permission?: PermissionName;
  anyOf?: readonly PermissionName[];
  children: React.ReactNode;
  onReturnAllowed?: () => void;
}

export const AccessDeniedCard: React.FC<{
  roleName: string;
  requiredDetail?: string;
  onReturnAllowed?: () => void;
}> = ({ roleName, requiredDetail, onReturnAllowed }) => (
  <div
    role="alert"
    className="max-w-lg mx-auto mt-12 bg-white rounded-2xl border border-rose-200 shadow-sm p-8 text-center space-y-4"
  >
    <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-700 mx-auto flex items-center justify-center">
      <ShieldAlert className="w-6 h-6" />
    </div>
    <div>
      <p className="text-xs font-bold uppercase tracking-widest text-rose-600">403 Forbidden</p>
      <h2 className="text-lg font-extrabold text-slate-900 mt-1">Access Denied</h2>
      <p className="text-xs text-slate-600 mt-1.5">
        Your current role ({roleName}) does not have permission to view this page
        {requiredDetail ? ` (${requiredDetail})` : ''}.
      </p>
    </div>
    {onReturnAllowed && (
      <button
        type="button"
        onClick={onReturnAllowed}
        className="px-4 py-2 bg-[#3f3f46] hover:bg-[#27272a] text-white rounded-lg text-xs font-semibold cursor-pointer"
      >
        Return to Allowed View
      </button>
    )}
  </div>
);

/**
 * Guards protected screens using ONLY the role stored in SessionContext.
 * Never trusts role values passed via props or URL parameters.
 */
export const RequireRole: React.FC<RequireRoleProps> = ({
  roles,
  children,
  onUnauthorized,
  showForbiddenFallback = false,
}) => {
  const { session } = useSession();

  const isAuthorized = Boolean(session && roles.includes(session.role));

  useEffect(() => {
    if (!isAuthorized && onUnauthorized && !showForbiddenFallback) {
      onUnauthorized();
    }
  }, [isAuthorized, onUnauthorized, showForbiddenFallback]);

  if (!session) {
    return null;
  }

  if (!isAuthorized) {
    if (!showForbiddenFallback) {
      return null;
    }
    return <AccessDeniedCard roleName={session.role} onReturnAllowed={onUnauthorized} />;
  }

  return <>{children}</>;
};

/**
 * Permission-based route/view guard reading effective permissions strictly from SessionContext.
 * Always displays Access Denied when unauthorized rather than silently bypassing.
 */
export const RequirePermission: React.FC<RequirePermissionProps> = ({
  permission,
  anyOf,
  children,
  onReturnAllowed,
}) => {
  const { session, hasPermission, hasAnyPermission } = useSession();

  if (!session) {
    return null;
  }

  const authorized = permission
    ? hasPermission(permission)
    : anyOf && anyOf.length > 0
    ? hasAnyPermission(anyOf)
    : false;

  if (!authorized) {
    const detail = permission || (anyOf ? anyOf.join(' or ') : undefined);
    return (
      <AccessDeniedCard
        roleName={session.role}
        requiredDetail={detail}
        onReturnAllowed={onReturnAllowed}
      />
    );
  }

  return <>{children}</>;
};
