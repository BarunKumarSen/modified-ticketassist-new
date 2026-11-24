import React, { useEffect, useState } from 'react';
import { Save, ShieldCheck, UserPlus, XCircle } from 'lucide-react';
import type {
  AssetOSState,
  PersonnelEntity,
  PersonnelEntityType,
} from '../types/asset';
import type { EmployeeCenterRecord } from '../types/policy';
import { apiClient, ApiError } from '../api/client';
import { useSession } from '../auth/SessionContext';
import { DEFAULT_INDIAN_CENTER, INDIAN_CENTERS, normalizeCenterName } from '../data/indianCenters';
import { THEME_PALETTES } from '../utils/assetMath';
import {
  ENTITY_MODULE_META,
  normalizeEntityIdInput,
  validateEntityId,
  validatePersonnelEntityInput,
} from '../utils/entityValidation';
import { canModifyManagerFields } from '../utils/hierarchyLogic';
import { ModalShell } from './AssetModals';
import { SearchableCenterSelect } from './SearchableCenterSelect';

interface PersonnelEntityModalProps {
  entityType: PersonnelEntityType;
  state: AssetOSState;
  centers?: EmployeeCenterRecord[];
  editingEntity?: PersonnelEntity;
  onClose: () => void;
  onSave: (
    payload: Omit<PersonnelEntity, 'id' | 'createdAt'> & { id?: string; password?: string }
  ) => Promise<void> | void;
}

export const PersonnelEntityModal: React.FC<PersonnelEntityModalProps> = ({
  entityType,
  state,
  centers,
  editingEntity,
  onClose,
  onSave,
}) => {
  const { session } = useSession();
  const isAdmin = canModifyManagerFields(session);
  const palette = THEME_PALETTES[state.settings.theme];
  const meta = ENTITY_MODULE_META[entityType];
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

  const [departmentsList, setDepartmentsList] = useState<string[]>(state.departments || ['Research']);

  useEffect(() => {
    let active = true;
    apiClient
      .listDepartments()
      .then((res) => {
        if (active && res.departments.length > 0) setDepartmentsList(res.departments);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const [entityCode, setEntityCode] = useState(editingEntity?.entityCode || '');
  const [entityCodeError, setEntityCodeError] = useState('');
  const [name, setName] = useState(editingEntity?.name || '');
  const [email, setEmail] = useState(editingEntity?.email || '');
  const [phone, setPhone] = useState(editingEntity?.phone || '');
  const [center, setCenter] = useState(
    normalizeCenterName(editingEntity?.center || DEFAULT_INDIAN_CENTER)
  );
  const [department, setDepartment] = useState(
    editingEntity?.department || state.departments[0] || 'Research'
  );
  const [designation, setDesignation] = useState(
    editingEntity?.designation || meta.singularLabel
  );
  const [isManager, setIsManager] = useState(Boolean(editingEntity?.isManager));
  const [joiningDate, setJoiningDate] = useState(editingEntity?.joiningDate || '');
  const [status, setStatus] = useState<'Active' | 'Inactive'>(editingEntity?.status || 'Active');
  const [address, setAddress] = useState(editingEntity?.address || '');
  const [remarks, setRemarks] = useState(editingEntity?.remarks || '');
  const [password, setPassword] = useState('');
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const validation = validatePersonnelEntityInput({
      entityType,
      entityCode: editingEntity ? editingEntity.entityCode : entityCode,
      name,
      email,
      phone,
      existingEntities: entities,
      existingEmployees: state.employees,
      excludeEntityId: editingEntity?.id,
    });

    if (!validation.ok) {
      if (validation.errors.entityCode) setEntityCodeError(validation.errors.entityCode);
      setFormError(validation.error);
      return;
    }

    const resolvedCenter = normalizeCenterName(center.trim() || DEFAULT_INDIAN_CENTER);
    setSaving(true);
    try {
      await onSave({
        id: editingEntity?.id,
        entityCode: editingEntity ? editingEntity.entityCode : validation.normalizedCode,
        entityType,
        name: name.trim(),
        email: email.trim(),
        personalEmail: email.trim(),
        officialEmail: email.trim(),
        phone: phone.trim(),
        center: resolvedCenter,
        department: department.trim() || 'Research',
        designation: designation.trim() || meta.singularLabel,
        isManager: entityType === 'Consultant' && isAdmin ? isManager : Boolean(editingEntity?.isManager),
        joiningDate: joiningDate || undefined,
        status,
        address: address.trim() || undefined,
        remarks: remarks.trim() || undefined,
        ...(password ? { password } : {}),
      });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : `Failed to save ${meta.singularLabel}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title={
        editingEntity
          ? `Edit ${meta.singularLabel} (${editingEntity.entityCode})`
          : `New ${meta.singularLabel}`
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label
              htmlFor="entity-code-input"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              {meta.idLabel} * (A-Z, 0-9, Max 10)
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id="entity-code-input"
                type="text"
                placeholder={meta.idPlaceholder}
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
              htmlFor="entity-name-input"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Full Name *
            </label>
            <input
              id="entity-name-input"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`Enter ${meta.singularLabel.toLowerCase()} name`}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="entity-email-input"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Email ID *
            </label>
            <input
              id="entity-email-input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@medianresearch.in"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="entity-phone-input"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Mobile Number
            </label>
            <input
              id="entity-phone-input"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98XXXXXXXX"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
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

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Department
            </label>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            >
              {departmentsList.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Designation / Title
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
              Joining Date
            </label>
            <input
              type="date"
              value={joiningDate}
              onChange={(e) => setJoiningDate(e.target.value)}
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
        </div>

        {entityType === 'Consultant' && (
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-700" />
                <span>Consultant Manager Privilege</span>
              </p>
              <p className="text-[11px] text-slate-600 mt-0.5">
                Grants team-building, sub-assignment, and leave approval authority while keeping primary category strictly as <strong>Consultant</strong>.
              </p>
            </div>
            {isAdmin ? (
              <div className="flex items-center gap-3 shrink-0">
                <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-800 cursor-pointer">
                  <input
                    type="radio"
                    name="consultant-is-manager"
                    checked={!isManager}
                    onChange={() => setIsManager(false)}
                    className="accent-emerald-700"
                  />
                  <span>Standard Consultant</span>
                </label>
                <label className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800 cursor-pointer">
                  <input
                    type="radio"
                    name="consultant-is-manager"
                    checked={isManager}
                    onChange={() => setIsManager(true)}
                    className="accent-emerald-700"
                  />
                  <span>Manager Enabled</span>
                </label>
              </div>
            ) : (
              <span className="text-xs font-semibold text-slate-500">
                {isManager ? 'Manager Enabled' : 'Standard Consultant'} (Admin controlled)
              </span>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="entity-password-input"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              {editingEntity ? 'Reset Portal Password (Optional)' : 'Portal Login Password (Optional)'}
            </label>
            <input
              id="entity-password-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Set password to enable portal sign-in (min 8 chars)"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Address / Location Note
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="City or work address"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
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
            placeholder="Engagement scope or notes"
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
            disabled={saving}
            className={`${palette.primaryBtn} ${palette.primaryBtnHover} disabled:opacity-50 px-6 py-2 rounded-lg text-xs font-semibold shadow-md flex items-center gap-1.5 cursor-pointer`}
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving...' : 'Save'}</span>
          </button>
        </div>
      </form>
    </ModalShell>
  );
};
