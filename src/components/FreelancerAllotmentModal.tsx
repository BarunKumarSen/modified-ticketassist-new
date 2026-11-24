import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  FileText,
  Plus,
  Trash2,
  XCircle,
} from 'lucide-react';
import type {
  Asset,
  FreelancerAccessoryItem,
  PersonnelEntity,
  ThemePalette,
} from '../types/asset';
import type { EmployeeCenterRecord } from '../types/policy';
import { INDIAN_CENTERS, normalizeCenterName } from '../data/indianCenters';
import { THEME_PALETTES } from '../utils/assetMath';
import {
  getDefaultFreelancerAccessories,
  resolveCenterOfficeInfo,
  validateFreelancerAllotmentInput,
} from '../utils/entityValidation';
import { ModalShell } from './AssetModals';
import { SearchableCenterSelect } from './SearchableCenterSelect';

export interface FreelancerAllotmentDraft {
  flpId: string;
  flpName: string;
  flpCode: string;
  flpAddress: string;
  aadhaarNo: string;
  panNo: string;
  mobileNo: string;
  centerName: string;
  executiveName: string;
  executiveEmpId: string;
  jobNumber: string;
  issueDate: string;
  accessories: FreelancerAccessoryItem[];
  remarks: string;
  witness1Name: string;
  witness2Name: string;
  allotmentDate: string;
}

interface FreelancerAllotmentModalProps {
  theme: ThemePalette;
  asset: Asset;
  freelancer: PersonnelEntity;
  centers: EmployeeCenterRecord[];
  issuerName: string;
  issuerEmpId: string;
  defaultDate: string;
  onBack: () => void;
  onConfirm: (allotment: FreelancerAllotmentDraft, openPrintPreview: boolean) => void;
}

