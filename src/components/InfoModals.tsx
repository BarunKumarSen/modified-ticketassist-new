import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Banknote,
  CheckCircle2,
  FileSpreadsheet,
  History,
  Info,
  Mail,
  Plus,
  Save,
  ShieldCheck,
  Store,
  UserPlus,
  XCircle,
} from 'lucide-react';
import {
  ALL_EMPLOYMENT_CATEGORIES,
  type AssetOSState,
  type BulkDirectoryImportResult,
  type BulkEmployeeImportResult,
  type DepartmentDesignation,
  type Employee,
  type EmploymentCategory,
  type ExpenseRecord,
  type ThemePalette,
  type ToastMessage,
  type Vendor,
} from '../types/asset';
import type { RoleRecord, SessionUser } from '../types/user';
import {
  PERMISSION_DEFINITIONS,
  PREDEFINED_ROLES,
  resolveEffectivePermissions,
  type PermissionName,
} from '../auth/permissions';
import {
  THEME_PALETTES,
  extractFiveDigitEmployeeCode,
  formatFiveDigitEmployeeId,
  validateFiveDigitEmployeeId,
} from '../utils/assetMath';
import {
  type SystemUserValidationErrors,
} from '../auth/authLogic';
import { apiClient, ApiError } from '../api/client';
import { useSession } from '../auth/SessionContext';
import { DEFAULT_INDIAN_CENTER, INDIAN_CENTERS, normalizeCenterName } from '../data/indianCenters';
import type { EmployeeCenterRecord } from '../types/policy';
import { canModifyManagerFields } from '../utils/hierarchyLogic';
import { ModalShell } from './AssetModals';
import { SearchableCenterSelect } from './SearchableCenterSelect';

