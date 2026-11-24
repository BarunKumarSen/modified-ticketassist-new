import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  Search,
  ShieldAlert,
  UserPlus,
  Users,
  XCircle,
} from 'lucide-react';
import { apiClient, ApiError } from '../api/client';
import { useSession } from '../auth/SessionContext';
import type { Employee, PersonnelEntity, ThemePalette, ToastMessage } from '../types/asset';
import type { LeaveRecord } from '../types/attendance';
import { THEME_PALETTES } from '../utils/assetMath';
import { isAdminRole } from '../utils/hierarchyLogic';
import { ModalShell } from './AssetModals';

interface TeamMembersViewProps {
  theme: ThemePalette;
  onNotify: (msg: string, type?: ToastMessage['type']) => void;
  onTeamUpdated?: () => void;
}

function leaveStatusClass(status: string): string {
  if (status === 'Approved') return 'bg-[#dcfce7] text-[#166534] border-[#bbf7d0]';
  if (status === 'Rejected') return 'bg-[#fce7f3] text-[#be185d] border-[#fbcfe8]';
  return 'bg-amber-50 text-amber-800 border-amber-200';
}

export const TeamMembersView: React.FC<TeamMembersViewProps> = ({
  theme,
  onNotify,
  onTeamUpdated,
}) => {
  const { session } = useSession();
  const palette = THEME_PALETTES[theme];
  const isAdmin = isAdminRole(session?.role);

  const [members, setMembers] = useState<Employee[]>([]);
  const [managers, setManagers] = useState<Employee[]>([]);
  const [consultantManagers, setConsultantManagers] = useState<PersonnelEntity[]>([]);
  const [candidateEmployees, setCandidateEmployees] = useState<Employee[]>([]);
  const [leaves, setLeaves] = useState<LeaveRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedManagerId, setSelectedManagerId] = useState('');
  const [search, setSearch] = useState('');
  const [leaveFilter, setLeaveFilter] = useState<'All' | 'Pending' | 'Approved' | 'Rejected'>('All');

  const [buildModalOpen, setBuildModalOpen] = useState(false);
  const [teamSearch, setTeamSearch] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [savingTeam, setSavingTeam] = useState(false);

  const [reviewModal, setReviewModal] = useState<{
    leave: LeaveRecord;
    decision: 'Approved' | 'Rejected';
  } | null>(null);
  const [reviewRemarks, setReviewRemarks] = useState('');
  const [reviewing, setReviewing] = useState(false);

  const loadTeamData = useCallback(async () => {
    setLoading(true);
    try {
      const [membersRes, leavesRes] = await Promise.all([
        apiClient.getTeamMembers(selectedManagerId || undefined),
        apiClient.getTeamLeaves(),
      ]);
      setMembers(membersRes.members);
      setManagers(membersRes.managers);
      setConsultantManagers(membersRes.consultantManagers || []);
      setCandidateEmployees(membersRes.candidateEmployees || []);
      setLeaves(leavesRes.leaves);
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Failed to load team members', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedManagerId, onNotify]);

  useEffect(() => {
    void loadTeamData();
  }, [loadTeamData]);

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter(
      (m) =>
        !q ||
        m.name.toLowerCase().includes(q) ||
        m.employeeId.toLowerCase().includes(q) ||
        m.department.toLowerCase().includes(q) ||
        (m.center || m.branch || '').toLowerCase().includes(q)
    );
  }, [members, search]);

  const filteredLeaves = useMemo(() => {
    const memberIds = new Set(members.map((m) => m.id));
    return leaves.filter((lv) => {
      if (selectedManagerId && !memberIds.has(lv.employeeId) && lv.managerId !== selectedManagerId) {
        return false;
      }
      if (leaveFilter !== 'All' && lv.status !== leaveFilter) return false;
      return true;
    });
  }, [leaves, members, selectedManagerId, leaveFilter]);

  const pendingCount = useMemo(
    () => leaves.filter((l) => l.status === 'Pending').length,
    [leaves]
  );

  const openReviewModal = (leave: LeaveRecord, decision: 'Approved' | 'Rejected') => {
    setReviewModal({ leave, decision });
    setReviewRemarks(leave.reviewRemarks || '');
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewModal || reviewing) return;
    setReviewing(true);
    try {
      await apiClient.reviewLeave(
        reviewModal.leave.id,
        reviewModal.decision,
        reviewRemarks.trim() || undefined
      );
      onNotify(
        `Leave ${reviewModal.decision.toLowerCase()} for ${reviewModal.leave.employeeName || reviewModal.leave.employeeId}`
      );
      setReviewModal(null);
      setReviewRemarks('');
      await loadTeamData();
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Failed to update leave decision', 'error');
    } finally {
      setReviewing(false);
    }
  };

  const activeManagerTargetId =
    selectedManagerId || session?.entityId || session?.employeeId || '';
  const canBuildTeam =
    candidateEmployees.length > 0 &&
    (!isAdmin ? Boolean(session?.isManager || activeManagerTargetId) : Boolean(selectedManagerId));

  const openBuildTeamModal = () => {
    setSelectedMemberIds(members.map((m) => m.id));
    setTeamSearch('');
    setBuildModalOpen(true);
  };

  const handleSaveTeamRoster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingTeam) return;
    const currentSet = new Set(members.map((m) => m.id));
    const nextSet = new Set(selectedMemberIds);
    const addEmployeeIds = selectedMemberIds.filter((id) => !currentSet.has(id));
    const removeEmployeeIds = members.map((m) => m.id).filter((id) => !nextSet.has(id));
    setSavingTeam(true);
    try {
      const res = await apiClient.assignTeamMembers({
        managerId: isAdmin ? selectedManagerId : undefined,
        addEmployeeIds,
        removeEmployeeIds,
      });
      setBuildModalOpen(false);
      await loadTeamData();
      onTeamUpdated?.();
      onNotify(`Team roster updated (${res.updatedCount} change(s) applied).`);
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Failed to update reporting team', 'error');
    } finally {
      setSavingTeam(false);
    }
  };

  return (
    <div className="space-y-5 pb-10" data-testid="team-members-view">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Team Members</h1>
          <p className="text-xs text-slate-500 mt-1">
            {isAdmin
              ? 'View reporting teams across managers & Consultant-Managers, review team leaves, or build rosters'
              : 'Direct reporting team members, team builder, and leave approvals routed to you'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canBuildTeam && (
            <button
              type="button"
              onClick={openBuildTeamModal}
              className={`${palette.primaryBtn} ${palette.primaryBtnHover} px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Build / Manage Team</span>
            </button>
          )}
          {isAdmin && (managers.length > 0 || consultantManagers.length > 0) && (
            <select
              aria-label="Filter by reporting manager"
              value={selectedManagerId}
              onChange={(e) => setSelectedManagerId(e.target.value)}
              className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-700"
            >
              <option value="">All Reporting Teams</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  Manager: {m.name} ({m.employeeId})
                </option>
              ))}
              {consultantManagers.map((cm) => (
                <option key={cm.id} value={cm.id}>
                  Consultant Manager: {cm.name} ({cm.entityCode})
                </option>
              ))}
            </select>
          )}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              aria-label="Search team members"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search team member..."
              className="w-52 pl-8 pr-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        </div>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Team Members
          </p>
          <p className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1 tabular-nums">
            {members.length}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Pending Leaves
          </p>
          <p className="text-2xl font-extrabold text-amber-700 mt-1 tabular-nums">
            {pendingCount}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Approved Leaves
          </p>
          <p className="text-2xl font-extrabold text-emerald-700 mt-1 tabular-nums">
            {leaves.filter((l) => l.status === 'Approved').length}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Rejected Leaves
          </p>
          <p className="text-2xl font-extrabold text-rose-700 mt-1 tabular-nums">
            {leaves.filter((l) => l.status === 'Rejected').length}
          </p>
        </div>
      </div>

      {/* Section 1: Team Roster */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
            <Users className="w-4 h-4 text-emerald-700" />
            <span>Direct Reporting Employees ({filteredMembers.length})</span>
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Designation &amp; Dept</th>
                <th className="px-4 py-3">Center</th>
                <th className="px-4 py-3">Reporting Manager</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    Loading team members...
                  </td>
                </tr>
              ) : filteredMembers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No direct reporting employees found.
                  </td>
                </tr>
              ) : (
                filteredMembers.map((emp) => (
                  <tr key={emp.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <span className="font-bold text-slate-900 block">{emp.name}</span>
                      <span className="text-[10px] font-mono text-slate-500">{emp.employeeId}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-semibold text-slate-800 block">{emp.designation}</span>
                      <span className="text-[11px] text-slate-500">{emp.department}</span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-700 font-medium">
                      {emp.center || emp.branch}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">
                      {emp.reportingManagerName || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      <span className="block">{emp.email}</span>
                      <span className="text-[11px] tabular-nums text-slate-500">{emp.phone}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`text-[11px] font-bold ${
                          emp.status === 'Active' ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {emp.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 2: Team Leave Approval Queue */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h2 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
            <CalendarDays className="w-4 h-4 text-sky-700" />
            <span>Team Leave Requests ({filteredLeaves.length})</span>
          </h2>

          <div className="flex items-center gap-1 p-1 bg-white border border-slate-200 rounded-lg">
            {(['All', 'Pending', 'Approved', 'Rejected'] as const).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setLeaveFilter(status)}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  leaveFilter === status
                    ? 'bg-[#3f3f46] text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Type &amp; Dates</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Assigned Manager</th>
                <th className="px-4 py-3">Status &amp; Remarks</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredLeaves.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No leave requests match this filter.
                  </td>
                </tr>
              ) : (
                filteredLeaves.map((lv) => {
                  const canActPending = lv.status === 'Pending';
                  const canOverride = lv.status !== 'Pending' && isAdmin;
                  return (
                    <tr key={lv.id} className="hover:bg-slate-50 align-top">
                      <td className="px-4 py-3">
                        <span className="font-bold text-slate-900 block">
                          {lv.employeeName || lv.employeeId}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500">
                          {lv.employeeCode || lv.employeeId} · {lv.department}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-semibold text-slate-800 block">{lv.leaveType}</span>
                        <span className="text-[11px] font-mono text-slate-600 tabular-nums">
                          {lv.startDate} → {lv.endDate} ({lv.days}d)
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 max-w-xs">{lv.reason}</td>
                      <td className="px-4 py-3 text-slate-700">{lv.managerName || '—'}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded font-bold text-[10px] border inline-block ${leaveStatusClass(
                            lv.status
                          )}`}
                        >
                          {lv.status}
                        </span>
                        {lv.reviewedBy && (
                          <p className="text-[11px] text-slate-500 mt-1">by {lv.reviewedBy}</p>
                        )}
                        {lv.reviewRemarks && (
                          <p className="text-[11px] text-slate-700 mt-0.5">
                            Remarks: {lv.reviewRemarks}
                          </p>
                        )}
                        {lv.overriddenBy && (
                          <p className="text-[10px] font-semibold text-amber-800 mt-0.5">
                            Overridden by {lv.overriddenBy}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap space-x-1">
                        {canActPending && (
                          <>
                            <button
                              type="button"
                              onClick={() => openReviewModal(lv, 'Approved')}
                              className="px-2.5 py-1 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3 h-3" /> Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => openReviewModal(lv, 'Rejected')}
                              className="px-2.5 py-1 rounded bg-rose-100 hover:bg-rose-200 text-rose-800 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <XCircle className="w-3 h-3" /> Reject
                            </button>
                          </>
                        )}
                        {canOverride && (
                          <button
                            type="button"
                            onClick={() =>
                              openReviewModal(
                                lv,
                                lv.status === 'Approved' ? 'Rejected' : 'Approved'
                              )
                            }
                            className="px-2.5 py-1 rounded bg-amber-100 hover:bg-amber-200 text-amber-900 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <ShieldAlert className="w-3 h-3" />
                            <span>
                              Override → {lv.status === 'Approved' ? 'Reject' : 'Approve'}
                            </span>
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
      </div>

      {/* Review & Remarks Modal */}
      {reviewModal && (
        <ModalShell
          title={`${
            reviewModal.leave.status !== 'Pending' ? 'Override Leave Decision' : 'Review Leave Request'
          } — ${reviewModal.leave.employeeName || reviewModal.leave.employeeId}`}
          icon={
            reviewModal.decision === 'Approved' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-400" />
            )
          }
          headerClass={palette.modalHeader}
          maxWidth="max-w-md"
          onClose={() => setReviewModal(null)}
        >
          <form onSubmit={handleSubmitReview} className="p-6 space-y-4 bg-white">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1">
              <p className="font-bold text-slate-900">
                {reviewModal.leave.leaveType} Leave ({reviewModal.leave.days} day
                {reviewModal.leave.days === 1 ? '' : 's'})
              </p>
              <p className="font-mono text-slate-600 tabular-nums">
                {reviewModal.leave.startDate} → {reviewModal.leave.endDate}
              </p>
              <p className="text-slate-600">Reason: {reviewModal.leave.reason}</p>
            </div>

            <div>
              <label
                htmlFor="team-leave-remarks"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Manager / Admin Remarks
              </label>
              <textarea
                id="team-leave-remarks"
                rows={3}
                value={reviewRemarks}
                onChange={(e) => setReviewRemarks(e.target.value)}
                placeholder="Add approval or rejection remarks for the employee..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setReviewModal(null)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={reviewing}
                className={`px-5 py-2 rounded-lg text-xs font-bold text-white cursor-pointer disabled:opacity-50 ${
                  reviewModal.decision === 'Approved'
                    ? 'bg-emerald-700 hover:bg-emerald-800'
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {reviewing
                  ? 'Saving...'
                  : `Confirm ${reviewModal.decision === 'Approved' ? 'Approval' : 'Rejection'}`}
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {/* Build / Manage Reporting Team Modal */}
      {buildModalOpen && (
        <ModalShell
          title="Build & Manage Reporting Team"
          icon={<UserPlus className="w-4 h-4 text-emerald-400" />}
          headerClass={palette.modalHeader}
          maxWidth="max-w-lg"
          onClose={() => setBuildModalOpen(false)}
        >
          <form onSubmit={handleSaveTeamRoster} className="p-6 space-y-4 bg-white">
            <p className="text-xs text-slate-600">
              Select the Employees assigned to report under{' '}
              <strong>
                {isAdmin
                  ? consultantManagers.find((c) => c.id === selectedManagerId)?.name ||
                    managers.find((m) => m.id === selectedManagerId)?.name ||
                    'Selected Manager'
                  : session?.fullName}
              </strong>
              .
            </p>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={teamSearch}
                onChange={(e) => setTeamSearch(e.target.value)}
                placeholder="Filter employees by name, ID, or department..."
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none"
              />
            </div>
            <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
              {candidateEmployees
                .filter((emp) => {
                  const q = teamSearch.trim().toLowerCase();
                  return (
                    !q ||
                    emp.name.toLowerCase().includes(q) ||
                    emp.employeeId.toLowerCase().includes(q) ||
                    emp.department.toLowerCase().includes(q)
                  );
                })
                .map((emp) => {
                  const checked = selectedMemberIds.includes(emp.id);
                  return (
                    <label
                      key={emp.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-xs hover:bg-slate-50 cursor-pointer"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedMemberIds((prev) =>
                              prev.includes(emp.id)
                                ? prev.filter((id) => id !== emp.id)
                                : [...prev, emp.id]
                            )
                          }
                          className="rounded border-slate-300 text-emerald-700"
                        />
                        <span className="font-bold text-slate-800 truncate">{emp.name}</span>
                        <span className="text-[10px] font-mono text-slate-500">{emp.employeeId}</span>
                      </span>
                      <span className="text-[11px] text-slate-500 shrink-0">{emp.department}</span>
                    </label>
                  );
                })}
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-200">
              <span className="text-[11px] text-slate-500 tabular-nums">
                {selectedMemberIds.length} employee(s) selected
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setBuildModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingTeam}
                  className={`${palette.primaryBtn} ${palette.primaryBtnHover} px-5 py-2 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50`}
                >
                  {savingTeam ? 'Saving...' : 'Save Team Roster'}
                </button>
              </div>
            </div>
          </form>
        </ModalShell>
      )}
    </div>
  );
};
