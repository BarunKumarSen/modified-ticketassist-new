import React, { useEffect, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CheckCircle2,
  Clock,
  Download,
  Inbox,
  LifeBuoy,
  Lock,
  Mail,
  Search,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import type { AssetOSState } from '../types/asset';
import type {
  SupportTicket,
  TicketApprovalStatus,
  TicketStatus,
} from '../types/ticket';
import { useSession } from '../auth/SessionContext';
import {
  computeTicketStatusSummary,
  computeWorkOrderEndTime,
  filterTickets,
  formatTicketTimestamp,
  hasAdminSlotOverlap,
  sortTicketsFcfs,
  transitionTicketStatus,
} from '../utils/ticketLogic';
import { paginateItems, toCSV } from '../utils/assetMath';
import { TablePaginationFooter } from './OperationsViews';
import { ModalShell } from './AssetModals';

interface SupportTicketsViewProps {
  state: AssetOSState;
  onUpdateTicket: (updated: SupportTicket) => void;
  onReorderTickets?: (orderedIds: string[]) => Promise<void> | void;
  onScheduleWorkOrder?: (
    ticketId: string,
    payload: { workOrderDate: string; workOrderStartTime: string; workOrderDurationMins: number }
  ) => Promise<void> | void;
  onCloseTicket?: (ticket: SupportTicket) => Promise<void> | void;
  onSendTicketMail?: (ticket: SupportTicket) => Promise<void> | void;
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const STATUS_BADGES: Record<
  TicketStatus,
  { classes: string; dot: string; label: string }
> = {
  Requested: {
    classes: 'bg-sky-50 text-sky-800 border-sky-200',
    dot: 'bg-sky-500',
    label: 'Requested',
  },
  Open: {
    classes: 'bg-amber-100 text-amber-800 border-amber-300',
    dot: 'bg-amber-500',
    label: 'Open',
  },
  Approved: {
    classes: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    dot: 'bg-emerald-500',
    label: 'Approved',
  },
  Rejected: {
    classes: 'bg-red-100 text-red-800 border-red-300',
    dot: 'bg-red-500',
    label: 'Rejected',
  },
  Closed: {
    classes: 'bg-blue-100 text-blue-800 border-blue-300',
    dot: 'bg-blue-500',
    label: 'Closed',
  },
};

const APPROVAL_BADGES: Record<
  TicketApprovalStatus,
  { classes: string; icon: 'pending' | 'approved' | 'rejected'; label: string }
> = {
  Pending: {
    classes: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    icon: 'pending',
    label: 'Pending',
  },
  Approved: {
    classes: 'bg-green-100 text-green-800 border-green-300',
    icon: 'approved',
    label: 'Approved',
  },
  Rejected: {
    classes: 'bg-red-100 text-red-800 border-red-300',
    icon: 'rejected',
    label: 'Rejected',
  },
};

function todayIsoDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export const SupportTicketsView: React.FC<SupportTicketsViewProps> = ({
  state,
  onUpdateTicket,
  onReorderTickets,
  onScheduleWorkOrder,
  onCloseTicket,
  onSendTicketMail,
  onNotify,
}) => {
  const { session } = useSession();
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [rejectingTicket, setRejectingTicket] = useState<SupportTicket | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');

  // Work Order Scheduling Modal state
  const [schedulingTicket, setSchedulingTicket] = useState<SupportTicket | null>(null);
  const [woDate, setWoDate] = useState(todayIsoDate());
  const [woStartTime, setWoStartTime] = useState('10:00');
  const [woDurationMins, setWoDurationMins] = useState<number>(60);
  const [woError, setWoError] = useState('');
  const [woSaving, setWoSaving] = useState(false);

  const chartRef = useRef<HTMLCanvasElement>(null);

  const summary = computeTicketStatusSummary(state.tickets);
  const fcfsOrdered = sortTicketsFcfs(state.tickets);
  const filtered = filterTickets(
    state.tickets,
    search,
    statusFilter,
    state.employees,
    state.assets,
    state.entities || []
  );
  const paged = paginateItems(filtered, page, pageSize);
  const canReorder = Boolean(onReorderTickets) && !search.trim() && statusFilter === 'ALL';

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = new Chart(chartRef.current, {
      type: 'doughnut',
      data: {
        labels: ['Requested', 'Open', 'Approved', 'Rejected', 'Closed'],
        datasets: [
          {
            data: [
              summary.requested,
              summary.open,
              summary.approved,
              summary.rejected,
              summary.closed,
            ],
            backgroundColor: ['#ca8a04', '#eab308', '#22c55e', '#ef4444', '#3b82f6'],
            borderWidth: 0,
            hoverOffset: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 8, usePointStyle: true, font: { size: 10 } },
          },
        },
      },
    });
    return () => chart.destroy();
  }, [summary.requested, summary.open, summary.approved, summary.rejected, summary.closed]);

  if (!session || (session.role !== 'Administrator' && session.role !== 'Super Admin')) {
    return (
      <div
        role="alert"
        className="max-w-lg mx-auto mt-12 bg-white rounded-2xl border border-rose-200 shadow-sm p-8 text-center space-y-3"
      >
        <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-700 mx-auto flex items-center justify-center">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <p className="text-xs font-bold uppercase tracking-widest text-rose-600">403 Forbidden</p>
        <h2 className="text-lg font-extrabold text-slate-900">Administrator Access Required</h2>
        <p className="text-xs text-slate-600">
          Only Administrators can view and manage the Support Tickets dashboard.
        </p>
      </div>
    );
  }

  const handleCloseAction = async (ticket: SupportTicket) => {
    if (onCloseTicket) {
      await onCloseTicket(ticket);
      return;
    }
    const res = transitionTicketStatus({ ticket, action: 'close', session });
    if (!res.ok) {
      onNotify(res.error, 'error');
      return;
    }
    onUpdateTicket(res.ticket);
    onNotify(`Ticket ${ticket.id} closed`, 'success');
  };

  const openScheduleModal = (ticket: SupportTicket) => {
    setSchedulingTicket(ticket);
    setWoDate(ticket.workOrderDate || ticket.requestedDate || todayIsoDate());
    setWoStartTime(ticket.workOrderStartTime || ticket.requestedStartTime || '10:00');
    setWoDurationMins(ticket.workOrderDurationMins || ticket.requestedDurationMins || 60);
    setWoError('');
  };

  const liveEndTime = computeWorkOrderEndTime(woStartTime, woDurationMins);
  const liveOverlap = schedulingTicket
    ? hasAdminSlotOverlap({
        candidateDate: woDate,
        candidateStartTime: woStartTime,
        candidateDurationMins: woDurationMins,
        tickets: state.tickets,
        ignoreTicketId: schedulingTicket.id,
      })
    : { overlapping: false };

  const handleConfirmWorkOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schedulingTicket || woSaving) return;
    if (!woDate || !woStartTime || !Number.isFinite(woDurationMins) || woDurationMins < 1) {
      setWoError('Provide a valid date, start time, and duration in minutes (minimum 1).');
      return;
    }
    if (!liveEndTime) {
      setWoError('Work Order duration extends past midnight or start time is invalid.');
      return;
    }
    if (liveOverlap.overlapping) {
      setWoError(
        `Admin slot locked: ${liveOverlap.conflictingTicket?.workOrderDate} ${liveOverlap.conflictingTicket?.workOrderStartTime}–${liveOverlap.conflictingTicket?.workOrderEndTime} is already booked.`
      );
      return;
    }
    if (onScheduleWorkOrder) {
      setWoSaving(true);
      try {
        await onScheduleWorkOrder(schedulingTicket.id, {
          workOrderDate: woDate,
          workOrderStartTime: woStartTime,
          workOrderDurationMins: Math.round(woDurationMins),
        });
        setSchedulingTicket(null);
      } catch (err) {
        setWoError(err instanceof Error ? err.message : 'Failed to schedule Work Order');
      } finally {
        setWoSaving(false);
      }
      return;
    }
    const res = transitionTicketStatus({
      ticket: schedulingTicket,
      action: 'approve',
      session,
      workOrderDate: woDate,
      workOrderStartTime: woStartTime,
      workOrderDurationMins: Math.round(woDurationMins),
      allTickets: state.tickets,
    });
    if (!res.ok) {
      setWoError(res.error);
      return;
    }
    onUpdateTicket(res.ticket);
    onNotify(`Work Order scheduled for ticket ${schedulingTicket.id}`, 'success');
    setSchedulingTicket(null);
  };

  const handleMoveQueue = (ticketId: string, direction: -1 | 1) => {
    if (!onReorderTickets) return;
    const ids = fcfsOrdered.map((t) => t.id);
    const idx = ids.indexOf(ticketId);
    const swapIdx = idx + direction;
    if (idx < 0 || swapIdx < 0 || swapIdx >= ids.length) return;
    const nextIds = [...ids];
    [nextIds[idx], nextIds[swapIdx]] = [nextIds[swapIdx], nextIds[idx]];
    void onReorderTickets(nextIds);
  };

  const handleConfirmReject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingTicket) return;
    const res = transitionTicketStatus({
      ticket: rejectingTicket,
      action: 'reject',
      session,
      reason: rejectReason,
    });
    if (!res.ok) {
      setRejectError(res.error);
      return;
    }
    onUpdateTicket(res.ticket);
    onNotify(`Ticket ${rejectingTicket.id} rejected`, 'info');
    setRejectingTicket(null);
    setRejectReason('');
    setRejectError('');
  };

  const handleExportCSV = () => {
    const csv = toCSV(
      [
        'Queue',
        'Ticket ID',
        'Created',
        'Employee',
        'Asset ID',
        'Asset',
        'Subject',
        'Work Order Date',
        'Slot Start',
        'Slot End',
        'Duration (mins)',
        'Employee Confirmed',
        'Status',
        'Approval',
        'Rejection Reason',
      ],
      filtered.map((t, idx) => {
        const emp = state.employees.find((e) => e.id === t.employeeId || e.employeeId === t.employeeId);
        const ent = !emp
          ? (state.entities || []).find(
              (e) => e.id === t.employeeId || e.entityCode.toUpperCase() === t.employeeId.toUpperCase()
            )
          : undefined;
        const asset = state.assets.find((a) => a.id === t.assetId);
        return [
          String(t.queueOrder || idx + 1),
          t.id,
          formatTicketTimestamp(t.createdAt).full,
          emp?.name || ent?.name || t.employeeId,
          t.assetId,
          asset?.name || t.assetId,
          t.subject,
          t.workOrderDate || '',
          t.workOrderStartTime || '',
          t.workOrderEndTime || '',
          t.workOrderDurationMins ? String(t.workOrderDurationMins) : '',
          t.employeeConfirmed ? 'Yes' : 'No',
          t.status,
          t.approvalStatus,
          t.rejectionReason || '',
        ];
      })
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'median-support-tickets.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 pb-10">
      {/* Header */}
      <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Support Tickets &amp; Work Orders</h1>
          <p className="text-xs text-slate-500 mt-1">
            FCFS queue (manual reorder enabled), minute-based Work Order slot locking &amp; dispatch mail control
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 no-print">
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
              <Search className="w-3.5 h-3.5" />
            </span>
            <input
              type="text"
              aria-label="Search support tickets"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search tickets, staff, assets..."
              className="w-56 pl-8 pr-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs dark:text-slate-100 focus:ring-2 focus:ring-blue-600 focus:outline-none"
            />
          </div>

          <select
            aria-label="Filter tickets by status"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as TicketStatus | 'ALL');
              setPage(1);
            }}
            className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-100 focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Statuses</option>
            <option value="Requested">Requested</option>
            <option value="Open">Open</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
            <option value="Closed">Closed</option>
          </select>

          <button
            type="button"
            onClick={handleExportCSV}
            className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-200 hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        </div>
      </div>

      {/* Summary Statistics Cards */}
      <div
        data-testid="ticket-status-summary"
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4"
      >
        <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-2">
            <div className="w-8 h-8 rounded-lg bg-slate-800 text-white flex items-center justify-center shadow-sm">
              <LifeBuoy className="w-4 h-4" />
            </div>
            <button
              type="button"
              onClick={() => {
                setStatusFilter('ALL');
                setPage(1);
              }}
              className="text-[11px] font-bold text-slate-700 dark:text-slate-300 hover:underline cursor-pointer"
            >
              All →
            </button>
          </div>
          <h3 className="text-2xl font-extrabold text-slate-900 dark:text-white tabular-nums">{summary.total}</h3>
          <p className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
            Total Tickets
          </p>
          <p className="text-[10px] text-slate-500 mt-1 tabular-nums">
            {summary.pendingApproval} pending review
          </p>
        </div>

        <div className="bg-sky-50 dark:bg-slate-900 p-4 rounded-xl border border-sky-200 dark:border-slate-800 hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-2">
            <div className="w-8 h-8 rounded-lg bg-sky-600 text-white flex items-center justify-center shadow-sm">
              <Clock className="w-4 h-4" />
            </div>
            <button
              type="button"
              onClick={() => {
                setStatusFilter('Requested');
                setPage(1);
              }}
              className="text-[11px] font-bold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
            >
              Filter →
            </button>
          </div>
          <h3 className="text-2xl font-extrabold text-sky-800 dark:text-white tabular-nums">
            {summary.requested}
          </h3>
          <p className="text-[10px] font-bold text-sky-700 dark:text-sky-400 uppercase tracking-wider">Requested</p>
          <p className="text-[10px] text-sky-700/80 dark:text-slate-400 mt-1 tabular-nums">
            {summary.requestedPct}% FCFS queue
          </p>
        </div>

        <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-2">
            <div className="w-8 h-8 rounded-lg bg-amber-600 text-white flex items-center justify-center shadow-sm">
              <Clock className="w-4 h-4" />
            </div>
            <button
              type="button"
              onClick={() => {
                setStatusFilter('Open');
                setPage(1);
              }}
              className="text-[11px] font-bold text-amber-800 hover:underline cursor-pointer"
            >
              Filter →
            </button>
          </div>
          <h3 className="text-2xl font-extrabold text-amber-800 tabular-nums">{summary.open}</h3>
          <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Open</p>
          <p className="text-[10px] text-amber-700/80 mt-1 tabular-nums">
            {summary.openPct}% of total tickets
          </p>
        </div>

        <div className="bg-[#dcfce7] p-4 rounded-xl border border-[#bbf7d0] hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-2">
            <div className="w-8 h-8 rounded-lg bg-[#166534] text-white flex items-center justify-center shadow-sm">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <button
              type="button"
              onClick={() => {
                setStatusFilter('Approved');
                setPage(1);
              }}
              className="text-[11px] font-bold text-[#166534] hover:underline cursor-pointer"
            >
              Filter →
            </button>
          </div>
          <h3 className="text-2xl font-extrabold text-[#166534] tabular-nums">
            {summary.approved}
          </h3>
          <p className="text-[10px] font-bold text-[#15803d] uppercase tracking-wider">Approved</p>
          <p className="text-[10px] text-[#15803d]/80 mt-1 tabular-nums">
            {summary.approvedPct}% of total tickets
          </p>
        </div>

        <div className="bg-red-50 p-4 rounded-xl border border-red-200 hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-2">
            <div className="w-8 h-8 rounded-lg bg-red-600 text-white flex items-center justify-center shadow-sm">
              <XCircle className="w-4 h-4" />
            </div>
            <button
              type="button"
              onClick={() => {
                setStatusFilter('Rejected');
                setPage(1);
              }}
              className="text-[11px] font-bold text-red-700 hover:underline cursor-pointer"
            >
              Filter →
            </button>
          </div>
          <h3 className="text-2xl font-extrabold text-red-700 tabular-nums">
            {summary.rejected}
          </h3>
          <p className="text-[10px] font-bold text-red-700 uppercase tracking-wider">Rejected</p>
          <p className="text-[10px] text-red-600/80 mt-1 tabular-nums">
            {summary.rejectedPct}% of total tickets
          </p>
        </div>

        <div className="bg-[#dbeafe] p-4 rounded-xl border border-[#bfdbfe] hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-2">
            <div className="w-8 h-8 rounded-lg bg-[#1e40af] text-white flex items-center justify-center shadow-sm">
              <Lock className="w-4 h-4" />
            </div>
            <button
              type="button"
              onClick={() => {
                setStatusFilter('Closed');
                setPage(1);
              }}
              className="text-[11px] font-bold text-[#1e40af] hover:underline cursor-pointer"
            >
              Filter →
            </button>
          </div>
          <h3 className="text-2xl font-extrabold text-[#1e40af] tabular-nums">{summary.closed}</h3>
          <p className="text-[10px] font-bold text-[#1d4ed8] uppercase tracking-wider">Closed</p>
          <p className="text-[10px] text-[#1d4ed8]/80 mt-1 tabular-nums">
            {summary.closedPct}% of total tickets
          </p>
        </div>
      </div>

      {/* Status Distribution Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col h-60">
          <h3 className="font-bold text-xs text-slate-800 dark:text-white mb-2">Ticket Status Breakdown</h3>
          {summary.total === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-xs">
              <Inbox className="w-6 h-6 mb-1.5 text-slate-300" />
              <span>No ticket data yet</span>
            </div>
          ) : (
            <div className="flex-1 relative min-h-0">
              <canvas ref={chartRef} />
            </div>
          )}
        </div>

        <div className="lg:col-span-2 bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-xs text-slate-800 dark:text-white mb-3">Status Distribution</h3>
            <div className="space-y-2.5">
              {(
                [
                  { label: 'Requested', count: summary.requested, pct: summary.requestedPct, bar: 'bg-sky-500' },
                  { label: 'Open', count: summary.open, pct: summary.openPct, bar: 'bg-amber-500' },
                  { label: 'Approved', count: summary.approved, pct: summary.approvedPct, bar: 'bg-emerald-500' },
                  { label: 'Rejected', count: summary.rejected, pct: summary.rejectedPct, bar: 'bg-red-500' },
                  { label: 'Closed', count: summary.closed, pct: summary.closedPct, bar: 'bg-blue-500' },
                ] as const
              ).map((row) => (
                <div key={row.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{row.label}</span>
                    <span className="font-mono text-slate-600 dark:text-slate-400 tabular-nums">
                      {row.count} ({row.pct}%)
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${row.bar} transition-all`}
                      style={{ width: `${row.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-slate-500 pt-3 border-t border-slate-100 dark:border-slate-800">
            Click any status KPI card above to filter the queue, or use Queue # arrows to reorder FCFS priority.
          </p>
        </div>
      </div>

      {/* Tickets Table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                <th className="px-4 py-3">Queue #</th>
                <th className="px-4 py-3">Ticket ID</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Asset</th>
                <th className="px-4 py-3">Subject &amp; Work Order</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Approval</th>
                <th className="px-4 py-3 text-right no-print">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {paged.items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                    {state.tickets.length === 0
                      ? 'No support tickets have been submitted yet.'
                      : 'No support tickets match the active filter.'}
                  </td>
                </tr>
              ) : (
                paged.items.map((t) => {
                  const emp = state.employees.find(
                    (e) => e.id === t.employeeId || e.employeeId === t.employeeId
                  );
                  const ent = !emp
                    ? (state.entities || []).find(
                        (e) =>
                          e.id === t.employeeId ||
                          e.entityCode.toUpperCase() === t.employeeId.toUpperCase()
                      )
                    : undefined;
                  const asset = state.assets.find((a) => a.id === t.assetId);
                  const statusMeta = STATUS_BADGES[t.status] || STATUS_BADGES.Requested;
                  const approvalMeta = APPROVAL_BADGES[t.approvalStatus] || APPROVAL_BADGES.Pending;
                  const fcfsIdx = fcfsOrdered.findIndex((item) => item.id === t.id);
                  const hasWorkOrder = Boolean(t.workOrderDate && t.workOrderStartTime);
                  const canSchedule = t.status === 'Requested' || t.status === 'Open' || (t.status === 'Approved' && !hasWorkOrder);

                  return (
                    <tr key={t.id} className="hover:bg-slate-50 transition-colors align-top">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <span className="font-mono font-bold text-slate-700 tabular-nums">
                            #{fcfsIdx >= 0 ? fcfsIdx + 1 : t.queueOrder || 1}
                          </span>
                          {canReorder && (
                            <div className="inline-flex flex-col">
                              <button
                                type="button"
                                disabled={fcfsIdx <= 0}
                                onClick={() => handleMoveQueue(t.id, -1)}
                                aria-label={`Move ticket ${t.id} up in queue`}
                                title="Move up in queue"
                                className="p-0.5 text-slate-500 hover:text-slate-900 disabled:opacity-30 cursor-pointer"
                              >
                                <ArrowUp className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                disabled={fcfsIdx < 0 || fcfsIdx >= fcfsOrdered.length - 1}
                                onClick={() => handleMoveQueue(t.id, 1)}
                                aria-label={`Move ticket ${t.id} down in queue`}
                                title="Move down in queue"
                                className="p-0.5 text-slate-500 hover:text-slate-900 disabled:opacity-30 cursor-pointer"
                              >
                                <ArrowDown className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                      <td
                        className="px-4 py-3 font-mono font-bold text-slate-700 whitespace-nowrap"
                        title={t.id}
                      >
                        {t.id.length > 12 ? t.id.slice(0, 8) : t.id}
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap tabular-nums">
                        {(() => {
                          const ts = formatTicketTimestamp(t.createdAt);
                          return (
                            <>
                              <span className="block font-semibold text-slate-800">{ts.date}</span>
                              {ts.time && (
                                <span className="block text-[10px] font-mono text-slate-500">
                                  {ts.time}
                                </span>
                              )}
                            </>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-slate-800 block">
                          {emp?.name || ent?.name || t.employeeId}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">
                          {emp?.employeeId ||
                            (ent ? `${ent.entityType} · ${ent.entityCode}` : t.employeeId)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-slate-800 block">
                          {asset?.name || t.assetId}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">{t.assetId}</span>
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-bold text-slate-900">{t.subject}</p>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                              t.priority === 'High'
                                ? 'bg-rose-100 text-rose-700'
                                : t.priority === 'Low'
                                ? 'bg-slate-100 text-slate-600'
                                : 'bg-amber-50 text-amber-700'
                            }`}
                          >
                            {t.priority || 'Medium'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">
                          {t.description}
                        </p>
                        {hasWorkOrder && (
                          <div className="mt-1.5 px-2 py-1 rounded bg-emerald-50 border border-emerald-200 text-[10px] text-emerald-900 font-semibold space-y-0.5 tabular-nums">
                            <div>
                              Work Order: {t.workOrderDate} · {t.workOrderStartTime}–
                              {t.workOrderEndTime} ({t.workOrderDurationMins} mins)
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={
                                  t.employeeConfirmed ? 'text-emerald-700 font-bold' : 'text-amber-700'
                                }
                              >
                                {t.employeeConfirmed ? 'Employee Confirmed' : 'Awaiting Employee Confirm'}
                              </span>
                              {t.workOrderMailSentAt && (
                                <span className="text-sky-700 font-bold">· Mail Sent</span>
                              )}
                            </div>
                          </div>
                        )}
                        {!hasWorkOrder && t.requestedDate && (
                          <p className="text-[10px] text-slate-500 mt-1 tabular-nums">
                            Pref Slot: {t.requestedDate}
                            {t.requestedStartTime ? ` ${t.requestedStartTime}` : ''}
                            {t.requestedDurationMins ? ` (${t.requestedDurationMins} mins)` : ''}
                          </p>
                        )}
                        {t.rejectionReason && (
                          <p className="text-[10px] text-red-600 font-medium mt-1">
                            Reason: {t.rejectionReason}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          data-testid={`ticket-status-badge-${t.id}`}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${statusMeta.classes}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`} />
                          {statusMeta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          data-testid={`ticket-approval-badge-${t.id}`}
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${approvalMeta.classes}`}
                        >
                          {approvalMeta.icon === 'pending' && <Clock className="w-3 h-3" />}
                          {approvalMeta.icon === 'approved' && <CheckCircle2 className="w-3 h-3" />}
                          {approvalMeta.icon === 'rejected' && <XCircle className="w-3 h-3" />}
                          {approvalMeta.label}
                        </span>
                        {t.approvedBy && (
                          <span className="block text-[10px] text-slate-400 mt-1">
                            by {t.approvedBy}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap space-x-1 no-print">
                        {canSchedule && (
                          <>
                            <button
                              type="button"
                              aria-label={`Approve ticket ${t.id}`}
                              onClick={() => openScheduleModal(t)}
                              className="px-2.5 py-1 rounded bg-emerald-100 text-emerald-800 hover:bg-emerald-200 text-[10px] font-bold cursor-pointer inline-flex items-center gap-1 align-middle"
                            >
                              <CalendarClock className="w-3 h-3" />
                              <span>Work Order</span>
                            </button>
                            <button
                              type="button"
                              aria-label={`Reject ticket ${t.id}`}
                              onClick={() => {
                                setRejectingTicket(t);
                                setRejectReason('');
                                setRejectError('');
                              }}
                              className="px-2.5 py-1 rounded bg-red-100 text-red-800 hover:bg-red-200 text-[10px] font-bold cursor-pointer align-middle"
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {onSendTicketMail && t.status !== 'Rejected' && (
                          <button
                            type="button"
                            aria-label={`Send Work Order Mail for ticket ${t.id}`}
                            title={
                              t.employeeConfirmed
                                ? 'Send Work Order confirmation email'
                                : 'Send ticket email notification'
                            }
                            onClick={() => void onSendTicketMail(t)}
                            className={`inline-flex items-center justify-center w-7 h-7 rounded border cursor-pointer align-middle ${
                              t.employeeConfirmed && !t.workOrderMailSentAt
                                ? 'bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border-emerald-300'
                                : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200'
                            }`}
                          >
                            <Mail className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {(t.status === 'Requested' || t.status === 'Open' || t.status === 'Approved') && (
                          <button
                            type="button"
                            aria-label={`Close ticket ${t.id}`}
                            onClick={() => void handleCloseAction(t)}
                            className="px-2.5 py-1 rounded bg-[#dbeafe] text-[#1e40af] hover:bg-[#bfdbfe] text-[10px] font-bold cursor-pointer align-middle"
                          >
                            Close
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
        <TablePaginationFooter
          total={filtered.length}
          startIndex={paged.startIndex}
          endIndex={paged.endIndex}
          page={paged.safePage}
          totalPages={paged.totalPages}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
        />
      </div>

      {/* Work Order Scheduler Modal */}
      {schedulingTicket && (
        <ModalShell
          title={`Approve & Generate Work Order · ${schedulingTicket.subject}`}
          icon={<CalendarClock className="w-4 h-4 text-emerald-400" />}
          headerClass="bg-[#3f3f46]"
          maxWidth="max-w-md"
          onClose={() => setSchedulingTicket(null)}
        >
          <form onSubmit={handleConfirmWorkOrder} noValidate className="p-6 space-y-4 bg-white">
            <p className="text-xs text-slate-600">
              Schedule a minute-counted Work Order time frame. During this window the Admin slot is locked against overlapping ticket bookings.
            </p>
            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label
                  htmlFor="wo-date-input"
                  className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
                >
                  Work Order Date *
                </label>
                <input
                  id="wo-date-input"
                  type="date"
                  required
                  value={woDate}
                  onChange={(e) => {
                    setWoDate(e.target.value);
                    if (woError) setWoError('');
                  }}
                  className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs"
                />
              </div>
              <div>
                <label
                  htmlFor="wo-start-time"
                  className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
                >
                  Start Time *
                </label>
                <input
                  id="wo-start-time"
                  type="time"
                  required
                  value={woStartTime}
                  onChange={(e) => {
                    setWoStartTime(e.target.value);
                    if (woError) setWoError('');
                  }}
                  className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs"
                />
              </div>
              <div>
                <label
                  htmlFor="wo-duration-mins"
                  className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
                >
                  Duration (Mins) *
                </label>
                <input
                  id="wo-duration-mins"
                  type="number"
                  min={1}
                  max={720}
                  required
                  value={woDurationMins}
                  onChange={(e) => {
                    setWoDurationMins(Number(e.target.value) || 0);
                    if (woError) setWoError('');
                  }}
                  className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs"
                />
              </div>
            </div>

            {liveEndTime && (
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 flex items-center justify-between tabular-nums">
                <span className="font-semibold">Calculated Slot Window:</span>
                <span className="font-mono font-bold text-slate-900">
                  {woDate} · {woStartTime} – {liveEndTime} ({woDurationMins} mins)
                </span>
              </div>
            )}

            {liveOverlap.overlapping && (
              <p role="alert" className="text-[11px] font-semibold text-rose-600">
                Admin is already booked on {liveOverlap.conflictingTicket?.workOrderDate} (
                {liveOverlap.conflictingTicket?.workOrderStartTime}–
                {liveOverlap.conflictingTicket?.workOrderEndTime}). Choose another slot.
              </p>
            )}

            {woError && (
              <p role="alert" className="text-[11px] font-semibold text-rose-600">
                {woError}
              </p>
            )}

            <div className="flex items-center justify-end space-x-3 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSchedulingTicket(null)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={woSaving}
                className="px-5 py-2 bg-[#3f3f46] hover:bg-[#27272a] disabled:opacity-50 text-white rounded-lg text-xs font-bold cursor-pointer"
              >
                {woSaving ? 'Scheduling...' : 'Approve & Lock Work Order'}
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {/* Reject Reason Modal */}
      {rejectingTicket && (
        <ModalShell
          title={`Reject Ticket ${rejectingTicket.id}`}
          icon={<XCircle className="w-4 h-4 text-rose-400" />}
          headerClass="bg-[#3f3f46]"
          maxWidth="max-w-md"
          onClose={() => setRejectingTicket(null)}
        >
          <form onSubmit={handleConfirmReject} noValidate className="p-6 space-y-4 bg-white">
            <p className="text-xs text-slate-600">
              Provide a reason for rejecting{' '}
              <span className="font-bold text-slate-900">{rejectingTicket.subject}</span>.
            </p>
            <div>
              <label
                htmlFor="reject-ticket-reason"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
              >
                Rejection Reason *
              </label>
              <textarea
                id="reject-ticket-reason"
                rows={3}
                value={rejectReason}
                onChange={(e) => {
                  setRejectReason(e.target.value);
                  if (rejectError) setRejectError('');
                }}
                placeholder="Explain why this ticket is being rejected..."
                className={`w-full px-3 py-2 bg-white border rounded-lg text-xs focus:outline-none ${
                  rejectError ? 'border-rose-500' : 'border-slate-300'
                }`}
              />
              {rejectError && (
                <p role="alert" className="mt-1 text-[11px] font-semibold text-rose-600">
                  {rejectError}
                </p>
              )}
            </div>
            <div className="flex items-center justify-end space-x-3 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setRejectingTicket(null)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold cursor-pointer"
              >
                Confirm Reject
              </button>
            </div>
          </form>
        </ModalShell>
      )}
    </div>
  );
};
