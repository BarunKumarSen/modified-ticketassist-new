import React, { useMemo, useState } from 'react';
import { GitBranch, Search, ShieldCheck, Users } from 'lucide-react';
import { apiClient, ApiError } from '../api/client';
import type { Employee, ToastMessage } from '../types/asset';

interface ManagerMappingPanelProps {
  employees: Employee[];
  isAdmin: boolean;
  onRefreshEmployees: () => Promise<void>;
  onNotify: (msg: string, type?: ToastMessage['type']) => void;
}

export const ManagerMappingPanel: React.FC<ManagerMappingPanelProps> = ({
  employees,
  isAdmin,
  onRefreshEmployees,
  onNotify,
}) => {
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'managers' | 'unassigned'>('all');
  const [savingId, setSavingId] = useState<string | null>(null);

  const managers = useMemo(
    () =>
      employees
        .filter((e) => e.isManager && e.status === 'Active')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [employees]
  );

  const directReportCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const emp of employees) {
      if (emp.reportingManagerId) {
        counts.set(emp.reportingManagerId, (counts.get(emp.reportingManagerId) || 0) + 1);
      }
    }
    return counts;
  }, [employees]);

  const mappedCount = useMemo(
    () => employees.filter((e) => Boolean(e.reportingManagerId)).length,
    [employees]
  );
  const unassignedCount = employees.length - mappedCount;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (filterMode === 'managers' && !e.isManager) return false;
      if (filterMode === 'unassigned' && e.reportingManagerId) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.employeeId.toLowerCase().includes(q) ||
        e.department.toLowerCase().includes(q) ||
        (e.center || e.branch || '').toLowerCase().includes(q) ||
        (e.reportingManagerName || '').toLowerCase().includes(q)
      );
    });
  }, [employees, filterMode, search]);

  const handleToggleIsManager = async (emp: Employee, nextVal: boolean) => {
    if (!isAdmin || savingId) return;
    setSavingId(emp.id);
    try {
      await apiClient.updateManagerMapping(emp.id, { isManager: nextVal });
      await onRefreshEmployees();
      onNotify(
        nextVal
          ? `${emp.name} is now designated as a Manager`
          : `${emp.name} removed from Manager designation`,
        'success'
      );
    } catch (err) {
      onNotify(
        err instanceof ApiError ? err.message : 'Failed to update manager designation',
        'error'
      );
    } finally {
      setSavingId(null);
    }
  };

  const handleChangeManager = async (emp: Employee, reportingManagerId: string) => {
    if (!isAdmin || savingId) return;
    setSavingId(emp.id);
    try {
      await apiClient.updateManagerMapping(emp.id, { reportingManagerId });
      await onRefreshEmployees();
      const mgr = managers.find((m) => m.id === reportingManagerId);
      onNotify(
        mgr
          ? `Mapped ${emp.name} to Reporting Manager ${mgr.name}`
          : `Cleared reporting manager for ${emp.name}`
      );
    } catch (err) {
      onNotify(
        err instanceof ApiError ? err.message : 'Failed to update reporting manager mapping',
        'error'
      );
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-4" data-testid="manager-mapping-panel">
      {/* Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Total Employees
          </p>
          <p className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1 tabular-nums">
            {employees.length}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Designated Managers
          </p>
          <p className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-400 mt-1 tabular-nums">
            {employees.filter((e) => e.isManager).length}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Mapped to Manager
          </p>
          <p className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1 tabular-nums">{mappedCount}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Unassigned
          </p>
          <p className="text-2xl font-extrabold text-amber-700 dark:text-amber-400 mt-1 tabular-nums">
            {unassignedCount}
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="p-4 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
              <GitBranch className="w-4 h-4 text-emerald-700" />
              <span>Employee Manager Mapping</span>
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {isAdmin
                ? 'Designate Managers ("Is Manager?") and assign one Reporting Manager per employee. Leave requests route automatically.'
                : 'Read-only reporting hierarchy. Only Administrators can modify Manager flags or assignments.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-white border border-slate-200 rounded-lg">
              {(
                [
                  ['all', 'All'],
                  ['managers', 'Managers Only'],
                  ['unassigned', 'Unassigned'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilterMode(key)}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    filterMode === key
                      ? 'bg-[#3f3f46] text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                aria-label="Filter manager mapping"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search employee or manager..."
                className="w-52 pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Center &amp; Dept</th>
                <th className="px-4 py-3">Is Manager?</th>
                <th className="px-4 py-3">Reporting Manager</th>
                <th className="px-4 py-3 text-right">Direct Reports</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filtered.map((emp) => {
                const count = directReportCounts.get(emp.id) || 0;
                const busy = savingId === emp.id;
                const availableManagers = managers.filter((m) => m.id !== emp.id);
                return (
                  <tr key={emp.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-2.5">
                      <span className="font-bold text-slate-900 block">{emp.name}</span>
                      <span className="text-[11px] text-slate-500 font-mono">
                        {emp.employeeId} · {emp.designation}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      <span className="block font-medium text-slate-800">
                        {emp.center || emp.branch}
                      </span>
                      <span className="text-[11px] text-slate-500">{emp.department}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {isAdmin ? (
                        <div
                          role="group"
                          aria-label={`Is Manager toggle for ${emp.name}`}
                          className="inline-flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg border border-slate-200"
                        >
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleToggleIsManager(emp, true)}
                            className={`px-2.5 py-1 rounded text-[11px] font-bold cursor-pointer transition-colors ${
                              emp.isManager
                                ? 'bg-emerald-700 text-white shadow-xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleToggleIsManager(emp, false)}
                            className={`px-2.5 py-1 rounded text-[11px] font-bold cursor-pointer transition-colors ${
                              !emp.isManager
                                ? 'bg-white text-slate-900 shadow-xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <span
                          className={`text-xs font-semibold ${
                            emp.isManager ? 'text-emerald-700' : 'text-slate-500'
                          }`}
                        >
                          {emp.isManager ? 'Yes' : 'No'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {isAdmin ? (
                        <select
                          aria-label={`Reporting Manager for ${emp.name}`}
                          disabled={busy}
                          value={emp.reportingManagerId || ''}
                          onChange={(e) => void handleChangeManager(emp, e.target.value)}
                          className="w-full max-w-[240px] px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                        >
                          <option value="">-- No Manager Assigned --</option>
                          {availableManagers.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} ({m.employeeId} · {m.department})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div>
                          <span className="font-semibold text-slate-800 block">
                            {emp.reportingManagerName || '—'}
                          </span>
                          {emp.reportingManagerEmail && (
                            <span className="text-[11px] text-slate-500">
                              {emp.reportingManagerEmail}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {emp.isManager || count > 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-800">
                          <Users className="w-3.5 h-3.5 text-emerald-700" />
                          <span>{count}</span>
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    No employees match the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {!isAdmin && (
          <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center gap-1.5 text-[11px] text-slate-500">
            <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
            <span>Manager designations and reporting assignments are restricted to Admin users.</span>
          </div>
        )}
      </div>
    </div>
  );
};
