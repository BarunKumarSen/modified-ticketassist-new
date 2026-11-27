import React, { useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  Box,
  Calculator,
  ChevronDown,
  ChevronUp,
  FileText,
  FolderOpen,
  Handshake,
  Layers,
  Plus,
  RotateCcw,
  Save,
  Search,
  ShoppingCart,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import type {
  Asset,
  AssetCondition,
  AssetOSState,
  AssetStatus,
  AssigneeEntityType,
  DepreciationMethod,
  MaintenanceRecord,
  PersonnelEntity,
} from '../types/asset';
import type { EmployeeCenterRecord } from '../types/policy';
import {
  THEME_PALETTES,
  calculateBookValue,
  calculateWarrantyExpiry,
  formatCurrency,
} from '../utils/assetMath';
import { EXTENDED_ASSET_FIELDS, resolveAssetAssigneeColumns } from '../utils/assetExport';
import { PERSONNEL_ENTITY_TYPES } from '../utils/entityValidation';
import { AssetThumbnail } from './AssetThumbnail';
import {
  FreelancerAllotmentModal,
  type FreelancerAllotmentDraft,
} from './FreelancerAllotmentModal';

interface ModalShellProps {
  title: string;
  icon: React.ReactNode;
  headerClass: string;
  maxWidth?: string;
  onClose: () => void;
  children: React.ReactNode;
}

export const ModalShell: React.FC<ModalShellProps> = ({
  title,
  icon,
  headerClass,
  maxWidth = 'max-w-3xl',
  onClose,
  children,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4 overflow-y-auto"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`bg-white rounded-xl shadow-2xl ${maxWidth} w-full overflow-hidden my-4 border border-slate-200 flex flex-col max-h-[90vh]`}
      >
        <div className={`px-6 py-4 ${headerClass} text-white flex items-center justify-between shrink-0`}>
          <h3 className="text-sm font-bold flex items-center space-x-2">
            {icon}
            <span>{title}</span>
          </h3>
          <button
            type="button"
            aria-label="Close modal"
            onClick={onClose}
            className="text-white/70 hover:text-white transition-colors bg-white/10 hover:bg-white/20 rounded-full w-7 h-7 flex items-center justify-center cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

/* 1. ASSET CREATE / EDIT MODAL */
export const AssetFormModal: React.FC<{
  state: AssetOSState;
  editingAsset?: Asset;
  onClose: () => void;
  onSave: (asset: Omit<Asset, 'id'> & { id?: string }) => void;
  onAddQuickOption: (kind: 'category' | 'department' | 'location', value: string) => void;
}> = ({ state, editingAsset, onClose, onSave, onAddQuickOption }) => {
  const palette = THEME_PALETTES[state.settings.theme];
  const currency = state.settings.currency || '$';
  const today = new Date().toISOString().split('T')[0];

  const [customAssetId, setCustomAssetId] = useState(editingAsset?.id || '');
  const [name, setName] = useState(editingAsset?.name || '');
  const [category, setCategory] = useState(editingAsset?.category || '');
  const [subcategory, setSubcategory] = useState(editingAsset?.subcategory || '');
  const [brand, setBrand] = useState(editingAsset?.brand || '');
  const [model, setModel] = useState(editingAsset?.model || '');
  const [serial, setSerial] = useState(editingAsset?.serial || '');
  const [purchaseDate, setPurchaseDate] = useState(editingAsset?.purchaseDate || today);
  const [cost, setCost] = useState(editingAsset ? String(editingAsset.cost) : '');
  const [vendor, setVendor] = useState(editingAsset?.vendor || '');
  const [invoiceNumber, setInvoiceNumber] = useState(editingAsset?.invoiceNumber || '');
  const [warrantyMonths, setWarrantyMonths] = useState(
    editingAsset ? String(editingAsset.warrantyMonths) : '36'
  );
  const [department, setDepartment] = useState(
    editingAsset?.department || state.departments[0] || ''
  );
  const [location, setLocation] = useState(
    editingAsset?.location || state.locations[0] || 'Floor 1'
  );
  const [condition, setCondition] = useState<AssetCondition>(editingAsset?.condition || 'Good');
  const [status, setStatus] = useState<AssetStatus>(editingAsset?.status || 'Available');
  const [description, setDescription] = useState(editingAsset?.description || '');
  const [image, setImage] = useState(editingAsset?.image || '');
  const [showDep, setShowDep] = useState(Boolean(editingAsset));
  const [depMethod, setDepMethod] = useState<DepreciationMethod>(editingAsset?.depMethod || 'SLM');
  const [usefulLife, setUsefulLife] = useState(
    editingAsset ? String(editingAsset.usefulLife) : '5'
  );
  const [salvageValue, setSalvageValue] = useState(
    editingAsset ? String(editingAsset.salvageValue) : '0'
  );

  const initialPersonColumns = editingAsset
    ? resolveAssetAssigneeColumns({
        asset: editingAsset,
        assignments: state.assignments,
        employees: state.employees,
        entities: state.entities || [],
      })
    : null;

  const [employeeName, setEmployeeName] = useState(
    editingAsset?.employeeName || initialPersonColumns?.employeeName || ''
  );
  const [consultantName, setConsultantName] = useState(
    editingAsset?.consultantName || initialPersonColumns?.consultantName || ''
  );
  const [retainerName, setRetainerName] = useState(
    editingAsset?.retainerName || initialPersonColumns?.retainerName || ''
  );
  const [freelancerName, setFreelancerName] = useState(
    editingAsset?.freelancerName || initialPersonColumns?.freelancerName || ''
  );
  const [yrpName, setYrpName] = useState(
    editingAsset?.yrpName || initialPersonColumns?.yrpName || ''
  );
  const [internName, setInternName] = useState(
    editingAsset?.internName || initialPersonColumns?.internName || ''
  );

  // Extended non-duplicate fieldwork & hardware attributes
  const [extendedValues, setExtendedValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const spec of EXTENDED_ASSET_FIELDS) {
      const raw = editingAsset?.[spec.key];
      init[String(spec.key)] = raw !== undefined && raw !== null ? String(raw) : '';
    }
    return init;
  });

  const [quickAddKind, setQuickAddKind] = useState<'category' | 'department' | 'location' | null>(null);
  const [quickAddValue, setQuickAddValue] = useState('');

  const entities = state.entities || [];
  const warrantyExpiry = calculateWarrantyExpiry(purchaseDate, parseInt(warrantyMonths, 10) || 0);
  const currentBookValue = calculateBookValue({
    cost: parseFloat(cost) || 0,
    purchaseDate,
    usefulLife: parseInt(usefulLife, 10) || 5,
    salvageValue: parseFloat(salvageValue) || 0,
    method: depMethod,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !category || !serial.trim() || !cost) return;
    const extendedPayload: Record<string, string | undefined> = {};
    for (const spec of EXTENDED_ASSET_FIELDS) {
      const val = (extendedValues[String(spec.key)] || '').trim();
      extendedPayload[String(spec.key)] = val || undefined;
    }
    const cleanEmployeeName = employeeName.trim() || undefined;
    const cleanConsultantName = consultantName.trim() || undefined;
    const cleanRetainerName = retainerName.trim() || undefined;
    const cleanFreelancerName = freelancerName.trim() || undefined;
    const cleanYrpName = yrpName.trim() || undefined;
    const cleanInternName = internName.trim() || undefined;
    const manualId = !editingAsset && customAssetId.trim() ? customAssetId.trim().toUpperCase() : undefined;
    onSave({
      id: editingAsset?.id || manualId,
      name: name.trim(),
      category,
      subcategory,
      brand,
      model,
      serial: serial.trim(),
      purchaseDate,
      cost: parseFloat(cost) || 0,
      vendor,
      invoiceNumber,
      warrantyMonths: parseInt(warrantyMonths, 10) || 0,
      warrantyExpiry,
      department,
      location,
      condition,
      status,
      depMethod,
      usefulLife: parseInt(usefulLife, 10) || 5,
      salvageValue: parseFloat(salvageValue) || 0,
      currentValue: currentBookValue,
      description,
      image: image.trim() || undefined,
      ...extendedPayload,
      eicName: extendedPayload.eicName || cleanEmployeeName,
      assignedFlp: extendedPayload.assignedFlp || cleanFreelancerName,
      employeeName: cleanEmployeeName,
      consultantName: cleanConsultantName,
      retainerName: cleanRetainerName,
      freelancerName: cleanFreelancerName,
      yrpName: cleanYrpName,
      internName: cleanInternName,
    });
  };

  const handleSaveQuickAdd = () => {
    if (!quickAddKind || !quickAddValue.trim()) return;
    const trimmed = quickAddValue.trim();
    onAddQuickOption(quickAddKind, trimmed);
    if (quickAddKind === 'category') setCategory(trimmed);
    if (quickAddKind === 'department') setDepartment(trimmed);
    if (quickAddKind === 'location') setLocation(trimmed);
    setQuickAddValue('');
    setQuickAddKind(null);
  };

  return (
    <ModalShell
      title={editingAsset ? `Edit Asset (${editingAsset.id})` : 'New Asset'}
      icon={<Box className="w-4 h-4 text-emerald-400" />}
      headerClass={palette.modalHeader}
      maxWidth="max-w-4xl"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 bg-white space-y-6">
        {quickAddKind && (
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center gap-2">
            <span className="text-xs font-bold text-slate-800 capitalize">
              Add {quickAddKind}:
            </span>
            <input
              type="text"
              value={quickAddValue}
              onChange={(e) => setQuickAddValue(e.target.value)}
              placeholder={`Enter new ${quickAddKind} name`}
              className="flex-1 px-2.5 py-1 bg-white border border-slate-300 rounded text-xs focus:outline-none"
            />
            <button
              type="button"
              onClick={handleSaveQuickAdd}
              className="px-3 py-1 bg-emerald-600 text-white rounded text-xs font-bold cursor-pointer"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setQuickAddKind(null)}
              className="px-2 py-1 text-slate-500 text-xs cursor-pointer"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Basic Information */}
        <div>
          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3 flex items-center gap-2 border-b pb-2">
            <FileText className="w-3.5 h-3.5 text-slate-400" />
            <span>Basic Information</span>
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="asset-id-input"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Asset ID {editingAsset ? '' : '(Optional / Auto)'}
              </label>
              <input
                id="asset-id-input"
                type="text"
                readOnly={Boolean(editingAsset)}
                value={editingAsset ? editingAsset.id : customAssetId}
                onChange={(e) => setCustomAssetId(e.target.value.toUpperCase())}
                placeholder="(auto generated)"
                className={`w-full px-3 py-2 border rounded-lg text-xs font-mono ${
                  editingAsset
                    ? 'bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed'
                    : 'bg-white border-slate-300 text-slate-800 focus:ring-2 focus:ring-emerald-600 focus:outline-none'
                }`}
              />
            </div>
            <div>
              <label
                htmlFor="asset-name-input"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Asset Name *
              </label>
              <input
                id="asset-name-input"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter asset name"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="asset-category-select"
                className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex justify-between items-center"
              >
                <span>Category *</span>
                <button
                  type="button"
                  aria-label="Add new category"
                  onClick={() => setQuickAddKind('category')}
                  className="text-emerald-700 hover:text-emerald-900 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </label>
              <select
                id="asset-category-select"
                required
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              >
                <option value="">Select Category</option>
                {state.categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Sub Category
              </label>
              <input
                type="text"
                value={subcategory}
                onChange={(e) => setSubcategory(e.target.value)}
                placeholder="e.g. Workstation, Display"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Brand
              </label>
              <input
                type="text"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="e.g. Dell, Apple, HP"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Model
              </label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. T350"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              />
            </div>
            <div className="md:col-span-2">
              <label
                htmlFor="asset-serial-input"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Serial Number *
              </label>
              <input
                id="asset-serial-input"
                type="text"
                required
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
                placeholder="e.g. SN-T350-20"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Purchase Information */}
        <div>
          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3 flex items-center gap-2 border-b pb-2">
            <ShoppingCart className="w-3.5 h-3.5 text-slate-400" />
            <span>Purchase Information</span>
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="asset-pdate-input"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Purchase Date
              </label>
              <input
                id="asset-pdate-input"
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="asset-cost-input"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Cost *
              </label>
              <input
                id="asset-cost-input"
                type="number"
                step="0.01"
                min="0"
                required
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="asset-book-value-display"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Book Value
              </label>
              <input
                id="asset-book-value-display"
                type="text"
                readOnly
                value={formatCurrency(currentBookValue, currency)}
                className="w-full px-3 py-2 bg-[#f0fdf4] border border-[#bbf7d0] rounded-lg text-xs font-bold text-[#166534] tabular-nums cursor-not-allowed"
              />
            </div>
            <div>
              <label
                htmlFor="asset-vendor-select"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Vendor / Supplier
              </label>
              <select
                id="asset-vendor-select"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              >
                <option value="">Select Vendor</option>
                {state.vendors.map((v) => (
                  <option key={v.id} value={v.name}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="asset-ext-vendorSupplierName"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Vendor / Supplier Name
              </label>
              <input
                id="asset-ext-vendorSupplierName"
                type="text"
                value={extendedValues.vendorSupplierName || ''}
                onChange={(e) =>
                  setExtendedValues((prev) => ({
                    ...prev,
                    vendorSupplierName: e.target.value,
                  }))
                }
                placeholder="Supplier legal name"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="asset-invoice-input"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Invoice No.
              </label>
              <input
                id="asset-invoice-input"
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="e.g. INV-2026-001"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Warranty (Months)
              </label>
              <input
                type="number"
                min="0"
                value={warrantyMonths}
                onChange={(e) => setWarrantyMonths(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="asset-warranty-expiry"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Warranty Expiry
              </label>
              <input
                id="asset-warranty-expiry"
                type="date"
                readOnly
                value={warrantyExpiry}
                className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-600 font-semibold cursor-not-allowed"
              />
            </div>
          </div>
        </div>

        {/* Asset Status, Placement & Condition */}
        <div>
          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3 flex items-center gap-2 border-b pb-2">
            <FolderOpen className="w-3.5 h-3.5 text-slate-400" />
            <span>Status, Location &amp; Condition</span>
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex justify-between items-center">
                <span>Department</span>
                <button
                  type="button"
                  aria-label="Add department"
                  onClick={() => setQuickAddKind('department')}
                  className="text-emerald-700 hover:text-emerald-900 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </label>
              <select
                aria-label="Department"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              >
                <option value="">Select Department</option>
                {state.departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex justify-between items-center">
                <span>Location</span>
                <button
                  type="button"
                  aria-label="Add location"
                  onClick={() => setQuickAddKind('location')}
                  className="text-emerald-700 hover:text-emerald-900 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </label>
              <select
                aria-label="Location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              >
                {state.locations.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="asset-status-select"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Status
              </label>
              <select
                id="asset-status-select"
                value={status}
                onChange={(e) => setStatus(e.target.value as AssetStatus)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              >
                <option value="Available">Available</option>
                <option value="Assigned">Assigned</option>
                <option value="Under Maintenance">Under Maintenance</option>
                <option value="Disposed">Disposed</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="asset-condition-select"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Condition
              </label>
              <select
                id="asset-condition-select"
                value={condition}
                onChange={(e) => setCondition(e.target.value as AssetCondition)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              >
                <option value="New">New</option>
                <option value="Good">Good</option>
                <option value="Fair">Fair</option>
                <option value="Damaged">Damaged</option>
                <option value="Poor">Poor</option>
              </select>
            </div>
          </div>
        </div>

        {/* Person Assignment Fields (6 role categories) */}
        <div>
          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3 flex items-center gap-2 border-b pb-2">
            <Handshake className="w-3.5 h-3.5 text-slate-400" />
            <span>Person Assignment Fields</span>
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="asset-person-employee"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Employee Name
              </label>
              <input
                id="asset-person-employee"
                list="asset-person-employee-list"
                type="text"
                value={employeeName}
                onChange={(e) => setEmployeeName(e.target.value)}
                placeholder="Select or type employee name"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              />
              <datalist id="asset-person-employee-list">
                {state.employees
                  .filter((emp) => emp.status !== 'Inactive')
                  .map((emp) => (
                    <option key={emp.id} value={emp.name} />
                  ))}
              </datalist>
            </div>
            <div>
              <label
                htmlFor="asset-person-consultant"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Consultant Name
              </label>
              <input
                id="asset-person-consultant"
                list="asset-person-consultant-list"
                type="text"
                value={consultantName}
                onChange={(e) => setConsultantName(e.target.value)}
                placeholder="Select or type consultant name"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              />
              <datalist id="asset-person-consultant-list">
                {entities
                  .filter((ent) => ent.entityType === 'Consultant' && ent.status !== 'Inactive')
                  .map((ent) => (
                    <option key={ent.id} value={ent.name} />
                  ))}
              </datalist>
            </div>
            <div>
              <label
                htmlFor="asset-person-retainer"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Retainer Name
              </label>
              <input
                id="asset-person-retainer"
                list="asset-person-retainer-list"
                type="text"
                value={retainerName}
                onChange={(e) => setRetainerName(e.target.value)}
                placeholder="Select or type retainer name"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              />
              <datalist id="asset-person-retainer-list">
                {entities
                  .filter((ent) => ent.entityType === 'Retainer' && ent.status !== 'Inactive')
                  .map((ent) => (
                    <option key={ent.id} value={ent.name} />
                  ))}
              </datalist>
            </div>
            <div>
              <label
                htmlFor="asset-person-freelancer"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Freelancer Name
              </label>
              <input
                id="asset-person-freelancer"
                list="asset-person-freelancer-list"
                type="text"
                value={freelancerName}
                onChange={(e) => setFreelancerName(e.target.value)}
                placeholder="Select or type freelancer name"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              />
              <datalist id="asset-person-freelancer-list">
                {entities
                  .filter((ent) => ent.entityType === 'Freelancer' && ent.status !== 'Inactive')
                  .map((ent) => (
                    <option key={ent.id} value={ent.name} />
                  ))}
              </datalist>
            </div>
            <div>
              <label
                htmlFor="asset-person-yrp"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Young Research Program Name
              </label>
              <input
                id="asset-person-yrp"
                list="asset-person-yrp-list"
                type="text"
                value={yrpName}
                onChange={(e) => setYrpName(e.target.value)}
                placeholder="Select or type YRP member name"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              />
              <datalist id="asset-person-yrp-list">
                {entities
                  .filter(
                    (ent) => ent.entityType === 'Young Research Program' && ent.status !== 'Inactive'
                  )
                  .map((ent) => (
                    <option key={ent.id} value={ent.name} />
                  ))}
              </datalist>
            </div>
            <div>
              <label
                htmlFor="asset-person-intern"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Intern Name
              </label>
              <input
                id="asset-person-intern"
                list="asset-person-intern-list"
                type="text"
                value={internName}
                onChange={(e) => setInternName(e.target.value)}
                placeholder="Select or type intern name"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              />
              <datalist id="asset-person-intern-list">
                {entities
                  .filter((ent) => ent.entityType === 'Intern' && ent.status !== 'Inactive')
                  .map((ent) => (
                    <option key={ent.id} value={ent.name} />
                  ))}
              </datalist>
            </div>
          </div>
        </div>

        {/* Extended Hardware & Fieldwork Attributes (non-duplicate fields) */}
        <div>
          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3 flex items-center gap-2 border-b pb-2">
            <Layers className="w-3.5 h-3.5 text-slate-400" />
            <span>Extended Hardware &amp; Fieldwork Details</span>
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {EXTENDED_ASSET_FIELDS.filter((spec) => spec.key !== 'vendorSupplierName').map((spec) => {
              const fieldId = `asset-ext-${String(spec.key)}`;
              return (
                <div key={String(spec.key)}>
                  <label
                    htmlFor={fieldId}
                    className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
                  >
                    {spec.label}
                  </label>
                  <input
                    id={fieldId}
                    type={spec.type}
                    value={extendedValues[String(spec.key)] || ''}
                    onChange={(e) =>
                      setExtendedValues((prev) => ({
                        ...prev,
                        [String(spec.key)]: e.target.value,
                      }))
                    }
                    placeholder={spec.placeholder}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Additional Info */}
        <div className="space-y-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Description
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Custom Asset Image URL (Optional)
            </label>
            <input
              type="text"
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder="Leave blank to use automatic hardware illustration"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none"
            />
          </div>
        </div>

        {/* Depreciation Accordion */}
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setShowDep((s) => !s)}
            className="w-full bg-slate-50 px-4 py-2.5 flex items-center justify-between cursor-pointer text-left"
          >
            <span className="text-xs font-bold text-slate-800 flex items-center gap-2">
              <Calculator className="w-3.5 h-3.5 text-slate-500" />
              <span>Depreciation Information</span>
              <span className="bg-white text-[10px] px-2 py-0.5 rounded text-slate-600 border tabular-nums">
                Book: {formatCurrency(currentBookValue, currency)}
              </span>
            </span>
            {showDep ? (
              <ChevronUp className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            )}
          </button>

          {showDep && (
            <div className="p-4 bg-white grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-200">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Depreciation Method
                </label>
                <select
                  value={depMethod}
                  onChange={(e) => setDepMethod(e.target.value as DepreciationMethod)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
                >
                  <option value="SLM">Straight Line Method (SLM)</option>
                  <option value="WDV">Written Down Value (WDV)</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Useful Life (Years)
                </label>
                <input
                  type="number"
                  min="1"
                  value={usefulLife}
                  onChange={(e) => setUsefulLife(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Salvage Value ({currency})
                </label>
                <input
                  type="number"
                  min="0"
                  value={salvageValue}
                  onChange={(e) => setSalvageValue(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Current Book Value (Auto Calculated)
                </label>
                <input
                  type="text"
                  readOnly
                  value={formatCurrency(currentBookValue, currency)}
                  className="w-full px-3 py-2 bg-[#f0fdf4] border border-[#bbf7d0] rounded-lg text-sm font-bold text-[#166534] tabular-nums"
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            className={`${palette.primaryBtn} ${palette.primaryBtnHover} px-6 py-2 rounded-lg text-xs font-semibold shadow-md flex items-center gap-1.5 cursor-pointer`}
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save</span>
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

/* SHARED ASSET SELECTOR GRID */
const SelectableAssetGrid: React.FC<{
  assets: Asset[];
  selectedId: string;
  onSelect: (id: string) => void;
  emptyMessage?: string;
}> = ({ assets, selectedId, onSelect, emptyMessage = 'No available assets found' }) => (
  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-56 overflow-y-auto p-2 bg-slate-50 border border-slate-200 rounded-lg">
    {assets.length === 0 ? (
      <div className="col-span-full text-center py-6 text-xs text-slate-500">{emptyMessage}</div>
    ) : (
      assets.map((ast) => {
        const isSelected = selectedId === ast.id;
        return (
          <button
            key={ast.id}
            type="button"
            onClick={() => onSelect(ast.id)}
            className={`rounded-lg p-2 cursor-pointer transition-all flex flex-col items-center text-center relative overflow-hidden border bg-white ${
              isSelected
                ? 'border-emerald-600 ring-2 ring-emerald-600 bg-emerald-50/50'
                : 'border-slate-200 hover:border-emerald-500'
            }`}
          >
            <div className="w-full h-12 rounded mb-1.5 overflow-hidden">
              <AssetThumbnail category={ast.category} name={ast.name} image={ast.image} compact />
            </div>
            <p className="text-[10px] font-bold text-slate-800 line-clamp-1 w-full" title={ast.name}>
              {ast.name}
            </p>
            <p className="text-[9px] font-mono text-slate-500">{ast.id}</p>
            <span
              className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${
                ast.status === 'Available' ? 'bg-emerald-500' : 'bg-blue-500'
              }`}
            />
          </button>
        );
      })
    )}
  </div>
);

const ASSIGNEE_TYPE_OPTIONS: AssigneeEntityType[] = [
  'Employee',
  ...PERSONNEL_ENTITY_TYPES,
];

/* 2. ASSIGNMENT MODAL */
export const AssignModal: React.FC<{
  state: AssetOSState;
  centers?: EmployeeCenterRecord[];
  issuerName?: string;
  issuerEmpId?: string;
  preselectedAssetId?: string;
  onClose: () => void;
  onSubmit: (payload: {
    assetId: string;
    employeeId: string;
    assigneeType: AssigneeEntityType;
    assignDate: string;
    condition: AssetCondition;
    notes: string;
    projectName?: string;
    projectNo?: string;
    eicName?: string;
    allotment?: FreelancerAllotmentDraft;
    openPrintPreview?: boolean;
  }) => void;
}> = ({
  state,
  centers = [],
  issuerName = 'Administrator',
  issuerEmpId = '',
  preselectedAssetId,
  onClose,
  onSubmit,
}) => {
  const palette = THEME_PALETTES[state.settings.theme];
  const today = new Date().toISOString().split('T')[0];

  const [assigneeType, setAssigneeType] = useState<AssigneeEntityType>('Employee');
  const [assignDate, setAssignDate] = useState(today);
  const [employeeId, setEmployeeId] = useState('');
  const [condition, setCondition] = useState<AssetCondition>('Good');
  const [assetSearch, setAssetSearch] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState(preselectedAssetId || '');
  const [projectName, setProjectName] = useState('');
  const [projectNo, setProjectNo] = useState('');
  const [eicName, setEicName] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [allotmentStep, setAllotmentStep] = useState(false);

  const entities = state.entities || [];
  const filteredTargets =
    assigneeType === 'Employee'
      ? state.employees
          .filter((e) => e.status !== 'Inactive')
          .map((e) => ({
            id: e.id,
            code: e.employeeId,
            name: e.name,
            department: e.department,
            projectName: '',
            projectNo: '',
            eicName: '',
          }))
      : entities
          .filter((e) => e.entityType === assigneeType && e.status !== 'Inactive')
          .map((e) => ({
            id: e.id,
            code: e.entityCode,
            name: e.name,
            department: e.department || assigneeType,
            projectName: e.projectName || '',
            projectNo: e.projectNo || '',
            eicName: e.eicName || '',
          }));

  const selectedTarget = filteredTargets.find((t) => t.id === employeeId);
  const selectedFreelancer: PersonnelEntity | undefined =
    assigneeType === 'Freelancer' ? entities.find((e) => e.id === employeeId) : undefined;
  const selectedAsset = state.assets.find((a) => a.id === selectedAssetId);

  const candidateAssets = state.assets.filter(
    (a) =>
      a.status !== 'Disposed' &&
      a.status !== 'Under Maintenance' &&
      !state.assignments.some(
        (asn) =>
          asn.assetId === a.id &&
          asn.status === 'Active' &&
          (asn.custodyLevel || 'Primary') === 'Primary'
      ) &&
      (!assetSearch.trim() ||
        a.name.toLowerCase().includes(assetSearch.toLowerCase()) ||
        a.id.toLowerCase().includes(assetSearch.toLowerCase()) ||
        a.brand.toLowerCase().includes(assetSearch.toLowerCase()))
  );

  const handleSelectTarget = (nextId: string) => {
    setEmployeeId(nextId);
    setError('');
    const found = filteredTargets.find((t) => t.id === nextId);
    if (found) {
      if (found.projectName && !projectName) setProjectName(found.projectName);
      if (found.projectNo && !projectNo) setProjectNo(found.projectNo);
      if (found.eicName && !eicName) setEicName(found.eicName);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId) {
      setError(`Please select a ${assigneeType}.`);
      return;
    }
    if (!selectedAssetId || !selectedAsset) {
      setError('Please select an available asset from the grid.');
      return;
    }
    if (assigneeType === 'Freelancer') {
      if (!selectedFreelancer) {
        setError('Selected Freelancer record could not be loaded.');
        return;
      }
      setAllotmentStep(true);
      return;
    }
    onSubmit({
      assetId: selectedAssetId,
      employeeId,
      assigneeType,
      assignDate,
      condition,
      notes,
      projectName: projectName.trim() || undefined,
      projectNo: projectNo.trim() || undefined,
      eicName: eicName.trim() || undefined,
    });
  };

  if (allotmentStep && selectedAsset && selectedFreelancer) {
    return (
      <FreelancerAllotmentModal
        theme={state.settings.theme}
        asset={selectedAsset}
        freelancer={selectedFreelancer}
        centers={centers}
        issuerName={issuerName}
        issuerEmpId={issuerEmpId}
        defaultDate={assignDate}
        onBack={() => setAllotmentStep(false)}
        onConfirm={(allotment, openPrintPreview) => {
          onSubmit({
            assetId: selectedAssetId,
            employeeId,
            assigneeType: 'Freelancer',
            assignDate,
            condition,
            notes,
            projectName: projectName.trim() || selectedFreelancer.projectName || undefined,
            projectNo: allotment.jobNumber || projectNo.trim() || undefined,
            eicName: eicName.trim() || selectedFreelancer.eicName || undefined,
            allotment,
            openPrintPreview,
          });
        }}
      />
    );
  }

  return (
    <ModalShell
      title="New Primary Asset Assignment"
      icon={<Handshake className="w-4 h-4 text-emerald-400" />}
      headerClass={palette.modalHeader}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 bg-white space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label
              htmlFor="assign-type-select"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Assignee Module *
            </label>
            <select
              id="assign-type-select"
              value={assigneeType}
              onChange={(e) => {
                setAssigneeType(e.target.value as AssigneeEntityType);
                setEmployeeId('');
                setError('');
              }}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none"
            >
              {ASSIGNEE_TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Assignment Date
            </label>
            <input
              type="date"
              required
              value={assignDate}
              onChange={(e) => setAssignDate(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="assign-emp-select"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              {assigneeType} *
            </label>
            <select
              id="assign-emp-select"
              required
              value={employeeId}
              onChange={(e) => handleSelectTarget(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            >
              <option value="">Select {assigneeType}</option>
              {filteredTargets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.code} · {t.department})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Department
            </label>
            <input
              type="text"
              readOnly
              value={selectedTarget?.department || ''}
              placeholder="Auto from assignee"
              className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-600"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Assigned By
            </label>
            <input
              type="text"
              readOnly
              value={issuerName || 'Admin'}
              className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-600"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Asset Condition
            </label>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value as AssetCondition)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            >
              <option value="New">New</option>
              <option value="Good">Good</option>
              <option value="Fair">Fair</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Project Name
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Optional project name"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Project / Job No.
            </label>
            <input
              type="text"
              value={projectNo}
              onChange={(e) => setProjectNo(e.target.value)}
              placeholder="e.g. JOB-2026-04"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Assigned Employee
            </label>
            <input
              type="text"
              value={eicName}
              onChange={(e) => setEicName(e.target.value)}
              placeholder="Assigned Employee"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>
        </div>

        {assigneeType === 'Freelancer' && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 font-semibold">
            Freelancer Allotment Request Form is mandatory before issuing equipment to a Freelancer. Clicking next opens the official 2-step Allotment form.
          </div>
        )}

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Select Available Asset *
          </label>
          <div className="relative mb-2">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
              <Search className="w-3.5 h-3.5" />
            </span>
            <input
              type="text"
              value={assetSearch}
              onChange={(e) => setAssetSearch(e.target.value)}
              placeholder="Search assets by name, ID, or brand..."
              className="w-full pl-9 pr-4 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>
          <SelectableAssetGrid
            assets={candidateAssets}
            selectedId={selectedAssetId}
            onSelect={(id) => {
              setSelectedAssetId(id);
              setError('');
            }}
          />
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Remarks
          </label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
          />
        </div>

        {error && (
          <p role="alert" className="text-xs text-rose-600 font-semibold">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            className={`${palette.primaryBtn} ${palette.primaryBtnHover} px-6 py-2 rounded-lg text-xs font-semibold shadow-md flex items-center gap-1.5 cursor-pointer`}
          >
            <Save className="w-3.5 h-3.5" />
            <span>{assigneeType === 'Freelancer' ? 'Next: Allotment Form →' : 'Save'}</span>
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

/* 2B. SUB-ASSIGNMENT MODAL (Primary Holder / Admin -> Consultant / Retainer / Freelancer / YRP / Intern) */
export const SubAssignModal: React.FC<{
  state: AssetOSState;
  centers?: EmployeeCenterRecord[];
  preselectedAssetId?: string;
  preselectedParentAssignmentId?: string;
  issuerName?: string;
  issuerEmpId?: string;
  onClose: () => void;
  onSubmit: (payload: {
    assetId: string;
    parentAssignmentId?: string;
    assigneeId: string;
    assigneeType: AssigneeEntityType;
    assignDate: string;
    condition: AssetCondition;
    notes: string;
    projectName?: string;
    projectNo?: string;
    eicName?: string;
    allotment?: FreelancerAllotmentDraft;
    openPrintPreview?: boolean;
  }) => void;
}> = ({
  state,
  centers = [],
  preselectedAssetId,
  preselectedParentAssignmentId,
  issuerName = 'Primary Holder',
  issuerEmpId = '',
  onClose,
  onSubmit,
}) => {
  const palette = THEME_PALETTES[state.settings.theme];
  const today = new Date().toISOString().split('T')[0];

  const [targetType, setTargetType] = useState<AssigneeEntityType>('Freelancer');
  const [assigneeId, setAssigneeId] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState(preselectedAssetId || '');
  const [assignDate, setAssignDate] = useState(today);
  const [condition, setCondition] = useState<AssetCondition>('Good');
  const [projectName, setProjectName] = useState('');
  const [projectNo, setProjectNo] = useState('');
  const [eicName, setEicName] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [allotmentStep, setAllotmentStep] = useState(false);

  const entities = state.entities || [];
  const activePrimaryAssignments = state.assignments.filter(
    (a) =>
      a.status === 'Active' &&
      (a.custodyLevel || 'Primary') === 'Primary' &&
      !state.assignments.some(
        (sub) => sub.assetId === a.assetId && sub.status === 'Active' && sub.custodyLevel === 'Sub-Assigned'
      )
  );
  const eligibleAssets = activePrimaryAssignments
    .map((a) => state.assets.find((ast) => ast.id === a.assetId))
    .filter((a): a is Asset => Boolean(a && a.status !== 'Disposed'));

  const resolvedParent =
    activePrimaryAssignments.find((a) => a.id === preselectedParentAssignmentId) ||
    activePrimaryAssignments.find((a) => a.assetId === selectedAssetId);

  const subTargetTypes: AssigneeEntityType[] = [...PERSONNEL_ENTITY_TYPES, 'Employee'];
  const targetOptions =
    targetType === 'Employee'
      ? state.employees
          .filter((e) => e.status !== 'Inactive' && e.id !== resolvedParent?.employeeId)
          .map((e) => ({
            id: e.id,
            code: e.employeeId,
            name: e.name,
            department: e.department,
            projectName: '',
            projectNo: '',
            eicName: '',
          }))
      : entities
          .filter(
            (e) =>
              e.entityType === targetType &&
              e.status !== 'Inactive' &&
              e.id !== resolvedParent?.employeeId
          )
          .map((e) => ({
            id: e.id,
            code: e.entityCode,
            name: e.name,
            department: e.department || targetType,
            projectName: e.projectName || '',
            projectNo: e.projectNo || '',
            eicName: e.eicName || '',
          }));

  const selectedAsset = state.assets.find((a) => a.id === selectedAssetId);
  const selectedFreelancer: PersonnelEntity | undefined =
    targetType === 'Freelancer' ? entities.find((e) => e.id === assigneeId) : undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAssetId || !selectedAsset) {
      setError('Select an asset with an active Primary custody assignment.');
      return;
    }
    if (!assigneeId) {
      setError(`Select a ${targetType} to sub-assign this equipment to.`);
      return;
    }
    if (targetType === 'Freelancer') {
      if (!selectedFreelancer) {
        setError('Selected Freelancer record could not be loaded.');
        return;
      }
      setAllotmentStep(true);
      return;
    }
    onSubmit({
      assetId: selectedAssetId,
      parentAssignmentId: resolvedParent?.id,
      assigneeId,
      assigneeType: targetType,
      assignDate,
      condition,
      notes,
      projectName: projectName.trim() || undefined,
      projectNo: projectNo.trim() || undefined,
      eicName: eicName.trim() || undefined,
    });
  };

  if (allotmentStep && selectedAsset && selectedFreelancer) {
    return (
      <FreelancerAllotmentModal
        theme={state.settings.theme}
        asset={selectedAsset}
        freelancer={selectedFreelancer}
        centers={centers}
        issuerName={issuerName}
        issuerEmpId={issuerEmpId}
        defaultDate={assignDate}
        onBack={() => setAllotmentStep(false)}
        onConfirm={(allotment, openPrintPreview) => {
          onSubmit({
            assetId: selectedAssetId,
            parentAssignmentId: resolvedParent?.id,
            assigneeId,
            assigneeType: 'Freelancer',
            assignDate,
            condition,
            notes,
            projectName: projectName.trim() || selectedFreelancer.projectName || undefined,
            projectNo: allotment.jobNumber || projectNo.trim() || undefined,
            eicName: eicName.trim() || selectedFreelancer.eicName || undefined,
            allotment,
            openPrintPreview,
          });
        }}
      />
    );
  }

  return (
    <ModalShell
      title="Sub-Assign Allocated Asset"
      icon={<Handshake className="w-4 h-4 text-emerald-400" />}
      headerClass={palette.modalHeader}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 bg-white space-y-4">
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
          Custody Chain: <strong>Primary Holder ({issuerName})</strong> →{' '}
          <strong>Sub-Assignee ({targetType})</strong>. Returning the sub-assignment restores custody to the Primary holder.
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label
              htmlFor="subassign-target-type"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Sub-Assignee Type *
            </label>
            <select
              id="subassign-target-type"
              value={targetType}
              onChange={(e) => {
                setTargetType(e.target.value as AssigneeEntityType);
                setAssigneeId('');
                setError('');
              }}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none"
            >
              {subTargetTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="subassign-target-select"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Sub-Assignee *
            </label>
            <select
              id="subassign-target-select"
              required
              value={assigneeId}
              onChange={(e) => {
                const val = e.target.value;
                setAssigneeId(val);
                setError('');
                const found = targetOptions.find((t) => t.id === val);
                if (found) {
                  if (found.projectName && !projectName) setProjectName(found.projectName);
                  if (found.projectNo && !projectNo) setProjectNo(found.projectNo);
                  if (found.eicName && !eicName) setEicName(found.eicName);
                }
              }}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            >
              <option value="">Select {targetType}</option>
              {targetOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.code} · {t.department})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Sub-Assign Date
            </label>
            <input
              type="date"
              required
              value={assignDate}
              onChange={(e) => setAssignDate(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Project Name
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Project / Job No.
            </label>
            <input
              type="text"
              value={projectNo}
              onChange={(e) => setProjectNo(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Asset Condition
            </label>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value as AssetCondition)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            >
              <option value="New">New</option>
              <option value="Good">Good</option>
              <option value="Fair">Fair</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Select Eligible Allocated Asset *
          </label>
          <SelectableAssetGrid
            assets={eligibleAssets}
            selectedId={selectedAssetId}
            onSelect={(id) => {
              setSelectedAssetId(id);
              setError('');
            }}
            emptyMessage="No active Primary-assigned assets available for sub-assignment"
          />
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Remarks
          </label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
          />
        </div>

        {error && (
          <p role="alert" className="text-xs text-rose-600 font-semibold">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            className={`${palette.primaryBtn} ${palette.primaryBtnHover} px-6 py-2 rounded-lg text-xs font-semibold shadow-md flex items-center gap-1.5 cursor-pointer`}
          >
            <Save className="w-3.5 h-3.5" />
            <span>{targetType === 'Freelancer' ? 'Next: Allotment Form →' : 'Confirm Sub-Assignment'}</span>
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

/* 3. RETURN MODAL */
export const ReturnModal: React.FC<{
  state: AssetOSState;
  preselectedAssetId?: string;
  preselectedEmployeeId?: string;
  onClose: () => void;
  onSubmit: (payload: {
    assetId: string;
    employeeId: string;
    date: string;
    condition: AssetCondition;
    damage: 'No Damage' | 'Minor Damage' | 'Major Damage';
    remarks: string;
  }) => void;
}> = ({ state, preselectedAssetId, preselectedEmployeeId, onClose, onSubmit }) => {
  const palette = THEME_PALETTES[state.settings.theme];
  const today = new Date().toISOString().split('T')[0];

  const [date, setDate] = useState(today);
  const [employeeId, setEmployeeId] = useState(preselectedEmployeeId || '');
  const [selectedAssetId, setSelectedAssetId] = useState(preselectedAssetId || '');
  const [condition, setCondition] = useState<AssetCondition>('Good');
  const [damage, setDamage] = useState<'No Damage' | 'Minor Damage' | 'Major Damage'>('No Damage');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');

  const entities = state.entities || [];
  const activePrimaryAssignments = state.assignments.filter(
    (a) => a.status === 'Active' && (a.custodyLevel || 'Primary') === 'Primary'
  );

  const holdersWithActive: Array<{ id: string; label: string }> = [];
  for (const e of state.employees) {
    if (activePrimaryAssignments.some((a) => a.employeeId === e.id)) {
      holdersWithActive.push({ id: e.id, label: `${e.name} (Employee · ${e.employeeId})` });
    }
  }
  for (const ent of entities) {
    if (activePrimaryAssignments.some((a) => a.employeeId === ent.id || a.employeeId === ent.entityCode)) {
      holdersWithActive.push({
        id: ent.id,
        label: `${ent.name} (${ent.entityType} · ${ent.entityCode})`,
      });
    }
  }

  const employeeAssets = activePrimaryAssignments
    .filter((a) => a.employeeId === employeeId)
    .map((a) => state.assets.find((ast) => ast.id === a.assetId))
    .filter((a): a is Asset => Boolean(a));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId || !selectedAssetId) {
      setError('Please select both a custody holder and an assigned asset.');
      return;
    }
    onSubmit({ assetId: selectedAssetId, employeeId, date, condition, damage, remarks });
  };

  return (
    <ModalShell
      title="New Primary Asset Return"
      icon={<RotateCcw className="w-4 h-4 text-emerald-400" />}
      headerClass={palette.modalHeader}
      maxWidth="max-w-2xl"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 bg-white space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Return No.
            </label>
            <input
              type="text"
              readOnly
              value="(auto generated)"
              className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-500"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Return Date
            </label>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Custody Holder *
            </label>
            <select
              required
              value={employeeId}
              onChange={(e) => {
                setEmployeeId(e.target.value);
                setSelectedAssetId('');
              }}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            >
              <option value="">Select Holder</option>
              {holdersWithActive.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Select Assigned Asset *
          </label>
          <SelectableAssetGrid
            assets={employeeAssets}
            selectedId={selectedAssetId}
            onSelect={(id) => {
              setSelectedAssetId(id);
              setError('');
            }}
            emptyMessage={
              employeeId ? 'No active Primary assigned assets for this holder' : 'Select a custody holder first'
            }
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Return Condition
            </label>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value as AssetCondition)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            >
              <option value="New">New</option>
              <option value="Good">Good</option>
              <option value="Fair">Fair</option>
              <option value="Poor">Poor</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Damage Status
            </label>
            <select
              value={damage}
              onChange={(e) =>
                setDamage(e.target.value as 'No Damage' | 'Minor Damage' | 'Major Damage')
              }
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            >
              <option value="No Damage">No Damage</option>
              <option value="Minor Damage">Minor Damage</option>
              <option value="Major Damage">Major Damage</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Remarks
          </label>
          <textarea
            rows={2}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
          />
        </div>

        {error && (
          <p role="alert" className="text-xs text-rose-600 font-semibold">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            className={`${palette.primaryBtn} ${palette.primaryBtnHover} px-6 py-2 rounded-lg text-xs font-semibold shadow-md flex items-center gap-1.5 cursor-pointer`}
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save</span>
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

/* 4. TRANSFER MODAL */
export const TransferModal: React.FC<{
  state: AssetOSState;
  preselectedAssetId?: string;
  preselectedEmployeeId?: string;
  onClose: () => void;
  onSubmit: (payload: {
    assetId: string;
    currentEmployeeId: string;
    newEmployeeId: string;
    date: string;
    newLocation: string;
    reason: string;
    remarks: string;
  }) => void;
}> = ({ state, preselectedAssetId, preselectedEmployeeId, onClose, onSubmit }) => {
  const palette = THEME_PALETTES[state.settings.theme];
  const today = new Date().toISOString().split('T')[0];

  const [date, setDate] = useState(today);
  const [currentEmpId, setCurrentEmpId] = useState(preselectedEmployeeId || '');
  const [selectedAssetId, setSelectedAssetId] = useState(preselectedAssetId || '');
  const [newEmpId, setNewEmpId] = useState('');
  const [newLocation, setNewLocation] = useState(state.locations[0] || 'Floor 1');
  const [reason, setReason] = useState('Department Transfer');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');

  const employeesWithActive = state.employees.filter((e) =>
    state.assignments.some((a) => a.employeeId === e.id && a.status === 'Active')
  );
  const employeeAssets = state.assignments
    .filter((a) => a.employeeId === currentEmpId && a.status === 'Active')
    .map((a) => state.assets.find((ast) => ast.id === a.assetId))
    .filter((a): a is Asset => Boolean(a));
  const newEmp = state.employees.find((e) => e.id === newEmpId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentEmpId || !selectedAssetId || !newEmpId) {
      setError('Please select current employee, asset, and destination employee.');
      return;
    }
    onSubmit({
      assetId: selectedAssetId,
      currentEmployeeId: currentEmpId,
      newEmployeeId: newEmpId,
      date,
      newLocation,
      reason,
      remarks,
    });
  };

  return (
    <ModalShell
      title="New Asset Transfer"
      icon={<ArrowLeftRight className="w-4 h-4 text-emerald-400" />}
      headerClass={palette.modalHeader}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 bg-white space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Transfer No.
            </label>
            <input
              type="text"
              readOnly
              value="(auto generated)"
              className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-500"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Transfer Date
            </label>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Current Employee *
            </label>
            <select
              required
              value={currentEmpId}
              onChange={(e) => {
                setCurrentEmpId(e.target.value);
                setSelectedAssetId('');
              }}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            >
              <option value="">Select Current Employee</option>
              {employeesWithActive.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Select Asset *
          </label>
          <SelectableAssetGrid
            assets={employeeAssets}
            selectedId={selectedAssetId}
            onSelect={(id) => {
              setSelectedAssetId(id);
              setError('');
            }}
            emptyMessage={
              currentEmpId ? 'No active assigned assets for this employee' : 'Select an employee first'
            }
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              New Employee *
            </label>
            <select
              required
              value={newEmpId}
              onChange={(e) => setNewEmpId(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            >
              <option value="">Select New Employee</option>
              {state.employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.department})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              New Department
            </label>
            <input
              type="text"
              readOnly
              value={newEmp?.department || ''}
              placeholder="Auto from employee"
              className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-600"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              New Location *
            </label>
            <select
              required
              value={newLocation}
              onChange={(e) => setNewLocation(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            >
              {state.locations.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Transfer Reason *
            </label>
            <select
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            >
              <option value="Department Transfer">Department Transfer</option>
              <option value="Location Relocation">Location Relocation</option>
              <option value="Employee Change">Employee Change</option>
              <option value="Upgrade">Upgrade</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Transferred By
            </label>
            <input
              type="text"
              readOnly
              value="Admin"
              className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-600"
            />
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Remarks
          </label>
          <textarea
            rows={2}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
          />
        </div>

        {error && (
          <p role="alert" className="text-xs text-rose-600 font-semibold">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            className={`${palette.primaryBtn} ${palette.primaryBtnHover} px-6 py-2 rounded-lg text-xs font-semibold shadow-md flex items-center gap-1.5 cursor-pointer`}
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save</span>
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

/* 5. MAINTENANCE MODAL */
export const MaintenanceModal: React.FC<{
  state: AssetOSState;
  editingRecord?: MaintenanceRecord;
  onClose: () => void;
  onSave: (record: Omit<MaintenanceRecord, 'id'> & { id?: string }) => void;
}> = ({ state, editingRecord, onClose, onSave }) => {
  const palette = THEME_PALETTES[state.settings.theme];
  const today = new Date().toISOString().split('T')[0];

  const [serviceDate, setServiceDate] = useState(editingRecord?.serviceDate || today);
  const [selectedAssetId, setSelectedAssetId] = useState(editingRecord?.assetId || '');
  const [assetSearch, setAssetSearch] = useState('');
  const [vendor, setVendor] = useState(editingRecord?.vendor || '');
  const [type, setType] = useState<MaintenanceRecord['type']>(
    editingRecord?.type || 'Preventive'
  );
  const [cost, setCost] = useState(editingRecord ? String(editingRecord.cost) : '0');
  const [nextDate, setNextDate] = useState(editingRecord?.nextDate || '');
  const [status, setStatus] = useState<MaintenanceRecord['status']>(
    editingRecord?.status || 'Open'
  );
  const [notes, setNotes] = useState(editingRecord?.notes || '');
  const [error, setError] = useState('');

  const candidateAssets = state.assets.filter(
    (a) =>
      a.status !== 'Disposed' &&
      (!assetSearch.trim() ||
        a.name.toLowerCase().includes(assetSearch.toLowerCase()) ||
        a.id.toLowerCase().includes(assetSearch.toLowerCase()))
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAssetId) {
      setError('Please select an asset from the grid.');
      return;
    }
    onSave({
      id: editingRecord?.id,
      assetId: selectedAssetId,
      vendor,
      type,
      cost: parseFloat(cost) || 0,
      serviceDate,
      nextDate,
      status,
      notes,
    });
  };

  return (
    <ModalShell
      title={editingRecord ? `Edit Maintenance (${editingRecord.id})` : 'New Asset Maintenance'}
      icon={<Wrench className="w-4 h-4 text-emerald-400" />}
      headerClass={palette.modalHeader}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 bg-white space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Maintenance No.
            </label>
            <input
              type="text"
              readOnly
              value={editingRecord?.id || '(auto generated)'}
              className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-500"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Date
            </label>
            <input
              type="date"
              required
              value={serviceDate}
              onChange={(e) => setServiceDate(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Select Asset *
          </label>
          <div className="relative mb-2">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
              <Search className="w-3.5 h-3.5" />
            </span>
            <input
              type="text"
              value={assetSearch}
              onChange={(e) => setAssetSearch(e.target.value)}
              placeholder="Search assets by name or ID..."
              className="w-full pl-9 pr-4 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>
          <SelectableAssetGrid
            assets={candidateAssets}
            selectedId={selectedAssetId}
            onSelect={(id) => {
              setSelectedAssetId(id);
              setError('');
            }}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Vendor
            </label>
            <select
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            >
              <option value="">—</option>
              {state.vendors.map((v) => (
                <option key={v.id} value={v.name}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Maintenance Type
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as MaintenanceRecord['type'])}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            >
              <option value="Preventive">Preventive</option>
              <option value="Corrective">Corrective</option>
              <option value="Upgrade">Upgrade</option>
              <option value="Inspection">Inspection</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Cost
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Next Service Date
            </label>
            <input
              type="date"
              value={nextDate}
              onChange={(e) => setNextDate(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Maintenance Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as MaintenanceRecord['status'])}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            >
              <option value="Open">Open</option>
              <option value="In Progress">In Progress</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Remarks
          </label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
          />
        </div>

        {error && (
          <p role="alert" className="text-xs text-rose-600 font-semibold">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            className={`${palette.primaryBtn} ${palette.primaryBtnHover} px-6 py-2 rounded-lg text-xs font-semibold shadow-md flex items-center gap-1.5 cursor-pointer`}
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save</span>
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

/* 6. DISPOSAL MODAL */
export const DisposalModal: React.FC<{
  state: AssetOSState;
  onClose: () => void;
  onSubmit: (payload: {
    assetId: string;
    disposalDate: string;
    salvageRecovered: number;
    reason: string;
    notes: string;
  }) => void;
}> = ({ state, onClose, onSubmit }) => {
  const today = new Date().toISOString().split('T')[0];
  const [assetId, setAssetId] = useState('');
  const [disposalDate, setDisposalDate] = useState(today);
  const [salvageRecovered, setSalvageRecovered] = useState('0');
  const [reason, setReason] = useState('Beyond Economical Repair');
  const [notes, setNotes] = useState('');

  const eligible = state.assets.filter((a) => a.status !== 'Disposed');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!assetId) return;
    onSubmit({
      assetId,
      disposalDate,
      salvageRecovered: parseFloat(salvageRecovered) || 0,
      reason,
      notes,
    });
  };

  return (
    <ModalShell
      title="New Asset Disposal"
      icon={<Trash2 className="w-4 h-4 text-rose-400" />}
      headerClass="bg-[#3f3f46]"
      maxWidth="max-w-lg"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-4 bg-white">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Select Asset *
          </label>
          <select
            required
            value={assetId}
            onChange={(e) => setAssetId(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
          >
            <option value="">Select Asset</option>
            {eligible.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.serial})
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Disposal Date *
            </label>
            <input
              type="date"
              required
              value={disposalDate}
              onChange={(e) => setDisposalDate(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Salvage Value ({state.settings.currency})
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={salvageRecovered}
              onChange={(e) => setSalvageRecovered(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Disposal Reason *
          </label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
          >
            <option value="Beyond Economical Repair">Beyond Economical Repair</option>
            <option value="E-Waste Scrap Recycling">E-Waste Scrap Recycling</option>
            <option value="Sold to Employee / Third Party">Sold to Employee / Third Party</option>
            <option value="Lost or Stolen">Lost or Stolen</option>
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Remarks
          </label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-6 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold shadow-md cursor-pointer"
          >
            Confirm Disposal
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

/* 7. BATCH ASSET UPDATE MODAL */
export const BatchAssetUpdateModal: React.FC<{
  state: AssetOSState;
  assetIds: string[];
  onClose: () => void;
  onSubmit: (payload: {
    assetIds: string[];
    status?: AssetStatus;
    department?: string;
    notes?: string;
  }) => Promise<void> | void;
}> = ({ state, assetIds, onClose, onSubmit }) => {
  const palette = THEME_PALETTES[state.settings.theme];
  const selectedAssets = state.assets.filter((a) => assetIds.includes(a.id));
  const [status, setStatus] = useState<AssetStatus | ''>('');
  const [department, setDepartment] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedAssets.length === 0) {
      setError('No assets selected for update.');
      return;
    }
    if (!status && !department) {
      setError('Please select a new Status, Department, or both.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await onSubmit({
        assetIds: selectedAssets.map((a) => a.id),
        status: status || undefined,
        department: department || undefined,
        notes: notes.trim() || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Batch update failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell
      title={`Batch Update (${selectedAssets.length} Assets)`}
      icon={<Layers className="w-4 h-4 text-emerald-400" />}
      headerClass={palette.modalHeader}
      maxWidth="max-w-lg"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-4 bg-white overflow-y-auto flex-1">
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-1.5">
          <div className="font-bold text-slate-900">
            Selected Assets ({selectedAssets.length})
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
            {selectedAssets.map((a) => (
              <span
                key={a.id}
                className="px-2 py-0.5 rounded bg-white border border-slate-200 text-[10px] font-mono text-slate-700"
              >
                {a.id} · {a.name}
              </span>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="batch-status-select"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Update Status
            </label>
            <select
              id="batch-status-select"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as AssetStatus | '');
                if (error) setError('');
              }}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
            >
              <option value="">— Keep Current Status —</option>
              <option value="Available">Available</option>
              <option value="Assigned">Assigned</option>
              <option value="Under Maintenance">Under Maintenance</option>
              <option value="Disposed">Disposed</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="batch-department-select"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Update Department
            </label>
            <select
              id="batch-department-select"
              value={department}
              onChange={(e) => {
                setDepartment(e.target.value);
                if (error) setError('');
              }}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
            >
              <option value="">— Keep Current Department —</option>
              {state.departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label
            htmlFor="batch-notes-input"
            className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
          >
            Audit Reason / Remarks
          </label>
          <textarea
            id="batch-notes-input"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Quarterly IT reallocation & hardware audit"
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
          />
        </div>

        <p className="text-[11px] text-slate-500">
          Updates are saved atomically in SQLite with Asset History and System Audit logs. Employee records are never modified or deleted.
        </p>

        {error && (
          <p role="alert" className="text-xs text-rose-600 font-semibold">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className={`${palette.primaryBtn} ${palette.primaryBtnHover} disabled:opacity-60 px-6 py-2 rounded-lg text-xs font-semibold shadow-md flex items-center gap-1.5 cursor-pointer`}
          >
            <Save className="w-3.5 h-3.5" />
            <span>{submitting ? 'Applying...' : `Apply to ${selectedAssets.length} Asset(s)`}</span>
          </button>
        </div>
      </form>
    </ModalShell>
  );
};
