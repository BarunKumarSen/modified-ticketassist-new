import React, { useEffect, useState } from 'react';
import { Building2, Landmark, Plus, Save, UserPlus, XCircle } from 'lucide-react';
import type { AssetOSState, PersonnelEntity } from '../types/asset';
import type { EmployeeCenterRecord } from '../types/policy';
import { apiClient, ApiError } from '../api/client';
import { validatePasswordStrength } from '../auth/authLogic';
import { DEFAULT_INDIAN_CENTER, INDIAN_CENTERS, normalizeCenterName } from '../data/indianCenters';
import { THEME_PALETTES } from '../utils/assetMath';
import {
  normalizeEntityIdInput,
  validateEntityId,
  validatePersonnelEntityInput,
} from '../utils/entityValidation';
import { ModalShell } from './AssetModals';
import { SearchableCenterSelect } from './SearchableCenterSelect';

interface FreelancerFormModalProps {
  state: AssetOSState;
  centers?: EmployeeCenterRecord[];
  editingEntity?: PersonnelEntity;
  onClose: () => void;
  onSave: (
    payload: Omit<PersonnelEntity, 'id' | 'createdAt'> & { id?: string; password?: string }
  ) => Promise<void> | void;
  onDepartmentsUpdated?: () => void;
}

export const FreelancerFormModal: React.FC<FreelancerFormModalProps> = ({
  state,
  centers,
  editingEntity,
  onClose,
  onSave,
  onDepartmentsUpdated,
}) => {
  const palette = THEME_PALETTES[state.settings.theme];
  const entities = state.entities || [];

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

  const [departmentsList, setDepartmentsList] = useState<string[]>(
    state.departments || []
  );
  const [addingDept, setAddingDept] = useState(false);
  const [newDeptName, setNewDeptName] = useState('');

  useEffect(() => {
    let active = true;
    apiClient
      .listDepartments()
      .then((res) => {
        if (!active) return;
        setDepartmentsList(res.departments || []);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const [entityCode, setEntityCode] = useState(editingEntity?.entityCode || '');
  const [entityCodeError, setEntityCodeError] = useState('');
  const [name, setName] = useState(editingEntity?.name || '');
  const [fatherHusbandName, setFatherHusbandName] = useState(
    editingEntity?.fatherHusbandName || ''
  );
  const [phone, setPhone] = useState(editingEntity?.phone || '');
  const [whatsappNo, setWhatsappNo] = useState(editingEntity?.whatsappNo || '');
  const [email, setEmail] = useState(editingEntity?.email || '');
  const [address, setAddress] = useState(editingEntity?.address || '');
  const [aadhaarCard, setAadhaarCard] = useState(editingEntity?.aadhaarCard || '');
  const [panCard, setPanCard] = useState(editingEntity?.panCard || '');
  const [center, setCenter] = useState(
    normalizeCenterName(editingEntity?.center || DEFAULT_INDIAN_CENTER)
  );
  const [department, setDepartment] = useState(
    editingEntity?.department || state.departments[0] || ''
  );
  const [designation, setDesignation] = useState(
    editingEntity?.designation || 'Field Executive (Freelancer)'
  );
  const [projectName, setProjectName] = useState(editingEntity?.projectName || '');
  const [projectNo, setProjectNo] = useState(editingEntity?.projectNo || '');
  const [eicName, setEicName] = useState(editingEntity?.eicName || '');
  const [bankName, setBankName] = useState(editingEntity?.bankName || '');
  const [bankBranch, setBankBranch] = useState(editingEntity?.bankBranch || '');
  const [bankAccountType, setBankAccountType] = useState(
    editingEntity?.bankAccountType || 'Savings'
  );
  const [bankAccountNo, setBankAccountNo] = useState(editingEntity?.bankAccountNo || '');
  const [ifscCode, setIfscCode] = useState(editingEntity?.ifscCode || '');
  const [joiningDate, setJoiningDate] = useState(editingEntity?.joiningDate || '');
  const [status, setStatus] = useState<'Active' | 'Inactive'>(editingEntity?.status || 'Active');
  const [password, setPassword] = useState('');
  const [remarks, setRemarks] = useState(editingEntity?.remarks || '');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const normalizedPreview = normalizeEntityIdInput(entityCode);

  const runCodeValidation = (raw = entityCode) => {
    if (editingEntity) return '';
    const check = validateEntityId({
      rawId: raw,
      existingEntities: entities,
      existingEmployees: state.employees,
    });
    if (!check.valid) {
      setEntityCodeError(check.error);
      return check.error;
    }
    setEntityCodeError('');
    return '';
  };

  const handleAddDepartment = async () => {
    const clean = newDeptName.trim();
    if (!clean) return;
    try {
      const res = await apiClient.createDepartment(clean);
      setDepartmentsList(res.departments);
      setDepartment(clean);
      setNewDeptName('');
      setAddingDept(false);
      onDepartmentsUpdated?.();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to create department');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const validation = validatePersonnelEntityInput({
      entityType: 'Freelancer',
      entityCode: editingEntity ? editingEntity.entityCode : entityCode,
      name,
      email,
      phone,
      aadhaarCard,
      panCard,
      existingEntities: entities,
      existingEmployees: state.employees,
      excludeEntityId: editingEntity?.id,
    });

    if (!validation.ok) {
      if (validation.errors.entityCode) setEntityCodeError(validation.errors.entityCode);
      setFormError(validation.error);
      return;
    }

    if (password.length > 0) {
      const pwErr = validatePasswordStrength(password);
      if (pwErr) {
        setFormError(pwErr);
        return;
      }
    }

    const resolvedCenter = normalizeCenterName(center.trim() || DEFAULT_INDIAN_CENTER);
    setSaving(true);
    try {
      await onSave({
        id: editingEntity?.id,
        entityCode: editingEntity ? editingEntity.entityCode : validation.normalizedCode,
        entityType: 'Freelancer',
        name: name.trim(),
        email: email.trim(),
        personalEmail: email.trim(),
        officialEmail: email.trim(),
        phone: phone.trim(),
        whatsappNo: whatsappNo.trim() || undefined,
        fatherHusbandName: fatherHusbandName.trim() || undefined,
        address: address.trim() || undefined,
        center: resolvedCenter,
        department: department.trim() || 'Operations',
        designation: designation.trim() || 'Field Executive (Freelancer)',
        isManager: false,
        aadhaarCard: aadhaarCard.trim() || undefined,
        panCard: panCard.trim().toUpperCase() || undefined,
        projectName: projectName.trim() || undefined,
        projectNo: projectNo.trim() || undefined,
        eicName: eicName.trim() || undefined,
        bankName: bankName.trim() || undefined,
        bankBranch: bankBranch.trim() || undefined,
        bankAccountType: bankAccountType.trim() || undefined,
        bankAccountNo: bankAccountNo.trim() || undefined,
        ifscCode: ifscCode.trim().toUpperCase() || undefined,
        joiningDate: joiningDate || undefined,
        status,
        remarks: remarks.trim() || undefined,
        ...(password ? { password } : {}),
      });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to save freelancer');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title={
        editingEntity
          ? `Edit Freelancer (${editingEntity.entityCode})`
          : 'New Freelancer Onboarding'
      }
      icon={<UserPlus className="w-4 h-4 text-emerald-400" />}
      headerClass={palette.modalHeader}
      maxWidth="max-w-3xl"
      onClose={onClose}
    >
      <form
        onSubmit={handleSubmit}
        noValidate
        className="p-6 overflow-y-auto flex-1 bg-white space-y-4 max-h-[82vh]"
      >
        {formError && (
          <div
            role="alert"
            className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-2"
          >
            <XCircle className="w-4 h-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        {/* Section 1: Identity & Personal Details */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label
              htmlFor="flp-code-input"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Freelancer Code / ID * (A-Z, 0-9, Max 10)
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id="flp-code-input"
                type="text"
                placeholder="e.g. KOL000001"
                autoComplete="off"
                value={entityCode}
                disabled={Boolean(editingEntity)}
                aria-required="true"
                aria-invalid={Boolean(entityCodeError)}
                onChange={(e) => {
                  const upper = e.target.value.toUpperCase();
                  setEntityCode(upper);
                  if (entityCodeError) runCodeValidation(upper);
                }}
                onBlur={() => runCodeValidation()}
                className={`w-full px-3 py-2 border rounded-lg text-xs font-mono uppercase focus:outline-none ${
                  editingEntity
                    ? 'bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed'
                    : entityCodeError
                    ? 'bg-white border-rose-500 focus:ring-1 focus:ring-rose-500'
                    : 'bg-white border-slate-300 focus:ring-2 focus:ring-emerald-600'
                }`}
              />
              {!editingEntity && normalizedPreview && !entityCodeError && (
                <span className="px-2 py-1 rounded bg-blue-50 border border-blue-200 text-[10px] font-mono font-bold text-blue-700 shrink-0">
                  {normalizedPreview}
                </span>
              )}
            </div>
            {entityCodeError && (
              <p role="alert" className="mt-1 text-[10px] font-semibold text-rose-600">
                {entityCodeError}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="flp-name-input"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Freelancer Full Name *
            </label>
            <input
              id="flp-name-input"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Freelancer full name"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="flp-father-input"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Father / Husband&apos;s Name
            </label>
            <input
              id="flp-father-input"
              type="text"
              value={fatherHusbandName}
              onChange={(e) => setFatherHusbandName(e.target.value)}
              placeholder="S/o / W/o name"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="flp-phone-input"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Mobile No. *
            </label>
            <input
              id="flp-phone-input"
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98XXXXXXXX"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="flp-whatsapp-input"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              WhatsApp No.
            </label>
            <input
              id="flp-whatsapp-input"
              type="tel"
              value={whatsappNo}
              onChange={(e) => setWhatsappNo(e.target.value)}
              placeholder="Same as mobile or alternate"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="flp-email-input"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              E-Mail ID *
            </label>
            <input
              id="flp-email-input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="freelancer@example.com"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="flp-aadhaar-input"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Aadhaar Card No.
            </label>
            <input
              id="flp-aadhaar-input"
              type="text"
              value={aadhaarCard}
              onChange={(e) => setAadhaarCard(e.target.value)}
              placeholder="12-digit Aadhaar number"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="flp-pan-input"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              PAN Card No.
            </label>
            <input
              id="flp-pan-input"
              type="text"
              value={panCard}
              onChange={(e) => setPanCard(e.target.value.toUpperCase())}
              placeholder="ABCDE1234F"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono uppercase focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Assigned Center *
            </label>
            <SearchableCenterSelect
              centers={centerOptions}
              value={center}
              onChange={setCenter}
            />
          </div>

          <div className="md:col-span-3">
            <label
              htmlFor="flp-address-input"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Residential Address
            </label>
            <textarea
              id="flp-address-input"
              rows={2}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Full residential address for IT Equipment Allotment & Undertaking form"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>
        </div>

        {/* Section 2: Project & Operational Details */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
            <Building2 className="w-4 h-4" />
            <span>Project &amp; Operational Assignment</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center justify-between">
                <span>Department</span>
                <button
                  type="button"
                  onClick={() => setAddingDept((v) => !v)}
                  className="text-emerald-700 hover:text-emerald-900 cursor-pointer flex items-center gap-0.5 text-[10px] font-bold"
                >
                  <Plus className="w-3 h-3" /> New
                </button>
              </label>
              {addingDept ? (
                <div className="flex gap-1">
                  <input
                    type="text"
                    value={newDeptName}
                    onChange={(e) => setNewDeptName(e.target.value)}
                    placeholder="Dept name"
                    className="flex-1 px-2 py-1.5 bg-white border border-slate-300 rounded text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleAddDepartment}
                    className="px-2 py-1 bg-emerald-700 text-white rounded text-xs font-bold cursor-pointer"
                  >
                    Add
                  </button>
                </div>
              ) : (
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
                >
                  <option value="">-- Select Department --</option>
                  {departmentsList.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Role / Designation
              </label>
              <input
                type="text"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'Active' | 'Inactive')}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
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
                placeholder="e.g. Retail Census Study"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Project No. / Job Number
              </label>
              <input
                type="text"
                value={projectNo}
                onChange={(e) => setProjectNo(e.target.value)}
                placeholder="e.g. JOB-2026-102"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono focus:outline-none"
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
        </div>

        {/* Section 3: Bank & KYC Settlement Details (per Biodata Form) */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
            <Landmark className="w-4 h-4 text-emerald-700" />
            <span>Bank &amp; Settlement Details</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Bank Name
              </label>
              <input
                type="text"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="e.g. State Bank of India"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Branch
              </label>
              <input
                type="text"
                value={bankBranch}
                onChange={(e) => setBankBranch(e.target.value)}
                placeholder="Branch location"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Type of A/c
              </label>
              <select
                value={bankAccountType}
                onChange={(e) => setBankAccountType(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
              >
                <option value="Savings">Savings</option>
                <option value="Current">Current</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Account No.
              </label>
              <input
                type="text"
                value={bankAccountNo}
                onChange={(e) => setBankAccountNo(e.target.value)}
                placeholder="Bank account number"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                IFSC Code
              </label>
              <input
                type="text"
                value={ifscCode}
                onChange={(e) => setIfscCode(e.target.value.toUpperCase())}
                placeholder="e.g. SBIN0001234"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono uppercase focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Section 4: Portal Credentials, Date & Remarks */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Joining Date
            </label>
            <input
              type="date"
              value={joiningDate}
              onChange={(e) => setJoiningDate(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>

          <div className="md:col-span-2">
            <label
              htmlFor="flp-password-input"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              {editingEntity ? 'Reset Portal Password (Optional)' : 'Portal Login Password (Optional)'}
            </label>
            <input
              id="flp-password-input"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (formError) setFormError('');
              }}
              placeholder="Set password to enable Freelancer portal login (min 8 chars)"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>

          <div className="md:col-span-3">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Remarks
            </label>
            <textarea
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Onboarding notes, fieldwork territory, or reference"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>
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
            disabled={saving}
            className={`${palette.primaryBtn} ${palette.primaryBtnHover} disabled:opacity-50 px-6 py-2 rounded-lg text-xs font-semibold shadow-md flex items-center gap-1.5 cursor-pointer`}
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving...' : editingEntity ? 'Save Freelancer' : 'Register Freelancer'}</span>
          </button>
        </div>
      </form>
    </ModalShell>
  );
};
