import React, { useEffect, useRef, useState } from 'react';
import {
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  History,
  Layers,
  Pencil,
  Plus,
  Printer,
  Search,
  Square,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  Asset,
  AssetStatus,
  Assignment,
  Employee,
  ModalType,
  PersonnelEntity,
  ThemePalette,
} from '../types/asset';
import {
  THEME_PALETTES,
  filterAssets,
  formatCurrency,
  paginateItems,
} from '../utils/assetMath';
import { buildAssetTemplateCsv, buildInventoryCsvExport } from '../utils/assetExport';
import { resolveCustodySummaryForAsset } from '../utils/entityValidation';
import { AssetThumbnail } from './AssetThumbnail';

interface InventoryViewProps {
  assets: Asset[];
  assignments?: Assignment[];
  employees?: Employee[];
  entities?: PersonnelEntity[];
  currency: string;
  theme: ThemePalette;
  initialStatusFilter: AssetStatus | 'ALL';
  initialSearchQuery?: string;
  selectionResetToken?: number;
  canWrite?: boolean;
  onOpenModal: (modal: ModalType) => void;
  onDeleteAsset: (asset: Asset) => void;
  onImportCSV: (csvText: string) => void;
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  assets,
  assignments = [],
  employees = [],
  entities = [],
  currency,
  theme,
  initialStatusFilter,
  initialSearchQuery = '',
  selectionResetToken = 0,
  canWrite = true,
  onOpenModal,
  onDeleteAsset,
  onImportCSV,
}) => {
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [statusFilter, setStatusFilter] = useState<AssetStatus | 'ALL'>(initialStatusFilter);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [selectionResetToken]);

  const palette = THEME_PALETTES[theme];
  const filtered = filterAssets(assets, searchQuery, statusFilter);
  const paged = paginateItems(filtered, page, pageSize);
  const totalValue = filtered.reduce((acc, a) => acc + (Number(a.cost) || 0), 0);

  const assetIdSet = new Set(assets.map((a) => a.id));
  const activeSelectedIds = Array.from(selectedIds).filter((id) => assetIdSet.has(id));
  const allPageSelected =
    paged.items.length > 0 && paged.items.every((item) => selectedIds.has(item.id));

  const toggleSelectOne = (assetId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  };

  const toggleSelectPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        paged.items.forEach((a) => next.delete(a.id));
      } else {
        paged.items.forEach((a) => next.add(a.id));
      }
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedIds(new Set(filtered.map((a) => a.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const handleExportCSV = () => {
    const csv = buildInventoryCsvExport({
      assets: filtered,
      assignments,
      employees,
      entities,
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'median-inventory.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadTemplateCSV = () => {
    const csv = buildAssetTemplateCsv();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'asset-entry-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onImportCSV(reader.result);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-4 pb-10">
      <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">Asset Entry</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Manage your asset inventory</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 no-print">
          {canWrite && (
            <>
              <button
                type="button"
                onClick={() => onOpenModal({ type: 'asset' })}
                className={`${palette.primaryBtn} ${palette.primaryBtnHover} px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer whitespace-nowrap`}
              >
                <Plus className="w-3.5 h-3.5" /> New
              </button>

              <button
                type="button"
                onClick={handleDownloadTemplateCSV}
                className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-slate-800 dark:text-emerald-300 dark:border-slate-700 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" /> Template CSV
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" /> Import CSV
              </button>
            </>
          )}

          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
              <Search className="w-3.5 h-3.5" />
            </span>
            <input
              type="text"
              aria-label="Search assets"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search assets..."
              className="w-48 pl-8 pr-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs dark:text-slate-100 focus:ring-2 focus:ring-blue-600 focus:outline-none"
            />
          </div>

          <select
            aria-label="Filter assets by status"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as AssetStatus | 'ALL');
              setPage(1);
            }}
            className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-100 focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Statuses</option>
            <option value="Available">Available</option>
            <option value="Assigned">Assigned</option>
            <option value="Under Maintenance">Under Maintenance</option>
            <option value="Disposed">Disposed</option>
          </select>

          <div className="flex items-center space-x-1 border-l border-slate-200 dark:border-slate-700 pl-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-200 hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
            <button
              type="button"
              onClick={handleExportCSV}
              className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-200 hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* Batch Selection & Action Bar */}
      {canWrite && filtered.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-2.5 shadow-sm flex flex-wrap items-center justify-between gap-3 no-print">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={toggleSelectPage}
              className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer"
            >
              {allPageSelected ? (
                <CheckSquare className="w-3.5 h-3.5 text-emerald-700" />
              ) : (
                <Square className="w-3.5 h-3.5 text-slate-500" />
              )}
              <span>{allPageSelected ? 'Deselect Page' : 'Select Page'}</span>
            </button>
            <button
              type="button"
              onClick={selectAllFiltered}
              className="px-2.5 py-1 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 dark:bg-slate-800 dark:border-slate-700 dark:text-blue-400 font-semibold text-blue-700 cursor-pointer"
            >
              Select All Filtered ({filtered.length})
            </button>
            {activeSelectedIds.length > 0 && (
              <span className="font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg tabular-nums">
                {activeSelectedIds.length} asset(s) selected
              </span>
            )}
          </div>

          {activeSelectedIds.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="batch-update-btn"
                onClick={() =>
                  onOpenModal({ type: 'batch-asset-update', assetIds: activeSelectedIds })
                }
                className={`${palette.primaryBtn} ${palette.primaryBtnHover} px-3.5 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Batch Update ({activeSelectedIds.length})</span>
              </button>
              <button
                type="button"
                onClick={clearSelection}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-600 flex items-center gap-1 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" /> Clear
              </button>
            </div>
          )}
        </div>
      )}

      {paged.items.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-12 text-center">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">No assets match your current filter.</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Try clearing your search or register a new asset.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setStatusFilter('ALL');
              setPage(1);
            }}
            className="mt-4 px-4 py-2 bg-blue-50 text-blue-700 border border-blue-200 dark:bg-slate-800 dark:text-blue-400 dark:border-slate-700 rounded-lg text-xs font-bold cursor-pointer"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div
          data-testid="inventory-grid"
          className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4"
        >
          {paged.items.map((ast) => {
            const badgeClass =
              ast.status === 'Available'
                ? 'bg-[#dcfce7] text-[#166534] border-[#bbf7d0]'
                : ast.status === 'Assigned'
                ? 'bg-[#dbeafe] text-[#1e40af] border-[#bfdbfe]'
                : ast.status === 'Under Maintenance'
                ? 'bg-[#ffedd5] text-[#c2410c] border-[#fed7aa]'
                : 'bg-[#fce7f3] text-[#be185d] border-[#fbcfe8]';

            const condColor =
              ast.condition === 'New'
                ? 'text-blue-700'
                : ast.condition === 'Good'
                ? 'text-emerald-700'
                : ast.condition === 'Fair'
                ? 'text-amber-700'
                : 'text-rose-700';

            const isSelected = selectedIds.has(ast.id);
            const custody = resolveCustodySummaryForAsset({
              assetId: ast.id,
              assignments,
              employees,
              entities,
            });

            return (
              <div
                key={ast.id}
                data-testid={`asset-card-${ast.id}`}
                className={`bg-white dark:bg-slate-900 rounded-xl border shadow-sm hover:shadow-md transition-all flex flex-col overflow-hidden ${
                  isSelected
                    ? 'border-emerald-600 ring-2 ring-emerald-500/70'
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="h-28 bg-slate-100 w-full relative overflow-hidden">
                  <AssetThumbnail category={ast.category} name={ast.name} image={ast.image} />
                  {canWrite && (
                    <label
                      className="absolute top-2 left-2 z-20 flex items-center justify-center w-6 h-6 rounded bg-white/95 border border-slate-300 shadow-sm cursor-pointer hover:border-emerald-600 no-print"
                      title={`Select ${ast.name}`}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Select ${ast.name}`}
                        checked={isSelected}
                        onChange={() => toggleSelectOne(ast.id)}
                        className="w-3.5 h-3.5 rounded border-slate-400 text-emerald-700 focus:ring-emerald-600 cursor-pointer"
                      />
                    </label>
                  )}
                  <span
                    className={`absolute top-2 right-2 px-2 py-0.5 rounded-full text-[9px] font-bold border ${badgeClass} shadow-sm z-20`}
                  >
                    {ast.status}
                  </span>
                </div>

                <div className="p-3 flex-1 flex flex-col">
                  <h4 className="font-bold text-xs text-slate-900 line-clamp-2" title={ast.name}>
                    {ast.name}
                  </h4>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">
                    {ast.id} · S/N: {ast.serial}
                  </p>
                  {custody.primaryHolderName && (
                    <p className="text-[10px] font-semibold text-sky-800 bg-sky-50 border border-sky-200 rounded px-1.5 py-0.5 mt-1 truncate">
                      Custody: {custody.primaryHolderName}
                      {custody.subHolderName ? ` → ${custody.subHolderName}` : ''}
                    </p>
                  )}

                  <div className="mt-2.5 grid grid-cols-2 gap-x-2 gap-y-1.5 text-[10px] text-slate-600">
                    <div>
                      <span className="text-slate-400 block">Category</span>
                      <span className="font-semibold text-slate-800">{ast.category}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Brand</span>
                      <span className="font-semibold text-slate-800">{ast.brand || '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Dept</span>
                      <span className="font-semibold text-slate-800">{ast.department}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Cost</span>
                      <span className="font-bold text-slate-800 tabular-nums">
                        {formatCurrency(ast.cost, currency)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Book Value</span>
                      <span className="font-bold text-[#166534] tabular-nums">
                        {formatCurrency(ast.currentValue ?? ast.cost, currency)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Condition</span>
                      <span className={`font-bold ${condColor}`}>{ast.condition}</span>
                    </div>
                  </div>

                  <div className="mt-auto pt-3 flex items-center justify-between border-t border-slate-100 no-print">
                    <div className="flex space-x-1">
                      <button
                        type="button"
                        aria-label={`History for ${ast.name}`}
                        onClick={() => onOpenModal({ type: 'history', assetId: ast.id })}
                        title="Asset History"
                        className="w-7 h-7 rounded bg-[#e0f2fe] text-[#0369a1] hover:bg-[#bae6fd] flex items-center justify-center transition-colors cursor-pointer"
                      >
                        <History className="w-3.5 h-3.5" />
                      </button>
                      {canWrite && (
                        <button
                          type="button"
                          aria-label={`Assign ${ast.name}`}
                          disabled={ast.status === 'Disposed'}
                          onClick={() => onOpenModal({ type: 'assign', preselectedAssetId: ast.id })}
                          title="Assign"
                          className="w-7 h-7 rounded bg-[#dcfce7] text-[#166534] hover:bg-[#bbf7d0] disabled:opacity-40 flex items-center justify-center transition-colors cursor-pointer"
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {canWrite && (
                      <div className="flex space-x-1">
                        <button
                          type="button"
                          aria-label={`Edit ${ast.name}`}
                          onClick={() => onOpenModal({ type: 'asset', assetId: ast.id })}
                          title="Edit"
                          className="w-7 h-7 rounded bg-[#ffedd5] text-[#c2410c] hover:bg-[#fed7aa] flex items-center justify-center transition-colors cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${ast.name}`}
                          onClick={() => onDeleteAsset(ast)}
                          title="Delete"
                          className="w-7 h-7 rounded bg-[#fce7f3] text-[#be185d] hover:bg-[#fbcfe8] flex items-center justify-center transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400 mt-4 bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm no-print">
        <div className="tabular-nums">
          Total: <span className="font-bold text-slate-800 dark:text-white">{filtered.length}</span> assets · Value:{' '}
          <span className="font-bold text-[#166534] dark:text-emerald-400">{formatCurrency(totalValue, currency)}</span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="tabular-nums">
            Showing {paged.startIndex}-{paged.endIndex} of {filtered.length} entries
          </span>

          <div className="flex items-center space-x-1">
            <span>Rows per page:</span>
            <select
              aria-label="Rows per page"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="border border-slate-200 rounded px-1.5 py-0.5 focus:outline-none"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </div>

          <div className="flex space-x-1">
            <button
              type="button"
              aria-label="Previous page"
              disabled={paged.safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-2 py-1 border rounded bg-slate-50 text-slate-600 disabled:opacity-40 cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            {Array.from({ length: paged.totalPages }, (_, i) => i + 1).map((pNum) => (
              <button
                key={pNum}
                type="button"
                onClick={() => setPage(pNum)}
                className={`px-2.5 py-1 border rounded text-xs font-semibold cursor-pointer ${
                  pNum === paged.safePage
                    ? `${palette.primaryBtn} border-transparent`
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {pNum}
              </button>
            ))}
            <button
              type="button"
              aria-label="Next page"
              disabled={paged.safePage >= paged.totalPages}
              onClick={() => setPage((p) => Math.min(paged.totalPages, p + 1))}
              className="px-2 py-1 border rounded bg-slate-50 text-slate-600 disabled:opacity-40 cursor-pointer"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
