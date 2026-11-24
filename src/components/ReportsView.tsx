import React, { useState } from 'react';
import { Download, Monitor, Printer, Search } from 'lucide-react';
import type { AssetOSState, ReportTab } from '../types/asset';
import { formatCurrency, toCSV } from '../utils/assetMath';

interface ReportsViewProps {
  state: AssetOSState;
}

const REPORT_TABS: Array<{ id: ReportTab; label: string }> = [
  { id: 'asset', label: 'Asset' },
  { id: 'employee', label: 'Employee' },
  { id: 'depreciation', label: 'Depreciation' },
  { id: 'assignment', label: 'Assignment' },
  { id: 'return', label: 'Return' },
  { id: 'transfer', label: 'Transfer' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'vendor', label: 'Vendor' },
  { id: 'expense', label: 'Expense' },
];

export const ReportsView: React.FC<ReportsViewProps> = ({ state }) => {
  const [activeTab, setActiveTab] = useState<ReportTab>('asset');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState<string>(
    () => state.history[0]?.assetId || state.assets[0]?.id || ''
  );
  const [selectedEmpId, setSelectedEmpId] = useState<string>(() => {
    const match = state.employees.find((e) =>
      state.history.some(
        (h) =>
          h.details.includes(e.name) ||
          h.details.includes(e.id) ||
          h.details.includes(e.employeeId)
      )
    );
    return match?.id || state.employees[0]?.id || '';
  });
  const [depCategory, setDepCategory] = useState('ALL');
  const [depDept, setDepDept] = useState('ALL');
  const [depMethod, setDepMethod] = useState('ALL');
  const [depStatus, setDepStatus] = useState('ALL');

  const currency = state.settings.currency || '$';
  const q = search.trim().toLowerCase();

  const withinDateRange = (dateStr: string) => {
    if (!dateStr) return true;
    if (dateFrom && dateStr < dateFrom) return false;
    if (dateTo && dateStr > dateTo) return false;
    return true;
  };

  // Compute active report headers & rows
  let headers: string[] = [];
  let rows: Array<Array<string | number>> = [];
  let grandTotalText = '—';

  if (activeTab === 'asset') {
    headers = ['Date', 'Activity', 'Details / Remarks'];
    const history = state.history.filter(
      (h) =>
        (!selectedAssetId || h.assetId === selectedAssetId) &&
        withinDateRange(h.date) &&
        (!q ||
          h.activity.toLowerCase().includes(q) ||
          h.details.toLowerCase().includes(q) ||
          h.date.includes(q))
    );
    rows = history.map((h) => [h.date, h.activity, h.details]);
  } else if (activeTab === 'employee') {
    headers = ['Date', 'Asset', 'Activity', 'Details / Remarks'];
    const emp = state.employees.find((e) => e.id === selectedEmpId);
    const empHistory = emp
      ? state.history.filter(
          (h) =>
            (h.details.includes(emp.name) ||
              h.details.includes(emp.id) ||
              h.details.includes(emp.employeeId)) &&
            withinDateRange(h.date) &&
            (!q || h.details.toLowerCase().includes(q) || h.activity.toLowerCase().includes(q))
        )
      : [];
    rows = empHistory.map((h) => {
      const ast = state.assets.find((a) => a.id === h.assetId);
      return [h.date, ast ? `${ast.name} (${ast.id})` : h.assetId, h.activity, h.details];
    });
  } else if (activeTab === 'depreciation') {
    headers = [
      'Asset ID',
      'Asset Name',
      'Purchase Date',
      'Purchase Cost',
      'Method',
      'Useful Life',
      'Accumulated Dep.',
      'Current Book Value',
      'Status',
    ];
    const filtered = state.assets.filter(
      (a) =>
        (depCategory === 'ALL' || a.category === depCategory) &&
        (depDept === 'ALL' || a.department === depDept) &&
        (depMethod === 'ALL' || a.depMethod === depMethod) &&
        (depStatus === 'ALL' || a.status === depStatus) &&
        withinDateRange(a.purchaseDate) &&
        (!q || a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q))
    );
    const totalBook = filtered.reduce((acc, a) => acc + (a.currentValue ?? a.cost), 0);
    grandTotalText = formatCurrency(totalBook, currency);
    rows = filtered.map((a) => [
      a.id,
      a.name,
      a.purchaseDate,
      formatCurrency(a.cost, currency),
      a.depMethod,
      `${a.usefulLife} Yrs`,
      formatCurrency(Math.max(0, a.cost - (a.currentValue ?? a.cost)), currency),
      formatCurrency(a.currentValue ?? a.cost, currency),
      a.status,
    ]);
  } else if (activeTab === 'assignment') {
    headers = ['No.', 'Date', 'Employee', 'Asset', 'Department', 'Status'];
    const filtered = state.assignments.filter((a) => {
      const emp = state.employees.find((e) => e.id === a.employeeId);
      const ast = state.assets.find((x) => x.id === a.assetId);
      return (
        withinDateRange(a.assignDate) &&
        (!q ||
          a.id.toLowerCase().includes(q) ||
          (emp?.name || '').toLowerCase().includes(q) ||
          (ast?.name || '').toLowerCase().includes(q))
      );
    });
    rows = filtered.map((a) => {
      const emp = state.employees.find((e) => e.id === a.employeeId);
      const ast = state.assets.find((x) => x.id === a.assetId);
      return [a.id, a.assignDate, emp?.name || 'Unknown', ast?.name || a.assetId, emp?.department || '—', a.status];
    });
  } else if (activeTab === 'return') {
    headers = ['No.', 'Date', 'Employee', 'Asset', 'Condition', 'Damage'];
    const filtered = state.returns.filter((r) => {
      const emp = state.employees.find((e) => e.id === r.employeeId);
      const ast = state.assets.find((x) => x.id === r.assetId);
      return (
        withinDateRange(r.date) &&
        (!q ||
          r.id.toLowerCase().includes(q) ||
          (emp?.name || '').toLowerCase().includes(q) ||
          (ast?.name || '').toLowerCase().includes(q))
      );
    });
    rows = filtered.map((r) => {
      const emp = state.employees.find((e) => e.id === r.employeeId);
      const ast = state.assets.find((x) => x.id === r.assetId);
      return [r.id, r.date, emp?.name || 'Unknown', ast?.name || r.assetId, r.condition, r.damage];
    });
  } else if (activeTab === 'transfer') {
    headers = ['No.', 'Date', 'Asset', 'From Dept', 'To Dept', 'From Employee', 'To Employee'];
    const filtered = state.transfers.filter((t) => {
      const ast = state.assets.find((x) => x.id === t.assetId);
      return (
        withinDateRange(t.date) &&
        (!q ||
          t.id.toLowerCase().includes(q) ||
          (ast?.name || '').toLowerCase().includes(q) ||
          t.fromEmp.toLowerCase().includes(q) ||
          t.toEmp.toLowerCase().includes(q))
      );
    });
    rows = filtered.map((t) => {
      const ast = state.assets.find((x) => x.id === t.assetId);
      return [t.id, t.date, ast?.name || t.assetId, t.fromDept, t.toDept, t.fromEmp, t.toEmp];
    });
  } else if (activeTab === 'maintenance') {
    headers = ['No.', 'Date', 'Asset', 'Type', 'Vendor', 'Cost', 'Status'];
    const filtered = state.maintenance.filter((m) => {
      const ast = state.assets.find((x) => x.id === m.assetId);
      return (
        withinDateRange(m.serviceDate) &&
        (!q ||
          m.id.toLowerCase().includes(q) ||
          (ast?.name || '').toLowerCase().includes(q) ||
          m.vendor.toLowerCase().includes(q))
      );
    });
    const sum = filtered.reduce((acc, m) => acc + (Number(m.cost) || 0), 0);
    grandTotalText = formatCurrency(sum, currency);
    rows = filtered.map((m) => {
      const ast = state.assets.find((x) => x.id === m.assetId);
      return [m.id, m.serviceDate, ast?.name || m.assetId, m.type, m.vendor, formatCurrency(m.cost, currency), m.status];
    });
  } else if (activeTab === 'vendor') {
    headers = ['Code', 'Name', 'Contact Person', 'Mobile', 'Email', 'GST'];
    const filtered = state.vendors.filter(
      (v) =>
        !q ||
        v.id.toLowerCase().includes(q) ||
        v.name.toLowerCase().includes(q) ||
        v.contactPerson.toLowerCase().includes(q)
    );
    rows = filtered.map((v) => [v.id, v.name, v.contactPerson || '—', v.phone, v.email || '—', v.gst || '—']);
  } else if (activeTab === 'expense') {
    headers = ['No.', 'Date', 'Category', 'Paid To', 'Mode', 'Amount'];
    const filtered = state.expenses.filter(
      (e) =>
        withinDateRange(e.date) &&
        (!q ||
          e.id.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q) ||
          e.paidTo.toLowerCase().includes(q))
    );
    const sum = filtered.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
    grandTotalText = formatCurrency(sum, currency);
    rows = filtered.map((e) => [e.id, e.date, e.category, e.paidTo, e.mode, formatCurrency(e.amount, currency)]);
  }

  const handleExport = () => {
    const csv = toCSV(headers, rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `report-${activeTab}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 pb-10">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Reports</h1>
          <p className="text-xs text-slate-500 mt-1">Generate and export reports</p>
        </div>
        <div className="flex space-x-2 no-print">
          <button
            type="button"
            onClick={() => window.print()}
            className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" /> Print
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* Tabs */}
        <div
          role="tablist"
          aria-label="Report types"
          className="flex border-b border-slate-200 dark:border-slate-800 overflow-x-auto bg-slate-50 dark:bg-slate-800/60 no-print"
        >
          {REPORT_TABS.map((t) => {
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(t.id)}
                className={`px-4 py-2.5 text-xs whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                  isActive
                    ? 'font-bold border-[#3f3f46] text-[#3f3f46] bg-white'
                    : 'font-medium border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Filter Bar */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap gap-2 items-center bg-white dark:bg-slate-900 no-print">
          <input
            type="date"
            aria-label="From date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs dark:text-slate-100 focus:outline-none"
          />
          <input
            type="date"
            aria-label="To date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs dark:text-slate-100 focus:outline-none"
          />

          {activeTab === 'asset' && (
            <select
              aria-label="Select asset for report"
              value={selectedAssetId}
              onChange={(e) => setSelectedAssetId(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs dark:text-slate-100 focus:outline-none"
            >
              <option value="">All Assets</option>
              {state.assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id} — {a.name}
                </option>
              ))}
            </select>
          )}

          {activeTab === 'employee' && (
            <select
              aria-label="Select employee for report"
              value={selectedEmpId}
              onChange={(e) => setSelectedEmpId(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs dark:text-slate-100 focus:outline-none"
            >
              <option value="">Select Employee</option>
              {state.employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.employeeId} — {e.name}
                </option>
              ))}
            </select>
          )}

          {activeTab === 'depreciation' && (
            <>
              <select
                aria-label="Filter category"
                value={depCategory}
                onChange={(e) => setDepCategory(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs dark:text-slate-100 focus:outline-none"
              >
                <option value="ALL">All Categories</option>
                {state.categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter department"
                value={depDept}
                onChange={(e) => setDepDept(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs dark:text-slate-100 focus:outline-none"
              >
                <option value="ALL">All Departments</option>
                {state.departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter depreciation method"
                value={depMethod}
                onChange={(e) => setDepMethod(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs dark:text-slate-100 focus:outline-none"
              >
                <option value="ALL">All Methods</option>
                <option value="SLM">SLM</option>
                <option value="WDV">WDV</option>
              </select>
              <select
                aria-label="Filter asset status"
                value={depStatus}
                onChange={(e) => setDepStatus(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs dark:text-slate-100 focus:outline-none"
              >
                <option value="ALL">All Statuses</option>
                <option value="Available">Available</option>
                <option value="Assigned">Assigned</option>
                <option value="Under Maintenance">Under Maintenance</option>
                <option value="Disposed">Disposed</option>
              </select>
            </>
          )}

          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
              <Search className="w-3.5 h-3.5" />
            </span>
            <input
              type="text"
              aria-label="Search report"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search report..."
              className="w-48 pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs dark:text-slate-100 focus:outline-none"
            />
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto max-h-[540px]">
          {rows.length === 0 ? (
            <div className="p-12 flex flex-col items-center justify-center text-slate-400">
              <Monitor className="w-10 h-10 mb-3 text-slate-300" />
              <p className="text-sm text-slate-500">No matching report records found.</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0">
                <tr className="bg-slate-800 text-white text-[10px] font-bold uppercase tracking-wider">
                  {headers.map((h) => (
                    <th key={h} className="px-4 py-2.5 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-xs bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="px-4 py-2.5 text-slate-700 dark:text-slate-200 tabular-nums">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center text-xs text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 tabular-nums">
          <div>
            Total records: <span className="font-bold text-slate-800 dark:text-white">{rows.length}</span> · Grand
            Total: <span className="font-bold text-[#166534] dark:text-emerald-400">{grandTotalText}</span>
          </div>
          <div>Showing {rows.length === 0 ? 0 : 1}-{rows.length} entries</div>
        </div>
      </div>
    </div>
  );
};
