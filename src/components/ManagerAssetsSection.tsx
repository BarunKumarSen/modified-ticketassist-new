import React, { useMemo, useState } from 'react';
import {
  Calendar,
  Laptop,
  LifeBuoy,
  MapPin,
  RotateCcw,
  Search,
  Share2,
  Tag,
  UserCheck,
  Users,
} from 'lucide-react';
import type { Asset, Assignment, Employee, PersonnelEntity } from '../types/asset';
import type { SessionUser } from '../types/user';
import { getManagerPersonalAssets, getManagerTeamMemberAssets } from '../utils/managerAssets';
import type { OwnedAssetSummary } from '../utils/ticketLogic';

const ASSET_STATUS_PILL: Record<string, string> = {
  Assigned: 'bg-blue-100 text-blue-800 border-blue-200',
  'Under Maintenance': 'bg-amber-100 text-amber-800 border-amber-200',
  Available: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  Disposed: 'bg-red-100 text-red-800 border-red-200',
};

const ASSET_CONDITION_PILL: Record<string, string> = {
  New: 'bg-sky-50 text-sky-800 border-sky-200',
  Good: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  Fair: 'bg-amber-50 text-amber-800 border-amber-200',
  Damaged: 'bg-rose-50 text-rose-800 border-rose-200',
  Poor: 'bg-rose-50 text-rose-800 border-rose-200',
};

interface ManagerAssetsSectionProps {
  session: SessionUser;
  employees: readonly Employee[];
  entities?: readonly PersonnelEntity[];
  assets: readonly Asset[];
  assignments: readonly Assignment[];
  initialSearch?: string;
  onRaiseTicket?: (assetId?: string) => void;
  onSubAssign?: (assetId: string, parentAssignmentId: string) => void;
  onReturnSubAssign?: (subAssignmentId: string, assetName: string) => void;
}

