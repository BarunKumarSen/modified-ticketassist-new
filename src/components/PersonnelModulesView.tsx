import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Download,
  FileSpreadsheet,
  History,
  Laptop,
  Pencil,
  Plus,
  Printer,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react';
import type {
  AssetOSState,
  ModalType,
  PersonnelEntity,
  PersonnelEntityType,
} from '../types/asset';
import { ApiError } from '../api/client';
import { THEME_PALETTES, paginateItems } from '../utils/assetMath';
import {
  buildDirectoryExportCsv,
  generateDirectoryTemplateCsv,
} from '../utils/directoryImportExport';
import { ENTITY_MODULE_META } from '../utils/entityValidation';
import { TablePaginationFooter } from './OperationsViews';
import { ModalShell } from './AssetModals';

interface PersonnelModulesViewProps {
  entityType: PersonnelEntityType;
  state: AssetOSState;
  isAdmin: boolean;
  canWrite: boolean;
  onOpenModal: (modal: ModalType) => void;
  onToggleConsultantManager: (
    entity: PersonnelEntity,
    nextVal: boolean,
    forceUnassign?: boolean
  ) => Promise<void>;
  onDeleteEntity: (entity: PersonnelEntity) => void;
  onImportEntitiesCSV?: (entityType: PersonnelEntityType, csvText: string) => void;
}