export const FreelancerAllotmentModal: React.FC<FreelancerAllotmentModalProps> = ({
  theme,
  asset,
  freelancer,
  centers,
  issuerName,
  issuerEmpId,
  defaultDate,
  onBack,
  onConfirm,
}) => {
  const palette = THEME_PALETTES[theme];

  const centerOptions: EmployeeCenterRecord[] =
    centers && centers.length > 0
      ? centers
      : INDIAN_CENTERS.map((c) => ({
          id: c.id,
          name: c.name,
          stateRegion: c.stateRegion,
          isActive: true,
          createdAt: '',
        }));

  const [flpName, setFlpName] = useState(freelancer.name || '');
  const [flpCode, setFlpCode] = useState(freelancer.entityCode || '');
  const [flpAddress, setFlpAddress] = useState(freelancer.address || '');
  const [aadhaarNo, setAadhaarNo] = useState(freelancer.aadhaarCard || '');
  const [panNo, setPanNo] = useState(freelancer.panCard || '');
  const [mobileNo, setMobileNo] = useState(freelancer.phone || '');
  const [centerName, setCenterName] = useState(
    normalizeCenterName(freelancer.center || 'Kolkata')
  );
  const [executiveName, setExecutiveName] = useState(issuerName || '');
  const [executiveEmpId, setExecutiveEmpId] = useState(issuerEmpId || '');
  const [jobNumber, setJobNumber] = useState(
    freelancer.projectNo || asset.projectNo || ''
  );
  const [issueDate, setIssueDate] = useState(defaultDate || new Date().toISOString().split('T')[0]);
  const [allotmentDate, setAllotmentDate] = useState(
    defaultDate || new Date().toISOString().split('T')[0]
  );
  const [accessories, setAccessories] = useState<FreelancerAccessoryItem[]>(
    getDefaultFreelancerAccessories
  );
  const [remarks, setRemarks] = useState('');
  const [witness1Name, setWitness1Name] = useState('');
  const [witness2Name, setWitness2Name] = useState('');
  const [openPrintPreview, setOpenPrintPreview] = useState(true);
  const [error, setError] = useState('');

  const officeInfo = useMemo(
    () => resolveCenterOfficeInfo(centerName, centerOptions),
    [centerName, centerOptions]
  );

  const handleUpdateAccessory = (idx: number, field: 'name' | 'qty', val: string) => {
    setAccessories((prev) =>
      prev.map((item, i) =>
        i === idx
          ? {
              ...item,
              [field]: field === 'qty' ? Math.max(1, Number(val) || 1) : val,
            }
          : item
      )
    );
  };

  const handleAddAccessory = () => {
    setAccessories((prev) => [...prev, { name: '', qty: 1 }]);
  };

  const handleRemoveAccessory = (idx: number) => {
    setAccessories((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const cleanedAccessories = accessories.filter((a) => a.name.trim());
    const check = validateFreelancerAllotmentInput({
      flpId: freelancer.id,
      flpName,
      flpCode,
      flpAddress,
      aadhaarNo,
      panNo,
      mobileNo,
      centerName,
      executiveName,
      executiveEmpId,
      jobNumber,
      issueDate,
      assetIds: [asset.id],
      accessories: cleanedAccessories,
    });

    if (!check.ok) {
      setError(check.error);
      return;
    }

    onConfirm(
      {
        flpId: freelancer.id,
        flpName: flpName.trim(),
        flpCode: flpCode.trim().toUpperCase(),
        flpAddress: flpAddress.trim(),
        aadhaarNo: aadhaarNo.trim(),
        panNo: panNo.trim().toUpperCase(),
        mobileNo: mobileNo.trim(),
        centerName: officeInfo.name,
        executiveName: executiveName.trim(),
        executiveEmpId: executiveEmpId.trim(),
        jobNumber: jobNumber.trim(),
        issueDate,
        accessories: cleanedAccessories,
        remarks: remarks.trim(),
        witness1Name: witness1Name.trim(),
        witness2Name: witness2Name.trim(),
        allotmentDate,
      },
      openPrintPreview
    );
  };

  return (
    <ModalShell
      title={`Mandatory Freelancer IT Equipment Allotment Form — ${freelancer.entityCode}`}
      icon={<FileText className="w-4 h-4 text-emerald-400" />}
      headerClass={palette.modalHeader}
      maxWidth="max-w-3xl"
      onClose={onBack}
    >
      <form
        onSubmit={handleSubmit}
        noValidate
        className="p-6 overflow-y-auto flex-1 bg-white space-y-4 max-h-[82vh]"
      >
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="font-bold text-slate-900">Equipment: </span>
            <span>
              {asset.name} ({asset.id}) · S/N {asset.serial}
            </span>
          </div>
          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-bold">
            2-Page Allotment &amp; Undertaking Required
          </span>
        </div>

        {error && (
          <div
            role="alert"
            className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-2"
          >
            <XCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Freelancer Details */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Freelancer Name *
            </label>
            <input
              type="text"
              value={flpName}
              onChange={(e) => setFlpName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Freelancer Code *
            </label>
            <input
              type="text"
              value={flpCode}
              onChange={(e) => setFlpCode(e.target.value.toUpperCase())}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono uppercase"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Mobile No. *
            </label>
            <input
              type="text"
              value={mobileNo}
              onChange={(e) => setMobileNo(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Aadhaar Card No. *
            </label>
            <input
              type="text"
              value={aadhaarNo}
              onChange={(e) => setAadhaarNo(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              PAN Card No. *
            </label>
            <input
              type="text"
              value={panNo}
              onChange={(e) => setPanNo(e.target.value.toUpperCase())}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono uppercase"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Job Number / Project No. *
            </label>
            <input
              type="text"
              value={jobNumber}
              onChange={(e) => setJobNumber(e.target.value)}
              placeholder="e.g. JOB-2026-01"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
            />
          </div>
          <div className="md:col-span-3">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Freelancer Residential Address *
            </label>
            <textarea
              rows={2}
              value={flpAddress}
              onChange={(e) => setFlpAddress(e.target.value)}
              placeholder="Complete residential address for allotment & undertaking"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
        </div>

        {/* Center & Issuer */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Name of Center *
              </label>
              <SearchableCenterSelect
                centers={centerOptions}
                value={centerName}
                onChange={setCenterName}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Executive Name (Issuer) *
              </label>
              <input
                type="text"
                value={executiveName}
                onChange={(e) => setExecutiveName(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Executive Emp. ID
              </label>
              <input
                type="text"
                value={executiveEmpId}
                onChange={(e) => setExecutiveEmpId(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono"
              />
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-white border border-slate-200 text-[11px] text-slate-600 flex items-start gap-2">
            <Building2 className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-slate-800">
                Center Letterhead Address ({officeInfo.name}):{' '}
              </span>
              <span>{officeInfo.address}</span>
              <span className="block font-mono text-slate-500 mt-0.5">
                T: {officeInfo.phone} · W: www.medianresearch.in
              </span>
            </div>
          </div>
        </div>

        {/* Dates & Accessories */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Date of Issue *
            </label>
            <input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Allotment / Undertaking Letter Date *
            </label>
            <input
              type="date"
              value={allotmentDate}
              onChange={(e) => setAllotmentDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Accessories Issued (Listed under Equipment Table)
            </label>
            <button
              type="button"
              onClick={handleAddAccessory}
              className="text-xs font-bold text-emerald-700 hover:text-emerald-900 flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Add Accessory Row
            </button>
          </div>
          <div className="space-y-2">
            {accessories.map((acc, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={acc.name}
                  onChange={(e) => handleUpdateAccessory(idx, 'name', e.target.value)}
                  placeholder="Accessory name (e.g. Power Adaptor / Charger)"
                  className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-xs"
                />
                <input
                  type="number"
                  min={1}
                  value={acc.qty}
                  onChange={(e) => handleUpdateAccessory(idx, 'qty', e.target.value)}
                  className="w-20 px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs text-center font-mono"
                />
                <button
                  type="button"
                  aria-label="Remove accessory row"
                  onClick={() => handleRemoveAccessory(idx)}
                  className="p-1.5 text-rose-600 hover:bg-rose-50 rounded cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Witness 1 Name (Optional)
            </label>
            <input
              type="text"
              value={witness1Name}
              onChange={(e) => setWitness1Name(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Witness 2 Name (Optional)
            </label>
            <input
              type="text"
              value={witness2Name}
              onChange={(e) => setWitness2Name(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Remarks (if any)
            </label>
            <input
              type="text"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Appears inside bottom row of List of IT Equipments table"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={openPrintPreview}
            onChange={(e) => setOpenPrintPreview(e.target.checked)}
            className="rounded border-slate-300 text-emerald-700"
          />
          <span>Open 2-page printable A4 Allotment &amp; Undertaking Form right after saving</span>
        </label>

        <div className="flex items-center justify-between pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={onBack}
            className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back</span>
          </button>
          <button
            type="submit"
            className={`${palette.primaryBtn} ${palette.primaryBtnHover} px-6 py-2 rounded-lg text-xs font-bold shadow-md flex items-center gap-1.5 cursor-pointer`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Confirm Allotment &amp; Assign Asset</span>
          </button>
        </div>
      </form>
    </ModalShell>
  );
};
