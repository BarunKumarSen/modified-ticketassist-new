import React, { useState } from 'react';
import {
  ArrowLeftRight,
  CheckCircle2,
  Download,
  FileText,
  Monitor,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Share2,
  Trash2,
} from 'lucide-react';
import type {
  AssetOSState,
  Assignment,
  AssetReturn,
  AssetTransfer,
  MaintenanceRecord,
  ModalType,
  ThemePalette,
} from '../types/asset';
import { THEME_PALETTES, formatCurrency, paginateItems, toCSV } from '../utils/assetMath';

interface OperationsHeaderProps {
  title: string;
  subtitle: string;
  search: string;
  onSearchChange: (v: string) => void;
  onNew: () => void;
  onExportCSV: () => void;
  theme: ThemePalette;
}

const OperationsHeader: React.FC<OperationsHeaderProps> = ({
  title,
  subtitle,
  search,
  onSearchChange,
  onNew,
  onExportCSV,
  theme,
}) => {
  const palette = THEME_PALETTES[theme];
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">{title}</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{subtitle}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 no-print">
        <button
          type="button"
          onClick={onNew}
          className={`${palette.primaryBtn} ${palette.primaryBtnHover} px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer whitespace-nowrap`}
        >
          <Plus className="w-3.5 h-3.5" /> New
        </button>
        <div className="relative">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
            <Search className="w-3.5 h-3.5" />
          </span>
          <input
            type="text"
            aria-label={`Search ${title}`}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search..."
            className="w-48 pl-8 pr-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs dark:text-slate-100 focus:ring-2 focus:ring-blue-600 focus:outline-none"
          />
        </div>
        <div className="flex space-x-1 border-l border-slate-200 dark:border-slate-700 pl-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" /> Print
          </button>
          <button
            type="button"
            onClick={onExportCSV}
            className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        </div>
      </div>
    </div>
  );
};