function downloadCsvFile(filename: string, csvContent: string) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export const PersonnelModulesView: React.FC<PersonnelModulesViewProps> = ({
  entityType,
  state,
  isAdmin,
  canWrite,
  onOpenModal,
  onToggleConsultantManager,
  onDeleteEntity,
  onImportEntitiesCSV,
}) => {
  const palette = THEME_PALETTES[state.settings.theme];
  const meta = ENTITY_MODULE_META[entityType];
  const [subView, setSubView] = useState<'directory' | 'conversions'>('directory');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [revokeConfirm, setRevokeConfirm] = useState<{
    entity: PersonnelEntity;
    message: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const entitiesForModule = useMemo(
    () => (state.entities || []).filter((e) => e.entityType === entityType),
    [state.entities, entityType]
  );

  const relatedConversions = useMemo(
    () =>
      (state.employmentConversions || []).filter(
        (c) => c.fromType === entityType || c.toType === entityType
      ),
    [state.employmentConversions, entityType]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entitiesForModule.filter(
      (e) =>
        !q ||
        e.name.toLowerCase().includes(q) ||
        e.entityCode.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        e.department.toLowerCase().includes(q) ||
        e.center.toLowerCase().includes(q) ||
        (e.projectName || '').toLowerCase().includes(q) ||
        (e.projectNo || '').toLowerCase().includes(q)
    );
  }, [entitiesForModule, search]);

  const paged = paginateItems(filtered, page, pageSize);

  const activeAssetsCount = useMemo(() => {
    const entityIds = new Set(entitiesForModule.flatMap((e) => [e.id, e.entityCode]));
    return state.assignments.filter((a) => a.status === 'Active' && entityIds.has(a.employeeId))
      .length;
  }, [entitiesForModule, state.assignments]);

  const managerCount = useMemo(
    () => entitiesForModule.filter((e) => e.isManager).length,
    [entitiesForModule]
  );

  const handleOpenCreate = () => {
    if (entityType === 'Freelancer') {
      onOpenModal({ type: 'freelancer' });
    } else {
      onOpenModal({ type: 'entity', entityType });
    }
  };

  const handleOpenEdit = (ent: PersonnelEntity) => {
    if (entityType === 'Freelancer') {
      onOpenModal({ type: 'freelancer', entityId: ent.id });
    } else {
      onOpenModal({ type: 'entity', entityType, entityId: ent.id });
    }
  };

  const handleToggleManager = async (ent: PersonnelEntity) => {
    if (togglingId) return;
    const nextVal = !ent.isManager;
    setTogglingId(ent.id);
    try {
      await onToggleConsultantManager(ent, nextVal, false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setRevokeConfirm({ entity: ent, message: err.message });
      }
    } finally {
      setTogglingId(null);
    }
  };

  const handleConfirmForceRevoke = async () => {
    if (!revokeConfirm) return;
    setTogglingId(revokeConfirm.entity.id);
    try {
      await onToggleConsultantManager(revokeConfirm.entity, false, true);
      setRevokeConfirm(null);
    } finally {
      setTogglingId(null);
    }
  };

  const slug = entityType.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className="space-y-4 pb-10" data-testid={`module-view-${entityType}`}>
      {/* Header + 5-Button Directory Action Toolbar */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
            {meta.pluralLabel}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {entityType === 'Consultant'
              ? 'Manage Consultants and toggle Manager team-building privileges (primary category always remains Consultant)'
              : entityType === 'Freelancer'
              ? 'Onboard Freelancers, verify ID/KYC/bank records, and issue equipment with IT Allotment forms'
              : `Manage ${meta.pluralLabel} directory, ID validation (A-Z, 0-9 max 10 chars), and asset assignments`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 no-print">
          <div className="flex items-center gap-1 p-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
            <button
              type="button"
              onClick={() => setSubView('directory')}
              className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                subView === 'directory'
                  ? palette.primaryBtn
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Directory</span>
            </button>
            <button
              type="button"
              onClick={() => setSubView('conversions')}
              className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                subView === 'conversions'
                  ? palette.primaryBtn
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Conversions ({relatedConversions.length})</span>
            </button>
          </div>

          {subView === 'directory' && canWrite && (
            <>
              <button
                type="button"
                onClick={handleOpenCreate}
                data-testid={`add-${slug}-btn`}
                className={`${palette.primaryBtn} ${palette.primaryBtnHover} px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer whitespace-nowrap`}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New</span>
              </button>

              {onImportEntitiesCSV && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        if (typeof reader.result === 'string') {
                          onImportEntitiesCSV(entityType, reader.result);
                        }
                      };
                      reader.readAsText(file);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    data-testid={`import-${slug}-csv-btn`}
                    className="bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/50 text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-800 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    <span>Import CSV</span>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() =>
                  downloadCsvFile(
                    `${slug}-import-template.csv`,
                    generateDirectoryTemplateCsv(entityType)
                  )
                }
                data-testid={`template-${slug}-csv-btn`}
                title={`Download ${meta.singularLabel} CSV Template`}
                className="bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Template CSV</span>
              </button>
            </>
          )}

          {subView === 'directory' && (
            <>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  aria-label={`Search ${meta.pluralLabel}`}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder={`Search ${meta.singularLabel.toLowerCase()}...`}
                  className={`w-48 pl-8 pr-3 py-1.5 bg-white dark:bg-slate-800 border ${palette.border} dark:border-slate-700 rounded-lg text-xs dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600`}
                />
              </div>

              <div className="flex space-x-1 border-l border-slate-200 dark:border-slate-700 pl-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  data-testid={`print-${slug}-btn`}
                  className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadCsvFile(
                      `${slug}.csv`,
                      buildDirectoryExportCsv(entityType, filtered)
                    )
                  }
                  data-testid={`export-${slug}-csv-btn`}
                  className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export CSV</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className={`bg-white dark:bg-slate-900 p-4 rounded-xl border ${palette.border} dark:border-slate-800 shadow-sm flex items-center justify-between`}>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Total {meta.pluralLabel}
            </p>
            <p className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1 tabular-nums">
              {entitiesForModule.length}
            </p>
          </div>
          <Users className="w-6 h-6 text-blue-600/70" />
        </div>

        <div className={`bg-white dark:bg-slate-900 p-4 rounded-xl border ${palette.border} dark:border-slate-800 shadow-sm flex items-center justify-between`}>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Active
            </p>
            <p className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-400 mt-1 tabular-nums">
              {entitiesForModule.filter((e) => e.status === 'Active').length}
            </p>
          </div>
          <UserCheck className="w-6 h-6 text-emerald-600/70" />
        </div>

        <div className={`bg-white dark:bg-slate-900 p-4 rounded-xl border ${palette.border} dark:border-slate-800 shadow-sm flex items-center justify-between`}>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Active Assets Held
            </p>
            <p className="text-2xl font-extrabold text-sky-700 dark:text-sky-400 mt-1 tabular-nums">
              {activeAssetsCount}
            </p>
          </div>
          <Laptop className="w-6 h-6 text-sky-600/70" />
        </div>

        <div className={`bg-white dark:bg-slate-900 p-4 rounded-xl border ${palette.border} dark:border-slate-800 shadow-sm flex items-center justify-between`}>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {entityType === 'Consultant' ? 'Manager Enabled' : 'ID Rule'}
            </p>
            {entityType === 'Consultant' ? (
              <p className="text-2xl font-extrabold text-amber-700 dark:text-amber-400 mt-1 tabular-nums">
                {managerCount}
              </p>
            ) : (
              <p className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300 mt-2">
                A-Z, 0-9 (≤10)
              </p>
            )}
          </div>
          <ShieldCheck className="w-6 h-6 text-amber-600/70" />
        </div>
      </div>

      {subView === 'conversions' ? (
        <div className={`bg-white dark:bg-slate-900 rounded-xl border ${palette.border} dark:border-slate-800 shadow-sm overflow-hidden`}>
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="text-xs font-extrabold text-slate-900 dark:text-white">
              Employment Category Conversion Ledger ({meta.pluralLabel})
            </h2>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Preserves unified profile ID, attendance, leave balance, assets, tickets &amp; policy logs
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Person Name</th>
                  <th className="px-4 py-3">From Category (ID)</th>
                  <th className="px-4 py-3">To Category (ID)</th>
                  <th className="px-4 py-3">Converted By</th>
                  <th className="px-4 py-3">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {relatedConversions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                      No employment conversions recorded for {meta.pluralLabel.toLowerCase()} yet.
                    </td>
                  </tr>
                ) : (
                  relatedConversions.map((conv) => (
                    <tr key={conv.id}>
                      <td className="px-4 py-2.5 font-mono text-slate-500 tabular-nums">
                        {conv.convertedAt.slice(0, 10)}
                      </td>
                      <td className="px-4 py-2.5 font-bold text-slate-900 dark:text-white">
                        {conv.personName}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                        {conv.fromType}{' '}
                        <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                          ({conv.fromCode})
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-emerald-700 dark:text-emerald-400 font-semibold">
                        {conv.toType}{' '}
                        <span className="font-mono font-bold">({conv.toCode})</span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                        {conv.convertedBy}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">
                        {conv.reason || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Directory Table */
        <div className={`bg-white dark:bg-slate-900 rounded-xl border ${palette.border} dark:border-slate-800 shadow-sm overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className={`${palette.surfaceBg} dark:bg-slate-800 border-b ${palette.border} dark:border-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider`}>
                  <th className="px-4 py-3">{meta.idLabel}</th>
                  <th className="px-4 py-3">Name &amp; Contact</th>
                  <th className="px-4 py-3">Center &amp; Dept</th>
                  <th className="px-4 py-3">
                    {entityType === 'Freelancer' ? 'Project & KYC' : 'Role / Privileges'}
                  </th>
                  <th className="px-4 py-3">Assets</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right no-print">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {paged.items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                      No {meta.pluralLabel.toLowerCase()} registered yet.
                    </td>
                  </tr>
                ) : (
                  paged.items.map((ent) => {
                    const heldCount = state.assignments.filter(
                      (a) =>
                        a.status === 'Active' &&
                        (a.employeeId === ent.id || a.employeeId === ent.entityCode)
                    ).length;

                    return (
                      <tr
                        key={ent.id}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                      >
                        <td className="px-4 py-3 font-mono font-bold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                          {ent.entityCode}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-bold text-slate-900 dark:text-white block">
                            {ent.name}
                          </span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                            {ent.email}
                          </span>
                          {ent.phone && (
                            <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                              {ent.phone}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                            {ent.center}
                          </span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            {ent.department} · {ent.designation}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {entityType === 'Freelancer' ? (
                            <div className="space-y-0.5">
                              <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                                {ent.projectName || 'General Fieldwork'}
                                {ent.projectNo ? ` (${ent.projectNo})` : ''}
                              </span>
                              <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 block">
                                {ent.eicName ? `Assigned Employee: ${ent.eicName}` : ''}
                                {ent.panCard ? ` · PAN: ${ent.panCard}` : ''}
                              </span>
                            </div>
                          ) : entityType === 'Consultant' ? (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-[10px] font-bold">
                                Consultant
                              </span>
                              {ent.isManager && (
                                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-bold">
                                  Manager Enabled
                                </span>
                              )}
                              {isAdmin && (
                                <button
                                  type="button"
                                  disabled={togglingId === ent.id}
                                  onClick={() => void handleToggleManager(ent)}
                                  data-testid={`toggle-manager-${ent.entityCode}`}
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold border cursor-pointer transition-colors disabled:opacity-50 ${
                                    ent.isManager
                                      ? 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-300'
                                      : 'bg-sky-50 hover:bg-sky-100 text-sky-800 border-sky-300'
                                  }`}
                                >
                                  {togglingId === ent.id
                                    ? 'Updating...'
                                    : ent.isManager
                                    ? 'Revoke Manager'
                                    : 'Grant Manager'}
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-[10px] font-bold">
                              {ent.entityType}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 tabular-nums font-bold text-slate-700 dark:text-slate-300">
                          {heldCount}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                              ent.status === 'Active'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : 'bg-slate-100 text-slate-500 border-slate-200'
                            }`}
                          >
                            {ent.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap space-x-1 no-print">
                          {canWrite && (
                            <>
                              <button
                                type="button"
                                aria-label={`Convert category for ${ent.name}`}
                                title="Convert Employment Category"
                                onClick={() =>
                                  onOpenModal({
                                    type: 'convert-employment',
                                    sourceType: ent.entityType,
                                    sourceId: ent.id,
                                    sourceCode: ent.entityCode,
                                    personName: ent.name,
                                  })
                                }
                                className="w-7 h-7 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100 inline-flex items-center justify-center cursor-pointer"
                              >
                                <ArrowRightLeft className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                aria-label={`Edit ${ent.name}`}
                                onClick={() => handleOpenEdit(ent)}
                                className="w-7 h-7 rounded bg-orange-50 text-orange-700 hover:bg-orange-100 inline-flex items-center justify-center cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                          {isAdmin && (
                            <button
                              type="button"
                              aria-label={`Delete ${ent.name}`}
                              onClick={() => onDeleteEntity(ent)}
                              className="w-7 h-7 rounded bg-rose-50 text-rose-700 hover:bg-rose-100 inline-flex items-center justify-center cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <TablePaginationFooter
            total={filtered.length}
            startIndex={paged.startIndex}
            endIndex={paged.endIndex}
            page={paged.safePage}
            totalPages={paged.totalPages}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(n) => {
              setPageSize(n);
              setPage(1);
            }}
          />
        </div>
      )}

      {/* Confirm Force-Unassign when revoking Consultant Manager with active direct reports */}
      {revokeConfirm && (
        <ModalShell
          title="Confirm Revoke Consultant Manager"
          icon={<AlertTriangle className="w-4 h-4 text-amber-300" />}
          headerClass="bg-slate-800"
          maxWidth="max-w-md"
          onClose={() => setRevokeConfirm(null)}
        >
          <div className="p-6 space-y-4 bg-white">
            <p className="text-xs text-slate-700 leading-relaxed">{revokeConfirm.message}</p>
            <p className="text-[11px] text-slate-500">
              Confirming will unassign active team members from{' '}
              <strong>{revokeConfirm.entity.name}</strong> and revoke Manager privileges while
              keeping them registered as a Consultant.
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setRevokeConfirm(null)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={Boolean(togglingId)}
                onClick={() => void handleConfirmForceRevoke()}
                className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                Unassign Team &amp; Revoke Manager
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
};

