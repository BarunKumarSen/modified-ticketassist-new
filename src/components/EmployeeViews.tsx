import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  Briefcase,
  Building2,
  Calendar,
  FileText,
  Laptop,
  LifeBuoy,
  Mail,
  MapPin,
  Phone,
  RotateCcw,
  Search,
  Share2,
  ShieldCheck,
  Tag,
  UserCheck,
} from 'lucide-react';
import type { NavTab, ToastMessage } from '../types/asset';
import type { EmployeeCenterRecord } from '../types/policy';
import {
  isSelfServiceEntityRole,
  type OwnedAssetSummary,
  type ScopedEmployeeData,
} from '../utils/ticketLogic';
import { useSession } from '../auth/SessionContext';
import { apiClient, ApiError } from '../api/client';
import { DEFAULT_INDIAN_CENTER } from '../data/indianCenters';
import { ModalShell } from './AssetModals';
import { SearchableCenterSelect } from './SearchableCenterSelect';

interface EmployeeDashboardViewProps {
  scopedData: ScopedEmployeeData;
  onNavigate: (tab: NavTab) => void;
  onOpenPolicy?: (category: string) => void;
  onRaiseTicket: (assetId?: string) => void;
}

const ASSET_STATUS_PILL: Record<string, string> = {
  Assigned: 'bg-blue-100 text-blue-800 border-blue-200',
  'Under Maintenance': 'bg-amber-100 text-amber-800 border-amber-200',
  Available: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  Disposed: 'bg-red-100 text-red-800 border-red-200',
};

