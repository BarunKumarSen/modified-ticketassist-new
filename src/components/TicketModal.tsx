import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CalendarClock, CheckCircle2, Clock, LifeBuoy, Send, ShieldCheck } from 'lucide-react';
import type { ThemePalette } from '../types/asset';
import type { PublicHoliday } from '../types/attendance';
import type { SupportTicket, TicketPriority } from '../types/ticket';
import { apiClient } from '../api/client';
import { useSession } from '../auth/SessionContext';
import { THEME_PALETTES } from '../utils/assetMath';
import { canRaiseTicketOnDate } from '../utils/holidayRollover';
import {
  canUserRaiseTicket,
  formatTicketTimestamp,
  hasAdminSlotOverlap,
  type ScopedEmployeeData,
  type TicketFormInput,
  type TicketValidationErrors,
  validateTicketInput,
} from '../utils/ticketLogic';
import { ModalShell } from './AssetModals';

interface TicketModalProps {
  scopedData: ScopedEmployeeData;
  theme: ThemePalette;
  holidays?: PublicHoliday[];
  existingTickets?: SupportTicket[];
  preselectedAssetId?: string;
  onClose: () => void;
  onSubmitTicket: (
    input: TicketFormInput
  ) =>
    | Promise<{ ok: true; ticket: SupportTicket } | { ok: false; errors: TicketValidationErrors }>
    | { ok: true; ticket: SupportTicket }
    | { ok: false; errors: TicketValidationErrors };
}

function getTodayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export const TicketModal: React.FC<TicketModalProps> = ({
  scopedData,
  theme,
  holidays: propHolidays,
  existingTickets = [],
  preselectedAssetId,
  onClose,
  onSubmitTicket,
}) => {
  const { session } = useSession();
  const palette = THEME_PALETTES[theme];
  const assetSelectRef = useRef<HTMLSelectElement>(null);

  const resolvedEmployee = scopedData.employee;
  const resolvedEntity = scopedData.entity || null;
  const assignedAssets = scopedData.assets;

  const isPreselectedOwned = Boolean(
    preselectedAssetId && assignedAssets.some((a) => a.id === preselectedAssetId)
  );
  const hasInvalidPreselection = Boolean(preselectedAssetId && !isPreselectedOwned);

  const [holidays, setHolidays] = useState<PublicHoliday[]>(propHolidays || []);
  const [assetId, setAssetId] = useState(isPreselectedOwned ? preselectedAssetId! : '');
  const [priority, setPriority] = useState<TicketPriority | ''>('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [requestedDate, setRequestedDate] = useState(getTodayDateStr);
  const [requestedStartTime, setRequestedStartTime] = useState('');
  const [requestedDurationMins, setRequestedDurationMins] = useState('30');
  const [submitting, setSubmitting] = useState(false);

  const [errors, setErrors] = useState<TicketValidationErrors>(() =>
    hasInvalidPreselection
      ? {
          assetId: `Asset ${preselectedAssetId} is not assigned to your account. Please select an available asset.`,
        }
      : {}
  );
  const [touched, setTouched] = useState<{
    assetId?: boolean;
    priority?: boolean;
    subject?: boolean;
    description?: boolean;
  }>(() => (hasInvalidPreselection ? { assetId: true } : {}));

  useEffect(() => {
    if (propHolidays && propHolidays.length > 0) {
      setHolidays(propHolidays);
      return;
    }
    let active = true;
    const year = Number(requestedDate.slice(0, 4)) || new Date().getFullYear();
    apiClient
      .listHolidays({ year })
      .then((res) => {
        if (active) setHolidays(res.holidays);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [propHolidays, requestedDate]);

  const canRaise = canUserRaiseTicket(session);
  const isMgr = Boolean(
    session &&
      (session.role === 'Manager' ||
        session.role === 'Department Manager' ||
        session.isManager)
  );
  const hasRequesterAccount =
    canRaise && (isMgr || Boolean(resolvedEmployee) || Boolean(resolvedEntity));

  const dayScheduleCheck = useMemo(() => {
    if (!session || !requestedDate) return { allowed: true as const };
    return canRaiseTicketOnDate({
      role: session.role,
      isManager: isMgr,
      dateStr: requestedDate,
      holidays,
    });
  }, [session, isMgr, requestedDate, holidays]);

  const slotOverlapCheck = useMemo(() => {
    if (isMgr || !requestedDate || !requestedStartTime) {
      return { overlapping: false };
    }
    return hasAdminSlotOverlap({
      candidateDate: requestedDate,
      candidateStartTime: requestedStartTime,
      candidateDurationMins: Number(requestedDurationMins) || 30,
      tickets: existingTickets,
    });
  }, [isMgr, requestedDate, requestedStartTime, requestedDurationMins, existingTickets]);

  const isSelectedAssetOwned = useMemo(() => {
    if (!assetId.trim()) return false;
    return assignedAssets.some((a) => a.id === assetId.trim());
  }, [assetId, assignedAssets]);

  const selectedAsset = isSelectedAssetOwned
    ? assignedAssets.find((a) => a.id === assetId.trim())
    : undefined;

  const ownershipViolationError =
    assetId.trim() && !isSelectedAssetOwned
      ? 'Selected asset is not currently assigned to your account.'
      : undefined;

  const displayedAssetError = ownershipViolationError || errors.assetId;

  const buildInput = (overrides: Partial<TicketFormInput> = {}): TicketFormInput => ({
    assetId,
    priority,
    subject,
    description,
    requestedDate,
    requestedStartTime: requestedStartTime || undefined,
    requestedDurationMins: requestedStartTime ? Number(requestedDurationMins) || 30 : undefined,
    ...overrides,
  });

  const runFieldValidation = (
    nextValues: TicketFormInput,
    field?: keyof TicketValidationErrors
  ) => {
    const result = validateTicketInput(nextValues, assignedAssets, session, resolvedEmployee, {
      dateStr: nextValues.requestedDate || requestedDate,
      holidays,
      existingTickets,
      resolvedEntity,
    });
    if (field) {
      setErrors((prev) => ({
        ...prev,
        form: result.errors.form,
        [field]: result.errors[field],
      }));
    } else {
      setErrors(result.errors);
    }
    return result;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ assetId: true, priority: true, subject: true, description: true });

    const input = buildInput();
    const validation = validateTicketInput(input, assignedAssets, session, resolvedEmployee, {
      dateStr: requestedDate,
      holidays,
      existingTickets,
      resolvedEntity,
    });

    if (!validation.valid || !isSelectedAssetOwned) {
      const nextErrors: TicketValidationErrors = { ...validation.errors };
      if (!assetId.trim() && !nextErrors.assetId) {
        nextErrors.assetId = 'Please select an asset for this ticket.';
      } else if (assetId.trim() && !isSelectedAssetOwned && !nextErrors.assetId) {
        nextErrors.assetId = 'Selected asset is not currently assigned to your account.';
      }
      setErrors(nextErrors);
      if (nextErrors.assetId) {
        assetSelectRef.current?.focus();
      }
      return;
    }

    setSubmitting(true);
    try {
      const result = await onSubmitTicket(input);
      if (!result.ok) {
        setErrors(result.errors);
        if (result.errors.assetId) {
          assetSelectRef.current?.focus();
        }
        return;
      }
      setErrors({});
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const canInteract = hasRequesterAccount && assignedAssets.length > 0;
  const isSubmitBlocked =
    !canInteract ||
    Boolean(ownershipViolationError) ||
    !dayScheduleCheck.allowed ||
    slotOverlapCheck.overlapping ||
    submitting;

  return (
    <ModalShell
      title="Raise Support Ticket"
      icon={<LifeBuoy className="w-4 h-4 text-emerald-400" />}
      headerClass={palette.modalHeader}
      maxWidth="max-w-lg"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} noValidate className="p-6 space-y-4 bg-white overflow-y-auto max-h-[84vh]">
        {!canRaise && (
          <div
            role="alert"
            className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Only authorized Employee, Manager, or Personnel accounts can raise a support ticket.</span>
          </div>
        )}

        {canRaise && !isMgr && !resolvedEmployee && !resolvedEntity && (
          <div
            role="alert"
            className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Your account is not linked to an active Employee or Personnel record. Contact an administrator.
            </span>
          </div>
        )}

        {hasRequesterAccount && (
          <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="text-slate-600 truncate">
                {resolvedEntity ? resolvedEntity.entityType : isMgr ? 'Manager' : 'Employee'}:{' '}
                <strong className="text-slate-900">
                  {resolvedEmployee?.name || resolvedEntity?.name || session?.fullName}
                </strong>
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-600 tabular-nums">
                <Clock className="w-3 h-3 text-slate-400" />
                {formatTicketTimestamp(new Date().toISOString()).full}
              </span>
              {(resolvedEmployee?.employeeId || resolvedEntity?.entityCode || session?.employeeId) && (
                <span className="text-[10px] font-mono font-bold text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-200">
                  {resolvedEmployee?.employeeId || resolvedEntity?.entityCode || session?.employeeId}
                </span>
              )}
            </div>
          </div>
        )}

        {!dayScheduleCheck.allowed && (
          <div
            role="alert"
            className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="font-semibold">{dayScheduleCheck.reason}</span>
          </div>
        )}

        {slotOverlapCheck.overlapping && slotOverlapCheck.conflictingTicket && (
          <div
            role="alert"
            className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2"
          >
            <CalendarClock className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="font-semibold">
              Admin slot locked on {slotOverlapCheck.conflictingTicket.workOrderDate} (
              {slotOverlapCheck.conflictingTicket.workOrderStartTime}–
              {slotOverlapCheck.conflictingTicket.workOrderEndTime}). Choose a non-overlapping slot.
            </span>
          </div>
        )}

        {hasRequesterAccount && assignedAssets.length === 0 && (
          <div
            role="alert"
            className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              You do not have any assets currently assigned to your account. A support ticket must
              be linked to an assigned asset.
            </span>
          </div>
        )}

        {errors.form && canInteract && dayScheduleCheck.allowed && !slotOverlapCheck.overlapping && (
          <p role="alert" className="text-xs font-semibold text-rose-600">
            {errors.form}
          </p>
        )}

        <div>
          <label
            htmlFor="ticket-asset-id"
            className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
          >
            {isMgr ? 'Asset *' : 'Assigned Asset *'}
          </label>
          <select
            ref={assetSelectRef}
            id="ticket-asset-id"
            value={assetId}
            disabled={!canInteract}
            aria-required="true"
            aria-invalid={Boolean(displayedAssetError)}
            aria-describedby={
              displayedAssetError ? 'ticket-asset-error ticket-asset-help' : 'ticket-asset-help'
            }
            onChange={(e) => {
              const next = e.target.value;
              setAssetId(next);
              setTouched((prev) => ({ ...prev, assetId: true }));
              runFieldValidation(buildInput({ assetId: next }), 'assetId');
            }}
            onBlur={() => {
              setTouched((prev) => ({ ...prev, assetId: true }));
              runFieldValidation(buildInput(), 'assetId');
            }}
            className={`w-full px-3 py-2 bg-slate-50 border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-100 disabled:text-slate-400 ${
              displayedAssetError ? 'border-rose-500' : 'border-slate-200'
            }`}
          >
            <option value="">
              {assignedAssets.length === 0
                ? 'No assets available'
                : '-- Select an asset --'}
            </option>
            {assignedAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name} ({asset.id} · S/N: {asset.serial})
              </option>
            ))}
          </select>
          <p id="ticket-asset-help" className="mt-1 text-[10px] text-slate-500">
            {isMgr
              ? `Managers can raise tickets 365 days/year excluding Indian National Holidays (${assignedAssets.length} active assets).`
              : `Mon–Sat ticket creation (blocked on Sundays & National Holidays) · ${assignedAssets.length} assigned ${
                  assignedAssets.length === 1 ? 'asset' : 'assets'
                }.`}
          </p>
          {displayedAssetError && (
            <p
              id="ticket-asset-error"
              role="alert"
              className="mt-1 text-[11px] font-semibold text-rose-600"
            >
              {displayedAssetError}
            </p>
          )}
        </div>

        {selectedAsset && (
          <div
            data-testid="selected-asset-ownership-card"
            className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs flex items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <p className="font-bold text-slate-800 truncate">{selectedAsset.name}</p>
              <p className="text-[10px] text-slate-500 font-mono">
                {selectedAsset.id} · {selectedAsset.category} · {selectedAsset.location}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#dcfce7] text-[#166534] border border-[#bbf7d0]">
                <CheckCircle2 className="w-3 h-3" />
                {isMgr ? 'Eligible Asset' : 'Assigned to you'}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#dbeafe] text-[#1e40af] border border-[#bfdbfe]">
                {selectedAsset.condition}
              </span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
          <div>
            <label
              htmlFor="ticket-req-date"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Ticket Date *
            </label>
            <input
              id="ticket-req-date"
              type="date"
              value={requestedDate}
              disabled={!canInteract}
              onChange={(e) => setRequestedDate(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono"
            />
          </div>
          <div>
            <label
              htmlFor="ticket-req-time"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Preferred Time
            </label>
            <input
              id="ticket-req-time"
              type="time"
              value={requestedStartTime}
              disabled={!canInteract}
              onChange={(e) => setRequestedStartTime(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono"
            />
          </div>
          <div>
            <label
              htmlFor="ticket-req-duration"
              className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
            >
              Est. Mins
            </label>
            <input
              id="ticket-req-duration"
              type="number"
              min={1}
              max={1440}
              value={requestedDurationMins}
              disabled={!canInteract || !requestedStartTime}
              onChange={(e) => setRequestedDurationMins(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="ticket-priority"
            className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
          >
            Priority *
          </label>
          <select
            id="ticket-priority"
            value={priority}
            disabled={!canInteract}
            aria-required="true"
            aria-invalid={Boolean(errors.priority)}
            aria-describedby={errors.priority ? 'ticket-priority-error' : undefined}
            onChange={(e) => {
              const next = e.target.value as TicketPriority | '';
              setPriority(next);
              setTouched((prev) => ({ ...prev, priority: true }));
              runFieldValidation(buildInput({ priority: next }), 'priority');
            }}
            onBlur={() => {
              setTouched((prev) => ({ ...prev, priority: true }));
              runFieldValidation(buildInput(), 'priority');
            }}
            className={`w-full px-3 py-2 bg-white border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:bg-slate-100 ${
              errors.priority ? 'border-rose-500' : 'border-slate-300'
            }`}
          >
            <option value="">-- Select priority --</option>
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
          </select>
          {errors.priority && (
            <p
              id="ticket-priority-error"
              role="alert"
              className="mt-1 text-[11px] font-semibold text-rose-600"
            >
              {errors.priority}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="ticket-subject"
            className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
          >
            Subject * (5–100 chars)
          </label>
          <input
            id="ticket-subject"
            type="text"
            disabled={!canInteract}
            value={subject}
            maxLength={100}
            aria-required="true"
            aria-invalid={Boolean(errors.subject)}
            aria-describedby={errors.subject ? 'ticket-subject-error' : undefined}
            onChange={(e) => {
              const next = e.target.value;
              setSubject(next);
              if (touched.subject || errors.subject) {
                runFieldValidation(buildInput({ subject: next }), 'subject');
              }
            }}
            onBlur={() => {
              setTouched((prev) => ({ ...prev, subject: true }));
              runFieldValidation(buildInput(), 'subject');
            }}
            placeholder="Brief summary of the issue (e.g. Battery drains rapidly)"
            className={`w-full px-3 py-2 bg-white border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:bg-slate-100 ${
              errors.subject ? 'border-rose-500' : 'border-slate-300'
            }`}
          />
          {errors.subject && (
            <p
              id="ticket-subject-error"
              role="alert"
              className="mt-1 text-[11px] font-semibold text-rose-600"
            >
              {errors.subject}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="ticket-description"
            className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
          >
            Description * (10–1000 chars)
          </label>
          <textarea
            id="ticket-description"
            rows={4}
            disabled={!canInteract}
            value={description}
            maxLength={1000}
            aria-required="true"
            aria-invalid={Boolean(errors.description)}
            aria-describedby={errors.description ? 'ticket-description-error' : undefined}
            onChange={(e) => {
              const next = e.target.value;
              setDescription(next);
              if (touched.description || errors.description) {
                runFieldValidation(buildInput({ description: next }), 'description');
              }
            }}
            onBlur={() => {
              setTouched((prev) => ({ ...prev, description: true }));
              runFieldValidation(buildInput(), 'description');
            }}
            placeholder="Describe the hardware or software issue in detail..."
            className={`w-full px-3 py-2 bg-white border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:bg-slate-100 ${
              errors.description ? 'border-rose-500' : 'border-slate-300'
            }`}
          />
          {errors.description && (
            <p
              id="ticket-description-error"
              role="alert"
              className="mt-1 text-[11px] font-semibold text-rose-600"
            >
              {errors.description}
            </p>
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
            disabled={isSubmitBlocked}
            className={`${palette.primaryBtn} ${palette.primaryBtnHover} disabled:opacity-40 disabled:cursor-not-allowed px-6 py-2 rounded-lg text-xs font-semibold shadow-md flex items-center gap-1.5 cursor-pointer`}
          >
            <Send className="w-3.5 h-3.5" />
            <span>{submitting ? 'Submitting...' : 'Submit Ticket'}</span>
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

