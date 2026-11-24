import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Building2,
  CheckSquare,
  Download,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  AssetOSState,
  CompanySettings,
  ModalType,
  SystemAuditLog,
  ThemePalette,
} from '../types/asset';
import type { EmployeeCenterRecord } from '../types/policy';
import type { RoleRecord, SessionUser } from '../types/user';
import {
  PERMISSION_DEFINITIONS,
  type PermissionName,
} from '../auth/permissions';
import { apiClient, ApiError } from '../api/client';
import { THEME_PALETTES } from '../utils/assetMath';
import { resolveCenterOfficeInfo } from '../utils/entityValidation';
import { useSession } from '../auth/SessionContext';
import { ModalShell } from './AssetModals';

interface SettingsViewProps {
  state: AssetOSState;
  centers?: EmployeeCenterRecord[];
  onCentersUpdated?: () => void;
  onNotify?: (message: string, type?: 'success' | 'error' | 'info') => void;
  onSaveSettings: (settings: CompanySettings) => void;
  onSelectTheme: (theme: ThemePalette) => void;
  onOpenModal: (modal: ModalType) => void;
  onDeleteUser: (user: SessionUser) => void;
  onResetUserPassword?: (user: SessionUser) => void;
  onSaveRolePermissions: (roleId: string, permissions: PermissionName[]) => Promise<boolean>;
  onExportBackup: () => Promise<void> | void;
  onRestoreBackup: (jsonText: string, mode: 'merge' | 'replace') => Promise<void> | void;
  onResetAllData: () => void;
}

const PALETTE_OPTIONS: Array<{
  name: ThemePalette;
  desc: string;
  swatch: string;
  classes: string;
}> = [
  {
    name: 'Corporate Blue',
    desc: 'Crisp navy & cobalt enterprise theme',
    swatch: '#1d4ed8',
    classes: 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800',
  },
  {
    name: 'Emerald Green',
    desc: 'Fresh operational & research palette',
    swatch: '#047857',
    classes: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800',
  },
  {
    name: 'Royal Purple',
    desc: 'Executive violet & slate palette',
    swatch: '#7e22ce',
    classes: 'bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800',
  },
  {
    name: 'Dark Mode',
    desc: 'Low-glare slate dark workspace',
    swatch: '#0f172a',
    classes: 'bg-slate-900 text-slate-100 border-slate-700',
  },
];

const PERMISSION_CATEGORIES: Array<'Attendance' | 'Employee' | 'User Management'> = [
  'Attendance',
  'Employee',
  'User Management',
];