export const EmployeeDashboardView: React.FC<EmployeeDashboardViewProps> = ({
  scopedData,
  onNavigate,
  onOpenPolicy,
  onRaiseTicket,
}) => {
  const { session } = useSession();

  if (!session || !isSelfServiceEntityRole(session.role)) {
    return null;
  }

  const { employee, entity, ownedAssets, openTicketsCount, tickets } = scopedData;
  const portalTitle = entity
    ? `${entity.entityType} Portal`
    : session.role === 'Consultant' ||
      session.role === 'Retainer' ||
      session.role === 'Freelancer' ||
      session.role === 'Young Research Program' ||
      session.role === 'Intern'
    ? `${session.role} Portal`
    : 'Employee Portal';

  return (
    <div className="space-y-6 pb-10" data-testid="employee-dashboard">
      {/* Personal Welcome Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">{portalTitle}</h1>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            Welcome back, <span className="font-bold text-slate-800 dark:text-slate-200">{session.fullName}</span>
            {employee
              ? ` · ${employee.employeeId} · ${employee.department}`
              : entity
              ? ` · ${entity.entityCode} · ${entity.entityType}`
              : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('my-tickets')}
            className="px-3.5 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            View My Tickets ({tickets.length})
          </button>
          <button
            type="button"
            onClick={() => onRaiseTicket()}
            disabled={ownedAssets.length === 0}
            className="px-4 py-2 bg-[#3f3f46] hover:bg-[#27272a] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer"
          >
            <LifeBuoy className="w-3.5 h-3.5" />
            <span>Raise Ticket</span>
          </button>
        </div>
      </div>

      {/* Personal Summary Cards ONLY */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-testid="employee-summary-cards">
        <div className="bg-blue-50 dark:bg-slate-900 p-5 rounded-xl border border-blue-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-400">
              Total Assets Held
            </p>
            <h2
              data-testid="employee-total-assets-count"
              className="text-3xl font-extrabold text-blue-900 dark:text-white mt-1 tabular-nums"
            >
              {ownedAssets.length}
            </h2>
            <p className="text-[11px] text-blue-700/80 dark:text-slate-400 mt-1">
              Currently assigned to your account
            </p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-blue-700 text-white flex items-center justify-center shadow-sm">
            <Laptop className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-amber-50 dark:bg-slate-900 p-5 rounded-xl border border-amber-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
              Open Tickets
            </p>
            <h2
              data-testid="employee-open-tickets-count"
              className="text-3xl font-extrabold text-amber-900 dark:text-white mt-1 tabular-nums"
            >
              {openTicketsCount}
            </h2>
            <p className="text-[11px] text-amber-700/80 dark:text-slate-400 mt-1">
              {tickets.length} total support {tickets.length === 1 ? 'ticket' : 'tickets'} raised
            </p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-amber-600 text-white flex items-center justify-center shadow-sm">
            <LifeBuoy className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Personal My Assets Section */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="px-5 py-4 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">My Assets</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Equipment actively assigned to you. Select Raise Ticket on an asset to report an issue.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('my-assets')}
            className="text-xs font-bold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer shrink-0"
          >
            All My Assets →
          </button>
        </div>

        {ownedAssets.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No assets are currently assigned to your account.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-5" data-testid="employee-my-assets-list">
            {ownedAssets.map((item) => (
              <AssetCard
                key={item.asset.id}
                assetSummary={item}
                onRaiseTicket={onRaiseTicket}
              />
            ))}
          </div>
        )}
      </div>

      {/* Reporting Manager & Company Policies Quick Access */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
              <UserCheck className="w-4 h-4 text-emerald-700" />
              <span>Reporting Manager &amp; Center</span>
            </h2>
            {employee && (
              <button
                type="button"
                onClick={() => onNavigate('attendance')}
                className="text-xs font-bold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
              >
                Leave &amp; Attendance →
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <p className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">Assigned Manager</p>
              <p className="font-bold text-slate-900 dark:text-white mt-1">
                {employee?.reportingManagerName || entity?.reportingManagerName || 'Not Assigned'}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {employee?.reportingManagerEmail || 'Contact HR / Admin'}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <p className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">Assigned Center</p>
              <p className="font-bold text-slate-900 dark:text-white mt-1">
                {employee?.center || employee?.branch || entity?.center || DEFAULT_INDIAN_CENTER}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {entity
                  ? `${entity.entityType} · ${entity.entityCode}`
                  : 'Leave requests route to your manager automatically'}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
              <BookOpen className="w-4 h-4 text-emerald-700" />
              <span>Company Policies</span>
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('policies')}
              className="text-xs font-bold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
            >
              Open Policy Portal →
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(['HR Policy', 'POSH Policy', 'IT Policy'] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                aria-label={`Open ${cat} PDF`}
                onClick={() => (onOpenPolicy ? onOpenPolicy(cat) : onNavigate('policies'))}
                className="p-3 rounded-lg bg-slate-50 hover:bg-blue-50 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-left flex items-center justify-between gap-2 cursor-pointer transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-slate-900 dark:text-white">{cat}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">View &amp; Acknowledge</p>
                </div>
                <FileText className="w-4 h-4 text-blue-700 dark:text-blue-400 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

interface MyAssetsViewProps {
  scopedData: ScopedEmployeeData;
  initialSearch?: string;
  onRaiseTicket: (assetId?: string) => void;
  onSubAssign?: (assetId: string, parentAssignmentId: string) => void;
  onReturnSubAssign?: (subAssignmentId: string, assetName: string) => void;
}

export const MyAssetsView: React.FC<MyAssetsViewProps> = ({
  scopedData,
  initialSearch = '',
  onRaiseTicket,
  onSubAssign,
  onReturnSubAssign,
}) => {
  const { session } = useSession();
  const [search, setSearch] = useState(initialSearch);

  const filteredAssets = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return scopedData.ownedAssets;
    return scopedData.ownedAssets.filter(
      ({ asset }) =>
        asset.name.toLowerCase().includes(q) ||
        asset.id.toLowerCase().includes(q) ||
        asset.serial.toLowerCase().includes(q) ||
        asset.category.toLowerCase().includes(q)
    );
  }, [scopedData.ownedAssets, search]);

  if (!session || !isSelfServiceEntityRole(session.role)) {
    return null;
  }

  return (
    <div className="space-y-4 pb-10" data-testid="my-assets-view">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">My Assets</h1>
          <p className="text-xs text-slate-500 mt-1">
            Showing {scopedData.ownedAssets.length} assigned{' '}
            {scopedData.ownedAssets.length === 1 ? 'asset' : 'assets'} for {session.fullName}
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
            <Search className="w-3.5 h-3.5" />
          </span>
          <input
            type="text"
            aria-label="Search my assigned assets"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search my assets..."
            className="w-full pl-8 pr-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
      </div>

      {filteredAssets.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-10 text-center text-xs text-slate-500 dark:text-slate-400">
          {scopedData.ownedAssets.length === 0
            ? 'You currently have no assets assigned to your account.'
            : 'No assigned assets match your search.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredAssets.map((item) => (
            <AssetCard
              key={item.asset.id}
              assetSummary={item}
              onRaiseTicket={onRaiseTicket}
              onSubAssign={onSubAssign}
              onReturnSubAssign={onReturnSubAssign}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const AssetCard: React.FC<{
  assetSummary: OwnedAssetSummary;
  onRaiseTicket: (assetId: string) => void;
  onSubAssign?: (assetId: string, parentAssignmentId: string) => void;
  onReturnSubAssign?: (subAssignmentId: string, assetName: string) => void;
}> = ({ assetSummary, onRaiseTicket, onSubAssign, onReturnSubAssign }) => {
  const { asset, assignedDate, assignmentId, custodyLevel, subAssignedToName, subAssignmentId } =
    assetSummary;
  const badgeClass =
    ASSET_STATUS_PILL[asset.status] || 'bg-slate-100 text-slate-700 border-slate-200';

  return (
    <div
      data-testid={`my-asset-card-${asset.id}`}
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-3 hover:shadow-sm transition-shadow"
    >
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-extrabold text-slate-900 dark:text-white truncate">{asset.name}</h3>
            <p className="text-[11px] font-mono text-slate-500 mt-0.5">
              {asset.id} · S/N: {asset.serial}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${badgeClass}`}
            >
              {asset.status}
            </span>
            {custodyLevel && (
              <span
                className={`px-2 py-0.5 rounded text-[9px] font-bold border ${
                  custodyLevel === 'Sub-Assigned'
                    ? 'bg-violet-50 text-violet-800 border-violet-200'
                    : 'bg-sky-50 text-sky-800 border-sky-200'
                }`}
              >
                {custodyLevel} Custody
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] text-slate-600">
          <div className="flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate">{asset.category}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="tabular-nums">Assigned: {assignedDate}</span>
          </div>
          <div className="flex items-center gap-1.5 col-span-2">
            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate">{asset.location}</span>
          </div>
        </div>

        {subAssignedToName && (
          <div className="p-2 rounded-lg bg-violet-50 border border-violet-200 text-[11px] text-violet-900 font-semibold">
            Sub-Assigned Custody: <strong>{subAssignedToName}</strong>
          </div>
        )}
      </div>

      <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
          Condition: <strong className="text-slate-700 dark:text-slate-200">{asset.condition}</strong>
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {custodyLevel === 'Primary' && !subAssignmentId && assignmentId && onSubAssign && (
            <button
              type="button"
              onClick={() => onSubAssign(asset.id, assignmentId)}
              aria-label={`Sub-Assign ${asset.name}`}
              className="px-2.5 py-1.5 bg-violet-100 hover:bg-violet-200 text-violet-900 border border-violet-200 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
            >
              <Share2 className="w-3 h-3" />
              <span>Sub-Assign</span>
            </button>
          )}
          {subAssignmentId && onReturnSubAssign && (
            <button
              type="button"
              onClick={() => onReturnSubAssign(subAssignmentId, asset.name)}
              aria-label={`Return Sub-Assign for ${asset.name}`}
              className="px-2.5 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-200 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Return Sub-Assign</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onRaiseTicket(asset.id)}
            aria-label={`Raise Ticket for ${asset.name}`}
            className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 dark:bg-slate-800 dark:text-blue-400 dark:border-slate-700 rounded-lg text-[11px] font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <LifeBuoy className="w-3.5 h-3.5" />
            <span>Raise Ticket</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export const EmployeeProfileView: React.FC<{
  scopedData: ScopedEmployeeData;
  centers?: EmployeeCenterRecord[];
  onNotify?: (msg: string, type?: ToastMessage['type']) => void;
}> = ({ scopedData, centers = [], onNotify }) => {
  const { session } = useSession();
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [reqPhone, setReqPhone] = useState('');
  const [reqEmail, setReqEmail] = useState('');
  const [reqCenter, setReqCenter] = useState('');
  const [reqReason, setReqReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!session || !isSelfServiceEntityRole(session.role)) {
    return null;
  }

  const emp = scopedData.employee;
  const ent = scopedData.entity;

  const openRequestModal = () => {
    setReqPhone(emp?.phone || '');
    setReqEmail(emp?.email || session.email);
    setReqCenter(emp?.center || emp?.branch || DEFAULT_INDIAN_CENTER);
    setReqReason('');
    setEditModalOpen(true);
  };

  const handleSubmitProfileChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emp) return;
    setSubmitting(true);
    try {
      await apiClient.submitProfileChange(emp.id, {
        reason: reqReason.trim() || 'Employee profile update request',
        payload: {
          phone: reqPhone.trim() || undefined,
          email: reqEmail.trim() || undefined,
          center: reqCenter.trim() || undefined,
        },
      });
      setEditModalOpen(false);
      onNotify?.('Profile update request submitted to your Reporting Manager for approval.');
    } catch (err) {
      onNotify?.(
        err instanceof ApiError ? err.message : 'Failed to submit profile change request',
        'error'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-4 pb-10" data-testid="employee-profile-view">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">My Profile</h1>
          <p className="text-xs text-slate-500 mt-1">
            Personal account, center, and reporting details
          </p>
        </div>
        {emp && (
          <button
            type="button"
            onClick={openRequestModal}
            className="px-3.5 py-2 bg-[#3f3f46] hover:bg-[#27272a] text-white rounded-lg text-xs font-bold shadow-sm cursor-pointer self-start sm:self-auto"
          >
            Request Profile Update
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-6 space-y-5">
        <div className="flex items-center gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-slate-800 border border-blue-200 dark:border-slate-700 text-blue-700 dark:text-blue-400 flex items-center justify-center font-extrabold text-base">
            {session.fullName
              .split(' ')
              .map((p) => p[0])
              .join('')
              .slice(0, 2)
              .toUpperCase()}
          </div>
          <div>
            <h2 className="text-base font-extrabold text-slate-900 dark:text-white">{session.fullName}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {emp?.designation || ent?.designation || ent?.entityType || session.role}{' '}
              {emp?.department || ent?.department ? `· ${emp?.department || ent?.department}` : ''}
            </p>
          </div>
          <span className="ml-auto px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 inline-flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" />
            {session.role}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <p className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <UserCheck className="w-3 h-3" /> Login ID
            </p>
            <p className="font-mono font-bold text-slate-800 dark:text-slate-100 mt-1">{session.loginId}</p>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <p className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <Briefcase className="w-3 h-3" /> {ent ? `${ent.entityType} ID` : 'Employee ID'}
            </p>
            <p className="font-mono font-bold text-slate-800 dark:text-slate-100 mt-1">
              {emp?.employeeId || ent?.entityCode || session.employeeId || '—'}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <p className="text-[10px] font-bold uppercase text-slate-500 flex items-center gap-1">
              <Mail className="w-3 h-3" /> Email
            </p>
            <p className="font-semibold text-slate-800 mt-1">{emp?.email || ent?.email || session.email}</p>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <p className="text-[10px] font-bold uppercase text-slate-500 flex items-center gap-1">
              <Phone className="w-3 h-3" /> Phone
            </p>
            <p className="font-semibold text-slate-800 mt-1">{emp?.phone || ent?.phone || '—'}</p>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <p className="text-[10px] font-bold uppercase text-slate-500 flex items-center gap-1">
              <Building2 className="w-3 h-3" /> Department &amp; Center
            </p>
            <p className="font-semibold text-slate-800 mt-1">
              {emp
                ? `${emp.department} · ${emp.center || emp.branch}`
                : ent
                ? `${ent.department || ent.entityType} · ${ent.center || DEFAULT_INDIAN_CENTER}`
                : '—'}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <p className="text-[10px] font-bold uppercase text-slate-500 flex items-center gap-1">
              <UserCheck className="w-3 h-3" /> Reporting Manager
            </p>
            <p className="font-semibold text-slate-800 mt-1">
              {emp?.reportingManagerName || ent?.reportingManagerName || '—'}
            </p>
            {emp?.reportingManagerEmail && (
              <p className="text-[11px] text-slate-500 truncate">{emp.reportingManagerEmail}</p>
            )}
          </div>
          {ent?.entityType === 'Freelancer' && (ent.projectName || ent.projectNo || ent.eicName) && (
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 sm:col-span-2">
              <p className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">Project &amp; Fieldwork Assignment</p>
              <p className="font-semibold text-slate-800 dark:text-slate-100 mt-1">
                {[ent.projectName, ent.projectNo ? `Job: ${ent.projectNo}` : '', ent.eicName ? `Assigned Employee: ${ent.eicName}` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          )}
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 sm:col-span-2">
            <p className="text-[10px] font-bold uppercase text-slate-500 flex items-center gap-1">
              <Laptop className="w-3 h-3" /> Assigned Assets
            </p>
            <p className="font-bold text-slate-800 mt-1 tabular-nums">
              {scopedData.ownedAssets.length} active
            </p>
          </div>
        </div>
      </div>

      {editModalOpen && emp && (
        <ModalShell
          title="Request Profile Update"
          icon={<UserCheck className="w-4 h-4 text-emerald-400" />}
          headerClass="bg-[#3f3f46]"
          maxWidth="max-w-md"
          onClose={() => setEditModalOpen(false)}
        >
          <form onSubmit={handleSubmitProfileChange} className="p-6 space-y-4 bg-white">
            <p className="text-xs text-slate-600">
              Changes will be sent to your Reporting Manager (
              <strong>{emp.reportingManagerName || 'Manager'}</strong>) for approval.
            </p>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Mobile Phone
              </label>
              <input
                type="text"
                value={reqPhone}
                onChange={(e) => setReqPhone(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Email Address
              </label>
              <input
                type="email"
                value={reqEmail}
                onChange={(e) => setReqEmail(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Center
              </label>
              {centers.length > 0 ? (
                <SearchableCenterSelect
                  centers={centers}
                  value={reqCenter}
                  onChange={setReqCenter}
                />
              ) : (
                <input
                  type="text"
                  value={reqCenter}
                  onChange={(e) => setReqCenter(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
              )}
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Reason for Change *
              </label>
              <textarea
                rows={2}
                required
                minLength={5}
                value={reqReason}
                onChange={(e) => setReqReason(e.target.value)}
                placeholder="Explain why your profile information needs updating..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 bg-[#3f3f46] hover:bg-[#27272a] text-white rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Submit for Approval'}
              </button>
            </div>
          </form>
        </ModalShell>
      )}
    </div>
  );
};