export const ManagerAssetsSection: React.FC<ManagerAssetsSectionProps> = ({
  session,
  employees,
  entities = [],
  assets,
  assignments,
  initialSearch = '',
  onRaiseTicket,
  onSubAssign,
  onReturnSubAssign,
}) => {
  const [personalSearch, setPersonalSearch] = useState(initialSearch);
  const [teamSearch, setTeamSearch] = useState('');

  const personalData = useMemo(
    () =>
      getManagerPersonalAssets({
        session,
        employees,
        entities,
        assets,
        assignments,
      }),
    [session, employees, entities, assets, assignments]
  );

  const teamData = useMemo(
    () =>
      getManagerTeamMemberAssets({
        session,
        employees,
        entities,
        assets,
        assignments,
      }),
    [session, employees, entities, assets, assignments]
  );

  const filteredPersonalAssets = useMemo(() => {
    const q = personalSearch.trim().toLowerCase();
    if (!q) return personalData.personalAssets;
    return personalData.personalAssets.filter(
      ({ asset }) =>
        asset.name.toLowerCase().includes(q) ||
        asset.id.toLowerCase().includes(q) ||
        asset.serial.toLowerCase().includes(q) ||
        asset.category.toLowerCase().includes(q) ||
        asset.brand.toLowerCase().includes(q) ||
        (asset.model || '').toLowerCase().includes(q) ||
        asset.location.toLowerCase().includes(q)
    );
  }, [personalData.personalAssets, personalSearch]);

  const filteredGroups = useMemo(() => {
    const q = teamSearch.trim().toLowerCase();
    if (!q) return teamData.groups;
    return teamData.groups
      .map((group) => {
        const empMatches =
          group.employeeName.toLowerCase().includes(q) ||
          group.employeeId.toLowerCase().includes(q) ||
          group.department.toLowerCase().includes(q);
        if (empMatches) return group;
        const matchedRows = group.assets.filter(
          (row) =>
            row.assetId.toLowerCase().includes(q) ||
            row.assetName.toLowerCase().includes(q) ||
            row.category.toLowerCase().includes(q) ||
            row.brand.toLowerCase().includes(q) ||
            row.model.toLowerCase().includes(q) ||
            row.serial.toLowerCase().includes(q) ||
            row.status.toLowerCase().includes(q) ||
            row.condition.toLowerCase().includes(q) ||
            row.location.toLowerCase().includes(q)
        );
        return matchedRows.length > 0
          ? { ...group, assets: matchedRows, totalAssets: matchedRows.length }
          : null;
      })
      .filter((g): g is NonNullable<typeof g> => Boolean(g));
  }, [teamData.groups, teamSearch]);

  return (
    <div className="space-y-6" data-testid="manager-assets-container">
      {/* Section 1: Manager Assets (Strictly Personal Assigned Assets) */}
      <section
        aria-label="Manager Assets"
        data-testid="manager-assets-section"
        className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden"
      >
        <div className="px-5 py-4 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <Laptop className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                <span>Manager Assets</span>
              </h2>
              <span
                data-testid="manager-personal-asset-badge"
                className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-800 border border-blue-200 dark:bg-slate-800 dark:text-blue-300 dark:border-slate-700 tabular-nums"
              >
                Assets Assigned: {personalData.personalAssetCount}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Manager Name:{' '}
              <strong data-testid="manager-personal-name" className="text-slate-900 dark:text-white">
                {personalData.managerName}
              </strong>
              {personalData.managerCode ? ` (${personalData.managerCode})` : ''} · Assets Assigned:{' '}
              <strong
                data-testid="manager-personal-asset-count"
                className="text-blue-700 dark:text-blue-400 tabular-nums"
              >
                {personalData.personalAssetCount}
              </strong>{' '}
              (personal assigned assets only)
            </p>
          </div>

          <div className="relative w-full lg:w-64">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
              <Search className="w-3.5 h-3.5" />
            </span>
            <input
              type="text"
              aria-label="Search manager personal assets"
              value={personalSearch}
              onChange={(e) => setPersonalSearch(e.target.value)}
              placeholder="Search manager assets..."
              className="w-full pl-8 pr-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        </div>

        {filteredPersonalAssets.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            {personalData.personalAssetCount === 0
              ? 'No personal assets are currently assigned directly to this manager.'
              : 'No manager assets match your search.'}
          </div>
        ) : (
          <div
            className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-5"
            data-testid="manager-personal-assets-list"
          >
            {filteredPersonalAssets.map((item) => (
              <ManagerPersonalAssetCard
                key={item.asset.id}
                assetSummary={item}
                onRaiseTicket={onRaiseTicket}
                onSubAssign={onSubAssign}
                onReturnSubAssign={onReturnSubAssign}
              />
            ))}
          </div>
        )}
      </section>

      {/* Section 2: Manager's Team Member Assets (Shown ONLY if Manager has reporting employees) */}
      {teamData.shouldShowSection && (
        <section
          aria-label="Manager's Team Member Assets"
          data-testid="manager-team-member-assets-section"
          className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden"
        >
          <div className="px-5 py-4 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                  <Users className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                  <span>Manager&apos;s Team Member Assets</span>
                </h2>
                <span
                  data-testid="team-overall-asset-count"
                  className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-slate-800 dark:text-emerald-300 dark:border-slate-700 tabular-nums"
                >
                  Overall Team Assets: {teamData.overallTeamAssetCount}
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 tabular-nums">
                  Reporting Employees: {teamData.reportingEmployeesCount}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Assets actively assigned to employees reporting directly to {personalData.managerName}, grouped by employee.
              </p>
            </div>

            <div className="relative w-full lg:w-64">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
                <Search className="w-3.5 h-3.5" />
              </span>
              <input
                type="text"
                aria-label="Search team member assets"
                value={teamSearch}
                onChange={(e) => setTeamSearch(e.target.value)}
                placeholder="Search team member or asset..."
                className="w-full pl-8 pr-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          </div>

          <div className="p-5 space-y-5">
            {teamData.overallTeamAssetCount === 0 ? (
              <div className="p-8 rounded-lg border border-dashed border-slate-200 dark:border-slate-700 text-center text-xs text-slate-500 dark:text-slate-400">
                No assets are currently assigned to your {teamData.reportingEmployeesCount} reporting{' '}
                {teamData.reportingEmployeesCount === 1 ? 'employee' : 'employees'}.
              </div>
            ) : filteredGroups.length === 0 ? (
              <div className="p-8 rounded-lg border border-dashed border-slate-200 dark:border-slate-700 text-center text-xs text-slate-500 dark:text-slate-400">
                No team member assets match your search.
              </div>
            ) : (
              filteredGroups.map((group) => (
                <div
                  key={group.employeeRecordId}
                  data-testid={`team-employee-group-${group.employeeId}`}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900"
                >
                  <div className="px-4 py-3 bg-slate-50/90 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <UserCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                      <span className="text-xs font-extrabold text-slate-900 dark:text-white">
                        {group.employeeName}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[10px] font-mono font-bold text-slate-700 dark:text-slate-300">
                        {group.employeeId}
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        {group.designation} · {group.department}
                      </span>
                    </div>
                    <span
                      data-testid={`team-employee-total-${group.employeeId}`}
                      className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-800 border border-blue-200 dark:bg-slate-900 dark:text-blue-300 dark:border-slate-700 tabular-nums"
                    >
                      Total Assets: {group.totalAssets}
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50/50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 whitespace-nowrap">
                          <th className="px-3 py-2.5">Employee Name</th>
                          <th className="px-3 py-2.5">Employee ID</th>
                          <th className="px-3 py-2.5">Asset ID</th>
                          <th className="px-3 py-2.5">Asset Name</th>
                          <th className="px-3 py-2.5">Category</th>
                          <th className="px-3 py-2.5">Brand</th>
                          <th className="px-3 py-2.5">Model</th>
                          <th className="px-3 py-2.5">Serial Number</th>
                          <th className="px-3 py-2.5">Status</th>
                          <th className="px-3 py-2.5">Condition</th>
                          <th className="px-3 py-2.5">Date of Issue</th>
                          <th className="px-3 py-2.5">Location</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                        {group.assets.map((row) => {
                          const statusBadge =
                            ASSET_STATUS_PILL[row.status] ||
                            'bg-slate-100 text-slate-700 border-slate-200';
                          const conditionBadge =
                            ASSET_CONDITION_PILL[row.condition] ||
                            'bg-slate-50 text-slate-700 border-slate-200';
                          return (
                            <tr
                              key={`${group.employeeRecordId}-${row.assetId}`}
                              data-testid={`team-asset-row-${row.assetId}`}
                              className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 whitespace-nowrap"
                            >
                              <td className="px-3 py-2.5 font-semibold text-slate-900 dark:text-white">
                                {row.employeeName}
                              </td>
                              <td className="px-3 py-2.5 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                                {row.employeeId}
                              </td>
                              <td className="px-3 py-2.5 font-mono font-bold text-slate-800 dark:text-slate-200">
                                {row.assetId}
                              </td>
                              <td className="px-3 py-2.5 font-bold text-slate-900 dark:text-white">
                                {row.assetName}
                              </td>
                              <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300">
                                {row.category}
                              </td>
                              <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300">
                                {row.brand}
                              </td>
                              <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300">
                                {row.model}
                              </td>
                              <td className="px-3 py-2.5 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                                {row.serial}
                              </td>
                              <td className="px-3 py-2.5">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusBadge}`}
                                >
                                  {row.status}
                                </span>
                              </td>
                              <td className="px-3 py-2.5">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold border ${conditionBadge}`}
                                >
                                  {row.condition}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 font-mono text-[11px] text-slate-700 dark:text-slate-300 tabular-nums">
                                {row.dateOfIssue}
                              </td>
                              <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300">
                                {row.location}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}
    </div>
  );
};

const ManagerPersonalAssetCard: React.FC<{
  assetSummary: OwnedAssetSummary;
  onRaiseTicket?: (assetId: string) => void;
  onSubAssign?: (assetId: string, parentAssignmentId: string) => void;
  onReturnSubAssign?: (subAssignmentId: string, assetName: string) => void;
}> = ({ assetSummary, onRaiseTicket, onSubAssign, onReturnSubAssign }) => {
  const { asset, assignedDate, assignmentId, custodyLevel, subAssignedToName, subAssignmentId } =
    assetSummary;
  const badgeClass =
    ASSET_STATUS_PILL[asset.status] || 'bg-slate-100 text-slate-700 border-slate-200';

  return (
    <div
      data-testid={`manager-asset-card-${asset.id}`}
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 flex flex-col justify-between gap-3 hover:shadow-sm transition-shadow"
    >
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-extrabold text-slate-900 dark:text-white truncate">
              {asset.name}
            </h3>
            <p className="text-[11px] font-mono text-slate-500 mt-0.5">
              {asset.id} · S/N: {asset.serial}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${badgeClass}`}>
              {asset.status}
            </span>
            {custodyLevel && (
              <span
                className={`px-2 py-0.5 rounded text-[9px] font-bold border ${
                  custodyLevel === 'Sub-Assigned'
                    ? 'bg-violet-50 text-violet-800 border-violet-200'
                    : 'bg-sky-50 text-sky-800 border-sky-200'
                }`}
              >
                {custodyLevel} Custody
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] text-slate-600 dark:text-slate-300">
          <div className="flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate">{asset.category}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="tabular-nums">Issued: {assignedDate}</span>
          </div>
          <div className="flex items-center gap-1.5 col-span-2">
            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate">{asset.location}</span>
          </div>
        </div>

        {subAssignedToName && (
          <div className="p-2 rounded-lg bg-violet-50 border border-violet-200 text-[11px] text-violet-900 font-semibold">
            Sub-Assigned Custody: <strong>{subAssignedToName}</strong>
          </div>
        )}
      </div>

      <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
          Condition: <strong className="text-slate-700 dark:text-slate-200">{asset.condition}</strong>
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {custodyLevel === 'Primary' && !subAssignmentId && assignmentId && onSubAssign && (
            <button
              type="button"
              onClick={() => onSubAssign(asset.id, assignmentId)}
              aria-label={`Sub-Assign ${asset.name}`}
              className="px-2.5 py-1.5 bg-violet-100 hover:bg-violet-200 text-violet-900 border border-violet-200 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
            >
              <Share2 className="w-3 h-3" />
              <span>Sub-Assign</span>
            </button>
          )}
          {subAssignmentId && onReturnSubAssign && (
            <button
              type="button"
              onClick={() => onReturnSubAssign(subAssignmentId, asset.name)}
              aria-label={`Return Sub-Assign for ${asset.name}`}
              className="px-2.5 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-200 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Return Sub-Assign</span>
            </button>
          )}
          {onRaiseTicket && (
            <button
              type="button"
              onClick={() => onRaiseTicket(asset.id)}
              aria-label={`Raise Ticket for ${asset.name}`}
              className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 dark:bg-slate-800 dark:text-blue-400 dark:border-slate-700 rounded-lg text-[11px] font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <LifeBuoy className="w-3.5 h-3.5" />
              <span>Raise Ticket</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