/* EMPLOYEE FORM MODAL */
export const EmployeeFormModal: React.FC<{
  state: AssetOSState;
  centers?: EmployeeCenterRecord[];
  editingEmployee?: Employee;
  onClose: () => void;
  onSave: (
    emp: Omit<Employee, 'id'> & { id?: string; password?: string }
  ) => Promise<void> | void;
  onDepartmentsUpdated?: () => void;
}> = ({ state, centers, editingEmployee, onClose, onSave, onDepartmentsUpdated }) => {
  const { session, hasPermission } = useSession();
  const isAdmin = canModifyManagerFields(session);
  const canCreateMasterData = isAdmin || hasPermission('role.manage');
  const palette = THEME_PALETTES[state.settings.theme];

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

  const availableManagers = state.employees
    .filter((e) => e.isManager && e.status === 'Active' && e.id !== editingEmployee?.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  const [departmentsList, setDepartmentsList] = useState<string[]>(state.departments || ['IT']);
  const [designationsList, setDesignationsList] = useState<DepartmentDesignation[]>(
    state.designations || []
  );
  const [addingDept, setAddingDept] = useState(false);
  const [newDeptName, setNewDeptName] = useState('');
  const [addingDesig, setAddingDesig] = useState(false);
  const [newDesigName, setNewDesigName] = useState('');

  useEffect(() => {
    let active = true;
    apiClient
      .listDepartments()
      .then((res) => {
        if (!active) return;
        if (res.departments.length > 0) setDepartmentsList(res.departments);
        setDesignationsList(res.designations || []);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const [employeeId, setEmployeeId] = useState(
    editingEmployee
      ? extractFiveDigitEmployeeCode(editingEmployee.employeeId || '') || editingEmployee.employeeId || ''
      : ''
  );
  const [employeeIdError, setEmployeeIdError] = useState('');
  const [name, setName] = useState(editingEmployee?.name || '');
  const [phone, setPhone] = useState(editingEmployee?.phone || '');
  const [personalEmail, setPersonalEmail] = useState(
    editingEmployee?.personalEmail || editingEmployee?.email || ''
  );
  const [officialEmail, setOfficialEmail] = useState(
    editingEmployee?.officialEmail || editingEmployee?.email || ''
  );
  const [personalEmailVerified, setPersonalEmailVerified] = useState<boolean>(
    Boolean(editingEmployee?.personalEmailVerified ?? editingEmployee?.email)
  );
  const [officialEmailVerified, setOfficialEmailVerified] = useState<boolean>(
    Boolean(editingEmployee?.officialEmailVerified ?? editingEmployee?.email)
  );
  const [verifyingKind, setVerifyingKind] = useState<'personal' | 'official' | null>(null);
  const [department, setDepartment] = useState(
    editingEmployee?.department || state.departments[0] || 'IT'
  );
  const [designation, setDesignation] = useState(editingEmployee?.designation || '');
  const [panCard, setPanCard] = useState(editingEmployee?.panCard || '');
  const [voterIdCard, setVoterIdCard] = useState(editingEmployee?.voterIdCard || '');
  const [aadhaarCard, setAadhaarCard] = useState(editingEmployee?.aadhaarCard || '');
  const [uanNumber, setUanNumber] = useState(editingEmployee?.uanNumber || '');
  const [password, setPassword] = useState('');
  const [leaveCarryForward, setLeaveCarryForward] = useState(
    String(editingEmployee?.leaveCarryForward ?? 0)
  );

  const [center, setCenter] = useState(
    normalizeCenterName(editingEmployee?.center || editingEmployee?.branch || DEFAULT_INDIAN_CENTER)
  );
  const [isManager, setIsManager] = useState<boolean>(Boolean(editingEmployee?.isManager));
  const [reportingManagerId, setReportingManagerId] = useState(
    editingEmployee?.reportingManagerId || ''
  );
  const [reportingManagerName, setReportingManagerName] = useState(
    editingEmployee?.reportingManagerName || ''
  );
  const [reportingManagerEmail, setReportingManagerEmail] = useState(
    editingEmployee?.reportingManagerEmail || ''
  );
  const [managerEmailError, setManagerEmailError] = useState('');
  const [joiningDate, setJoiningDate] = useState(editingEmployee?.joiningDate || '');
  const [status, setStatus] = useState<'Active' | 'Inactive'>(
    editingEmployee?.status || 'Active'
  );
  const [address, setAddress] = useState(editingEmployee?.address || '');
  const [remarks, setRemarks] = useState(editingEmployee?.remarks || '');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const deptDesignationOptions = useMemo(() => {
    const names = designationsList
      .filter((d) => d.departmentName.toLowerCase() === department.toLowerCase())
      .map((d) => d.designationName);
    if (designation && !names.some((n) => n.toLowerCase() === designation.toLowerCase())) {
      names.unshift(designation);
    }
    return Array.from(new Set(names));
  }, [designationsList, department, designation]);

  useEffect(() => {
    if (!editingEmployee && !designation && deptDesignationOptions.length > 0) {
      setDesignation(deptDesignationOptions[0]);
    }
  }, [deptDesignationOptions, designation, editingEmployee]);

  const fiveDigitCode = extractFiveDigitEmployeeCode(employeeId);
  const previewFormattedId = fiveDigitCode ? `EMP-${fiveDigitCode}` : '';

  const runEmployeeIdValidation = () => {
    if (editingEmployee) return '';
    const err = validateFiveDigitEmployeeId(employeeId, state.employees);
    setEmployeeIdError(err);
    return err;
  };

  const handleVerifyEmail = async (kind: 'personal' | 'official') => {
    const targetEmail = (kind === 'personal' ? personalEmail : officialEmail).trim();
    if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
      setFormError(`Please enter a valid ${kind === 'personal' ? 'Personal' : 'Official'} Email ID first.`);
      return;
    }
    setFormError('');
    setVerifyingKind(kind);
    try {
      await apiClient.verifyEmployeeEmail(targetEmail, kind, false);
      if (kind === 'personal') setPersonalEmailVerified(true);
      else setOfficialEmailVerified(true);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Email verification failed');
    } finally {
      setVerifyingKind(null);
    }
  };

  const handleAddDepartment = async () => {
    const clean = newDeptName.trim();
    if (!clean) return;
    try {
      const res = await apiClient.createDepartment(clean);
      setDepartmentsList(res.departments);
      setDesignationsList(res.designations);
      setDepartment(clean);
      setDesignation('');
      setNewDeptName('');
      setAddingDept(false);
      onDepartmentsUpdated?.();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to create department');
    }
  };

  const handleAddDesignation = async () => {
    const clean = newDesigName.trim();
    if (!clean || !department.trim()) return;
    try {
      const res = await apiClient.createDesignation(department, clean);
      setDepartmentsList(res.departments);
      setDesignationsList(res.designations);
      setDesignation(res.designation.designationName);
      setNewDesigName('');
      setAddingDesig(false);
      onDepartmentsUpdated?.();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to create designation');
    }
  };

  const handleReportingManagerSelect = (mgrId: string) => {
    setReportingManagerId(mgrId);
    if (!mgrId) {
      setReportingManagerName('');
      setReportingManagerEmail('');
      setManagerEmailError('');
      return;
    }
    const mgr = state.employees.find((e) => e.id === mgrId);
    if (mgr) {
      setReportingManagerName(mgr.name);
      setReportingManagerEmail(mgr.email);
      setManagerEmailError('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const idError = runEmployeeIdValidation();
    if (idError) {
      setFormError(idError);
      return;
    }
    if (!name.trim() || !phone.trim() || !designation.trim()) {
      setFormError('Employee Name, Mobile Number, and Designation are required.');
      return;
    }
    if (!personalEmail.trim() || !officialEmail.trim()) {
      setFormError('Both Personal Email ID and Official Email ID are mandatory.');
      return;
    }
    if (!editingEmployee && (!personalEmailVerified || !officialEmailVerified)) {
      setFormError('Please verify both Personal Email ID and Official Email ID before saving.');
      return;
    }
    if (!editingEmployee && (!panCard.trim() || !voterIdCard.trim() || !aadhaarCard.trim() || !password)) {
      setFormError('PAN Card, Voter ID Card, Aadhaar Card, and Login Password are mandatory.');
      return;
    }

    const trimmedMgrEmail = reportingManagerEmail.trim();
    if (trimmedMgrEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedMgrEmail)) {
      setManagerEmailError('Please enter a valid Reporting Manager email address.');
      return;
    }
    setManagerEmailError('');
    const resolvedCenter = normalizeCenterName(center.trim() || DEFAULT_INDIAN_CENTER);
    setSaving(true);
    try {
      await onSave({
        id: editingEmployee?.id,
        employeeId: editingEmployee
          ? editingEmployee.employeeId
          : formatFiveDigitEmployeeId(employeeId),
        name: name.trim(),
        phone: phone.trim(),
        email: officialEmail.trim(),
        personalEmail: personalEmail.trim(),
        officialEmail: officialEmail.trim(),
        personalEmailVerified,
        officialEmailVerified,
        uanNumber: uanNumber.trim(),
        panCard: panCard.trim().toUpperCase(),
        voterIdCard: voterIdCard.trim().toUpperCase(),
        aadhaarCard: aadhaarCard.trim(),
        leaveCarryForward: Math.max(0, Math.min(44, Number(leaveCarryForward) || 0)),
        ...(password ? { password } : {}),
        department,
        designation: designation.trim(),
        branch: resolvedCenter,
        center: resolvedCenter,
        isManager: isAdmin ? isManager : editingEmployee?.isManager,
        reportingManagerId: isAdmin ? reportingManagerId : editingEmployee?.reportingManagerId,
        reportingManagerName: reportingManagerName.trim(),
        reportingManagerEmail: trimmedMgrEmail,
        joiningDate,
        status,
        address,
        remarks,
      });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to save employee');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title={editingEmployee ? `Edit Employee (${editingEmployee.employeeId})` : 'New Employee'}
      icon={<UserPlus className="w-4 h-4 text-emerald-400" />}
      headerClass={palette.modalHeader}
      maxWidth="max-w-3xl"
      onClose={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onInvalidCapture={() => {
          runEmployeeIdValidation();
        }}
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
              htmlFor="employee-id-input"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              5-Digit Employee ID *
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id="employee-id-input"
                type="text"
                placeholder="5-digit code (e.g. 54321)"
                autoComplete="off"
                value={employeeId}
                disabled={Boolean(editingEmployee)}
                aria-required="true"
                aria-invalid={Boolean(employeeIdError)}
                aria-describedby={
                  employeeIdError
                    ? 'employee-id-error'
                    : editingEmployee
                    ? 'employee-id-note'
                    : undefined
                }
                onChange={(e) => {
                  const val = e.target.value;
                  setEmployeeId(val);
                  if (employeeIdError) setEmployeeIdError('');
                }}
                onBlur={runEmployeeIdValidation}
                className={`w-full px-3 py-2 border rounded-lg text-xs font-mono focus:outline-none ${
                  editingEmployee
                    ? 'bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed'
                    : employeeIdError
                    ? 'bg-white border-rose-500 focus:ring-1 focus:ring-rose-500'
                    : 'bg-white border-slate-300'
                }`}
              />
              {!editingEmployee && previewFormattedId && (
                <span className="px-2 py-1 rounded bg-amber-50 border border-amber-200 text-[10px] font-mono font-bold text-amber-800 shrink-0">
                  {previewFormattedId}
                </span>
              )}
            </div>
            {editingEmployee && (
              <p id="employee-id-note" className="mt-1 text-[10px] text-slate-500">
                Employee ID cannot be changed after creation.
              </p>
            )}
            {employeeIdError && (
              <p id="employee-id-error" role="alert" className="mt-1 text-[10px] font-semibold text-rose-600">
                {employeeIdError}
              </p>
            )}
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Employee Name *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Mobile Number *
            </label>
            <input
              type="text"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>

          {/* Personal Email ID + Verify */}
          <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Personal Email ID *
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="email"
                  required
                  value={personalEmail}
                  onChange={(e) => {
                    setPersonalEmail(e.target.value);
                    setPersonalEmailVerified(false);
                  }}
                  placeholder="personal@example.com"
                  className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
                />
                <button
                  type="button"
                  disabled={verifyingKind === 'personal' || personalEmailVerified}
                  onClick={() => void handleVerifyEmail('personal')}
                  className={`px-2.5 py-2 rounded-lg text-[10px] font-bold flex items-center gap-1 shrink-0 cursor-pointer ${
                    personalEmailVerified
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200 cursor-default'
                      : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200'
                  }`}
                >
                  <ShieldCheck className="w-3 h-3" />
                  <span>{personalEmailVerified ? 'Verified' : verifyingKind === 'personal' ? 'Verifying...' : 'Verify'}</span>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Official Email ID *
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="email"
                  required
                  value={officialEmail}
                  onChange={(e) => {
                    setOfficialEmail(e.target.value);
                    setOfficialEmailVerified(false);
                  }}
                  placeholder="name@medianresearch.com"
                  className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
                />
                <button
                  type="button"
                  disabled={verifyingKind === 'official' || officialEmailVerified}
                  onClick={() => void handleVerifyEmail('official')}
                  className={`px-2.5 py-2 rounded-lg text-[10px] font-bold flex items-center gap-1 shrink-0 cursor-pointer ${
                    officialEmailVerified
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200 cursor-default'
                      : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200'
                  }`}
                >
                  <ShieldCheck className="w-3 h-3" />
                  <span>{officialEmailVerified ? 'Verified' : verifyingKind === 'official' ? 'Verifying...' : 'Verify'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Dynamic Department + Designation */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Department *
              </label>
              {canCreateMasterData && (
                <button
                  type="button"
                  onClick={() => setAddingDept((prev) => !prev)}
                  className="text-[10px] font-bold text-emerald-700 hover:underline flex items-center gap-0.5 cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> New Dept
                </button>
              )}
            </div>
            {addingDept ? (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={newDeptName}
                  onChange={(e) => setNewDeptName(e.target.value)}
                  placeholder="Department name"
                  className="flex-1 px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs"
                />
                <button
                  type="button"
                  onClick={() => void handleAddDepartment()}
                  className="px-2.5 py-2 bg-[#3f3f46] text-white rounded-lg text-[10px] font-bold cursor-pointer"
                >
                  Add
                </button>
              </div>
            ) : (
              <select
                value={department}
                onChange={(e) => {
                  setDepartment(e.target.value);
                  setDesignation('');
                }}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
              >
                {departmentsList.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Designation *
              </label>
              {canCreateMasterData && (
                <button
                  type="button"
                  onClick={() => setAddingDesig((prev) => !prev)}
                  className="text-[10px] font-bold text-emerald-700 hover:underline flex items-center gap-0.5 cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> New Designation
                </button>
              )}
            </div>
            {addingDesig ? (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={newDesigName}
                  onChange={(e) => setNewDesigName(e.target.value)}
                  placeholder="Designation title"
                  className="flex-1 px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs"
                />
                <button
                  type="button"
                  onClick={() => void handleAddDesignation()}
                  className="px-2.5 py-2 bg-[#3f3f46] text-white rounded-lg text-[10px] font-bold cursor-pointer"
                >
                  Add
                </button>
              </div>
            ) : deptDesignationOptions.length > 0 ? (
              <select
                value={designation}
                required
                onChange={(e) => setDesignation(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
              >
                <option value="">-- Select Designation --</option>
                {deptDesignationOptions.map((des) => (
                  <option key={des} value={des}>
                    {des}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                required
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                placeholder="Enter designation"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
              />
            )}
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              {editingEmployee ? 'Login Password (Optional)' : 'Login Password *'}
            </label>
            <input
              type="password"
              required={!editingEmployee}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={editingEmployee ? 'Leave blank to keep existing' : 'Min 8 chars, mixed case + digit'}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
            />
          </div>

          {/* KYC + UAN + Carry-forward */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              PAN Card {!editingEmployee && '*'}
            </label>
            <input
              type="text"
              required={!editingEmployee}
              value={panCard}
              onChange={(e) => setPanCard(e.target.value.toUpperCase())}
              placeholder="e.g. ABCDE1234F"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono uppercase focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Voter ID Card {!editingEmployee && '*'}
            </label>
            <input
              type="text"
              required={!editingEmployee}
              value={voterIdCard}
              onChange={(e) => setVoterIdCard(e.target.value.toUpperCase())}
              placeholder="e.g. XYZ1234567"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono uppercase focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Aadhaar Card {!editingEmployee && '*'}
            </label>
            <input
              type="text"
              required={!editingEmployee}
              value={aadhaarCard}
              onChange={(e) => setAadhaarCard(e.target.value)}
              placeholder="12-digit Aadhaar number"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              UAN Number (Optional)
            </label>
            <input
              type="text"
              value={uanNumber}
              onChange={(e) => setUanNumber(e.target.value)}
              placeholder="Optional 12-digit UAN"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Leave Carry-Forward (Max 44)
            </label>
            <input
              type="number"
              min={0}
              max={44}
              value={leaveCarryForward}
              onChange={(e) => setLeaveCarryForward(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono focus:outline-none"
            />
          </div>
          <div className="md:col-span-2">
            <label
              htmlFor="employee-center-select"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Employee Center (Indian City) *
            </label>
            <SearchableCenterSelect
              id="employee-center-select"
              ariaLabel="Employee Center"
              centers={centerOptions}
              value={center}
              onChange={setCenter}
              required
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
              Employee Status
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
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Is Manager?
            </span>
            <div
              role="radiogroup"
              aria-label="Is Manager?"
              className={`flex items-center gap-4 px-3 py-2 rounded-lg border text-xs ${
                isAdmin ? 'bg-white border-slate-300' : 'bg-slate-100 border-slate-200 text-slate-500'
              }`}
            >
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="employee-is-manager"
                  checked={isManager === true}
                  disabled={!isAdmin}
                  onChange={() => setIsManager(true)}
                />
                <span className="font-semibold">Yes</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="employee-is-manager"
                  checked={isManager === false}
                  disabled={!isAdmin}
                  onChange={() => setIsManager(false)}
                />
                <span className="font-semibold">No</span>
              </label>
            </div>
            {!isAdmin && (
              <p className="mt-1 text-[10px] text-slate-500">Admin-only field</p>
            )}
          </div>

          <div className="md:col-span-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label
                htmlFor="employee-reporting-manager-select"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1"
              >
                Reporting Manager
              </label>
              <select
                id="employee-reporting-manager-select"
                value={reportingManagerId}
                disabled={!isAdmin}
                onChange={(e) => handleReportingManagerSelect(e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg text-xs focus:outline-none ${
                  isAdmin
                    ? 'bg-white border-slate-300'
                    : 'bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed'
                }`}
              >
                <option value="">-- Choose Reporting Manager --</option>
                {availableManagers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.employeeId} · {m.department})
                  </option>
                ))}
              </select>
              {!isAdmin && (
                <p className="mt-1 text-[10px] text-slate-500">
                  Only Administrators can change Reporting Manager mapping.
                </p>
              )}
            </div>
            <div>
              <label
                htmlFor="employee-manager-name"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Reporting Manager Name
              </label>
              <input
                id="employee-manager-name"
                type="text"
                value={reportingManagerName}
                readOnly={Boolean(reportingManagerId) || !isAdmin}
                onChange={(e) => setReportingManagerName(e.target.value)}
                placeholder="Auto-filled from selected manager"
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="employee-manager-email"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Reporting Manager Email
              </label>
              <input
                id="employee-manager-email"
                type="email"
                value={reportingManagerEmail}
                readOnly={Boolean(reportingManagerId) || !isAdmin}
                onChange={(e) => {
                  setReportingManagerEmail(e.target.value);
                  if (managerEmailError) setManagerEmailError('');
                }}
                placeholder="manager@medianresearch.com"
                className={`w-full px-3 py-2 bg-white border rounded-lg text-xs focus:outline-none ${
                  managerEmailError ? 'border-rose-500' : 'border-slate-300'
                }`}
              />
              {managerEmailError && (
                <p role="alert" className="mt-1 text-[10px] font-semibold text-rose-600">
                  {managerEmailError}
                </p>
              )}
            </div>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Address
          </label>
          <textarea
            rows={1}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Remarks
          </label>
          <textarea
            rows={1}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
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
            className={`${palette.primaryBtn} ${palette.primaryBtnHover} px-6 py-2 rounded-lg text-xs font-semibold shadow-md flex items-center gap-1.5 cursor-pointer disabled:opacity-50`}
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving...' : 'Save'}</span>
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

/* VENDOR FORM MODAL */
export const VendorFormModal: React.FC<{
  state: AssetOSState;
  editingVendor?: Vendor;
  onClose: () => void;
  onSave: (v: Omit<Vendor, 'id'> & { id: string }) => Promise<void> | void;
}> = ({ state, editingVendor, onClose, onSave }) => {
  const palette = THEME_PALETTES[state.settings.theme];
  const [vendorCode, setVendorCode] = useState(editingVendor?.id || '');
  const [name, setName] = useState(editingVendor?.name || '');
  const [contactPerson, setContactPerson] = useState(editingVendor?.contactPerson || '');
  const [phone, setPhone] = useState(editingVendor?.phone || '');
  const [email, setEmail] = useState(editingVendor?.email || '');
  const [gst, setGst] = useState(editingVendor?.gst || '');
  const [address, setAddress] = useState(editingVendor?.address || '');
  const [remarks, setRemarks] = useState(editingVendor?.remarks || '');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const normalizedCode = vendorCode.trim().toUpperCase();
    if (!normalizedCode) {
      setFormError('Vendor Code is required.');
      return;
    }
    if (!/^[A-Z0-9_-]{2,24}$/.test(normalizedCode)) {
      setFormError('Vendor Code must be 2-24 characters (A-Z, 0-9, -, _).');
      return;
    }
    if (
      !editingVendor &&
      state.vendors.some((v) => v.id.trim().toUpperCase() === normalizedCode)
    ) {
      setFormError(`Vendor Code "${normalizedCode}" already exists. Enter a unique code.`);
      return;
    }
    if (!name.trim() || !phone.trim()) {
      setFormError('Vendor Name and Mobile number are required.');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        id: editingVendor ? editingVendor.id : normalizedCode,
        name: name.trim(),
        contactPerson: contactPerson.trim(),
        phone: phone.trim(),
        email: email.trim(),
        gst: gst.trim(),
        address: address.trim(),
        remarks: remarks.trim(),
      });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to save vendor.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title={editingVendor ? `Edit Vendor (${editingVendor.id})` : 'New Vendor'}
      icon={<Store className="w-4 h-4 text-emerald-400" />}
      headerClass={palette.modalHeader}
      maxWidth="max-w-2xl"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-4 bg-white dark:bg-slate-900">
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
              htmlFor="vendor-code-input"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1"
            >
              Vendor Code *
            </label>
            <input
              id="vendor-code-input"
              type="text"
              required
              disabled={Boolean(editingVendor)}
              value={vendorCode}
              onChange={(e) => {
                setVendorCode(e.target.value.toUpperCase());
                if (formError) setFormError('');
              }}
              placeholder="e.g. VND-001"
              className={`w-full px-3 py-2 border rounded-lg text-xs font-mono uppercase focus:outline-none ${
                editingVendor
                  ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 cursor-not-allowed'
                  : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 dark:text-slate-100'
              }`}
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
              Vendor Name *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-xs dark:text-slate-100 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
              Contact Person
            </label>
            <input
              type="text"
              value={contactPerson}
              onChange={(e) => setContactPerson(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-xs dark:text-slate-100 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
              Mobile *
            </label>
            <input
              type="text"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-xs dark:text-slate-100 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-xs dark:text-slate-100 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
              GST Number
            </label>
            <input
              type="text"
              value={gst}
              onChange={(e) => setGst(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-xs dark:text-slate-100 focus:outline-none"
            />
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
            Address
          </label>
          <textarea
            rows={2}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-xs dark:text-slate-100 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
            Remarks
          </label>
          <textarea
            rows={1}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-xs dark:text-slate-100 focus:outline-none"
          />
        </div>
        <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className={`${palette.primaryBtn} ${palette.primaryBtnHover} px-6 py-2 rounded-lg text-xs font-semibold shadow-md cursor-pointer disabled:opacity-50`}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

/* EXPENSE FORM MODAL */
export const ExpenseFormModal: React.FC<{
  state: AssetOSState;
  editingExpense?: ExpenseRecord;
  onClose: () => void;
  onSave: (exp: Omit<ExpenseRecord, 'id'> & { id: string }) => Promise<void> | void;
}> = ({ state, editingExpense, onClose, onSave }) => {
  const palette = THEME_PALETTES[state.settings.theme];
  const today = new Date().toISOString().split('T')[0];

  const categoryOptions = useMemo(() => {
    const active = (state.expenseCategories || []).filter((c) => c.active).map((c) => c.name);
    const list = active.length > 0 ? active : ['Repair', 'Fuel', 'Insurance', 'Rental', 'Misc'];
    if (editingExpense?.category && !list.includes(editingExpense.category)) {
      return [editingExpense.category, ...list];
    }
    return list;
  }, [state.expenseCategories, editingExpense]);

  const paymentModeOptions = useMemo(() => {
    const active = (state.paymentModes || []).filter((m) => m.active).map((m) => m.name);
    const list = active.length > 0 ? active : ['Cash', 'Bank Transfer', 'Credit Card', 'Cheque'];
    if (editingExpense?.mode && !list.includes(editingExpense.mode)) {
      return [editingExpense.mode, ...list];
    }
    return list;
  }, [state.paymentModes, editingExpense]);

  const [expenseNo, setExpenseNo] = useState(editingExpense?.id || '');
  const [date, setDate] = useState(editingExpense?.date || today);
  const [category, setCategory] = useState<string>(
    editingExpense?.category || categoryOptions[0] || 'Repair'
  );
  const [paidTo, setPaidTo] = useState(editingExpense?.paidTo || '');
  const [amount, setAmount] = useState(editingExpense ? String(editingExpense.amount) : '');
  const [mode, setMode] = useState<string>(
    editingExpense?.mode || paymentModeOptions[0] || 'Cash'
  );
  const [remarks, setRemarks] = useState(editingExpense?.remarks || '');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const normalizedNo = expenseNo.trim().toUpperCase();
    if (!normalizedNo) {
      setFormError('Expense Number is required.');
      return;
    }
    if (!/^[A-Z0-9_-]{2,24}$/.test(normalizedNo)) {
      setFormError('Expense Number must be 2-24 characters (A-Z, 0-9, -, _).');
      return;
    }
    if (
      !editingExpense &&
      state.expenses.some((ex) => ex.id.trim().toUpperCase() === normalizedNo)
    ) {
      setFormError(`Expense Number "${normalizedNo}" already exists. Enter a unique number.`);
      return;
    }
    if (!paidTo.trim() || !amount) {
      setFormError('Paid To and Amount are required.');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        id: editingExpense ? editingExpense.id : normalizedNo,
        date,
        category,
        paidTo: paidTo.trim(),
        amount: parseFloat(amount) || 0,
        mode,
        remarks: remarks.trim(),
      });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to save expense.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title={editingExpense ? `Edit Expense (${editingExpense.id})` : 'New Expense'}
      icon={<Banknote className="w-4 h-4 text-emerald-400" />}
      headerClass={palette.modalHeader}
      maxWidth="max-w-2xl"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-4 bg-white dark:bg-slate-900">
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
              htmlFor="expense-number-input"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1"
            >
              Expense No. *
            </label>
            <input
              id="expense-number-input"
              type="text"
              required
              disabled={Boolean(editingExpense)}
              value={expenseNo}
              onChange={(e) => {
                setExpenseNo(e.target.value.toUpperCase());
                if (formError) setFormError('');
              }}
              placeholder="e.g. EXP-2026-01"
              className={`w-full px-3 py-2 border rounded-lg text-xs font-mono uppercase focus:outline-none ${
                editingExpense
                  ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 cursor-not-allowed'
                  : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 dark:text-slate-100'
              }`}
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
              Expense Date
            </label>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-xs dark:text-slate-100 focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="expense-category-select"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1"
            >
              Category
            </label>
            <select
              id="expense-category-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-xs dark:text-slate-100 focus:outline-none"
            >
              {categoryOptions.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
              Paid To *
            </label>
            <input
              type="text"
              required
              value={paidTo}
              onChange={(e) => setPaidTo(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-xs dark:text-slate-100 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
              Amount *
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-xs dark:text-slate-100 focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="expense-payment-mode-select"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1"
            >
              Payment Mode
            </label>
            <select
              id="expense-payment-mode-select"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-xs dark:text-slate-100 focus:outline-none"
            >
              {paymentModeOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
            Remarks
          </label>
          <textarea
            rows={2}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-xs dark:text-slate-100 focus:outline-none"
          />
        </div>
        <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className={`${palette.primaryBtn} ${palette.primaryBtnHover} px-6 py-2 rounded-lg text-xs font-semibold shadow-md cursor-pointer disabled:opacity-50`}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

export interface RbacUserFormPayload {
  loginId: string;
  password: string;
  fullName: string;
  email: string;
  roleId: string;
  role: SessionUser['role'];
  employeeId?: string;
  department?: string;
  active: boolean;
  customPermissions: PermissionName[];
}

const RBAC_CATEGORIES: Array<'Attendance' | 'Employee' | 'User Management'> = [
  'Attendance',
  'Employee',
  'User Management',
];

/* ADD / EDIT SYSTEM USER MODAL */
export const UserFormModal: React.FC<{
  state: AssetOSState;
  users: SessionUser[];
  roles: RoleRecord[];
  editingUser?: SessionUser;
  onClose: () => void;
  onSave: (
    input: RbacUserFormPayload
  ) => Promise<{ ok: true } | { ok: false; errors: SystemUserValidationErrors }>;
}> = ({ state, users, roles, editingUser, onClose, onSave }) => {
  const palette = THEME_PALETTES[state.settings.theme];
  const roleOptions: RoleRecord[] =
    roles.length > 0
      ? roles
      : PREDEFINED_ROLES.map((r) => ({
          id: r.id,
          roleName: r.name,
          description: r.description,
          permissions: r.permissions,
        }));

  const initialRole =
    roleOptions.find((r) => r.id === editingUser?.roleId || r.roleName === editingUser?.role) ||
    roleOptions.find((r) => r.id === 'role_employee') ||
    roleOptions[0];

  const [loginId, setLoginId] = useState(editingUser?.loginId || '');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState(editingUser?.fullName || '');
  const [email, setEmail] = useState(editingUser?.email || '');
  const [roleId, setRoleId] = useState<string>(initialRole?.id || 'role_employee');
  const [employeeId, setEmployeeId] = useState(editingUser?.employeeId || '');
  const [department, setDepartment] = useState(editingUser?.department || '');
  const [active, setActive] = useState<boolean>(editingUser?.active ?? true);
  const [customPermissions, setCustomPermissions] = useState<PermissionName[]>(
    editingUser?.customPermissions || []
  );
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<SystemUserValidationErrors>({});

  const selectedRole = roleOptions.find((r) => r.id === roleId) || roleOptions[0];
  const rolePermissions = selectedRole?.permissions || [];
  const effectivePermissions = resolveEffectivePermissions(rolePermissions, customPermissions);

  const handleEmployeeSelect = (selectedEmpId: string) => {
    setEmployeeId(selectedEmpId);
    setErrors((prev) => ({ ...prev, employeeId: undefined, form: undefined }));
    if (selectedEmpId) {
      const emp = state.employees.find((e) => e.id === selectedEmpId);
      if (emp) {
        if (!department) setDepartment(emp.department);
        if (!editingUser) {
          if (!fullName.trim()) setFullName(emp.name);
          if (!email.trim()) setEmail(emp.email);
          if (!loginId.trim()) {
            setLoginId((emp.employeeId || emp.id).toLowerCase());
          }
          setDepartment(emp.department);
        }
      }
    }
  };

  const toggleCustomPermission = (perm: PermissionName) => {
    setCustomPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const localErrors: SystemUserValidationErrors = {};
    const trimmedLogin = loginId.trim();
    if (!trimmedLogin || trimmedLogin.length < 3 || !/^[a-zA-Z0-9._-]+$/.test(trimmedLogin)) {
      localErrors.loginId = 'Login ID must be 3-30 chars (letters, digits, ., _, -).';
    } else if (
      users.some(
        (u) => (!editingUser || u.id !== editingUser.id) && u.loginId.toLowerCase() === trimmedLogin.toLowerCase()
      )
    ) {
      localErrors.loginId = `Login ID "${trimmedLogin}" is already in use.`;
    }
    if (!editingUser && !password) {
      localErrors.password = 'Password is required.';
    } else if (
      password.length > 0 &&
      (password.length < 8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password) || !/[^a-zA-Z0-9]/.test(password))
    ) {
      localErrors.password =
        'Password must be at least 8 characters and include a letter, digit, and special character.';
    }
    if (!fullName.trim()) localErrors.fullName = 'Full Name is required.';
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      localErrors.email = 'Please enter a valid email address.';
    }
    if (selectedRole?.roleName === 'Employee' && !employeeId) {
      localErrors.employeeId = 'Please select a linked Employee record.';
    }

    if (Object.keys(localErrors).length > 0) {
      setErrors(localErrors);
      return;
    }

    setSubmitting(true);
    try {
      const result = await onSave({
        loginId: trimmedLogin,
        password,
        fullName: fullName.trim(),
        email: email.trim(),
        roleId: selectedRole.id,
        role: selectedRole.roleName as SessionUser['role'],
        employeeId: employeeId || undefined,
        department: department || undefined,
        active,
        customPermissions,
      });
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      setErrors({});
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell
      title={editingUser ? `Edit System User (${editingUser.loginId})` : 'Create System User'}
      icon={<UserPlus className="w-4 h-4 text-emerald-400" />}
      headerClass={palette.modalHeader}
      maxWidth="max-w-3xl"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} noValidate className="p-6 space-y-4 bg-white overflow-y-auto max-h-[80vh]">
        {errors.form && (
          <div
            role="alert"
            className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold"
          >
            {errors.form}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="user-login-id"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Login ID *
            </label>
            <input
              id="user-login-id"
              type="text"
              required
              value={loginId}
              aria-invalid={Boolean(errors.loginId)}
              onChange={(e) => {
                setLoginId(e.target.value);
                if (errors.loginId) setErrors((prev) => ({ ...prev, loginId: undefined }));
              }}
              className={`w-full px-3 py-2 bg-white border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600 ${
                errors.loginId ? 'border-rose-500' : 'border-slate-300'
              }`}
            />
            {errors.loginId && (
              <p role="alert" className="mt-1 text-[11px] font-semibold text-rose-600">
                {errors.loginId}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="user-password"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              {editingUser ? 'New Password (optional)' : 'Password *'}
            </label>
            <input
              id="user-password"
              type="password"
              required={!editingUser}
              value={password}
              placeholder={editingUser ? 'Leave blank to keep current password' : 'Min 8 chars, letter + digit + symbol'}
              aria-invalid={Boolean(errors.password)}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }));
              }}
              className={`w-full px-3 py-2 bg-white border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600 ${
                errors.password ? 'border-rose-500' : 'border-slate-300'
              }`}
            />
            {errors.password && (
              <p role="alert" className="mt-1 text-[11px] font-semibold text-rose-600">
                {errors.password}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="user-full-name"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Full Name *
            </label>
            <input
              id="user-full-name"
              type="text"
              required
              value={fullName}
              aria-invalid={Boolean(errors.fullName)}
              onChange={(e) => {
                setFullName(e.target.value);
                if (errors.fullName) setErrors((prev) => ({ ...prev, fullName: undefined }));
              }}
              className={`w-full px-3 py-2 bg-white border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600 ${
                errors.fullName ? 'border-rose-500' : 'border-slate-300'
              }`}
            />
            {errors.fullName && (
              <p role="alert" className="mt-1 text-[11px] font-semibold text-rose-600">
                {errors.fullName}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="user-email"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Email *
            </label>
            <input
              id="user-email"
              type="email"
              required
              value={email}
              aria-invalid={Boolean(errors.email)}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
              }}
              className={`w-full px-3 py-2 bg-white border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600 ${
                errors.email ? 'border-rose-500' : 'border-slate-300'
              }`}
            />
            {errors.email && (
              <p role="alert" className="mt-1 text-[11px] font-semibold text-rose-600">
                {errors.email}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="user-role"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Role *
            </label>
            <select
              id="user-role"
              value={roleId}
              onChange={(e) => {
                setRoleId(e.target.value);
                setErrors((prev) => ({ ...prev, role: undefined, employeeId: undefined, form: undefined }));
              }}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {roleOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.roleName}
                </option>
              ))}
            </select>
            {selectedRole && (
              <p className="mt-1 text-[10px] text-slate-500">{selectedRole.description}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label
                htmlFor="user-department"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Department
              </label>
              <select
                id="user-department"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none"
              >
                <option value="">-- Global / Any --</option>
                {state.departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="user-active-status"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Status
              </label>
              <select
                id="user-active-status"
                value={active ? 'active' : 'inactive'}
                onChange={(e) => {
                  setActive(e.target.value === 'active');
                  setErrors((prev) => ({ ...prev, form: undefined }));
                }}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="md:col-span-2">
            <label
              htmlFor="user-employee-id"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              {selectedRole?.roleName === 'Employee'
                ? 'Linked Employee *'
                : 'Linked Employee (Optional)'}
            </label>
            <select
              id="user-employee-id"
              required={selectedRole?.roleName === 'Employee'}
              value={employeeId}
              aria-invalid={Boolean(errors.employeeId)}
              onChange={(e) => handleEmployeeSelect(e.target.value)}
              className={`w-full px-3 py-2 bg-white border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600 ${
                errors.employeeId ? 'border-rose-500' : 'border-slate-300'
              }`}
            >
              <option value="">
                {selectedRole?.roleName === 'Employee' ? '-- Select Employee --' : '-- None --'}
              </option>
              {state.employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} ({emp.employeeId} · {emp.department})
                </option>
              ))}
            </select>
            {errors.employeeId && (
              <p role="alert" className="mt-1 text-[11px] font-semibold text-rose-600">
                {errors.employeeId}
              </p>
            )}
          </div>
        </div>

        {/* Custom Permission Selection */}
        <div className="border-t border-slate-200 pt-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">
                Custom Permission Selection
              </h4>
              <p className="text-[11px] text-slate-500">
                Permissions included by <strong>{selectedRole?.roleName}</strong> are pre-selected.
                Select additional permissions below to customize this user.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-[11px] font-bold text-amber-800 tabular-nums">
              {effectivePermissions.length} Selected
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {RBAC_CATEGORIES.map((category) => {
              const items = PERMISSION_DEFINITIONS.filter((p) => p.category === category);
              return (
                <div
                  key={category}
                  className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 space-y-2"
                >
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-700 border-b border-slate-200 pb-1">
                    {category}
                  </p>
                  {items.map((perm) => {
                    const fromRole = rolePermissions.includes(perm.name);
                    const fromCustom = customPermissions.includes(perm.name);
                    const checked = fromRole || fromCustom;
                    return (
                      <label
                        key={perm.id}
                        className="flex items-start gap-2 text-[11px] cursor-pointer select-none"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={fromRole}
                          onChange={() => toggleCustomPermission(perm.name)}
                          className="mt-0.5 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                        />
                        <div className="min-w-0">
                          <span className="font-mono font-semibold text-slate-800 block">
                            {perm.name}
                          </span>
                          {fromRole ? (
                            <span className="text-[9px] font-bold text-emerald-700">
                              Inherited from {selectedRole?.roleName}
                            </span>
                          ) : fromCustom ? (
                            <span className="text-[9px] font-bold text-amber-700">
                              Custom granted
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-500 leading-tight block">
                              {perm.description}
                            </span>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Display Selected Permissions Before Saving */}
        <div
          aria-label="Selected permissions summary before saving"
          className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 space-y-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-900">
              Effective Permissions Summary Before Saving ({effectivePermissions.length})
            </span>
            <span className="text-[10px] text-emerald-700 font-semibold">
              Role: {selectedRole?.roleName}
            </span>
          </div>
          {effectivePermissions.length === 0 ? (
            <p className="text-[11px] text-slate-500 italic">No permissions selected.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {effectivePermissions.map((perm) => {
                const isCustom = !rolePermissions.includes(perm);
                return (
                  <span
                    key={perm}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                      isCustom
                        ? 'bg-amber-100 text-amber-900 border-amber-300'
                        : 'bg-white text-emerald-900 border-emerald-200'
                    }`}
                  >
                    {perm}
                    {isCustom ? ' (custom)' : ''}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-200">
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
            className={`${palette.primaryBtn} ${palette.primaryBtnHover} disabled:opacity-60 px-6 py-2 rounded-lg text-xs font-semibold shadow-md cursor-pointer`}
          >
            {submitting
              ? 'Saving...'
              : editingUser
              ? 'Save User & Permissions'
              : 'Create User & Save Permissions'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

/* ASSET HISTORY MODAL */
export const AssetHistoryModal: React.FC<{
  state: AssetOSState;
  assetId: string;
  onClose: () => void;
}> = ({ state, assetId, onClose }) => {
  const asset = state.assets.find((a) => a.id === assetId);
  const history = state.history.filter((h) => h.assetId === assetId);

  return (
    <ModalShell
      title={`Asset History — ${asset?.name || assetId} (${assetId})`}
      icon={<History className="w-4 h-4 text-emerald-400" />}
      headerClass={THEME_PALETTES[state.settings.theme].modalHeader}
      onClose={onClose}
    >
      <div className="overflow-y-auto flex-1 max-h-[60vh]">
        <table className="w-full text-left border-collapse">
          <thead className="bg-[#3f3f46] text-white sticky top-0">
            <tr className="text-[10px] font-bold uppercase tracking-wider">
              <th className="px-6 py-3 w-28">Date</th>
              <th className="px-6 py-3 w-32">Activity</th>
              <th className="px-6 py-3">Details / Remarks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-xs bg-white dark:bg-slate-900">
            {history.length === 0 ? (
              <tr>
                <td colSpan={3} className="text-center py-8 text-slate-400">
                  No history found for this asset.
                </td>
              </tr>
            ) : (
              history.map((h, i) => {
                const badgeColor =
                  h.activity === 'Purchased'
                    ? 'bg-emerald-100 text-emerald-800'
                    : h.activity === 'Returned'
                    ? 'bg-rose-100 text-rose-800'
                    : h.activity === 'Transferred'
                    ? 'bg-purple-100 text-purple-800'
                    : h.activity === 'Assigned'
                    ? 'bg-indigo-100 text-indigo-800'
                    : 'bg-blue-100 text-blue-800';
                return (
                  <tr key={i} className="hover:bg-white/60">
                    <td className="px-6 py-3 text-slate-500 whitespace-nowrap tabular-nums">
                      {h.date}
                    </td>
                    <td className="px-6 py-3">
                      <span className={`px-2 py-1 rounded text-[10px] font-bold ${badgeColor}`}>
                        {h.activity}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-slate-700">{h.details}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="p-4 border-t border-slate-200 bg-white flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="px-5 py-2 bg-[#3f3f46] text-white rounded-lg text-xs font-semibold hover:bg-[#27272a] cursor-pointer"
        >
          Close
        </button>
      </div>
    </ModalShell>
  );
};

/* EMPLOYEE STATEMENT MODAL */
export const EmployeeStatementModal: React.FC<{
  state: AssetOSState;
  employeeId: string;
  onClose: () => void;
}> = ({ state, employeeId, onClose }) => {
  const emp = state.employees.find((e) => e.id === employeeId);
  const empHistory = emp
    ? state.history
        .filter(
          (h) =>
            h.details.includes(emp.name) ||
            h.details.includes(emp.id) ||
            h.details.includes(emp.employeeId)
        )
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    : [];

  return (
    <ModalShell
      title={`Asset Statement — ${emp?.name || employeeId} (${emp?.employeeId || employeeId})`}
      icon={<FileSpreadsheet className="w-4 h-4 text-emerald-400" />}
      headerClass={THEME_PALETTES[state.settings.theme].modalHeader}
      onClose={onClose}
    >
      <div className="overflow-y-auto flex-1 max-h-[60vh]">
        <table className="w-full text-left border-collapse">
          <thead className="bg-[#3f3f46] text-white sticky top-0">
            <tr className="text-[10px] font-bold uppercase tracking-wider">
              <th className="px-6 py-3 w-28">Date</th>
              <th className="px-6 py-3 w-48">Asset</th>
              <th className="px-6 py-3 w-28">Activity</th>
              <th className="px-6 py-3">Details / Remarks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-xs bg-white dark:bg-slate-900">
            {empHistory.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-8 text-slate-400">
                  No asset history found for this employee.
                </td>
              </tr>
            ) : (
              empHistory.map((h, i) => {
                const ast = state.assets.find((a) => a.id === h.assetId);
                const badgeColor =
                  h.activity === 'Assigned'
                    ? 'bg-emerald-100 text-emerald-800'
                    : h.activity === 'Returned'
                    ? 'bg-rose-100 text-rose-800'
                    : 'bg-orange-100 text-orange-800';
                return (
                  <tr key={i} className="hover:bg-white/60">
                    <td className="px-6 py-3 text-slate-500 whitespace-nowrap tabular-nums">
                      {h.date}
                    </td>
                    <td className="px-6 py-3 font-semibold text-slate-800">
                      {ast?.name || 'Unknown'}
                      <span className="block text-[10px] font-mono text-slate-400">{h.assetId}</span>
                    </td>
                    <td className="px-6 py-3">
                      <span className={`px-2 py-1 rounded text-[10px] font-bold ${badgeColor}`}>
                        {h.activity}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-slate-700">{h.details}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="p-4 border-t border-slate-200 bg-white flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="px-5 py-2 bg-[#3f3f46] text-white rounded-lg text-xs font-semibold hover:bg-[#27272a] cursor-pointer"
        >
          Close
        </button>
      </div>
    </ModalShell>
  );
};

/* CONFIRMATION DIALOG */
export const ConfirmModal: React.FC<{
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ title, message, confirmLabel, danger = false, onCancel, onConfirm }) => (
  <ModalShell
    title={title}
    icon={<AlertTriangle className="w-4 h-4 text-amber-300" />}
    headerClass="bg-[#3f3f46]"
    maxWidth="max-w-md"
    onClose={onCancel}
  >
    <div className="p-6 space-y-4 bg-white">
      <p className="text-xs text-slate-600 leading-relaxed">{message}</p>
      <div className="flex justify-end space-x-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={`px-5 py-2 rounded-lg text-xs font-bold text-white cursor-pointer ${
            danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-[#3f3f46] hover:bg-[#27272a]'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </ModalShell>
);

/* TOAST STACK */
export const ToastContainer: React.FC<{ toasts: ToastMessage[] }> = ({ toasts }) => (
  <div
    aria-live="polite"
    className="fixed bottom-5 right-5 z-[100] flex flex-col space-y-2 pointer-events-none"
  >
    {toasts.map((t) => {
      const bg =
        t.type === 'success'
          ? 'bg-emerald-600'
          : t.type === 'error'
          ? 'bg-rose-600'
          : 'bg-slate-800';
      const Icon =
        t.type === 'success' ? CheckCircle2 : t.type === 'error' ? XCircle : Info;
      return (
        <div
          key={t.id}
          className={`${bg} text-white px-4 py-2.5 rounded-lg shadow-2xl flex items-center space-x-2.5 text-xs font-semibold pointer-events-auto`}
        >
          <Icon className="w-4 h-4 shrink-0" />
          <span>{t.message}</span>
        </div>
      );
    })}
  </div>
);

/* BULK EMPLOYEE IMPORT SUMMARY MODAL */
export const EmployeeImportResultModal: React.FC<{
  result: BulkEmployeeImportResult;
  theme: AssetOSState['settings']['theme'];
  onClose: () => void;
}> = ({ result, theme, onClose }) => (
  <ModalShell
    title="Bulk Employee Import Summary"
    icon={<FileSpreadsheet className="w-4 h-4 text-emerald-400" />}
    headerClass={THEME_PALETTES[theme].modalHeader}
    maxWidth="max-w-2xl"
    onClose={onClose}
  >
    <div className="p-6 space-y-4 bg-white overflow-y-auto flex-1">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
          <span className="text-[10px] font-bold uppercase text-slate-400 block">Total Rows</span>
          <span className="text-base font-extrabold text-slate-900 tabular-nums">{result.totalRows}</span>
        </div>
        <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200">
          <span className="text-[10px] font-bold uppercase text-emerald-700 block">Created</span>
          <span className="text-base font-extrabold text-emerald-900 tabular-nums">{result.createdCount}</span>
        </div>
        <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200">
          <span className="text-[10px] font-bold uppercase text-blue-700 block">Updated</span>
          <span className="text-base font-extrabold text-blue-900 tabular-nums">{result.updatedCount}</span>
        </div>
        <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200">
          <span className="text-[10px] font-bold uppercase text-amber-700 block">Skipped</span>
          <span className="text-base font-extrabold text-amber-900 tabular-nums">{result.skippedCount}</span>
        </div>
        <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200">
          <span className="text-[10px] font-bold uppercase text-rose-700 block">Failed</span>
          <span className="text-base font-extrabold text-rose-900 tabular-nums">{result.failedCount}</span>
        </div>
      </div>

      {result.errors.length === 0 ? (
        <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 font-semibold">
          All rows imported cleanly with zero errors. Existing employee records remain preserved.
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-[#3f3f46] text-white sticky top-0 text-[10px] uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 w-16">Row</th>
                <th className="px-3 py-2 w-24">Emp ID</th>
                <th className="px-3 py-2 w-32">Name</th>
                <th className="px-3 py-2">Outcome / Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result.errors.map((err, idx) => (
                <tr key={idx} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-slate-500">#{err.rowNumber}</td>
                  <td className="px-3 py-2 font-mono font-semibold text-slate-700">{err.employeeId || '—'}</td>
                  <td className="px-3 py-2 text-slate-800">{err.name || '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{err.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-end pt-2 border-t border-slate-100">
        <button
          type="button"
          onClick={onClose}
          className="px-5 py-2 bg-[#3f3f46] text-white rounded-lg text-xs font-semibold hover:bg-[#27272a] cursor-pointer"
        >
          Close
        </button>
      </div>
    </div>
  </ModalShell>
);

/* INSTANT EMAIL DELIVERY STATUS POPUP */
export const MailStatusPopupModal: React.FC<{
  ok: boolean;
  title: string;
  details?: string;
  theme?: ThemePalette;
  onClose: () => void;
}> = ({ ok, title, details, theme = 'Corporate Blue', onClose }) => (
  <ModalShell
    title={ok ? 'Email Sent Successfully' : 'Email Delivery Failed'}
    icon={
      ok ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
      ) : (
        <Mail className="w-4 h-4 text-rose-400" />
      )
    }
    headerClass={THEME_PALETTES[theme].modalHeader}
    maxWidth="max-w-md"
    onClose={onClose}
  >
    <div className="p-6 space-y-4 bg-white dark:bg-slate-900">
      <div
        role="alert"
        className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
          ok
            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
            : 'bg-rose-50 border-rose-200 text-rose-900'
        }`}
      >
        {ok ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
        ) : (
          <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
        )}
        <div className="space-y-1">
          <p className="font-bold">{title}</p>
          {details && <p className="text-[11px] opacity-90">{details}</p>}
          {!ok && (
            <p className="text-[10px] font-semibold text-rose-700">
              No automatic retries will occur. Failed mail has been immediately deleted from the queue.
            </p>
          )}
        </div>
      </div>

      <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
        <button
          type="button"
          onClick={onClose}
          className="px-5 py-2 bg-[#3f3f46] hover:bg-[#27272a] text-white rounded-lg text-xs font-bold cursor-pointer"
        >
          OK
        </button>
      </div>
    </div>
  </ModalShell>
);

/* BULK DIRECTORY IMPORT SUMMARY MODAL */
export const DirectoryImportResultModal: React.FC<{
  result: BulkDirectoryImportResult;
  theme: ThemePalette;
  onClose: () => void;
}> = ({ result, theme, onClose }) => (
  <ModalShell
    title={`${result.directoryLabel} Bulk CSV Import Summary`}
    icon={<FileSpreadsheet className="w-4 h-4 text-emerald-400" />}
    headerClass={THEME_PALETTES[theme].modalHeader}
    maxWidth="max-w-2xl"
    onClose={onClose}
  >
    <div className="p-6 space-y-4 bg-white dark:bg-slate-900 overflow-y-auto flex-1">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
        <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
          <span className="text-[10px] font-bold uppercase text-slate-400 block">Total Rows</span>
          <span className="text-base font-extrabold text-slate-900 dark:text-white tabular-nums">
            {result.totalRows}
          </span>
        </div>
        <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200">
          <span className="text-[10px] font-bold uppercase text-emerald-700 block">Created</span>
          <span className="text-base font-extrabold text-emerald-900 tabular-nums">
            {result.createdCount}
          </span>
        </div>
        <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200">
          <span className="text-[10px] font-bold uppercase text-blue-700 block">Updated</span>
          <span className="text-base font-extrabold text-blue-900 tabular-nums">
            {result.updatedCount}
          </span>
        </div>
        <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200">
          <span className="text-[10px] font-bold uppercase text-amber-700 block">Skipped</span>
          <span className="text-base font-extrabold text-amber-900 tabular-nums">
            {result.skippedCount}
          </span>
        </div>
        <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200">
          <span className="text-[10px] font-bold uppercase text-rose-700 block">Failed</span>
          <span className="text-base font-extrabold text-rose-900 tabular-nums">
            {result.failedCount}
          </span>
        </div>
      </div>

      {result.errors.length === 0 ? (
        <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 font-semibold">
          All rows imported cleanly with zero errors.
        </div>
      ) : (
        <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-[#3f3f46] text-white sticky top-0 text-[10px] uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 w-16">Row</th>
                <th className="px-3 py-2 w-28">Code</th>
                <th className="px-3 py-2 w-36">Name</th>
                <th className="px-3 py-2">Outcome / Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {result.errors.map((err, idx) => (
                <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <td className="px-3 py-2 font-mono text-slate-500">#{err.rowNumber}</td>
                  <td className="px-3 py-2 font-mono font-semibold text-slate-700 dark:text-slate-200">
                    {err.employeeId || '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-800 dark:text-slate-100">{err.name || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{err.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
        <button
          type="button"
          onClick={onClose}
          className="px-5 py-2 bg-[#3f3f46] text-white rounded-lg text-xs font-semibold hover:bg-[#27272a] cursor-pointer"
        >
          Close
        </button>
      </div>
    </div>
  </ModalShell>
);

/* EMPLOYMENT CATEGORY CONVERSION MODAL */
export const ConvertEmploymentModal: React.FC<{
  state: AssetOSState;
  sourceType: EmploymentCategory;
  sourceId: string;
  sourceCode: string;
  personName: string;
  onClose: () => void;
  onConvert: (payload: {
    sourceCategory: EmploymentCategory;
    sourceId: string;
    targetCategory: EmploymentCategory;
    newCode?: string;
    reason?: string;
  }) => Promise<void>;
}> = ({ state, sourceType, sourceId, sourceCode, personName, onClose, onConvert }) => {
  const palette = THEME_PALETTES[state.settings.theme];
  const targetOptions = ALL_EMPLOYMENT_CATEGORIES.filter((c) => c !== sourceType);
  const [targetCategory, setTargetCategory] = useState<EmploymentCategory>(
    targetOptions[0] || 'Consultant'
  );
  const [newCode, setNewCode] = useState('');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const cleanCode = newCode.trim().toUpperCase();
    if (cleanCode && targetCategory !== 'Employee' && !/^[A-Z0-9]{1,10}$/.test(cleanCode)) {
      setFormError('Target ID/Code must contain only A-Z and 0-9 (max 10 characters).');
      return;
    }
    setSaving(true);
    try {
      await onConvert({
        sourceCategory: sourceType,
        sourceId,
        targetCategory,
        newCode: cleanCode || undefined,
        reason: reason.trim() || undefined,
      });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Employment category conversion failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title={`Convert Employment Category — ${personName}`}
      icon={<ArrowRightLeft className="w-4 h-4 text-emerald-400" />}
      headerClass={palette.modalHeader}
      maxWidth="max-w-lg"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-4 bg-white dark:bg-slate-900">
        {formError && (
          <div
            role="alert"
            className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-2"
          >
            <XCircle className="w-4 h-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs space-y-1">
          <p className="text-slate-600 dark:text-slate-300">
            Converting <strong className="text-slate-900 dark:text-white">{personName}</strong> (
            <span className="font-mono font-bold">{sourceCode}</span> · {sourceType}) preserves
            all historical attendance, leaves, workflow requests, asset custody, tickets, policy
            acknowledgments, and email logs under a unified profile ID.
          </p>
        </div>

        <div>
          <label
            htmlFor="convert-target-category"
            className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1"
          >
            Target Employment Category *
          </label>
          <select
            id="convert-target-category"
            value={targetCategory}
            onChange={(e) => setTargetCategory(e.target.value as EmploymentCategory)}
            className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-semibold dark:text-slate-100 focus:outline-none"
          >
            {targetOptions.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="convert-new-code"
            className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1"
          >
            New Target ID / Code (Optional — auto-generated if blank)
          </label>
          <input
            id="convert-new-code"
            type="text"
            value={newCode}
            maxLength={10}
            onChange={(e) => setNewCode(e.target.value.toUpperCase())}
            placeholder={targetCategory === 'Employee' ? '5-digit code e.g. 54321' : 'A-Z & 0-9, max 10 chars'}
            className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-mono uppercase dark:text-slate-100 focus:outline-none"
          />
        </div>

        <div>
          <label
            htmlFor="convert-reason"
            className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1"
          >
            Conversion Reason / Notes
          </label>
          <textarea
            id="convert-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Full-time regularization or project extension"
            className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-xs dark:text-slate-100 focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className={`${palette.primaryBtn} ${palette.primaryBtnHover} px-6 py-2 rounded-lg text-xs font-semibold shadow-md flex items-center gap-1.5 cursor-pointer disabled:opacity-50`}
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            <span>{saving ? 'Converting...' : 'Confirm Conversion'}</span>
          </button>
        </div>
      </form>
    </ModalShell>
  );
};