function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number>>) {
  const csv = toCSV(headers, rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function resolveAssignmentHolder(state: AssetOSState, targetId: string) {
  const emp = state.employees.find(
    (e) => e.id === targetId || e.employeeId.toUpperCase() === targetId.toUpperCase()
  );
  if (emp) {
    return {
      name: emp.name,
      code: emp.employeeId,
      typeLabel: 'Employee',
      department: emp.department || '—',
    };
  }
  const ent = (state.entities || []).find(
    (e) => e.id === targetId || e.entityCode.toUpperCase() === targetId.toUpperCase()
  );
  if (ent) {
    return {
      name: ent.name,
      code: ent.entityCode,
      typeLabel: ent.entityType,
      department: ent.department || ent.entityType,
    };
  }
  return {
    name: targetId || 'Unknown',
    code: targetId || '',
    typeLabel: '',
    department: '—',
  };
}

/* 1. ASSIGNMENTS VIEW */
export const AssignmentsView: React.FC<{
  state: AssetOSState;
  onOpenModal: (modal: ModalType) => void;
  onDeleteAssignment: (asn: Assignment) => void;
  onReturnSubAssignment?: (asn: Assignment) => void;
}> = ({ state, onOpenModal, onDeleteAssignment, onReturnSubAssignment }) => {
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  const filtered = state.assignments.filter((asn) => {
    const holder = resolveAssignmentHolder(state, asn.employeeId);
    const asset = state.assets.find((a) => a.id === asn.assetId);
    const q = search.toLowerCase();
    return (
      !q ||
      asn.id.toLowerCase().includes(q) ||
      holder.name.toLowerCase().includes(q) ||
      holder.code.toLowerCase().includes(q) ||
      holder.typeLabel.toLowerCase().includes(q) ||
      (asset?.name || '').toLowerCase().includes(q) ||
      holder.department.toLowerCase().includes(q)
    );
  });

  const paged = paginateItems(filtered, page, pageSize);

  return (
    <div className="space-y-4 pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex-1">
          <OperationsHeader
            title="Asset Assignment"
            subtitle="Primary & hierarchical sub-assignments across Employees, Consultants, Retainers, Freelancers, YRP & Interns"
            search={search}
            onSearchChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            onNew={() => onOpenModal({ type: 'assign' })}
            onExportCSV={() =>
              downloadCsv(
                'asset-assignments.csv',
                [
                  'Assign No',
                  'Custody Level',
                  'Date',
                  'Return Date',
                  'Assignee Type',
                  'Assignee Name',
                  'Assignee Code',
                  'Asset',
                  'Department',
                  'Assigned By',
                  'Condition',
                  'Status',
                ],
                filtered.map((asn) => {
                  const holder = resolveAssignmentHolder(state, asn.employeeId);
                  const asset = state.assets.find((a) => a.id === asn.assetId);
                  return [
                    asn.id,
                    asn.custodyLevel || 'Primary',
                    asn.assignDate,
                    asn.returnDate || '',
                    asn.assigneeType || holder.typeLabel || 'Employee',
                    holder.name,
                    holder.code,
                    asset?.name || asn.assetId,
                    holder.department,
                    asn.assignedBy || 'Admin',
                    asn.condition || 'Good',
                    asn.status,
                  ];
                })
              )
            }
            theme={state.settings.theme}
          />
        </div>
      </div>

      <div className="flex justify-end no-print">
        <button
          type="button"
          onClick={() => onOpenModal({ type: 'sub-assign' })}
          className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 dark:bg-slate-800 dark:text-blue-400 dark:border-slate-700 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer"
        >
          <Share2 className="w-3.5 h-3.5" />
          <span>Sub-Assign Allocated Asset</span>
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                <th className="px-4 py-3">Assign No</th>
                <th className="px-4 py-3">Dates</th>
                <th className="px-4 py-3">Custody Holder</th>
                <th className="px-4 py-3">Asset</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Custody</th>
                <th className="px-4 py-3">Condition</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right no-print">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {paged.items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                    No asset assignments logged.
                  </td>
                </tr>
              ) : (
                paged.items.map((asn) => {
                  const holder = resolveAssignmentHolder(state, asn.employeeId);
                  const asset = state.assets.find((a) => a.id === asn.assetId);
                  const custody = asn.custodyLevel || 'Primary';
                  const hasActiveChildSub =
                    asn.status === 'Active' &&
                    custody === 'Primary' &&
                    state.assignments.some(
                      (sub) =>
                        sub.assetId === asn.assetId &&
                        sub.status === 'Active' &&
                        sub.custodyLevel === 'Sub-Assigned'
                    );
                  return (
                    <tr key={asn.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-mono font-bold text-slate-600">{asn.id}</td>
                      <td className="px-4 py-3 text-slate-500 tabular-nums whitespace-nowrap">
                        <span className="block">{asn.assignDate}</span>
                        {asn.returnDate && (
                          <span className="block text-[10px] text-emerald-700">
                            Ret: {asn.returnDate}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-bold text-slate-900 block">{holder.name}</span>
                        <span className="text-[10px] font-mono text-slate-500">
                          {[asn.assigneeType || holder.typeLabel, holder.code].filter(Boolean).join(' · ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <span className="font-semibold text-slate-800 block">
                          {asset?.name || asn.assetId}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">{asn.assetId}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{holder.department}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                            custody === 'Sub-Assigned'
                              ? 'bg-violet-50 text-violet-800 border-violet-200'
                              : 'bg-sky-50 text-sky-800 border-sky-200'
                          }`}
                        >
                          {custody}
                        </span>
                        <span className="block text-[10px] text-slate-400 mt-0.5">
                          by {asn.assignedBy || 'Admin'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 rounded text-[10px] font-bold">
                          {asn.condition || 'Good'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            asn.status === 'Active'
                              ? 'bg-[#dcfce7] text-[#166534]'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {asn.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right space-x-1 whitespace-nowrap no-print">
                        {asn.allotmentId && (
                          <button
                            type="button"
                            aria-label={`Print allotment form ${asn.allotmentId}`}
                            onClick={() =>
                              onOpenModal({
                                type: 'freelancer-allotment-print',
                                allotmentId: asn.allotmentId,
                                assignmentId: asn.id,
                              })
                            }
                            title="Print Freelancer Allotment Form"
                            className="w-7 h-7 rounded bg-amber-100 text-amber-800 hover:bg-amber-200 inline-flex items-center justify-center cursor-pointer"
                          >
                            <FileText className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {asn.status === 'Active' && custody === 'Primary' && !hasActiveChildSub && (
                          <button
                            type="button"
                            aria-label={`Sub-assign ${asset?.name || asn.assetId}`}
                            onClick={() =>
                              onOpenModal({
                                type: 'sub-assign',
                                preselectedAssetId: asn.assetId,
                                preselectedParentAssignmentId: asn.id,
                              })
                            }
                            title="Sub-Assign Asset"
                            className="w-7 h-7 rounded bg-violet-100 text-violet-800 hover:bg-violet-200 inline-flex items-center justify-center cursor-pointer"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {asn.status === 'Active' && custody === 'Sub-Assigned' && onReturnSubAssignment && (
                          <button
                            type="button"
                            aria-label={`Return sub-assignment ${asn.id}`}
                            onClick={() => onReturnSubAssignment(asn)}
                            title="Return Sub-Assignment to Primary Holder"
                            className="w-7 h-7 rounded bg-amber-100 text-amber-900 hover:bg-amber-200 inline-flex items-center justify-center cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {asn.status === 'Active' && custody === 'Primary' && (
                          <>
                            <button
                              type="button"
                              aria-label={`Return ${asset?.name || asn.assetId}`}
                              onClick={() =>
                                onOpenModal({
                                  type: 'return',
                                  preselectedAssetId: asn.assetId,
                                  preselectedEmployeeId: asn.employeeId,
                                })
                              }
                              title="Return Primary"
                              className="w-7 h-7 rounded bg-[#dcfce7] text-[#166534] hover:bg-[#bbf7d0] inline-flex items-center justify-center cursor-pointer"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Transfer ${asset?.name || asn.assetId}`}
                              onClick={() =>
                                onOpenModal({
                                  type: 'transfer',
                                  preselectedAssetId: asn.assetId,
                                  preselectedEmployeeId: asn.employeeId,
                                })
                              }
                              title="Transfer"
                              className="w-7 h-7 rounded bg-[#dbeafe] text-[#1e40af] hover:bg-[#bfdbfe] inline-flex items-center justify-center cursor-pointer"
                            >
                              <ArrowLeftRight className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          aria-label={`Delete assignment ${asn.id}`}
                          onClick={() => onDeleteAssignment(asn)}
                          title="Delete"
                          className="w-7 h-7 rounded bg-[#fce7f3] text-[#be185d] hover:bg-[#fbcfe8] inline-flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
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
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
        />
      </div>
    </div>
  );
};

/* 2. RETURNS VIEW */
export const ReturnsView: React.FC<{
  state: AssetOSState;
  onOpenModal: (modal: ModalType) => void;
  onDeleteReturn: (ret: AssetReturn) => void;
}> = ({ state, onOpenModal, onDeleteReturn }) => {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const filtered = state.returns.filter((r) => {
    const holder = resolveAssignmentHolder(state, r.employeeId);
    const asset = state.assets.find((a) => a.id === r.assetId);
    const q = search.toLowerCase();
    return (
      !q ||
      r.id.toLowerCase().includes(q) ||
      holder.name.toLowerCase().includes(q) ||
      holder.code.toLowerCase().includes(q) ||
      (asset?.name || '').toLowerCase().includes(q)
    );
  });

  const paged = paginateItems(filtered, page, pageSize);

  return (
    <div className="space-y-4 pb-10">
      <OperationsHeader
        title="Asset Return"
        subtitle="Process asset returns"
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        onNew={() => onOpenModal({ type: 'return' })}
        onExportCSV={() =>
          downloadCsv(
            'asset-returns.csv',
            ['Return No.', 'Date', 'Custody Holder', 'Asset', 'Condition', 'Damage'],
            filtered.map((r) => {
              const holder = resolveAssignmentHolder(state, r.employeeId);
              const asset = state.assets.find((a) => a.id === r.assetId);
              return [r.id, r.date, holder.name, asset?.name || r.assetId, r.condition, r.damage];
            })
          )
        }
        theme={state.settings.theme}
      />

      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                <th className="px-4 py-3">Return No.</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Custody Holder</th>
                <th className="px-4 py-3">Asset</th>
                <th className="px-4 py-3">Condition</th>
                <th className="px-4 py-3">Damage</th>
                <th className="px-4 py-3 text-right no-print">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {paged.items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    No asset returns recorded.
                  </td>
                </tr>
              ) : (
                paged.items.map((r) => {
                  const holder = resolveAssignmentHolder(state, r.employeeId);
                  const asset = state.assets.find((a) => a.id === r.assetId);
                  return (
                    <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-mono font-bold text-slate-600">{r.id}</td>
                      <td className="px-4 py-3 text-slate-500 tabular-nums">{r.date}</td>
                      <td className="px-4 py-3">
                        <span className="font-bold text-slate-900 block">{holder.name}</span>
                        {holder.code && (
                          <span className="text-[10px] font-mono text-slate-400">
                            {[holder.typeLabel, holder.code].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{asset?.name || r.assetId}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 bg-[#dcfce7] text-[#166534] border border-[#bbf7d0] rounded text-[10px] font-bold">
                          {r.condition}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded text-[10px] font-bold">
                          {r.damage}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right no-print">
                        <button
                          type="button"
                          aria-label={`Delete return ${r.id}`}
                          onClick={() => onDeleteReturn(r)}
                          className="w-7 h-7 rounded bg-[#fce7f3] text-[#be185d] hover:bg-[#fbcfe8] inline-flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
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
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
        />
      </div>
    </div>
  );
};

/* 3. TRANSFERS VIEW */
export const TransfersView: React.FC<{
  state: AssetOSState;
  onOpenModal: (modal: ModalType) => void;
  onDeleteTransfer: (t: AssetTransfer) => void;
}> = ({ state, onOpenModal, onDeleteTransfer }) => {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const filtered = state.transfers.filter((t) => {
    const asset = state.assets.find((a) => a.id === t.assetId);
    const q = search.toLowerCase();
    return (
      !q ||
      t.id.toLowerCase().includes(q) ||
      (asset?.name || '').toLowerCase().includes(q) ||
      t.fromEmp.toLowerCase().includes(q) ||
      t.toEmp.toLowerCase().includes(q)
    );
  });
  const paged = paginateItems(filtered, page, pageSize);

  return (
    <div className="space-y-4 pb-10">
      <OperationsHeader
        title="Asset Transfer"
        subtitle="Transfer assets between departments"
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        onNew={() => onOpenModal({ type: 'transfer' })}
        onExportCSV={() =>
          downloadCsv(
            'asset-transfers.csv',
            ['Transfer No.', 'Date', 'Asset', 'From Dept', 'To Dept', 'From Employee', 'To Employee', 'Reason'],
            filtered.map((t) => {
              const asset = state.assets.find((a) => a.id === t.assetId);
              return [t.id, t.date, asset?.name || t.assetId, t.fromDept, t.toDept, t.fromEmp, t.toEmp, t.reason];
            })
          )
        }
        theme={state.settings.theme}
      />

      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                <th className="px-4 py-3">Transfer No.</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Asset</th>
                <th className="px-4 py-3">From Dept</th>
                <th className="px-4 py-3">To Dept</th>
                <th className="px-4 py-3">From Employee</th>
                <th className="px-4 py-3">To Employee</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3 text-center">Transferred By</th>
                <th className="px-4 py-3 text-right no-print">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {paged.items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-400">
                    No asset transfers logged.
                  </td>
                </tr>
              ) : (
                paged.items.map((t) => {
                  const asset = state.assets.find((a) => a.id === t.assetId);
                  return (
                    <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-mono font-bold text-slate-600">{t.id}</td>
                      <td className="px-4 py-3 text-slate-500 tabular-nums">{t.date}</td>
                      <td className="px-4 py-3 text-slate-600">{asset?.name || t.assetId}</td>
                      <td className="px-4 py-3 text-slate-600">{t.fromDept}</td>
                      <td className="px-4 py-3 text-slate-600">{t.toDept}</td>
                      <td className="px-4 py-3 font-bold text-slate-900">{t.fromEmp}</td>
                      <td className="px-4 py-3 font-bold text-slate-900">{t.toEmp}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 bg-slate-100 text-slate-700 rounded text-[10px] font-bold">
                          {t.reason}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-slate-600">Admin</td>
                      <td className="px-4 py-3 text-right no-print">
                        <button
                          type="button"
                          aria-label={`Delete transfer ${t.id}`}
                          onClick={() => onDeleteTransfer(t)}
                          className="w-7 h-7 rounded bg-[#fce7f3] text-[#be185d] hover:bg-[#fbcfe8] inline-flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
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
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
        />
      </div>
    </div>
  );
};

/* 4. MAINTENANCE VIEW */
export const MaintenanceView: React.FC<{
  state: AssetOSState;
  onOpenModal: (modal: ModalType) => void;
  onCompleteMaintenance: (m: MaintenanceRecord) => void;
  onDeleteMaintenance: (m: MaintenanceRecord) => void;
}> = ({ state, onOpenModal, onCompleteMaintenance, onDeleteMaintenance }) => {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const currency = state.settings.currency || '$';

  const filtered = state.maintenance.filter((m) => {
    const asset = state.assets.find((a) => a.id === m.assetId);
    const q = search.toLowerCase();
    return (
      !q ||
      m.id.toLowerCase().includes(q) ||
      (asset?.name || '').toLowerCase().includes(q) ||
      m.vendor.toLowerCase().includes(q) ||
      m.type.toLowerCase().includes(q)
    );
  });

  const paged = paginateItems(filtered, page, pageSize);
  const totalCost = filtered.reduce((acc, m) => acc + (Number(m.cost) || 0), 0);

  return (
    <div className="space-y-4 pb-10">
      <OperationsHeader
        title="Asset Maintenance"
        subtitle="Track servicing and repair"
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        onNew={() => onOpenModal({ type: 'maintenance' })}
        onExportCSV={() =>
          downloadCsv(
            'asset-maintenance.csv',
            ['Maint. No.', 'Date', 'Asset', 'Vendor', 'Type', 'Cost', 'Next Service', 'Status'],
            filtered.map((m) => {
              const asset = state.assets.find((a) => a.id === m.assetId);
              return [m.id, m.serviceDate, asset?.name || m.assetId, m.vendor, m.type, m.cost, m.nextDate || '-', m.status];
            })
          )
        }
        theme={state.settings.theme}
      />

      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                <th className="px-4 py-3">Maint. No.</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Asset</th>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Cost</th>
                <th className="px-4 py-3">Next Service</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right no-print">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {paged.items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                    No maintenance records logged.
                  </td>
                </tr>
              ) : (
                paged.items.map((m) => {
                  const asset = state.assets.find((a) => a.id === m.assetId);
                  const badge =
                    m.status === 'Completed'
                      ? 'bg-[#dcfce7] text-[#166534] border-[#bbf7d0]'
                      : m.status === 'Cancelled'
                      ? 'bg-slate-100 text-slate-600 border-slate-200'
                      : 'bg-[#ffedd5] text-[#c2410c] border-[#fed7aa]';
                  return (
                    <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-mono font-bold text-slate-600">{m.id}</td>
                      <td className="px-4 py-3 text-slate-500 tabular-nums">{m.serviceDate}</td>
                      <td className="px-4 py-3 font-bold text-slate-900">
                        {asset?.name || 'Unknown'} ({m.assetId})
                      </td>
                      <td className="px-4 py-3 text-slate-600">{m.vendor || '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{m.type}</td>
                      <td className="px-4 py-3 font-bold text-slate-800 tabular-nums">
                        {formatCurrency(m.cost, currency)}
                      </td>
                      <td className="px-4 py-3 text-slate-600 tabular-nums">
                        {m.nextDate || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-[10px] font-bold border ${badge}`}>
                          {m.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right space-x-1 whitespace-nowrap no-print">
                        {m.status !== 'Completed' && (
                          <button
                            type="button"
                            aria-label={`Complete maintenance ${m.id}`}
                            onClick={() => onCompleteMaintenance(m)}
                            title="Mark Completed"
                            className="w-7 h-7 rounded bg-[#dcfce7] text-[#166534] hover:bg-[#bbf7d0] inline-flex items-center justify-center cursor-pointer"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={`Edit maintenance ${m.id}`}
                          onClick={() => onOpenModal({ type: 'maintenance', maintenanceId: m.id })}
                          title="Edit"
                          className="w-7 h-7 rounded bg-[#ffedd5] text-[#c2410c] hover:bg-[#fed7aa] inline-flex items-center justify-center cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete maintenance ${m.id}`}
                          onClick={() => onDeleteMaintenance(m)}
                          title="Delete"
                          className="w-7 h-7 rounded bg-[#fce7f3] text-[#be185d] hover:bg-[#fbcfe8] inline-flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
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
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
          extraSummary={`Cost: ${formatCurrency(totalCost, currency)}`}
        />
      </div>
    </div>
  );
};

/* 5. DISPOSAL VIEW */
export const DisposalView: React.FC<{
  state: AssetOSState;
  onOpenModal: (modal: ModalType) => void;
}> = ({ state, onOpenModal }) => {
  const [search, setSearch] = useState('');
  const currency = state.settings.currency || '$';

  const filtered = state.disposals.filter((d) => {
    const asset = state.assets.find((a) => a.id === d.assetId);
    const q = search.toLowerCase();
    return (
      !q ||
      d.id.toLowerCase().includes(q) ||
      (asset?.name || '').toLowerCase().includes(q) ||
      d.reason.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4 pb-10">
      <OperationsHeader
        title="Asset Disposal"
        subtitle="Retire assets from inventory"
        search={search}
        onSearchChange={setSearch}
        onNew={() => onOpenModal({ type: 'disposal' })}
        onExportCSV={() =>
          downloadCsv(
            'asset-disposals.csv',
            ['Disposal ID', 'Date', 'Asset', 'Reason', 'Salvage Value', 'Remarks'],
            filtered.map((d) => {
              const asset = state.assets.find((a) => a.id === d.assetId);
              return [d.id, d.disposalDate, asset?.name || d.assetId, d.reason, d.salvageRecovered, d.notes];
            })
          )
        }
        theme={state.settings.theme}
      />

      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 flex flex-col items-center justify-center text-slate-400">
            <Monitor className="w-10 h-10 mb-3 text-slate-300" />
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">No disposals yet.</p>
            <p className="text-xs text-slate-400 mt-1">
              Retired or scrapped assets will appear here with salvage tracking.
            </p>
            <button
              type="button"
              onClick={() => onOpenModal({ type: 'disposal' })}
              className="mt-4 px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-bold cursor-pointer"
            >
              Dispose First Asset
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                  <th className="px-4 py-3">Disposal ID</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Asset</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Salvage Value</th>
                  <th className="px-4 py-3">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filtered.map((d) => {
                  const asset = state.assets.find((a) => a.id === d.assetId);
                  return (
                    <tr key={d.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono font-bold text-slate-600">{d.id}</td>
                      <td className="px-4 py-3 text-slate-500 tabular-nums">{d.disposalDate}</td>
                      <td className="px-4 py-3 font-bold text-slate-900">
                        {asset?.name || d.assetId}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 bg-[#fce7f3] text-[#be185d] rounded text-[10px] font-bold">
                          {d.reason}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-bold text-emerald-700 tabular-nums">
                        {formatCurrency(d.salvageRecovered, currency)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{d.notes || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center text-xs text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900">
          <div className="tabular-nums">Total: {filtered.length}</div>
          <div className="tabular-nums">
            Showing {filtered.length === 0 ? 0 : 1}-{filtered.length} of {filtered.length} entries
          </div>
        </div>
      </div>
    </div>
  );
};

/* SHARED TABLE PAGINATION FOOTER */
export const TablePaginationFooter: React.FC<{
  total: number;
  startIndex: number;
  endIndex: number;
  page: number;
  totalPages: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: number) => void;
  extraSummary?: string;
}> = ({
  total,
  startIndex,
  endIndex,
  page,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
  extraSummary,
}) => (
  <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap justify-between items-center gap-2 text-xs text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 no-print">
    <div className="tabular-nums">
      Total: <span className="font-bold text-slate-800">{total}</span>
      {extraSummary ? ` · ${extraSummary}` : ''}
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <span className="tabular-nums">
        Showing {startIndex}-{endIndex} of {total} entries
      </span>
      <div className="flex items-center space-x-1">
        <span>Rows per page:</span>
        <select
          aria-label="Rows per page"
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="border border-slate-200 rounded px-1.5 py-0.5 focus:outline-none"
        >
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
        </select>
      </div>
      {totalPages > 1 && (
        <div className="flex space-x-1">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="px-2 py-0.5 border rounded bg-slate-50 disabled:opacity-40 cursor-pointer"
          >
            Prev
          </button>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="px-2 py-0.5 border rounded bg-slate-50 disabled:opacity-40 cursor-pointer"
          >
            Next
          </button>
        </div>
      )}
    </div>
  </div>
);
