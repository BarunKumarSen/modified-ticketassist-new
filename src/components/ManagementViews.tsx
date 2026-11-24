import React, { useRef, useState } from 'react';
import {
  ArrowRightLeft,
  Check,
  CreditCard,
  Download,
  Eye,
  FileSpreadsheet,
  GitBranch,
  Mail,
  Pencil,
  Plus,
  Power,
  Printer,
  Search,
  Tag,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { apiClient, ApiError } from '../api/client';
import type {
  AssetOSState,
  Employee,
  ExpenseCategoryRecord,
  ExpenseRecord,
  ModalType,
  PaymentModeRecord,
  ToastMessage,
  Vendor,
} from '../types/asset';
import { THEME_PALETTES, formatCurrency, paginateItems, toCSV } from '../utils/assetMath';
import {
  buildDirectoryExportCsv,
  generateDirectoryTemplateCsv,
} from '../utils/directoryImportExport';
import { generateEmployeeImportTemplateCsv } from '../utils/employeeImport';
import { ManagerMappingPanel } from './ManagerMappingPanel';
import { TablePaginationFooter } from './OperationsViews';

function triggerDownloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number>>
) {
  const csv = toCSV(headers, rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/* EMPLOYEES VIEW */
export const EmployeesView: React.FC<{
  state: AssetOSState;
  employeesOverride?: Employee[];
  isAdmin?: boolean;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  onOpenModal: (modal: ModalType) => void;
  onDeleteEmployee: (emp: Employee) => void;
  onImportEmployeesCSV: (csvText: string) => void;
  onRefreshEmployees?: () => Promise<void>;
  onNotify?: (msg: string, type?: ToastMessage['type']) => void;
  onMailStatus?: (status: { ok: boolean; title: string; details?: string }) => void;
}> = ({
  state,
  employeesOverride,
  isAdmin = false,
  canCreate = true,
  canEdit = true,
  canDelete = true,
  onOpenModal,
  onDeleteEmployee,
  onImportEmployeesCSV,
  onRefreshEmployees,
  onNotify,
  onMailStatus,
}) => {
  const [subView, setSubView] = useState<'directory' | 'manager-mapping'>('directory');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sendingMailEmpId, setSendingMailEmpId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSendEmployeeMail = async (emp: Employee) => {
    setSendingMailEmpId(emp.id);
    try {
      const res = await apiClient.sendEntityMail('employee', emp.id);
      if (onMailStatus) {
        onMailStatus({
          ok: true,
          title: 'Email Sent Successfully',
          details: `Sent to ${res.log.recipientEmail} (${res.log.subject})`,
        });
      } else {
        onNotify?.('Email Sent Successfully', 'success');
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Email Delivery Failed';
      const details = err instanceof ApiError ? err.details : undefined;
      if (onMailStatus) {
        onMailStatus({ ok: false, title: msg, details });
      } else {
        onNotify?.('Email Delivery Failed', 'error');
      }
    } finally {
      setSendingMailEmpId(null);
    }
  };
  const palette = THEME_PALETTES[state.settings.theme];
  const sourceEmployees = employeesOverride ?? state.employees;

  const filtered = sourceEmployees.filter((emp) => {
    const q = search.toLowerCase();
    return (
      !q ||
      emp.name.toLowerCase().includes(q) ||
      emp.employeeId.toLowerCase().includes(q) ||
      emp.id.toLowerCase().includes(q) ||
      emp.department.toLowerCase().includes(q) ||
      emp.designation.toLowerCase().includes(q) ||
      (emp.center || emp.branch || '').toLowerCase().includes(q) ||
      (emp.reportingManagerName || '').toLowerCase().includes(q) ||
      emp.email.toLowerCase().includes(q)
    );
  });

  const paged = paginateItems(filtered, page, pageSize);

  return (
    <div className="space-y-4 pb-10">
      <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">Employee</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {canCreate || canEdit || canDelete
              ? 'Manage employee records, Indian center assignments, category conversions, and reporting manager hierarchy'
              : 'Read-only employee directory'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 no-print">
          <div className="flex items-center gap-1 p-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
            <button
              type="button"
              onClick={() => setSubView('directory')}
              className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                subView === 'directory'
                  ? `${palette.primaryBtn}`
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Directory</span>
            </button>
            <button
              type="button"
              onClick={() => setSubView('manager-mapping')}
              className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                subView === 'manager-mapping'
                  ? `${palette.primaryBtn}`
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span>Manager Mapping</span>
            </button>
          </div>
          {subView === 'directory' && canCreate && (
            <>
              <button
                type="button"
                onClick={() => onOpenModal({ type: 'employee' })}
                className={`${palette.primaryBtn} ${palette.primaryBtnHover} px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer`}
              >
                <Plus className="w-3.5 h-3.5" /> New
              </button>

              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    if (typeof reader.result === 'string') onImportEmployeesCSV(reader.result);
                  };
                  reader.readAsText(file);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/50 text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-800 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" /> Import CSV
              </button>
              <button
                type="button"
                onClick={() => {
                  const csv = generateEmployeeImportTemplateCsv();
                  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = 'employee-import-template.csv';
                  link.click();
                  URL.revokeObjectURL(url);
                }}
                title="Download supported Employee CSV Template"
                className="bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" /> Template CSV
              </button>
            </>
          )}

          {subView === 'directory' && (
            <>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
                  <Search className="w-3.5 h-3.5" />
                </span>
                <input
                  type="text"
                  aria-label="Search employees"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search employees..."
                  className={`w-48 pl-8 pr-3 py-1.5 bg-white dark:bg-slate-800 border ${palette.border} dark:border-slate-700 rounded-lg text-xs dark:text-slate-100 focus:ring-2 focus:ring-blue-600 focus:outline-none`}
                />
              </div>

              <div className="flex space-x-1 border-l border-slate-200 dark:border-slate-700 pl-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" /> Print
                </button>
                <button
                  type="button"
                  onClick={() =>
                    triggerDownloadCsv(
                      'employees.csv',
                      [
                        'ID',
                        'Name',
                        'Email',
                        'Department',
                        'Designation',
                        'Center',
                        'Is Manager',
                        'Reporting Manager',
                        'Manager Email',
                        'Mobile',
                        'Status',
                      ],
                      filtered.map((e) => [
                        e.employeeId,
                        e.name,
                        e.email,
                        e.department,
                        e.designation,
                        e.center || e.branch,
                        e.isManager ? 'Yes' : 'No',
                        e.reportingManagerName || '',
                        e.reportingManagerEmail || '',
                        e.phone,
                        e.status,
                      ])
                    )
                  }
                  className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" /> Export CSV
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {subView === 'manager-mapping' ? (
        <ManagerMappingPanel
          employees={sourceEmployees}
          isAdmin={isAdmin}
          onRefreshEmployees={onRefreshEmployees || (async () => undefined)}
          onNotify={onNotify || (() => undefined)}
        />
      ) : (
        <>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {paged.items.map((emp) => {
          const isActive = emp.status === 'Active';
          const statusBadge = isActive
            ? 'bg-[#dcfce7] text-[#166534]'
            : 'bg-[#fce7f3] text-[#be185d]';
          const initials = emp.name
            .split(' ')
            .map((n) => n[0])
            .join('')
            .substring(0, 2)
            .toUpperCase();

          return (
            <div
              key={emp.id}
              className={`bg-white dark:bg-slate-900 rounded-xl border ${palette.border} dark:border-slate-800 shadow-sm flex flex-col overflow-hidden ${
                !isActive ? 'opacity-80' : ''
              }`}
            >
              <div className={`p-3 border-b border-slate-100 dark:border-slate-800 flex items-center space-x-3 ${palette.surfaceBg} dark:bg-slate-800/70`}>
                <div
                  className={`w-10 h-10 rounded-full ${statusBadge} flex items-center justify-center font-bold text-sm border border-current/15 shrink-0`}
                >
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-bold text-xs text-slate-900 dark:text-white truncate">{emp.name}</h4>
                  <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400">{emp.employeeId}</p>
                </div>
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${statusBadge}`}>
                  {emp.status}
                </span>
              </div>

              <div className="p-3 text-[10px] flex-1 space-y-1.5 text-slate-600 dark:text-slate-300">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">Designation</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-100 text-right">{emp.designation}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">Department</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-100 text-right">{emp.department}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">Center</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-100 text-right">
                    {emp.center || emp.branch || 'Mumbai'}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">Role Type</span>
                  <span className={`font-semibold text-right ${emp.isManager ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-200'}`}>
                    {emp.isManager ? 'Manager' : 'Employee'}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">Reporting Manager</span>
                  <span
                    className="font-semibold text-slate-800 dark:text-slate-100 text-right truncate"
                    title={emp.reportingManagerEmail || undefined}
                  >
                    {emp.reportingManagerName || '—'}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">Mobile</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-100 text-right tabular-nums">
                    {emp.phone}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">Email</span>
                  <span
                    className="font-semibold text-slate-800 dark:text-slate-100 text-right truncate"
                    title={emp.email}
                  >
                    {emp.email}
                  </span>
                </div>
              </div>

              <div className="p-2 border-t border-slate-100 dark:border-slate-800 flex justify-center space-x-2 bg-slate-50 dark:bg-slate-800/50 no-print">
                <button
                  type="button"
                  aria-label={`View asset statement for ${emp.name}`}
                  onClick={() => onOpenModal({ type: 'employee-statement', employeeId: emp.id })}
                  title="Asset Statement"
                  className="w-7 h-7 rounded bg-sky-50 text-sky-700 hover:bg-sky-100 flex items-center justify-center cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Send email to ${emp.name}`}
                  disabled={sendingMailEmpId === emp.id}
                  onClick={() => void handleSendEmployeeMail(emp)}
                  title="Send Account / Notification Mail"
                  className="w-7 h-7 rounded bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200 flex items-center justify-center cursor-pointer disabled:opacity-50"
                >
                  <Mail className="w-3.5 h-3.5" />
                </button>
                {canEdit && (
                  <>
                    <button
                      type="button"
                      aria-label={`Convert category for ${emp.name}`}
                      onClick={() =>
                        onOpenModal({
                          type: 'convert-employment',
                          sourceType: 'Employee',
                          sourceId: emp.id,
                          sourceCode: emp.employeeId,
                          personName: emp.name,
                        })
                      }
                      title="Convert Employment Category"
                      className="w-7 h-7 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100 flex items-center justify-center cursor-pointer"
                    >
                      <ArrowRightLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Edit ${emp.name}`}
                      onClick={() => onOpenModal({ type: 'employee', employeeId: emp.id })}
                      title="Edit"
                      className="w-7 h-7 rounded bg-orange-50 text-orange-700 hover:bg-orange-100 flex items-center justify-center cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
                {canDelete && (
                  <button
                    type="button"
                    aria-label={`Delete ${emp.name}`}
                    onClick={() => onDeleteEmployee(emp)}
                    title="Delete"
                    className="w-7 h-7 rounded bg-rose-50 text-rose-700 hover:bg-rose-100 flex items-center justify-center cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className={`bg-white dark:bg-slate-900 rounded-xl border ${palette.border} dark:border-slate-800 shadow-sm overflow-hidden`}>
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
        </>
      )}
    </div>
  );
};

/* VENDORS VIEW */
export const VendorsView: React.FC<{
  state: AssetOSState;
  onOpenModal: (modal: ModalType) => void;
  onDeleteVendor: (v: Vendor) => void;
  onImportVendorsCSV?: (csvText: string) => void;
}> = ({ state, onOpenModal, onDeleteVendor, onImportVendorsCSV }) => {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const fileRef = useRef<HTMLInputElement>(null);
  const palette = THEME_PALETTES[state.settings.theme];

  const filtered = state.vendors.filter((v) => {
    const q = search.toLowerCase();
    return (
      !q ||
      v.id.toLowerCase().includes(q) ||
      v.name.toLowerCase().includes(q) ||
      v.contactPerson.toLowerCase().includes(q) ||
      v.phone.toLowerCase().includes(q)
    );
  });
  const paged = paginateItems(filtered, page, pageSize);

  const downloadCsv = (filename: string, csvText: string) => {
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 pb-10">
      <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">Vendor</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Manage vendor directory with manual Vendor Code entry and CSV import/export
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 no-print">
          <button
            type="button"
            onClick={() => onOpenModal({ type: 'vendor' })}
            data-testid="add-vendor-btn"
            className={`${palette.primaryBtn} ${palette.primaryBtnHover} px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer`}
          >
            <Plus className="w-3.5 h-3.5" /> New
          </button>
          {onImportVendorsCSV && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    if (typeof reader.result === 'string') onImportVendorsCSV(reader.result);
                  };
                  reader.readAsText(file);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                data-testid="import-vendor-csv-btn"
                className="bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/50 text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-800 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" /> Import CSV
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() =>
              downloadCsv('vendor-import-template.csv', generateDirectoryTemplateCsv('Vendor'))
            }
            data-testid="template-vendor-csv-btn"
            className="bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" /> Template CSV
          </button>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
              <Search className="w-3.5 h-3.5" />
            </span>
            <input
              type="text"
              aria-label="Search vendors"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search vendors..."
              className={`w-48 pl-8 pr-3 py-1.5 bg-white dark:bg-slate-800 border ${palette.border} dark:border-slate-700 rounded-lg text-xs dark:text-slate-100 focus:ring-2 focus:ring-blue-600 focus:outline-none`}
            />
          </div>
          <div className="flex space-x-1 border-l border-slate-200 dark:border-slate-700 pl-2">
            <button
              type="button"
              onClick={() => window.print()}
              data-testid="print-vendor-btn"
              className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
            <button
              type="button"
              onClick={() =>
                downloadCsv('vendors.csv', buildDirectoryExportCsv('Vendor', filtered))
              }
              data-testid="export-vendor-csv-btn"
              className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
          </div>
        </div>
      </div>

      <div className={`bg-white dark:bg-slate-900 rounded-xl shadow-sm border ${palette.border} dark:border-slate-800 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className={`${palette.surfaceBg} dark:bg-slate-800 border-b ${palette.border} dark:border-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider`}>
                <th className="px-4 py-3">Vendor Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Contact Person</th>
                <th className="px-4 py-3">Mobile</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">GST</th>
                <th className="px-4 py-3 text-right no-print">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {paged.items.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-slate-700 dark:text-slate-200">{v.id}</td>
                  <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">{v.name}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{v.contactPerson || '—'}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300 tabular-nums">{v.phone || '—'}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{v.email || '—'}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{v.gst || '—'}</td>
                  <td className="px-4 py-3 text-right space-x-1 no-print">
                    <button
                      type="button"
                      aria-label={`Edit ${v.name}`}
                      onClick={() => onOpenModal({ type: 'vendor', vendorId: v.id })}
                      className="w-7 h-7 rounded bg-orange-50 text-orange-700 hover:bg-orange-100 inline-flex items-center justify-center cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${v.name}`}
                      onClick={() => onDeleteVendor(v)}
                      className="w-7 h-7 rounded bg-rose-50 text-rose-700 hover:bg-rose-100 inline-flex items-center justify-center cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
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

/* EXPENSES VIEW */
export const ExpensesView: React.FC<{
  state: AssetOSState;
  onOpenModal: (modal: ModalType) => void;
  onDeleteExpense: (e: ExpenseRecord) => void;
  onRefreshMasters?: () => Promise<void>;
  onNotify?: (msg: string, type?: ToastMessage['type']) => void;
}> = ({ state, onOpenModal, onDeleteExpense, onRefreshMasters, onNotify }) => {
  const [subTab, setSubTab] = useState<'ledger' | 'categories' | 'modes'>('ledger');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Master form state
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [editingMasterId, setEditingMasterId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingDesc, setEditingDesc] = useState('');
  const [masterSaving, setMasterSaving] = useState(false);

  const currency = state.settings.currency || '₹';
  const palette = THEME_PALETTES[state.settings.theme];
  const categories: ExpenseCategoryRecord[] = state.expenseCategories || [];
  const paymentModes: PaymentModeRecord[] = state.paymentModes || [];

  const filtered = state.expenses.filter((e) => {
    const q = search.toLowerCase();
    return (
      !q ||
      e.id.toLowerCase().includes(q) ||
      e.category.toLowerCase().includes(q) ||
      e.paidTo.toLowerCase().includes(q) ||
      e.mode.toLowerCase().includes(q)
    );
  });
  const paged = paginateItems(filtered, page, pageSize);
  const totalAmount = filtered.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);

  const handleAddMaster = async (kind: 'categories' | 'modes', e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || masterSaving) return;
    setMasterSaving(true);
    try {
      if (kind === 'categories') {
        await apiClient.createExpenseCategory({
          name: newName.trim(),
          description: newDesc.trim() || undefined,
        });
        onNotify?.(`Added Expense Category "${newName.trim()}"`);
      } else {
        await apiClient.createPaymentMode({
          name: newName.trim(),
          description: newDesc.trim() || undefined,
        });
        onNotify?.(`Added Payment Mode "${newName.trim()}"`);
      }
      setNewName('');
      setNewDesc('');
      await onRefreshMasters?.();
    } catch (err) {
      onNotify?.(
        err instanceof ApiError ? err.message : 'Failed to save master record',
        'error'
      );
    } finally {
      setMasterSaving(false);
    }
  };

  const handleSaveMasterEdit = async (kind: 'categories' | 'modes', id: string) => {
    if (!editingName.trim() || masterSaving) return;
    setMasterSaving(true);
    try {
      if (kind === 'categories') {
        await apiClient.updateExpenseCategory(id, {
          name: editingName.trim(),
          description: editingDesc.trim(),
        });
        onNotify?.('Updated Expense Category');
      } else {
        await apiClient.updatePaymentMode(id, {
          name: editingName.trim(),
          description: editingDesc.trim(),
        });
        onNotify?.('Updated Payment Mode');
      }
      setEditingMasterId(null);
      await onRefreshMasters?.();
    } catch (err) {
      onNotify?.(
        err instanceof ApiError ? err.message : 'Failed to update master record',
        'error'
      );
    } finally {
      setMasterSaving(false);
    }
  };

  const handleToggleMaster = async (
    kind: 'categories' | 'modes',
    item: ExpenseCategoryRecord | PaymentModeRecord
  ) => {
    try {
      if (kind === 'categories') {
        await apiClient.toggleExpenseCategory(item.id, !item.active);
      } else {
        await apiClient.togglePaymentMode(item.id, !item.active);
      }
      onNotify?.(
        `${item.name} ${item.active ? 'deactivated' : 'activated'}`
      );
      await onRefreshMasters?.();
    } catch (err) {
      onNotify?.(err instanceof ApiError ? err.message : 'Failed to update status', 'error');
    }
  };

  const handleDeleteMaster = async (
    kind: 'categories' | 'modes',
    item: ExpenseCategoryRecord | PaymentModeRecord
  ) => {
    try {
      if (kind === 'categories') {
        await apiClient.deleteExpenseCategory(item.id);
      } else {
        await apiClient.deletePaymentMode(item.id);
      }
      onNotify?.(`Deleted "${item.name}"`, 'info');
      await onRefreshMasters?.();
    } catch (err) {
      onNotify?.(err instanceof ApiError ? err.message : 'Failed to delete record', 'error');
    }
  };

  const renderMasterSection = (
    kind: 'categories' | 'modes',
    title: string,
    items: Array<ExpenseCategoryRecord | PaymentModeRecord>
  ) => (
    <div className="space-y-4">
      <form
        onSubmit={(e) => void handleAddMaster(kind, e)}
        className={`bg-white dark:bg-slate-900 rounded-xl border ${palette.border} dark:border-slate-800 p-4 flex flex-col sm:flex-row items-stretch sm:items-end gap-3 shadow-sm`}
      >
        <div className="flex-1">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            {title} Name *
          </label>
          <input
            type="text"
            required
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={
              kind === 'categories' ? 'e.g. Cloud Hosting' : 'e.g. Corporate Debit Card'
            }
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 rounded-lg text-xs"
          />
        </div>
        <div className="flex-1">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Description
          </label>
          <input
            type="text"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Optional description..."
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 rounded-lg text-xs"
          />
        </div>
        <button
          type="submit"
          disabled={masterSaving || !newName.trim()}
          className={`${palette.primaryBtn} ${palette.primaryBtnHover} px-4 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap`}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add {kind === 'categories' ? 'Category' : 'Mode'}</span>
        </button>
      </form>

      <div className={`bg-white dark:bg-slate-900 rounded-xl shadow-sm border ${palette.border} dark:border-slate-800 overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className={`${palette.surfaceBg} dark:bg-slate-800 border-b ${palette.border} dark:border-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider`}>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                    No {title.toLowerCase()} records configured.
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const isEditing = editingMasterId === item.id;
                  return (
                    <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                      <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            className="w-full px-2 py-1 border border-slate-300 rounded text-xs"
                          />
                        ) : (
                          item.name
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editingDesc}
                            onChange={(e) => setEditingDesc(e.target.value)}
                            className="w-full px-2 py-1 border border-slate-300 rounded text-xs"
                          />
                        ) : (
                          item.description || '—'
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                            item.active
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : 'bg-slate-100 text-slate-500 border-slate-200'
                          }`}
                        >
                          {item.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right space-x-1 whitespace-nowrap">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              aria-label={`Save ${item.name}`}
                              onClick={() => void handleSaveMasterEdit(kind, item.id)}
                              className="w-7 h-7 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 inline-flex items-center justify-center cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label="Cancel edit"
                              onClick={() => setEditingMasterId(null)}
                              className="w-7 h-7 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 inline-flex items-center justify-center cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              aria-label={item.active ? `Deactivate ${item.name}` : `Activate ${item.name}`}
                              title={item.active ? 'Deactivate' : 'Activate'}
                              onClick={() => void handleToggleMaster(kind, item)}
                              className={`px-2 py-1 rounded text-[10px] font-bold border cursor-pointer inline-flex items-center gap-1 ${
                                item.active
                                  ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                                  : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                              }`}
                            >
                              <Power className="w-3 h-3" />
                              <span>{item.active ? 'Deactivate' : 'Activate'}</span>
                            </button>
                            <button
                              type="button"
                              aria-label={`Edit ${item.name}`}
                              onClick={() => {
                                setEditingMasterId(item.id);
                                setEditingName(item.name);
                                setEditingDesc(item.description || '');
                              }}
                              className="w-7 h-7 rounded bg-orange-50 text-orange-700 hover:bg-orange-100 inline-flex items-center justify-center cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete ${item.name}`}
                              onClick={() => void handleDeleteMaster(kind, item)}
                              className="w-7 h-7 rounded bg-rose-50 text-rose-700 hover:bg-rose-100 inline-flex items-center justify-center cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4 pb-10">
      <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">Expense</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Manual Expense Number tracking, Expense Category Master &amp; Payment Mode Master
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 no-print">
          <div className="flex items-center gap-1 p-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
            <button
              type="button"
              onClick={() => {
                setSubTab('ledger');
                setEditingMasterId(null);
              }}
              className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                subTab === 'ledger'
                  ? palette.primaryBtn
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              Expense Ledger
            </button>
            <button
              type="button"
              onClick={() => {
                setSubTab('categories');
                setNewName('');
                setNewDesc('');
                setEditingMasterId(null);
              }}
              className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                subTab === 'categories'
                  ? palette.primaryBtn
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              <Tag className="w-3.5 h-3.5" />
              <span>Category Master</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSubTab('modes');
                setNewName('');
                setNewDesc('');
                setEditingMasterId(null);
              }}
              className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                subTab === 'modes'
                  ? palette.primaryBtn
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>Payment Mode Master</span>
            </button>
          </div>

          {subTab === 'ledger' && (
            <>
              <button
                type="button"
                onClick={() => onOpenModal({ type: 'expense' })}
                data-testid="add-expense-btn"
                className={`${palette.primaryBtn} ${palette.primaryBtnHover} px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer`}
              >
                <Plus className="w-3.5 h-3.5" /> New
              </button>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
                  <Search className="w-3.5 h-3.5" />
                </span>
                <input
                  type="text"
                  aria-label="Search expenses"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search..."
                  className={`w-48 pl-8 pr-3 py-1.5 bg-white dark:bg-slate-800 border ${palette.border} dark:border-slate-700 rounded-lg text-xs dark:text-slate-100 focus:ring-2 focus:ring-blue-600 focus:outline-none`}
                />
              </div>
              <div className="flex space-x-1 border-l border-slate-200 dark:border-slate-700 pl-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" /> Print
                </button>
                <button
                  type="button"
                  onClick={() =>
                    triggerDownloadCsv(
                      'expenses.csv',
                      ['Expense No.', 'Date', 'Category', 'Paid To', 'Amount', 'Mode', 'Remarks'],
                      filtered.map((e) => [
                        e.id,
                        e.date,
                        e.category,
                        e.paidTo,
                        e.amount,
                        e.mode,
                        e.remarks,
                      ])
                    )
                  }
                  className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" /> Export CSV
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {subTab === 'categories' ? (
        renderMasterSection('categories', 'Expense Category', categories)
      ) : subTab === 'modes' ? (
        renderMasterSection('modes', 'Payment Mode', paymentModes)
      ) : (
        <div className={`bg-white dark:bg-slate-900 rounded-xl shadow-sm border ${palette.border} dark:border-slate-800 overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className={`${palette.surfaceBg} dark:bg-slate-800 border-b ${palette.border} dark:border-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider`}>
                  <th className="px-4 py-3">Expense No.</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Paid To</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Mode</th>
                  <th className="px-4 py-3 text-right no-print">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {paged.items.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-slate-700 dark:text-slate-200">{e.id}</td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400 tabular-nums">{e.date}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{e.category}</td>
                    <td className="px-4 py-3 text-slate-800 dark:text-slate-100 font-medium">{e.paidTo}</td>
                    <td className="px-4 py-3 font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                      {formatCurrency(e.amount, currency)}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{e.mode}</td>
                    <td className="px-4 py-3 text-right space-x-1 no-print">
                      <button
                        type="button"
                        aria-label={`Edit expense ${e.id}`}
                        onClick={() => onOpenModal({ type: 'expense', expenseId: e.id })}
                        className="w-7 h-7 rounded bg-orange-50 text-orange-700 hover:bg-orange-100 inline-flex items-center justify-center cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete expense ${e.id}`}
                        onClick={() => onDeleteExpense(e)}
                        className="w-7 h-7 rounded bg-rose-50 text-rose-700 hover:bg-rose-100 inline-flex items-center justify-center cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
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
            extraSummary={`Amount: ${formatCurrency(totalAmount, currency)}`}
          />
        </div>
      )}
    </div>
  );
};