export const SettingsView: React.FC<SettingsViewProps> = ({
  state,
  centers = [],
  onCentersUpdated,
  onNotify,
  onSaveSettings,
  onSelectTheme,
  onOpenModal,
  onDeleteUser,
  onResetUserPassword,
  onSaveRolePermissions,
  onExportBackup,
  onRestoreBackup,
  onResetAllData,
}) => {
  const { users, roles, session, theme, setThemePreference, hasPermission, hasAnyPermission } =
    useSession();
  const [form, setForm] = useState<CompanySettings>(state.settings);
  const [restoreMode, setRestoreMode] = useState<'merge' | 'replace'>('merge');
  const [auditLogs, setAuditLogs] = useState<SystemAuditLog[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [centerModal, setCenterModal] = useState<{
    id?: string;
    cityName: string;
    stateName: string;
    centerCode: string;
    officialAddress: string;
    phone: string;
  } | null>(null);
  const [savingCenter, setSavingCenter] = useState(false);
  const [centerError, setCenterError] = useState('');
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const activeTheme = theme || state.settings.theme;
  const palette = THEME_PALETTES[activeTheme];

  useEffect(() => {
    setForm(state.settings);
  }, [state.settings]);

  const isSuperAdmin =
    session?.role === 'Super Admin' || session?.role === 'Administrator';
  const canViewUsers = hasPermission('user.view');
  const canCreateUser = hasPermission('user.create');
  const canEditUser = hasPermission('user.edit');
  const canDeleteUser = hasPermission('user.delete');
  const canManageRoles = hasPermission('role.manage');
  const showUserCard = hasAnyPermission([
    'user.view',
    'user.create',
    'user.edit',
    'user.delete',
  ]);

  const loadAuditLogs = async () => {
    setLoadingAudit(true);
    try {
      const res = await apiClient.listSystemAuditLogs(100);
      setAuditLogs(res.logs);
    } catch {
      setAuditLogs([]);
    } finally {
      setLoadingAudit(false);
    }
  };

  useEffect(() => {
    if (isSuperAdmin || canManageRoles) {
      void loadAuditLogs();
    }
  }, [isSuperAdmin, canManageRoles]);

  const [selectedRoleId, setSelectedRoleId] = useState<string>(roles[0]?.id || 'role_hr_manager');
  const [roleDraftPerms, setRoleDraftPerms] = useState<PermissionName[]>([]);
  const [savingRole, setSavingRole] = useState(false);

  const selectedRole: RoleRecord | undefined =
    roles.find((r) => r.id === selectedRoleId) || roles[0];

  useEffect(() => {
    if (roles.length > 0 && !roles.some((r) => r.id === selectedRoleId)) {
      setSelectedRoleId(roles[0].id);
    }
  }, [roles, selectedRoleId]);

  useEffect(() => {
    if (selectedRole) {
      setRoleDraftPerms(selectedRole.permissions);
    }
  }, [selectedRole]);

  const handleToggleRolePerm = (perm: PermissionName) => {
    setRoleDraftPerms((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  const handleSaveRoleClick = async () => {
    if (!selectedRole) return;
    setSavingRole(true);
    try {
      await onSaveRolePermissions(selectedRole.id, roleDraftPerms);
    } finally {
      setSavingRole(false);
    }
  };

  const handleSubmitProfile = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings({ ...form, theme: state.settings.theme });
  };

  const handleSaveCenterModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!centerModal || savingCenter) return;
    if (!centerModal.cityName.trim()) {
      setCenterError('Center City Name is required.');
      return;
    }
    setSavingCenter(true);
    setCenterError('');
    try {
      if (centerModal.id) {
        await apiClient.updateCenter(centerModal.id, {
          cityName: centerModal.cityName.trim(),
          stateName: centerModal.stateName.trim(),
          centerCode: centerModal.centerCode.trim().toUpperCase(),
          officialAddress: centerModal.officialAddress.trim(),
          phone: centerModal.phone.trim(),
        });
        onNotify?.(`Updated center letterhead for ${centerModal.cityName.trim()}`);
      } else {
        await apiClient.createCenter({
          cityName: centerModal.cityName.trim(),
          stateName: centerModal.stateName.trim(),
          centerCode: centerModal.centerCode.trim().toUpperCase(),
          officialAddress: centerModal.officialAddress.trim(),
          phone: centerModal.phone.trim(),
        });
        onNotify?.(`Created center ${centerModal.cityName.trim()}`);
      }
      setCenterModal(null);
      onCentersUpdated?.();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to save center details';
      setCenterError(msg);
      onNotify?.(msg, 'error');
    } finally {
      setSavingCenter(false);
    }
  };

  return (
    <div className="space-y-4 pb-10">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">
          {isSuperAdmin ? 'Settings & Access Control' : 'User & Role Management'}
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          {isSuperAdmin
            ? 'Manage RBAC users, role permissions, and system configuration'
            : 'Manage system user accounts and role assignments'}
        </p>
      </div>

      {/* User Management + Backup/Restore */}
      {showUserCard && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div
            className={`${
              isSuperAdmin ? 'lg:col-span-2' : 'lg:col-span-3'
            } bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 space-y-4`}
          >
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-2">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">User Management</h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Assign predefined roles and granular custom permissions stored in SQLite
                </p>
              </div>
              {canCreateUser && (
                <button
                  type="button"
                  onClick={() => onOpenModal({ type: 'user' })}
                  className={`px-3 py-1.5 ${palette.primaryBtn} ${palette.primaryBtnHover} rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer`}
                >
                  <Plus className="w-3.5 h-3.5" /> Add User
                </button>
              )}
            </div>

            {canViewUsers ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#3f3f46] text-white text-[10px] font-bold uppercase tracking-wider">
                      <th className="px-3 py-2">Login ID</th>
                      <th className="px-3 py-2">Full Name</th>
                      <th className="px-3 py-2">Role & Scope</th>
                      <th className="px-3 py-2">Permissions</th>
                      <th className="px-3 py-2">Status</th>
                      {(canEditUser || canDeleteUser) && (
                        <th className="px-3 py-2 text-right">Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="text-xs divide-y divide-slate-100">
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td className="px-3 py-2 font-mono text-slate-600">{u.loginId}</td>
                        <td className="px-3 py-2">
                          <span className="font-bold text-slate-800 block">{u.fullName}</span>
                          <span className="text-[10px] text-slate-400">{u.email}</span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-semibold text-slate-800 block">{u.role}</span>
                          <span className="text-[10px] font-mono text-slate-400">
                            {[u.department, u.employeeId].filter(Boolean).join(' · ') || 'Global'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold text-[10px] tabular-nums">
                            {u.permissions.length} granted
                          </span>
                          {u.customPermissions && u.customPermissions.length > 0 && (
                            <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[9px] font-semibold">
                              +{u.customPermissions.length} custom
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`px-2 py-0.5 rounded font-bold text-[9px] border ${
                              u.active
                                ? 'bg-[#dcfce7] text-[#166534] border-[#bbf7d0]'
                                : 'bg-slate-100 text-slate-500 border-slate-200'
                            }`}
                          >
                            {u.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        {(canEditUser || canDeleteUser) && (
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              {canEditUser && (
                                <>
                                  <button
                                    type="button"
                                    aria-label={`Edit user ${u.fullName}`}
                                    title="Edit User"
                                    onClick={() => onOpenModal({ type: 'user', userId: u.id })}
                                    className="w-6 h-6 rounded bg-[#ffedd5] text-[#c2410c] hover:bg-[#fed7aa] inline-flex items-center justify-center cursor-pointer"
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                  {onResetUserPassword && (
                                    <button
                                      type="button"
                                      aria-label={`Reset password for ${u.fullName}`}
                                      title="Send Password Reset Email"
                                      onClick={() => onResetUserPassword(u)}
                                      className="w-6 h-6 rounded bg-[#dbeafe] text-[#1e40af] hover:bg-[#bfdbfe] inline-flex items-center justify-center cursor-pointer"
                                    >
                                      <KeyRound className="w-3 h-3" />
                                    </button>
                                  )}
                                </>
                              )}
                              {canDeleteUser && (
                                <button
                                  type="button"
                                  aria-label={`Delete user ${u.fullName}`}
                                  title="Delete User"
                                  disabled={users.length <= 1 || u.id === session?.id}
                                  onClick={() => onDeleteUser(u)}
                                  className="w-6 h-6 rounded bg-[#fce7f3] text-[#be185d] hover:bg-[#fbcfe8] disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center justify-center cursor-pointer"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300">
                You have permission to create users, but not view the full user directory. Use{' '}
                <strong>Add User</strong> above to provision a new account.
              </div>
            )}
          </div>

          {isSuperAdmin && (
            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 space-y-4">
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 border-b border-slate-100 dark:border-slate-800 pb-2">
                Enterprise Backup &amp; Restore
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Export all SQLite modules (Employees, Assets, Departments, Settings, Users, Roles, Permissions, Attendance, Logs, Attachments) or restore safely.
              </p>
              <div className="flex flex-col space-y-3">
                <button
                  type="button"
                  onClick={() => void onExportBackup()}
                  className={`${palette.primaryBtn} ${palette.primaryBtnHover} w-full px-4 py-2 rounded-lg text-xs font-bold shadow-sm flex items-center justify-center gap-2 cursor-pointer`}
                >
                  <Download className="w-3.5 h-3.5" /> Export Full Backup
                </button>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Restore Mode
                  </label>
                  <select
                    aria-label="Restore Mode"
                    value={restoreMode}
                    onChange={(e) => setRestoreMode(e.target.value as 'merge' | 'replace')}
                    className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none"
                  >
                    <option value="merge">Safe Merge (Preserve existing records)</option>
                    <option value="replace">Full Replace (Overwrite workspace tables)</option>
                  </select>
                </div>

                <input
                  ref={restoreInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      if (typeof reader.result === 'string') {
                        void onRestoreBackup(reader.result, restoreMode);
                      }
                    };
                    reader.readAsText(file);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => restoreInputRef.current?.click()}
                  className="w-full px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-bold shadow-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" /> Restore Backup
                </button>

                <button
                  type="button"
                  onClick={onResetAllData}
                  className="w-full px-4 py-2 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 rounded-lg text-xs font-bold shadow-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Clear Local Cache
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Role & Permission Matrix */}
      {canManageRoles && roles.length > 0 && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">Role &amp; Permission Matrix</h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Configure default permissions for each predefined system role
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <select
                aria-label="Select role to configure"
                value={selectedRole?.id || ''}
                onChange={(e) => setSelectedRoleId(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none"
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.roleName} ({r.permissions.length})
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={savingRole || !selectedRole}
                onClick={handleSaveRoleClick}
                className={`${palette.primaryBtn} ${palette.primaryBtnHover} disabled:opacity-50 px-4 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer`}
              >
                <Save className="w-3.5 h-3.5" />
                <span>{savingRole ? 'Saving...' : 'Save Role Permissions'}</span>
              </button>
            </div>
          </div>

          {selectedRole && (
            <>
              <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2 rounded-lg">
                <strong>{selectedRole.roleName}:</strong> {selectedRole.description}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {PERMISSION_CATEGORIES.map((category) => {
                  const items = PERMISSION_DEFINITIONS.filter((p) => p.category === category);
                  return (
                    <div
                      key={category}
                      className="border border-slate-200 rounded-xl p-3 bg-slate-50/60 space-y-2"
                    >
                      <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
                          {category}
                        </span>
                        <CheckSquare className="w-3.5 h-3.5 text-slate-400" />
                      </div>
                      <div className="space-y-2">
                        {items.map((perm) => {
                          const checked = roleDraftPerms.includes(perm.name);
                          const locked =
                            selectedRole.id === 'role_super_admin' && perm.name === 'role.manage';
                          return (
                            <label
                              key={perm.id}
                              className="flex items-start gap-2 text-xs cursor-pointer select-none"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={locked}
                                onChange={() => handleToggleRolePerm(perm.name)}
                                className="mt-0.5 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                              />
                              <div>
                                <span className="font-mono font-semibold text-slate-800 block">
                                  {perm.name}
                                </span>
                                <span className="text-[10px] text-slate-500 leading-tight block">
                                  {perm.description}
                                </span>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Company Profile + Theme Management */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {isSuperAdmin && (
          <form
            onSubmit={handleSubmitProfile}
            className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 space-y-4"
          >
            <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 border-b border-slate-100 dark:border-slate-800 pb-2">
              Company Profile
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 md:col-span-1">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Company Name
                </label>
                <input
                  type="text"
                  value={form.companyName}
                  onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div className="col-span-2 md:col-span-1">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  GST Number
                </label>
                <input
                  type="text"
                  value={form.gstNumber}
                  onChange={(e) => setForm({ ...form, gstNumber: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Phone
                </label>
                <input
                  type="text"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Address
                </label>
                <textarea
                  rows={2}
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Financial Year
                </label>
                <input
                  type="text"
                  value={form.financialYear}
                  onChange={(e) => setForm({ ...form, financialYear: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Currency Symbol
                </label>
                <select
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs focus:outline-none"
                >
                  <option value="$">USD ($)</option>
                  <option value="₹">INR (₹)</option>
                  <option value="৳">BDT (৳)</option>
                  <option value="€">EUR (€)</option>
                  <option value="£">GBP (£)</option>
                </select>
              </div>
            </div>
            <button
              type="submit"
              className={`${palette.primaryBtn} ${palette.primaryBtnHover} px-4 py-2 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer`}
            >
              <Save className="w-3.5 h-3.5" /> Save Profile
            </button>
          </form>
        )}

        <div
          className={`${
            isSuperAdmin ? '' : 'lg:col-span-2'
          } bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 space-y-4`}
        >
          <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 border-b border-slate-100 dark:border-slate-800 pb-2">
            Theme Management System
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Select your workspace theme. Preferences apply immediately and sync to your user profile.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {PALETTE_OPTIONS.map((opt) => {
              const active = activeTheme === opt.name;
              return (
                <button
                  key={opt.name}
                  type="button"
                  onClick={() => {
                    void setThemePreference(opt.name, true);
                    if (isSuperAdmin) {
                      onSelectTheme(opt.name);
                    }
                  }}
                  className={`p-3 rounded-xl text-left border transition-all cursor-pointer flex items-start gap-2.5 ${
                    active
                      ? `${palette.primaryBtn} border-transparent ring-2 ring-offset-2 ring-blue-500 shadow-sm`
                      : `${opt.classes} hover:opacity-90`
                  }`}
                >
                  <span
                    className="w-4 h-4 rounded-full border border-white/40 shrink-0 mt-0.5"
                    style={{ backgroundColor: opt.swatch }}
                  />
                  <div>
                    <span className="text-xs font-bold block">{opt.name}</span>
                    <span className={`text-[10px] block ${active ? 'text-white/80' : 'opacity-75'}`}>
                      {opt.desc}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 dark:text-slate-400">Live Theme Preview</span>
              <span className="font-bold text-slate-900 dark:text-white">{activeTheme}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-1 rounded text-[11px] font-bold ${palette.primaryBtn}`}>
                Primary Action
              </span>
              <span className={`text-[11px] font-bold ${palette.accentText}`}>
                Accent Highlight
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Center Master & Allotment Letterhead Directory */}
      {isSuperAdmin && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-blue-700 dark:text-sky-400" />
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  Center Master &amp; Allotment Letterhead Directory
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Official office addresses &amp; telephone numbers dynamically rendered on Freelancer IT Allotment forms
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setCenterError('');
                setCenterModal({
                  cityName: '',
                  stateName: '',
                  centerCode: '',
                  officialAddress: '',
                  phone: '',
                });
              }}
              className={`px-3 py-1.5 ${palette.primaryBtn} ${palette.primaryBtnHover} rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer self-start sm:self-auto`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Center</span>
            </button>
          </div>

          <div className="overflow-x-auto max-h-72 overflow-y-auto border border-slate-200 rounded-xl">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-[#3f3f46] text-white sticky top-0 text-[10px] font-bold uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-2">Center</th>
                  <th className="px-3 py-2">Code / State</th>
                  <th className="px-3 py-2">Official Letterhead Address</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2 text-right">Edit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {centers.map((c) => {
                  const resolved = resolveCenterOfficeInfo(c.name, centers);
                  return (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-bold text-slate-900 whitespace-nowrap">
                        {c.name}
                      </td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                        <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 mr-1">
                          {c.centerCode || '—'}
                        </span>
                        {c.stateRegion}
                      </td>
                      <td className="px-3 py-2 text-slate-700 max-w-md">{resolved.address}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                        {resolved.phone}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          aria-label={`Edit center ${c.name}`}
                          onClick={() => {
                            setCenterError('');
                            setCenterModal({
                              id: c.id,
                              cityName: c.name,
                              stateName: c.stateRegion || '',
                              centerCode: c.centerCode || '',
                              officialAddress: resolved.address,
                              phone: resolved.phone,
                            });
                          }}
                          className="w-7 h-7 rounded bg-[#ffedd5] text-[#c2410c] hover:bg-[#fed7aa] inline-flex items-center justify-center cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {centerModal && (
        <ModalShell
          title={centerModal.id ? `Edit Center Letterhead (${centerModal.cityName})` : 'Add New Center'}
          icon={<Building2 className="w-4 h-4 text-emerald-400" />}
          headerClass={palette.modalHeader}
          maxWidth="max-w-lg"
          onClose={() => setCenterModal(null)}
        >
          <form onSubmit={handleSaveCenterModal} className="p-6 space-y-4 bg-white">
            {centerError && (
              <div
                role="alert"
                className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold"
              >
                {centerError}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Center City *
                </label>
                <input
                  type="text"
                  required
                  value={centerModal.cityName}
                  onChange={(e) =>
                    setCenterModal((prev) => prev && { ...prev, cityName: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  State / Region
                </label>
                <input
                  type="text"
                  value={centerModal.stateName}
                  onChange={(e) =>
                    setCenterModal((prev) => prev && { ...prev, stateName: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Center Code
                </label>
                <input
                  type="text"
                  maxLength={10}
                  value={centerModal.centerCode}
                  onChange={(e) =>
                    setCenterModal((prev) =>
                      prev && { ...prev, centerCode: e.target.value.toUpperCase() }
                    )
                  }
                  placeholder="e.g. KOL"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono uppercase"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Official Letterhead Address
              </label>
              <textarea
                rows={3}
                value={centerModal.officialAddress}
                onChange={(e) =>
                  setCenterModal((prev) => prev && { ...prev, officialAddress: e.target.value })
                }
                placeholder="Full office address for printed IT Allotment letters"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Office Telephone Number
              </label>
              <input
                type="text"
                value={centerModal.phone}
                onChange={(e) =>
                  setCenterModal((prev) => prev && { ...prev, phone: e.target.value })
                }
                placeholder="e.g. +91 33 4073 1137"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
              />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setCenterModal(null)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingCenter}
                className={`${palette.primaryBtn} ${palette.primaryBtnHover} px-5 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50`}
              >
                <Save className="w-3.5 h-3.5" />
                <span>{savingCenter ? 'Saving...' : 'Save Center'}</span>
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {/* System Audit Trail */}
      {(isSuperAdmin || canManageRoles) && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-600" />
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">System Audit Trail</h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Tamper-evident log of employee, asset, batch update, bulk import, and backup actions
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadAuditLogs()}
              disabled={loadingAudit}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingAudit ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          <div className="overflow-x-auto max-h-80 overflow-y-auto border border-slate-200 rounded-xl">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-[#3f3f46] text-white sticky top-0 text-[10px] font-bold uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-2">Timestamp</th>
                  <th className="px-3 py-2">Module / Action</th>
                  <th className="px-3 py-2">Actor</th>
                  <th className="px-3 py-2">IP</th>
                  <th className="px-3 py-2">Record ID</th>
                  <th className="px-3 py-2">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                      {loadingAudit ? 'Loading audit logs...' : 'No system audit events recorded yet.'}
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                        {log.createdAt.replace('T', ' ').slice(0, 19)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="font-bold text-slate-800">{log.module}</span>{' '}
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-[10px] text-slate-700">
                          {log.action}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                        {log.actorName}{' '}
                        <span className="text-[10px] text-slate-400">({log.actorRole})</span>
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                        {log.ipAddress}
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-600">
                        {log.entityId}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{log.details}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
